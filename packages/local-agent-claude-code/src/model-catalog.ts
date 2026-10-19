import { join } from 'node:path'
import { ModelDirectoryCache, modelDirectoryContextKey } from '@khorsheed/dsh-local-agent'
import type { LocalAgentModelDirectory, LocalAgentModelDirectoryData, LocalAgentModelEntry } from '@khorsheed/dsh-local-agent/types'
import type { ClaudeEndpointAuth, EndpointCheckFetch } from './endpoint-auth.ts'
import { fetchEndpointModels, hasEndpointCredential, OFFICIAL_BASE_URL } from './endpoint-auth.ts'

type JsonObject = Record<string, unknown>

/**
 * Fold the CLI's own `initialize` model vocabulary. Consumed by the LIVE
 * DRIVER's runtime init handling; the catalog no longer reads this — a
 * local list cannot prove anything about the configured endpoint, and
 * showing it made an invalid credential look valid.
 */
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

/** One directory answer that names why it is empty. */
function unsupported(reason: string): LocalAgentModelDirectoryData {
  return { entries: [], complete: false, customInput: true, unsupported: true, reason }
}

/**
 * The model directory, sourced from the configured ENDPOINT (`GET
 * <baseUrl>/v1/models` with the resolved credential) — never from the local
 * CLI: what the picker lists is exactly what the endpoint serves, so a
 * credential that does not work can never hide behind a locally-known list.
 * The answers are deliberate:
 *
 * - no credential resolved → empty with a "save a key first" reason;
 * - 401/403 → empty with the rejection (definitive — cached as data);
 * - another HTTP status → empty with it (the relay serves no model route);
 * - a transport failure THROWS, so the cache keeps the last good list and
 *   retries on schedule instead of blanking a momentarily-down endpoint.
 *
 * Effort levels ride the served entries' `effort` capability when the
 * endpoint advertises them. Entries carry `source: 'native'` — they are the
 * harness's native vocabulary, just read from the endpoint in force.
 */
export class ClaudeModelCatalog {
  private readonly cache: ModelDirectoryCache
  constructor(private readonly deps: {
    /** Per-probe endpoint credential resolver (the scope's file over the settings layer). */
    endpoint?: (homeDir: string) => Promise<ClaudeEndpointAuth>
    /**
     * The cache key's endpoint component: the settings layer's baseUrl plus a
     * short credential digest, resolved per read so a card write (either
     * field) re-keys the cache. A scope FILE's contribution needs no place
     * here — the file itself is in the key's fingerprinted file list.
     */
    endpointLabel?: () => string | undefined
    /** The HTTP fetch (injected in tests). */
    fetchImpl?: EndpointCheckFetch
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
    const files = [join(homeDir, 'settings.json'), join(homeDir, 'endpoint-auth.json')]
    const endpointLabel = this.deps.endpointLabel?.()
    return modelDirectoryContextKey({ provider: 'claude-code', homeDir, cwd, cli: [], files, ...endpointLabel === undefined ? {} : { endpoint: endpointLabel } })
  }

  read(homeDir: string, cwd?: string): LocalAgentModelDirectory { return this.cache.read(this.key(homeDir, cwd)) }
  refresh(homeDir: string, cwd?: string): Promise<LocalAgentModelDirectory> { return this.cache.refresh(this.key(homeDir, cwd)) }
  follow(homeDir: string, cwd: string | undefined, signal: AbortSignal): AsyncIterable<LocalAgentModelDirectory> { return this.cache.follow(() => this.key(homeDir, cwd), signal) }
  invalidate(homeDir: string, cwd?: string): void { this.cache.invalidate(this.key(homeDir, cwd)) }
  dispose(): void { this.cache.dispose() }

  private async probe(homeDir: string, _cwd: string, signal: AbortSignal): Promise<LocalAgentModelDirectoryData> {
    const endpoint = await this.deps.endpoint?.(homeDir)
    if (!hasEndpointCredential(endpoint)) {
      return unsupported('No endpoint credential configured — the model list loads from the endpoint once an API Key or Auth Token is saved')
    }
    const result = await fetchEndpointModels(
      { ...endpoint, baseUrl: endpoint.baseUrl ?? OFFICIAL_BASE_URL },
      this.deps.fetchImpl,
      AbortSignal.any([signal, AbortSignal.timeout(this.deps.timeoutMs ?? 8_000)]),
    )
    if (result.kind === 'unreachable') {
      // Not a verdict: the cache keeps the last good list and retries.
      throw new Error(`endpoint unreachable: ${result.message}`)
    }
    if (result.kind === 'malformed') return unsupported('The endpoint answered but the model list did not parse (not /v1/models-shaped)')
    if (result.kind === 'http') {
      if (result.status === 401 || result.status === 403) {
        return unsupported(`The endpoint rejected the credential (HTTP ${String(result.status)}) — the list loads once a valid key is saved`)
      }
      return unsupported(`The endpoint does not serve a model list (HTTP ${String(result.status)})`)
    }
    const entries: LocalAgentModelEntry[] = result.models.map(model => ({
      value: model.id,
      label: model.displayName ?? model.id,
      source: 'native',
      ...model.efforts === undefined ? {} : { reasoning: { options: model.efforts.map(effort => ({ value: effort, label: effort })) } },
    }))
    if (entries.length === 0) return unsupported('The endpoint serves no models')
    return { entries, complete: true, customInput: true }
  }
}
