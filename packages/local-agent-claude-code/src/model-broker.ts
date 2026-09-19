/**
 * The claude-code harness's model broker: the family gateway routes
 * `harnessModel` / `memberModel` / `setMemberModel` here, and the broker
 * answers the family's fixed resolution order — the session-level override
 * (the composer's picker), the delegation's recorded model, the plugin-config
 * `model` key (the settings card), the scoped settings.json's own `model`,
 * and last the CLI's built-in default, which names nothing.
 *
 * The override map is IN-MEMORY by design (it deliberately does not survive a
 * host restart) and SHARED: index.ts hands the same map to the provider's and
 * the live driver's model resolvers, so a composer switch reaches the next
 * round through every drive. With the live driver on, switching to a
 * DIFFERENT model retires the member's resident runtime so the next round
 * respawns onto the new model — the CLI session itself resumes on disk, so
 * the conversation carries over. A switch while a round is in flight is
 * refused: retiring a runtime mid-round would kill the run.
 *
 * `lastObserved` (the cli-builtin layer's display hint): the delegation
 * record's `observedModel` answers when the live-settle channel reported
 * one; the member's own CLI transcript (`transcriptModel`, a bounded read of
 * the projects tree) is the history backstop for rounds that predate that
 * channel — read-only, TTL-cached, never a write into `delegations.jsonl`.
 *
 * @module @khorsheed/dsh-local-agent-claude-code/model-broker — internal, unit-tested directly.
 */

import { extendModelDirectory } from '@khorsheed/dsh-local-agent'
import type { LocalAgentRegistry, MemberConfigurationAdapter } from '@khorsheed/dsh-local-agent'
import type { LocalAgentModelBroker, LocalAgentModelInfo, LocalAgentModelSource, LocalAgentModelDirectory, LocalAgentMemberBinding, LocalAgentMemberConfiguration, LocalAgentResolvedConfiguration } from '@khorsheed/dsh-local-agent/types'
import { readClaudeConfiguredModel, readClaudeConfiguredEffort, writeClaudeScopedModel } from './provision.ts'
import type { LiveDriverSwitch } from './live-switch.ts'

/**
 * The scoped settings.json `model` key across live-spawn scratch writes. The
 * live driver writes a member's effective model into the file before a
 * resident spawn (a `--resume` respawn restores the session's stored model
 * over the `--model` flag), and this memory keeps the person's own configured
 * value straight across those writes: what the file held before our first
 * write is the `cli-config` layer, and a spawn with NO effective model
 * restores that value instead of leaking the previous member's model into
 * the next runtime. In-memory on purpose: a restart re-reads the file as it
 * stands. Writes serialize on an internal queue so concurrent member spawns
 * cannot lose each other's read-modify-write.
 */
export class ClaudeScopedModelMemory {
  /** The value we last scratched in and believe the file still holds. */
  private written: string | undefined
  /** What the file held before our first write; null = it named no model. */
  private previous: string | null = null
  private queue: Promise<unknown> = Promise.resolve()

  /**
   * Bring the scoped settings.json's `model` key to the effective model a
   * spawn is about to bind — writing it, or restoring the person's value when
   * the spawn binds none and the file still holds our earlier scratch.
   * @param homeDir - the scoped home the spawn runs against.
   * @param model - the spawn's effective model, or undefined for none.
   */
  provision(homeDir: string, model: string | undefined): Promise<void> {
    const run = this.queue.then(() => this.provisionLocked(homeDir, model))
    this.queue = run.catch(() => undefined)
    return run
  }

  /**
   * The person's configured model — the `cli-config` layer. A file value we
   * did not write reports as read; our own scratch value reports what the
   * file held before we wrote it.
   * @param homeDir - the scoped home to read.
   * @returns the person's configured model, or undefined when none.
   */
  async cliDefault(homeDir: string): Promise<string | undefined> {
    const file = await readClaudeConfiguredModel(homeDir)
    if (file !== this.written) {
      // Not our scratch (or absent): the person owns this value — adopt it.
      this.previous = file ?? null
      this.written = undefined
      return file
    }
    return this.previous ?? undefined
  }

  private async provisionLocked(homeDir: string, model: string | undefined): Promise<void> {
    const file = await readClaudeConfiguredModel(homeDir)
    if (file !== this.written) {
      // The file changed outside our last write (a person edit, or the first
      // observation): it is the person's value, and our scratch is gone.
      this.previous = file ?? null
      this.written = undefined
    }
    if (model === undefined) {
      if (this.written === undefined) return
      // The spawn binds no model: restore the person's value rather than
      // leaking the previous member's scratch into this runtime.
      await writeClaudeScopedModel(homeDir, this.previous ?? undefined)
      this.written = undefined
      return
    }
    if (file === model) return
    await writeClaudeScopedModel(homeDir, model)
    this.written = model
  }
}

/** Everything the broker reads that it does not own. */
export interface ClaudeModelBrokerDeps {
  /** The registry face for the in-flight check and the delegation record. */
  readonly localAgent: Pick<LocalAgentRegistry, 'isDelegationActive' | 'getDelegation'> & Partial<Pick<LocalAgentRegistry, 'setMemberModel'>>
  readonly configurationContext?: (binding: LocalAgentMemberBinding) => { home: string; directory: (refresh?: boolean) => LocalAgentModelDirectory | Promise<LocalAgentModelDirectory> }
  /** The settings layer: the plugin-config model, read per call. */
  readonly settingsModel: () => string | undefined
  /** The scoped settings.json's own model, minus live-spawn scratch writes. */
  readonly cliDefault: (childSessionId?: string) => Promise<string | undefined>
  readonly directory?: (childSessionId?: string, refresh?: boolean) => LocalAgentModelDirectory | Promise<LocalAgentModelDirectory>
  readonly followDirectory?: (childSessionId: string | undefined, signal: AbortSignal) => AsyncIterable<LocalAgentModelDirectory>
  /** Model identifiers the settings card saved before (the card's memory). */
  readonly recentModels: () => readonly string[]
  /** Whether the live driver is on for the member's rounds. */
  readonly live: () => boolean
  /** The session-level override map, shared with the round model resolvers. */
  readonly overrides: Map<string, string>
  /** The live-driver switch, for the hosting generation's retire on a switch. */
  readonly liveSwitch: Pick<LiveDriverSwitch, 'hostingDriver'>
  /**
   * The transcript backstop for `lastObserved`: read the model the member's
   * own CLI transcript names (its recorded cliSessionId), or — absent, the
   * settings card's memberless read — the newest transcript in the scoped
   * home's projects tree. Read-only history; never throws.
   */
  readonly transcriptModel: (cliSessionId?: string, childSessionId?: string) => Promise<string | undefined>
}

/** How long one transcript read-back answer is reused (repeated card opens). */
export const OBSERVED_MODEL_CACHE_TTL_MS = 60_000

export class ClaudeModelBroker implements LocalAgentModelBroker {
  constructor(private readonly deps: ClaudeModelBrokerDeps) {}

  configurationAdapter(binding: LocalAgentMemberBinding): MemberConfigurationAdapter {
    const context = this.deps.configurationContext?.(binding)
    if (context === undefined) throw new Error('Claude member configuration context is unavailable')
    const resolve = async (selection: LocalAgentMemberConfiguration): Promise<LocalAgentResolvedConfiguration> => {
      let directory = await context.directory()
      if (directory.status === 'loading') directory = await context.directory(true)
      const model = selection.model.mode === 'value' ? selection.model.value
        : (selection.model.mode === 'inherit' ? binding.model : undefined) ?? this.deps.settingsModel()
          ?? await readClaudeConfiguredModel(context.home) ?? directory.defaultModel
      const entry = directory.entries.find(entry => entry.value === model || entry.resolvedModel === model)
      const effort = (selection.effort.mode === 'value' ? selection.effort.value : selection.effort.mode === 'inherit' ? binding.effort : undefined)
        ?? await readClaudeConfiguredEffort(context.home) ?? entry?.reasoning?.default
      if (effort !== undefined && !entry?.reasoning?.options.some(option => option.value === effort)) {
        throw new Error('Claude has not advertised this reasoning effort for the selected model')
      }
      return { ...model === undefined ? {} : { model }, ...effort === undefined ? {} : { effort } }
    }
    const retire = async (): Promise<void> => { await this.deps.liveSwitch.hostingDriver(binding.childSessionId)?.retireRuntime(binding.childSessionId) }
    return {
      validate: async selection => { await resolve(selection) }, prepare: resolve,
      apply: async selection => { const resolved = await resolve(selection); await retire(); return resolved },
      reconcile: async state => {
        if (this.deps.localAgent.isDelegationActive(binding.childSessionId)) return { active: true, matches: 'unknown', resolved: {} }
        await retire()
        return { active: false, matches: 'current', resolved: await resolve(state.current.selection) }
      },
    }
  }

  async modelDirectory(childSessionId?: string, refresh = false): Promise<LocalAgentModelDirectory> {
    if (refresh) await this.deps.directory?.(childSessionId, true)
    const info = await this.modelInfo(childSessionId, childSessionId === undefined ? undefined : this.deps.localAgent.getDelegation(childSessionId)?.model)
    return info.directory ?? { entries: [], complete: false, customInput: true, status: 'unsupported', refreshing: false, revision: 0 }
  }

  async *followModelDirectory(childSessionId: string | undefined, signal: AbortSignal): AsyncIterable<LocalAgentModelDirectory> {
    if (this.deps.followDirectory === undefined) { yield await this.modelDirectory(childSessionId); return }
    for await (const _snapshot of this.deps.followDirectory(childSessionId, signal)) yield await this.modelDirectory(childSessionId)
  }

  /**
   * The `lastObserved` cache: childSessionId (empty key = the memberless
   * harness read) → the answer and when it was read. A miss is cached too —
   * a member with no transcript yet should not pay a rescan per card open.
   */
  private readonly observedCache = new Map<string, { at: number; model: string | undefined }>()

  /**
   * The last model the member (or the harness) was observed running. The
   * live-settle channel is primary — a record whose latest round reported
   * `observedModel` answers without touching disk; the CLI's own transcripts
   * are the history backstop for every round that predates it.
   */
  private async lastObserved(childSessionId?: string): Promise<string | undefined> {
    const record = childSessionId === undefined ? undefined : this.deps.localAgent.getDelegation(childSessionId)
    if (childSessionId !== undefined && record === undefined) return undefined
    if (record?.observedModel !== undefined && record.observedModel.trim() !== '') return record.observedModel
    const key = childSessionId ?? ''
    const hit = this.observedCache.get(key)
    if (hit !== undefined && Date.now() - hit.at < OBSERVED_MODEL_CACHE_TTL_MS) return hit.model
    const model = await this.deps.transcriptModel(record?.cliSessionId, childSessionId).catch(() => undefined)
    this.observedCache.set(key, { at: Date.now(), model })
    return model
  }

  /**
   * Read the model surface in the family's fixed order. Without a member the
   * override and delegation layers stay absent — the settings card's "what
   * would a round run with" read.
   */
  async modelInfo(childSessionId?: string, delegationModel?: string): Promise<LocalAgentModelInfo> {
    const override = childSessionId === undefined ? undefined : this.deps.overrides.get(childSessionId)
    const delegation = delegationModel?.trim() === '' ? undefined : delegationModel?.trim()
    const settings = this.deps.settingsModel()
    const cliDefault = await this.deps.cliDefault(childSessionId)
    const native = await this.deps.directory?.(childSessionId)
    const [effective, source]: [string | undefined, LocalAgentModelSource] = override !== undefined
      ? [override, 'override']
      : delegation !== undefined
        ? [delegation, 'delegation']
        : settings !== undefined
          ? [settings, 'settings']
          : cliDefault !== undefined
            ? [cliDefault, 'cli-config']
            : [native?.defaultModel, 'cli-builtin']
    // Native candidates plus labelled configuration and historical suggestions.
    const choices = [...new Set([settings, cliDefault, ...native?.entries.filter(entry => !entry.hidden).map(entry => entry.value) ?? [], ...this.deps.recentModels()]
      .filter((value): value is string => value !== undefined))]
    const lastObserved = await this.lastObserved(childSessionId)
    const active = childSessionId !== undefined && this.deps.localAgent.isDelegationActive(childSessionId)
    return {
      ...effective === undefined ? {} : { effective },
      source,
      ...override === undefined ? {} : { override },
      ...delegation === undefined ? {} : { delegation },
      ...settings === undefined ? {} : { settings },
      ...cliDefault === undefined ? {} : { cliDefault },
      ...lastObserved === undefined ? {} : { lastObserved },
      choices,
      ...native === undefined ? {} : { directory: extendModelDirectory(native, [settings, cliDefault], [...this.deps.recentModels(), lastObserved]) },
      live: this.deps.live(),
      switchable: !active,
      ...active
        ? { reason: '该成员有进行中的委派轮次，等其完成后再切换模型 (a delegation round is in flight)' }
        : {},
    }
  }

  /**
   * Set or clear a member's session-level override. Throws while a round is
   * in flight for the member; a same-model set is a no-op; a real change
   * retires the member's resident runtime when its bound model is no longer
   * what the next round would spawn with (the CLI session resumes on the
   * respawn, so the conversation carries over).
   */
  async setMemberModel(childSessionId: string, model: string | undefined): Promise<void> {
    if (this.deps.localAgent.setMemberModel !== undefined) return this.deps.localAgent.setMemberModel(childSessionId, model)
    if (this.deps.localAgent.isDelegationActive(childSessionId)) {
      throw new Error(
        `subagent-claude: 成员 ${childSessionId} 有进行中的委派轮次，等其完成后再切换模型 `
        + '(a delegation round is in flight for this member)',
      )
    }
    const trimmed = model?.trim()
    const next = trimmed === undefined || trimmed === '' ? undefined : trimmed
    if (next === this.deps.overrides.get(childSessionId)) return
    if (next === undefined) this.deps.overrides.delete(childSessionId)
    else this.deps.overrides.set(childSessionId, next)
    // What the next spawn would bind, in the round resolvers' own order.
    const delegation = this.deps.localAgent.getDelegation(childSessionId)?.model?.trim()
    const spawnModel = next ?? (delegation === undefined || delegation === '' ? undefined : delegation) ?? this.deps.settingsModel()
    const host = this.deps.liveSwitch.hostingDriver(childSessionId)
    if (host !== undefined && host.runtimeModel(childSessionId) !== spawnModel) {
      await host.retireRuntime(childSessionId)
    }
  }
}
