import { dirname, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { ModelDirectoryCache, delegationEnv, modelDirectoryContextKey } from '@khorsheed/dsh-local-agent'
import type { LocalAgentModelDirectory, LocalAgentModelDirectoryData, LocalAgentModelEntry } from '@khorsheed/dsh-local-agent/types'
import { ClaudeControlRequests } from './control-requests.ts'

type JsonObject = Record<string, unknown>

/** Initialize's native picker vocabulary, not an account entitlement claim. */
export function claudeDirectory(result: JsonObject): LocalAgentModelDirectoryData {
  const models = result['models']
  if (models === undefined) return { entries: [], complete: false, customInput: true, unsupported: true, reason: 'This Claude CLI does not expose a native model directory' }
  if (!Array.isArray(models)) throw new Error('Claude initialize returned an invalid model directory')
  const entries = new Map<string, LocalAgentModelEntry>()
  for (const candidate of models) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const model = candidate as JsonObject
    const value = typeof model['value'] === 'string' ? model['value'].trim() : ''
    if (value === '' || entries.has(value)) continue
    const levels = model['supportedEffortLevels']
    const options = Array.isArray(levels) ? levels.flatMap(level => typeof level === 'string' && level !== '' ? [{ value: level, label: level }] : []) : undefined
    entries.set(value, {
      value, label: typeof model['displayName'] === 'string' ? model['displayName'] : value, source: 'native',
      ...typeof model['resolvedModel'] === 'string' ? { resolvedModel: model['resolvedModel'] } : {},
      ...typeof model['description'] === 'string' ? { description: model['description'] } : {},
      ...options === undefined ? {} : { reasoning: { options } },
    })
  }
  return { entries: [...entries.values()], complete: true, customInput: true, ...entries.has('default') ? { defaultModel: 'default' } : {} }
}

/** Scoped native control probe. Never syncs credentials, writes settings or submits a user turn. */
export class ClaudeModelCatalog {
  private readonly cache: ModelDirectoryCache
  constructor(private readonly deps: {
    spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
    baseUrl?: string
    cli?: string
    timeoutMs?: number
    ttlMs?: number
    warn?: (message: string) => void
  }) {
    this.cache = new ModelDirectoryCache({
      load: (key, signal) => {
        const context = JSON.parse(key) as { homeDir: string; cwd: string }
        return this.probe(context.homeDir, context.cwd, signal)
      },
      ...deps.ttlMs === undefined ? {} : { ttlMs: deps.ttlMs },
      onError: error => deps.warn?.(`Claude model discovery failed: ${error instanceof Error ? error.message : String(error)}`),
    })
  }

  private key(homeDir: string, cwd = homeDir): string {
    const files = [join(homeDir, 'settings.json'), join(homeDir, '.credentials.json'), join(homeDir, '.claude.json')]
    for (let directory = cwd; ; directory = dirname(directory)) {
      files.push(join(directory, '.claude', 'settings.json'), join(directory, '.claude', 'settings.local.json'))
      if (dirname(directory) === directory) break
    }
    return modelDirectoryContextKey({ provider: 'claude-code', homeDir, cwd, cli: [this.deps.cli ?? 'claude'], files, ...this.deps.baseUrl === undefined ? {} : { endpoint: this.deps.baseUrl } })
  }

  read(homeDir: string, cwd?: string): LocalAgentModelDirectory { return this.cache.read(this.key(homeDir, cwd)) }
  refresh(homeDir: string, cwd?: string): Promise<LocalAgentModelDirectory> { return this.cache.refresh(this.key(homeDir, cwd)) }
  follow(homeDir: string, cwd: string | undefined, signal: AbortSignal): AsyncIterable<LocalAgentModelDirectory> { return this.cache.follow(() => this.key(homeDir, cwd), signal) }
  invalidate(homeDir: string, cwd?: string): void { this.cache.invalidate(this.key(homeDir, cwd)) }
  dispose(): void { this.cache.dispose() }

  private async probe(homeDir: string, cwd: string, signal: AbortSignal): Promise<LocalAgentModelDirectoryData> {
    const child = this.deps.spawn({
      argv: [this.deps.cli ?? 'claude', '-p', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json',
        '--no-session-persistence', '--settings', '{"disableAllHooks":true}', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--'],
      cwd, stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }, graceMs: 2_000,
      env: delegationEnv({ CLAUDE_CONFIG_DIR: homeDir, ...this.deps.baseUrl === undefined ? {} : { ANTHROPIC_BASE_URL: this.deps.baseUrl } }),
    })
    const controls = new ClaudeControlRequests(frame => {
      if (child.stdin === undefined) throw new Error('Claude discovery stdin is unavailable')
      child.stdin.write(JSON.stringify(frame) + '\n')
    }, this.deps.timeoutMs ?? 5_000)
    const decoder = new StringDecoder('utf8')
    let buffer = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += decoder.write(chunk)
      if (buffer.length > 1_048_576) { controls.close(); child.terminate(); return }
      let index: number
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        let event: JsonObject
        try { event = JSON.parse(line) as JsonObject } catch { continue }
        if (controls.accept(event)) continue
        if (event['type'] === 'control_request' && typeof event['request_id'] === 'string') {
          child.stdin?.write(JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: event['request_id'], error: 'Model discovery does not execute tools' } }) + '\n')
        }
      }
    })
    child.stderr?.on('data', () => {})
    void child.done.then(() => controls.close(), () => controls.close())
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined
    try {
      return claudeDirectory(await controls.request({ subtype: 'initialize', hooks: {} }, signal))
    } finally {
      controls.close()
      child.stdin?.end()
      await Promise.race([child.done.catch(() => {}), new Promise<void>(resolve => {
        cleanupTimer = setTimeout(resolve, 1_000)
        cleanupTimer.unref()
      })])
      if (cleanupTimer !== undefined) clearTimeout(cleanupTimer)
      child.terminate()
      await child.waitForExit().catch(() => {})
    }
  }
}
