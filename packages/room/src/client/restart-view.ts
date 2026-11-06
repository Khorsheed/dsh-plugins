/**
 * What the room shows after a host restart (member-self-started-rounds M9,
 * prototype member-activity.html states 4–7), as pure state over the room
 * state `getState` projects. The interrupted list itself is the shared rule
 * (../restart-continue.ts) the server's auto-continue runs on.
 *
 * - `auto`: the room continued members itself and some of those rounds are
 *   still queued or running — the composer's 「重启后已自动继续 N 位成员」.
 * - `manual`: the rounds waiting for the human's 「全部继续」: all of them
 *   with the setting off (no reasons: the banner reads as before M9);
 *   with it on, the ones a guard held back (with the reason) and goal
 *   attempts. Rounds the room is about to continue itself are not listed —
 *   pressing then would send the message twice.
 */
import type { RoomState } from '../types.ts'
import { autoContinueOn, interruptedRounds, type InterruptedRound, type RestartContinueBlock } from '../restart-continue.ts'

/** The room's latest auto-continue still in progress. */
export interface AutoContinued {
  /** The newest auto-continue dispatch seq (the banner's dismiss key). */
  readonly seq: number
  /** The members it continued whose round is still queued or running. */
  readonly names: readonly string[]
}

/** The composer banner's two halves (either may be absent). */
export interface RestartBanner {
  readonly auto?: AutoContinued
  /** Rounds for the human; `blocked` is shown only when the setting is on. */
  readonly manual: readonly InterruptedRound[]
}

/** Fold the room state into the banner. */
export function restartBanner(state: RoomState | undefined): RestartBanner {
  if (state === undefined) return { manual: [] }
  const on = autoContinueOn(state.settings)
  const manual = interruptedRounds(state)
    .filter(round => !on || round.blocked !== undefined || round.goalAttempt === true || round.runId === undefined)
    .map(round => on ? round : (({ blocked: _blocked, ...rest }) => rest)(round))
  const active = (state.deliveries ?? []).filter(row => row.via === 'auto-continue' && (row.status === 'queued' || row.status === 'running'))
  if (active.length === 0) return { manual }
  const names = [...new Set(active.flatMap(row => {
    const member = state.members.find(entry => entry.id === row.memberId)
    return member === undefined ? [] : [member.name]
  }))]
  return names.length === 0 ? { manual } : { auto: { seq: Math.max(...active.map(row => row.dispatchSeq)), names }, manual }
}

/** The members page's restart line for one member. */
export type MemberRestartLine =
  | { readonly kind: 'continued' }
  | { readonly kind: 'interrupted'; readonly blocked?: RestartContinueBlock }

/**
 * 「重启后已继续」 while the room's auto-continue round for this member is
 * queued or running; 「被重启打断」 while its round waits for the human
 * (the banner's manual list); nothing otherwise.
 */
export function memberRestartLine(state: RoomState | undefined, memberName: string): MemberRestartLine | undefined {
  if (state === undefined) return undefined
  const member = state.members.find(entry => entry.name === memberName)
  if (member === undefined) return undefined
  if ((state.deliveries ?? []).some(row => row.via === 'auto-continue' && row.memberId === member.id && (row.status === 'queued' || row.status === 'running'))) {
    return { kind: 'continued' }
  }
  const round = restartBanner(state).manual.find(entry => entry.member === memberName)
  return round === undefined ? undefined : { kind: 'interrupted', ...round.blocked === undefined ? {} : { blocked: round.blocked } }
}
