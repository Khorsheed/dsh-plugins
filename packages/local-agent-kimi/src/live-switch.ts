/**
 * The settings-driven live-driver switch: owns the active driver generation
 * and retires old ones on a settings change, without a plugin reload.
 *
 * Toggle OFF (or unload): the retiring generation is DRAINED, not killed —
 * new rounds are refused (the provider's catch falls back to exec), in-flight
 * rounds finish on their runtime, idle runtimes are reclaimed at once.
 * Toggling ON builds the next generation lazily (no process until the first
 * round). A granularity change needs no generation swap: the driver reads it
 * per round (`setLiveMirrorGranularity`).
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
      this.active?.setLiveMirrorGranularity(next.liveMirrorGranularity)
      return
    }
    this.liveOn = next.live
    const retiring = this.active
    this.active = next.live
      ? new KimiAcpLiveDriver(this.ctx, {
        ...this.liveIdleMs === undefined ? {} : { liveIdleMs: this.liveIdleMs },
        liveMirrorGranularity: next.liveMirrorGranularity,
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

  /** Plugin unload: interrupt whatever survives (disposeAll, not drain). */
  dispose(): void {
    this.unwatch()
    void this.active?.disposeAll()
    for (const retiring of this.draining) void retiring.disposeAll()
    this.draining.clear()
  }
}
