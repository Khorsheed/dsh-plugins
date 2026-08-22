/**
 * The five-bucket projection: the filter dimension for queue views, derived
 * from the state-machine SHAPE plus plan data — templates need no extra
 * fields (terminal = no out-edge, initial = no in-edge). Plan data is data
 * only: a mission becoming ready changes its bucket, never fires anything —
 * mission has no auto-transition code path anywhere.
 */
import { deriveShape } from './template.ts'
import type { AttemptRecord, Bucket, MissionRecord, MissionView, RunRecord, StateMachineDecl } from './types.ts'

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

/**
 * States where held resources are settled: the releasable states plus every
 * state REACHABLE from them through the declared transitions (e.g. a
 * `released` terminal downstream of `releasable`). A mission holding
 * `refs.resource` in such a state is past the release gate — the record
 * stays (immutable history), but it must not trip the unreleased-resource
 * warning; only states UPSTREAM of the gate (working, archived, …) warn.
 * Pure derivation from transitions — no new template field.
 */
export function releasableClosure(machine: StateMachineDecl): Set<string> {
  const settled = new Set(machine.releasableStates)
  const queue = [...settled]
  while (queue.length > 0) {
    const from = queue.shift() as string
    for (const t of machine.transitions) {
      if (t.from !== from || settled.has(t.to)) continue
      settled.add(t.to)
      queue.push(t.to)
    }
  }
  return settled
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
    resourceHeld: attempt.refs.resource !== undefined && !releasableClosure(run.stateMachine).has(attempt.state),
    enteredCurrentAt: attempt.enteredAt[attempt.state] ?? run.createdAt,
  }
  if (mission.title !== undefined) view.title = mission.title
  if (mission.dependsOn !== undefined) view.dependsOn = mission.dependsOn
  if (mission.scheduledAt !== undefined) view.scheduledAt = mission.scheduledAt
  return view
}
