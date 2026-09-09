/**
 * Rail DOM tracker, apply world. The floating timeline panel needs the
 * official chat scrollport's live geometry and the currently visible
 * user-message row, so
 * this module owns the only DOM the plugin touches — read-only probes plus
 * the scroll write the jump performs — and publishes the result through the
 * reserved hooks compartment (components never see the DOM or the sources).
 *
 * The probed attributes ([data-conversation-scroll], [data-chat-anchor-key],
 * [data-chat-flow-kind]) are official render output, not a declared API: when
 * they change, the tracker degrades — a missing scrollport hides the rail
 * (one console.warn), missing rows only clear the active marker and make
 * jumps no-ops. Nothing throws and no official code is modified.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { TimelineRailState } from './slots.ts'
import { isTimelineRowKind } from './timeline-kinds.ts'

/** Horizontal inset of the rail from the scrollport's left edge (px). */
const RAIL_LEFT_INSET = 6
/** Vertical padding above and below the rail inside the scrollport (px). */
const RAIL_VERTICAL_PADDING = 8
/** Keep the target row this far below the scrollport top after a jump (px). */
const JUMP_OFFSET = 16

/** Idle state published before any session binds or while none is current. */
const IDLE: TimelineRailState = {
  sessionId: undefined, ready: false, left: 0, top: 0, height: 0, scrollportWidth: 0, flowLeft: null,
  activeKey: null, chatView: false,
}

/**
 * Measure the panel's viewport box from one scrollport: its rect inset by the
 * panel padding, minus the chat input card at the bottom and the conversation
 * tab strip at the top. The tabs render just above the scrollport, but
 * centering reads against the whole window, so the strip height leaves the
 * box either way — otherwise the list sits visibly high.
 * The bottom ends at the `[data-composer-card]` top — the chat box — NOT the
 * whole `[data-composer-seat]` top: dock cards (goal/todo/queue) sit above
 * the input inside the seat, and counting them would push the timeline up off
 * the conversation. Falls back to the seat top, then the column bottom, when
 * the markers are absent.
 * The scrollport's own width rides along for the width-cap fallback when the
 * message-flow probe is unanswered.
 * @param scrollport - the official conversation scrollport element.
 * @returns the panel box plus the scrollport width, or null while the
 * scrollport has no laid-out size.
 */
export function measureGeometry(scrollport: HTMLElement): { left: number; top: number; height: number; width: number } | null {
  const rect = scrollport.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  let topInset = RAIL_VERTICAL_PADDING
  for (const tabs of scrollport.ownerDocument.querySelectorAll<HTMLElement>('[role="tablist"]')) {
    const tabsRect = tabs.getBoundingClientRect()
    // Only the strip adjacent to the scrollport's top edge counts as chrome.
    if (tabsRect.height > 0 && Math.abs(tabsRect.bottom - rect.top) <= 80) {
      topInset += tabsRect.height
      break
    }
  }
  const card = scrollport.querySelector<HTMLElement>('[data-composer-card]')
  const seat = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
  const bottom = card !== null
    ? card.getBoundingClientRect().top - RAIL_VERTICAL_PADDING
    : seat !== null
      ? seat.getBoundingClientRect().top - RAIL_VERTICAL_PADDING
      : rect.bottom - RAIL_VERTICAL_PADDING
  return {
    left: rect.left + RAIL_LEFT_INSET,
    top: rect.top + topInset,
    height: Math.max(0, bottom - rect.top - topInset),
    width: rect.width,
  }
}

/**
 * The viewport x of the message flow's left edge: the left of the first
 * laid-out `[data-chat-flow-kind]` row, which sits flush inside the official
 * centered content column (max 748px, `margin: 0 auto`). Laid-out flow rows
 * share that edge, so the first meaningful one suffices. The panel's right
 * edge stays left of it — the panel may only occupy the scrollport's left
 * gutter.
 *
 * Rows that are not laid out in the flow are skipped: a message-tools edit
 * leaves the withdrawn originals in the DOM (hidden, zero-size, or off the
 * column at x=0), and probing their left edge yields 0 — which would make the
 * width gate compute a negative left gutter and hide the entire rail. Any
 * real flow row sits inside the conversation column at a positive x.
 * @param scrollport - the official conversation scrollport element.
 * @returns the flow's left edge, or null while no laid-out flow row is rendered.
 */
export function flowLeftX(scrollport: HTMLElement): number | null {
  for (const row of scrollport.querySelectorAll<HTMLElement>('[data-chat-flow-kind]')) {
    const rect = row.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    if (rect.left <= 0) continue
    return rect.left
  }
  return null
}

/**
 * Resolve the key of the user-message row the reading position belongs to:
 * the first matching row whose bottom is still inside the viewport, or —
 * while the reader sits inside a long assistant answer with no user row
 * visible — the nearest user row above the viewport, so the lit tick stays
 * anchored to the question being answered instead of jumping to the
 * session's latest message.
 * @param scrollport - the official conversation scrollport element.
 * @param includeSteering - whether steering rows count as user messages.
 * @returns the row's anchor key, or null when no user row is rendered.
 */
export function activeRowKey(scrollport: HTMLElement, includeSteering: boolean): string | null {
  const viewTop = scrollport.getBoundingClientRect().top
  let lastAbove: string | null = null
  for (const row of scrollport.querySelectorAll<HTMLElement>('[data-chat-flow-kind]')) {
    const kind = row.dataset.chatFlowKind
    if (kind === undefined || !isTimelineRowKind(kind, includeSteering)) continue
    if (row.getBoundingClientRect().bottom <= viewTop) {
      lastAbove = row.dataset.chatAnchorKey ?? lastAbove
      continue
    }
    return row.dataset.chatAnchorKey ?? null
  }
  return lastAbove
}

/**
 * Scroll one user-message row to the top of the transcript scrollport.
 * @param scrollport - the official conversation scrollport element.
 * @param key - the target node's anchor key.
 * @returns whether the row was found and scrolled.
 */
export function jumpRow(scrollport: HTMLElement, key: string): boolean {
  const row = scrollport.querySelector<HTMLElement>(`[data-chat-anchor-key=${JSON.stringify(key)}]`)
  if (row === null) return false
  const target = row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top
    + scrollport.scrollTop - JUMP_OFFSET
  scrollport.scrollTop = Math.max(0, target)
  return true
}

/** The tracker's outward face: the observable state, the jump verb, and the disposer. */
export interface RailTracker {
  /** Live rail geometry and active marker for the current session. */
  readonly state: HostObservable<TimelineRailState>
  /** Scroll the transcript to the message addressed by `key` (no-op while unbound). */
  jumpTo(key: string): void
  /** Unbind every listener and observer. */
  dispose(): void
}

/**
 * Install the rail tracker: bind the current session's scrollport, publish
 * geometry/active updates on scroll and resize, and answer jump requests.
 * Follows the current session through the sessions list and provide channels
 * (the interface renders one conversation at a time, so one tracker suffices).
 * @param ctx - client root context (sessions service).
 * @param includeSteering - whether steering rows count as user dots.
 * @returns the tracker face.
 */
export function installRailTracker(ctx: ClientContext, includeSteering: boolean): RailTracker {
  const listeners = new Set<() => void>()
  let state: TimelineRailState = IDLE
  let activeSession: SessionId | undefined
  let scrollport: HTMLElement | null = null
  let resizeObserver: ResizeObserver | undefined
  let rafPending = false
  let warned = false
  // Bind-generation token: every teardown (a rebind or a dispose) bumps it, so
  // a still-pending bind frame that closed over an older token becomes stale
  // and bails. Without this, a bind scheduled before a dispose/rebind would
  // run afterward — binding the global scrollport under a stale session or,
  // worse, re-adding listeners and a ResizeObserver to a disposed tracker.
  let bindToken = 0

  const nextFrame = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (callback: () => void): void => { setTimeout(callback, 16) }

  const same = (left: TimelineRailState, right: TimelineRailState): boolean =>
    left.sessionId === right.sessionId && left.ready === right.ready
    && left.left === right.left && left.top === right.top
    && left.height === right.height && left.scrollportWidth === right.scrollportWidth
    && left.flowLeft === right.flowLeft
    && left.activeKey === right.activeKey
    && left.chatView === right.chatView

  const publish = (next: TimelineRailState): void => {
    if (same(state, next)) return
    state = next
    for (const fn of [...listeners]) fn()
  }

  const attach = (el: HTMLElement): void => {
    if (scrollport !== null) scrollport.removeEventListener('scroll', onScroll)
    resizeObserver?.disconnect()
    scrollport = el
    scrollport.addEventListener('scroll', onScroll, { passive: true })
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(scheduleUpdate)
      resizeObserver.observe(el)
      const composer = el.querySelector<HTMLElement>('[data-composer-seat]')
      if (composer !== null) resizeObserver.observe(composer)
    }
  }

  const update = (): void => {
    // Self-heal the scrollport binding: while unbound (or bound to a node the
    // host remounted away — the conversation view re-renders under a stable
    // session), re-probe the DOM. On rc hosts currentProvideInfo announced
    // the remount; on 0.1.2 the feed is gone, so the observer/resize/scroll
    // cadence that already lands here owns re-resolution on both lines.
    let el = scrollport
    if (el === null || !el.isConnected) {
      if (activeSession === undefined) return
      const found = document.querySelector<HTMLElement>('[data-conversation-scroll]')
      if (found === null) return
      attach(found)
      el = found
    }
    const geometry = measureGeometry(el)
    if (geometry === null) return
    publish({
      sessionId: activeSession,
      ready: true,
      left: geometry.left,
      top: geometry.top,
      height: geometry.height,
      scrollportWidth: geometry.width,
      flowLeft: flowLeftX(el),
      activeKey: activeRowKey(el, includeSteering),
      chatView: el.querySelector('[data-chat-flow]') !== null,
    })
  }

  const scheduleUpdate = (): void => {
    if (rafPending) return
    rafPending = true
    nextFrame(() => {
      rafPending = false
      update()
    })
  }

  const onScroll = (): void => { scheduleUpdate() }

  const teardownBind = (): void => {
    bindToken++
    if (scrollport !== null) scrollport.removeEventListener('scroll', onScroll)
    scrollport = null
    resizeObserver?.disconnect()
    resizeObserver = undefined
    rafPending = false
  }

  const bind = (sessionId: SessionId | undefined): void => {
    if (sessionId === activeSession && scrollport !== null) return
    teardownBind()
    activeSession = sessionId
    if (sessionId === undefined) {
      publish(IDLE)
      return
    }
    const token = bindToken
    nextFrame(() => {
      // This frame was scheduled by an earlier bind whose generation has since
      // been superseded by a rebind or a dispose: ignore it entirely rather
      // than binding the scrollport under a stale session or binding into a
      // disposed tracker.
      if (token !== bindToken) return
      const found = document.querySelector<HTMLElement>('[data-conversation-scroll]')
      if (found === null) {
        if (!warned) {
          warned = true
          console.warn('message-timeline: [data-conversation-scroll] not found; the rail stays hidden')
        }
        publish(IDLE)
        return
      }
      attach(found)
      update()
    })
  }

  const bindCurrent = (): void => {
    bind(ctx.sessions.list.getSnapshot().current)
  }
  const stopList = ctx.sessions.list.subscribe(bindCurrent)
  // Host 0.1.2-alpha.1 removed ISessions.currentProvideInfo (commit
  // be531688f3 — the provide-channel projection went with the runtime
  // package). rc hosts still publish it, and it is the precise remount
  // signal there, so subscribe when the feed exists and skip it when the
  // service predates/omits it — update() below re-resolves a missing or
  // detached scrollport from the MutationObserver/resize cadence, which
  // covers the remount signal on both lines.
  const provideFeed = (ctx.sessions as { currentProvideInfo?: HostObservable<unknown> }).currentProvideInfo
  const stopProvide = provideFeed?.subscribe(bindCurrent)
  bindCurrent()

  // Layout fallbacks beyond the scrollport's own ResizeObserver: a window
  // resize re-measures, and a body MutationObserver catches panel folds and
  // other layout changes that resize the scrollport without a window event.
  // Both go through the rAF-throttled scheduleUpdate, and publish() skips
  // identical geometry, so the cost stays one measurement per changed frame.
  const onWindowResize = (): void => { scheduleUpdate() }
  if (typeof window !== 'undefined') window.addEventListener('resize', onWindowResize)
  let mutationObserver: MutationObserver | undefined
  if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
    mutationObserver = new MutationObserver(scheduleUpdate)
    mutationObserver.observe(document.body, { childList: true, subtree: true })
  }

  return {
    state: {
      getSnapshot: () => state,
      subscribe: (fn) => {
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      },
    },
    jumpTo: (key) => {
      if (scrollport !== null) jumpRow(scrollport, key)
    },
    dispose: () => {
      stopList()
      stopProvide?.()
      if (typeof window !== 'undefined') window.removeEventListener('resize', onWindowResize)
      mutationObserver?.disconnect()
      teardownBind()
    },
  }
}
