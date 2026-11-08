/**
 * The settings-driven live-driver switch: owns the active driver generation
 * and retires old ones on a settings change, without a plugin reload.
 *
 * Toggle OFF (or unload): the retiring generation is DRAINED, not killed —
 * new rounds are refused (the provider's catch falls back to exec), in-flight
 * rounds finish on their runtime, idle runtimes are reclaimed at once.
 * Toggling ON builds the next generation lazily (no process until the first
 * round). Legacy granularity settings are ignored.
 *
 * @module @khorsheed/dsh-local-agent-kimi — internal, unit-tested directly.
 */

import type { KimiNativeConfiguration } from './model-catalog.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsFace } from '@khorsheed/dsh-local-agent'
import type { KimiEndpointAuth } from './endpoint-auth.ts'
import { KimiAcpLiveDriver } from './live-driver.ts'
import type { KimiLiveMirrorGranularity } from './live-driver.ts'

/** The resolved live settings (rc.1: volatile row config; 0.1.5: schema defaults ← YAML base ← user layer). */
export interface KimiLiveSettings {
  live: boolean
  liveMirrorGranularity: KimiLiveMirrorGranularity
  /** The configured model, when the card or the YAML base names one. */
  model?: string
  /** Model identifiers the card has saved before (its input's suggestions). */
  recentModels?: readonly string[]
}

export class LiveDriverSwitch {
  private liveOn = false
  private active: KimiAcpLiveDriver | undefined
  /** Retiring generations still draining their in-flight rounds. */
  private readonly draining = new Set<KimiAcpLiveDriver>()
  private readonly unwatch: () => void
  /**
   * Background tasks whose resident process a driver generation reclaimed
   * while they ran, per member (in memory: a host restart reads every
   * running task as `host-restart` instead). Kept across generations, so a
   * settings drain's reclaim is remembered too.
   */
  private readonly reclaimedTasks = new Map<string, Set<string>>()

  constructor(
    private readonly ctx: Context,
    face: SettingsFace<KimiLiveSettings>,
    private readonly liveIdleMs: number | undefined,
    /**
     * Per-spawn model resolver, handed to every driver generation. Member-aware:
     * the driver's runtime binds whatever the member's layers resolve to.
     */
    private readonly model?: (childSessionId: string) => string | undefined,
    /**
     * Per-spawn endpoint credential resolver, handed to every driver
     * generation: a resolution carrying a key authenticates the runtime
     * through the managed provider's `api_key_env` indirection (the key rides
     * the process env; the baseUrl is pinned by the pre-spawn surgery).
     */
    private readonly endpoint?: (scopeHome: string) => Promise<KimiEndpointAuth>,
  ) {
    this.apply(face.get())
    this.unwatch = face.watch((next) => { this.apply(next) })
  }

  /**
   * Resolve the live driver for one round's member (the provider's call
   * site). A retiring generation still hosting the member gates the new one —
   * the round falls back to exec rather than double-loading the same kimi
   * session into two processes.
   */
  readonly resolve = (childSessionId: string): KimiAcpLiveDriver | undefined => {
    if (this.active === undefined) return undefined
    for (const retiring of this.draining) {
      if (retiring.hasRuntime(childSessionId)) return undefined
    }
    return this.active
  }

  /** Mirror the resolved settings into the driver generation. */
  private apply(next: KimiLiveSettings): void {
    if (next.live === this.liveOn) {
      return
    }
    this.liveOn = next.live
    const retiring = this.active
    this.active = next.live
      ? new KimiAcpLiveDriver(this.ctx, {
        ...this.liveIdleMs === undefined ? {} : { liveIdleMs: this.liveIdleMs },
        ...this.model === undefined ? {} : { model: this.model },
        ...this.endpoint === undefined ? {} : { endpoint: this.endpoint },
        onReclaimedWithTasks: (childSessionId, taskIds) => { this.noteReclaimed(childSessionId, taskIds) },
      })
      : undefined
    if (retiring !== undefined) {
      this.draining.add(retiring)
      void retiring.drain().then(
        () => { this.draining.delete(retiring) },
        (error: unknown) => {
          this.draining.delete(retiring)
          this.ctx.logger.warn(`local-agent-kimi: live driver drain failed: ${error instanceof Error ? error.message : String(error)}`)
        },
      )
    }
  }

  /**
   * Retire one member's runtime on the ACTIVE generation (a composer-driven
   * model switch): the next round respawns onto the new model. A member still
   * hosted by a draining generation is left alone — its rounds already gate
   * to exec, and the drain reclaims the process.
   */
  async retireMemberRuntime(childSessionId: string): Promise<void> {
    await this.active?.retireRuntime(childSessionId)
  }

  /**
   * The model the member's active-generation runtime is bound to, or
   * undefined when no live runtime serves the member (the broker's
   * same-model no-op check).
   */
  memberRuntimeModel(childSessionId: string): string | undefined {
    return this.active?.runtimeModel(childSessionId)
  }

  /**
   * Whether the active generation hosts (or is spawning) the member's
   * runtime — the broker's retire decision needs this apart from the bound
   * model, since a runtime that bound NO model reports undefined either way.
   */
  memberHasRuntime(childSessionId: string): boolean {
    return this.active?.hasRuntime(childSessionId) ?? false
  }

  memberRuntimeConfiguration(childSessionId: string): KimiNativeConfiguration | undefined {
    for (const driver of [this.active, ...this.draining]) {
      const configuration = driver?.runtimeConfiguration(childSessionId)
      if (configuration !== undefined) return configuration
    }
    return undefined
  }

  private noteReclaimed(childSessionId: string, taskIds: readonly string[]): void {
    const known = this.reclaimedTasks.get(childSessionId) ?? new Set<string>()
    for (const id of taskIds) known.add(id)
    this.reclaimedTasks.set(childSessionId, known)
    // Noted first, so a read the report triggers already says `process-reclaimed`;
    // then the core tells the member's room (an older core lacks the hook).
    try {
      const registry = this.ctx.localAgent as { noteBackgroundTasksLost?: (child: string, ids: readonly string[], because: 'process-reclaimed') => void } | undefined
      if (typeof registry?.noteBackgroundTasksLost === 'function') registry.noteBackgroundTasksLost(childSessionId, taskIds, 'process-reclaimed')
    } catch (error) {
      this.ctx.logger.warn(`local-agent-kimi: reporting lost background tasks failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Whether a driver generation reclaimed the member's process while this
   * task ran in it (the task read's `lostBecause: 'process-reclaimed'`).
   */
  wasReclaimedWith(childSessionId: string, taskId: string): boolean {
    return this.reclaimedTasks.get(childSessionId)?.has(taskId) ?? false
  }

  /**
   * The task read's running tasks, handed to the generation hosting the
   * member: a change counts as activity there.
   * @returns the latest time the resident process is kept for them, or
   *   undefined (no resident process, nothing running).
   */
  observeBackgroundTasks(childSessionId: string, runningTaskIds: readonly string[]): number | undefined {
    for (const driver of [this.active, ...this.draining]) {
      if (driver?.hasRuntime(childSessionId) === true) return driver.observeBackgroundTasks(childSessionId, runningTaskIds)
    }
    return undefined
  }

  /** Plugin unload: interrupt whatever survives (disposeAll, not drain). */
  dispose(): void {
    this.unwatch()
    void this.active?.disposeAll()
    for (const retiring of this.draining) void retiring.disposeAll()
    this.draining.clear()
  }
}
