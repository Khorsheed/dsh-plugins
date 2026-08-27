/**
 * The settings-driven live-driver switch: owns the active driver generation
 * and retires old ones on a settings change, without a plugin reload.
 *
 * Toggle OFF (or the enabled generation unloading): the retiring generation
 * is DRAINED, not killed — new rounds are refused (the provider's catch falls
 * back to exec), in-flight rounds finish on their runtime, idle runtimes are
 * reclaimed at once. Toggling ON builds the next generation lazily (no
 * process until the first round). A granularity change needs no generation
 * swap: the driver reads it per round (`setLiveMirrorGranularity`).
 *
 * Composition with the `enabled` toggle: the switch lives INSIDE one enabled
 * generation (index.ts constructs it only while the harness/provider/tool are
 * registered, and disposes it with them). `enabled` gates EXISTENCE — its
 * teardown keeps the historical hard semantics (`dispose()` → disposeAll,
 * which may interrupt); `live` gates the MODE of an enabled generation and
 * never interrupts (drain). While `enabled` is off the live value is inert
 * and applies when the toggle turns on again.
 *
 * @module @khorsheed/dsh-local-agent-dsh — internal, unit-tested directly.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { LocalAgentDshConfig } from './index.ts'
import { DshLiveDriver } from './live-driver.ts'
import type { DshLiveMirrorGranularity } from './session-mirror.ts'

/** The resolved `local-agent-dsh` settings (schema defaults ← YAML base ← user layer). */
export interface DshLiveSettings {
  /** The DeepSeek delegation toggle; the switch itself reads only the live fields. */
  enabled: boolean
  live: boolean
  liveMirrorGranularity: DshLiveMirrorGranularity
}

export class LiveDriverSwitch {
  private liveOn = false
  private active: DshLiveDriver | undefined
  /** Retiring generations still draining their in-flight rounds. */
  private readonly draining = new Set<DshLiveDriver>()
  private readonly unwatch: () => void

  constructor(
    private readonly ctx: Context,
    scope: SettingsScope<DshLiveSettings>,
    private readonly config: LocalAgentDshConfig,
  ) {
    this.apply(scope.get())
    this.unwatch = scope.watch((next) => { this.apply(next) })
  }

  /**
   * Resolve the live driver for one round's member (the provider's call
   * site). A retiring generation still hosting the member gates the new one —
   * the round falls back to exec rather than double-loading the same sub-dsh
   * session into two processes.
   */
  readonly resolve = (childSessionId: string): DshLiveDriver | undefined => {
    if (this.active === undefined) return undefined
    for (const retiring of this.draining) {
      if (retiring.hasRuntime(childSessionId)) return undefined
    }
    return this.active
  }

  /** Mirror the resolved settings into the driver generation. */
  private apply(next: DshLiveSettings): void {
    if (next.live === this.liveOn) {
      this.active?.setLiveMirrorGranularity(next.liveMirrorGranularity)
      return
    }
    this.liveOn = next.live
    const retiring = this.active
    this.active = next.live
      ? new DshLiveDriver(this.ctx, { ...this.config, liveMirrorGranularity: next.liveMirrorGranularity })
      : undefined
    if (retiring !== undefined) {
      this.draining.add(retiring)
      void retiring.drain().then(
        () => { this.draining.delete(retiring) },
        (error: unknown) => {
          this.draining.delete(retiring)
          this.ctx.logger.warn(`local-agent-dsh: live driver drain failed: ${error instanceof Error ? error.message : String(error)}`)
        },
      )
    }
  }

  /** Enabled-generation unload: interrupt whatever survives (disposeAll, not drain). */
  dispose(): void {
    this.unwatch()
    void this.active?.disposeAll()
    for (const retiring of this.draining) void retiring.disposeAll()
    this.draining.clear()
  }
}
