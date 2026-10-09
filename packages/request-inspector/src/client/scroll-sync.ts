/**
 * Conversation scroll-sync over the chat view's DOM anchors — the sanctioned
 * last-resort pattern (AGENTS.md: a DOM anchor must carry a fallback). There
 * is no public slot/service for conversation scrolling (the capability is
 * internal to ui-chat's ChatView `use-chat-viewport.ts`); the seam is
 * registered in docs/upstream-seam-registry.md (S20) with this anchor as the
 * recorded workaround.
 *
 * The anchors are the host's own: `[data-conversation-scroll]` marks the
 * conversation scrollport (ui-conversation ConversationContent), and turn
 * rows carry `[data-chat-turn="<hostTurn>"]` (ui-chat ChatNodeSeat /
 * ChatGroupSeat — the same selector `scrollToTurnAtOrAfter` uses). The panel's
 * real turns key on the host turn number (`TurnListItem.hostTurn`), so the
 * anchor lookup needs no mapping; purpose pseudo-turns have no hostTurn and
 * never scroll.
 *
 * Every failure path is a silent no-op: no conversation mounted, the turn
 * paged out of the virtualized list, a missing scroll primitive — nothing
 * here may throw.
 *
 * @module @khorsheed/dsh-request-inspector/client/scroll-sync
 */

/** The conversation scrollport selector (ui-conversation ConversationContent). */
export const CONVERSATION_SCROLLPORT = '[data-conversation-scroll]'
/**
 * Eligible turn rows: the host's own filter from `scrollToTurnAtOrAfter`
 * (skips hidden rows and rows nested inside a hidden subtree).
 */
export const TURN_ROW_ELIGIBLE = '[data-chat-turn]:not([hidden]):not([hidden] *)'

/** The motion preference; a host without matchMedia (jsdom) defaults to smooth. */
export function preferredScrollBehavior(): 'smooth' | 'auto' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'smooth'
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

/** The on-screen conversation's scrollport, or null when no conversation is mounted. */
function scrollport(root: ParentNode): Element | null {
  try {
    return root.querySelector(CONVERSATION_SCROLLPORT)
  } catch {
    return null
  }
}

/**
 * Scroll the conversation so one host turn's anchor row leads the viewport:
 * the exact `[data-chat-turn="<turn>"]` row first; a paged-out turn lands on
 * the nearest mounted turn ≥ it in DOM order (the host's
 * `scrollToTurnAtOrAfter` semantics); no eligible row is a silent no-op.
 * @param hostTurn - the host's turn number (`TurnListItem.hostTurn`).
 * @param root - the DOM scope (document in production).
 * @param behavior - scroll motion (respects prefers-reduced-motion by default).
 * @returns whether anything scrolled.
 */
export function scrollConversationToTurn(
  hostTurn: number,
  root: ParentNode = document,
  behavior: 'smooth' | 'auto' = preferredScrollBehavior(),
): boolean {
  try {
    const scope: ParentNode = scrollport(root) ?? root
    const exact = scope.querySelector(`[data-chat-turn="${hostTurn}"]:not([hidden]):not([hidden] *)`)
    if (exact !== null) {
      exact.scrollIntoView({ behavior, block: 'start' })
      return true
    }
    for (const row of scope.querySelectorAll(TURN_ROW_ELIGIBLE)) {
      const value = Number((row as HTMLElement).dataset.chatTurn)
      if (Number.isSafeInteger(value) && value >= hostTurn) {
        row.scrollIntoView({ behavior, block: 'start' })
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

/**
 * Scroll the conversation to its floor (the 最新 button): the scrollport's
 * own `scrollTo` when present, else the largest mounted turn row as the
 * anchor fallback. No conversation mounted is a silent no-op.
 * @param root - the DOM scope (document in production).
 * @param behavior - scroll motion (respects prefers-reduced-motion by default).
 * @returns whether anything scrolled.
 */
export function scrollConversationToBottom(
  root: ParentNode = document,
  behavior: 'smooth' | 'auto' = preferredScrollBehavior(),
): boolean {
  try {
    const port = scrollport(root)
    if (port !== null && typeof (port as Element & { scrollTo?: unknown }).scrollTo === 'function') {
      ;(port as Element).scrollTo({ top: port.scrollHeight, behavior })
      return true
    }
    let latest: Element | null = null
    let max = Number.NEGATIVE_INFINITY
    for (const row of (port ?? root).querySelectorAll(TURN_ROW_ELIGIBLE)) {
      const value = Number((row as HTMLElement).dataset.chatTurn)
      if (Number.isSafeInteger(value) && value >= max) {
        max = value
        latest = row
      }
    }
    if (latest === null) return false
    latest.scrollIntoView({ behavior, block: 'end' })
    return true
  } catch {
    return false
  }
}
