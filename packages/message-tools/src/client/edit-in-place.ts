/**
 * Edit choreography shared by the shadowed renderers: cancel the running turn
 * (waiting for it to settle so its teardown writes land before the
 * replacement), then apply the in-place edit, which itself triggers the
 * regeneration turn. Kept free of services so the unit tests drive it with
 * stub verbs.
 */

/** The verbs of one in-place edit, bound to a session by the caller. */
export interface EditInPlaceSteps {
  /** Cancel the session's running turn. */
  cancel: () => Promise<void>
  /** Wait until the cancelled turn has fully settled (bounded; never hangs). */
  waitIdle: () => Promise<void>
  /** Apply the edit (single Remote call: replace + trigger regeneration). */
  edit: () => Promise<void>
}

/**
 * Edit one user message in place: when the session has a running turn, cancel
 * it first (it is writing into the span the edit is about to shadow) and wait
 * for the settle, then apply the edit. A failed cancel rejects without
 * editing; an idle session is never cancelled.
 * @param steps - the cancel/waitIdle/edit verbs.
 * @param running - whether the session has a running turn right now.
 * @returns completion; failures reject at the failing step.
 */
export async function editInPlace(steps: EditInPlaceSteps, running: boolean): Promise<void> {
  if (running) {
    await steps.cancel()
    await steps.waitIdle()
  }
  await steps.edit()
}
