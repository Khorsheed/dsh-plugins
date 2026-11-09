import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { coordinatorMember, memberId, replay } from './journal.ts'
import { activePlanMs, attemptInterrupted, dependencyResults, admitPlanAttempt, changePlan, interruptPlanAttempt, parsePlanCommand, pausedByRestart, PLAN_RESTART_STOPPED_REASON, planCommandSignature, queuePlanAttempt, readyPlanTasks, recoverPlan, settlePlanAttempt } from './plan.ts'
import type { PlanActor, PlanRestartGuards, RoomPlan } from './plan.ts'
import type { DispatchEngine } from './dispatch.ts'
import { previousHostProcessStart, restartInitiatorMember } from './dispatch.ts'
import { replayDeliveries } from './deliveries.ts'
import { deliveryEnding, interruptedByRestart } from './restart-interrupted.ts'
import { autoContinueOn } from './restart-continue.ts'

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
  /** Cold inspection projects the restart recovery (interrupted attempts closed) without writing or starting agents. */
  view(sessionId: string, view: Omit<RoomPlan, 'requests'>): Omit<RoomPlan, 'requests'> {
    if (this.recovered.has(sessionId)) return view
    const { requests: _requests, ...recovered } = recoverPlan({ ...view, requests: [] }, Date.now(), { autoContinue: view.status === 'running' })
    return recovered
  }

  /**
   * What decides whether the goal keeps running after this restart: the
   * room's 重启后自动继续 setting and pause, the member that requested the
   * restart (the guard's record), and the previous host process's start.
   */
  private restartGuards(room: Session): PlanRestartGuards {
    const events = room.snapshotEvents()
    const state = replay(events)
    const initiator = restartInitiatorMember(this.ctx)
    const member = initiator === undefined ? undefined : state.members.find(entry => entry.childSessionId !== undefined && String(entry.childSessionId) === initiator)
    const previousProcessStartedAt = previousHostProcessStart(this.ctx)
    return {
      autoContinue: autoContinueOn(state.settings) && state.settings?.paused !== true,
      ...member === undefined ? {} : { restartInitiator: memberId(events, member) },
      ...previousProcessStartedAt === undefined ? {} : { previousProcessStartedAt },
    }
  }

  /**
   * Settle every unsettled attempt whose delivery the room already closed —
   * a restart's closing, a 「被取代」 from an older version, a goal closed or
   * a task stopped before admission: an attempt never stays `queued` (and
   * holding a parallel slot) behind a delivery that will not run. A delivery
   * a restart cut off closes its attempt as interrupted.
   * @returns the plan with those attempts settled (the same plan when none).
   */
  private syncAttempts(room: Session, plan: RoomPlan): RoomPlan {
    const events = room.snapshotEvents()
    const deliveries = replayDeliveries(events)
    let next = plan
    for (const task of plan.tasks) {
      const attempt = task.attempts.at(-1)
      if (attempt === undefined || attempt.settledAt !== undefined || !['queued', 'running'].includes(attempt.status)) continue
      const dispatch = events.find(event => event.type === 'room/dispatch' && event.data.id === attempt.deliveryId)
      if (dispatch?.type !== 'room/dispatch') continue
      const row = deliveries.find(entry => entry.dispatchSeq === dispatch.seq)
      if (row === undefined || ['queued', 'held', 'running'].includes(row.status)) continue
      if (interruptedByRestart(deliveryEnding(row))) { next = interruptPlanAttempt(next, task.id, attempt.id, Date.now()); continue }
      next = settlePlanAttempt(next, task.id, attempt.id, {
        state: row.status === 'done' ? 'done' : row.status === 'failed' ? 'failed' : 'cancelled',
        ...row.error === undefined ? {} : { error: row.error },
      }, Date.now())
    }
    return next
  }
  async recover(room: Session): Promise<void> {
    return this.locked(room, () => this.recoverUnlocked(room))
  }
  /**
   * Once per room and host process: the restart's recovery of the goal
   * (plan.ts `recoverPlan`). An attempt whose delivery the restart caught
   * already admitted (`running` in the journal, the plan still `queued`)
   * is cut off the same way; the rest follow their deliveries. A goal that
   * keeps running opens its new attempts at once.
   */
  private async recoverUnlocked(room: Session): Promise<void> {
    if (this.recovered.has(room.id)) return
    const current = readPlan(room)
    if (current !== undefined && current.status !== 'completed') {
      const events = room.snapshotEvents()
      const deliveries = replayDeliveries(events)
      // An attempt still `queued` whose delivery was running when the host
      // went away: the restart cut it off after admission.
      const admitted = structuredClone(current)
      for (const task of admitted.tasks) {
        const attempt = task.attempts.at(-1)
        if (attempt?.status !== 'queued' || attempt.settledAt !== undefined) continue
        const dispatch = events.find(event => event.type === 'room/dispatch' && event.data.id === attempt.deliveryId)
        const row = dispatch?.type === 'room/dispatch' ? deliveries.find(entry => entry.dispatchSeq === dispatch.seq) : undefined
        if (row?.status === 'running' || row?.status === 'uncertain') { attempt.status = 'running'; attempt.startedAt ??= row.startedAt ?? Date.now() }
      }
      const recovered = this.syncAttempts(room, recoverPlan(admitted, Date.now(), this.restartGuards(room)))
      room.append('room/plan-state', recovered)
      await this.ctx.sessions.flush(room)
      this.armDeadline(room, recovered)
    }
    this.recovered.add(room.id)
    if (current !== undefined && current.status !== 'completed') await this.pump(room)
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
      const read = readPlan(room)
      // An attempt whose delivery the room closed meanwhile is settled first:
      // the command reads the goal as it really stands.
      const current = read === undefined ? undefined : this.syncAttempts(room, read)
      const next = changePlan(current, command, { actor, memberIds: members, now: Date.now() })
      const wake = actor.kind === 'human' && coordinator !== undefined && next.status === 'running'
        && ((command.action === 'create' && command.mode === 'execute') || (command.action === 'resume' && (current?.status === 'draft' || next.tasks.length === 0)))
        ? room.append('room/dispatch', { id: randomUUID(), origin: 'report', reportFor: `goal-start:${next.id}:${command.requestId}`,
          targets: [coordinator.name], targetIds: [memberId(events, coordinator)], plan: { goalId: next.id },
          text: `The human authorized execution of goal ${next.id}: ${next.objective}. Read room_read, organize appropriate stages and tasks with room_plan, invite members when useful, and dispatch within the recorded budget. Small work can remain direct. Review submitted evidence before accepting tasks; wait for correlated reports instead of polling.`,
        }) : undefined
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
  async settled(room: Session, dispatchSeq: number | undefined, outcome: { state: 'done' | 'failed' | 'cancelled'; interrupted?: 'restart'; text?: string; error?: string }): Promise<void> {
    if (dispatchSeq === undefined) return
    const event = room.snapshotEvents().find(event => event.seq === dispatchSeq)
    if (event?.type !== 'room/dispatch' || event.data.plan?.taskId === undefined || event.data.plan.attemptId === undefined) return
    const { goalId, taskId, attemptId } = event.data.plan
    await this.locked(room, async () => {
      const current = readPlan(room)
      if (current?.id !== goalId) return
      const next = settlePlanAttempt(current, taskId, attemptId, {
        state: outcome.state,
        ...outcome.interrupted === undefined ? {} : { interrupted: outcome.interrupted },
        ...outcome.error === undefined ? {} : { error: outcome.error },
        ...outcome.state === 'done' && outcome.text?.trim() ? { evidence: {
          summary: outcome.text.slice(0, 32000), references: [`room-delivery:${room.id}:${dispatchSeq}`], artifacts: [],
        } } : {},
      }, Date.now())
      await this.write(room, next)
      await this.pump(room)
    })
  }
  /**
   * The human's 「全部继续」 for a goal a restart paused (the composer
   * banner): the goal resumes, and the scheduler opens a new attempt for each
   * task whose attempt was cut off — the same action as the room's own
   * auto-continue (open item 1 A).
   * @param force - continue even when the pause is not the restart's (the banner listed the goal's rounds).
   * @returns whether the goal was continued.
   */
  async continueAfterRestart(room: Session, force: boolean): Promise<boolean> {
    const plan = readPlan(room)
    if (plan?.status !== 'paused' || (!pausedByRestart(plan) && !force)) return false
    try {
      await this.command(room, JSON.stringify({ action: 'resume', requestId: randomUUID(), expectedRevision: plan.revision }), { kind: 'human', memberId: 'human' })
      return true
    } catch (error) {
      this.ctx.logger.warn(`room: continuing goal ${plan.id} after a restart failed: ${String(error)}`)
      return false
    }
  }

  /**
   * The human's 「停止」 for a goal a restart paused: it stays paused as the
   * human's own pause (the banner forgets it; the goal panel resumes it).
   * @returns whether the goal was stopped.
   */
  async stopAfterRestart(room: Session, force: boolean): Promise<boolean> {
    const plan = readPlan(room)
    if (plan?.status !== 'paused' || (!pausedByRestart(plan) && !force)) return false
    await this.command(room, JSON.stringify({ action: 'pause', reason: PLAN_RESTART_STOPPED_REASON, requestId: randomUUID(), expectedRevision: plan.revision, goalId: plan.id }), { kind: 'human', memberId: 'human' })
    return true
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
      // The previous attempt a restart cut off after it had started: this one
      // continues it — the brief says so, and the dispatch records the round
      // it continues (the banner no longer offers it).
      const previous = task.attempts.at(-1)
      const resumes = previous !== undefined && attemptInterrupted(previous) && previous.startedAt !== undefined ? previous : undefined
      const previousDispatch = resumes === undefined ? undefined : events.find(event => event.type === 'room/dispatch' && event.data.id === resumes.deliveryId)
      const continues = previousDispatch?.type === 'room/dispatch' ? (previousDispatch.data.targetIds ?? []).map(target => `${previousDispatch.seq}:${target}`) : []
      const text = [
        `Goal ${plan.id}, task ${task.id}, attempt ${attemptId}.`,
        ...resumes === undefined ? [] : [`上一次尝试（${resumes.id}）被实例重启打断。先核对已经做完的部分——改过的文件、跑过的测试、已有的提交——完成的步骤不要重做，把任务做完，然后照常用 room_plan submit 提交证据。`],
        `Objective: ${plan.objective}`, task.instruction,
        `Acceptance criteria: ${JSON.stringify(task.criteria)}`,
        `Inputs: ${JSON.stringify(task.inputRefs)}. Expected artifacts: ${JSON.stringify(task.artifactPaths)}.`,
        `Accepted dependency results: ${JSON.stringify(dependencyEvidence)}`,
        'Submit your result and evidence with room_plan action submit (taskId, attemptId, evidence: {summary,references,artifacts}, requestId, expectedRevision from room_read). Only the coordinator or human accepts results; do not claim acceptance yourself.',
      ].join('\n')
      const dispatch = room.append('room/dispatch', { id: dispatchId, origin: 'coordinator', targets: [owner.name], targetIds: [task.ownerMemberId!], text,
        plan: { goalId: plan.id, taskId: task.id, attemptId },
        ...memberId(events, coordinator) === task.ownerMemberId ? {} : { replyTo: memberId(events, coordinator) },
        ...continues.length === 0 ? {} : { continues },
      })
      await this.write(room, reserved)
      this.engine().dispatch(room, owner.name, text, { dispatchSeq: dispatch.seq, targetId: task.ownerMemberId! })
      plan = reserved
    }
  }
  dispose(): void { for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear() }
}
