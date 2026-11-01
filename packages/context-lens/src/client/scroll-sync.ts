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
 * @module @khorsheed/dsh-context-lens/client/scroll-sync
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
 * The box a jump lands on for one turn element. Slot anchors render with
 * `display: contents` and have no box — scrollIntoView on them is a silent
 * no-op (a member session's turn starts with its turn-process anchor: 443e7c65
 * turn 18 never moved) — so the first descendant that renders stands in. An
 * element (or subtree) rendering nothing yields null.
 */
function landingOf(element: Element): Element | null {
  const display = (target: Element): string => {
    try { return getComputedStyle(target).display } catch { return '' }
  }
  const own = display(element)
  if (own === 'none') return null
  if (own !== 'contents') return element
  for (const child of element.querySelectorAll('*')) {
    const value = display(child)
    if (value !== 'contents' && value !== 'none' && child.closest('[hidden]') === null) return child
  }
  return null
}

/** How long a jump keeps checking that it landed (the host's own scroll writes can cut a smooth scroll short). */
export const LANDING_WATCH_MS = 1_500
/** How far from the viewport top a landed row may sit. */
const LANDING_TOLERANCE_PX = 24
/** Corrections one jump may make. */
const LANDING_CORRECTIONS = 3

/** The watch of the latest jump; a new jump or the reader's own scroll ends it. */
let watching: (() => void) | undefined

/**
 * Jump to a row and make the jump stick. The chat view writes its own scroll
 * position frame by frame while it folds rows or pages older history in
 * (ui-chat use-chat-viewport), which can cut a smooth scrollIntoView short —
 * the jump then lands somewhere in between, sometimes. So the jump watches
 * for a moment: once the scroll is still, a row that is not at the top (and
 * could be) is brought there instantly. The row is re-found each check (a
 * re-render replaces the element); the reader's wheel, touch or keys end it.
 * @param find - resolves the landing row now.
 * @param scroller - the conversation scrollport, when mounted.
 * @param behavior - the first motion.
 */
function landOn(find: () => Element | null, scroller: Element | null, behavior: 'smooth' | 'auto'): boolean {
  const first = find()
  if (first === null) return false
  watching?.()
  first.scrollIntoView({ behavior, block: 'start' })
  if (scroller === null || typeof requestAnimationFrame !== 'function') return true
  const started = Date.now()
  let lastTop = Number.NaN
  let still = 0
  let corrections = 0
  let frame = 0
  let stopped = false
  const intents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
  const stop = (): void => {
    stopped = true
    cancelAnimationFrame(frame)
    for (const type of intents) scroller.removeEventListener(type, stop, true)
    if (watching === stop) watching = undefined
  }
  for (const type of intents) scroller.addEventListener(type, stop, true)
  watching = stop
  const check = (): void => {
    if (stopped) return
    if (Date.now() - started > LANDING_WATCH_MS) { stop(); return }
    const top = scroller.scrollTop
    still = top === lastTop ? still + 1 : 0
    lastTop = top
    if (still >= 4) {
      const row = find()
      if (row === null) { stop(); return }
      const offset = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      const atFloor = scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1
      if (Math.abs(offset) <= LANDING_TOLERANCE_PX || (offset > 0 && atFloor) || corrections >= LANDING_CORRECTIONS) { stop(); return }
      corrections += 1
      still = 0
      row.scrollIntoView({ behavior: 'auto', block: 'start' })
    }
    frame = requestAnimationFrame(check)
  }
  frame = requestAnimationFrame(check)
  return true
}

/** The first rendering box of one message row, in DOM order. */
function messageLanding(scope: ParentNode, messageId: string): Element | null {
  const id = messageId.replace(/["\\]/g, '')
  for (const row of scope.querySelectorAll(`[data-chat-node-key$="${id}"]:not([hidden]):not([hidden] *)`)) {
    const landing = landingOf(row)
    if (landing !== null) return landing
  }
  return null
}

/** Whether the conversation has rendered one message's row (a room round's anchor) yet. */
export function hasMessageAnchor(messageId: string, root: ParentNode = document): boolean {
  try {
    return messageLanding(scrollport(root) ?? root, messageId) !== null
  } catch {
    return false
  }
}

/** The first rendering box of one host turn, in DOM order. */
function turnLanding(scope: ParentNode, hostTurn: number): Element | null {
  for (const row of scope.querySelectorAll(`[data-chat-turn="${hostTurn}"]:not([hidden]):not([hidden] *)`)) {
    const landing = landingOf(row)
    if (landing !== null) return landing
  }
  return null
}

/** Whether the chat has rendered this host turn's anchor row (a jump can land on it). */
export function hasTurnAnchor(hostTurn: number, root: ParentNode = document): boolean {
  try {
    return turnLanding(scrollport(root) ?? root, hostTurn) !== null
  } catch {
    return false
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
    const port = scrollport(root)
    const scope: ParentNode = port ?? root
    const find = (): Element | null => {
      const exact = turnLanding(scope, hostTurn)
      if (exact !== null) return exact
      for (const row of scope.querySelectorAll(TURN_ROW_ELIGIBLE)) {
        const value = Number((row as HTMLElement).dataset.chatTurn)
        const landing = Number.isSafeInteger(value) && value >= hostTurn ? landingOf(row) : null
        if (landing !== null) return landing
      }
      return null
    }
    return landOn(find, port, behavior)
  } catch {
    return false
  }
}

/**
 * Scroll the conversation to one message's chat row — a room round's anchor:
 * a human post to a room has no host turn of its own, but its user/message
 * renders as an input-message node keyed by the message id
 * (`data-chat-node-key`, ui-chat ChatNodeSeat). Matched on the key's suffix
 * so the host's kind prefix is not hard-coded. Not mounted is a silent no-op.
 * @param messageId - the user/message id.
 * @param root - the DOM scope (document in production).
 * @param behavior - scroll motion.
 * @returns whether anything scrolled.
 */
export function scrollConversationToMessage(
  messageId: string,
  root: ParentNode = document,
  behavior: 'smooth' | 'auto' = preferredScrollBehavior(),
): boolean {
  try {
    const port = scrollport(root)
    const scope: ParentNode = port ?? root
    return landOn(() => messageLanding(scope, messageId), port, behavior)
  } catch {
    return false
  }
}

/** One tool call's row (root or nested), mounted or folded — the host's `data-chat-call-id` convention (ui-tool ToolCallTree). */
function callRow(scope: ParentNode, callId: string): Element | null {
  const id = callId.replace(/["\\]/g, '')
  return scope.querySelector(`[data-chat-call-id="${id}"]`)
}

/** Whether the conversation holds one tool call's row (possibly inside a folded step group). */
export function hasCallAnchor(callId: string, root: ParentNode = document): boolean {
  try {
    return callRow(scrollport(root) ?? root, callId) !== null
  } catch {
    return false
  }
}

/** Frames a folded call may take to unfold before the jump gives up on it. */
const REVEAL_FRAMES = 60

/**
 * Scroll the conversation to one tool call's row. A folded step group keeps
 * its rows in the DOM under `hidden="until-found"` and opens on the
 * standard `beforematch` event (ui-chat searchable-hidden) — the same path
 * the browser's find-in-page takes — so every such ancestor gets that event
 * first, and the jump lands once the row renders. Not mounted is a no-op.
 * @param callId - the provider-issued call id.
 * @param root - the DOM scope (document in production).
 * @param behavior - scroll motion.
 * @returns whether the call's row was found (the landing may follow a few frames later).
 */
export function scrollConversationToCall(
  callId: string,
  root: ParentNode = document,
  behavior: 'smooth' | 'auto' = preferredScrollBehavior(),
): boolean {
  try {
    const port = scrollport(root)
    const scope: ParentNode = port ?? root
    const row = callRow(scope, callId)
    if (row === null) return false
    for (let folded = row.closest('[hidden="until-found"]'); folded !== null; folded = folded.parentElement?.closest('[hidden="until-found"]') ?? null) {
      folded.dispatchEvent(new Event('beforematch', { bubbles: true }))
    }
    const find = (): Element | null => {
      const current = callRow(scope, callId)
      return current === null || current.closest('[hidden]') !== null ? null : landingOf(current)
    }
    let frames = 0
    const land = (): void => {
      if (find() !== null || frames >= REVEAL_FRAMES || typeof requestAnimationFrame !== 'function') { landOn(find, port, behavior); return }
      frames += 1
      requestAnimationFrame(land)
    }
    land()
    return true
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
