/**
 * The kimi harness's model broker: the member/harness model surface the
 * family gateway routes to (`harnessModel` for the settings card,
 * `memberModel`/`setMemberModel` for the composer picker). Resolution follows
 * the family's fixed order — the session-level override (the composer's
 * picker write) first, then the delegation's recorded model, then the
 * plugin-config `model` key, then the scoped config's own `default_model`,
 * and last the CLI's built-in default, which names nothing.
 *
 * Per-member state is IN MEMORY by design: the session-level override is a
 * composer gesture that deliberately does not survive a host restart, and the
 * start-model ledger only mirrors what the delegation records already persist
 * (the core hands the recorded value back as `delegationModel` on reads).
 * The spawn side of a switch is lazy: `setMemberModel` retires the member's
 * resident runtime when its bound model no longer matches, and the member's
 * next round respawns onto the new model, `session/load`-ing the same CLI
 * session — the conversation carries over, the process fact changes.
 * @module @khorsheed/dsh-local-agent-kimi/model-broker
 */

import { extendModelDirectory } from '@khorsheed/dsh-local-agent'
import type { MemberConfigurationAdapter } from '@khorsheed/dsh-local-agent'
import type { LocalAgentMemberBinding, LocalAgentMemberConfiguration, LocalAgentResolvedConfiguration } from '@khorsheed/dsh-local-agent/types'
import { readKimiModelConfiguration } from './model-configuration.ts'
import type { KimiModelCatalog } from './model-catalog.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { LocalAgentModelBroker, LocalAgentModelInfo, LocalAgentModelDirectory } from '@khorsheed/dsh-local-agent/types'
import type { LiveDriverSwitch } from './live-switch.ts'
import { listKimiConfigModels, readKimiDefaultModel } from './provision.ts'

/** The refusal a mid-round switch gets (in flight = the runtime must not die). */
const SWITCH_IN_FLIGHT_REASON = '该成员有进行中的委派轮次，等其完成后再切换模型'

/** Dedupe a candidate list, dropping blanks and keeping first-seen order. */
function dedupe(candidates: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const candidate of candidates) {
    const value = candidate?.trim()
    if (value === undefined || value === '' || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

/**
 * The kimi harness's {@link LocalAgentModelBroker}. Also the provider-facing
 * member-model ledger: the provider records each delegation's start model
 * here and reads the session-level override for its exec-path resolution, so
 * the picker write reaches the very next round on either driver.
 */
export class KimiModelBroker implements LocalAgentModelBroker {
  /** Session-level overrides per member (the composer picker's writes). */
  private readonly overrides = new Map<string, string>()
  /** Each member's START model — the model its delegation's first round named. */
  private readonly startModels = new Map<string, string>()

  /**
   * @param ctx - plugin context carrying the family registry (the in-flight
   *   read behind `switchable`).
   * @param deps - the harness's live readers: the scoped home, the settings
   *   layer, the card's recent-model memory, the live toggle, and the driver
   *   switch a switch retires runtimes through.
   */
  constructor(
    private readonly ctx: Context,
    private readonly deps: {
      /** The default scope's scoped home (cliDefault + discovery reads). */
      homeDir: (childSessionId?: string) => string
      catalog?: KimiModelCatalog
      /** The plugin-config `model` key, resolved per read. */
      settingsModel: () => string | undefined
      /** The settings card's recently saved identifiers (choices memory). */
      recentModels: () => readonly string[]
      /** Whether the live driver is currently on. */
      isLive: () => boolean
      /** The driver generations a model switch retires a member runtime through. */
      liveSwitch: LiveDriverSwitch
    },
  ) {}

  configurationAdapter(binding: LocalAgentMemberBinding): MemberConfigurationAdapter {
    const home = this.ctx.localAgent.homeDir('kimi', binding.scope)
    const resolve = async (selection: LocalAgentMemberConfiguration): Promise<LocalAgentResolvedConfiguration> => {
      const model = selection.model.mode === 'value' ? selection.model.value
        : (selection.model.mode === 'inherit' ? binding.model : undefined) ?? this.deps.settingsModel() ?? await readKimiDefaultModel(home)
      const configured = await readKimiModelConfiguration(home, model)
      const native = this.deps.liveSwitch.memberRuntimeConfiguration(binding.childSessionId)
      const entry = native?.directory.entries.find(entry => entry.value === model)
        ?? configured.entries.find(entry => entry.value === model)
      const effort = (selection.effort.mode === 'value' ? selection.effort.value : selection.effort.mode === 'inherit' ? binding.effort : undefined) ?? configured.effort
      if (effort !== undefined && entry?.reasoning !== undefined && !entry.reasoning.options.some(option => option.value === effort)) {
        throw new Error('Kimi has not advertised this reasoning effort for the selected model')
      }
      if (!this.deps.isLive() && effort !== undefined && configured.protocol !== 'kimi') {
        throw new Error('This model protocol has no Kimi exec effort override; use ACP live mode')
      }
      return { ...model === undefined ? {} : { model }, ...effort === undefined ? {} : { effort } }
    }
    return {
      validate: async selection => { await resolve(selection) }, prepare: resolve,
      apply: async selection => { const resolved = await resolve(selection); await this.deps.liveSwitch.retireMemberRuntime(binding.childSessionId); return resolved },
      reconcile: async state => {
        if (this.ctx.localAgent.isDelegationActive(binding.childSessionId)) return { active: true, matches: 'unknown', resolved: {} }
        await this.deps.liveSwitch.retireMemberRuntime(binding.childSessionId)
        return { active: false, matches: 'current', resolved: await resolve(state.current.selection) }
      },
    }
  }

  async modelDirectory(childSessionId?: string, refresh = false): Promise<LocalAgentModelDirectory> {
    if (refresh) await this.deps.catalog?.refresh(childSessionId)
    const info = await this.modelInfo(childSessionId)
    return info.directory ?? { entries: [], complete: false, customInput: true, status: 'unsupported', refreshing: false, revision: 0 }
  }

  async *followModelDirectory(childSessionId: string | undefined, signal: AbortSignal): AsyncIterable<LocalAgentModelDirectory> {
    if (this.deps.catalog === undefined) { yield await this.modelDirectory(childSessionId); return }
    for await (const _snapshot of this.deps.catalog.follow(childSessionId, signal)) yield await this.modelDirectory(childSessionId)
  }

  /**
   * Record the model a member's delegation STARTED with (the provider's call
   * site, fresh and resume rounds alike). The live driver's spawn resolver
   * ranks it between the override and the settings layer.
   */
  noteStartModel(childSessionId: string, model: string): void {
    const value = model.trim()
    if (value !== '') this.startModels.set(childSessionId, value)
  }

  /**
   * The member's session-level override, when the composer picker set one —
   * the exec path's top layer (it outranks even the delegation's recorded
   * model, so the provider folds it into the requested slot).
   */
  overrideFor(childSessionId: string): string | undefined {
    return this.overrides.get(childSessionId)
  }

  /**
   * The member's spawn-binding resolver (the live driver config): override,
   * then the member's start model, then the settings layer. Undefined writes
   * nothing — the scoped config's own `default_model` decides, as it always
   * did.
   */
  readonly spawnModel = (childSessionId: string): string | undefined =>
    this.overrideFor(childSessionId)
    ?? this.startModels.get(childSessionId)
    ?? this.deps.settingsModel()

  /**
   * Read the model surface. With no member this is the harness default (the
   * settings card's "what would a round run with"): override and delegation
   * stay absent by construction.
   */
  async modelInfo(childSessionId?: string, delegationModel?: string): Promise<LocalAgentModelInfo> {
    const override = childSessionId === undefined ? undefined : this.overrideFor(childSessionId)
    const delegation = childSessionId === undefined
      ? undefined
      : delegationModel ?? this.startModels.get(childSessionId)
    const settings = this.deps.settingsModel()
    const homeDir = this.deps.homeDir(childSessionId)
    const native = this.deps.catalog?.read(childSessionId)
    const [cliDefault, discovered] = await Promise.all([
      readKimiDefaultModel(homeDir).catch(() => undefined),
      listKimiConfigModels(homeDir).catch(() => [] as string[]),
    ])
    const choices = dedupe([settings, cliDefault, ...discovered, ...(native?.entries.filter(entry => !entry.hidden).map(entry => entry.value) ?? []), ...this.deps.recentModels()])
    const [effective, source] = override !== undefined ? [override, 'override' as const]
      : delegation !== undefined ? [delegation, 'delegation' as const]
        : settings !== undefined ? [settings, 'settings' as const]
          : cliDefault !== undefined ? [cliDefault, 'cli-config' as const]
            : [undefined, 'cli-builtin' as const]
    const inFlight = childSessionId !== undefined
      && this.ctx.localAgent.activeDelegations().includes(childSessionId)
    return {
      ...effective === undefined ? {} : { effective },
      source,
      ...override === undefined ? {} : { override },
      ...delegation === undefined ? {} : { delegation },
      ...settings === undefined ? {} : { settings },
      ...cliDefault === undefined ? {} : { cliDefault },
      choices,
      ...native === undefined ? {} : { directory: extendModelDirectory(native, [settings, cliDefault, ...discovered], this.deps.recentModels()) },
      live: this.deps.isLive(),
      switchable: !inFlight,
      ...inFlight ? { reason: SWITCH_IN_FLIGHT_REASON } : {},
    }
  }

  /**
   * Set (or clear) the member's session-level override. Throws while a round
   * is in flight for the member — the switch retires the resident runtime,
   * and retiring mid-round would kill the run. A same-value set (or clearing
   * an unset override) is a no-op; otherwise a live runtime whose bound model
   * differs from the new effective model is retired so the next round
   * respawns onto it, resuming the same CLI session.
   */
  async setMemberModel(childSessionId: string, model: string | undefined): Promise<void> {
    if (typeof this.ctx.localAgent.setMemberModel === 'function') return this.ctx.localAgent.setMemberModel(childSessionId, model)
    if (this.ctx.localAgent.activeDelegations().includes(childSessionId)) {
      throw new Error(SWITCH_IN_FLIGHT_REASON)
    }
    const value = model?.trim()
    const previous = this.overrides.get(childSessionId)
    if (value === undefined || value === '') {
      if (previous === undefined) return
      this.overrides.delete(childSessionId)
    } else {
      if (previous === value) return
      this.overrides.set(childSessionId, value)
    }
    // Retire only when the runtime's bound model no longer matches what the
    // member's next round resolves to — a same-model switch keeps the process.
    const effective = (await this.modelInfo(childSessionId)).effective
    if (
      this.deps.liveSwitch.memberHasRuntime(childSessionId)
      && this.deps.liveSwitch.memberRuntimeModel(childSessionId) !== effective
    ) {
      await this.deps.liveSwitch.retireMemberRuntime(childSessionId)
    }
  }
}
