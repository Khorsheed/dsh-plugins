/**
 * The codex account model catalog: a one-shot probe of
 * `codex app-server --stdio`'s `model/list` against the SCOPED home, cached
 * in-process, so the model broker's pickable vocabulary includes the models
 * the account can actually run — the layer that fixes an empty settings-card
 * dropdown when the scoped config.toml names no models. Protocol-verified
 * against codex-cli 0.144.0: a plain `initialize` (no experimentalApi
 * capability) suffices, and the answer is `result.data[]` of
 * `{ id, model, displayName, hidden, supportedReasoningEfforts, ... }` where
 * `id` and `model` both carry the slug the CLI binds via `-m` / `-c model=…`
 * (the probe reads `id`, falling back to `model`). The entry the account has
 * as its built-in default carries `isDefault: true` (verified live:
 * gpt-5.6-sol) — the ONE side channel that names the CLI's compiled default,
 * which is why the probe captures it alongside the slugs and the broker can
 * report source `cli-builtin` WITH an effective model.
 *
 * The probe reuses the live driver's spawn discipline — the same
 * `codex app-server --stdio` argv, the same `delegationEnv({ CODEX_HOME })`
 * pinning — but deliberately carries NO `-c` overrides: the only ones the
 * driver uses are the per-member bridge token and the per-member model
 * binding, and both are meaningless (a model binding could even scope the
 * answer) for an anonymous account-catalog read. The process is bounded by
 * an overall timeout and killed on expiry; ANY failure — codex missing,
 * spawn error, handshake refusal, timeout, a malformed answer — degrades to
 * an empty list, never a throw.
 *
 * Caching rule (the simpler robust one): a COMPLETED probe — success or
 * failure — is cached per scoped home for a flat TTL; nothing watches
 * config.toml mtimes. A failed probe is cached too, so a missing codex CLI
 * costs one dead spawn per TTL window instead of one per settings-card open.
 * Concurrent reads for the same home share one in-flight probe.
 * @module @khorsheed/dsh-local-agent-codex/model-catalog
 */

import { StringDecoder } from 'node:string_decoder'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { delegationEnv } from '@khorsheed/dsh-local-agent'
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

/**
 * Extract the runnable slugs and the account's built-in default from a
 * `model/list` result: entries with `hidden === true` are dropped from the
 * slug list, each remaining entry contributes its `id` (the schema-stable
 * slug field; `model`, which mirrors it on 0.144.0, is the fallback), and the
 * list is deduped order-preserving. The entry carrying `isDefault === true`
 * names the account's compiled default; the marker is honored even on a
 * hidden entry (hidden means unlisted, not unrunnable) and the first marker
 * wins. Anything that is not the expected shape yields an empty list and no
 * default.
 */
function catalogEntries(result: unknown): { models: string[]; defaultModel?: string } {
  const data = (result as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return { models: [] }
  const seen = new Set<string>()
  const models: string[] = []
  let defaultModel: string | undefined
  for (const entry of data) {
    const record = entry as { id?: unknown; model?: unknown; hidden?: unknown; isDefault?: unknown } | null
    if (record === null) continue
    const raw = typeof record.id === 'string' ? record.id : typeof record.model === 'string' ? record.model : undefined
    const slug = raw?.trim()
    if (record.isDefault === true && defaultModel === undefined && slug !== undefined && slug !== '') {
      defaultModel = slug
    }
    if (record.hidden === true) continue
    if (slug === undefined || slug === '' || seen.has(slug)) continue
    seen.add(slug)
    models.push(slug)
  }
  return defaultModel === undefined ? { models } : { models, defaultModel }
}

/**
 * The codex account model catalog cache. `read` is SYNCHRONOUS — it serves
 * the last completed probe and, when the entry is absent or stale, kicks a
 * background re-probe without awaiting it. The first read after boot (or
 * after a TTL expiry) therefore misses the catalog; the settings card
 * re-fetches on every open, so the next open sees the probed slugs. This
 * keeps a cold cache — worst case a few seconds of CLI boot — out of the
 * broker's read path.
 */
export class CodexModelCatalog {
  private readonly timeoutMs: number
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly entries = new Map<string, { at: number; models: readonly string[]; defaultModel?: string }>()
  private readonly inflight = new Map<string, Promise<readonly string[]>>()

  constructor(private readonly deps: CodexModelCatalogDeps) {
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_CATALOG_PROBE_TIMEOUT_MS
    this.ttlMs = deps.ttlMs ?? DEFAULT_CATALOG_TTL_MS
    this.now = deps.now ?? Date.now
  }

  /** The cached slugs for the scoped home; re-probes in the background when stale. */
  read(homeDir: string): readonly string[] {
    return this.cached(homeDir)?.models ?? []
  }

  /**
   * The cached built-in default slug (`isDefault: true` on the last completed
   * probe), or undefined when no probe named one. Same cache, same background
   * re-probe as {@link read} — the two reads share one in-flight probe.
   */
  readDefault(homeDir: string): string | undefined {
    return this.cached(homeDir)?.defaultModel
  }

  /** The fresh-enough cache entry for the home, kicking a background re-probe when absent or stale. */
  private cached(homeDir: string): { at: number; models: readonly string[]; defaultModel?: string } | undefined {
    const cached = this.entries.get(homeDir)
    if (cached === undefined || this.now() - cached.at >= this.ttlMs) {
      void this.refresh(homeDir).catch(() => {})
    }
    return cached
  }

  /**
   * Probe (or await the in-flight probe for) the scoped home and cache the
   * outcome — success or failure — for the TTL. Concurrent calls share one
   * probe process.
   */
  refresh(homeDir: string): Promise<readonly string[]> {
    const pending = this.inflight.get(homeDir)
    if (pending !== undefined) return pending
    const probe = this.probe(homeDir).then(
      result => {
        this.entries.set(homeDir, { at: this.now(), ...result })
        return result.models
      },
      () => {
        // probe() never throws by contract; this guard keeps the cache write
        // total even against a regression, so a broken probe cannot spam.
        this.entries.set(homeDir, { at: this.now(), models: [] })
        return [] as readonly string[]
      },
    )
    this.inflight.set(homeDir, probe)
    void probe.finally(() => {
      if (this.inflight.get(homeDir) === probe) this.inflight.delete(homeDir)
    })
    return probe
  }

  /**
   * One bounded probe: spawn the app-server against the scoped home, answer
   * the initialize handshake exactly as the live driver shapes it, ask
   * `model/list`, then tear the process down (stdin EOF → grace →
   * terminate). The overall timeout kills the process on expiry. Every
   * failure path resolves to an empty list.
   */
  private async probe(homeDir: string): Promise<{ models: string[]; defaultModel?: string }> {
    const spec: SubprocessSpawnSpec = {
      argv: ['codex', 'app-server', '--stdio'],
      cwd: homeDir,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: DEFAULT_DISPOSE_GRACE_MS,
      env: delegationEnv({ CODEX_HOME: homeDir }),
    }
    let child: SubprocessHandle
    try {
      child = this.deps.spawn(spec)
    } catch (error) {
      this.deps.warn?.(`local-agent-codex: the model catalog probe failed to spawn: ${error instanceof Error ? error.message : String(error)}`)
      return { models: [] }
    }
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
    const request = <T>(method: string, params: JsonObject): Promise<T> => {
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
    try {
      return await Promise.race([
        (async () => {
          await request('initialize', {
            clientInfo: { name: 'dsh-local-agent-codex', title: 'dsh local-agent codex model catalog probe', version: '0.1.0' },
            capabilities: { experimentalApi: false, requestAttestation: false },
          })
          child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n')
          return catalogEntries(await request('model/list', {}))
        })(),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error('the model catalog probe timed out')), this.timeoutMs)
          timer.unref()
        }),
      ])
    } catch (error) {
      this.deps.warn?.(`local-agent-codex: the model catalog probe degraded: ${error instanceof Error ? error.message : String(error)}`)
      return { models: [] }
    } finally {
      await teardown()
    }
  }
}
