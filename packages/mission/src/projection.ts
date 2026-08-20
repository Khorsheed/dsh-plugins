/**
 * The five-bucket projection: the filter dimension for queue views, derived
 * from the state-machine SHAPE plus plan data — templates need no extra
 * fields (terminal = no out-edge, initial = no in-edge). Plan data is data
 * only: a mission becoming ready changes its bucket, never fires anything —
 * mission has no auto-transition code path anywhere.
 */
import { deriveShape } from './template.ts'
import type { AttemptRecord, Bucket, MissionRecord, MissionView, RunRecord } from './types.ts'

/** The current attempt of a mission (always present — attempts start at 1). */
export function currentAttempt(mission: MissionRecord): AttemptRecord {
  const attempt = mission.attempts[mission.currentAttempt - 1]
  if (attempt === undefined) {
    throw new Error(`mission: mission ${mission.id} has no attempt ${mission.currentAttempt} — run file is corrupt`)
  }
  return attempt
}

/**
 * Project one mission into its bucket:
 * terminal state → done (failed/halted terminals share the bucket); unmet
 * dependsOn → blocked; scheduledAt in the future → scheduled; initial state →
 * ready; everything else → active.
 * @param mission - the mission to project.
 * @param run - its run (dependency lookup + state-machine shape).
 * @param now - epoch ms (injected for deterministic tests).
 * @returns the bucket plus the unmet dependency ids.
 */
export function bucketOf(mission: MissionRecord, run: RunRecord, now: number): { bucket: Bucket; blockedOn: string[] } {
  const shape = deriveShape(run.stateMachine)
  const state = currentAttempt(mission).state
  if (shape.terminals.includes(state)) return { bucket: 'done', blockedOn: [] }
  const blockedOn = (mission.dependsOn ?? []).filter((depId) => {
    const dep = run.missions.find(m => m.id === depId)
    return dep === undefined || !shape.terminals.includes(currentAttempt(dep).state)
  })
  if (blockedOn.length > 0) return { bucket: 'blocked', blockedOn }
  if (mission.scheduledAt !== undefined && mission.scheduledAt > now) return { bucket: 'scheduled', blockedOn }
  if (shape.initials.includes(state)) return { bucket: 'ready', blockedOn }
  return { bucket: 'active', blockedOn }
}

/** Full view row for one mission (bucket + releasability + resource-hold flag). */
export function viewOf(mission: MissionRecord, run: RunRecord, now: number): MissionView {
  const attempt = currentAttempt(mission)
  const { bucket, blockedOn } = bucketOf(mission, run, now)
  const releasable = run.stateMachine.releasableStates.includes(attempt.state)
  const view: MissionView = {
    runId: run.id,
    id: mission.id,
    labels: mission.labels,
    state: attempt.state,
    bucket,
    currentAttempt: mission.currentAttempt,
    blockedOn,
    releasable,
    resourceHeld: attempt.refs.resource !== undefined && !releasable,
    enteredCurrentAt: attempt.enteredAt[attempt.state] ?? run.createdAt,
  }
  if (mission.title !== undefined) view.title = mission.title
  if (mission.dependsOn !== undefined) view.dependsOn = mission.dependsOn
  if (mission.scheduledAt !== undefined) view.scheduledAt = mission.scheduledAt
  return view
}
