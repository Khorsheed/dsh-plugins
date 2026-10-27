/**
 * A poll that runs only while the page is visible, with an early nudge.
 *
 * A plugin's host cannot push to the page, and work done outside a turn (a
 * room member, a background job) raises no session event — so a reveal needs
 * the page to look now and then. Calls closer together than `minGapMs` are
 * dropped, so session events can nudge it freely.
 * @module @khorsheed/dsh-client-ui-reveal-kit
 */

/** A running poll. */
export interface VisiblePoll {
  /** Look now (dropped when the last look was under `minGapMs` ago). */
  nudge(): void
  stop(): void
}

/**
 * Start polling.
 * @param look - the check; its rejection is swallowed.
 * @param everyMs - how often while visible (default 6 s).
 * @param minGapMs - the shortest gap between two looks (default 3 s).
 * @returns the poll.
 */
export function visiblePoll(look: () => Promise<unknown> | void, everyMs = 6000, minGapMs = 3000): VisiblePoll {
  let last = 0
  const nudge = (): void => {
    const now = Date.now()
    if (now - last < minGapMs) return
    last = now
    try {
      void Promise.resolve(look()).catch(() => {})
    } catch {
      // A failing look is retried on the next tick.
    }
  }
  const timer = setInterval(() => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') nudge()
  }, everyMs)
  return { nudge, stop: () => { clearInterval(timer) } }
}
