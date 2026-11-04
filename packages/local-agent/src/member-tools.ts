/**
 * Per-member bookkeeping behind the edit dialog's 模式工具 line: what each
 * member's processes were served (by the member channel), the reloads asked
 * for or done at round start, and what the room should be told. Pure state;
 * the member channel feeds it and reads the status out of it.
 * @module @khorsheed/dsh-local-agent/member-tools
 */

import type { LocalAgentMemberToolsStatus } from './types.ts'

/**
 * How long after a reload the new process may take to list before the
 * reload reads as `pending` (its CLI lists at the next message). The bridge
 * retries a failing list for up to ~17 s (three retries, 5 s each) before it
 * reports, so the window covers that.
 */
export const RELOAD_LIST_WINDOW_MS = 20_000

type ReloadBy = 'manual' | 'auto'
type ReloadOutcome = NonNullable<LocalAgentMemberToolsStatus['lastReload']>['outcome']

/** One member's reload history. */
interface MemberTrack {
  /** A round-start reload happened; `settled` is the token whose list followed it. */
  autoReload?: { readonly at: number; settled?: string }
  /** A reload accepted and not yet run, or running. */
  pending?: { state: 'scheduled' | 'reloading'; since: number }
  /**
   * A reload ran and replaced the process: the first list (or placeholder)
   * from a token other than `oldToken` decides its outcome.
   */
  awaiting?: { readonly by: ReloadBy; readonly at: number; readonly oldToken: string | undefined; readonly during: 'round' | 'idle' }
  lastReload?: { at: number; by: ReloadBy; outcome: ReloadOutcome; error?: string }
}

/** What a served list means for the room: a reloaded process still lacks its tools. */
export interface ServedVerdict {
  readonly unavailable?: { readonly during: 'round' | 'idle' }
}

export class MemberToolsTracker {
  private readonly members = new Map<string, MemberTrack>()

  constructor(private readonly now: () => number = () => Date.now()) {}

  private track(childSessionId: string): MemberTrack {
    let track = this.members.get(childSessionId)
    if (track === undefined) {
      track = {}
      this.members.set(childSessionId, track)
    }
    return track
  }

  /**
   * A process listed (`complete`) or served the placeholder.
   * @returns whether the room should hear that a reloaded process still lacks its tools.
   */
  served(childSessionId: string, token: string, served: 'complete' | 'placeholder'): ServedVerdict {
    const track = this.members.get(childSessionId)
    if (track === undefined) return {}
    if (served === 'complete' && track.autoReload !== undefined) {
      // The auto-reload line stays until the next normal load AFTER the one
      // that followed it.
      if (track.autoReload.settled === undefined) track.autoReload.settled = token
      else if (track.autoReload.settled !== token) delete track.autoReload
    }
    const awaiting = track.awaiting
    if (awaiting === undefined || awaiting.oldToken === token) return {}
    delete track.awaiting
    track.lastReload = { at: this.now(), by: awaiting.by, outcome: served === 'complete' ? 'loaded' : 'missing' }
    if (awaiting.by === 'manual' && served === 'complete') delete track.autoReload
    return served === 'placeholder' ? { unavailable: { during: awaiting.during } } : {}
  }

  /** A live driver replaced the member's process at round start because it lacked its tools. */
  autoReloaded(childSessionId: string, oldToken: string | undefined): void {
    const track = this.track(childSessionId)
    const at = this.now()
    track.autoReload = { at }
    track.awaiting = { by: 'auto', at, oldToken, during: 'round' }
  }

  /** Whether a reload is already accepted or running for the member. */
  reloadPending(childSessionId: string): boolean {
    return this.members.get(childSessionId)?.pending !== undefined
  }

  /** The harness accepted a reload: `now` (idle) or `after-round`. */
  reloadAccepted(childSessionId: string, when: 'now' | 'after-round'): void {
    const track = this.track(childSessionId)
    track.pending ??= { state: when === 'now' ? 'reloading' : 'scheduled', since: this.now() }
  }

  /** The accepted reload began replacing the process. */
  reloadStarted(childSessionId: string): void {
    this.track(childSessionId).pending = { state: 'reloading', since: this.now() }
  }

  /** The accepted reload ran; `oldToken` is the replaced process's token. */
  reloadDone(childSessionId: string, outcome: 'respawned' | 'no-process' | 'failed', oldToken: string | undefined, error?: string): void {
    const track = this.track(childSessionId)
    delete track.pending
    const at = this.now()
    if (outcome === 'respawned') track.awaiting = { by: 'manual', at, oldToken, during: 'idle' }
    else track.lastReload = { at, by: 'manual', outcome, ...outcome === 'failed' && error !== undefined ? { error } : {} }
  }

  /** The reload fields of a member's status (`awaiting` past its window reads as `pending`). */
  reloadState(childSessionId: string): Pick<LocalAgentMemberToolsStatus, 'autoReloadAt' | 'reload' | 'lastReload'> {
    const track = this.members.get(childSessionId)
    if (track === undefined) return {}
    const awaiting = track.awaiting
    const reload = track.pending ?? (awaiting !== undefined && this.now() - awaiting.at < RELOAD_LIST_WINDOW_MS
      ? { state: 'reloading' as const, since: awaiting.at }
      : undefined)
    const lastReload = awaiting !== undefined && reload === undefined
      ? { at: awaiting.at, by: awaiting.by, outcome: 'pending' as const }
      : track.lastReload
    return {
      ...track.autoReload === undefined ? {} : { autoReloadAt: track.autoReload.at },
      ...reload === undefined ? {} : { reload: { ...reload } },
      ...lastReload === undefined ? {} : { lastReload: { ...lastReload } },
    }
  }

  /** Forget everything (channel dispose). */
  clear(): void {
    this.members.clear()
  }
}
