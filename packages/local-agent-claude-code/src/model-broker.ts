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
 * @module @khorsheed/dsh-local-agent-claude-code/model-broker — internal, unit-tested directly.
 */

import type { LocalAgentRegistry } from '@khorsheed/dsh-local-agent'
import type { LocalAgentModelBroker, LocalAgentModelInfo, LocalAgentModelSource } from '@khorsheed/dsh-local-agent/types'
import { readClaudeConfiguredModel, writeClaudeScopedModel } from './provision.ts'
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
  readonly localAgent: Pick<LocalAgentRegistry, 'isDelegationActive' | 'getDelegation'>
  /** The settings layer: the plugin-config model, read per call. */
  readonly settingsModel: () => string | undefined
  /** The scoped settings.json's own model, minus live-spawn scratch writes. */
  readonly cliDefault: () => Promise<string | undefined>
  /** Model identifiers the settings card saved before (the card's memory). */
  readonly recentModels: () => readonly string[]
  /** Whether the live driver is on for the member's rounds. */
  readonly live: () => boolean
  /** The session-level override map, shared with the round model resolvers. */
  readonly overrides: Map<string, string>
  /** The live-driver switch, for the hosting generation's retire on a switch. */
  readonly liveSwitch: Pick<LiveDriverSwitch, 'hostingDriver'>
}

export class ClaudeModelBroker implements LocalAgentModelBroker {
  constructor(private readonly deps: ClaudeModelBrokerDeps) {}

  /**
   * Read the model surface in the family's fixed order. Without a member the
   * override and delegation layers stay absent — the settings card's "what
   * would a round run with" read.
   */
  async modelInfo(childSessionId?: string, delegationModel?: string): Promise<LocalAgentModelInfo> {
    const override = childSessionId === undefined ? undefined : this.deps.overrides.get(childSessionId)
    const delegation = delegationModel?.trim() === '' ? undefined : delegationModel?.trim()
    const settings = this.deps.settingsModel()
    const cliDefault = await this.deps.cliDefault()
    const [effective, source]: [string | undefined, LocalAgentModelSource] = override !== undefined
      ? [override, 'override']
      : delegation !== undefined
        ? [delegation, 'delegation']
        : settings !== undefined
          ? [settings, 'settings']
          : cliDefault !== undefined
            ? [cliDefault, 'cli-config']
            : [undefined, 'cli-builtin']
    // The pickable vocabulary: what the layers name plus what the card saved
    // before. No catalog is hardcoded anywhere in this plugin — claude's own
    // config names no further models, so discovery ends at the scoped file.
    const choices = [...new Set([settings, cliDefault, ...this.deps.recentModels()]
      .filter((value): value is string => value !== undefined))]
    const active = childSessionId !== undefined && this.deps.localAgent.isDelegationActive(childSessionId)
    return {
      ...effective === undefined ? {} : { effective },
      source,
      ...override === undefined ? {} : { override },
      ...delegation === undefined ? {} : { delegation },
      ...settings === undefined ? {} : { settings },
      ...cliDefault === undefined ? {} : { cliDefault },
      choices,
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
