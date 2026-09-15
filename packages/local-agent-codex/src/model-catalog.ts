/** Native app-server model/list discovery. Shared core cache owns refresh,
 * stale data and subscriptions; this provider owns protocol and pagination. */

import { dirname, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { ModelDirectoryCache, modelDirectoryContextKey, delegationEnv } from '@khorsheed/dsh-local-agent'
import type { LocalAgentModelDirectory, LocalAgentModelDirectoryData, LocalAgentModelEntry } from '@khorsheed/dsh-local-agent/types'
import { DEFAULT_DISPOSE_GRACE_MS } from './codex-cli-provider.ts'

/** Default overall bound for one catalog probe (spawn → model/list answer). */
export const DEFAULT_CATALOG_PROBE_TIMEOUT_MS = 5_000

/** Default lifetime of a completed probe's cached answer, per scoped home. */
export const DEFAULT_CATALOG_TTL_MS = 5 * 60_000

/** Grace between stdin EOF and terminate when the probe tears the process down. */
const PROBE_EOF_GRACE_MS = 1_000

type JsonObject = Record<string, unknown>

/** Everything the catalog needs, injected so the specs drive a fake app-server. */
export interface CodexModelCatalogDeps {
  /** The host's managed spawn — the same seam the live driver spawns through. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Diagnostic sink; a degraded probe warns once, never throws. */
  readonly warn?: (message: string) => void
  /** Overall probe bound; tests inject a small value. */
  readonly timeoutMs?: number
  /** Completed-probe cache lifetime; tests inject a small value. */
  readonly ttlMs?: number
  /** Clock, injectable for the TTL assertions. */
  readonly now?: () => number
}

/** Preserve native metadata, including hidden candidates; reject malformed pages. */
function catalogEntries(result: unknown): { entries: LocalAgentModelEntry[]; defaultModel?: string; nextCursor?: string } {
  const page = result as { data?: unknown; nextCursor?: unknown } | null
  if (!Array.isArray(page?.data)) throw new Error('model/list returned no model array')
  const entries: LocalAgentModelEntry[] = []
  let defaultModel: string | undefined
  for (const entry of page.data) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as JsonObject
    const raw = typeof record['id'] === 'string' ? record['id'] : record['model']
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (value === '') continue
    if (record['isDefault'] === true && defaultModel === undefined) defaultModel = value
    const nativeEfforts = record['supportedReasoningEfforts']
    const options = Array.isArray(nativeEfforts) ? nativeEfforts.flatMap(option => {
      if (typeof option !== 'object' || option === null) return []
      const effort = option as JsonObject
      const choice = effort['reasoningEffort']
      if (typeof choice !== 'string' || choice === '') return []
      return [{ value: choice, label: choice, ...typeof effort['description'] === 'string' ? { description: effort['description'] } : {} }]
    }) : undefined
    const defaultEffort = record['defaultReasoningEffort']
    entries.push({
      value, label: typeof record['displayName'] === 'string' ? record['displayName'] : value,
      source: 'native', hidden: record['hidden'] === true,
      ...typeof record['description'] === 'string' ? { description: record['description'] } : {},
      ...options === undefined ? {} : { reasoning: { options, ...typeof defaultEffort === 'string' ? { default: defaultEffort } : {} } },
    })
  }
  return {
    entries, ...defaultModel === undefined ? {} : { defaultModel },
    ...typeof page.nextCursor === 'string' && page.nextCursor !== '' ? { nextCursor: page.nextCursor } : {},
  }
}

/** Synchronous compatibility reads plus a rich, subscribable directory. */
export class CodexModelCatalog {
  private readonly timeoutMs: number
  private readonly cache: ModelDirectoryCache

  constructor(private readonly deps: CodexModelCatalogDeps) {
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_CATALOG_PROBE_TIMEOUT_MS
    this.cache = new ModelDirectoryCache({
      load: (key, signal) => {
        const context = JSON.parse(key) as { homeDir: string; cwd: string }
        return this.probe(context.homeDir, context.cwd, signal)
      },
      ttlMs: deps.ttlMs ?? DEFAULT_CATALOG_TTL_MS,
      ...deps.now === undefined ? {} : { now: deps.now },
      onError: error => deps.warn?.(`local-agent-codex: the model catalog probe degraded: ${error instanceof Error ? error.message : String(error)}`),
    })
  }

  private key(homeDir: string, cwd = homeDir): string {
    const files = [join(homeDir, 'config.toml'), join(homeDir, 'auth.json')]
    for (let directory = cwd; ; directory = dirname(directory)) {
      files.push(join(directory, '.codex', 'config.toml'))
      if (dirname(directory) === directory) break
    }
    return modelDirectoryContextKey({ provider: 'codex', homeDir, cwd, cli: ['codex'], files })
  }

  read(homeDir: string, cwd?: string): readonly string[] {
    return this.directory(homeDir, cwd).entries.filter(entry => !entry.hidden).map(entry => entry.value)
  }

  readDefault(homeDir: string, cwd?: string): string | undefined { return this.directory(homeDir, cwd).defaultModel }
  directory(homeDir: string, cwd?: string): LocalAgentModelDirectory { return this.cache.read(this.key(homeDir, cwd)) }
  follow(homeDir: string, signal: AbortSignal, cwd?: string): AsyncIterable<LocalAgentModelDirectory> { return this.cache.follow(() => this.key(homeDir, cwd), signal) }
  invalidate(homeDir: string, cwd?: string): void { this.cache.invalidate(this.key(homeDir, cwd)) }
  dispose(): void { this.cache.dispose() }

  async refresh(homeDir: string, cwd?: string): Promise<readonly string[]> {
    const snapshot = await this.cache.refresh(this.key(homeDir, cwd))
    return snapshot.entries.filter(entry => !entry.hidden).map(entry => entry.value)
  }

  /**
   * One bounded probe: spawn the app-server against the scoped home, answer
   * the initialize handshake exactly as the live driver shapes it, ask
   * `model/list`, then tear the process down (stdin EOF → grace →
   * terminate). The overall timeout kills the process on expiry. Failures propagate to the shared cache, which preserves prior data.
   */
  private async probe(homeDir: string, cwd: string, signal: AbortSignal): Promise<LocalAgentModelDirectoryData> {
    const spec: SubprocessSpawnSpec = {
      argv: ['codex', 'app-server', '--stdio'],
      cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: DEFAULT_DISPOSE_GRACE_MS,
      env: delegationEnv({ CODEX_HOME: homeDir }),
    }
    const child: SubprocessHandle = this.deps.spawn(spec)
    const decoder = new StringDecoder('utf8')
    let buffer = ''
    const pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>()
    let nextId = 0
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      for (const request of pending.values()) request.reject(new Error('the model catalog probe closed'))
      pending.clear()
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += decoder.write(chunk)
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')
        if (line.trim() === '') continue
        let message: { id?: unknown; result?: unknown; error?: unknown; method?: unknown }
        try {
          message = JSON.parse(line) as typeof message
        } catch {
          continue
        }
        const id = typeof message.id === 'number' ? message.id : undefined
        if (id !== undefined && typeof message.method === 'string') {
          // A server→client request: the probe answers nothing but errors.
          child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'unsupported' } }) + '\n')
          continue
        }
        if (id === undefined) continue
        const request = pending.get(id)
        if (request === undefined) continue
        pending.delete(id)
        const wireError = message.error as { message?: string } | undefined | null
        if (wireError !== undefined && wireError !== null) {
          request.reject(new Error(wireError.message ?? 'wire error'))
        } else {
          request.resolve(message.result)
        }
      }
    })
    void child.done.then(finish, finish)
    const abort = (): void => { finish(); child.terminate() }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    const request = <T>(method: string, params: JsonObject): Promise<T> => {
      if (done) return Promise.reject(new Error('the model catalog probe closed'))
      nextId += 1
      const id = nextId
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: result => resolve(result as T), reject })
        child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      })
    }
    const teardown = async (): Promise<void> => {
      finish()
      child.stdin?.end()
      await Promise.race([child.done.catch(() => {}), new Promise(resolve => setTimeout(resolve, PROBE_EOF_GRACE_MS))])
      child.terminate()
      await child.waitForExit().catch(() => {})
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        (async () => {
          await request('initialize', {
            clientInfo: { name: 'dsh-local-agent-codex', title: 'dsh local-agent codex model catalog probe', version: '0.1.0' },
            capabilities: { experimentalApi: false, requestAttestation: false },
          })
          child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n')
          const entries = new Map<string, LocalAgentModelEntry>()
          const cursors = new Set<string>()
          let cursor: string | undefined
          let defaultModel: string | undefined
          do {
            const page = catalogEntries(await request('model/list', { includeHidden: true, ...cursor === undefined ? {} : { cursor } }))
            for (const entry of page.entries) if (!entries.has(entry.value)) entries.set(entry.value, entry)
            defaultModel ??= page.defaultModel
            cursor = page.nextCursor
            if (cursor !== undefined) {
              if (cursors.has(cursor)) throw new Error('model/list repeated a pagination cursor')
              cursors.add(cursor)
            }
          } while (cursor !== undefined)
          return { entries: [...entries.values()], complete: true, customInput: true, ...defaultModel === undefined ? {} : { defaultModel } }

        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('the model catalog probe timed out')), this.timeoutMs)
          timer.unref()
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      await teardown()
    }
  }
}
