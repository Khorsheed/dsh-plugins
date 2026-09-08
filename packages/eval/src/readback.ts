/**
 * The post-settle read-back wait, shared by the two callers that delegate
 * through the local-agent facade: the run loop's stage rounds and the
 * pre-run readiness probe. It lives in its own module so neither imports the
 * other — the readiness check runs BEFORE the run exists, and the run loop
 * must not depend on it.
 * @module @khorsheed/dsh-eval
 */
import type { LocalAgentFace } from './faces.ts'

/** Poll interval of the post-settle read-back wait. */
export const READBACK_POLL_MS = 50
/** Default bound on the post-settle read-back wait. */
export const DEFAULT_READBACK_WAIT_MS = 10_000

/** Resolve after `ms` — the read-back wait's only sleep. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * Wait, bounded, for T11's observation of the round that just settled.
 *
 * The observation does not arrive before `run.result` resolves: a provider
 * records it in its settle pass, which is chained AFTER the result promise —
 * and the facade clears the tracked run (with the `onProgress` callback the
 * options carried) at that same moment, so on a real facade the `settled`
 * event never reaches this caller and `delegationOf` is the channel that
 * does. Reading the record the instant the result resolves therefore reads it
 * one beat too early, which is exactly what the first real two-cell run
 * showed: model.observed null against a delegations.jsonl that had the model.
 *
 * `prior` is the record's observation BEFORE this round started, so a value
 * that differs from it is one this round produced. When the wait expires the
 * record's current value is still returned — for a resumed round that ran the
 * same model as its predecessor the two are identical and indistinguishable,
 * and the record is documented as the delegation's latest observation, so
 * reporting it is honest where reporting null would discard real evidence.
 * @param localAgent - the delegation facade.
 * @param childSessionId - the round's child session id.
 * @param prior - the record's observation before this round started.
 * @param waitMs - upper bound on the wait; 0 reads once and returns.
 * @returns the observed model, or null when nothing was ever recorded.
 */
export async function awaitObservedModel(
  localAgent: LocalAgentFace,
  childSessionId: string,
  prior: string | undefined,
  waitMs: number,
): Promise<string | null> {
  const deadline = Date.now() + Math.max(0, waitMs)
  let observed = localAgent.delegationOf?.(childSessionId)?.observedModel
  // Nothing to wait for when the facade has no read side at all (pre-T11).
  if (localAgent.delegationOf === undefined) return observed ?? null
  while ((observed === undefined || observed === prior) && Date.now() < deadline) {
    await delay(READBACK_POLL_MS)
    observed = localAgent.delegationOf(childSessionId)?.observedModel
  }
  return observed ?? null
}
