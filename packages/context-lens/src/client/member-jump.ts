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

/** Where the member session's lens should land: one call, in its host turn when known. */
export interface LocateCallTarget {
  readonly callId: string
  /** The call's own host turn (paging target). */
  readonly hostTurn?: number
  /** The request the reader was on, so the member's lens opens on the same context. */
  readonly request?: { readonly startedAt: number; readonly requestNumber?: number }
}

/** The pieces the jump needs, all probed by the caller. */
export interface MemberJumpDeps {
  /** `uiWorkspace.openSession`; absent means the jump cannot run. */
  readonly openSession?: ((sessionId: string) => void) | undefined
  /** The session the conversation shows now. */
  readonly currentSession: () => string | undefined
  /** Open the lens tab in the current session's Sidebar; false when it cannot (yet). */
  readonly openTab: (params: { locateCall: LocateCallTarget }) => boolean
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
    if (sameSession(deps.currentSession(), memberSession) && deps.openTab({ locateCall: target })) return
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
}

const selections = new Map<string, PanelSelection>()

/** Keep a panel's place for its session (before the panel goes away). */
export function rememberSelection(sessionId: string, selection: PanelSelection): void {
  selections.set(sessionId, selection)
}

/**
 * Take a session's kept place back, once. A navigation newer than the place
 * (a higher revision) wins: it is what the reader asked for since. A tab
 * whose revision restarted (a lower one) still gets the place back.
 */
export function takeSelection(sessionId: string, revision: number): PanelSelection | undefined {
  const kept = selections.get(sessionId)
  selections.delete(sessionId)
  return kept !== undefined && revision <= kept.revision ? kept : undefined
}
