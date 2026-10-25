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
 * The prompt every member receives is uniform: the member's FIRST dispatch
 * opens with one room briefing (identity, public role, private instructions,
 * goal, roster of public roles, the tool-based collaboration contract);
 * every later dispatch carries only what changed since the member's previous
 * one — an instructions edit, one-line room changes ({@link roomChangesSince}),
 * a coordinator handoff — plus the member's confirmed-undelivered
 * notifications and this dispatch's text. The member's own session (resume
 * chain) holds its working memory; room never resends what it has seen, and
 * no member ever receives another member's private instructions.
 * @module @khorsheed/dsh-room/dispatch
 */
import { replayDeliveries } from './deliveries.ts'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the `agents` registry merge onto Context.
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ContextFormed, type MessageSource } from '@deepseek-ai/dsh-llm'
import { probeLocalAgent, runOutputText } from './adapter.ts'
import { composeRoomAgent } from './agent-setup.ts'
import { coordinatorMember, memberId, pendingInstructions, previousCursor, replay, roomChangesSince } from './journal.ts'
import { envelopeLine, messageId, sendOrHold } from './messaging.ts'
import { gateState, judgeReport, outstandingFor, REPORT_HOLD_MS, type GateVerdict } from './report-gate.ts'
import type { RoomHeldDispatch, RoomMember, RoomRelay, RoomState } from './types.ts'

/**
 * The room producer's durable identity in its two historical forms: the
 * released V3 wrapper's `plugin` value (`@khorsheed/dsh-room` — the official
 * V3→V4 migration rewrites it to `kind: 'plugin:@khorsheed/dsh-room'`), and
 * the current producer-owned kind (`room`). {@link isRoomSource} accepts all
 * three forms; new writes always carry the producer kind.
 */
export const ROOM_PLUGIN = '@khorsheed/dsh-room'

/** The producer-owned source kind identifying every room-dispatch followup. */
export const ROOM_KIND = 'room'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** room producer: the main-agent member turn's followup prompt. */
    room: { kind: 'room' } & ContextFormed
  }
}

/** The producer-owned source of a room main-agent followup. */
export function roomSource(): MessageSource {
  return Object.freeze({ kind: ROOM_KIND })
}

/**
 * A run-state edge's child-session identity: the main agent runs on the room
 * itself, external members on their child session. Optional — a fresh CLI
 * member's early running edge predates the child handle's publication (the
 * terminal edge and the journal backfill cover it).
 */
export function runChildSessionId(roomId: SessionId, member: RoomMember | undefined): SessionId | undefined {
  if (member?.kind === 'main-agent') return roomId
  return member?.childSessionId
}

/**
 * The child session round a run reached: the last turn/start the child wrote.
 * Live sessions only — a reconcile path whose child is not in memory omits it.
 */
/**
 * The id of the last assistant message a session's log holds after `afterSeq`:
 * the message a member's round closed with, which per-message tools (Context
 * Lens) address in the member's own session.
 * @param session - the member's session.
 * @param afterSeq - only messages after this seq count.
 * @returns the message id, or undefined when the round produced none.
 */
export function lastAssistantMessageId(session: Session | undefined, afterSeq = -1): string | undefined {
  const event = session?.snapshotEvents().findLast(entry => entry.type === 'assistant/message' && entry.seq > afterSeq)
  const id = (event?.data as { message?: { id?: unknown } } | undefined)?.message?.id
  return typeof id === 'string' ? id : undefined
}

export function runChildTurn(session: Session | undefined): number | undefined {
  const last = session?.snapshotEvents().filter(event => event.type === 'turn/start').at(-1)
  return (last?.data as { turn?: number } | undefined)?.turn
}

/**
 * Whether a durable source belongs to the room producer, in every form the
 * log can hold: the current producer-owned kind (`room`), the V3→V4 migrated
 * kind (`plugin:@khorsheed/dsh-room`), and the released V3 wrapper a pre-V4
 * (0.1.5) host still serves verbatim.
 * @param source - the persisted message source to test.
 * @returns true when the source names this producer.
 */
export function isRoomSource(source: unknown): boolean {
  if (typeof source !== 'object' || source === null) return false
  const record = source as { kind?: unknown; plugin?: unknown }
  return record.kind === ROOM_KIND
    || record.kind === `plugin:${ROOM_PLUGIN}`
    || (record.kind === 'plugin' && record.plugin === ROOM_PLUGIN)
}

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
 * The member's first-dispatch briefing: who it is (name + public role), its
 * private instructions, the goal, everyone else by PUBLIC role only (never
 * their instructions — those read like orders addressed to the reader), and
 * the collaboration contract. Members reach each other through tools —
 * `member_message` on the local-agent bridge for CLI members, `room_message`
 * for the room's own agent — and read the live roster with `room_read`; a
 * trailing `@name` line in a reply is plain text and reaches nobody.
 */
function briefingSection(state: RoomState, member: RoomMember, instructions: string | undefined, coordinator: RoomMember | undefined): string {
  const others = state.members
    .filter(entry => entry.name !== member.name)
    .map((entry) => {
      const facts = [
        ...coordinator?.name === entry.name ? ['协调者'] : [],
        ...entry.role === undefined ? [] : [entry.role],
        entry.kind === 'main-agent' ? '原生 DSH' : entry.kind === 'native' ? `原生 DSH${entry.preset === undefined ? '' : ` · ${entry.preset}`}` : entry.provider ?? '',
      ].filter(Boolean)
      return `- ${entry.name}（${facts.join(' · ')}）`
    })
  return [
    '【房间简报】',
    `你是协作间成员「${member.name}」${member.role === undefined ? '' : `，职责：${member.role}`}${coordinator?.name === member.name ? '，也是本房间的协调者' : ''}。`,
    ...instructions === undefined ? [] : [`你的指令：${instructions}`],
    ...state.goal === undefined ? [] : [`房间目标：${state.goal}`],
    ...others.length === 0 ? [] : ['其他成员：', ...others],
    `联系成员、派活用 ${member.kind === 'cli' ? 'member_message' : 'room_message'}，看房间现状和任务编号用 room_read，用法见工具说明。收到的消息开头标着来自谁和消息编号（#m12）；派给你的活，你这一轮的最终回复会自动回报给派活人，不用另外回复。`,
    // A CLI reaches the room's tools (and its mode's) through an MCP server,
    // which some CLIs keep behind tool discovery rather than in the visible list.
    ...member.kind === 'cli' ? [`这些房间工具由名为 dsh-member 的 MCP 服务提供${member.preset === undefined ? '' : `，你挂的「${member.preset}」模式的插件工具也在这个服务里`}；没在工具列表里直接看到时，用工具发现查找 dsh-member 的工具。`, '需要人拍板或补充信息时，用 dsh-member 的 ask_user_question 把问题和选项发给人点选，不要把一串问题写在回复里；它会等人回答后把答案返回给你。'] : [],
    ...coordinator?.name === member.name ? ['作为协调者：普通对话直接回答，小任务派给成员，只在确有需要时建立正式目标。派完活就结束这一轮，回报会自己送到——不要 sleep 等待，也不要用 room_read 查结果。收到回报时用户已经看过成员的原话：需要推进就推进，否则一两句话即可，不要复述或做汇总表。'] : [],
  ].join('\n')
}

/** The notifications section: confirmed-undelivered relays addressed to the member. */
function notificationsSection(relays: readonly RoomRelay[]): string {
  return ['【通知】', ...relays.map(relay => `- ${relay.from} 给你的通知: ${relay.content}`)].join('\n')
}

/**
 * Assemble the uniform member prompt: the briefing on the member's first
 * dispatch, otherwise only what changed since its previous one (handoff,
 * instructions edit, room changes); then the member's confirmed-undelivered
 * notifications (except the ones this dispatch's own text already delivers),
 * then this dispatch's text.
 */
function assemblePrompt(
  room: Session,
  member: RoomMember,
  cursor: number | undefined,
  text: string,
  relayIds: readonly string[],
  dispatchSeq: number | undefined,
): { readonly prompt: string; readonly carried: readonly RoomRelay[]; readonly heldCarried: readonly number[] } {
  const state = replay(room.snapshotEvents())
  const carried = state.relays.filter(relay =>
    relay.state === 'confirmed' && relay.to === member.name && !relayIds.includes(relay.id))
  const sections: string[] = []
  const events = room.snapshotEvents()
  const coordinator = coordinatorMember(state, events)
  const handoff = events.filter(event => event.type === 'room/coordinator' && event.data.memberId === memberId(events, member)).at(-1)
  const pending = pendingInstructions(events, member.name, cursor)
  if (cursor === undefined) {
    sections.push(briefingSection(state, member, pending?.instructions, coordinator))
    if (handoff?.type === 'room/coordinator') sections.push(handoff.data.handoff)
  } else {
    if (handoff?.type === 'room/coordinator' && handoff.seq > cursor) sections.push(`你现在是本房间的协调者。\n${handoff.data.handoff}`)
    if (pending?.kind === 'update') sections.push(`你的指令更新为：${pending.instructions}`)
    const changes = roomChangesSince(events, cursor, member.name)
    if (changes.length > 0) sections.push(['【房间变动】', ...changes.map(change => `- ${change}`)].join('\n'))
  }
  if (carried.length > 0) sections.push(notificationsSection(carried))
  // Reports the gate held for this member and no inbox took: they ride this round.
  const held = (state.deliveries ?? []).filter(row => row.memberId === memberId(events, member) && row.status === 'held' && row.dispatchSeq !== dispatchSeq)
  for (const row of held) sections.push(`${envelopeLine(events, row.dispatchSeq) ?? ''}\n${row.text}`.trim())
  const envelope = dispatchSeq === undefined ? undefined : envelopeLine(events, dispatchSeq)
  sections.push(envelope === undefined ? text : `${envelope}\n${text}`)
  return { prompt: sections.join('\n\n'), carried, heldCarried: held.map(row => row.dispatchSeq) }
}

/**
 * Reports held for a member that it has not yet seen in a round: hold
 * verdicts without a later release.
 */
export function pendingHolds(events: readonly SessionEvent[], recipientId: string): readonly number[] {
  const open = new Map<number, number>()
  for (const event of events) {
    if (event.type !== 'room/report-gate' || event.data.memberId !== recipientId) continue
    if (event.data.verdict === 'hold') open.set(event.data.dispatchSeq, event.seq)
    else if (event.data.verdict === 'release') open.delete(event.data.dispatchSeq)
  }
  return [...open.keys()]
}

/**
 * The held reports of a member as one prompt section (their envelopes and
 * texts), or undefined when nothing is held — what a turn the room did not
 * start (a human waking the agent directly) must still carry.
 */
export function heldReportsText(events: readonly SessionEvent[], recipientId: string): { readonly text: string; readonly seqs: readonly number[] } | undefined {
  const held = (replay(events).deliveries ?? []).filter(row => row.memberId === recipientId && row.status === 'held')
  if (held.length === 0) return undefined
  return {
    text: held.map(row => `${envelopeLine(events, row.dispatchSeq) ?? ''}\n${row.text}`.trim()).join('\n\n'),
    seqs: held.map(row => row.dispatchSeq),
  }
}

/** The text of the last assistant message after `afterSeq` ('' when none). */
function lastAssistantText(events: readonly SessionEvent[], afterSeq: number): string {
  const reply = events.filter(event => event.seq > afterSeq && event.type === 'assistant/message').at(-1)
  return reply?.type === 'assistant/message'
    ? reply.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    : ''
}

/** Who a delivery of this dispatch reports to (the coordinator for plan work), if anyone. */
function reportRecipient(events: readonly SessionEvent[], dispatchSeq: number): RoomMember | undefined {
  const source = events.find(event => event.seq === dispatchSeq)
  if (source?.type !== 'room/dispatch' || source.data.replyTo === undefined) return undefined
  const state = replay(events)
  return source.data.plan === undefined
    ? state.members.find(member => memberId(events, member) === source.data.replyTo)
    : coordinatorMember(state, events)
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
  /** room + recipient → the wake-anyway timer for its held reports. */
  private readonly holdTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /**
   * room id → member ids whose FIRST start is in flight: the member has no
   * child session id in the journal yet, but its process may already be
   * asking the host for its mode tools (claude lists MCP tools at spawn).
   */
  private readonly freshStarts = new Map<string, Set<string>>()

  /** Members of this room whose first start is in flight (see {@link freshStarts}). */
  startingMembers(roomId: string): readonly string[] {
    return [...this.freshStarts.get(roomId) ?? []]
  }

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
    // A report to the room's own agent never waits behind that agent's
    // running round: it joins the round (runMainAgent steers it in) — queued,
    // it would wake a second turn once the first had already answered.
    const source = options.dispatchSeq === undefined ? undefined : events.find(event => event.seq === options.dispatchSeq)
    const joins = member.kind === 'main-agent' && source?.type === 'room/dispatch' && source.data.origin === 'report'
    const tail = joins ? Promise.resolve() : this.queues.get(key) ?? Promise.resolve()
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
    if (joins) return
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
      ...state.executions === undefined ? {} : { executions: state.executions.map(execution => {
        const active = execution.runId === undefined
          ? [...this.inFlight.values()].includes(`${sessionId} ${execution.memberId}`)
          : this.scheduled.has(`${sessionId}:${execution.runId}`)
        return execution.state === 'running' && !active ? { ...execution, state: 'failed' as const, error } : execution
      }) },
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
      if (dispatch.type !== 'room/dispatch' || dispatch.data.targetIds === undefined || dispatch.data.held === true) continue
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
              if (run?.state === 'running' && (run.runId === undefined || run.runId === id)) {
                const childSessionId = runChildSessionId(room.id, target)
                room.append('room/run-state', { member: target.name, state: 'failed', startedAt: run.startedAt,
                  ...run.runId === undefined ? {} : { runId: run.runId },
                  ...childSessionId === undefined ? {} : { childSessionId },
                  error: 'Execution outcome is unknown after restart; reconcile before retrying' })
              }
            }
            await this.ctx.sessions.flush(room)
            await this.reportOutcome(room, dispatch.seq, id, targetId, 'uncertain', 'Execution outcome is unknown after restart; reconcile before retrying')
          } else {
            await this.reportOutcome(room, dispatch.seq, id, targetId, last.data.state, last.data.text ?? last.data.error ?? '')
          }
          continue
        }
        const target = state.members.find(member => memberId(events, member) === targetId)
        if (target !== undefined && !state.deliveries?.some(row => row.memberId === targetId && (row.status === 'running' || row.status === 'uncertain'))) this.dispatch(room, target.name, dispatch.data.text, { dispatchSeq: dispatch.seq, targetId })
      }
    }
    // recover() runs on every live access; only holds whose wake timer this
    // process does not own (a restart lost it) are handed over now.
    for (const member of state.members) {
      const id = memberId(events, member)
      if (!this.holdTimers.has(this.holdKey(room.id, id)) && pendingHolds(events, id).length > 0) await this.releaseHeld(room, id, 'restart')
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
    // Settled while it waited in the queue (a removal cancels queued work;
    // an undo must not resurrect it).
    if (deliveryId !== undefined && state.deliveries?.some(delivery => delivery.id === deliveryId && delivery.status !== 'queued')) return
    const runId = deliveryId ?? randomUUID()
    const cursor = previousCursor(room.snapshotEvents(), memberName, options.dispatchSeq ?? Number.MAX_SAFE_INTEGER)
    let startedAt: number | undefined
    const admitted = async (): Promise<number> => {
      if (startedAt !== undefined) throw new Error('Room delivery was admitted twice')
      startedAt = Date.now()
      if (deliveryId !== undefined) room.append('room/delivery-state', { id: deliveryId, dispatchSeq: options.dispatchSeq!, memberId: identity, state: 'running' })
      // Re-read the roster: the captured member snapshot predates the child
      // handle's publication (member-updated lands between admission and settle).
      const current = replay(room.snapshotEvents()).members.find(entry => memberId(room.snapshotEvents(), entry) === identity)
      memberName = current?.name ?? memberName
      const childSessionId = runChildSessionId(room.id, current ?? member)
      room.append('room/run-state', { member: memberName, state: 'running', startedAt, runId,
        ...childSessionId === undefined ? {} : { childSessionId },
      })
      await this.hooks.admitted?.(room, options.dispatchSeq)
      await this.ctx.sessions.flush(room)
      return startedAt
    }
    let outcome: RunOutcome
    try {
      outcome = member.kind === 'main-agent'
        ? await this.runMainAgent(room, member, cursor, text, await admitted(), options.relayIds ?? [], options.dispatchSeq)
        : member.kind === 'native'
          ? await this.runNativeMember(room, member, cursor, text, admitted, options.relayIds ?? [], options.dispatchSeq, runId)
          : await this.runCliMember(room, member, cursor, text, admitted, options.relayIds ?? [], submitted, runId, options.dispatchSeq)
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
      await this.reportOutcome(room, options.dispatchSeq!, deliveryId, identity, outcome.state, outcome.text ?? outcome.error ?? '')
    }
  }

  /**
   * Report one delivery's outcome to whoever is waiting on it (the
   * coordinator for plan work, else the dispatch's `replyTo`), at most once
   * per delivery. Public so a removal can settle the waits it breaks.
   */
  async reportOutcome(room: Session, dispatchSeq: number, deliveryId: string, fromId: string, outcome: string, text: string): Promise<void> {
    const events = room.snapshotEvents()
    const source = events.find(event => event.seq === dispatchSeq)
    if (source?.type !== 'room/dispatch' || (source.data.origin !== 'coordinator' && source.data.origin !== 'member') || source.data.replyTo === undefined) return
    if (events.some(event => event.type === 'room/dispatch' && event.data.reportFor === deliveryId)) return
    if (events.some(event => event.type === 'room/relay' && event.data.intent?.reportFor === deliveryId)) return
    const state = replay(events)
    if (closedGoal(state, source.data.plan?.goalId)) return
    const recipient = source.data.plan === undefined ? state.members.find(member => memberId(events, member) === source.data.replyTo) : coordinatorMember(state, events)
    if (recipient === undefined) return
    // A removed sender is no longer on the roster: read its last known name.
    const senderName = state.members.find(member => memberId(events, member) === fromId)?.name
      ?? events.reduce<string | undefined>((name, event) => event.type === 'room/member-added' && event.data.id === fromId ? event.data.name : name, undefined)
    // The envelope (`【#m12 的回报 · 来自 ada · 完成】`) carries who and how;
    // the text is the member's own conclusion.
    const reportText = text.trim() === '' ? `（${outcome === 'done' ? '没有文字输出' : outcome}）` : text.slice(0, 32000)
    const sourceTask = (state.deliveries ?? []).find(row => row.id === deliveryId)?.task
    const intent: RoomHeldDispatch = { origin: 'report', hop: (source.data.hop ?? 1) + 1, reportFor: deliveryId,
      ...sourceTask === undefined ? {} : { task: sourceTask },
      ...source.data.plan === undefined ? {} : { plan: { goalId: source.data.plan.goalId } } }
    // The gate decides WHEN the recipient gets it; plan work keeps its own cadence.
    const recipientId = memberId(events, recipient)
    const deliveries = state.deliveries ?? []
    const verdict = source.data.plan !== undefined
      ? { hold: false, reason: 'plan' }
      : await judgeReport(this.ctx, {
        timing: state.settings?.reportTiming ?? 'judge',
        outcome,
        outstanding: outstandingFor(deliveries, recipientId, deliveryId).length,
        state: () => gateState(room.snapshotEvents(), recipient, [
          ...deliveries.filter(row => row.memberId === recipientId && row.origin === 'report' && pendingHolds(events, recipientId).includes(row.dispatchSeq))
            .map(row => ({ from: '', outcome: '', text: row.text })),
          { from: senderName ?? fromId, outcome, text: reportText },
        ], Date.now()),
      })
    // The judgement awaited: a concurrent path may have reported meanwhile.
    if (room.snapshotEvents().some(event => event.type === 'room/dispatch' && event.data.reportFor === deliveryId)) return
    if (verdict.hold) {
      await this.holdReport(room, recipient, reportText, intent, verdict)
      return
    }
    const sent = sendOrHold(room, { to: recipient, text: reportText, fromName: senderName ?? fromId, intent })
    if (sent.delivered) {
      room.append('room/report-gate', { dispatchSeq: sent.seq, memberId: recipientId, member: recipient.name, verdict: 'deliver', reason: verdict.reason,
        ...verdict.probability === undefined ? {} : { probability: verdict.probability } })
    }
    await this.ctx.sessions.flush(room)
    if (sent.delivered && this.hooks.allows?.(room, sent.seq) !== false) this.dispatch(room, recipient.name, reportText, { dispatchSeq: sent.seq, targetId: memberId(events, recipient) })
  }


  /**
   * Mark the relays this run delivered as sent. Delivery = the member's own
   * session received the prompt (the followup accepted / the CLI run
   * started): the text lives in the member's private context from then on,
   * so a later run failure cannot un-deliver it.
   */
  /**
   * A round of this member started: every report held for it is now in its
   * context — carried by this prompt (`seqs`) or already in its inbox — so
   * close those holds and drop the member's wake timer.
   */
  async markHeldReleased(room: Session, member: RoomMember, seqs: readonly number[]): Promise<void> {
    const events = room.snapshotEvents()
    const id = memberId(events, member)
    for (const seq of seqs) room.append('room/delivery-state', { id: `${seq}:${id}`, dispatchSeq: seq, memberId: id, state: 'done', text: 'carried' })
    const open = pendingHolds(events, id)
    for (const seq of new Set([...seqs, ...open])) room.append('room/report-gate', { dispatchSeq: seq, memberId: id, member: member.name, verdict: 'release', reason: 'carried' })
    this.clearHoldTimer(room.id, id)
    if (seqs.length > 0 || open.length > 0) await this.ctx.sessions.flush(room)
  }

  private holdKey(roomId: string, recipientId: string): string { return `${roomId} ${recipientId}` }

  private clearHoldTimer(roomId: string, recipientId: string): void {
    const key = this.holdKey(roomId, recipientId)
    const timer = this.holdTimers.get(key)
    if (timer !== undefined) clearTimeout(timer)
    this.holdTimers.delete(key)
  }

  /**
   * Keep a report for later: journal it as a held dispatch and arm the
   * wake-anyway timer. It is NOT pushed into an agent inbox: the host runs
   * one turn per queued inbox message, so held reports would each wake their
   * own turn. They ride the recipient's next round instead — the room's own
   * prompt, or (a human waking a native agent directly) the turn's first step
   * through {@link heldReportsMessage}.
   */
  private async holdReport(room: Session, recipient: RoomMember, text: string, intent: RoomHeldDispatch, verdict: GateVerdict): Promise<void> {
    const events = room.snapshotEvents()
    const recipientId = memberId(events, recipient)
    const dispatch = room.append('room/dispatch', {
      id: randomUUID(), origin: 'report', targets: [recipient.name], targetIds: [recipientId], text, held: true,
      hop: intent.hop, ...intent.task === undefined ? {} : { task: intent.task }, ...intent.reportFor === undefined ? {} : { reportFor: intent.reportFor },
      ...intent.plan === undefined ? {} : { plan: intent.plan },
    })
    room.append('room/report-gate', { dispatchSeq: dispatch.seq, memberId: recipientId, member: recipient.name, verdict: 'hold', reason: verdict.reason,
      ...verdict.probability === undefined ? {} : { probability: verdict.probability } })
    // Armed before the flush yields: a concurrent recover() must see this
    // process owns the hold.
    const key = this.holdKey(room.id, recipientId)
    if (!this.holdTimers.has(key)) {
      const timer = setTimeout(() => {
        this.holdTimers.delete(key)
        void this.releaseHeld(room, recipientId, 'timeout').catch(error => this.ctx.logger.warn(`room: held report release failed: ${String(error)}`))
      }, REPORT_HOLD_MS)
      timer.unref?.()
      this.holdTimers.set(key, timer)
    }
    await this.ctx.sessions.flush(room)
  }

  /**
   * Wake a member for the reports held for it (the hold timeout, a human's
   * 「现在交给」, or a restart). One short release round: an inbox already
   * holds the reports; a CLI member gets them carried by the round's prompt.
   * A no-op when nothing is held any more.
   * @returns whether a release round was dispatched.
   */
  async releaseHeld(room: Session, recipientId: string, reason: string): Promise<boolean> {
    this.clearHoldTimer(room.id, recipientId)
    const events = room.snapshotEvents()
    const open = pendingHolds(events, recipientId)
    const recipient = replay(events).members.find(member => memberId(events, member) === recipientId)
    if (open.length === 0 || recipient === undefined) return false
    const ids = open.map(seq => `#${messageId(seq)}`).join('、')
    const text = `（以上 ${open.length} 条回报一直等着交给你：${ids}${reason === 'timeout' ? '，已经等了一段时间' : ''}。用户也已在房间里看到，不要复述。）`
    const releaseTask = replay(events).deliveries?.find(row => row.dispatchSeq === open[0] && row.memberId === recipientId)?.task
    const release = room.append('room/dispatch', { id: randomUUID(), origin: 'report', targets: [recipient.name], targetIds: [recipientId], text, releases: open, hop: 1,
      ...releaseTask === undefined ? {} : { task: releaseTask } })
    await this.ctx.sessions.flush(room)
    this.dispatch(room, recipient.name, text, { dispatchSeq: release.seq, targetId: recipientId })
    return true
  }

  private async markSent(room: Session, relays: readonly RoomRelay[]): Promise<void> {
    if (relays.length === 0) return
    for (const relay of relays) room.append('room/relay-resolved', { id: relay.id, state: 'sent' })
    await this.ctx.sessions.flush(room)
  }

  /** Main-agent member turn: a producer-sourced followup on the room's own agent. */
  private async runMainAgent(
    room: Session, member: RoomMember, cursor: number | undefined,
    text: string, _startedAt: number, relayIds: readonly string[], dispatchSeq: number | undefined,
  ): Promise<RunOutcome> {
    const agent = this.ctx.agents.get(room.id)
    if (agent === undefined) {
      // Fail loud: the room's own agent is not live, the message goes nowhere.
      return { state: 'failed', error: 'the room session has no live agent' }
    }
    const { prompt, carried, heldCarried } = assemblePrompt(room, member, cursor, text, relayIds, dispatchSeq)
    const before = room.snapshotEvents().at(-1)?.seq ?? -1
    const message = createUserMessage({ content: [{ type: 'text', text: prompt }], source: roomSource() })
    // A report reaching an agent mid-turn joins that turn at its next step:
    // as its own turn it would make the agent answer a second time, after
    // the turn that was already waiting for it.
    const source = dispatchSeq === undefined ? undefined : room.snapshotEvents().find(event => event.seq === dispatchSeq)
    const report = source?.type === 'room/dispatch' && source.data.origin === 'report'
    const steerable = agent as typeof agent & { readonly status?: string; steer?: (input: typeof message) => void }
    if (report && steerable.status === 'running' && typeof steerable.steer === 'function') steerable.steer(message)
    else agent.followup(message)
    await this.markHeldReleased(room, member, heldCarried)
    await this.markSent(room, [
      ...carried,
      ...replay(room.snapshotEvents()).relays.filter(relay => relayIds.includes(relay.id)),
    ])
    // The followup's own turn converging to idle IS the run; the main agent's
    // reply is its ordinary assistant speech (no room/speech projection —
    // speech mirrors CLI members only). Its last assistant text is the
    // outcome a waiting sender's report quotes.
    await agent.whenIdle()
    const output = lastAssistantText(room.snapshotEvents(), before)
    return { state: 'done', ...output === '' ? {} : { text: output } }
  }

  /**
   * The native member's agent: live, resumed from its session after a
   * restart, or created on its first round — a child session + agent in this
   * host process (owned by the room's agent when live), composing the
   * member's preset at creation. The handle is journaled before any prompt.
   */
  private async nativeAgent(room: Session, member: RoomMember): Promise<Agent> {
    if (member.childSessionId !== undefined) {
      const live = this.ctx.agents.get(member.childSessionId)
      if (live !== undefined) return live
      const composition = await composeRoomAgent(this.ctx, member.preset)
      const handle = await this.ctx.agents.resume({
        resumeSessionId: member.childSessionId,
        ...composition.setup === undefined ? {} : { setup: composition.setup },
      })
      return handle.agent
    }
    const composition = await composeRoomAgent(this.ctx, member.preset)
    const parent = this.ctx.agents.get(room.id)
    const sessionId = SessionId(randomUUID())
    const cwd = member.cwd ?? room.header.cwd
    const handle = await this.ctx.agents.create({
      sessionId,
      ...parent === undefined ? {} : { parentAgent: parent },
      meta: {
        parentSession: room.id, origin: 'subagent', delegationDepth: (room.header.delegationDepth ?? 0) + 1,
        ...cwd === undefined ? {} : { cwd },
        ...composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset },
      },
      ...composition.setup === undefined ? {} : { setup: composition.setup },
    })
    room.append('room/member-updated', { name: replay(room.snapshotEvents()).members.find(entry => entry.id === member.id)?.name ?? member.name, childSessionId: sessionId })
    await this.ctx.sessions.flush(room)
    return handle.agent
  }

  /**
   * Native member turn: a room-sourced followup on the member's own agent,
   * mirrored into the room as speech like a CLI member's reply.
   */
  private async runNativeMember(
    room: Session, member: RoomMember, cursor: number | undefined,
    text: string, admitted: () => Promise<number>, relayIds: readonly string[], dispatchSeq: number | undefined, runId?: string,
  ): Promise<RunOutcome> {
    const agent = await this.nativeAgent(room, member)
    const startedAt = await admitted()
    const { prompt, carried, heldCarried } = assemblePrompt(room, member, cursor, text, relayIds, dispatchSeq)
    const before = agent.session.snapshotEvents().at(-1)?.seq ?? -1
    agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: roomSource() }))
    await this.markHeldReleased(room, member, heldCarried)
    await this.markSent(room, [
      ...carried,
      ...replay(room.snapshotEvents()).relays.filter(relay => relayIds.includes(relay.id)),
    ])
    await agent.whenIdle()
    const output = lastAssistantText(agent.session.snapshotEvents(), before)
    const reportedTo = dispatchSeq === undefined ? undefined : reportRecipient(room.snapshotEvents(), dispatchSeq)?.name
    room.append('room/speech', {
      member: replay(room.snapshotEvents()).members.find(entry => entry.id === member.id)?.name ?? member.name,
      text: output, childSessionId: agent.session.id, durationMs: Date.now() - startedAt,
      ...runId === undefined ? {} : { runId },
      ...lastAssistantMessageId(agent.session, before) === undefined ? {} : { messageId: lastAssistantMessageId(agent.session, before)! },
      ...reportedTo === undefined ? {} : { reportedTo },
    })
    await this.ctx.sessions.flush(room)
    return { state: 'done', ...output === '' ? {} : { text: output } }
  }

  /** CLI member turn: facade start (first round) or resume, then the speech mirror. */
  private async runCliMember(
    room: Session, member: RoomMember, cursor: number | undefined,
    text: string, admitted: () => Promise<number>, relayIds: readonly string[], submitted: () => void, runId: string, dispatchSeq: number | undefined,
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
    const admission = {
      ...controlled ? { onAdmitted: async (): Promise<void> => { startedAt = await admitted() } } : {},
      onProgress: (event: import('@khorsheed/dsh-local-agent/types').LocalAgentRunProgress): void => {
        if (event.kind !== 'settled') return
        const previous = room.snapshotEvents().filter(row => row.type === 'room/run-state' && row.data.runId === runId).at(-1)
        if (previous?.type !== 'room/run-state') return
        const total = event.usage?.totalTokens ?? (event.usage === undefined ? undefined : event.usage.inputTokens + event.usage.outputTokens)
        room.append('room/execution-metadata', { runId,
          ...event.observedModel === undefined ? {} : { model: event.observedModel },
          ...event.observedEffort === undefined ? {} : { effort: event.observedEffort },
          ...total === undefined || !Number.isFinite(total) || total < 0 ? {} : { tokens: total },
        })
        void this.ctx.sessions.flush(room).catch(error => this.ctx.logger.warn(`room: execution metadata flush failed: ${String(error)}`))
      },
    }
    if (!controlled) startedAt = await admitted()
    const { prompt, carried, heldCarried } = assemblePrompt(room, member, cursor, text, relayIds, dispatchSeq)
    const prepared = member.childSessionId !== undefined && facade.isPreparedMember?.(member.childSessionId) === true
    const pendingRun = prepared
      ? facade.start(room.id, provider, [{ type: 'text', text: prompt }], { preparedMemberId: member.childSessionId!, label: member.name, ...admission })
      : member.childSessionId === undefined
      // The invite-time model lands as the delegation's own model: the facade
      // records it with the first start and every later resume re-requests it
      // (providers bind it at spawn for exec and live alike). The invite-time
      // effort rides the same channel.
      ? facade.start(room.id, provider, [{ type: 'text' as const, text: prompt }],
          // The member's name labels its child session in the host's subagent list.
          { ...admission, label: member.name, ...member.model === undefined ? {} : { model: member.model }, ...member.effort === undefined ? {} : { effort: member.effort }, ...member.cwd === undefined ? {} : { cwd: member.cwd } })
      : facade.resume(room.id, provider, member.childSessionId, [{ type: 'text' as const, text: prompt }], { ...admission, ...member.cwd === undefined ? {} : { cwd: member.cwd } })
    // Existing members can enter core's queue immediately. A fresh/prepared
    // identity must publish its first handle before the next submission resumes it.
    if (controlled && member.childSessionId !== undefined && !prepared) submitted()
    const fresh = !prepared && member.childSessionId === undefined
    const freshId = memberId(room.snapshotEvents(), member)
    if (fresh) {
      const starting = this.freshStarts.get(room.id) ?? new Set<string>()
      this.freshStarts.set(room.id, starting.add(freshId))
    }
    const run = await pendingRun.finally(() => {
      if (!fresh) return
      const starting = this.freshStarts.get(room.id)
      starting?.delete(freshId)
      if (starting?.size === 0) this.freshStarts.delete(room.id)
    })
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
      await this.markHeldReleased(room, member, heldCarried)
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
    const reportedTo = dispatchSeq === undefined ? undefined : reportRecipient(room.snapshotEvents(), dispatchSeq)?.name
    // The member's own closing message: per-message tools address it in its session.
    const closingMessageId = lastAssistantMessageId(this.ctx.sessions.get(run.id))
    const speech = output !== '' || interrupted === undefined ? room.append('room/speech', {
      member: replay(room.snapshotEvents()).members.find(entry => entry.id === member.id)?.name ?? member.name,
      text: output,
      childSessionId: run.id,
      runId,
      ...closingMessageId === undefined ? {} : { messageId: closingMessageId },
      durationMs: Date.now() - startedAt,
      ...interrupted === undefined ? {} : { interrupted },
      ...reportedTo === undefined ? {} : { reportedTo },
    }) : undefined
    if (speech !== undefined) await this.ctx.sessions.flush(room)
    if (result.stopReason === 'completed') {
      await this.ctx.sessions.flush(room)
      return { state: 'done', text: runOutputText(result.output) }
    } else if (result.stopReason === 'aborted') {
      return { state: 'cancelled', text: output }
    } else {
      return { state: 'failed', text: output, error: `the member run ended with stopReason "${result.stopReason}"` }
    }
  }

  /** Settle only this execution, preserving newer runs. */
  private async settle(
    room: Session, member: RoomMember, runId: string, startedAt: number, outcome: RunOutcome,
  ): Promise<RunOutcome> {
    const events = room.snapshotEvents()
    const currentMember = replay(events).members.find(entry => memberId(events, entry) === memberId(events, member))
    const memberName = currentMember?.name ?? member.name
    const terminal = events.find(event => event.type === 'room/run-state' && event.data.runId === runId && event.data.state !== 'running')
    if (terminal?.type === 'room/run-state' && terminal.data.state !== 'running') {
      return { ...outcome, state: terminal.data.state, ...terminal.data.error === undefined ? {} : { error: terminal.data.error } }
    }
    const childSessionId = runChildSessionId(room.id, currentMember ?? member)
    const childTurn = runChildTurn(childSessionId === undefined ? undefined : this.ctx.sessions.get(childSessionId))
    room.append('room/run-state', {
      member: memberName, runId, state: outcome.state, startedAt, elapsedMs: Date.now() - startedAt,
      ...childSessionId === undefined ? {} : { childSessionId },
      ...childTurn === undefined ? {} : { childTurn },
      ...outcome.error === undefined ? {} : { error: outcome.error },
    })
    await this.ctx.sessions.flush(room)
    return outcome
  }
}
