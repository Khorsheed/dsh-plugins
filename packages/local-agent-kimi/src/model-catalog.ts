import { join } from 'node:path'
import { ModelDirectoryCache, modelDirectoryContextKey } from '@khorsheed/dsh-local-agent'
import type { LocalAgentModelDirectory, LocalAgentModelDirectoryData, LocalAgentModelEntry, LocalAgentReasoningOption } from '@khorsheed/dsh-local-agent/types'
import { listKimiConfigModels, readKimiDefaultModel } from './provision.ts'

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

/** Reads configuration before a session exists; never starts a disposable ACP session. */
export class KimiModelCatalog {
  private readonly cache = new ModelDirectoryCache({ load: async (key: string) => {
    const context = JSON.parse(key) as { homeDir: string; native?: LocalAgentModelDirectoryData }
    if (context.native !== undefined) return context.native
    const [models, defaultModel] = await Promise.all([listKimiConfigModels(context.homeDir), readKimiDefaultModel(context.homeDir)])
    return {
      entries: models.map(value => ({ value, label: value, source: 'configuration' as const })),
      ...defaultModel === undefined ? {} : { defaultModel },
      complete: false, customInput: true,
      reason: 'Configured candidates; native session model metadata is not available yet',
    }
  } })

  constructor(private readonly context: (childSessionId?: string) => { homeDir: string; cwd?: string; native?: KimiNativeConfiguration }) {}

  private key(childSessionId?: string): string {
    const context = this.context(childSessionId)
    const stamp = modelDirectoryContextKey({ provider: 'kimi', homeDir: context.homeDir, cwd: context.cwd ?? context.homeDir, cli: ['kimi'], files: [join(context.homeDir, 'config.toml'), join(context.homeDir, 'credentials', 'kimi-code.json')] })
    return JSON.stringify({ homeDir: context.homeDir, stamp, childSessionId, ...context.native === undefined ? {} : { native: context.native.directory } })
  }

  read(childSessionId?: string): LocalAgentModelDirectory { return this.cache.read(this.key(childSessionId)) }
  refresh(childSessionId?: string): Promise<LocalAgentModelDirectory> { return this.cache.refresh(this.key(childSessionId)) }
  follow(childSessionId: string | undefined, signal: AbortSignal): AsyncIterable<LocalAgentModelDirectory> { return this.cache.follow(() => this.key(childSessionId), signal) }
  dispose(): void { this.cache.dispose() }
}
