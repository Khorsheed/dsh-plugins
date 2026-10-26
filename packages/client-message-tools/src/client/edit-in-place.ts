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
 * editing; a failed or timed-out settle wait rejects without editing too —
 * editing before the cancelled turn's teardown has landed would leak the
 * straggler tool results outside the replacement's span. An idle session is
 * never cancelled.
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

/** The verbs of one withdrawal, bound to a session by the caller. */
export interface WithdrawInPlaceSteps {
  /** Cancel the session's running turn. */
  cancel: () => Promise<void>
  /** Wait until the cancelled turn has fully settled (bounded; never hangs). */
  waitIdle: () => Promise<void>
  /** Apply the withdrawal (single Remote call: surface replacement + flush). */
  withdraw: () => Promise<void>
}

/**
 * Withdraw one user message: when the session has a running turn, cancel it
 * first (it is writing into the span the withdrawal is about to shadow) and
 * wait for the settle, then apply the withdrawal. A failed cancel rejects
 * without withdrawing; a failed or timed-out settle wait rejects without
 * withdrawing too — withdrawing before the cancelled turn's teardown has
 * landed would leave straggler chunks/assistant writes outside the
 * replacement's span. An idle session is never cancelled.
 * @param steps - the cancel/waitIdle/withdraw verbs.
 * @param running - whether the session has a running turn right now.
 * @returns completion; failures reject at the failing step.
 */
export async function withdrawInPlace(steps: WithdrawInPlaceSteps, running: boolean): Promise<void> {
  if (running) {
    await steps.cancel()
    await steps.waitIdle()
  }
  await steps.withdraw()
}

/**
 * The minimal slice of the client conversation snapshot the settle probe
 * reads (structurally satisfied by the ui-chat snapshot's timeline slice, so
 * the unit tests stub only these fields).
 * stub only these fields).
 */
export interface TurnSettleSnapshot {
  running: boolean
  runningCalls: readonly unknown[]
  chat: {
    timeline: {
      turnOrder: readonly number[]
      turns: ReadonlyMap<number, { readonly status: 'open' | 'closed' | 'unknown' }>
    }
  }
}

/**
 * Whether the cancelled turn's teardown has fully landed in the session log.
 * `running` flips false FIRST (host status push), the cancelled tool results
 * persist after that, and the `turn/end` event lands last — an edit computed
 * in between shadows a span that ends before those stragglers, leaving orphan
 * tool messages in the model context (the model API then rejects the
 * request). The authoritative settle signal is the latest turn's timeline
 * location closing (turn/end is written after every result); `running` and
 * `runningCalls` are earlier short-circuits. An empty turn order means the
 * running turn's `turn/start` has not streamed in yet — not settled either.
 * @param snapshot - the session's current conversation snapshot.
 * @returns true only when every teardown write of the latest turn has landed.
 */
export function turnSettled(snapshot: TurnSettleSnapshot): boolean {
  if (snapshot.running) return false
  if (snapshot.runningCalls.length > 0) return false
  const order = snapshot.chat.timeline.turnOrder
  const last = order[order.length - 1]
  if (last === undefined) return false
  return snapshot.chat.timeline.turns.get(last)?.status === 'closed'
}

/** Tuning of {@link waitForTurnSettled}; the defaults match production. */
export interface SettleWaitOptions {
  /** Overall bound; the wait rejects when it expires (default 5s). */
  timeoutMs?: number
  /** Poll interval between snapshot reads (default 100ms). */
  intervalMs?: number
  /** Clock override for tests. */
  now?: () => number
  /** Sleep override for tests. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * Poll until the cancelled turn has fully settled ({@link turnSettled}) or
 * the bound expires. The wait is always bounded: on timeout it rejects, and
 * the caller (editInPlace) never edits after a failed settle — editing then
 * would race the cancelled turn's straggler writes onto the surface. An
 * unresolvable snapshot (session binding gone) cannot prove the settle, so it
 * is waited out and rejected like a timeout, never treated as settled.
 * @param snapshot - reads the session's current snapshot (undefined when the
 *   binding is gone).
 * @param options - timeout/interval/clock overrides.
 * @returns resolution once settled; rejection on timeout.
 */
export async function waitForTurnSettled(
  snapshot: () => TurnSettleSnapshot | undefined,
  options: SettleWaitOptions = {},
): Promise<void> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) }))
  const timeoutMs = options.timeoutMs ?? 5_000
  const intervalMs = options.intervalMs ?? 100
  const deadline = now() + timeoutMs
  for (;;) {
    const current = snapshot()
    if (current !== undefined && turnSettled(current)) return
    if (now() >= deadline) {
      throw new Error('message-tools: timed out waiting for the cancelled turn to settle')
    }
    await sleep(intervalMs)
  }
}
