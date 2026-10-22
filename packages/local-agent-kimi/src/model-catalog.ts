import { join } from 'node:path'
import { ModelDirectoryCache, modelDirectoryContextKey } from '@khorsheed/dsh-local-agent'
import type { LocalAgentModelDirectory, LocalAgentModelDirectoryData, LocalAgentModelEntry, LocalAgentReasoningOption } from '@khorsheed/dsh-local-agent/types'
import type { EndpointCheckFetch, KimiEndpointAuth } from './endpoint-auth.ts'
import { fetchEndpointModels, hasEndpointCredential, KIMI_MANAGED_BASE_URL } from './endpoint-auth.ts'
import { readKimiModelTables } from './model-configuration.ts'

type JsonObject = Record<string, unknown>
const object = (value: unknown): JsonObject | undefined => typeof value === 'object' && value !== null ? value as JsonObject : undefined

export interface KimiNativeConfiguration {
  directory: LocalAgentModelDirectoryData
  modelConfigId?: string
  effortConfigId?: string
  currentModel?: string
  currentEffort?: string
}

function options(value: unknown): LocalAgentReasoningOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(candidate => {
    const entry = object(candidate)
    if (entry === undefined) return []
    if (Array.isArray(entry['options'])) return options(entry['options'])
    if (typeof entry['value'] !== 'string') return []
    return [{ value: entry['value'], label: typeof entry['name'] === 'string' ? entry['name'] : entry['value'], ...typeof entry['description'] === 'string' ? { description: entry['description'] } : {} }]
  })
}

/** ACP v1 configOptions are authoritative; old models metadata is a read-only fallback. */
export function kimiNativeConfiguration(value: unknown): KimiNativeConfiguration | undefined {
  const response = object(value)
  if (response === undefined) return undefined
  const configuration = response['configOptions']
  if (Array.isArray(configuration)) {
    const choices = configuration.map(object).filter((entry): entry is JsonObject => entry !== undefined && entry['type'] === 'select')
    const model = choices.find(entry => entry['category'] === 'model')
    const effort = choices.find(entry => entry['category'] === 'thought_level')
    if (model !== undefined) {
      const currentModel = typeof model['currentValue'] === 'string' ? model['currentValue'] : undefined
      const entries: LocalAgentModelEntry[] = options(model['options']).map(option => ({
        ...option, source: 'native',
        // Dependent options describe the CURRENT model only, not every candidate.
        ...effort === undefined || option.value !== currentModel ? {} : { reasoning: { options: options(effort['options']) } },
      }))
      return {
        directory: { entries, complete: true, customInput: false },
        ...typeof model['id'] === 'string' ? { modelConfigId: model['id'] } : {},
        ...typeof effort?.['id'] === 'string' ? { effortConfigId: effort['id'] } : {},
        ...currentModel === undefined ? {} : { currentModel },
        ...typeof effort?.['currentValue'] === 'string' ? { currentEffort: effort['currentValue'] } : {},
      }
    }
  }
  const legacy = object(response['models'])
  if (!Array.isArray(legacy?.['availableModels'])) return undefined
  const entries: LocalAgentModelEntry[] = legacy['availableModels'].flatMap(candidate => {
    const model = object(candidate)
    if (typeof model?.['modelId'] !== 'string') return []
    return [{ value: model['modelId'], label: typeof model['name'] === 'string' ? model['name'] : model['modelId'], source: 'native', ...typeof model['description'] === 'string' ? { description: model['description'] } : {} }]
  })
  return {
    directory: { entries, complete: true, customInput: false },
    ...typeof legacy['currentModelId'] === 'string' ? { currentModel: legacy['currentModelId'] } : {},
  }
}

/** One directory answer that names why it is empty. kimi never offers custom
 * input: a free-typed value names no `[models.…]` table, and kimi-cli refuses
 * `-m` values without one (verified 2.1.1) — unlike claude, only the
 * listed/configured models are runnable. */
function unsupported(reason: string): LocalAgentModelDirectoryData {
  return { entries: [], complete: false, customInput: false, unsupported: true, reason }
}

/**
 * The model directory, sourced from the configured ENDPOINT (`GET
 * <baseUrl>/v1/models` with the resolved credential's Bearer header — kimi's
 * own coding service answers it with the managed key, verified 2026-10-22) —
 * never from the scoped config's model tables alone: what the picker lists is
 * exactly what the endpoint serves, so a credential that does not work can
 * never hide behind a locally-known list. The answers are deliberate:
 *
 * - no credential resolved → empty with a "save a key first" reason;
 * - 401/403 → empty with the rejection (definitive — cached as data);
 * - another HTTP status → empty with it (the relay serves no model route);
 * - a transport failure THROWS, so the cache keeps the last good list and
 *   retries on schedule instead of blanking a momentarily-down endpoint.
 *
 * The config's `[models.…]` tables survive as METADATA ENRICHMENT: a served
 * model whose upstream id matches a managed table's `model` takes that
 * table's KEY as its value — the runnable name `-m` resolves against — and
 * the table's display_name/support_efforts/default_effort fill whatever the
 * endpoint did not advertise; a served id with no managed table stays the
 * bare id, which the model list's write face provisions a table for
 * (provision.ts's `ensureKimiModelTables`). Reads before a session exists
 * never start a disposable ACP session.
 */
export class KimiModelCatalog {
  private readonly cache: ModelDirectoryCache

  constructor(
    private readonly context: (childSessionId?: string) => { homeDir: string; cwd?: string; native?: KimiNativeConfiguration },
    private readonly deps: {
      /** Per-probe endpoint credential resolver (the scope's file over the settings layer). */
      endpoint: (homeDir: string) => Promise<KimiEndpointAuth>
      /** The HTTP fetch (injected in tests). */
      fetchImpl?: EndpointCheckFetch
      timeoutMs?: number
      ttlMs?: number
      warn?: (message: string) => void
    },
  ) {
    this.cache = new ModelDirectoryCache({
      load: (key, signal) => {
        const context = JSON.parse(key) as { homeDir: string; native?: LocalAgentModelDirectoryData }
        // A member's ACP runtime configOptions are authoritative for that
        // member — the endpoint probe never overrides a live native answer.
        if (context.native !== undefined) return Promise.resolve(context.native)
        return this.probe(context.homeDir, signal)
      },
      ...deps.ttlMs === undefined ? {} : { ttlMs: deps.ttlMs },
      onError: error => deps.warn?.(`Kimi model discovery failed: ${error instanceof Error ? error.message : String(error)}`),
    })
  }

  private stamp(homeDir: string, cwd?: string): string {
    return modelDirectoryContextKey({ provider: 'kimi', homeDir, cwd: cwd ?? homeDir, cli: ['kimi'], files: [join(homeDir, 'config.toml'), join(homeDir, 'endpoint-auth.json')] })
  }

  private key(childSessionId?: string): string {
    const context = this.context(childSessionId)
    return JSON.stringify({ homeDir: context.homeDir, stamp: this.stamp(context.homeDir, context.cwd), childSessionId, ...context.native === undefined ? {} : { native: context.native.directory } })
  }

  /**
   * The cache key for one scoped home directly (no member, no native): the
   * model-list write face's read — its entries carry the metadata the write
   * face's table provisioning (provision.ts's `ensureKimiModelTables`)
   * stamps into the tables it creates.
   */
  private homeKey(homeDir: string): string {
    return JSON.stringify({ homeDir, stamp: this.stamp(homeDir) })
  }

  read(childSessionId?: string): LocalAgentModelDirectory { return this.cache.read(this.key(childSessionId)) }
  refresh(childSessionId?: string): Promise<LocalAgentModelDirectory> { return this.cache.refresh(this.key(childSessionId)) }
  readHome(homeDir: string): LocalAgentModelDirectory { return this.cache.read(this.homeKey(homeDir)) }
  refreshHome(homeDir: string): Promise<LocalAgentModelDirectory> { return this.cache.refresh(this.homeKey(homeDir)) }
  follow(childSessionId: string | undefined, signal: AbortSignal): AsyncIterable<LocalAgentModelDirectory> { return this.cache.follow(() => this.key(childSessionId), signal) }
  dispose(): void { this.cache.dispose() }

  private async probe(homeDir: string, signal: AbortSignal): Promise<LocalAgentModelDirectoryData> {
    const endpoint = await this.deps.endpoint(homeDir)
    if (!hasEndpointCredential(endpoint)) {
      return unsupported('No endpoint credential configured — the model list loads from the endpoint once an API Key is saved')
    }
    const result = await fetchEndpointModels(
      { ...endpoint, baseUrl: endpoint.baseUrl ?? KIMI_MANAGED_BASE_URL },
      this.deps.fetchImpl,
      AbortSignal.any([signal, AbortSignal.timeout(this.deps.timeoutMs ?? 20_000)]),
    )
    if (result.kind === 'unreachable') {
      // Not a verdict: the cache keeps the last good list and retries.
      throw new Error(`endpoint unreachable: ${result.message}`)
    }
    if (result.kind === 'malformed') return unsupported('The endpoint answered but the model list did not parse (not a /models-shaped reply)')
    if (result.kind === 'http') {
      if (result.status === 401 || result.status === 403) {
        return unsupported(`The endpoint rejected the credential (HTTP ${String(result.status)}) — the list loads once a valid key is saved`)
      }
      return unsupported(`The endpoint does not serve a model list (HTTP ${String(result.status)})`)
    }
    if (result.models.length === 0) return unsupported('The endpoint serves no models')
    // Enrichment: the scoped config's managed tables map an upstream id (the
    // table's `model`) to the runnable name (the table KEY) plus whatever
    // metadata the endpoint did not advertise.
    const byUpstream = new Map<string, { key: string; displayName?: string; efforts?: readonly string[]; defaultEffort?: string }>()
    for (const modelTable of await readKimiModelTables(homeDir)) {
      if (modelTable.provider !== 'managed:kimi-code' || modelTable.model === undefined) continue
      if (!byUpstream.has(modelTable.model)) byUpstream.set(modelTable.model, modelTable)
    }
    const entries: LocalAgentModelEntry[] = result.models.map(model => {
      const modelTable = byUpstream.get(model.id)
      const value = modelTable?.key ?? model.id
      const efforts = model.efforts ?? modelTable?.efforts
      const defaultEffort = model.defaultEffort ?? modelTable?.defaultEffort
      return {
        value,
        label: model.displayName ?? modelTable?.displayName ?? value,
        source: 'native',
        ...efforts === undefined || efforts.length === 0 ? {} : { reasoning: {
          options: efforts.map((effort): LocalAgentReasoningOption => ({ value: effort, label: effort })),
          ...defaultEffort === undefined ? {} : { default: defaultEffort },
        } },
      }
    })
    return { entries, complete: true, customInput: false }
  }
}
