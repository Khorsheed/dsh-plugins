/**
 * 重启后继续 (member-self-started-rounds M9): which members' rounds a host
 * restart cut off, and which of them the room may continue on its own. One
 * pure rule shared by the composer's banner (client) and the room's
 * auto-continue (server, after `recover()`), so the human's 「全部继续」 and
 * the room's own press always act on the same list.
 *
 * Interrupted = a member's latest room round (not another caller's
 * `execution:` round, not a delivery waiting for its member's 待对账) whose
 * outcome a restart lost: `uncertain` from the core, or a legacy failed run
 * with the restart reason.
 *
 * The room continues an interrupted round itself only when the setting is
 * on (absent = on), the round is not a formal goal's attempt (those keep
 * their explicit reconciliation), and none of the guards holds:
 * - `again`: the round is itself an auto-continue (each round at most once);
 * - `self-restart`: the member's round requested this restart (only when
 *   the restart guard records the member — before M10 it never does, and
 *   the `again` guard bounds the damage to one more restart);
 * - `queue-paused`: the member's core input queue is paused (typed input
 *   waits in the member session);
 * - `room-paused`: the room is paused (the room sends nothing on its own).
 *
 * A round some message already continues (`RoomState.continued`) is not
 * interrupted any more, whoever continued it.
 * @module @khorsheed/dsh-room/restart-continue
 */
import type { RestartFacts, RoomSettings, RoomState } from './types.ts'

/** The run-state reason recovery journals for a round a restart cut off (dispatch.ts RESTART_UNKNOWN_TEXT's prefix). */
export const RESTART_INTERRUPTED_PREFIX = 'Execution outcome is unknown after restart'

/**
 * The continue message — the same words whether the human presses
 * 「全部继续」 or the room does (the client's `composer.continueText` carries
 * this sentence in Chinese and its English twin).
 */
export const RESTART_CONTINUE_TEXT = '刚才实例重启，打断了你上一轮的工作。继续之前请先核对已经做完的部分——改过的文件、跑过的测试、已有的提交、已做的部署——已经完成的步骤不要重做，然后接着把这件事做完。如果有后台任务，它们不会自动重跑，需要的话先确认状态再决定。'

/** Why the room moved on from a lost round when it continued it itself. */
export const AUTO_CONTINUE_MOVED_ON_TEXT = '重启后房间自动继续；被重启打断的这一轮按没做完处理'

/** Why the room did not continue an interrupted round on its own. */
export type RestartContinueBlock = 'again' | 'self-restart' | 'queue-paused' | 'room-paused'

/** One member's interrupted round. */
export interface InterruptedRound {
  readonly member: string
  readonly memberId?: string
  /** The room run id (`<seq>:<memberId>`); absent on legacy runs. */
  readonly runId?: string
  /** The interrupted delivery's task, when it has one. */
  readonly task?: string
  /** Set when the room would not continue this round on its own. */
  readonly blocked?: RestartContinueBlock
  /**
   * A formal goal's attempt: it keeps its explicit reconciliation (a new
   * message does not move on from it), so the room never continues it on
   * its own; the human's 「全部继续」 still lists it.
   */
  readonly goalAttempt?: true
}

/** The room's 重启后自动继续 setting (absent = on). */
export function autoContinueOn(settings: Pick<RoomSettings, 'autoContinueAfterRestart'> | undefined): boolean {
  return settings?.autoContinueAfterRestart !== false
}

/**
 * Every member's interrupted round, each with the guard that keeps the room
 * from continuing it on its own (if any). The setting itself is not a
 * guard: see {@link autoContinueRounds}.
 * @param state - the room state as `getState` projects it (core-aware run states).
 * @param facts - what the journal does not hold; defaults to `state.restartFacts`.
 */
export function interruptedRounds(
  state: Pick<RoomState, 'runs' | 'members' | 'deliveries' | 'settings' | 'continued' | 'restartFacts'>,
  facts: RestartFacts | undefined = state.restartFacts,
): InterruptedRound[] {
  const continued = new Set(state.continued ?? [])
  const paused = new Set(facts?.queuePaused ?? [])
  const rounds: InterruptedRound[] = []
  for (const run of state.runs) {
    if (run.runId?.startsWith('execution:') === true || run.waiting !== undefined) continue
    const lost = run.state === 'uncertain' || (run.state === 'failed' && run.error?.startsWith(RESTART_INTERRUPTED_PREFIX) === true)
    if (!lost || (run.runId !== undefined && continued.has(run.runId))) continue
    const member = state.members.find(entry => entry.name === run.member)
    if (member === undefined || rounds.some(round => round.member === member.name)) continue
    const delivery = run.runId === undefined ? undefined : state.deliveries?.find(row => row.id === run.runId)
    const blocked: RestartContinueBlock | undefined = delivery?.via === 'auto-continue' ? 'again'
      : facts?.restartInitiator !== undefined && member.childSessionId !== undefined && String(member.childSessionId) === facts.restartInitiator ? 'self-restart'
        : member.id !== undefined && paused.has(member.id) ? 'queue-paused'
          : state.settings?.paused === true ? 'room-paused'
            : undefined
    rounds.push({
      member: member.name,
      ...member.id === undefined ? {} : { memberId: member.id },
      ...run.runId === undefined ? {} : { runId: run.runId },
      ...delivery?.task === undefined ? {} : { task: delivery.task },
      ...blocked === undefined ? {} : { blocked },
      ...delivery?.plan?.taskId === undefined ? {} : { goalAttempt: true as const },
    })
  }
  return rounds
}

/**
 * The rounds the room continues itself right now: none with the setting
 * off; otherwise every interrupted round no guard holds that has a run id
 * (the id is what makes it at-most-once).
 */
export function autoContinueRounds(
  state: Pick<RoomState, 'runs' | 'members' | 'deliveries' | 'settings' | 'continued' | 'restartFacts'>,
  facts: RestartFacts | undefined = state.restartFacts,
): InterruptedRound[] {
  if (!autoContinueOn(state.settings)) return []
  return interruptedRounds(state, facts).filter(round => round.blocked === undefined && round.runId !== undefined && round.goalAttempt !== true)
}
