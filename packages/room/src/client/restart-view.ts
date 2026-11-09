/**
 * The one place the room asks the human about a host restart (restart-recovery
 * consolidation, prototype restart-recovery.html ③): the line above the
 * composer, 「N 位成员被重启打断：A、B · 停止 · 全部继续」, as pure state over
 * the room state `getState` projects. The interrupted list itself is the
 * shared rule (../restart-continue.ts) the server's auto-continue runs on.
 *
 * It lists only what waits for the human: every interrupted round with the
 * setting off; with it on, the rounds a guard held back, goal attempts the
 * goal did not continue, rounds without a run id, and stale rounds an earlier
 * restart cut off. Rounds the room continues itself are not listed (pressing
 * would send the message twice), and nothing is said about them here — the
 * continued round's own card says 「重启后继续」.
 *
 * A reason is shown only where the human cannot see it themselves (the member
 * requested this restart; it was interrupted again after an automatic
 * continue; its input queue is paused in the member session) — never for the
 * setting being off or the room being paused.
 */
import type { RoomState } from '../types.ts'
import { autoContinueOn, interruptedRounds, type InterruptedRound } from '../restart-continue.ts'
import { pausedByRestart } from '../plan.ts'

/** The composer line's content (nothing to show: no rounds and no goal). */
export interface RestartBanner {
  /** Rounds for the human; `blocked` only where the reason is not visible elsewhere. */
  readonly manual: readonly InterruptedRound[]
  /** A formal goal the restart paused: 全部继续 resumes it (its attempts reopen). */
  readonly goal?: { readonly id: string }
}

/** Fold the room state into the banner. */
export function restartBanner(state: RoomState | undefined): RestartBanner {
  if (state === undefined) return { manual: [] }
  const on = autoContinueOn(state.settings)
  const manual = interruptedRounds(state)
    .filter(round => !on || round.blocked !== undefined || round.goalAttempt === true || round.runId === undefined || round.stale === true)
    .map(round => on && round.blocked !== 'room-paused' ? round : (({ blocked: _blocked, ...rest }) => rest)(round))
  return { manual, ...pausedByRestart(state.plan) && state.plan !== undefined ? { goal: { id: state.plan.id } } : {} }
}
