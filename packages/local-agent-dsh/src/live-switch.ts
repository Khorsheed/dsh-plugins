/**
 * The settings-driven live-driver switch: owns the active driver generation
 * and retires old ones on a settings change, without a plugin reload.
 *
 * Toggle OFF: the retiring generation
 * is DRAINED, not killed — new rounds are refused (the provider's catch falls
 * back to exec), in-flight rounds finish on their runtime, idle runtimes are
 * reclaimed at once. Toggling ON builds the next generation lazily (no
 * process until the first round). Legacy granularity settings are ignored.
 *
 * Lifetime: index.ts constructs the switch with the harness/provider
 * registration and disposes it with them on plugin unload — that teardown
 * keeps the hard semantics (`dispose()` → disposeAll, which may interrupt);
 * `live` only gates the MODE and never interrupts (drain).
 *
 * @module @khorsheed/dsh-local-agent-dsh — internal, unit-tested directly.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsFace } from '@khorsheed/dsh-local-agent'
import type { LocalAgentDshConfig } from './index.ts'
import { DshLiveDriver } from './live-driver.ts'
import type { DshLiveMirrorGranularity } from './session-mirror.ts'

/** The resolved `local-agent-dsh` live settings (the volatile row config, card-settings overrides on top). */
export interface DshLiveSettings {
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
    face: SettingsFace<DshLiveSettings>,
    private readonly config: LocalAgentDshConfig,
    private readonly extras: {
      /**
       * Per-spawn model resolver, handed to every driver generation. Receives
       * the member's child session id so the session-level override can
       * outrank the settings value.
       */
      modelFor?: (childSessionId: string) => string | undefined
    } = {},
  ) {
    this.apply(face.get())
    this.unwatch = face.watch((next) => { this.apply(next) })
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

  /**
   * The model the member's live runtime bound at spawn (the broker's switch
   * check): the identifier, undefined for "bound to no model", null for "no
   * live runtime". Consults only the ACTIVE generation — a draining one is on
   * its way out anyway.
   */
  boundModel(childSessionId: string): string | undefined | null {
    return this.active?.boundModelOf(childSessionId) ?? null
  }

  /**
   * Retire the member's resident runtime in the active generation so the next
   * round respawns onto the member's new effective model (the composer's
   * model switch path; the sub-dsh session itself carries over via the
   * on-disk resume).
   */
  async retireRuntime(childSessionId: string): Promise<void> {
    await this.active?.retireRuntime(childSessionId)
  }

  /** Mirror the resolved settings into the driver generation. */
  private apply(next: DshLiveSettings): void {
    if (next.live === this.liveOn) {
      return
    }
    this.liveOn = next.live
    const retiring = this.active
    this.active = next.live
      ? new DshLiveDriver(this.ctx, {
        ...this.config,
        ...this.extras.modelFor === undefined ? {} : { modelFor: this.extras.modelFor },
      })
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

  /** Plugin unload: interrupt whatever survives (disposeAll, not drain). */
  dispose(): void {
    this.unwatch()
    void this.active?.disposeAll()
    for (const retiring of this.draining) void retiring.disposeAll()
    this.draining.clear()
  }
}
