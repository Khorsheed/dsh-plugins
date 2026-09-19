/**
 * Dispatch engine: turns `room/dispatch` journal records and confirmed
 * notification relays into member runs. Same-member dispatches serialize on
 * a submission chain until a stable native identity exists, then enter the
 * family's whole-turn FIFO; different members run in parallel. Every lifecycle
 * edge lands in the journal (`room/run-state` running → done/cancelled/
 * failed, plus `room/speech` for a CLI member's reply), so a reload replays
 * the exact dispatch history — but speech/dispatch events are UI projection
 * and replay ONLY: no prompt ever consumes the room's running log.
 *
 * The prompt every member receives is uniform (the design note's roster +
 * notifications contract): role instructions (first dispatch, or an edit
 * carried as an update) + the room goal (one line, every dispatch — cheap,
 * and it orients the task) + the roster (who exists, with the notification
 * protocol) ONLY when the member has never seen it or it changed since their
 * last dispatch ({@link rosterStaleSince}) + the member's
 * confirmed-undelivered notifications + this dispatch's text. The member's
 * own CLI session (resume chain) holds its working memory; room never
 * resends what it has seen.
 * @module @khorsheed/dsh-room/dispatch
 */
import { replayDeliveries } from './deliveries.ts'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
// Type-only: pulls the `agents` registry merge onto Context.
import type {} from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { probeLocalAgent, runOutputText } from './adapter.ts'
import { coordinatorMember, memberId, parseRelayDirective, pendingInstructions, previousCursor, replay, rosterStaleSince } from './journal.ts'
import type { RoomMember, RoomRelay, RoomState } from './types.ts'

/** Plugin tag carried by the main-agent followup's message source. */
export const ROOM_PLUGIN = '@khorsheed/dsh-room'

function closedGoal(state: RoomState, goalId: string | undefined): boolean {
  return goalId !== undefined && state.plan !== undefined
    && (state.plan.id !== goalId || ['completed', 'cancelled'].includes(state.plan.status))
}

/** Extra dispatch context beyond the text. */
export interface DispatchOptions {
  /**
   * The appended `room/dispatch` event's seq. Omitted for a dispatch that is
   * not itself journaled (a relay delivery): the instruction cursor then
   * reads against the whole log.
   */
  readonly dispatchSeq?: number
  readonly targetId?: string
  /** Relays this dispatch DELIVERS (confirmRelay's own payloads). */
  readonly relayIds?: readonly string[]
}

/**
 * The roster section: one line per OTHER member (name, provider, one-line
 * role) plus the notification protocol — the fallback channel's trailing
 * own-line `@name <content>` format lives here so a member can reach others
 * without any bridge tooling. Carried only when the member has never seen
 * the roster or it changed since their last dispatch ({@link rosterStaleSince});
 * the member's own session holds it in between. The room GOAL is NOT part of
 * this section: it rides every dispatch on its own line (cheap, and it
 * orients the task).
 */
function rosterSection(state: { readonly members: readonly RoomMember[] }, self: string): string {
  const lines = state.members
    .filter(member => member.name !== self)
    .map((member) => {
      const provider = member.kind === 'main-agent' ? '主 agent' : member.provider ?? ''
      const role = member.instructions?.split('\n', 1)[0]?.trim()
      return `- ${member.name}（${provider}）${role === undefined || role === '' ? '' : `：${role}`}`
    })
  return [
    '【成员名册】',
    ...lines,
    '通知协议：要通知某个成员，在回复末尾独占一行写 `@名字 <内容>`；该行会被转交给对方（一阶段需房间主人确认）。',
  ].join('\n')
}

/** The notifications section: confirmed-undelivered relays addressed to the member. */
function notificationsSection(relays: readonly RoomRelay[]): string {
  return ['【通知】', ...relays.map(relay => `- ${relay.from} 给你的通知: ${relay.content}`)].join('\n')
}

/**
 * Assemble the uniform member prompt: role-instructions carry, then the room
 * goal (every dispatch), then the roster (only when stale for this member),
 * then the member's confirmed-undelivered notifications (except the ones
 * this dispatch's own text already delivers), then this dispatch's text.
 */
function assemblePrompt(
  room: Session,
  member: RoomMember,
  cursor: number | undefined,
  text: string,
  relayIds: readonly string[],
): { readonly prompt: string; readonly carried: readonly RoomRelay[] } {
  const state = replay(room.snapshotEvents())
  const carried = state.relays.filter(relay =>
    relay.state === 'confirmed' && relay.to === member.name && !relayIds.includes(relay.id))
  const sections: string[] = []
  const handoff = room.snapshotEvents().filter(event => event.type === 'room/coordinator' && event.data.memberId === memberId(room.snapshotEvents(), member)).at(-1)
  if (handoff?.type === 'room/coordinator' && (cursor === undefined || handoff.seq > cursor)) sections.push(handoff.data.handoff)
  if (coordinatorMember(state, room.snapshotEvents())?.name === member.name) sections.push('You are the room coordinator. Handle ordinary chat directly; delegate small work in the background using room tools. Establish a goal plan only when useful for the requested execution. Delegate results arrive as correlated reports; do not poll while waiting.')
  const pending = pendingInstructions(room.snapshotEvents(), member.name, cursor)
  if (pending?.kind === 'initial') sections.push(`你的角色指令：${pending.instructions}`)
  if (pending?.kind === 'update') sections.push(`你的角色指令更新为：${pending.instructions}`)
  if (state.goal !== undefined) sections.push(`本房间的目标：${state.goal}`)
  if (rosterStaleSince(room.snapshotEvents(), cursor)) sections.push(rosterSection(state, member.name))
  if (carried.length > 0) sections.push(notificationsSection(carried))
  sections.push(text)
  return { prompt: sections.join('\n\n'), carried }
}

/** The human-readable reason a run failed (Error message, else String()). */
function faultMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface RunOutcome {
  readonly state: 'done' | 'cancelled' | 'failed'
  readonly text?: string
  readonly error?: string
}

export interface DispatchHooks {
  allows?(room: Session, dispatchSeq?: number): boolean
  admitted?(room: Session, dispatchSeq?: number): Promise<void>
  settled?(room: Session, dispatchSeq: number | undefined, outcome: RunOutcome): Promise<void>
}

/**
 * The per-room dispatch engine. Owned by the RoomService; all state lives in
 * the journal except the in-process FIFO queues (a restart simply has no
 * in-flight runs).
 */
export class DispatchEngine {
  /** memberKey → the queue tail promise. */
  private readonly queues = new Map<string, Promise<void>>()
  private readonly scheduled = new Set<string>()
  private readonly inFlight = new Map<Promise<void>, string>()

  /**
   * @param ctx - host context carrying the session store and agents registry.
   */
  constructor(private readonly ctx: Context, private readonly hooks: DispatchHooks = {}) {}

  /**
   * Enqueue a dispatch for execution. Fire-and-forget: the outcome is
   * journaled as run-state/speech events, never returned to the caller.
   * @param room - the room session.
   * @param memberName - the dispatch target.
   * @param text - the dispatch text.
   * @param options - dispatch-event seq and/or the relays this run delivers.
   */
  hasPending(room: Session, memberName: string): boolean {
    const member = replay(room.snapshotEvents()).members.find(member => member.name === memberName)
    return member !== undefined && ([...this.inFlight.values()].includes(`${room.id} ${memberId(room.snapshotEvents(), member)}`)
      || replayDeliveries(room.snapshotEvents()).some(delivery => delivery.memberId === member.id && ['queued', 'running', 'uncertain'].includes(delivery.status)))
  }

  dispatch(room: Session, memberName: string, text: string, options: DispatchOptions = {}): void {
    const events = room.snapshotEvents()
    const member = replay(events).members.find(entry => entry.name === memberName)
    if (member === undefined) return
    const targetId = options.targetId ?? memberId(events, member)
    const key = `${room.id} ${targetId}`
    const deliveryId = options.dispatchSeq === undefined ? undefined : `${options.dispatchSeq}:${targetId}`
    if (deliveryId !== undefined) {
      const scopedId = `${room.id}:${deliveryId}`
      if (this.scheduled.has(scopedId) || events.some(event => event.type === 'room/delivery-state' && event.data.id === deliveryId)) return
      this.scheduled.add(scopedId)
    }
    const tail = this.queues.get(key) ?? Promise.resolve()
    let submitted!: () => void
    const submission = new Promise<void>(resolve => { submitted = resolve })
    const next = tail.then(() => this.run(room, memberName, text, { ...options, targetId }, submitted))
      .catch((error: unknown) => { this.ctx.logger.warn(`room: dispatch to "${memberName}" faulted: ${String(error)}`) })
      .finally(() => {
        submitted()
        this.inFlight.delete(next)
        if (deliveryId !== undefined) this.scheduled.delete(`${room.id}:${deliveryId}`)
      })
    this.inFlight.set(next, key)
    this.queues.set(key, submission)
    void submission.then(() => { if (this.queues.get(key) === submission) this.queues.delete(key) })
  }

  /** Drain includes reports queued by the runs being drained. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight.keys()])
  }

  /** Read-only recovery projection: persisted running edges are not live processes. */
  view(sessionId: string, state: RoomState): RoomState {
    const error = 'Execution outcome is unknown after restart; reconcile before retrying'
    return {
      ...state,
      ...state.deliveries === undefined ? {} : { deliveries: state.deliveries.map(row => row.status === 'queued' && closedGoal(state, row.plan?.goalId)
        ? { ...row, status: 'cancelled' as const } : row.status === 'running' && !this.scheduled.has(`${sessionId}:${row.id}`)
          ? { ...row, status: 'uncertain' as const, error } : row) },
      runs: state.runs.map(run => {
        const member = state.members.find(row => row.name === run.member)
        const active = run.runId === undefined
          ? member !== undefined && [...this.inFlight.values()].includes(`${sessionId} ${member.id}`)
          : this.scheduled.has(`${sessionId}:${run.runId}`)
        return run.state === 'running' && !active ? { ...run, state: 'failed' as const, error } : run
      }),
    }
  }

  /** Restore accepted targets, never repeat an execution whose settlement is unknown. */
  async recover(room: Session): Promise<void> {
    const events = room.snapshotEvents()
    const state = replay(events)
    for (const dispatch of events) {
      if (dispatch.type !== 'room/dispatch' || dispatch.data.targetIds === undefined) continue
      for (const targetId of dispatch.data.targetIds) {
        const id = `${dispatch.seq}:${targetId}`
        if (this.scheduled.has(`${room.id}:${id}`)) continue
        const edges = events.filter(event => event.type === 'room/delivery-state' && event.data.id === id)
        const last = edges.at(-1)
        if (last === undefined && closedGoal(state, dispatch.data.plan?.goalId)) {
          room.append('room/delivery-state', { id, dispatchSeq: dispatch.seq, memberId: targetId, state: 'cancelled', error: 'Goal closed before delivery admission' })
          await this.ctx.sessions.flush(room)
          continue
        }
        if (last?.type === 'room/delivery-state') {
          if (last.data.state === 'running') {
            room.append('room/delivery-state', { id, dispatchSeq: dispatch.seq, memberId: targetId, state: 'uncertain', error: 'Host restarted before a durable settlement; reconcile before retrying' })
            const target = state.members.find(member => memberId(events, member) === targetId)
            if (target !== undefined) {
              const run = state.runs.find(run => run.member === target.name)
              if (run?.state === 'running' && (run.runId === undefined || run.runId === id)) room.append('room/run-state', { member: target.name, state: 'failed', startedAt: run.startedAt, ...run.runId === undefined ? {} : { runId: run.runId }, error: 'Execution outcome is unknown after restart; reconcile before retrying' })
            }
            await this.ctx.sessions.flush(room)
            await this.report(room, dispatch.seq, id, targetId, 'uncertain', 'Execution outcome is unknown after restart; reconcile before retrying')
          } else {
            await this.report(room, dispatch.seq, id, targetId, last.data.state, last.data.text ?? last.data.error ?? '')
          }
          continue
        }
        const target = state.members.find(member => memberId(events, member) === targetId)
        if (target !== undefined && !state.deliveries?.some(row => row.memberId === targetId && (row.status === 'running' || row.status === 'uncertain'))) this.dispatch(room, target.name, dispatch.data.text, { dispatchSeq: dispatch.seq, targetId })
      }
    }
  }

  /** Execute one dispatch: run-state running → member turn → settle edges. */
  private async run(room: Session, memberName: string, text: string, options: DispatchOptions, submitted: () => void): Promise<void> {
    if (this.hooks.allows?.(room, options.dispatchSeq) === false) return
    const state = replay(room.snapshotEvents())
    const member = state.members.find(entry => options.targetId === undefined ? entry.name === memberName : memberId(room.snapshotEvents(), entry) === options.targetId)
    // Removed between the dispatch and its execution: nothing to run, and the
    // removal event is already the journal's answer.
    if (member === undefined) return
    if (state.deliveries?.some(delivery => delivery.memberId === member.id && delivery.status === 'uncertain')) return
    memberName = member.name
    const identity = memberId(room.snapshotEvents(), member)
    const deliveryId = options.dispatchSeq === undefined ? undefined : `${options.dispatchSeq}:${identity}`
    const runId = deliveryId ?? randomUUID()
    const cursor = previousCursor(room.snapshotEvents(), memberName, options.dispatchSeq ?? Number.MAX_SAFE_INTEGER)
    let startedAt: number | undefined
    const admitted = async (): Promise<number> => {
      if (startedAt !== undefined) throw new Error('Room delivery was admitted twice')
      startedAt = Date.now()
      if (deliveryId !== undefined) room.append('room/delivery-state', { id: deliveryId, dispatchSeq: options.dispatchSeq!, memberId: identity, state: 'running' })
      memberName = replay(room.snapshotEvents()).members.find(entry => memberId(room.snapshotEvents(), entry) === identity)?.name ?? memberName
      room.append('room/run-state', { member: memberName, state: 'running', startedAt, runId })
      await this.hooks.admitted?.(room, options.dispatchSeq)
      await this.ctx.sessions.flush(room)
      return startedAt
    }
    let outcome: RunOutcome
    try {
      outcome = member.kind === 'main-agent'
        ? await this.runMainAgent(room, member, cursor, text, await admitted(), options.relayIds ?? [])
        : await this.runCliMember(room, member, cursor, text, admitted, options.relayIds ?? [], submitted)
    } catch (error: unknown) {
      this.ctx.logger.warn(`room: dispatch to "${memberName}" failed: ${String(error)}`)
      outcome = { state: 'failed', error: faultMessage(error) }
    }
    outcome = await this.settle(room, member, runId, startedAt ?? Date.now(), outcome)
    await this.hooks.settled?.(room, options.dispatchSeq, outcome)
    if (deliveryId !== undefined) {
      room.append('room/delivery-state', { id: deliveryId, dispatchSeq: options.dispatchSeq!, memberId: identity, state: outcome.state,
        ...outcome.text === undefined ? {} : { text: outcome.text }, ...outcome.error === undefined ? {} : { error: outcome.error } })
      await this.ctx.sessions.flush(room)
      await this.report(room, options.dispatchSeq!, deliveryId, identity, outcome.state, outcome.text ?? outcome.error ?? '')
    }
  }

  private async report(room: Session, dispatchSeq: number, deliveryId: string, fromId: string, outcome: string, text: string): Promise<void> {
    const events = room.snapshotEvents()
    const source = events.find(event => event.seq === dispatchSeq)
    if (source?.type !== 'room/dispatch' || source.data.origin !== 'coordinator' || source.data.replyTo === undefined) return
    if (events.some(event => event.type === 'room/dispatch' && event.data.reportFor === deliveryId)) return
    const state = replay(events)
    if (closedGoal(state, source.data.plan?.goalId)) return
    const recipient = source.data.plan === undefined ? state.members.find(member => memberId(events, member) === source.data.replyTo) : coordinatorMember(state, events)
    const sender = state.members.find(member => memberId(events, member) === fromId)
    if (recipient === undefined) return
    const reportText = `Delegation ${deliveryId} (${sender?.name ?? fromId}) ${outcome}.\n${text.slice(0, 32000)}`
    const report = room.append('room/dispatch', { id: randomUUID(), origin: 'report', reportFor: deliveryId,
      targets: [recipient.name], targetIds: [memberId(events, recipient)], text: reportText,
      ...source.data.plan === undefined ? {} : { plan: { goalId: source.data.plan.goalId } } })
    await this.ctx.sessions.flush(room)
    if (this.hooks.allows?.(room, report.seq) !== false) this.dispatch(room, recipient.name, reportText, { dispatchSeq: report.seq, targetId: memberId(events, recipient) })
  }

  /**
   * Mark the relays this run delivered as sent. Delivery = the member's own
   * session received the prompt (the followup accepted / the CLI run
   * started): the text lives in the member's private context from then on,
   * so a later run failure cannot un-deliver it.
   */
  private async markSent(room: Session, relays: readonly RoomRelay[]): Promise<void> {
    if (relays.length === 0) return
    for (const relay of relays) room.append('room/relay-resolved', { id: relay.id, state: 'sent' })
    await this.ctx.sessions.flush(room)
  }

  /** Main-agent member turn: a plugin-sourced followup on the room's own agent. */
  private async runMainAgent(
    room: Session, member: RoomMember, cursor: number | undefined,
    text: string, _startedAt: number, relayIds: readonly string[],
  ): Promise<RunOutcome> {
    const agent = this.ctx.agents.get(room.id)
    if (agent === undefined) {
      // Fail loud: the room's own agent is not live, the message goes nowhere.
      return { state: 'failed', error: 'the room session has no live agent' }
    }
    const { prompt, carried } = assemblePrompt(room, member, cursor, text, relayIds)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'plugin', plugin: ROOM_PLUGIN },
    }))
    await this.markSent(room, [
      ...carried,
      ...replay(room.snapshotEvents()).relays.filter(relay => relayIds.includes(relay.id)),
    ])
    // Phase-1 simplicity: the followup's own turn converging to idle IS the
    // run; the main agent's reply is its ordinary assistant speech (no
    // room/speech projection — speech mirrors CLI members only).
    await agent.whenIdle()
    return { state: 'done' }
  }

  /** CLI member turn: facade start (first round) or resume, then the speech mirror. */
  private async runCliMember(
    room: Session, member: RoomMember, cursor: number | undefined,
    text: string, admitted: () => Promise<number>, relayIds: readonly string[], submitted: () => void,
  ): Promise<RunOutcome> {
    const facade = probeLocalAgent(this.ctx)
    if (facade === undefined) {
      this.ctx.logger.warn(`room: cannot dispatch to "${member.name}": local-agent facade unavailable`)
      throw new Error('the local-agent delegation facade is unavailable')
    }
    // Roster invariant: cli members always carry a provider (invite enforces).
    const provider = member.provider ?? ''
    // Modern providers call this only after the whole-turn FIFO and model
    // configuration admit the request. Persistence must finish before native work.
    let startedAt: number | undefined
    const controlled = facade.supportsMemberConfiguration?.(provider) === true
    const admission = controlled ? { onAdmitted: async (): Promise<void> => { startedAt = await admitted() } } : {}
    if (!controlled) startedAt = await admitted()
    const { prompt, carried } = assemblePrompt(room, member, cursor, text, relayIds)
    const prepared = member.childSessionId !== undefined && facade.isPreparedMember?.(member.childSessionId) === true
    const pendingRun = prepared
      ? facade.start(room.id, provider, [{ type: 'text', text: prompt }], { preparedMemberId: member.childSessionId!, ...admission })
      : member.childSessionId === undefined
      // The invite-time model lands as the delegation's own model: the facade
      // records it with the first start and every later resume re-requests it
      // (providers bind it at spawn for exec and live alike).
      ? facade.start(room.id, provider, [{ type: 'text' as const, text: prompt }],
          member.model === undefined && member.cwd === undefined && !controlled ? undefined : { ...admission, ...member.model === undefined ? {} : { model: member.model }, ...member.cwd === undefined ? {} : { cwd: member.cwd } })
      : facade.resume(room.id, provider, member.childSessionId, [{ type: 'text' as const, text: prompt }], member.cwd === undefined && !controlled ? undefined : { ...admission, ...member.cwd === undefined ? {} : { cwd: member.cwd } })
    // Existing members can enter core's queue immediately. A fresh/prepared
    // identity must publish its first handle before the next submission resumes it.
    if (controlled && member.childSessionId !== undefined && !prepared) submitted()
    const run = await pendingRun
    if (startedAt === undefined) {
      await run.dispose()
      throw new Error('Provider published a room run without admission')
    }
    try {
      if (member.childSessionId === undefined) {
        // Persist identity before releasing fresh-member submissions.
        room.append('room/member-updated', { name: replay(room.snapshotEvents()).members.find(entry => entry.id === member.id)?.name ?? member.name, childSessionId: run.id })
      }
      await this.markSent(room, [
        ...carried,
        ...replay(room.snapshotEvents()).relays.filter(relay => relayIds.includes(relay.id)),
      ])
      await this.ctx.sessions.flush(room)
    } catch (error) {
      // Native work already exists. Never claim a terminal room outcome while
      // that work is still active merely because publishing its handle failed.
      await run.result.catch(() => {})
      throw error
    }
    if (controlled) submitted()
    const result = await run.result
    const output = runOutputText(result.output)
    const interrupted = result.stopReason === 'completed' ? undefined
      : result.stopReason === 'aborted' ? 'cancelled' as const : 'failed' as const
    const speech = output !== '' || interrupted === undefined ? room.append('room/speech', {
      member: replay(room.snapshotEvents()).members.find(entry => entry.id === member.id)?.name ?? member.name,
      text: output,
      childSessionId: run.id,
      durationMs: Date.now() - startedAt,
      ...interrupted === undefined ? {} : { interrupted },
    }) : undefined
    if (speech !== undefined) await this.ctx.sessions.flush(room)
    if (result.stopReason === 'completed') {
      // The fallback notification channel: a reply whose trailing own line is
      // `@name <content>` (the roster-taught format) becomes a pending relay
      // at the gate — the same shape the family bridge's member_message
      // produces, so downstream handling is identical.
      const directive = parseRelayDirective(runOutputText(result.output))
      const roster = replay(room.snapshotEvents()).members
      if (directive !== undefined && directive.to !== member.name
        && roster.some(entry => entry.name === directive.to)) {
        room.append('room/relay', {
          id: randomUUID(),
          from: member.name,
          to: directive.to,
          content: directive.content,
          provenance: { kind: 'speech-fallback', speechSeq: speech!.seq },
        })
      }
      await this.ctx.sessions.flush(room)
      return { state: 'done', text: runOutputText(result.output) }
    } else if (result.stopReason === 'aborted') {
      return { state: 'cancelled', text: output }
    } else {
      return { state: 'failed', text: output, error: `the member run ended with stopReason "${result.stopReason}"` }
    }
  }

  /** Settle only this execution and its own task rows, preserving newer runs. */
  private async settle(
    room: Session, member: RoomMember, runId: string, startedAt: number, outcome: RunOutcome,
  ): Promise<RunOutcome> {
    const events = room.snapshotEvents()
    const memberName = replay(events).members.find(entry => memberId(events, entry) === memberId(events, member))?.name ?? member.name
    const terminal = events.find(event => event.type === 'room/run-state' && event.data.runId === runId && event.data.state !== 'running')
    if (terminal?.type === 'room/run-state' && terminal.data.state !== 'running') {
      return { ...outcome, state: terminal.data.state, ...terminal.data.error === undefined ? {} : { error: terminal.data.error } }
    }
    room.append('room/run-state', {
      member: memberName, runId, state: outcome.state, startedAt, elapsedMs: Date.now() - startedAt,
      ...outcome.error === undefined ? {} : { error: outcome.error },
    })
    for (const task of replay(room.snapshotEvents()).tasks) {
      if (task.member === memberName && task.status === 'in_progress' && task.deliveryId === runId) {
        room.append('room/task-updated', { id: task.id, status: outcome.state })
      }
    }
    await this.ctx.sessions.flush(room)
    return outcome
  }
}
