import type { LlmModelInfo, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { ModelDirectoryCache } from '@khorsheed/dsh-local-agent'
import type { LocalAgentModelDirectory, LocalAgentModelDirectoryData, LocalAgentModelEntry } from '@khorsheed/dsh-local-agent/types'

export interface DshModelDirectoryFace {
  listProviders(): readonly { id: string }[]
  listModels(provider: string): Promise<readonly LlmModelInfo[]>
  resolveModelInfo?(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>
}

/** The public host adapter catalog used by sub-DSH provisioning. No generation request. */
export class DshModelCatalog {
  private readonly cache: ModelDirectoryCache
  constructor(private readonly deps: {
    llm: () => DshModelDirectoryFace | undefined
    defaultModel: () => string | undefined
    timeoutMs?: number
  }) {
    this.cache = new ModelDirectoryCache({ load: async (_key, signal) => {
      const controller = new AbortController()
      const abort = (): void => controller.abort()
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          this.discover(controller.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new Error('DSH model directory timed out')) }, deps.timeoutMs ?? 5_000)
            timer.unref()
          }),
        ])
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        signal.removeEventListener('abort', abort)
      }
    } })
  }

  private key(): string { return JSON.stringify({ defaultModel: this.deps.defaultModel() }) }
  read(): LocalAgentModelDirectory { return this.cache.read(this.key()) }
  refresh(): Promise<LocalAgentModelDirectory> { return this.cache.refresh(this.key()) }
  follow(signal: AbortSignal): AsyncIterable<LocalAgentModelDirectory> { return this.cache.follow(() => this.key(), signal) }
  invalidate(): void { this.cache.invalidate(this.key()) }
  dispose(): void { this.cache.dispose() }

  private async discover(signal: AbortSignal): Promise<LocalAgentModelDirectoryData> {
    const llm = this.deps.llm()
    if (llm === undefined || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') {
      return { entries: [], complete: false, customInput: true, unsupported: true, reason: 'The host exposes no adapter model directory' }
    }
    const providers = llm.listProviders()
    const groups = await Promise.allSettled(providers.map(async provider => Promise.all((await llm.listModels(provider.id)).map(async model => {
      let resolved: LlmResolvedModelInfo | undefined
      try { resolved = await llm.resolveModelInfo?.(provider.id, model.id, signal) } catch { /* Unknown capabilities stay unknown. */ }
      const entry: LocalAgentModelEntry = {
        value: `${provider.id}/${model.id}`, label: model.name ?? model.id, source: 'native',
        ...model.description === undefined ? {} : { description: model.description },
        ...resolved === undefined ? {} : { resolvedModel: `${resolved.provider}/${resolved.id}` },
        ...resolved?.reasoning === undefined ? {} : { reasoning: {
          options: resolved.reasoning.efforts.map(effort => ({ value: String(effort.id), label: effort.name, ...effort.description === undefined ? {} : { description: effort.description } })),
          ...resolved.reasoning.defaultEffort === undefined ? {} : { default: String(resolved.reasoning.defaultEffort) },
        } },
      }
      return entry
    }))))
    const failed = groups.filter(group => group.status === 'rejected').length
    if (failed > 0 && failed === groups.length) throw new Error('DSH adapters could not list models')
    const entries = groups.flatMap(group => group.status === 'fulfilled' ? group.value : [])
    const defaultModel = this.deps.defaultModel()
    return {
      entries, complete: failed === 0, customInput: true,
      ...defaultModel === undefined ? {} : { defaultModel },
      ...failed === 0 ? {} : { reason: `${failed} adapter model list(s) unavailable` },
    }
  }
}
