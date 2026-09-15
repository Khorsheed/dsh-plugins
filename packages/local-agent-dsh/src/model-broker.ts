/**
 * The dsh harness's model broker: the member-aware model surface the core
 * gateway routes to (`harnessModel` for the settings card, `memberModel` /
 * `setMemberModel` for the composer picker). It owns the session-level
 * override map — shared with the exec provider (which consults it per round)
 * and the live driver (which binds it at runtime spawn) — and retires a
 * member's resident serve process when a switch leaves it bound to a
 * different model, so the NEXT round respawns onto the new one while the
 * sub-dsh session itself carries over via the on-disk resume.
 *
 * Resolution order is the family's fixed one (first match wins): override →
 * the delegation's recorded model → the plugin-config `model` (settings) →
 * the host instance's default model selection spelled `provider/model`
 * (cliDefault — the selection a sub-dsh with no `--model` inherits) → the
 * CLI's built-in default, which names nothing. The pickable vocabulary is
 * settings + cliDefault + the host's own adapter enumeration (the public
 * `ctx.llm` surface — `listProviders` × `listModels`, spelled `provider/model`
 * exactly as the sub-dsh's `--model` expects; the same trio the host's model
 * picker is built on) + the card's recent-model memory.
 * @module @khorsheed/dsh-local-agent-dsh/model-broker
 */

import { extendModelDirectory } from '@khorsheed/dsh-local-agent'
import type { MemberConfigurationAdapter } from '@khorsheed/dsh-local-agent'
import type { DshModelCatalog } from './model-catalog.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { LocalAgentModelBroker, LocalAgentModelInfo, LocalAgentModelDirectory, LocalAgentMemberBinding, LocalAgentMemberConfiguration, LocalAgentResolvedConfiguration } from '@khorsheed/dsh-local-agent/types'

/** Everything the broker reads or drives, injected so the unit specs stay small. */
export interface DshModelBrokerDeps {
  /** Host context carrying the family registry (in-flight reads, delegation records). */
  readonly ctx: Context
  /** The plugin-config `model` resolver — the settings layer, blank reads unset. */
  readonly settingsModel: () => string | undefined
  /**
   * The host instance's default model selection spelled `provider/model` —
   * what a round with no `--model` inherits. Undefined when the service or
   * the selection is unreadable (absence is the honest answer, never a guess).
   */
  readonly cliDefault: () => string | undefined
  readonly defaultEffort?: () => string | undefined
  /**
   * The host's adapter enumeration spelled `provider/model` — discovered
   * host-side via `ctx.llm` and cached by the caller (refreshed on
   * `llm/adapters-updated`), so this read stays synchronous. Empty when the
   * service is absent: the other choice layers still answer.
   */
  readonly discovered: () => readonly string[]
  readonly catalog?: DshModelCatalog
  /** The card's recent-model memory (the suggestion vocabulary's tail). */
  readonly recentModels: () => readonly string[]
  /** Whether the live driver is on (the member's rounds bind resident runtimes). */
  readonly live: () => boolean
  /**
   * The session-level overrides this broker owns. Shared by reference with the
   * exec provider's per-round resolution and the live driver's spawn binding,
   * so a switch reaches every path without a reload.
   */
  readonly overrides: Map<string, string>
  /**
   * The model the member's live runtime bound at spawn: the identifier,
   * undefined for "bound to no model", null for "no live runtime".
   */
  readonly liveBoundModel: (childSessionId: string) => string | undefined | null
  /** Retire the member's live runtime; the next round respawns onto the new model. */
  readonly retireRuntime: (childSessionId: string) => Promise<void>
}

/** Dedupe the choice vocabulary, dropping unset layers and blanks. */
function dedupeChoices(layers: ReadonlyArray<string | undefined>): string[] {
  const seen = new Set<string>()
  const choices: string[] = []
  for (const layer of layers) {
    const value = layer?.trim()
    if (value === undefined || value === '' || seen.has(value)) continue
    seen.add(value)
    choices.push(value)
  }
  return choices
}

export class DshModelBroker implements LocalAgentModelBroker {
  constructor(private readonly deps: DshModelBrokerDeps) {}

  configurationAdapter(binding: LocalAgentMemberBinding): MemberConfigurationAdapter {
    const resolve = async (selection: LocalAgentMemberConfiguration): Promise<LocalAgentResolvedConfiguration> => {
      let directory = this.deps.catalog?.read()
      if (directory?.status === 'loading') directory = await this.deps.catalog?.refresh()
      const model = selection.model.mode === 'value' ? selection.model.value
        : (selection.model.mode === 'inherit' ? binding.model : undefined) ?? this.deps.settingsModel() ?? this.deps.cliDefault()
      const entry = directory?.entries.find(entry => entry.value === model)
      const requested = selection.effort.mode === 'value' ? selection.effort.value : selection.effort.mode === 'inherit' ? binding.effort : undefined
      const effort = requested ?? this.deps.defaultEffort?.() ?? entry?.reasoning?.default
      if (effort !== undefined && !entry?.reasoning?.options.some(option => option.value === effort)) {
        throw new Error('DSH has not advertised this reasoning effort for the selected model')
      }
      return { ...model === undefined ? {} : { model }, ...effort === undefined ? {} : { effort } }
    }
    return {
      validate: async selection => { await resolve(selection) }, prepare: resolve,
      apply: async selection => { const resolved = await resolve(selection); await this.deps.retireRuntime(binding.childSessionId); return resolved },
      reconcile: async state => {
        if (this.activeDelegations().includes(binding.childSessionId)) return { active: true, matches: 'unknown', resolved: {} }
        await this.deps.retireRuntime(binding.childSessionId)
        return { active: false, matches: 'current', resolved: await resolve(state.current.selection) }
      },
    }
  }

  async modelDirectory(childSessionId?: string, refresh = false): Promise<LocalAgentModelDirectory> {
    if (refresh) await this.deps.catalog?.refresh()
    return this.modelInfo(childSessionId).directory ?? { entries: [], complete: false, customInput: true, status: 'unsupported', refreshing: false, revision: 0 }
  }

  async *followModelDirectory(childSessionId: string | undefined, signal: AbortSignal): AsyncIterable<LocalAgentModelDirectory> {
    if (this.deps.catalog === undefined) { yield await this.modelDirectory(childSessionId); return }
    for await (const _snapshot of this.deps.catalog.follow(signal)) yield await this.modelDirectory(childSessionId)
  }

  /** The member's in-flight rounds (an empty answer on a core that predates the read). */
  private activeDelegations(): readonly string[] {
    const registry = this.deps.ctx.localAgent as unknown as {
      activeDelegations?: () => readonly string[]
    }
    return typeof registry.activeDelegations === 'function' ? registry.activeDelegations() : []
  }

  /** The model the member's NEXT spawn binds explicitly: override → recorded → settings. */
  private boundLayer(childSessionId: string): string | undefined {
    const override = this.deps.overrides.get(childSessionId)
    if (override !== undefined) return override
    const record = this.deps.ctx.localAgent.getDelegation(childSessionId)
    const recorded = record?.model?.trim()
    if (recorded !== undefined && recorded !== '') return recorded
    return this.deps.settingsModel()
  }

  /** Read the model surface; every layer reports its own value so a UI can explain the effective one. */
  modelInfo(childSessionId?: string, delegationModel?: string): LocalAgentModelInfo {
    const settings = this.deps.settingsModel()
    const cliDefault = this.deps.cliDefault()
    const directory = this.deps.catalog?.read()
    const override = childSessionId === undefined ? undefined : this.deps.overrides.get(childSessionId)
    const delegation = delegationModel?.trim() === '' ? undefined : delegationModel
    const effective = override ?? delegation ?? settings ?? cliDefault
    const source = override !== undefined ? 'override'
      : delegation !== undefined ? 'delegation'
        : settings !== undefined ? 'settings'
          : cliDefault !== undefined ? 'cli-config' : 'cli-builtin'
    const inFlight = childSessionId !== undefined && this.activeDelegations().includes(childSessionId)
    return {
      ...effective === undefined ? {} : { effective },
      source,
      ...override === undefined ? {} : { override },
      ...delegation === undefined ? {} : { delegation },
      ...settings === undefined ? {} : { settings },
      ...cliDefault === undefined ? {} : { cliDefault },
      ...directory === undefined ? {} : { directory: extendModelDirectory(directory, [settings, cliDefault], this.deps.recentModels()) },
      choices: dedupeChoices([settings, cliDefault, ...this.deps.discovered(), ...this.deps.recentModels()]),
      live: this.deps.live(),
      switchable: !inFlight,
      ...inFlight ? { reason: '成员有进行中的委派轮次，等其完成后再切换模型' } : {},
    }
  }

  /**
   * Set (or clear) the member's session-level override. Same-model is a
   * no-op; a different model with a live runtime bound elsewhere retires the
   * runtime so the next round respawns (the sub-dsh session resumes from
   * disk). Throws while a round is in flight — retiring mid-round would kill
   * the run.
   */
  async setMemberModel(childSessionId: string, model: string | undefined): Promise<void> {
    if (typeof this.deps.ctx.localAgent.setMemberModel === 'function') return this.deps.ctx.localAgent.setMemberModel(childSessionId, model)
    if (this.activeDelegations().includes(childSessionId)) {
      throw new Error(`subagent-dsh: 成员有进行中的委派轮次，等其完成后再切换模型 (child session ${childSessionId})`)
    }
    const trimmed = model?.trim()
    const next = trimmed === undefined || trimmed === '' ? undefined : trimmed
    if (this.deps.overrides.get(childSessionId) === next) return
    if (next === undefined) this.deps.overrides.delete(childSessionId)
    else this.deps.overrides.set(childSessionId, next)
    const bound = this.deps.liveBoundModel(childSessionId)
    if (bound !== null && bound !== this.boundLayer(childSessionId)) {
      await this.deps.retireRuntime(childSessionId)
    }
  }
}
