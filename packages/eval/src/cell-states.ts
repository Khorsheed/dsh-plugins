/**
 * Which template states count as a cell being FINISHED, and how long one
 * attempt took — one module with no imports, so the host (the status rule,
 * the grid dots, the cells listing) and the browser (the run-records card's
 * status word) read the same set instead of two copies that could drift.
 *
 * T80c P1-3 made `progress.done` count exactly this set, so 「评估中」 always
 * coincides with done = total; P1-7 then made the run-records card say
 * 「完成」 for exactly this set too, so a card and the list's progress can
 * never disagree about whether a cell is done.
 */

/**
 * `judged` and everything after it in the generated template's state order
 * (`… → judged | halted → archived → releasable → released`). A cell in one
 * of these has nothing left for the ORCHESTRATOR to do; what remains is the
 * judge's and the human's, which is what `judging` means.
 */
export const JUDGED_OR_BEYOND: ReadonlySet<string> = new Set(['judged', 'halted', 'archived', 'releasable', 'released'])

/**
 * Whether a cell's template state is `judged` or past it — the orchestrator
 * has nothing left to do with it. The matrix page's rep dot and the status
 * rule read the SAME predicate, so a cell can never be a solid dot in one
 * view and "still running" in the other.
 * @param state - the template state, as the ledger holds it.
 * @returns true when nothing further is the orchestrator's to do.
 */
export function isJudgedOrBeyond(state: string): boolean {
  return JUDGED_OR_BEYOND.has(state)
}

/**
 * How long one attempt RAN: from the first state it entered to the moment it
 * first reached {@link JUDGED_OR_BEYOND} — or to `now` while it has not.
 *
 * Not `inStateMs`: that measures from the last transition, so a released cell
 * reads as «two days», which is how long ago the run ended (I5·T67 · W4). The
 * release, the archive and the judge's turn all happen after the player
 * stopped, and none of them is time the cell spent running.
 * @param enteredAt - state → when the attempt entered it, as mission records it.
 * @param state - the attempt's current state.
 * @param now - the clock for a cell still running.
 * @returns milliseconds, or null when the ledger timed nothing (or the finish).
 */
export function attemptElapsedMs(
  enteredAt: Readonly<Record<string, number>> | undefined,
  state: string,
  now: number,
): number | null {
  const times = Object.values(enteredAt ?? {}).filter(at => Number.isFinite(at))
  if (times.length === 0) return null
  const start = Math.min(...times)
  if (!isJudgedOrBeyond(state)) return Math.max(0, now - start)
  const settled = Object.entries(enteredAt ?? {})
    .filter(([name, at]) => JUDGED_OR_BEYOND.has(name) && Number.isFinite(at))
    .map(([, at]) => at)
  // A finished cell whose finish the ledger did not time has no honest
  // duration; running it to `now` would be the W4 number again.
  if (settled.length === 0) return null
  return Math.max(0, Math.min(...settled) - start)
}
