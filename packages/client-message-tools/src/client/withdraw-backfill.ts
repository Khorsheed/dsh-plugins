/**
 * Withdraw-with-backfill choreography for the shadowed user renderer: a
 * successful withdrawal automatically backfills the withdrawn message's
 * original text into the session composer draft (never sends); a failed
 * withdrawal backfills nothing. Kept free of services so the unit tests
 * drive it with stub verbs (the edit-in-place.ts pattern). The in-place EDIT
 * path never goes through here — editing has its own channel.
 */

/** The verbs of one withdraw-with-backfill, bound to a session by the caller. */
export interface WithdrawBackfillSteps {
  /** Withdraw the target message (rejects on failure). */
  withdraw: () => Promise<void>
  /** Backfill text into the composer draft. */
  backfill: (text: string) => void
}

/**
 * Withdraw one message, then backfill its text into the draft — only after
 * the withdrawal lands, and only when there is text to fill (an image-only
 * message has no draft-worthy text).
 * @param steps - the withdraw/backfill verbs.
 * @param text - the withdrawn message's original text.
 * @returns completion; a failed withdrawal rejects without backfilling.
 */
export async function withdrawAndBackfill(steps: WithdrawBackfillSteps, text: string): Promise<void> {
  await steps.withdraw()
  if (text !== '') steps.backfill(text)
}
