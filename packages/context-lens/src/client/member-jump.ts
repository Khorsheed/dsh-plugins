/**
 * Showing a room member's tool call where it actually happened: the member's
 * own session. The room's lens panel cannot do this itself — the right
 * Sidebar is kept per session, so switching the conversation to the member
 * session unmounts the room's panel. This plugin-level step outlives it:
 * open the member session (`uiWorkspace.openSession`, the entry the room's
 * 轨迹→ uses), wait until that session is the one on screen, then open the
 * lens tab there with a `locateCall` navigation; the member session's own
 * panel pages, unfolds and lands on the call. Every missing piece degrades to
 * doing nothing, never to an error.
 *
 * And the way back: the room's panel remounts when the reader returns, so it
 * hands its selection to {@link rememberSelection} before leaving and takes it
 * back on mount ({@link takeSelection}).
 *
 * @module @khorsheed/dsh-context-lens/client/member-jump
 */
import type { CompositionFilter } from './aggregate.ts'

/** Where the member session's lens should land: one call, in its host turn when known. */
export interface LocateCallTarget {
  readonly callId: string
  /** The call's own host turn (paging target). */
  readonly hostTurn?: number
  /** The request the reader was on, so the member's lens opens on the same context. */
  readonly request?: { readonly startedAt: number; readonly requestNumber?: number }
  /** How the reader was reading that request: the same filter, the same open row. */
  readonly view?: ReadingView
}

/**
 * How a request is being read: the composition filter, the row the reader
 * has open (its layer and position — the same request reconstructs the same
 * rows in either session's lens), and the detail pane's scroll offset.
 */
export interface ReadingView {
  readonly filterCat: CompositionFilter
  readonly focus?: { readonly layer: 'system' | 'history' | 'added'; readonly position: number }
  readonly detailScroll?: number
}

/**
 * Where a member session's lens lands: one call (`locateCall`), or the turn
 * holding one moment (`locateTime`: a room round with no records hands over
 * its run's start, so the member's lens shows that time span).
 */
export type MemberNavigation =
  | { readonly locateCall: LocateCallTarget & { readonly session: string } }
  | { readonly locateTime: { readonly session: string; readonly at: number } }

/** The pieces the jump needs, all probed by the caller. */
export interface MemberJumpDeps {
  /** `uiWorkspace.openSession`; absent means the jump cannot run. */
  readonly openSession?: ((sessionId: string) => void) | undefined
  /** The session the conversation shows now. */
  readonly currentSession: () => string | undefined
  /** Open the lens tab in the current session's Sidebar; false when it cannot (yet). */
  readonly openTab: (params: MemberNavigation) => boolean
  /** Timer seam (tests). */
  readonly schedule?: (callback: () => void, ms: number) => void
  readonly now?: () => number
}

/** How long the jump waits for the member session to come up. */
export const MEMBER_JUMP_TIMEOUT_MS = 5_000
const MEMBER_JUMP_POLL_MS = 100

/** Session ids appear with and without the `session-` prefix; compare the bare id. */
export const sameSession = (a: string | undefined, b: string | undefined): boolean =>
  a !== undefined && b !== undefined && a.replace(/^session-/, '') === b.replace(/^session-/, '')

/**
 * Switch the conversation to a member's session and open the lens there on one call.
 * @param deps - the probed services.
 * @param memberSession - the member's own session id.
 * @param target - the call to land on.
 * @returns whether the switch started (false: no way to open sessions, or it threw).
 */
export function openInMemberSession(deps: MemberJumpDeps, memberSession: string, target: LocateCallTarget): boolean {
  return openMemberNavigation(deps, memberSession, { locateCall: { ...target, session: memberSession } })
}

/**
 * Switch the conversation to a member's session and open the lens there on
 * the turn holding one moment (an unrecorded room round's 在成员会话里查看).
 * @param deps - the probed services.
 * @param memberSession - the member's own session id.
 * @param at - the moment (the run's start).
 * @returns whether the switch started.
 */
export function openMemberSessionAt(deps: MemberJumpDeps, memberSession: string, at: number): boolean {
  return openMemberNavigation(deps, memberSession, { locateTime: { session: memberSession, at } })
}

function openMemberNavigation(deps: MemberJumpDeps, memberSession: string, navigation: MemberNavigation): boolean {
  if (deps.openSession === undefined) return false
  try {
    deps.openSession(memberSession)
  } catch {
    return false
  }
  const schedule = deps.schedule ?? ((callback, ms) => { setTimeout(callback, ms) })
  const now = deps.now ?? Date.now
  const deadline = now() + MEMBER_JUMP_TIMEOUT_MS
  // The tab may only open once the member session is on screen (its Sidebar
  // is the one that gets the tab) and the lens kind is registered for it.
  const attempt = (): void => {
    if (sameSession(deps.currentSession(), memberSession) && deps.openTab(navigation)) return
    if (now() >= deadline) return
    schedule(attempt, MEMBER_JUMP_POLL_MS)
  }
  attempt()
  return true
}

/** What the panel restores when it remounts: the reader's place. */
export interface PanelSelection {
  /** The navigation revision it was taken under (a newer navigation wins over it). */
  readonly revision: number
  readonly viewed: string | null
  readonly turnSeq: number | null
  readonly scopeId: string
  readonly selectedSeq: number | null
  readonly mainTab: 'token' | 'time'
  /** The filter, open row and scroll offset the reader had on that request. */
  readonly view?: ReadingView
}

const selections = new Map<string, { readonly place: PanelSelection; readonly at: number }>()

/** How long a kept place waits for the reader to come back. */
export const KEPT_PLACE_MS = 30 * 60_000

/** Keep a panel's place for its session (before the panel goes away). */
export function rememberSelection(sessionId: string, selection: PanelSelection, now: number = Date.now()): void {
  selections.set(sessionId, { place: selection, at: now })
}

/** Drop a session's kept place: the reader has moved on from it. */
export function forgetSelection(sessionId: string): void {
  selections.delete(sessionId)
}

/**
 * Take a session's kept place back. It is NOT consumed: the session's panel
 * may mount more than once on the way back (a Sidebar re-adopting its store),
 * and a place handed to the first mount only would leave the next one on the
 * latest turn; the panel drops it once the reader moves away
 * ({@link forgetSelection}), and it expires after {@link KEPT_PLACE_MS}. A navigation newer than the place
 * (a higher revision) wins: it is what the reader asked for since. A tab
 * whose revision restarted (a lower one) still gets the place back, and so
 * does one whose newer navigation was a call meant for another session
 * (`foreign`: it reached this Sidebar while the switch was in flight).
 */
export function takeSelection(sessionId: string, revision: number, foreign = false, now: number = Date.now()): PanelSelection | undefined {
  const kept = selections.get(sessionId)
  if (kept === undefined) return undefined
  if (now - kept.at > KEPT_PLACE_MS || (revision > kept.place.revision && !foreign)) {
    selections.delete(sessionId)
    return undefined
  }
  return kept.place
}

/**
 * Whether a navigation is a call handed to ANOTHER session's lens (it names
 * that session): this lens leaves it alone and keeps the reader's place.
 */
export function foreignLocate(params: { readonly locateCall?: { readonly session?: string }; readonly locateTime?: { readonly session?: string } } | undefined, ownSession: string): boolean {
  const target = params?.locateCall?.session ?? params?.locateTime?.session
  return target !== undefined && !sameSession(target, ownSession)
}
