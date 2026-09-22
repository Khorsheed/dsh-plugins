import { describe, expect, it } from 'vitest'
import { acceptedTask, dependencyResults, activePlanMs, parsePlanCommand, planCommandContract, admitPlanAttempt, changePlan, queuePlanAttempt, readyPlanTasks, recoverPlan, settlePlanAttempt } from '../src/plan.ts'
import type { PlanActor, PlanCommand, PlanEvidence, PlanTaskInput, RoomPlan } from '../src/plan.ts'

const coordinator: PlanActor = { kind: 'coordinator', memberId: 'main' }
const human: PlanActor = { kind: 'human', memberId: 'human' }
const members = new Set(['main', 'worker', 'other'])
const evidence: PlanEvidence = { summary: 'Verified output', references: ['session:worker/turn:1'], artifacts: ['results/output.txt'] }
const budget = { maxParallel: 2, maxAttempts: 6, maxAttemptsPerTask: 3, maxActiveMs: 1000 }
function create(mode: 'draft' | 'execute' = 'execute'): RoomPlan {
  return changePlan(undefined, { action: 'create', requestId: 'create', expectedRevision: 0, id: 'goal', objective: 'Build and verify', mode, budget }, { actor: coordinator, memberIds: members, now: 0 })
}
function task(id: string, patch: Partial<PlanTaskInput> = {}): PlanTaskInput {
  return { id, title: id, stageId: 'stage', kind: 'task', ownerMemberId: 'worker', instruction: 'Produce the requested output', criteria: ['Output passes review'], inputRefs: [], artifactPaths: ['results/output.txt'], dependsOn: [], ...patch }
}
type Operation = PlanCommand extends infer C ? C extends PlanCommand ? Omit<C, 'requestId' | 'expectedRevision'> : never : never
function change(plan: RoomPlan, operation: Operation, actor = coordinator, now = 10): RoomPlan {
  return changePlan(plan, { ...operation, requestId: `request-${plan.revision}`, expectedRevision: plan.revision } as PlanCommand, { actor, memberIds: members, now })
}
function planned(tasks = [task('a'), task('b', { dependsOn: ['a'] })]): RoomPlan {
  return change(create(), { action: 'extend', stages: [{ id: 'stage', title: 'Implementation' }], tasks })
}
function running(plan = planned(), id = 'a', attempt = 'attempt-a'): RoomPlan {
  return admitPlanAttempt(queuePlanAttempt(plan, id, attempt, `delivery:${attempt}`, 20), id, attempt, 25)
}
function submitted(plan = running(), id = 'a', attempt = 'attempt-a'): RoomPlan {
  return settlePlanAttempt(plan, id, attempt, { state: 'done', evidence }, 30)
}

describe('formal room goal transitions', () => {
  it('honors a goal-fenced human pause after concurrent evidence while retaining revision checks elsewhere', () => {
    const active = running()
    const latest = submitted(active)
    const pause = { action: 'pause' as const, goalId: active.id, reason: 'Human paused', requestId: 'pause-race', expectedRevision: active.revision }
    expect(parsePlanCommand(JSON.stringify(pause))).toEqual(pause)
    const context = { actor: human, memberIds: members, now: 40 }
    const stopped = changePlan(latest, pause, context)
    expect(stopped.status).toBe('paused')
    expect(stopped.tasks).toEqual(latest.tasks)
    expect(readyPlanTasks(stopped)).toEqual([])
    expect(changePlan(stopped, pause, context)).toEqual(stopped)
    expect(() => changePlan(latest, pause, { ...context, actor: coordinator })).toThrow('revision changed')
    const { goalId: _goalId, ...legacyPause } = pause
    expect(() => changePlan(latest, legacyPause, context)).toThrow('revision changed')
    expect(() => changePlan({ ...latest, id: 'replacement' }, pause, context)).toThrow('Goal changed')
    expect(() => changePlan({ ...latest, status: 'completed' }, pause, context)).toThrow('closed')
    expect(() => changePlan(stopped, { action: 'resume', requestId: 'stale-resume', expectedRevision: active.revision }, context)).toThrow('revision changed')
  })

  it('shares a strict bounded command grammar and rejects unknown or malformed wire fields', () => {
    const base = { action: 'resume', requestId: 'wire', expectedRevision: 1 }
    expect(parsePlanCommand(JSON.stringify(base))).toEqual(base)
    for (const value of [null, [], { ...base, actor: 'human' }, { ...base, expectedRevision: -1 }, { ...base, action: 'invented' },
      { ...base, action: 'budget', budget: { ...budget, maxParallel: 99 } },
      { ...base, action: 'submit', taskId: 'a', attemptId: 'try', evidence: { ...evidence, references: [], actor: 'human' } },
    ]) expect(() => parsePlanCommand(JSON.stringify(value))).toThrow()
    expect(() => parsePlanCommand(' '.repeat(131073))).toThrow('128 KiB')
    const contract = planCommandContract() as { oneOf: unknown[] }
    contract.oneOf.length = 0
    expect(parsePlanCommand(JSON.stringify(base))).toEqual(base)
  })

  it('keeps a draft inert until explicit continuation and does not mutate the input snapshot', () => {
    const draft = create('draft')
    const extended = change(draft, { action: 'extend', stages: [{ id: 'stage', title: 'Phase' }], tasks: [task('a')] })
    expect(draft.tasks).toEqual([])
    expect(readyPlanTasks(extended)).toEqual([])
    expect(readyPlanTasks(change(extended, { action: 'resume' })).map(task => task.id)).toEqual(['a'])
  })

  it('releases dependencies only after a settled submission is accepted with review evidence', () => {
    const first = running()
    expect(readyPlanTasks(first)).toEqual([])
    const completed = submitted(first)
    expect(completed.tasks[0]!.status).toBe('submitted')
    expect(readyPlanTasks(completed)).toEqual([])
    const accepted = change(completed, { action: 'review', taskId: 'a', attemptId: 'attempt-a', decision: 'accepted', reason: 'Criteria verified', references: ['review:1'] })
    expect(readyPlanTasks(accepted).map(task => task.id)).toEqual(['b'])
    expect(completed.tasks[0]!.status).toBe('submitted')
    expect(accepted.tasks[0]!.attempts[0]!.review?.by).toBe('main')
  })

  it('retains rejected evidence and prevents a late previous attempt from overwriting rework', () => {
    const rejected = change(submitted(), { action: 'review', taskId: 'a', attemptId: 'attempt-a', decision: 'rework', reason: 'Missing edge case', references: ['review:failed-edge'] })
    const next = running(rejected, 'a', 'attempt-a-2')
    expect(next.tasks[0]!.attempts.map(attempt => attempt.status)).toEqual(['rejected', 'running'])
    expect(next.tasks[0]!.attempts[0]!.submission).toEqual(evidence)
    expect(settlePlanAttempt(next, 'a', 'attempt-a', { state: 'done', evidence }, 40)).toEqual(next)
  })

  it('lets a worker submit only its own active attempt and rejects review before native settlement', () => {
    const active = running()
    const operation = { action: 'submit' as const, taskId: 'a', attemptId: 'attempt-a', evidence }
    expect(() => change(active, operation, { kind: 'worker', memberId: 'other' })).toThrow('own current attempt')
    const report = change(active, operation, { kind: 'worker', memberId: 'worker' })
    expect(() => change(report, { action: 'review', taskId: 'a', attemptId: 'attempt-a', decision: 'accepted', reason: 'looks done', references: ['review:1'] })).toThrow('settled submission')
    expect(() => change(report, { action: 'pause', reason: 'worker changes global control' }, { kind: 'worker', memberId: 'worker' })).toThrow('coordinator or human')
    const settled = settlePlanAttempt(report, 'a', 'attempt-a', { state: 'done' }, 40)
    expect(settled.tasks[0]!.attempts[0]!.submission).toEqual(evidence)
  })

  it('requires evidence for submission, review and goal completion', () => {
    expect(() => change(running(), { action: 'submit', taskId: 'a', attemptId: 'attempt-a', evidence: { ...evidence, references: [] } })).toThrow('Evidence references')
    expect(() => change(submitted(), { action: 'review', taskId: 'a', attemptId: 'attempt-a', decision: 'accepted', reason: 'done', references: [] })).toThrow('Review evidence')
    const missing = settlePlanAttempt(running(), 'a', 'attempt-a', { state: 'done' }, 40)
    expect(missing.tasks[0]!.status).toBe('failed')
    expect(readyPlanTasks(missing)).toEqual([])
    expect(() => change(submitted(), { action: 'complete', evidence })).toThrow('leaf tasks')
  })

  it('completes only after all remaining leaves are accepted and keeps a goal-level evidence record', () => {
    let plan = submitted(running(planned([task('a')])))
    plan = change(plan, { action: 'review', taskId: 'a', attemptId: 'attempt-a', decision: 'accepted', reason: 'Verified', references: ['review:1'] })
    plan = change(plan, { action: 'complete', evidence }, coordinator, 100)
    expect(plan.status).toBe('completed')
    expect(plan.completion).toEqual(evidence)
    expect(activePlanMs(plan, 10000)).toBe(100)
    expect(() => change(plan, { action: 'resume' })).toThrow('closed')
  })

  it('rejects missing owners, duplicate IDs, missing dependencies and dependency/parent cycles', () => {
    for (const tasks of [
      [task('a', { ownerMemberId: 'unknown' })], [task('a'), task('a')], [task('a', { dependsOn: ['unknown'] })],
      [task('a', { dependsOn: ['b'] }), task('b', { dependsOn: ['a'] })],
      [task('group', { kind: 'group' }), task('child', { parentId: 'group', dependsOn: ['group'] })],
      [task('group', { kind: 'group', dependsOn: ['child'] }), task('child', { parentId: 'group' })],
    ]) expect(() => planned(tasks)).toThrow()
  })

  it('inherits group dependencies and derives group acceptance from all children', () => {
    let plan = planned([task('a'), task('group', { kind: 'group', dependsOn: ['a'] }), task('child', { parentId: 'group' })])
    expect(readyPlanTasks(plan).map(task => task.id)).toEqual(['a'])
    plan = submitted(running(plan))
    plan = change(plan, { action: 'review', taskId: 'a', attemptId: 'attempt-a', decision: 'accepted', reason: 'Verified', references: ['review:1'] })
    expect(readyPlanTasks(plan).map(task => task.id)).toEqual(['child'])
    plan = submitted(running(plan, 'child', 'attempt-child'), 'child', 'attempt-child')
    plan = change(plan, { action: 'review', taskId: 'child', attemptId: 'attempt-child', decision: 'accepted', reason: 'Verified', references: ['review:2'] })
    expect(acceptedTask(plan, 'group')).toBe(true)
    expect(dependencyResults(plan, plan.tasks.find(task => task.id === 'child')!)).toEqual([{ taskId: 'a', submission: evidence }])
    expect(dependencyResults(plan, task('consumer', { dependsOn: ['group', 'a'] }))).toEqual([{ taskId: 'child', submission: evidence }, { taskId: 'a', submission: evidence }])
    expect(() => change(plan, { action: 'extend', stages: [], tasks: [task('later', { parentId: 'group' })] })).toThrow('accepted group')
  })

  it('holds parallel capacity through a submitted but not yet settled native round', () => {
    let plan = planned([task('a'), task('b'), task('c')])
    plan = running(plan)
    plan = change(plan, { action: 'submit', taskId: 'a', attemptId: 'attempt-a', evidence }, { kind: 'worker', memberId: 'worker' })
    plan = queuePlanAttempt(plan, 'b', 'attempt-b', 'delivery:b', 30)
    expect(() => queuePlanAttempt(plan, 'c', 'attempt-c', 'delivery:c', 30)).toThrow('concurrency')
    plan = settlePlanAttempt(plan, 'a', 'attempt-a', { state: 'done' }, 35)
    expect(queuePlanAttempt(plan, 'c', 'attempt-c', 'delivery:c', 40).tasks[2]!.attempts).toHaveLength(1)
  })

  it('enforces total attempts, per-task attempts and active-time budgets before reservation', () => {
    for (const reduced of [{ ...budget, maxAttempts: 1 }, { ...budget, maxAttemptsPerTask: 1 }]) {
      let plan = change(planned(), { action: 'budget', budget: reduced }, human)
      plan = change(submitted(running(plan)), { action: 'review', taskId: 'a', attemptId: 'attempt-a', decision: 'rework', reason: 'Try again', references: ['review:1'] })
      const paused = queuePlanAttempt(plan, 'a', 'attempt-a-2', 'delivery:2', 40)
      expect(paused.status).toBe('paused')
      expect(paused.tasks[0]!.attempts).toHaveLength(1)
    }
    expect(queuePlanAttempt(planned(), 'a', 'attempt-a', 'delivery:a', 1001).status).toBe('paused')
    expect(() => change(planned(), { action: 'budget', budget: { ...budget, maxAttempts: 99 } })).toThrow('Only a human')
  })

  it('pauses dispatch without counting paused wall time and never admits reserved work through a pause', () => {
    let plan = queuePlanAttempt(planned(), 'a', 'attempt-a', 'delivery:a', 20)
    plan = change(plan, { action: 'pause', reason: 'Human inspection' }, human, 50)
    expect(readyPlanTasks(plan)).toEqual([])
    expect(() => admitPlanAttempt(plan, 'a', 'attempt-a', 60)).toThrow('paused')
    plan = change(plan, { action: 'resume' }, human, 10000)
    expect(activePlanMs(plan, 10010)).toBe(60)
    expect(admitPlanAttempt(plan, 'a', 'attempt-a', 10010).tasks[0]!.attempts[0]!.status).toBe('running')
  })

  it('requires human reconciliation after restart and retains unstarted reservations', () => {
    let plan = running(planned([task('a'), task('b')]))
    plan = queuePlanAttempt(plan, 'b', 'attempt-b', 'delivery:b', 30)
    plan = recoverPlan(plan, 40)
    expect(plan.status).toBe('paused')
    expect(plan.tasks.map(task => task.attempts[0]!.status)).toEqual(['uncertain', 'queued'])
    expect(() => change(plan, { action: 'resume' }, human)).toThrow('uncertain')
    const reconcile = { action: 'reconcile' as const, taskId: 'a', attemptId: 'attempt-a', outcome: 'submitted' as const, evidence }
    expect(() => change(plan, reconcile)).toThrow('Only a human')
    plan = change(plan, reconcile, human)
    expect(plan.status).toBe('paused')
    expect(plan.reason).toBe('Interrupted attempts reconciled; review and resume explicitly')
    expect(plan.tasks[0]!.attempts[0]!.error).toBeUndefined()
    expect(change(plan, { action: 'resume' }, human).status).toBe('running')
  })

  it('makes matching retries idempotent, rejects changed request IDs and fences stale coordinator edits', () => {
    const plan = planned()
    const command: PlanCommand = { action: 'pause', reason: 'inspect', requestId: 'retry-id', expectedRevision: plan.revision }
    const context = { actor: coordinator, memberIds: members, now: 40 }
    const changed = changePlan(plan, command, context)
    expect(changePlan(changed, command, context)).toEqual(changed)
    expect(() => changePlan(changed, { ...command, reason: 'changed' }, context)).toThrow('reused')
    expect(() => changePlan(changed, { ...command, requestId: 'new-id' }, context)).toThrow('revision changed')
  })
})
