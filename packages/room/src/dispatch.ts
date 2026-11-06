/**
 * Dispatch engine: turns `room/dispatch` journal records and confirmed
 * notification relays into member runs. A CLI member's every round goes
 * through local-agent's single execution entry `run()` (batch 5 S5): room
 * passes the member's stable child session id, the round's cause, task, its
 * delivery id as the idempotency key and its run id, and assembles the prompt
 * only when the core reaches that execution. Since batch 5 S7 the core's
 * per-member ledger is a CLI member's only queue: room submits each delivery
 * at once and keeps no queue of its own for them, and after a restart it
 * resubmits by key and journals what the core says became of each round
 * (core-ledger.ts). The room's own agent keeps the room's in-process queue.
 * Different members run in parallel. Every lifecycle
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
import { createUserMessage, type ContentBlock, type ContextFormed, type MessageSource } from '@deepseek-ai/dsh-llm'
import { probeLocalAgent, runOutputText, type LocalAgentFacade } from './adapter.ts'
import { COMPACT_COMMAND, coordinatorMember, isCompactCommand, memberId, pendingInstructions, previousCursor, replay, roomChangesSince } from './journal.ts'
import { envelopeLine, messageId, sendOrHold } from './messaging.ts'
import { gateState, judgeReport, outstandingFor, type GateVerdict } from './report-gate.ts'
import { decisionRecord } from './decisions.ts'
import { CoreLedgers, isCoreOutcome, type CoreRow } from './core-ledger.ts'
import type { LocalAgentCompactionEvent, LocalAgentExecutionAdmitted, LocalAgentExecutionCause, LocalAgentExecutionHandle, LocalAgentRunProgress, LocalAgentTaskRef } from '@khorsheed/dsh-local-agent/types'
import type { RoomDelivery, RoomHeldDispatch, RoomMember, RoomMemberRun, RoomRelay, RoomState } from './types.ts'

/**
 * The room producer's durable identity in its two historical forms: the
 * released V3 wrapper's `plugin` value (`@khorsheed/dsh-room` — the official
 * V3→V4 migration rewrites it to `kind: 'plugin:@khorsheed/dsh-room'`), and
 * the current producer-owned kind (`room`). {@link isRoomSource} accepts the
 * migrated and current forms; new writes always carry the producer kind.
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
/**
 * Keep the running members' cards at the bottom of the room's conversation:
 * after a reply or a human message lands, each member still working gets a
 * `room/run-moved` edge — its card re-anchors below what just landed (a
 * typing-indicator seat), so a member that started first but is still going
 * never reads as if it answered before the later replies. Several running
 * members keep their start order.
 * @param room - the room session.
 * @param except - the member whose own reply just landed (its card ends there).
 */
/** How much of a round's text a question keeps to find its place in the reply later. */
export const BEFORE_TAIL = 160

/**
 * The text a member's current round has said so far in its own session: the
 * assistant text since the latest turn start, in order. Each assistant
 * message (one model call) is a segment, and segments are separated by a
 * blank line — the same rule a provider applies when its round output joins
 * the segments a member spoke between tool calls (local-agent-kimi's
 * `textSegmentSeparator`), so a question's recorded tail still finds itself
 * in the final reply when it spans two segments.
 * @param events - the member's child session log.
 * @returns the round's text so far.
 */
export function roundTextSoFar(events: readonly SessionEvent[]): string {
  let start = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]!.type === 'turn/start') { start = index; break }
  }
  let text = ''
  for (const event of events.slice(start + 1)) {
    if (event.type !== 'assistant/message') continue
    const content = (event.data as { message?: { content?: readonly { type: string; text?: string }[] } }).message?.content ?? []
    let segment = ''
    for (const block of content) if (block.type === 'text' && typeof block.text === 'string') segment += block.text
    if (segment === '') continue
    text += segmentSeparator(text, segment) + segment
  }
  return text
}

/**
 * The blank line between two text segments of one round: none at the start,
 * fewer when the previous segment ends (or the next starts) with newlines.
 * @param before - the text so far.
 * @param next - the next segment.
 * @returns "", "\n" or "\n\n".
 */
function segmentSeparator(before: string, next: string): string {
  if (before === '') return ''
  const trailing = before.length - before.replace(/\n+$/, '').length
  const leading = next.length - next.replace(/^\n+/, '').length
  return '\n'.repeat(Math.max(0, 2 - trailing - leading))
}

/**
 * Where each question a round asked sits in its final reply: just after the
 * text the round had said when it asked (its recorded tail, shortened until
 * found). Asked before saying anything → 0; tail not found → -1 (shown
 * first, marked as asked mid-round). Offsets never go backwards.
 * @param events - the room log.
 * @param runId - the round.
 * @param text - the round's reply.
 * @returns the question ids with their offsets.
 */
export function askOffsets(events: readonly SessionEvent[], runId: string, text: string): { id: string; at: number }[] {
  const out: { id: string; at: number }[] = []
  let floor = 0
  for (const event of events) {
    if (event.type !== 'room/question' || event.data.runId !== runId) continue
    const tail = (event.data.before ?? '').trimEnd()
    // Nothing said before asking: the question opens the reply.
    let at = tail === '' ? 0 : -1
    for (const size of [80, 40, 20]) {
      if (tail === '') break
      const probe = tail.slice(-size)
      if (probe.length < Math.min(size, 8)) break
      const found = text.indexOf(probe, floor)
      if (found >= 0) { at = found + probe.length; break }
    }
    if (at > 0) floor = at
    out.push({ id: event.data.id, at })
  }
  return out
}

/** Why a human message's move-on closes a restart-lost round (index.ts moveOnFromLostRounds). */
export const MOVED_ON_TEXT = '你发了新消息；被重启打断的这一轮按没做完处理'
/** A message that queued behind a lost round and rode along with the move-on message. */
export const MERGED_BACKLOG_TEXT = '已并入下一条消息一起送达'
export { COMPACT_COMMAND }
/** A compaction's delivery outcome text (the report a sender would read). */
export const COMPACTED_TEXT = '已压缩上下文'
/** A `/compact` round whose member reported no compaction record (its provider does not report one). */
export const COMPACT_UNREPORTED_TEXT = '已发送压缩命令；该成员不报告压缩数据'
/**
 * A round the core refused because the member has an execution a restart
 * left with an unknown outcome: it was not sent, and the place to clear it is
 * the member edit dialog's 待对账 (the same reconciliation the members page
 * offers — reconciling in either clears both).
 */
export const MEMBER_UNRECONCILED_TEXT = '没有发出：该成员有一轮被重启打断、结果不确定。请在成员编辑弹窗的「待对账」里核对并填写结果，再重新发送这条消息'
/** A round the core refused because the member's input queue is paused after a restart (typed input still waits there). */
export const MEMBER_PAUSED_TEXT = '没有发出：该成员的输入队列在重启后暂停了。请在成员会话里继续或取消排队的输入，再重新发送这条消息'
/**
 * A room delivery waiting for 待对账 (batch 5 S7): the member has an
 * execution a restart left with an unknown outcome — on the members page, in
 * the edit dialog or here — and the core admits nothing else of it until
 * that is reconciled. The delivery stays queued and goes out on its own once
 * it is (user decision 2026-11-03 ③: one 待对账, not a failed delivery).
 */
export const MEMBER_WAITING_TEXT = '等待对账：该成员有一轮被重启打断、结果不确定。在成员编辑弹窗的「待对账」里核对后，这条消息会自动发出'
/** A run a restart cut off whose outcome is unknown (the run row's reason). */
export const RESTART_UNKNOWN_TEXT = 'Execution outcome is unknown after restart; reconcile before retrying'
/** A delivery a restart cut off whose outcome is unknown. */
export const DELIVERY_UNKNOWN_TEXT = 'Host restarted before a durable settlement; reconcile before retrying'
/** `/compact` to a member that has never run: nothing to compact. */
export const NOTHING_TO_COMPACT_TEXT = '还没有可压缩的上下文'
/** A message that answered the question its recipient was waiting on: delivered as that answer, not as a round of its own. */
export const ANSWERED_QUESTION_TEXT = '作为对它提问的回答送达'
/** How a message standing in for an answer reads on the card and to the member. */
export const ANSWER_BY_MESSAGE_PREFIX = '没有选选项，直接回复了：'
/** A message that queued behind a lost round an earlier move-on skipped: closed, not replayed. */
export const SUPERSEDED_BACKLOG_TEXT = '被重启打断前排队，已被后续消息取代'

/**
 * Whether a queued delivery sat behind a restart-lost round of the same
 * member that a human message has since moved on from (its dispatch lies
 * between the lost round and the move-on edge).
 * @param events - the room journal.
 * @param targetId - the member id.
 * @param dispatchSeq - the queued delivery's dispatch seq.
 * @returns whether the move-on superseded it.
 */
export function supersededByMoveOn(events: readonly SessionEvent[], targetId: string, dispatchSeq: number): boolean {
  return events.some(event => event.type === 'room/delivery-state' && event.data.memberId === targetId && event.data.state === 'cancelled'
    && (event.data as { text?: string }).text === MOVED_ON_TEXT && event.data.dispatchSeq < dispatchSeq && dispatchSeq < event.seq)
}

export function floatRunningCards(room: Session, except?: string): void {
  const running = replay(room.snapshotEvents()).runs
    .filter(run => run.state === 'running' && run.member !== except)
    .sort((left, right) => left.startedAt - right.startedAt)
  for (const run of running) room.append('room/run-moved', { member: run.member, startedAt: run.startedAt })
}

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

export function runChildTurn(roomEvents: readonly SessionEvent[], runId: string | undefined, child: Session | undefined): number | undefined {
  const executionId = runExecutionId(roomEvents, runId)
  // A run the core recorded: its turns are the execution's own records (the
  // end record, or the turns after its start record while it is open). No
  // record in a loaded child → no turn, never a seq or time range guess.
  if (executionId !== undefined) return executionTurns(child, executionId)?.at(-1)
  const last = runChildEvents(roomEvents, runId, child).filter(event => event.type === 'turn/start').at(-1)
  return last?.type === 'turn/start' ? last.data.turn : undefined
}

/**
 * The local-agent execution a run is, from its running edge.
 * @param roomEvents - the room log.
 * @param runId - the run.
 * @returns the execution id, or undefined for a run from before S5 (or the room's own agent).
 */
export function runExecutionId(roomEvents: readonly SessionEvent[], runId: string | undefined): string | undefined {
  if (runId === undefined) return undefined
  for (const event of roomEvents) {
    if (event.type === 'room/run-state' && event.data.runId === runId && event.data.executionId !== undefined) return event.data.executionId
  }
  return undefined
}

/**
 * The turns one execution wrote, from its `local-agent/execution` records in
 * the member's session: the end record's turns once it ended; while it is
 * still open (a stop journals its terminal edge before the core ends the
 * execution), the `turn/start`s written after its own start record — the
 * same explicit range the end record will carry.
 * @param child - the member's session (live).
 * @param executionId - the execution.
 * @returns the turns, or undefined when the session is not loaded or holds no record of it.
 */
export function executionTurns(child: Session | undefined, executionId: string): readonly number[] | undefined {
  const events = child?.snapshotEvents() ?? []
  const end = events.find(event => event.type === 'local-agent/execution' && event.data.phase === 'end' && event.data.executionId === executionId)
  if (end?.type === 'local-agent/execution' && end.data.phase === 'end') return end.data.turns
  const start = events.findIndex(event => event.type === 'local-agent/execution' && event.data.phase === 'start' && event.data.executionId === executionId)
  if (start < 0) return undefined
  const turns: number[] = []
  for (const event of events.slice(start + 1)) {
    if (event.type === 'local-agent/execution') break
    if (event.type === 'turn/start') turns.push(event.data.turn)
  }
  return turns
}

/** What room tells the core about one member round: why it runs and the task it works for. */
export interface RoomExecutionFacts {
  readonly cause?: LocalAgentExecutionCause
  readonly task?: LocalAgentTaskRef
}

/**
 * The cause and task of one member round, from the room's own facts (the
 * design's room-origin → cause table). The core stores them verbatim.
 *
 * | dispatch | cause |
 * |---|---|
 * | `human` (and `/compact`) | `human` via `room`, with the message id and dispatch seq |
 * | `coordinator` / `member` / `relay` | `member`: the sender's id and the dispatch seq |
 * | `help` | `help`: the thread id and the asking room, plus `fromTask` when the request carried the asker's task |
 * | `report` of a delivery | `execution`: the source run's execution id; a source without one (the room's own agent, a pre-S5 run) → `member` from the reporting member |
 * | `report` of a help thread (`help:<id>`) | `help`: the thread and the helper session; the task is the thread's own (`room/help.task`) when the dispatch has none |
 * | release round, `restart` | `restart` |
 * | release round, `manual` (the human's 现在交给) | `human` via `room` |
 * | release round, `timeout` or unrecorded | `decision`: the dispatch's `releaseDecision`; a journal from before it (batch 5 S9) → the latest report-timing decision that held reports for the recipient; none recorded → no cause |
 * | legacy confirmed relay (no dispatch) | `member`: the relay sender, the relay's own seq |
 *
 * The task is the dispatch's `task` (the task root's message id) in this room.
 * @param events - the room log.
 * @param roomId - the room session id.
 * @param dispatchSeq - the dispatch the round delivers, when journaled.
 * @param relayIds - the legacy relays a non-journaled round delivers.
 * @returns the cause and task (each absent when the room has no fact for it).
 */
export function executionFacts(events: readonly SessionEvent[], roomId: string, dispatchSeq: number | undefined, relayIds: readonly string[] = []): RoomExecutionFacts {
  const sessionId = String(roomId)
  if (dispatchSeq === undefined) {
    const relay = events.find(event => event.type === 'room/relay' && relayIds.includes(event.data.id))
    if (relay?.type !== 'room/relay') return {}
    const state = replay(events)
    const sender = state.members.find(member => member.name === relay.data.from)
    return { cause: { kind: 'member', sessionId, fromMemberId: sender === undefined ? relay.data.from : memberId(events, sender), dispatchSeq: relay.seq } }
  }
  const source = events.find(event => event.seq === dispatchSeq)
  if (source?.type !== 'room/dispatch') return {}
  const data = source.data
  const task: LocalAgentTaskRef | undefined = data.task === undefined ? undefined : { sessionId, id: data.task }
  const withTask = (cause: LocalAgentExecutionCause | undefined): RoomExecutionFacts => ({ ...cause === undefined ? {} : { cause }, ...task === undefined ? {} : { task } })
  const human = (): LocalAgentExecutionCause => ({ kind: 'human', sessionId, dispatchSeq, via: 'room', ...data.messageId === undefined ? {} : { messageId: data.messageId } })
  switch (data.origin ?? 'human') {
    case 'human': return withTask(human())
    case 'coordinator':
    case 'member':
    case 'relay': return withTask({ kind: 'member', sessionId, fromMemberId: data.from ?? '', dispatchSeq })
    case 'help': return withTask(data.help === undefined ? undefined : {
      kind: 'help', sessionId, helpId: data.help.id, fromRoom: data.help.room,
      ...data.help.task === undefined ? {} : { fromTask: { sessionId: data.help.room, id: data.help.task } },
    })
    case 'report': {
      if (data.releases !== undefined) {
        if (data.releaseReason === 'restart') return withTask({ kind: 'restart', sessionId })
        if (data.releaseReason === 'manual') return withTask(human())
        if (data.releaseDecision !== undefined) return withTask({ kind: 'decision', sessionId, decisionId: data.releaseDecision })
        // A release journaled before S9 names no decision: the older reading stays.
        const recipient = data.targets[0]
        const decision = events.findLast(event => event.seq < dispatchSeq && event.type === 'room/decision' && event.data.scenario === 'report-timing'
          && event.data.outcome === 'later' && event.data.about?.to === recipient)
        return withTask(decision?.type === 'room/decision' ? { kind: 'decision', sessionId, decisionId: decision.data.id } : undefined)
      }
      const reportFor = data.reportFor
      if (reportFor === undefined) return withTask(undefined)
      if (reportFor.startsWith('help:')) {
        const helpId = reportFor.slice('help:'.length)
        const help = events.find(event => event.type === 'room/help' && event.data.id === helpId)
        const threadTask = task === undefined && help?.type === 'room/help' && help.data.task !== undefined ? { task: { sessionId, id: help.data.task } } : {}
        return { ...threadTask, ...withTask({ kind: 'help', sessionId, helpId, fromRoom: help?.type === 'room/help' ? help.data.target.sessionId : '' }) }
      }
      const executionId = runExecutionId(events, reportFor)
      if (executionId !== undefined) return withTask({ kind: 'execution', executionId })
      const separator = reportFor.indexOf(':')
      return withTask({ kind: 'member', sessionId, fromMemberId: separator < 0 ? '' : reportFor.slice(separator + 1), dispatchSeq })
    }
    default: return withTask(undefined)
  }
}

/**
 * Where a run's events start in its child session, recorded on the running
 * edge at admission (see RoomRunStateEvent.childFromSeq): 0 for a member
 * whose session does not exist yet, the child's next seq when it is loaded,
 * undefined when it is not (the range then falls back to event times).
 * @param childSessionId - the run's child session, when known.
 * @param child - that session, when loaded.
 * @returns the first seq that belongs to the run.
 */
export function childFromSeq(childSessionId: SessionId | undefined, child: Session | undefined): number | undefined {
  if (childSessionId === undefined) return 0
  if (child === undefined) return undefined
  return (child.snapshotEvents().at(-1)?.seq ?? -1) + 1
}

/**
 * Whether a compaction fact states it carries no numbers to show: its source
 * did not report the context sizes nor the call's spend (the core's own fact
 * for a provider that reports no compaction). Read from the fact's write-time
 * mark, never from absent fields.
 * @param data - the member's `local-agent/compaction` fact.
 * @returns whether the room row says the member does not report compaction data.
 */
export function compactionUnreported(data: Partial<LocalAgentCompactionEvent>): boolean {
  const unrecorded = data.unrecorded ?? []
  return unrecorded.includes('before-after') && unrecorded.includes('usage')
}

/**
 * The child session events one run wrote: from the seq its running edge
 * recorded (else from its start time), so a run never claims an earlier
 * run's round or compaction. A run with no running edge never got admitted
 * and owns nothing; a legacy run without an id reads the whole log.
 * @param roomEvents - the room log.
 * @param runId - the run.
 * @param child - the run's child session (the room itself for the main agent).
 * @returns the run's child events, in log order.
 */
export function runChildEvents(roomEvents: readonly SessionEvent[], runId: string | undefined, child: Session | undefined): readonly SessionEvent[] {
  if (child === undefined) return []
  const events = child.snapshotEvents()
  if (runId === undefined) return events
  const running = roomEvents.find(event => event.type === 'room/run-state' && event.data.runId === runId && event.data.state === 'running')
  if (running?.type !== 'room/run-state') return []
  const from = running.data.childFromSeq
  return from !== undefined ? events.filter(event => event.seq >= from) : events.filter(event => event.time >= running.data.startedAt)
}

/**
 * Whether a durable source belongs to the room producer, in every form the
 * log can hold: the current producer-owned kind (`room`) and the V3→V4
 * migrated kind (`plugin:@khorsheed/dsh-room`). A released V3 wrapper never
 * reaches here: every persistence read (live load, read handle) serves V3
 * files through the official migration first.
 * @param source - the persisted message source to test.
 * @returns true when the source names this producer.
 */
export function isRoomSource(source: unknown): boolean {
  if (typeof source !== 'object' || source === null) return false
  const record = source as { kind?: unknown }
  return record.kind === ROOM_KIND
    || record.kind === `plugin:${ROOM_PLUGIN}`
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
  /**
   * The human's own message, delivered to the room's own agent as itself
   * (its turn's user message, not a room-sourced copy): the room's additions
   * ride that turn's first step (see {@link DispatchEngine.directExtras}).
   */
  readonly direct?: ReturnType<typeof createUserMessage>
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
        entry.kind === 'main-agent' ? '原生 DSH' : entry.provider ?? '',
      ].filter(Boolean)
      return `- ${entry.name}（${facts.join(' · ')}）`
    })
  return [
    '【房间简报】',
    `你是协作间成员「${member.name}」${member.role === undefined ? '' : `，职责：${member.role}`}${coordinator?.name === member.name ? '，也是本房间的协调者' : ''}。`,
    ...instructions === undefined ? [] : [`你的指令：${instructions}`],
    ...state.goal === undefined ? [] : [`房间目标：${state.goal}`],
    ...others.length === 0 ? [] : ['其他成员：', ...others],
    `联系成员、派活用 ${member.kind === 'cli' ? 'member_message' : 'room_message'}，看房间现状和任务编号用 room_read，用法见工具说明。成员发来的消息开头标着来自谁和消息编号（#m12），没有标注的是人发的；派给你的活，你这一轮的最终回复会自动回报给派活人，不用另外回复。`,
    '要找房间外的会话帮忙（人在消息里 @ 的会话 `@[…](dsh-session:…)`，包括另一个协作间或它的成员），直接用 room_help，不要转给别的成员代问。',
    // Deploying 3080 restarts the instance the member runs in (2026-11-06,
    // kimi-canvas): the deploy script refuses that restart from a CLI member;
    // this line steers every member to the --no-restart path up front.
    '部署到 3080（`pnpm deploy:3080`）会重启你自己所在的实例：先用 `--no-restart` 准备并验证，最后的重启交给协调者或人来做。',
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
 * Whether a dispatch is the human's `/compact` (alone): it compacts the
 * member's context instead of prompting it.
 * @param events - the room log.
 * @param dispatchSeq - the dispatch's seq.
 * @returns true for a human `/compact` dispatch.
 */
export function isCompactDispatch(events: readonly SessionEvent[], dispatchSeq: number | undefined): boolean {
  if (dispatchSeq === undefined) return false
  const source = events.find(event => event.seq === dispatchSeq)
  return source?.type === 'room/dispatch' && (source.data.origin ?? 'human') === 'human' && isCompactCommand(source.data.text)
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
 * The report-timing decision that held one report: the `later` decision
 * recorded for the held dispatch's run (`room/decision.runId` = its
 * `reportFor`). A hold is only ever the decision model's `later`, and that
 * decision is always journaled before the hold, so every hold written since
 * batch 5 S9 has one; older journals record no run on the decision → none.
 * @param events - the room log.
 * @param heldSeq - the held report dispatch.
 * @returns the decision id, or undefined when none is recorded.
 */
export function holdDecision(events: readonly SessionEvent[], heldSeq: number): string | undefined {
  const held = events.find(event => event.seq === heldSeq)
  const runId = held?.type === 'room/dispatch' ? held.data.reportFor : undefined
  if (runId === undefined) return undefined
  const decision = events.findLast(event => event.seq < heldSeq && event.type === 'room/decision' && event.data.scenario === 'report-timing'
    && event.data.outcome === 'later' && event.data.runId === runId)
  return decision?.type === 'room/decision' ? decision.data.id : undefined
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

/** A delivery as the core's ledger settled it (its evidence or failure as the error). */
function coreDelivery(row: RoomDelivery, core: CoreRow): RoomDelivery {
  const { error: _error, ...rest } = row
  const said = core.error === undefined || core.error.trim() === '' ? undefined : core.error
  return { ...rest, status: core.status as RoomDelivery['status'], ...core.status === 'failed' ? { error: said ?? 'the member round failed' } : {} }
}

/** The human-readable reason a run failed (Error message, else String()). */
function faultMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface RunOutcome {
  readonly state: 'done' | 'cancelled' | 'failed'
  readonly text?: string
  readonly error?: string
  /** The member execution's recorded turns (its settlement), when the core ran it. */
  readonly turns?: readonly number[]
}

/** A room run that journals nothing: the core never reached it for this delivery, or another room run owns its execution. */
const DROPPED = Symbol('dropped')

/**
 * A CLI member's stable child identity: the roster's handle, else its room
 * id (the id the core creates a first round's child under).
 */
export function cliChildId(events: readonly SessionEvent[], member: RoomMember): string {
  return String(member.childSessionId ?? memberId(events, member))
}

/**
 * Executions a room run of this process is following. A second room run the
 * core's key dedup hands the same execution back to (one delivery submitted
 * twice, from any engine) journals nothing: the first one owns its edges.
 */
const claimed = new Set<string>()

export interface DispatchHooks {
  allows?(room: Session, dispatchSeq?: number): boolean
  admitted?(room: Session, dispatchSeq?: number): Promise<void>
  settled?(room: Session, dispatchSeq: number | undefined, outcome: RunOutcome): Promise<void>
}

/**
 * The per-room dispatch engine. Owned by the RoomService; all state lives in
 * the journal, the core's ledger (CLI members, batch 5 S7) and, for the
 * room's own agent only, an in-process FIFO queue (a restart simply has no
 * in-flight runs).
 */
export class DispatchEngine {
  /**
   * The room's additions to a direct human turn, by the human message's id:
   * taken (once) by the pre-step that enters that turn, so the human's words
   * are never re-sent and an empty addition adds no message at all.
   */
  readonly directExtras: Map<string, string> = new Map()
  /** Human messages delivered directly: their turn's own pre-steps must not file or re-carry them. */
  readonly directMessages: Set<string> = new Set()
  /**
   * The room's own agent only: memberKey → its queue tail, and the deliveries
   * this process queued or runs for it. A CLI member has no room queue
   * (batch 5 S7): its rounds queue in the core's ledger, a delivery submitted
   * twice is one execution (the core's key), and recovery reads the core.
   */
  private readonly agentQueues = new Map<string, Promise<void>>()
  private readonly agentScheduled = new Set<string>()
  /** Every room run this process started, by memberKey: drained by idle(), read by hasPending. Not a queue. */
  private readonly inFlight = new Map<Promise<void>, string>()
  /** Outside rounds (another caller's executions) the service follows: their edges are its to write. */
  private readonly followed = new Set<string>()
  /** One recovery pass per room at a time (recover runs on every live access). */
  private readonly recovering = new Map<string, Promise<void>>()
  /** room + recipient → the wake-anyway timer for its held reports. */
  private readonly holdTimers = new Map<string, ReturnType<typeof setTimeout>>()

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
    if (deliveryId !== undefined && events.some(event => event.type === 'room/delivery-state' && event.data.id === deliveryId)) return
    if (member.kind !== 'main-agent') {
      // A CLI member: straight to the core (batch 5 S7). Its ledger orders the
      // member's rounds; submissions keep dispatch order (each reaches the
      // core's synchronous submit in this microtask order). A delivery
      // submitted twice gets its one execution back and the second room run
      // journals nothing.
      const next: Promise<void> = Promise.resolve()
        .then(() => this.run(room, memberName, text, { ...options, targetId }))
        .catch((error: unknown) => { this.ctx.logger.warn(`room: dispatch to "${memberName}" faulted: ${String(error)}`) })
        .finally(() => { this.inFlight.delete(next) })
      this.inFlight.set(next, key)
      return
    }
    if (deliveryId !== undefined) {
      const scopedId = `${room.id}:${deliveryId}`
      if (this.agentScheduled.has(scopedId)) return
      this.agentScheduled.add(scopedId)
    }
    // A report to the room's own agent never waits behind that agent's
    // running round: it joins the round (runMainAgent steers it in) — queued,
    // it would wake a second turn once the first had already answered.
    const source = options.dispatchSeq === undefined ? undefined : events.find(event => event.seq === options.dispatchSeq)
    const joins = source?.type === 'room/dispatch' && source.data.origin === 'report'
    const tail = joins ? Promise.resolve() : this.agentQueues.get(key) ?? Promise.resolve()
    const next: Promise<void> = tail.then(() => this.run(room, memberName, text, { ...options, targetId }))
      .catch((error: unknown) => { this.ctx.logger.warn(`room: dispatch to "${memberName}" faulted: ${String(error)}`) })
      .finally(() => {
        this.inFlight.delete(next)
        if (deliveryId !== undefined) this.agentScheduled.delete(`${room.id}:${deliveryId}`)
      })
    this.inFlight.set(next, key)
    if (joins) return
    this.agentQueues.set(key, next)
    void next.then(() => { if (this.agentQueues.get(key) === next) this.agentQueues.delete(key) })
  }

  /**
   * A run this process follows outside the dispatch path (a member round
   * another caller started): the service writes its edges, so recovery leaves
   * it alone while it is followed.
   */
  holdRun(roomId: string, runId: string): void { this.followed.add(`${roomId}:${runId}`) }

  /** The followed run ended (see {@link holdRun}). */
  releaseRun(roomId: string, runId: string): void { this.followed.delete(`${roomId}:${runId}`) }

  /** Drain includes reports queued by the runs being drained. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight.keys()])
  }

  /**
   * Read-only recovery projection: persisted running edges are not live
   * processes. A CLI member's rounds read the core's ledger (batch 5 S7): a
   * round the core still runs stays running, one a restart cut off reads
   * `uncertain` (待对账) until someone reconciles it — here, on the members
   * page or in the edit dialog — and then reads the reconciled outcome. A
   * queued delivery of a member with such a round is marked as waiting for
   * 待对账. Only runs the core holds no row for (the room's own agent, runs
   * from before S7) keep the room's own verdict.
   */
  view(sessionId: string, state: RoomState): RoomState {
    const ledgers = new CoreLedgers(probeLocalAgent(this.ctx))
    const cliChild = (member: RoomMember | undefined): string | undefined =>
      member === undefined || member.kind === 'main-agent' ? undefined : String(member.childSessionId ?? member.id ?? member.name)
    const memberActive = (id: string | undefined): boolean => [...this.inFlight.values()].includes(`${sessionId} ${id ?? ''}`)
    const executionOf = (runId: string | undefined): string | undefined => runId === undefined ? undefined : state.executions?.find(row => row.id === runId)?.executionId
    const deliveries = state.deliveries?.map((row): RoomDelivery => {
      if (row.status === 'queued' && closedGoal(state, row.plan?.goalId)) return { ...row, status: 'cancelled' }
      const child = cliChild(state.members.find(entry => entry.id === row.memberId))
      if (child === undefined) {
        // The room's own agent (or a removed member): the room's own verdict.
        return row.status === 'running' && !this.agentScheduled.has(`${sessionId}:${row.id}`)
          ? { ...row, status: 'uncertain', error: RESTART_UNKNOWN_TEXT } : row
      }
      const core = ledgers.find(child, row.id, executionOf(row.id))
      // A round this process follows reads as the journal says.
      const followed = executionOf(row.id)
      if (row.status === 'running' && followed !== undefined && claimed.has(followed)) return row
      if (row.status === 'running') {
        // COMPAT(batch 5 S7, remove one release after): a delivery running
        // since before this version has no ledger row the room can name.
        if (core === undefined) return { ...row, status: 'uncertain', error: RESTART_UNKNOWN_TEXT }
        return core.status === 'uncertain' ? { ...row, status: 'uncertain', error: RESTART_UNKNOWN_TEXT }
          : isCoreOutcome(core.status) ? coreDelivery(row, core) : row
      }
      if (row.status === 'uncertain' && core !== undefined && isCoreOutcome(core.status)) return coreDelivery(row, core)
      if (row.status === 'queued') {
        if (core?.status === 'uncertain') return { ...row, status: 'uncertain', error: RESTART_UNKNOWN_TEXT }
        if (ledgers.uncertain(child)) return { ...row, waiting: 'reconcile' }
      }
      return row
    })
    const project = <T extends RoomMemberRun & { readonly executionId?: string; readonly memberId?: string }>(run: T): T => {
      const member = run.memberId === undefined ? state.members.find(entry => entry.name === run.member) : state.members.find(entry => entry.id === run.memberId)
      // A round the core refused while its member waited for 待对账 follows
      // its delivery: still queued → waiting; settled → that.
      if (run.state === 'failed' && run.error === MEMBER_WAITING_TEXT) {
        const delivery = deliveries?.find(row => row.id === run.runId)
        if (delivery === undefined) return run
        return delivery.status === 'queued' ? { ...run, state: 'uncertain', waiting: 'reconcile' }
          : delivery.status === 'done' || delivery.status === 'cancelled' ? { ...run, state: delivery.status } : run
      }
      const executionId = run.executionId ?? executionOf(run.runId)
      const restartLost = run.state === 'failed' && run.error === RESTART_UNKNOWN_TEXT
      const child = cliChild(member)
      if (executionId !== undefined && run.state === 'running' && claimed.has(executionId)) return run
      if (executionId !== undefined && child !== undefined && (run.state === 'running' || restartLost)) {
        const core = ledgers.find(child, undefined, executionId)
        if (core !== undefined) {
          if (core.status === 'uncertain') return { ...run, state: 'uncertain', error: RESTART_UNKNOWN_TEXT }
          if (!isCoreOutcome(core.status)) return run
          const { error: _error, ...rest } = run
          return { ...rest, state: core.status, ...core.status === 'failed' && core.error !== undefined ? { error: core.error } : {} } as T
        }
        // A round another caller started that the service follows.
        if (run.runId !== undefined && this.followed.has(`${sessionId}:${run.runId}`)) return run
        if (restartLost) return run
        // COMPAT(batch 5 S7, remove one release after): no ledger row to read.
        return { ...run, state: 'failed', error: RESTART_UNKNOWN_TEXT }
      }
      if (run.state !== 'running') return run
      const active = member?.kind === 'main-agent' && run.runId !== undefined
        ? this.agentScheduled.has(`${sessionId}:${run.runId}`)
        : memberActive(member?.id) || (run.runId !== undefined && this.followed.has(`${sessionId}:${run.runId}`))
      return active ? run : { ...run, state: 'failed', error: RESTART_UNKNOWN_TEXT }
    }
    return {
      ...state,
      ...state.executions === undefined ? {} : { executions: state.executions.map(project) },
      ...deliveries === undefined ? {} : { deliveries },
      runs: state.runs.map(project),
    }
  }

  /**
   * Whether the room's journal is behind the core: a CLI round the journal
   * shows running or uncertain that the core has since settled, reconciled
   * (on the members page, in the edit dialog) or marked uncertain, or a
   * delivery that waited for its member's 待对账 that is now reconciled. The
   * service then runs a recovery pass so the room's records catch up.
   */
  behindCore(sessionId: string, state: RoomState): boolean {
    const ledgers = new CoreLedgers(probeLocalAgent(this.ctx))
    if (!ledgers.readable) return false
    const childOf = (id: string | undefined): string | undefined => {
      const member = state.members.find(entry => entry.id === id)
      return member === undefined || member.kind === 'main-agent' ? undefined : String(member.childSessionId ?? member.id ?? member.name)
    }
    const settledOrLost = (row: CoreRow | undefined): boolean => row !== undefined && !claimed.has(row.id) && (row.status === 'uncertain' || isCoreOutcome(row.status))
    for (const row of state.deliveries ?? []) {
      // A delivery that waited for its member's 待对账, now reconciled: it goes out.
      if (row.status === 'queued' && !ledgers.uncertain(childOf(row.memberId))
        && state.executions?.some(run => run.id === row.id && run.state === 'failed' && run.error === MEMBER_WAITING_TEXT) === true) return true
      if (row.status !== 'running' && row.status !== 'uncertain') continue
      const core = ledgers.find(childOf(row.memberId), row.id, state.executions?.find(run => run.id === row.id)?.executionId)
      if (row.status === 'running' ? settledOrLost(core) : core !== undefined && isCoreOutcome(core.status)) return true
    }
    return (state.executions ?? []).some(run => run.id.startsWith('execution:') && run.executionId !== undefined && run.state === 'running'
      && !this.followed.has(`${sessionId}:${run.id}`) && settledOrLost(ledgers.find(childOf(run.memberId), undefined, run.executionId)))
  }

  /** Restore accepted targets, never repeat an execution whose settlement is unknown. One pass per room at a time. */
  async recover(room: Session): Promise<void> {
    const previous = this.recovering.get(room.id) ?? Promise.resolve()
    const pass = previous.catch(() => {}).then(() => this.recoverOnce(room))
    this.recovering.set(room.id, pass)
    const clear = (): void => { if (this.recovering.get(room.id) === pass) this.recovering.delete(room.id) }
    void pass.then(clear, clear)
    return pass
  }

  private async recoverOnce(room: Session): Promise<void> {
    const events = room.snapshotEvents()
    const state = replay(events)
    const ledgers = new CoreLedgers(probeLocalAgent(this.ctx))
    await this.recoverOutsideRuns(room, state, ledgers)
    /** Deliveries this pass settled from the core: they no longer hold their member back. */
    const resolved = new Set<string>()
    for (const dispatch of events) {
      if (dispatch.type !== 'room/dispatch' || dispatch.data.targetIds === undefined || dispatch.data.held === true) continue
      for (const targetId of dispatch.data.targetIds) {
        const id = `${dispatch.seq}:${targetId}`
        const target = state.members.find(member => memberId(events, member) === targetId)
        const cli = target !== undefined && target.kind !== 'main-agent'
        if (!cli && this.agentScheduled.has(`${room.id}:${id}`)) continue
        const edges = events.filter(event => event.type === 'room/delivery-state' && event.data.id === id)
        const last = edges.at(-1)
        if (last === undefined && closedGoal(state, dispatch.data.plan?.goalId)) {
          room.append('room/delivery-state', { id, dispatchSeq: dispatch.seq, memberId: targetId, state: 'cancelled', error: 'Goal closed before delivery admission' })
          await this.ctx.sessions.flush(room)
          continue
        }
        // What the core says became of this delivery's execution (CLI members).
        const core = cli ? ledgers.find(cliChildId(events, target), id, runExecutionId(events, id)) : undefined
        // A round this process follows: its own edges land when it settles.
        const followed = cli ? runExecutionId(events, id) : undefined
        if ((core !== undefined && claimed.has(core.id)) || (followed !== undefined && claimed.has(followed))) continue
        if (last?.type === 'room/delivery-state') {
          if (last.data.state === 'running') {
            if (core !== undefined) {
              if (core.status !== 'queued' && core.status !== 'running') await this.journalCore(room, dispatch.seq, id, targetId, target!, core)
              continue
            }
            // The room's own agent, a removed member, and — COMPAT(batch 5
            // S7, remove one release after) — a CLI delivery running since
            // before this version (no ledger row to read): the room's own verdict.
            room.append('room/delivery-state', { id, dispatchSeq: dispatch.seq, memberId: targetId, state: 'uncertain', error: DELIVERY_UNKNOWN_TEXT })
            if (target !== undefined) {
              const run = state.runs.find(run => run.member === target.name)
              if (run?.state === 'running' && (run.runId === undefined || run.runId === id)) {
                const childSessionId = runChildSessionId(room.id, target)
                room.append('room/run-state', { member: target.name, state: 'failed', startedAt: run.startedAt,
                  ...run.runId === undefined ? {} : { runId: run.runId },
                  ...childSessionId === undefined ? {} : { childSessionId },
                  error: RESTART_UNKNOWN_TEXT })
              }
            }
            await this.ctx.sessions.flush(room)
            await this.reportOutcome(room, dispatch.seq, id, targetId, 'uncertain', RESTART_UNKNOWN_TEXT)
          } else if (last.data.state === 'uncertain' && core !== undefined && isCoreOutcome(core.status)) {
            // Reconciled elsewhere (the members page, the edit dialog): the same finding here.
            await this.journalCore(room, dispatch.seq, id, targetId, target!, core)
            resolved.add(id)
          } else {
            await this.reportOutcome(room, dispatch.seq, id, targetId, last.data.state, last.data.text ?? last.data.error ?? '')
          }
          continue
        }
        // Admitted (and maybe finished) before the room journaled a single
        // edge of it: the core's word, never a second run.
        if (core !== undefined && (core.status === 'uncertain' || isCoreOutcome(core.status))) {
          await this.journalCore(room, dispatch.seq, id, targetId, target!, core)
          continue
        }
        // Queued behind a restart-lost round the human has since moved on
        // from: that move-on carries its backlog along; a row it left behind
        // (a move-on predating the hand-over) closes as superseded instead of
        // replaying a stale round on this access.
        if (supersededByMoveOn(events, targetId, dispatch.seq)) {
          room.append('room/delivery-state', { id, dispatchSeq: dispatch.seq, memberId: targetId, state: 'cancelled', text: SUPERSEDED_BACKLOG_TEXT })
          await this.ctx.sessions.flush(room)
          continue
        }
        if (target === undefined || state.deliveries?.some(row => row.memberId === targetId && row.status === 'uncertain' && !resolved.has(row.id))) continue
        // The room's own agent: one round at a time, in its room queue.
        if (!cli && state.deliveries?.some(row => row.memberId === targetId && row.status === 'running')) continue
        // A CLI member: resubmitted under its key. The core runs it once (a
        // key it holds comes back as that execution or its settlement) and
        // orders it in the member's ledger; while the member waits for
        // 待对账 the core refuses it and the delivery keeps waiting.
        this.dispatch(room, target.name, dispatch.data.text, { dispatchSeq: dispatch.seq, targetId })
      }
    }
    // recover() runs on every live access; only holds whose wake timer this
    // process does not own (a restart lost it) are handed over now.
    for (const member of state.members) {
      const id = memberId(events, member)
      if (!this.holdTimers.has(this.holdKey(room.id, id)) && pendingHolds(events, id).length > 0) await this.releaseHeld(room, id, 'restart')
    }
  }

  /**
   * Journal what the core says became of a delivery's execution: `uncertain`
   * (a restart cut it off: the delivery waits for 待对账 and its card closes
   * with the reason), or the outcome it settled with or was reconciled to
   * (the evidence as the delivery's text). Reported to whoever waits on it.
   */
  private async journalCore(room: Session, dispatchSeq: number, id: string, targetId: string, target: RoomMember, core: CoreRow): Promise<void> {
    const events = room.snapshotEvents()
    const run = replay(events).executions?.find(row => row.id === id)
    const childSessionId = runChildSessionId(room.id, target) ?? SessionId(cliChildId(events, target))
    const executionId = runExecutionId(events, id) ?? core.id
    if (core.status === 'uncertain') {
      const last = events.filter(event => event.type === 'room/delivery-state' && event.data.id === id).at(-1)
      if (last?.type !== 'room/delivery-state' || last.data.state !== 'uncertain') {
        room.append('room/delivery-state', { id, dispatchSeq, memberId: targetId, state: 'uncertain', error: DELIVERY_UNKNOWN_TEXT })
      }
      if (run?.state === 'running') {
        room.append('room/run-state', { member: run.member, runId: id, startedAt: run.startedAt, state: 'failed', error: RESTART_UNKNOWN_TEXT, childSessionId, executionId })
      }
      await this.ctx.sessions.flush(room)
      await this.reportOutcome(room, dispatchSeq, id, targetId, 'uncertain', RESTART_UNKNOWN_TEXT)
      return
    }
    if (!isCoreOutcome(core.status)) return
    const said = core.error === undefined || core.error.trim() === '' ? undefined : core.error
    room.append('room/delivery-state', { id, dispatchSeq, memberId: targetId, state: core.status,
      ...core.status === 'failed' ? { error: said ?? 'the member round failed' } : said === undefined ? {} : { text: said } })
    if (run !== undefined && run.state !== core.status) {
      const childTurn = executionTurns(this.ctx.sessions.get(childSessionId), executionId)?.at(-1)
      room.append('room/run-state', { member: run.member, runId: id, startedAt: run.startedAt, state: core.status, childSessionId,
        ...childTurn === undefined ? {} : { childTurn },
        executionId,
        ...core.status === 'failed' ? { error: said ?? 'the member round failed' } : {} })
    }
    await this.ctx.sessions.flush(room)
    await this.reportOutcome(room, dispatchSeq, id, targetId, core.status, said ?? '')
  }

  /**
   * Rounds another caller started on a room member (`execution:<id>`, shown
   * by the service while it follows them) that a restart cut off: their card
   * closes with what the core says — `uncertain` until reconciled (S5 left
   * such a round failed in the room while the core said uncertain), then the
   * reconciled outcome.
   */
  private async recoverOutsideRuns(room: Session, state: RoomState, ledgers: CoreLedgers): Promise<void> {
    let wrote = false
    for (const run of state.executions ?? []) {
      if (!run.id.startsWith('execution:') || run.executionId === undefined || this.followed.has(`${room.id}:${run.id}`)) continue
      const restartLost = run.state === 'failed' && run.error === RESTART_UNKNOWN_TEXT
      if (run.state !== 'running' && !restartLost) continue
      const member = state.members.find(entry => entry.id === run.memberId)
      const childSessionId = run.childSessionId ?? (member === undefined ? undefined : SessionId(String(member.childSessionId ?? member.id ?? member.name)))
      if (childSessionId === undefined) continue
      const core = ledgers.find(String(childSessionId), undefined, run.executionId)
      if (core === undefined || core.status === 'queued' || core.status === 'running') continue
      if (core.status === 'uncertain') {
        if (restartLost) continue
        room.append('room/run-state', { member: run.member, runId: run.id, startedAt: run.startedAt, state: 'failed', error: RESTART_UNKNOWN_TEXT, childSessionId, executionId: run.executionId })
      } else {
        const childTurn = executionTurns(this.ctx.sessions.get(childSessionId), run.executionId)?.at(-1)
        room.append('room/run-state', { member: run.member, runId: run.id, startedAt: run.startedAt, state: core.status, childSessionId,
          ...childTurn === undefined ? {} : { childTurn }, executionId: run.executionId,
          ...core.status === 'failed' ? { error: core.error ?? 'the member round failed' } : {} })
      }
      wrote = true
    }
    if (wrote) await this.ctx.sessions.flush(room)
  }

  /** Execute one dispatch: run-state running → member turn → settle edges. */
  private async run(room: Session, memberName: string, text: string, options: DispatchOptions): Promise<void> {
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
    // A human's `/compact` to a CLI member runs as a compaction round: its
    // run-state edges say so (the card reads 「正在压缩」, and no child turn is
    // recorded — compaction writes none, so the last one would be another run's).
    const compactRun = member.kind !== 'main-agent' && isCompactDispatch(room.snapshotEvents(), options.dispatchSeq)
    const cursor = previousCursor(room.snapshotEvents(), memberName, options.dispatchSeq ?? Number.MAX_SAFE_INTEGER)
    let startedAt: number | undefined
    let executionId: string | undefined
    const admitted = async (execution?: LocalAgentExecutionAdmitted): Promise<number> => {
      if (startedAt !== undefined) throw new Error('Room delivery was admitted twice')
      startedAt = execution?.admittedAt ?? Date.now()
      executionId = execution?.executionId
      if (deliveryId !== undefined) room.append('room/delivery-state', { id: deliveryId, dispatchSeq: options.dispatchSeq!, memberId: identity, state: 'running' })
      // Re-read the roster: the captured member snapshot predates the child
      // handle's publication (member-updated lands between admission and settle).
      const current = replay(room.snapshotEvents()).members.find(entry => memberId(room.snapshotEvents(), entry) === identity)
      memberName = current?.name ?? memberName
      const childSessionId = runChildSessionId(room.id, current ?? member)
      // Where this run's child events begin (the core's admission says, for
      // an execution): kept for readers of runs without an execution id.
      const fromSeq = execution?.childFromSeq ?? childFromSeq(childSessionId, childSessionId === undefined ? undefined : this.ctx.sessions.get(childSessionId))
      room.append('room/run-state', { member: memberName, state: 'running', startedAt, runId,
        ...childSessionId === undefined ? {} : { childSessionId },
        ...fromSeq === undefined ? {} : { childFromSeq: fromSeq },
        ...execution === undefined ? {} : { executionId: execution.executionId },
        ...compactRun ? { operation: 'compact' as const } : {},
      })
      await this.hooks.admitted?.(room, options.dispatchSeq)
      await this.ctx.sessions.flush(room)
      return startedAt
    }
    let outcome: RunOutcome
    // The execution this run follows stays claimed until its outcome is
    // journaled: a recovery pass meanwhile reads the core's settled row as
    // this run's to write, never its own.
    const follow: { executionId?: string } = {}
    try {
      try {
        const reached = member.kind === 'main-agent'
          ? await this.runMainAgent(room, member, cursor, text, await admitted(), options.relayIds ?? [], options.dispatchSeq, options.direct)
          : await this.runCliMember(room, member, text, admitted, options.relayIds ?? [], runId, deliveryId, options.dispatchSeq, follow)
        // Settled elsewhere before the core reached it, or another room run owns it.
        if (reached === DROPPED) return
        outcome = reached
      } catch (error: unknown) {
        this.ctx.logger.warn(`room: dispatch to "${memberName}" failed: ${String(error)}`)
        outcome = { state: 'failed', error: faultMessage(error) }
      }
      outcome = await this.settle(room, member, runId, startedAt ?? Date.now(), outcome, executionId)
      await this.hooks.settled?.(room, options.dispatchSeq, outcome)
      if (deliveryId !== undefined) {
        room.append('room/delivery-state', { id: deliveryId, dispatchSeq: options.dispatchSeq!, memberId: identity, state: outcome.state,
          ...outcome.text === undefined ? {} : { text: outcome.text }, ...outcome.error === undefined ? {} : { error: outcome.error } })
        await this.ctx.sessions.flush(room)
      }
    } finally {
      if (follow.executionId !== undefined) claimed.delete(follow.executionId)
    }
    if (deliveryId !== undefined) await this.reportOutcome(room, options.dispatchSeq!, deliveryId, identity, outcome.state, outcome.text ?? outcome.error ?? '')
  }

  /**
   * Report one delivery's outcome to whoever is waiting on it (the
   * coordinator for plan work, else the dispatch's `replyTo`), at most once
   * per delivery. Public so a removal can settle the waits it breaks.
   */
  /** Report-gate decisions per recipient, one at a time (see reportOutcome). */
  private readonly gateQueues = new Map<string, Promise<void>>()

  /**
   * Gate one arrived report for the member waiting on it. Decisions for the
   * same recipient run one at a time: a decision-model judgement takes a
   * second or two, and a later report deciding meanwhile (the 「最后一个结果」
   * rule) would hand over its batch without the one still being judged —
   * which then got held behind a round that had already answered.
   */
  async reportOutcome(room: Session, dispatchSeq: number, deliveryId: string, fromId: string, outcome: string, text: string): Promise<void> {
    const source = room.snapshotEvents().find(event => event.seq === dispatchSeq)
    const key = `${room.id} ${source?.type === 'room/dispatch' ? source.data.replyTo ?? '' : ''}`
    const next = (this.gateQueues.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.gateReport(room, dispatchSeq, deliveryId, fromId, outcome, text))
    this.gateQueues.set(key, next)
    void next.then(() => { if (this.gateQueues.get(key) === next) this.gateQueues.delete(key) }, () => { if (this.gateQueues.get(key) === next) this.gateQueues.delete(key) })
    return next
  }

  private async gateReport(room: Session, dispatchSeq: number, deliveryId: string, fromId: string, outcome: string, text: string): Promise<void> {
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
        threshold: state.settings?.reportThreshold ?? 0.5,
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
    // Every timing decision the room weighed is recorded (the timeline row,
    // Context Lens); the each-setting and plan cadence decide nothing.
    if (verdict.reason !== 'setting' && verdict.reason !== 'plan') {
      const gatedExecution = runExecutionId(events, deliveryId)
      room.append('room/decision', decisionRecord('report-timing', {
        outcome: verdict.hold ? 'later' : 'now',
        ...verdict.reason === 'model' ? {} : { rule: verdict.reason },
        ...verdict.probability === undefined ? {} : { probability: verdict.probability },
        ...verdict.call === undefined ? {} : { call: verdict.call },
        about: { from: senderName ?? fromId, to: recipient.name },
        // What it decided for (batch 5 S9): the gated run and its task.
        ...sourceTask === undefined ? {} : { task: sourceTask },
        runId: deliveryId,
        ...gatedExecution === undefined ? {} : { executionId: gatedExecution },
      }))
    }
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
      }, (replay(events).settings?.reportWaitMinutes ?? 3) * 60_000)
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
  async releaseHeld(room: Session, recipientId: string, reason: 'timeout' | 'manual' | 'restart'): Promise<boolean> {
    this.clearHoldTimer(room.id, recipientId)
    const events = room.snapshotEvents()
    const open = pendingHolds(events, recipientId)
    const recipient = replay(events).members.find(member => memberId(events, member) === recipientId)
    if (open.length === 0 || recipient === undefined) return false
    const ids = open.map(seq => `#${messageId(seq)}`).join('、')
    const text = `（以上 ${open.length} 条回报一直等着交给你：${ids}${reason === 'timeout' ? '，已经等了一段时间' : ''}。用户也已在房间里看到，不要复述。）`
    const releaseTask = replay(events).deliveries?.find(row => row.dispatchSeq === open[0] && row.memberId === recipientId)?.task
    const releaseDecision = holdDecision(events, open[0]!)
    const release = room.append('room/dispatch', { id: randomUUID(), origin: 'report', targets: [recipient.name], targetIds: [recipientId], text, releases: open, releaseReason: reason, hop: 1,
      ...releaseTask === undefined ? {} : { task: releaseTask }, ...releaseDecision === undefined ? {} : { releaseDecision } })
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
    direct?: ReturnType<typeof createUserMessage>,
  ): Promise<RunOutcome> {
    const agent = this.ctx.agents.get(room.id)
    if (agent === undefined) {
      // Fail loud: the room's own agent is not live, the message goes nowhere.
      return { state: 'failed', error: 'the room session has no live agent' }
    }
    // A human message reaches the agent as itself: the room's additions
    // (briefing, room changes, notifications, held reports — never the
    // human's words again) wait for that turn's first step.
    const { prompt, carried, heldCarried } = assemblePrompt(room, member, cursor, text, relayIds, dispatchSeq)
    if (direct !== undefined && prompt.trim() !== '') this.directExtras.set(String(direct.id), prompt.trim())
    const before = room.snapshotEvents().at(-1)?.seq ?? -1
    const message = direct ?? createUserMessage({ content: [{ type: 'text', text: prompt }], source: roomSource() })
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
    if (direct !== undefined) {
      this.directMessages.delete(String(direct.id))
      this.directExtras.delete(String(direct.id))
    }
    const output = lastAssistantText(room.snapshotEvents(), before)
    return { state: 'done', ...output === '' ? {} : { text: output } }
  }

  /**
   * CLI member turn through local-agent's execution entry `run()`, then the
   * speech mirror. The core decides first round vs continuation from its own
   * records (scope, cwd and model of a continuation come from there), queues
   * the round in the member's ledger under this delivery's key, evaluates the
   * prompt when the round reaches the head of that queue, and calls back at
   * admission — where room writes its running edges. The core's ledger is
   * the member's only queue (batch 5 S7): a member waiting for 待对账 refuses
   * the round, and a delivery then stays queued, marked as waiting, until
   * the round is reconciled and recovery resubmits it under the same key.
   */
  private async runCliMember(
    room: Session, member: RoomMember, text: string, admitted: (execution?: LocalAgentExecutionAdmitted) => Promise<number>,
    relayIds: readonly string[], runId: string, deliveryId: string | undefined, dispatchSeq: number | undefined,
    follow: { executionId?: string },
  ): Promise<RunOutcome | typeof DROPPED> {
    const facade = probeLocalAgent(this.ctx)
    if (facade === undefined) {
      this.ctx.logger.warn(`room: cannot dispatch to "${member.name}": local-agent facade unavailable`)
      throw new Error('the local-agent delegation facade is unavailable')
    }
    // Roster invariant: cli members always carry a provider (invite enforces).
    const provider = member.provider ?? ''
    const identity = memberId(room.snapshotEvents(), member)
    // The member's stable child identity: the roster's, else its room id —
    // the same id a prepared member is reserved under, so the first round
    // creates the child there and every later round names it before its
    // handle reaches the journal.
    const childSessionId = member.childSessionId ?? identity
    let startedAt: number | undefined
    // The human's `/compact` (alone, to this member) compacts its context
    // instead of prompting it: a compaction round (local-agent queues it like
    // any round), one transcript row, no reply.
    const compacting = isCompactDispatch(room.snapshotEvents(), dispatchSeq)
    const prepared = member.childSessionId !== undefined && facade.isPreparedMember?.(member.childSessionId) === true
    if (compacting && (member.childSessionId === undefined || prepared)) {
      startedAt = await admitted()
      return { state: 'done', text: NOTHING_TO_COMPACT_TEXT }
    }
    const current = (): RoomMember | undefined => replay(room.snapshotEvents()).members.find(entry => memberId(room.snapshotEvents(), entry) === identity)
    let carried: readonly RoomRelay[] = []
    let heldCarried: readonly number[] = []
    let dropped = false
    const stop = new AbortController()
    // Evaluated when the core reaches this round: the prompt carries what the
    // member has not seen by then. A delivery settled while it waited (a
    // removal, a move-on) or a removed member never reaches the member.
    const input = async (): Promise<readonly ContentBlock[]> => {
      const now = current()
      const settledMeanwhile = deliveryId !== undefined && replay(room.snapshotEvents()).deliveries?.some(row => row.id === deliveryId && row.status !== 'queued') === true
      if (now === undefined || settledMeanwhile) {
        dropped = true
        stop.abort()
        throw new Error('room delivery settled before the member reached it')
      }
      if (compacting) return [{ type: 'text', text: COMPACT_COMMAND }]
      const cursor = previousCursor(room.snapshotEvents(), now.name, dispatchSeq ?? Number.MAX_SAFE_INTEGER)
      const assembled = assemblePrompt(room, now, cursor, text, relayIds, dispatchSeq)
      carried = assembled.carried
      heldCarried = assembled.heldCarried
      return [{ type: 'text', text: assembled.prompt }]
    }
    const { cause, task } = executionFacts(room.snapshotEvents(), room.id, dispatchSeq, relayIds)
    // The creation identity matters to a first round only; the core ignores it
    // for a continuation. A prepared member keeps its prepared identity and
    // takes only the label.
    const create = member.childSessionId === undefined
      ? { label: member.name, ...member.model === undefined ? {} : { model: member.model }, ...member.effort === undefined ? {} : { effort: member.effort }, ...member.cwd === undefined ? {} : { cwd: member.cwd } }
      : prepared ? { label: member.name } : undefined
    const progress = (event: LocalAgentRunProgress): void => {
      if (event.kind !== 'settled') return
      const previous = room.snapshotEvents().filter(row => row.type === 'room/run-state' && row.data.runId === runId).at(-1)
      if (previous?.type !== 'room/run-state') return
      // Usage in one place (batch 5 S6): the round's spend is never copied
      // here. Calls carry theirs on the member log's assistant messages, the
      // CLI's own round total sits on the execution's end record, and the
      // timeline reads both through the core's readExecution. Only the
      // observed model and effort are the room's to note.
      if (event.observedModel === undefined && event.observedEffort === undefined) return
      room.append('room/execution-metadata', { runId,
        ...event.observedModel === undefined ? {} : { model: event.observedModel },
        ...event.observedEffort === undefined ? {} : { effort: event.observedEffort },
      })
      void this.ctx.sessions.flush(room).catch(error => this.ctx.logger.warn(`room: execution metadata flush failed: ${String(error)}`))
    }
    let handle: LocalAgentExecutionHandle
    try {
      handle = await facade.run({
        parentSessionId: room.id,
        provider,
        member: { childSessionId, ...create === undefined ? {} : { create } },
        input,
        operation: compacting ? 'compact' : 'prompt',
        caller: 'room',
        ...cause === undefined ? {} : { cause },
        ...task === undefined ? {} : { task },
        // One delivery is one execution: a retry or a recovery replay of the
        // same delivery is never admitted twice.
        key: deliveryId ?? (relayIds.length > 0 ? `relay:${relayIds.join(',')}` : runId),
        callerRef: runId,
        signal: stop.signal,
        on: { admitted: async (execution) => { startedAt = await admitted(execution) }, progress },
      })
    } catch (error) {
      // The core refuses every round of a member with an unknown-outcome
      // execution or a paused queue: say where to clear it instead of a bare failure.
      const refused = this.refusal(facade, childSessionId, error)
      if (refused === MEMBER_UNRECONCILED_TEXT && deliveryId !== undefined) return await this.waitForReconcile(room, member, runId)
      throw refused === undefined ? error : new Error(refused)
    }
    if (claimed.has(handle.executionId)) return DROPPED
    claimed.add(handle.executionId)
    // Released by run() once the outcome is journaled.
    follow.executionId = handle.executionId
    return await this.followCliRound(room, member, handle, {
      startedAt: () => startedAt, admitted, assembled: () => ({ carried, heldCarried, dropped }),
      relayIds, runId, deliveryId, dispatchSeq, compacting, childSessionId, facade,
    })
  }

  /**
   * A delivery the core refused because its member waits for 待对账: it
   * stays queued (recovery resubmits it under its key once the member's
   * round is reconciled, wherever that happens), and the timeline says so
   * once — a run row whose projection reads 待对账 while the delivery waits
   * (`MEMBER_WAITING_TEXT`). A legacy relay has no delivery to wait and
   * still fails with {@link MEMBER_UNRECONCILED_TEXT}.
   */
  private async waitForReconcile(room: Session, member: RoomMember, runId: string): Promise<typeof DROPPED> {
    const events = room.snapshotEvents()
    if (events.some(event => event.type === 'room/run-state' && event.data.runId === runId)) return DROPPED
    const name = replay(events).members.find(entry => entry.id === member.id)?.name ?? member.name
    const childSessionId = runChildSessionId(room.id, member)
    room.append('room/run-state', { member: name, runId, state: 'failed', startedAt: Date.now(), elapsedMs: 0, error: MEMBER_WAITING_TEXT,
      ...childSessionId === undefined ? {} : { childSessionId } })
    await this.ctx.sessions.flush(room)
    return DROPPED
  }

  /**
   * Why the core refused a member round, in the room's words, when it was
   * the member's own state: an unreconciled execution, or a queue paused
   * after a restart. Undefined for any other failure.
   */
  private refusal(facade: LocalAgentFacade, childSessionId: string, error: unknown): string | undefined {
    let ledger: ReturnType<NonNullable<LocalAgentFacade['readMemberInbox']>> | undefined
    try { ledger = facade.readMemberInbox?.(childSessionId) } catch { /* not a member the core knows yet: read the message */ }
    const message = faultMessage(error)
    if (ledger?.messages.some(row => row.status === 'uncertain') === true || /uncertain outcome/.test(message)) return MEMBER_UNRECONCILED_TEXT
    if (/inbox is paused/.test(message)) return MEMBER_PAUSED_TEXT
    return undefined
  }

  /** The rest of a CLI round once the core queued it: publish, mirror, settle. */
  private async followCliRound(room: Session, member: RoomMember, handle: LocalAgentExecutionHandle, round: {
    readonly startedAt: () => number | undefined
    readonly admitted: (execution?: LocalAgentExecutionAdmitted) => Promise<number>
    readonly assembled: () => { readonly carried: readonly RoomRelay[]; readonly heldCarried: readonly number[]; readonly dropped: boolean }
    readonly relayIds: readonly string[]
    readonly runId: string
    readonly deliveryId: string | undefined
    readonly dispatchSeq: number | undefined
    readonly compacting: boolean
    readonly childSessionId: string
    readonly facade: LocalAgentFacade
  }): Promise<RunOutcome | typeof DROPPED> {
    const { relayIds, runId, dispatchSeq } = round
    const run = await handle.started.catch(() => undefined)
    if (run === undefined) {
      const settlement = await handle.settled
      if (round.assembled().dropped) return DROPPED
      const refused = settlement.outcome === 'done' ? undefined : this.refusal(round.facade, round.childSessionId, settlement.error ?? '')
      if (refused === MEMBER_UNRECONCILED_TEXT && round.deliveryId !== undefined) return await this.waitForReconcile(room, member, runId)
      if (refused !== undefined) return { state: 'failed', error: refused }
      // Ended before it started (a refused admission, a cancelled queue row),
      // or a replayed key whose execution already ended: nothing to mirror.
      return { state: settlement.outcome, ...settlement.error === undefined ? {} : { error: settlement.error }, turns: settlement.turns }
    }
    // A provider that never reported its admission: the run published, so it was admitted.
    if (round.startedAt() === undefined) await round.admitted({ executionId: handle.executionId, admittedAt: Date.now(), childFromSeq: 0 })
    const { carried, heldCarried } = round.assembled()
    try {
      if (member.childSessionId === undefined) {
        // The journal learns the member's child identity once it exists.
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
      await handle.settled
      throw error
    }
    const result = await run.result
    const startedAt = round.startedAt() ?? Date.now()
    if (round.compacting) {
      // The core's compaction fact is in place once the execution settled.
      const settlement = await handle.settled
      return { ...await this.recordCompaction(room, member, runId, run.id, result, startedAt), turns: settlement.turns }
    }
    const output = runOutputText(result.output)
    const interrupted = result.stopReason === 'completed' ? undefined
      : result.stopReason === 'aborted' ? 'cancelled' as const : 'failed' as const
    const reportedTo = dispatchSeq === undefined ? undefined : reportRecipient(room.snapshotEvents(), dispatchSeq)?.name
    // The member's own closing message: per-message tools address it in its session.
    const closingMessageId = lastAssistantMessageId(this.ctx.sessions.get(run.id))
    const asks = askOffsets(room.snapshotEvents(), runId, output)
    const speech = output !== '' || interrupted === undefined ? room.append('room/speech', {
      member: replay(room.snapshotEvents()).members.find(entry => entry.id === member.id)?.name ?? member.name,
      text: output,
      ...asks.length === 0 ? {} : { asks },
      childSessionId: run.id,
      runId,
      ...closingMessageId === undefined ? {} : { messageId: closingMessageId },
      durationMs: Date.now() - startedAt,
      ...interrupted === undefined ? {} : { interrupted },
      ...reportedTo === undefined ? {} : { reportedTo },
    }) : undefined
    if (speech !== undefined) {
      floatRunningCards(room, speech.data.member)
      await this.ctx.sessions.flush(room)
    }
    // The execution's recorded turns arrive with its settlement (the speech
    // above never waits for it).
    const { turns } = await handle.settled
    if (result.stopReason === 'completed') {
      await this.ctx.sessions.flush(room)
      return { state: 'done', text: runOutputText(result.output), turns }
    } else if (result.stopReason === 'aborted') {
      return { state: 'cancelled', text: output, turns }
    } else {
      return { state: 'failed', text: output, error: `the member run ended with stopReason "${result.stopReason}"`, turns }
    }
  }

  /**
   * The room's row for a member's compaction round: its outcome and summary
   * from the member session's `local-agent/compaction` event recorded during
   * THIS run (the room never re-derives them, and never reads an earlier
   * run's) — its sizes and spend are read from that fact at display time,
   * never copied (batch 5 S6) — and no
   * speech — Kimi answers `/compact` with its summary, which is the row's,
   * not a reply. Whether the member reports compaction numbers is the core
   * fact's own mark (batch 5 S2: local-agent writes the fact for every
   * `/compact` execution, `unrecorded` when the provider reported none), never
   * room's guess: a fact marked unrecorded for its sizes and spend makes the
   * row `unreported`. A run whose range holds no fact (a core from before S2)
   * shows what it has — no numbers — and is not inferred to be unreported.
   */
  private async recordCompaction(
    room: Session, member: RoomMember, runId: string, childSessionId: string, result: { readonly stopReason: string; readonly diagnostic?: string },
    startedAt: number | undefined,
  ): Promise<RunOutcome> {
    const events = room.snapshotEvents()
    const compaction = runChildEvents(events, runId, this.ctx.sessions.get(SessionId(childSessionId))).findLast(event => event.type === 'local-agent/compaction')
    const data: Partial<LocalAgentCompactionEvent> = compaction?.type === 'local-agent/compaction' ? compaction.data : {}
    const outcome = data.outcome ?? (result.stopReason === 'completed' ? 'completed' : 'failed')
    const unreported = outcome === 'completed' && compactionUnreported(data)
    room.append('room/member-compacted', {
      member: replay(events).members.find(entry => entry.id === member.id)?.name ?? member.name,
      // The fact's sizes and spend stay on the member log's compaction fact
      // (batch 5 S6): the row reads them through readExecution, never a copy.
      memberId: memberId(events, member), runId, outcome,
      ...data.summary === undefined ? {} : { summary: data.summary },
      ...outcome === 'completed' ? {} : { error: data.error ?? result.diagnostic ?? `compaction ${outcome}` },
      ...startedAt === undefined ? {} : { durationMs: Date.now() - startedAt },
      ...unreported ? { unreported: true as const } : {},
    })
    await this.ctx.sessions.flush(room)
    return outcome === 'completed'
      ? { state: 'done', text: unreported ? COMPACT_UNREPORTED_TEXT : COMPACTED_TEXT }
      : { state: 'failed', text: '', error: data.error ?? result.diagnostic ?? `compaction ${outcome}` }
  }

  /** Settle only this execution, preserving newer runs. */
  private async settle(
    room: Session, member: RoomMember, runId: string, startedAt: number, outcome: RunOutcome, executionId: string | undefined,
  ): Promise<RunOutcome> {
    const events = room.snapshotEvents()
    const currentMember = replay(events).members.find(entry => memberId(events, entry) === memberId(events, member))
    const memberName = currentMember?.name ?? member.name
    // A terminal edge since this run's running edge (a cancel, a stop) wins;
    // one before it (the 待对账 wait row of a delivery that waited) does not.
    const lastRunning = events.findLastIndex(event => event.type === 'room/run-state' && event.data.runId === runId && event.data.state === 'running')
    const terminal = events.find((event, index) => index > lastRunning && event.type === 'room/run-state' && event.data.runId === runId && event.data.state !== 'running')
    if (terminal?.type === 'room/run-state' && terminal.data.state !== 'running') {
      return { ...outcome, state: terminal.data.state, ...terminal.data.error === undefined ? {} : { error: terminal.data.error } }
    }
    const childSessionId = runChildSessionId(room.id, currentMember ?? member)
    const compactRun = events.some(event => event.type === 'room/run-state' && event.data.runId === runId && event.data.operation === 'compact')
    // An execution's round is its recorded turns (the settlement); a run
    // without one (the room's own agent) reads its range from childFromSeq.
    const childTurn = compactRun ? undefined
      : executionId !== undefined ? outcome.turns?.at(-1)
      : runChildTurn(events, runId, childSessionId === undefined ? undefined : this.ctx.sessions.get(childSessionId))
    room.append('room/run-state', {
      member: memberName, runId, state: outcome.state, startedAt, elapsedMs: Date.now() - startedAt,
      ...childSessionId === undefined ? {} : { childSessionId },
      ...childTurn === undefined ? {} : { childTurn },
      ...executionId === undefined ? {} : { executionId },
      ...compactRun ? { operation: 'compact' as const } : {},
      ...outcome.error === undefined ? {} : { error: outcome.error },
    })
    await this.ctx.sessions.flush(room)
    return outcome
  }
}
