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
 * @module @khorsheed/dsh-local-agent-claude-code — internal, unit-tested directly.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { Config } from './index.ts'
import { ClaudeLiveDriver } from './live-driver.ts'
import type { ClaudeLiveMirrorGranularity } from './live-driver.ts'

/** The resolved live settings (schema defaults ← YAML base ← user layer). */
export interface ClaudeLiveSettings {
  live: boolean
  liveMirrorGranularity: ClaudeLiveMirrorGranularity
  /** The configured model, when the card or the YAML base names one. */
  model?: string
  /** Model identifiers the card has saved before (its input's suggestions). */
  recentModels?: readonly string[]
}

/** The Cordis-config inputs every driver generation shares. */
type DriverBase = Pick<Config, 'permissionMode' | 'baseUrl'> & {
  liveIdleMs?: number
  /**
   * Per-spawn member model resolver, handed to every driver generation:
   * answers the member's effective model from its session-level override, the
   * round's delegation model, and the settings key, in that order.
   */
  model?: (childSessionId: string, delegationModel?: string) => string | undefined
  /** Pre-spawn scoped-settings.json model scratch (the shared memory). */
  provisionModel?: (homeDir: string, model: string | undefined) => Promise<void>
}

export class LiveDriverSwitch {
  private liveOn = false
  private active: ClaudeLiveDriver | undefined
  /** Retiring generations still draining their in-flight rounds. */
  private readonly draining = new Set<ClaudeLiveDriver>()
  private readonly unwatch: () => void

  constructor(
    private readonly ctx: Context,
    scope: SettingsScope<ClaudeLiveSettings>,
    private readonly driverBase: DriverBase,
  ) {
    this.apply(scope.get())
    this.unwatch = scope.watch((next) => { this.apply(next) })
  }

  /**
   * Resolve the live driver for one round's member (the provider's call
   * site). A retiring generation still hosting the member gates the new one —
   * the round falls back to exec rather than double-loading the same claude
   * session into two processes.
   */
  readonly resolve = (childSessionId: string): ClaudeLiveDriver | undefined => {
    if (this.active === undefined) return undefined
    for (const retiring of this.draining) {
      if (retiring.hasRuntime(childSessionId)) return undefined
    }
    return this.active
  }

  /**
   * The generation currently hosting the member's runtime — the active one,
   * or a retiring generation still draining it (the model broker retires the
   * member's runtime through whichever generation owns it on a model switch).
   */
  hostingDriver(childSessionId: string): ClaudeLiveDriver | undefined {
    if (this.active?.hasRuntime(childSessionId) === true) return this.active
    for (const retiring of this.draining) {
      if (retiring.hasRuntime(childSessionId)) return retiring
    }
    return undefined
  }

  /** Mirror the resolved settings into the driver generation. */
  private apply(next: ClaudeLiveSettings): void {
    if (next.live === this.liveOn) {
      this.active?.setLiveMirrorGranularity(next.liveMirrorGranularity)
      return
    }
    this.liveOn = next.live
    const retiring = this.active
    this.active = next.live
      ? new ClaudeLiveDriver(this.ctx, {
        ...this.driverBase,
        liveMirrorGranularity: next.liveMirrorGranularity,
      })
      : undefined
    if (retiring !== undefined) {
      this.draining.add(retiring)
      void retiring.drain().then(
        () => { this.draining.delete(retiring) },
        (error: unknown) => {
          this.draining.delete(retiring)
          this.ctx.logger.warn(`local-agent-claude-code: live driver drain failed: ${error instanceof Error ? error.message : String(error)}`)
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
