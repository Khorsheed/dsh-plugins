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

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { KimiAcpLiveDriver } from './live-driver.ts'
import type { KimiLiveMirrorGranularity } from './live-driver.ts'

/** The resolved live settings (schema defaults ← YAML base ← user layer). */
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

  constructor(
    private readonly ctx: Context,
    scope: SettingsScope<KimiLiveSettings>,
    private readonly liveIdleMs: number | undefined,
    /**
     * Per-spawn model resolver, handed to every driver generation. Member-aware:
     * the driver's runtime binds whatever the member's layers resolve to.
     */
    private readonly model?: (childSessionId: string) => string | undefined,
  ) {
    this.apply(scope.get())
    this.unwatch = scope.watch((next) => { this.apply(next) })
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

  /** Plugin unload: interrupt whatever survives (disposeAll, not drain). */
  dispose(): void {
    this.unwatch()
    void this.active?.disposeAll()
    for (const retiring of this.draining) void retiring.disposeAll()
    this.draining.clear()
  }
}
