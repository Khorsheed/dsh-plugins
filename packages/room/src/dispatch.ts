/**
 * Dispatch engine: turns `room/dispatch` journal records and confirmed
 * notification relays into member runs. Same-member dispatches serialize on
 * an in-process FIFO (the family resume lock allows one in-flight resume per
 * child session anyway); different members run in parallel. Every lifecycle
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
import type { RoomMember, RoomRelay } from './types.ts'

/** Plugin tag carried by the main-agent followup's message source. */
export const ROOM_PLUGIN = '@khorsheed/dsh-room'

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

/**
 * The per-room dispatch engine. Owned by the RoomService; all state lives in
 * the journal except the in-process FIFO queues (a restart simply has no
 * in-flight runs).
 */
export class DispatchEngine {
  /** memberKey → the queue tail promise. */
  private readonly queues = new Map<string, Promise<void>>()
  private readonly scheduled = new Set<string>()

  /**
   * @param ctx - host context carrying the session store and agents registry.
   */
  constructor(private readonly ctx: Context) {}

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
    return member !== undefined && (this.queues.has(`${room.id} ${memberId(room.snapshotEvents(), member)}`)
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
    const next = tail.then(() => this.run(room, memberName, text, { ...options, targetId }))
      .catch((error: unknown) => { this.ctx.logger.warn(`room: dispatch to "${memberName}" faulted: ${String(error)}`) })
      .finally(() => {
        if (this.queues.get(key) === next) this.queues.delete(key)
        if (deliveryId !== undefined) this.scheduled.delete(`${room.id}:${deliveryId}`)
      })
    this.queues.set(key, next)
  }

  /** Drain includes reports queued by the runs being drained. */
  async idle(): Promise<void> {
    while (this.queues.size > 0) await Promise.all([...this.queues.values()])
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
        if (last?.type === 'room/delivery-state') {
          if (last.data.state === 'running') {
            room.append('room/delivery-state', { id, dispatchSeq: dispatch.seq, memberId: targetId, state: 'uncertain', error: 'Host restarted before a durable settlement; reconcile before retrying' })
            const target = state.members.find(member => memberId(events, member) === targetId)
            if (target !== undefined) {
              const run = state.runs.find(run => run.member === target.name)
              if (run?.state === 'running') room.append('room/run-state', { member: target.name, state: 'failed', startedAt: run.startedAt, error: 'Execution outcome is unknown after restart; reconcile before retrying' })
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
  private async run(room: Session, memberName: string, text: string, options: DispatchOptions): Promise<void> {
    const state = replay(room.snapshotEvents())
    const member = state.members.find(entry => options.targetId === undefined ? entry.name === memberName : memberId(room.snapshotEvents(), entry) === options.targetId)
    // Removed between the dispatch and its execution: nothing to run, and the
    // removal event is already the journal's answer.
    if (member === undefined) return
    if (state.deliveries?.some(delivery => delivery.memberId === member.id && delivery.status === 'uncertain')) return
    memberName = member.name
    const identity = memberId(room.snapshotEvents(), member)
    const deliveryId = options.dispatchSeq === undefined ? undefined : `${options.dispatchSeq}:${identity}`
    if (deliveryId !== undefined) room.append('room/delivery-state', { id: deliveryId, dispatchSeq: options.dispatchSeq!, memberId: identity, state: 'running' })
    const cursor = previousCursor(room.snapshotEvents(), memberName, options.dispatchSeq ?? Number.MAX_SAFE_INTEGER)
    const startedAt = Date.now()
    room.append('room/run-state', { member: memberName, state: 'running', startedAt })
    await this.ctx.sessions.flush(room)
    try {
      if (member.kind === 'main-agent') {
        await this.runMainAgent(room, member, cursor, text, startedAt, options.relayIds ?? [])
      } else {
        await this.runCliMember(room, member, cursor, text, startedAt, options.relayIds ?? [])
      }
    } catch (error: unknown) {
      // Any engine-level fault (adapter throw, followup throw) fails the run
      // loud in the journal; the queue chain continues. The message rides the
      // failed edge so the UI's dim row can say WHY.
      this.ctx.logger.warn(`room: dispatch to "${memberName}" failed: ${String(error)}`)
      await this.settle(room, member, startedAt, 'failed', faultMessage(error))
    } finally {
      if (deliveryId !== undefined) {
        const current = replay(room.snapshotEvents())
        const target = current.members.find(entry => memberId(room.snapshotEvents(), entry) === identity)
        const run = current.runs.find(entry => entry.member === (target?.name ?? memberName))
        const speech = room.snapshotEvents().filter(event => event.type === 'room/speech' && event.data.member === (target?.name ?? memberName)).at(-1)
        const outcome = run?.state === 'running' || run === undefined ? 'uncertain' : run.state
        const text = outcome === 'done' && speech?.type === 'room/speech' ? speech.data.text : undefined
        room.append('room/delivery-state', { id: deliveryId, dispatchSeq: options.dispatchSeq!, memberId: identity, state: outcome,
          ...text === undefined ? {} : { text }, ...run?.error === undefined ? {} : { error: run.error } })
        await this.ctx.sessions.flush(room)
        await this.report(room, options.dispatchSeq!, deliveryId, identity, outcome, text ?? run?.error ?? '')
      }
    }
  }

  private async report(room: Session, dispatchSeq: number, deliveryId: string, fromId: string, outcome: string, text: string): Promise<void> {
    const events = room.snapshotEvents()
    const source = events.find(event => event.seq === dispatchSeq)
    if (source?.type !== 'room/dispatch' || source.data.origin !== 'coordinator' || source.data.replyTo === undefined) return
    if (events.some(event => event.type === 'room/dispatch' && event.data.reportFor === deliveryId)) return
    const state = replay(events)
    const recipient = state.members.find(member => memberId(events, member) === source.data.replyTo)
    const sender = state.members.find(member => memberId(events, member) === fromId)
    if (recipient === undefined) return
    const reportText = `Delegation ${deliveryId} (${sender?.name ?? fromId}) ${outcome}.\n${text.slice(0, 32000)}`
    const report = room.append('room/dispatch', { id: randomUUID(), origin: 'report', reportFor: deliveryId,
      targets: [recipient.name], targetIds: [source.data.replyTo], text: reportText })
    await this.ctx.sessions.flush(room)
    this.dispatch(room, recipient.name, reportText, { dispatchSeq: report.seq, targetId: source.data.replyTo })
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
    text: string, startedAt: number, relayIds: readonly string[],
  ): Promise<void> {
    const agent = this.ctx.agents.get(room.id)
    if (agent === undefined) {
      // Fail loud: the room's own agent is not live, the message goes nowhere.
      await this.settle(room, member, startedAt, 'failed', 'the room session has no live agent')
      return
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
    await this.settle(room, member, startedAt, 'done')
  }

  /** CLI member turn: facade start (first round) or resume, then the speech mirror. */
  private async runCliMember(
    room: Session, member: RoomMember, cursor: number | undefined,
    text: string, startedAt: number, relayIds: readonly string[],
  ): Promise<void> {
    const facade = probeLocalAgent(this.ctx)
    if (facade === undefined) {
      this.ctx.logger.warn(`room: cannot dispatch to "${member.name}": local-agent facade unavailable`)
      await this.settle(room, member, startedAt, 'failed', 'the local-agent delegation facade is unavailable')
      return
    }
    // Roster invariant: cli members always carry a provider (invite enforces).
    const provider = member.provider ?? ''
    // member.cwd is deliberately NOT passed down: the facade's per-call cwd
    // override (family need R2) has not landed — the roster records the
    // intent, the provider still runs in the parent session's cwd.
    const { prompt, carried } = assemblePrompt(room, member, cursor, text, relayIds)
    const prepared = member.childSessionId !== undefined && facade.isPreparedMember?.(member.childSessionId) === true
    const run = prepared
      ? await facade.start(room.id, provider, [{ type: 'text', text: prompt }], { preparedMemberId: member.childSessionId! })
      : member.childSessionId === undefined
      // The invite-time model lands as the delegation's own model: the facade
      // records it with the first start and every later resume re-requests it
      // (providers bind it at spawn for exec and live alike).
      ? await facade.start(room.id, provider, [{ type: 'text' as const, text: prompt }],
          member.model === undefined && member.cwd === undefined ? undefined : { ...member.model === undefined ? {} : { model: member.model }, ...member.cwd === undefined ? {} : { cwd: member.cwd } })
      : await facade.resume(room.id, provider, member.childSessionId, [{ type: 'text' as const, text: prompt }], member.cwd === undefined ? undefined : { cwd: member.cwd })
    if (member.childSessionId === undefined) {
      // Persist the delegation handle: the run id IS the child session id,
      // and journaling it lets a reload reattach the member (resume path).
      room.append('room/member-updated', { name: replay(room.snapshotEvents()).members.find(entry => entry.id === member.id)?.name ?? member.name, childSessionId: run.id })
    }
    await this.markSent(room, [
      ...carried,
      ...replay(room.snapshotEvents()).relays.filter(relay => relayIds.includes(relay.id)),
    ])
    const result = await run.result
    if (result.stopReason === 'completed') {
      const speech = room.append('room/speech', {
        member: replay(room.snapshotEvents()).members.find(entry => entry.id === member.id)?.name ?? member.name,
        text: runOutputText(result.output),
        childSessionId: run.id,
        durationMs: Date.now() - startedAt,
      })
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
          provenance: { kind: 'speech-fallback', speechSeq: speech.seq },
        })
      }
      await this.ctx.sessions.flush(room)
      await this.settle(room, member, startedAt, 'done')
    } else if (result.stopReason === 'aborted') {
      await this.settle(room, member, startedAt, 'cancelled')
    } else {
      await this.settle(room, member, startedAt, 'failed', `the member run ended with stopReason "${result.stopReason}"`)
    }
  }

  /**
   * Append a terminal run-state edge, unless a cancel() already moved THIS
   * run (same startedAt) to a terminal state — the first terminal edge wins.
   * A settle also closes the member's open in_progress task (the dispatch
   * auto-opened it) to the run's OWN terminal state: done on a completed
   * run, cancelled on an abort, failed on a fault. A failed task stays on
   * the board for the human — visible as failed, never spinning — until
   * they dismiss it (closeTask) or re-dispatch. A failed settle carries
   * the human-readable reason on the edge (the client's dim row surfaces
   * it).
   */
  private async settle(
    room: Session, member: RoomMember, startedAt: number,
    state: 'done' | 'cancelled' | 'failed', error?: string,
  ): Promise<void> {
    const events = room.snapshotEvents()
    const memberName = replay(events).members.find(entry => memberId(events, entry) === memberId(events, member))?.name ?? member.name
    const current = replay(events).runs.find(entry => entry.member === memberName)
    if (current !== undefined && current.startedAt === startedAt && current.state !== 'running') return
    room.append('room/run-state', {
      member: memberName, state, startedAt, elapsedMs: Date.now() - startedAt,
      ...error === undefined ? {} : { error },
    })
    for (const task of replay(room.snapshotEvents()).tasks) {
      if (task.member === memberName && task.status === 'in_progress') {
        room.append('room/task-updated', { id: task.id, status: state })
      }
    }
    await this.ctx.sessions.flush(room)
  }
}
