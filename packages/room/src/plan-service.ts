import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { coordinatorMember, memberId, replay } from './journal.ts'
import { activePlanMs, dependencyResults, admitPlanAttempt, changePlan, parsePlanCommand, planCommandSignature, queuePlanAttempt, readyPlanTasks, recoverPlan, settlePlanAttempt } from './plan.ts'
import type { PlanActor, RoomPlan } from './plan.ts'
import type { DispatchEngine } from './dispatch.ts'

export function readPlan(room: Session): RoomPlan | undefined {
  const event = room.snapshotEvents().filter(event => event.type === 'room/plan-state').at(-1)
  return event?.type === 'room/plan-state' ? structuredClone(event.data) : undefined
}

/** One serialized writer for durable goal transitions and automatic leaf dispatch. */
export class PlanService {
  private readonly tails = new Map<string, Promise<unknown>>()
  private readonly recovered = new Set<string>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  constructor(private readonly ctx: Context, private readonly engine: () => DispatchEngine) {}
  private locked<T>(room: Session, action: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(room.id) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(action)
    this.tails.set(room.id, next)
    void next.finally(() => { if (this.tails.get(room.id) === next) this.tails.delete(room.id) }).catch(() => {})
    return next
  }
  /** Cold inspection projects the restart pause without writing or starting agents. */
  view(sessionId: string, view: Omit<RoomPlan, 'requests'>): Omit<RoomPlan, 'requests'> {
    if (this.recovered.has(sessionId)) return view
    const { requests: _requests, ...recovered } = recoverPlan({ ...view, requests: [] }, Date.now())
    return recovered
  }
  async recover(room: Session): Promise<void> {
    return this.locked(room, () => this.recoverUnlocked(room))
  }
  private async recoverUnlocked(room: Session): Promise<void> {
    if (this.recovered.has(room.id)) return
    const current = readPlan(room)
    if (current !== undefined) {
      const recovered = recoverPlan(current, Date.now())
      const events = room.snapshotEvents()
      for (const task of recovered.tasks) {
        const attempt = task.attempts.at(-1)
        if (attempt?.status !== 'queued') continue
        const dispatch = events.find(event => event.type === 'room/dispatch' && event.data.id === attempt.deliveryId)
        if (dispatch?.type !== 'room/dispatch') continue
        const edge = events.filter(event => event.type === 'room/delivery-state' && event.data.dispatchSeq === dispatch.seq).at(-1)
        if (edge?.type === 'room/delivery-state' && ['running', 'uncertain'].includes(edge.data.state)) {
          attempt.status = 'uncertain'; attempt.error = 'Restart interrupted the durable admission boundary'; task.status = 'failed'
          recovered.status = 'paused'; recovered.reason = 'Reconcile uncertain attempts before continuing'
        }
      }
      room.append('room/plan-state', recovered)
      await this.ctx.sessions.flush(room)
    }
    this.recovered.add(room.id)
  }
  private async write(room: Session, plan: RoomPlan): Promise<void> {
    room.append('room/plan-state', plan)
    await this.ctx.sessions.flush(room)
    this.armDeadline(room, plan)
  }
  private armDeadline(room: Session, plan: RoomPlan): void {
    clearTimeout(this.timers.get(room.id)); this.timers.delete(room.id)
    if (plan.status !== 'running') return
    const remaining = Math.max(1, plan.budget.maxActiveMs - activePlanMs(plan, Date.now()))
    const timer = setTimeout(() => {
      void this.locked(room, async () => {
        const current = readPlan(room)
        if (current?.status !== 'running') return
        if (activePlanMs(current, Date.now()) < current.budget.maxActiveMs) { this.armDeadline(room, current); return }
        const paused = changePlan(current, { action: 'pause', reason: 'Active-time budget exhausted', requestId: randomUUID(), expectedRevision: current.revision },
          { actor: { kind: 'coordinator', memberId: 'budget-timer' }, memberIds: new Set(), now: Date.now() })
        await this.write(room, paused)
      }).catch(error => this.ctx.logger.warn(`room: goal deadline persistence failed: ${String(error)}`))
    }, Math.min(remaining, 2147483647))
    timer.unref?.(); this.timers.set(room.id, timer)
  }
  async command(room: Session, json: string, actor: PlanActor): Promise<RoomPlan> {
    const command = parsePlanCommand(json)
    return this.locked(room, async () => {
      await this.recoverUnlocked(room)
      const events = room.snapshotEvents()
      const state = replay(events)
      const members = new Set(state.members.map(member => memberId(events, member)))
      if (actor.kind !== 'human' && !members.has(actor.memberId)) throw new Error('Calling member left the room')
      const coordinator = coordinatorMember(state, events)
      if (actor.kind === 'coordinator' && (coordinator === undefined || memberId(events, coordinator) !== actor.memberId)) throw new Error('Coordinator changed before command admission')
      // Check all revisions, including a previous closed goal, before reusing an identity.
      const earlier = events.filter(event => event.type === 'room/plan-state').flatMap(event => event.type === 'room/plan-state' ? event.data.requests : []).find(receipt => receipt.id === command.requestId)
      if (earlier !== undefined) {
        if (earlier.signature !== planCommandSignature(command)) throw new Error('Plan request identity was reused for different input')
        await this.ctx.sessions.flush(room)
        await this.pump(room)
        await this.engine().recover(room)
        return readPlan(room)!
      }
      const current = readPlan(room)
      const next = changePlan(current, command, { actor, memberIds: members, now: Date.now() })
      const wake = actor.kind === 'human' && coordinator !== undefined && next.status === 'running'
        && ((command.action === 'create' && command.mode === 'execute') || (command.action === 'resume' && (current?.status === 'draft' || next.tasks.length === 0)))
        ? room.append('room/dispatch', { id: randomUUID(), origin: 'report', reportFor: `goal-start:${next.id}:${command.requestId}`,
          targets: [coordinator.name], targetIds: [memberId(events, coordinator)], plan: { goalId: next.id },
          text: `The human authorized execution of goal ${next.id}: ${next.objective}. Read room_read, organize appropriate stages and tasks with room_plan, invite members when useful, and dispatch within the recorded budget. Small work can remain direct. Review submitted evidence before accepting tasks; wait for correlated reports instead of polling.`,
        }) : undefined
      if (command.action === 'reconcile') this.reconcileDelivery(room, next, command.taskId, command.attemptId, command.requestId)
      await this.write(room, next)
      await this.pump(room)
      if (wake !== undefined && coordinator !== undefined) this.engine().dispatch(room, coordinator.name, wake.data.text, { dispatchSeq: wake.seq, targetId: memberId(events, coordinator) })
      // Resumption can release durable reports and reservations that survived a pause.
      if (command.action === 'resume' || command.action === 'cancel' || command.action === 'complete') await this.engine().recover(room)
      return readPlan(room)!
    })
  }
  allows(room: Session, dispatchSeq?: number): boolean {
    if (dispatchSeq === undefined) return true
    const event = room.snapshotEvents().find(event => event.seq === dispatchSeq)
    if (event?.type !== 'room/dispatch' || event.data.plan === undefined) return true
    const plan = readPlan(room)
    return this.recovered.has(room.id) && plan?.id === event.data.plan.goalId && plan.status === 'running'
  }
  async admitted(room: Session, dispatchSeq?: number): Promise<void> {
    if (dispatchSeq === undefined) return
    const event = room.snapshotEvents().find(event => event.seq === dispatchSeq)
    if (event?.type !== 'room/dispatch' || event.data.plan === undefined) return
    const link = event.data.plan
    await this.locked(room, async () => {
      await this.recoverUnlocked(room)
      const plan = readPlan(room)
      if (plan?.id !== link.goalId || plan.status !== 'running') throw new Error('Goal no longer permits automatic work')
      if (link.taskId !== undefined && link.attemptId !== undefined) await this.write(room, admitPlanAttempt(plan, link.taskId, link.attemptId, Date.now()))
    })
  }
  async settled(room: Session, dispatchSeq: number | undefined, outcome: { state: 'done' | 'failed' | 'cancelled'; text?: string; error?: string }): Promise<void> {
    if (dispatchSeq === undefined) return
    const event = room.snapshotEvents().find(event => event.seq === dispatchSeq)
    if (event?.type !== 'room/dispatch' || event.data.plan?.taskId === undefined || event.data.plan.attemptId === undefined) return
    const { goalId, taskId, attemptId } = event.data.plan
    await this.locked(room, async () => {
      const current = readPlan(room)
      if (current?.id !== goalId) return
      const next = settlePlanAttempt(current, taskId, attemptId, {
        state: outcome.state,
        ...outcome.error === undefined ? {} : { error: outcome.error },
        ...outcome.state === 'done' && outcome.text?.trim() ? { evidence: {
          summary: outcome.text.slice(0, 32000), references: [`room-delivery:${room.id}:${dispatchSeq}`], artifacts: [],
        } } : {},
      }, Date.now())
      await this.write(room, next)
      await this.pump(room)
    })
  }
  /** Human goal reconciliation settles its room delivery and supersedes stale queued reports. */
  private reconcileDelivery(room: Session, plan: RoomPlan, taskId: string, attemptId: string, requestId: string): void {
    const attempt = plan.tasks.find(task => task.id === taskId)?.attempts.find(attempt => attempt.id === attemptId)
    if (attempt === undefined) return
    const events = room.snapshotEvents()
    const dispatch = events.find(event => event.type === 'room/dispatch' && event.data.id === attempt.deliveryId)
    if (dispatch?.type !== 'room/dispatch') return
    const state = replay(events)
    for (const target of dispatch.data.targetIds ?? []) {
      const deliveryId = `${dispatch.seq}:${target}`
      const member = state.members.find(member => memberId(events, member) === target)
      const run = state.runs.find(run => run.member === member?.name)
      if (run?.runId === deliveryId && ['running', 'failed'].includes(run.state)) room.append('room/run-state', { member: run.member, runId: run.runId, startedAt: run.startedAt, state: attempt.status === 'submitted' ? 'done' : 'failed',
        ...attempt.status === 'failed' ? { error: attempt.submission?.summary ?? 'Human reconciled the attempt as failed' } : {} })
      room.append('room/delivery-state', { id: deliveryId, dispatchSeq: dispatch.seq, memberId: target,
        state: attempt.status === 'submitted' ? 'done' : 'failed', text: attempt.submission?.summary ?? 'Human reconciliation' })
      for (const oldReport of events) {
        if (oldReport.type !== 'room/dispatch' || oldReport.data.reportFor !== deliveryId) continue
        for (const recipient of oldReport.data.targetIds ?? []) {
          const oldId = `${oldReport.seq}:${recipient}`
          if (state.deliveries?.find(delivery => delivery.id === oldId)?.status === 'queued') room.append('room/delivery-state', { id: oldId, dispatchSeq: oldReport.seq, memberId: recipient, state: 'cancelled', error: 'Superseded by human reconciliation' })
        }
      }
    }
    const coordinator = coordinatorMember(state, events)
    if (coordinator !== undefined) room.append('room/dispatch', { id: randomUUID(), origin: 'report', reportFor: `reconcile:${attempt.id}:${requestId}`,
      targets: [coordinator.name], targetIds: [memberId(events, coordinator)], plan: { goalId: plan.id },
      text: `Human reconciled task ${taskId}, attempt ${attemptId} as ${attempt.status}. Evidence: ${JSON.stringify(attempt.submission)}. Read the current plan before reviewing or retrying.`,
    })
  }

  private async pump(room: Session): Promise<void> {
    let plan = readPlan(room)
    if (plan?.status !== 'running') return
    for (const task of readyPlanTasks(plan)) {
      const events = room.snapshotEvents()
      const state = replay(events)
      const owner = state.members.find(member => memberId(events, member) === task.ownerMemberId)
      const coordinator = coordinatorMember(state, events)
      if (owner === undefined || coordinator === undefined) {
        await this.write(room, changePlan(plan, { action: 'pause', reason: 'A task owner or coordinator is unavailable', requestId: randomUUID(), expectedRevision: plan.revision },
          { actor: { kind: 'coordinator', memberId: 'scheduler' }, memberIds: new Set(), now: Date.now() }))
        return
      }
      // Reserve against budgets before appending a dispatch. The dispatch ID is
      // an opaque correlation identity; the execution journal also retains its seq.
      const attemptId = randomUUID()
      const dispatchId = randomUUID()
      let reserved: RoomPlan
      try { reserved = queuePlanAttempt(plan, task.id, attemptId, dispatchId, Date.now()) }
      catch (error) { if (String(error).includes('concurrency is full')) return; throw error }
      if (reserved.status !== 'running') { await this.write(room, reserved); return }
      const dependencyEvidence = dependencyResults(plan, task)
      const text = [
        `Goal ${plan.id}, task ${task.id}, attempt ${attemptId}.`,
        `Objective: ${plan.objective}`, task.instruction,
        `Acceptance criteria: ${JSON.stringify(task.criteria)}`,
        `Inputs: ${JSON.stringify(task.inputRefs)}. Expected artifacts: ${JSON.stringify(task.artifactPaths)}.`,
        `Accepted dependency results: ${JSON.stringify(dependencyEvidence)}`,
        'Submit your result and evidence with room_plan action submit (taskId, attemptId, evidence: {summary,references,artifacts}, requestId, expectedRevision from room_read). Only the coordinator or human accepts results; do not claim acceptance yourself.',
      ].join('\n')
      const dispatch = room.append('room/dispatch', { id: dispatchId, origin: 'coordinator', targets: [owner.name], targetIds: [task.ownerMemberId!], text,
        plan: { goalId: plan.id, taskId: task.id, attemptId },
        ...memberId(events, coordinator) === task.ownerMemberId ? {} : { replyTo: memberId(events, coordinator) },
      })
      await this.write(room, reserved)
      this.engine().dispatch(room, owner.name, text, { dispatchSeq: dispatch.seq, targetId: task.ownerMemberId! })
      plan = reserved
    }
  }
  dispose(): void { for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear() }
}
