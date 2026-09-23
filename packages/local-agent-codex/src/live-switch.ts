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
 * @module @khorsheed/dsh-local-agent-codex — internal, unit-tested directly.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { Config } from './index.ts'
import { CodexLiveDriver } from './live-driver.ts'
import type { CodexLiveMirrorGranularity } from './live-driver.ts'

/** The resolved live settings (schema defaults ← YAML base ← user layer). */
export interface CodexLiveSettings {
  live: boolean
  liveMirrorGranularity: CodexLiveMirrorGranularity
  /** The configured model, when the card or the YAML base names one. */
  model?: string
  /** Model identifiers the card has saved before (its input's suggestions). */
  recentModels?: readonly string[]
}

export class LiveDriverSwitch {
  private liveOn = false
  private active: CodexLiveDriver | undefined
  /** Retiring generations still draining their in-flight rounds. */
  private readonly draining = new Set<CodexLiveDriver>()
  private readonly unwatch: () => void

  constructor(
    private readonly ctx: Context,
    scope: SettingsScope<CodexLiveSettings>,
    private readonly options: {
      sandbox: Config['sandbox']
      liveIdleMs?: number
      /**
       * Per-spawn model resolver, handed to every driver generation. Receives
       * the member's child session id so the session-level override can
       * outrank the settings value.
       */
      model?: (childSessionId: string) => string | undefined
    },
  ) {
    this.apply(scope.get())
    this.unwatch = scope.watch((next) => { this.apply(next) })
  }

  /**
   * Resolve the live driver for one round's member (the provider's call
   * site). A retiring generation still hosting the member gates the new one —
   * the round falls back to exec rather than double-loading the same codex
   * thread into two processes.
   */
  readonly resolve = (childSessionId: string): CodexLiveDriver | undefined => {
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
   * model switch path; the CLI session itself carries over via thread/resume).
   */
  async retireRuntime(childSessionId: string): Promise<void> {
    await this.active?.retireRuntime(childSessionId)
  }

  /** Mirror the resolved settings into the driver generation. */
  private apply(next: CodexLiveSettings): void {
    if (next.live === this.liveOn) {
      return
    }
    this.liveOn = next.live
    const retiring = this.active
    this.active = next.live
      ? new CodexLiveDriver(this.ctx, {
        ...this.options.sandbox === undefined ? {} : { sandbox: this.options.sandbox },
        ...this.options.liveIdleMs === undefined ? {} : { liveIdleMs: this.options.liveIdleMs },
        ...this.options.model === undefined ? {} : { model: this.options.model },
      })
      : undefined
    if (retiring !== undefined) {
      this.draining.add(retiring)
      void retiring.drain().then(
        () => { this.draining.delete(retiring) },
        (error: unknown) => {
          this.draining.delete(retiring)
          this.ctx.logger.warn(`local-agent-codex: live driver drain failed: ${error instanceof Error ? error.message : String(error)}`)
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
