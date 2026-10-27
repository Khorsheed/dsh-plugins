/**
 * room host half: the `room` Typert Remote service. (The `room_invite` /
 * `room_message` / `room_read` / `room_plan` model tools left this package's profile-root
 * registration in the M4' tool-row split — their definition factories live
 * in ./tool-definition.ts and the package's own `./tool` composition entry
 * mounts them inside agent-preset compositions.) The room's entire state is the session's `room/*` custom-event
 * journal (log-only events — persistence and reload-replay come free, the
 * model never sees them, and harnesses without this plugin replay the session
 * safely); every read folds the journal through the pure replay, and every
 * mutating Remote appends and flushes. Dispatch records and first tasks are
 * executed by the DispatchEngine: main-agent members get a producer-sourced
 * followup on the room's own agent, CLI members go through the probed
 * local-agent delegation facade (absent facade = degraded CLI capability,
 * never a boot failure). The member-notification gate lives here too: the
 * local-agent bridge duck-type-calls `receiveMemberMessage` (service face via
 * ctx.provide, off the wire), the human confirms/dismisses through the
 * confirmRelay/dismissRelay Remotes.
 * @module @khorsheed/dsh-room
 */
import { planCommandContract } from './plan.ts'
import { PlanService } from './plan-service.ts'
import { createHash, randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `sessions` SessionStore merge onto Context.
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { LocalAgentMemberRun, MemberRoomCommand, MemberMessageOutcome } from '@khorsheed/dsh-local-agent/types'
import { SessionId } from '@deepseek-ai/dsh-session'
// Type-only: pulls the `agents` registry merge onto Context (create/resume
// are consumed through the registry, not the agent-loop package).
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subagent'
// The persistence read path refuses logs carrying event types outside the
// KNOWN_SESSION_EVENT_TYPES catalog; registering the room vocabulary declares
// that a room-mounted build understands them (see ROOM_EVENT_TYPES in
// journal.ts). The registration must land in the TOOLCHAIN's module instance:
// the toolchain loads dsh-session from src (tsx path mapping) while a
// profile-installed plugin resolves the root export to lib — two instances,
// two catalog Sets, and a registration that never reaches the reader (the
// prod 3080 failure mode). Importing the source file through the package's
// `./src/*` export lands both sides on the same file URL, but no static
// specifier expresses it (the exact-file exports map needs tsx's extension
// probing; the `.ts` form trips TS2877) — so the specifier is computed and
// resolved at runtime, and the top-level await lets the plugin loader block
// boot on the registration completing. Test environments (vite) cannot
// resolve the `./src/*` export and take the root fallback — there the root
// and the toolchain already share one instance.
const catalogSpecifier = ['@deepseek-ai/dsh-session', 'src', 'known-event-types'].join('/')
const catalogModule = await import(catalogSpecifier)
  .catch(() => import('@deepseek-ai/dsh-session')) as { KNOWN_SESSION_EVENT_TYPES: Set<string> }
for (const type of ROOM_EVENT_TYPES) catalogModule.KNOWN_SESSION_EVENT_TYPES.add(type)
import { composeRoomAgent, deriveSessionPreset, probeAgentPresets, inspectCold, preloadPresetDerivationHost, presetDerivationHost, roomSessionPreset } from './agent-setup.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
// Type-only: pulls the `room/*` SessionEventMap merges.
import type {} from './types.ts'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { probeLocalAgent, probeLocalAgentRoster } from './adapter.ts'
import { DispatchEngine, MERGED_BACKLOG_TEXT, MOVED_ON_TEXT, floatRunningCards, heldReportsText, isRoomSource, roomSource, runChildSessionId, runChildTurn } from './dispatch.ts'
import { coordinatorMember, DEFAULT_ROOM_SETTINGS, memberId, isRoomLog, MAIN_AGENT_MEMBER, parseMentions, replay, ROOM_EVENT_TYPES, ROOM_ROLE_MAX } from './journal.ts'
import { messageId, parseMessageRef, releaseIntent, SELF_TASK, sendOrHold, workingHop } from './messaging.ts'
import { isHumanMessage, linkedTask, taskLinks } from './deliveries.ts'
import { resolveTaskRef } from './jobs.ts'
import { suggestTask } from './report-gate.ts'
import { decisionRecord } from './decisions.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { askerPrompt, claimed, helperTools, helpMessage, memberFromLabel, mentionedSessions, messagePrompt, readHelpSource, receivedHelps, referencedSessions, replayHelps, requestPrompt, turnAnswer, type HelpSource } from './help.ts'
import type {
  RoomHelp, RoomHelpLinkRequest, RoomHelpLinkResult,
  RoomCancelRequest, RoomCancelResult,
  RoomPrepareMemberRequest, RoomPrepareMemberResult,
  RoomFailure, RoomSetCoordinatorRequest, RoomSetCoordinatorResult, RoomReconcileDeliveryRequest, RoomReconcileDeliveryResult,
  RoomGetStateRequest, RoomGetStateResult,
  RoomInviteRequest, RoomInviteResult,
  RoomIsRoomRequest,
  RoomListProvidersRequest,
  RoomMember, RoomMemberMessage, RoomMemberMessageReceipt,
  RoomMessageReceipt, RoomMessageRequest, RoomReleaseReportsRequest, RoomReleaseReportsResult, RoomSetTaskHintRequest, RoomStopJobRequest, RoomStopJobResult, RoomMessageResult, RoomRelay, RoomSetSettingsRequest, RoomSetSettingsResult,
  RoomPostMessageRequest, RoomPostMessageResult, RoomAttachmentInput, RoomDispatchAttachment, RoomPendingCard, RoomPendingCardsRequest,
  RoomPresetInfo, RoomProviderInfo, RoomProviderList,
  RoomRelayResolveRequest, RoomRelayResolveResult,
  RoomRemoveMemberRequest, RoomRemoveMemberResult, RoomRestoreMemberRequest, RoomRestoreMemberResult,
  RoomSetGoalRequest, RoomSetGoalResult,
  RoomState, RoomUpdateMemberRequest, RoomUpdateMemberResult, RoomAnswerApprovalRequest, RoomAnswerApprovalResult, RoomAnswerQuestionRequest, RoomAnswerQuestionResult, RoomQuestionAnswer, RoomQuestionItem,
} from './types.ts'

export type * from './types.ts'
export { MAIN_AGENT_MEMBER, ROOM_EVENT_TYPES } from './journal.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Room service owned by the room plugin: the Typert Remote gateway AND
     * the in-process service face the local-agent bridge duck-type-calls
     * (`receiveMemberMessage`). TypertRemoteService's Service base provides
     * it under 'room'.
     */
    room: RoomService
  }
}

/** A resolved room session plus its replayed state, or the rejection. */
type RoomLoad =
  | { readonly ok: true; readonly session: Session; readonly state: RoomState }
  | { readonly ok: false; readonly error: RoomFailure }

/** A side-effect-free room read: replayed state plus the log-recorded preset. */
type RoomColdLoad =
  | { readonly ok: true; readonly state: RoomState; readonly preset: string | undefined }
  | { readonly ok: false; readonly error: RoomFailure }

/** Addressing/display names must stay parseable by the composer @-grammar. */
function validName(name: string): boolean {
  return name !== '' && !/\s/.test(name) && !name.includes('@')
}

/** A task title is the dispatch text's first line, truncated. */
/**
 * The receipt a sending model reads back: the message id and what happens
 * next, or why it waits.
 */
/** How long a member's question card waits for the human before its call gives up. */
const QUESTION_TIMEOUT_MS = 30 * 60_000

/**
 * Validate a member's `ask_user_question` questions: an array, or that array
 * as JSON text (some models only send flat strings). Options may be labels or
 * `{ label, description }`; `multi_select` (the host tool's spelling) or
 * `multiSelect` marks a multi-pick question.
 * @param raw - the tool argument.
 * @returns the questions, or the error text the model reads.
 */
export function parseQuestions(raw: unknown): readonly RoomQuestionItem[] | string {
  let value = raw
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return 'questions must be an array (or its JSON text)' }
  }
  if (!Array.isArray(value) || value.length === 0) return 'questions must be a non-empty array'
  if (value.length > 4) return 'Ask at most 4 questions at a time'
  const questions: RoomQuestionItem[] = []
  for (const [index, entry] of value.entries()) {
    if (entry === null || typeof entry !== 'object') return `questions[${index}] must be an object`
    const row = entry as Record<string, unknown>
    if (typeof row.question !== 'string' || row.question.trim() === '') return `questions[${index}].question is required`
    const options: { label: string; description?: string }[] = []
    for (const option of Array.isArray(row.options) ? row.options : []) {
      const label = typeof option === 'string' ? option : (option as { label?: unknown } | null)?.label
      if (typeof label !== 'string' || label.trim() === '') continue
      const description = typeof option === 'object' && option !== null && typeof (option as { description?: unknown }).description === 'string' ? (option as { description: string }).description.trim() : ''
      options.push({ label: label.trim().slice(0, 200), ...description === '' ? {} : { description: description.slice(0, 500) } })
    }
    if (options.length > 8) return `questions[${index}] has more than 8 options`
    const id = typeof row.id === 'string' && row.id.trim() !== '' ? row.id.trim() : `q${index + 1}`
    const header = typeof row.header === 'string' && row.header.trim() !== '' ? row.header.trim().slice(0, 40) : undefined
    const multiSelect = row.multi_select === true || row.multiSelect === true
    questions.push({ id, question: row.question.trim().slice(0, 2000), ...header === undefined ? {} : { header }, ...options.length === 0 ? {} : { options }, ...multiSelect ? { multiSelect } : {} })
  }
  if (new Set(questions.map(question => question.id)).size !== questions.length) return 'Question ids must be unique'
  return questions
}

/**
 * The message a late answer reaches its member as: each question with the
 * human's pick, so the member can go on (or correct what it assumed).
 * @param questions - the card's questions.
 * @param answers - the human's answers, one per question.
 * @returns the dispatch text.
 */
export function lateAnswerText(questions: readonly RoomQuestionItem[], answers: readonly RoomQuestionAnswer[]): string {
  const lines = questions.map((question) => {
    const answer = answers.find(entry => entry.id === question.id)
    const picked = [...answer?.selected ?? [], ...answer?.custom === undefined ? [] : [answer.custom]].join('；')
    return `- ${question.header === undefined ? '' : `${question.header}：`}${question.question} → ${picked === '' ? '（没选）' : picked}`
  })
  return [
    '你之前用 ask_user_question 问的问题没等到回答就过期了，人现在补答了：',
    ...lines,
    '',
    '按这些答案继续。如果你已经按自己的假设往下做了，对照答案调整，并说一下改了什么。',
  ].join('\n')
}

/** The host attachment services composer attachments ride; probed, so a host without them refuses attachments only. */
interface AttachmentServices {
  readonly attachments?: undefined | {
    admitPromptContent(parts: readonly unknown[]): Promise<readonly { readonly type: string; readonly attachment?: { readonly name?: string } }[]>
    imageHostPath?(ref: unknown): string | undefined
    fileHostPath?(ref: unknown): string | undefined
  }
  readonly fileUploads?: undefined | {
    resolve(agent: unknown, receiptId: string): unknown
    bindPrompt(agent: unknown, receiptIds: readonly string[], requestId: string): { commit(): void; [Symbol.dispose](): void }
  }
}

/**
 * The dispatch text with the message's attachments appended as local paths:
 * every member — CLI or native — opens them with its own read tool, so one
 * form reaches all of them.
 * @param text - the dispatched text.
 * @param attachments - the admitted attachments.
 * @returns the text members receive.
 */
export function withAttachmentPaths(text: string, attachments: readonly RoomDispatchAttachment[] | undefined): string {
  if (attachments === undefined || attachments.length === 0) return text
  const lines = attachments.map((entry) => {
    const label = `${entry.kind === 'image' ? '图片' : '文件'}${entry.name === undefined ? '' : ` ${entry.name}`}`
    return `- ${label}：${entry.path ?? '（宿主没有给出本地路径，打不开就告诉人）'}`
  })
  return [text, '', '人随消息附了这些附件，用你自己的读取工具打开（图片用能看图的读取工具）：', ...lines].join('\n')
}

function messageReceipt(receipt: RoomMessageReceipt, kind: 'task' | 'notify'): RoomMemberMessageReceipt {
  if (receipt.held !== undefined) {
    const why = receipt.held === 'paused' ? '房间已暂停，恢复后自动投递'
      : receipt.held === 'hop-limit' ? '这条消息链已到跳数上限，等房间主人决定是否继续'
        : '房间设置为成员间消息需房间主人确认'
    return `pending-confirm （${why}）`
  }
  return kind === 'notify'
    ? `sent #${receipt.messageId}（知会，不会回报）`
    : `sent #${receipt.messageId}（${receipt.member} 做完后结果会自动回报给你；不要 sleep 等待，也不要用 room_read 轮询）`
}

/** The message-tools edit trigger (data only — no dependency on that plugin). */
function isEditTrigger(source: { readonly kind: string }): boolean {
  return source.kind === 'message-tools' && (source as { readonly op?: unknown }).op === 'edit-trigger'
}

/** Whether a user/message is message-tools' in-place edit of a human message. */
function editedText(source: { readonly kind: string }): boolean {
  return source.kind === 'message-tools' && (source as { readonly op?: unknown }).op === 'edit'
}

/** A message's text blocks, joined. */
function textBlocks(content: readonly { readonly type: string; readonly text?: string }[]): string {
  return content.flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n').trim()
}

/**
 * What a new coordinator reads once, on its first round: who handed over,
 * the goal and open tasks, and where to look. The conversation itself is
 * not replayed — a member that was in the room has most of it already, and
 * re-sending it cost a five-figure prompt; it reads the room when it needs to.
 */
export function handoffText(_events: readonly SessionEvent[], state: RoomState, sessionId: string, from: string, to: string): string {
  const open = (state.jobs ?? []).filter(job => job.status === 'running' || job.status === 'attention')
  return [
    `【协调者交接】${from} 把协调者交给了你（${to}）。从现在起，人发的不带 @ 的消息都由你来接。`,
    `房间会话：${sessionId}。各成员之前的原生会话都还在，可按会话 ID 查看；完整状态用 room_read。`,
    state.goal === undefined ? '' : `房间目标：${state.goal}`,
    state.plan === undefined ? '' : `正式目标 ${state.plan.id}（第 ${state.plan.revision} 版）：${state.plan.objective}（${state.plan.status}）。尝试、证据、依赖和预算用 room_read 查看；保持当前的暂停状态。`,
    ...open.map(job => `进行中的任务 ${job.number}（${job.status === 'attention' ? '需要人处理' : '进行中'}）：${job.title}`),
    '之前的对话没有附上：需要时用 room_read，或打开房间会话自己看。',
  ].filter(Boolean).join('\n').slice(0, 16000)
}

/**
 * room Remote service: promotion, roster management, the human @-message
 * intake, the notification gate, tasks, and run cancellation. A
 * room IS a normal session; the journal is its only state. A room is never
 * CREATED apart from a session — inviting an agent into any session promotes
 * it (see ensureRoom; the room-session-promotion proposal).
 */
export class RoomService extends TypertRemoteService {
  static inject = ['sessions', 'agents']

  /** The dispatch engine executing this service's dispatch records. */
  readonly plans: PlanService
  readonly engine: DispatchEngine
  private readonly handoffs = new Set<string>()

  /**
   * The terminal run-state fields Context Lens correlates on: the child
   * identity plus the round the run reached (live sessions only).
   */
  private terminalRunStateFields(session: Session, state: RoomState, memberName: string): { childSessionId?: SessionId; childTurn?: number } {
    const member = state.members.find(entry => entry.name === memberName)
    const childSessionId = runChildSessionId(session.id, member)
    const childTurn = runChildTurn(childSessionId === undefined ? undefined : this.ctx.sessions.get(childSessionId))
    return {
      ...childSessionId === undefined ? {} : { childSessionId },
      ...childTurn === undefined ? {} : { childTurn },
    }
  }

  /** sessionId → in-flight cold resume (mutations on a cold room dedupe). */
  private readonly resumes = new Map<SessionId, Promise<RoomLoad>>()

  /**
   * @param ctx - host context carrying the session store.
   */
  constructor(ctx: Context) {
    super(ctx, 'room')
    // Resolve the preset-registry module before any resume/create path
    // derives a session preset (the 0.1.7-rc.1 host renamed the package; the
    // probe falls back to the old name, then to the no-preset degrade).
    ctx.effect(async () => {
      await preloadPresetDerivationHost()
      return () => {}
    }, 'room: preset-registry probe')
    ctx.effect(async () => {
      const loader = ctx.get('loader') as { import?: (name: string) => Promise<{ KNOWN_SESSION_EVENT_TYPES?: ReadonlySet<string> }> } | undefined
      if (loader?.import === undefined) return () => {}
      for (const specifier of ['@deepseek-ai/dsh-session', catalogSpecifier]) {
        try {
          const catalog = await loader.import(specifier)
          for (const type of ROOM_EVENT_TYPES) (catalog.KNOWN_SESSION_EVENT_TYPES as Set<string> | undefined)?.add(type)
        } catch { /* Optional source resolution; static catalog registration remains. */ }
      }
      return () => {}
    }, 'room: runtime event vocabulary')
    this.plans = new PlanService(ctx, () => this.engine)
    this.engine = new DispatchEngine(ctx, {
      allows: (room, seq) => this.plans.allows(room, seq),
      admitted: (room, seq) => this.plans.admitted(room, seq),
      settled: async (room, seq, outcome) => {
        await this.plans.settled(room, seq, outcome)
        void this.helpSettled(room, seq, outcome).catch((error: unknown) => { this.ctx.logger.warn(`room: help reply faulted: ${String(error)}`) })
      },
    })
    ctx.effect(() => () => this.plans.dispose())
    // The human talking to the room's own agent directly (the official input
    // path): file the message under a task before the model reads it — the
    // composer's tag, else the decision model while tasks are open — and tell
    // the coordinator when it was filed under an existing task.
    ctx.on('agent/pre-step', async ({ agent, step }, next) => {
      const decision = await next()
      if (step !== 1 || decision.kind !== 'enter') return decision
      const events = agent.session.snapshotEvents()
      if (!isRoomLog(events) || coordinatorMember(replay(events), events)?.kind !== 'main-agent') return decision
      const notes: string[] = []
      for (const message of decision.messages) {
        if (message.source.kind !== 'user') continue
        const text = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
        const filed = await this.fileHumanMessage(agent.session, message.id, text, this.consumeTaskHint(agent.session.id))
        if (filed.note !== undefined) notes.push(filed.note)
      }
      if (notes.length === 0) return decision
      return { ...decision, messages: [...decision.messages, createUserMessage({ content: [{ type: 'text', text: notes.join('\n') }], source: roomSource() })] }
    })
    // A turn the room did not start (the human talking to the room's agent or
    // to a native member directly) still carries the reports the gate holds
    // for that agent: one extra message on the turn's first step, so the
    // agent never answers without results that already arrived.
    ctx.on('agent/pre-step', async ({ agent, step }, next) => {
      const decision = await next()
      if (step !== 1 || decision.kind !== 'enter' || decision.messages.some(message => isRoomSource(message.source))) return decision
      const target = this.heldTarget(agent.session.id)
      if (target === undefined) return decision
      const held = heldReportsText(target.room.snapshotEvents(), memberId(target.room.snapshotEvents(), target.member))
      if (held === undefined) return decision
      await this.engine.markHeldReleased(target.room, target.member, held.seqs)
      return { ...decision, messages: [createUserMessage({ content: [{ type: 'text', text: held.text }], source: roomSource() }), ...decision.messages] }
    })
    // A stale client or another official input surface must not wake a DSH
    // model behind an external coordinator. Public pre-step admits an empty
    // initial step without a model call after room has durably accepted it.
    const nativeTurns = new WeakMap<object, number>()
    ctx.on('agent/pre-step', async ({ agent, messages, turn, step }, next) => {
      const events = agent.session.snapshotEvents()
      if (!isRoomLog(events) || coordinatorMember(replay(events), events)?.kind !== 'cli') return next()
      if (nativeTurns.get(agent) === turn) return next()
      if (step !== 1) throw new Error('Room native turn has no explicit member dispatch')
      if (messages.some(message => isRoomSource(message.source))) {
        nativeTurns.set(agent, turn)
        return next()
      }
      // An edit of the human's message (message-tools) wakes this agent to
      // answer again; behind an external coordinator the edited text goes
      // to the coordinator through the room instead.
      const trigger = messages.find(message => isEditTrigger(message.source))
      if (trigger !== undefined) {
        const routed = await this.routeEdit(agent.session, String(trigger.id))
        if (!routed.ok) throw new Error(`Room input routing failed: ${routed.code}`)
        return { kind: 'enter', messages: [] }
      }
      for (const message of messages) {
        if (message.source.kind !== 'user' || message.content.some(block => block.type !== 'text')) {
          throw new Error('Use the room input route for this coordinator; this input cannot be forwarded losslessly')
        }
        const result = await this.postMessage({ sessionId: agent.session.id, requestId: String(message.id), text: message.content.map(block => block.type === 'text' ? block.text : '').join('\n') })
        if (!result.ok) throw new Error(`Room input routing failed: ${result.error.code}`)
      }
      return { kind: 'enter', messages: [] }
    })
    // The session list's status (the host shows a session running only while
    // its own agent runs): a room is running while any member runs, and its
    // waiting question/approval cards are tracked for the browser.
    ctx.on('session/event', (session, event) => { this.observeActivity(session, event) })
    ctx.on('agent/status', ({ agent, status }) => {
      // The room's own agent settling must not hide members still at work.
      if (status !== 'running' && (this.activeRuns.get(String(agent.id))?.size ?? 0) > 0) this.emitStatus(String(agent.id), true)
    })
    // Cross-session help (help.ts): a help message reaching a helper's turn
    // equips that agent with the helper tools and marks the thread running;
    // an agent whose log already holds help requests (a restart dropped its
    // agent-local tools) is equipped on its first step.
    const scanned = new WeakSet<object>()
    ctx.on('agent/pre-step', async ({ agent, step }, next) => {
      const decision = await next()
      if (decision.kind !== 'enter') return decision
      const arriving = decision.messages.flatMap((message) => {
        const source = readHelpSource(message.source)
        return source === undefined ? [] : [source]
      })
      if (arriving.length > 0) {
        this.equipHelper(agent)
        for (const source of arriving) await this.markHelpRunning(source)
      } else if (step === 1 && !scanned.has(agent)) {
        scanned.add(agent)
        if (receivedHelps(agent.session.snapshotEvents()).length > 0) this.equipHelper(agent)
      }
      return decision
    })
    // The model-facing room tools are deliberately NOT registered here: they
    // belong to this package's `./tool` composition entry (src/tool.ts),
    // which mounts the tool row inside agent-preset compositions
    // (session-granted). The definition factories live in
    // ./tool-definition.ts for that row.
  }

  /** Resolve a LIVE session as a room: presence, marker, replayed state. */
  private load(sessionId: SessionId): RoomLoad {
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) return { ok: false, error: { code: 'session-not-found' } }
    if (!isRoomLog(session.snapshotEvents())) return { ok: false, error: { code: 'not-a-room' } }
    return { ok: true, session, state: replay(session.snapshotEvents()) }
  }

  /**
   * Read a session as a room without side effects: the live store first, then
   * a persistence inspection (a cold room after a host restart answers from
   * its durable log; nothing is attached or resumed on a read).
   */
  private async loadCold(sessionId: SessionId): Promise<RoomColdLoad> {
    const live = this.ctx.sessions.get(sessionId)
    if (live !== undefined) {
      return isRoomLog(live.snapshotEvents())
        ? { ok: true, state: replay(live.snapshotEvents()), preset: roomSessionPreset(live) }
        : { ok: false, error: { code: 'not-a-room' } }
    }
    const inspected = await inspectCold(this.ctx, sessionId)
    if (inspected === undefined) return { ok: false, error: { code: 'session-not-found' } }
    if (!isRoomLog(inspected.events)) return { ok: false, error: { code: 'not-a-room' } }
    return {
      ok: true,
      state: replay(inspected.events),
      preset: deriveSessionPreset(presetDerivationHost(), { header: inspected.meta, events: inspected.events }),
    }
  }

  /**
   * Resolve a room for a MUTATION: the session must be live to take appends,
   * and dispatch needs its agent live (the delegation facade resolves the
   * parent through `ctx.agents.get` — live agents only). A cold room is
   * cold-resumed through the agent factory, which republishes session +
   * agent under the preset the log records; resumes dedupe per session.
   */
  private ensureLive(sessionId: SessionId): Promise<RoomLoad> {
    const hit = this.load(sessionId)
    if (hit.ok) return (async () => {
      await this.plans.recover(hit.session)
      await this.engine.recover(hit.session)
      this.expireApprovals(hit.session)
      this.expireQuestions(hit.session)
      return this.load(sessionId)
    })()
    if (hit.error.code !== 'session-not-found') return Promise.resolve(hit)
    let pending = this.resumes.get(sessionId)
    if (pending === undefined) {
      pending = this.resumeRoom(sessionId).finally(() => this.resumes.delete(sessionId))
      this.resumes.set(sessionId, pending)
    }
    return pending
  }

  /** One cold resume: refuse non-rooms before paying an agent composition. */
  private async resumeRoom(sessionId: SessionId): Promise<RoomLoad> {
    const cold = await this.loadCold(sessionId)
    if (!cold.ok) return cold
    try {
      const composition = await composeRoomAgent(this.ctx, cold.preset)
      await this.ctx.agents.resume({
        resumeSessionId: sessionId,
        ...composition.setup === undefined ? {} : { setup: composition.setup },
      })
    } catch (error: unknown) {
      return { ok: false, error: { code: 'resume-failed', message: String(error) } }
    }
    const loaded = this.load(sessionId)
    if (loaded.ok) { await this.plans.recover(loaded.session); await this.engine.recover(loaded.session); this.expireApprovals(loaded.session); this.expireQuestions(loaded.session) }
    return this.load(sessionId)
  }

  /**
   * Probe whether a session is a room: replay its event log looking for the
   * `room/created` marker. Side-effect-free: a cold session answers from a
   * persistence inspection, so opening any session never resumes its agent.
   * @param request - session identity.
   * @returns true when the session carries the marker (false for unknown sessions too).
   */
  /** Run ids of the members working in each room (the session list's 运行中). */
  private readonly activeRuns = new Map<string, Set<string>>()
  /** Question/approval cards waiting for the human, per room. */
  private readonly waitingCards = new Map<string, Map<string, { readonly kind: 'question' | 'approval'; readonly member: string }>>()

  /**
   * Follow a room's run and card edges as they are journaled: a room turns
   * running when its first member starts and settles when its last one ends
   * (the host's `api-session/status`, so the list shows 运行中 and then
   * 已完成), and its waiting cards are kept for {@link pendingCards}.
   * @param session - the session the event landed in.
   * @param event - the journaled event.
   */
  private observeActivity(session: Session, event: SessionEvent): void {
    const id = String(session.id)
    switch (event.type) {
      case 'room/run-state': {
        const runs = this.activeRuns.get(id) ?? new Set<string>()
        const before = runs.size
        const key = event.data.runId ?? `${event.data.member}:${event.data.startedAt}`
        if (event.data.state === 'running') runs.add(key)
        else runs.delete(key)
        if (runs.size === 0) this.activeRuns.delete(id)
        else this.activeRuns.set(id, runs)
        // A member whose round ended is no longer waiting on its cards: its
        // bridge call is gone (a CLI's own MCP timeout can end it early, and
        // the round then goes on without the answer). Expire them, so an
        // answer given now reaches the member as a new message.
        if (event.data.state !== 'running') this.expireCardsOf(id, event.data.member)
        if (before === 0 && runs.size > 0) this.emitStatus(id, true)
        // The room's own agent still running keeps the row running.
        else if (before > 0 && runs.size === 0 && this.ctx.agents.get(session.id)?.status !== 'running') this.emitStatus(id, false)
        return
      }
      case 'room/question':
      case 'room/approval': {
        const cards = this.waitingCards.get(id) ?? new Map<string, { readonly kind: 'question' | 'approval'; readonly member: string }>()
        cards.set(event.data.id, { kind: event.type === 'room/question' ? 'question' : 'approval', member: event.data.member })
        this.waitingCards.set(id, cards)
        return
      }
      case 'room/question-resolved':
      case 'room/approval-resolved': {
        const cards = this.waitingCards.get(id)
        cards?.delete(event.data.id)
        if (cards?.size === 0) this.waitingCards.delete(id)
        return
      }
      default:
    }
  }

  /**
   * End the waits behind one member's open cards (its round settled): the
   * question/approval calls resolve as unanswered, which journals them
   * expired — still answerable, by a new message (answerExpiredQuestion).
   * @param roomId - the room session.
   * @param member - the member whose round ended.
   */
  private expireCardsOf(roomId: string, member: string): void {
    for (const [cardId, card] of this.waitingCards.get(roomId) ?? []) {
      if (card.member !== member) continue
      if (card.kind === 'question') this.questionWaiters.get(cardId)?.(undefined)
      else this.approvalWaiters.get(cardId)?.('cancelled')
    }
  }

  /** Broadcast a room's running flip on the host's session-status channel. */
  private emitStatus(sessionId: string, running: boolean): void {
    (this.ctx.emit as unknown as (name: string, ...args: unknown[]) => void)('api-session/status', SessionId(sessionId), running)
  }

  /**
   * The question/approval cards waiting for the human across live rooms —
   * the browser publishes them as the session list's 等你处理 status.
   * @param request - optionally one room only.
   * @returns the waiting cards.
   */
  @Remote('pendingCards')
  async pendingCards(request: RoomPendingCardsRequest): Promise<readonly RoomPendingCard[]> {
    const rooms = request.sessionId === undefined ? [...this.waitingCards.keys()] : [String(request.sessionId)]
    return rooms.flatMap(sessionId => [...this.waitingCards.get(sessionId) ?? []].map(([id, card]) => ({ sessionId, id, kind: card.kind })))
  }

  @Remote('isRoom')
  async isRoom(request: RoomIsRoomRequest): Promise<boolean> {
    const session = this.ctx.sessions.get(request.sessionId)
    if (session !== undefined) return isRoomLog(session.snapshotEvents())
    const inspected = await inspectCold(this.ctx, request.sessionId)
    return inspected !== undefined && isRoomLog(inspected.events)
  }

  /**
   * Resolve a session for a room WRITE, promoting it when it isn't a room
   * yet: a live plain session gains the `room/created` identity marker and
   * the main agent's roster seat (the promotion IS the entry model — the
   * room-session-promotion proposal: any session an agent is invited into
   * becomes a room). Idempotent — an existing room passes through untouched,
   * and concurrent promotions converge on the log (the first `room/created`
   * wins identity). A cold EXISTING room resumes through the normal path;
   * a cold PLAIN session cannot be promoted sight-unseen (promotion writes
   * on the live session, and the surfaces that promote — the open session's
   * invite dialog, the room tools running in their own session — always hold
   * it live), so it answers `not-a-room`. NOT a Remote — the surfaces reach
   * it through the write paths (invite/messageMember); public so tests and a
   * future manual "promote" surface share the one entry.
   * @param sessionId - the session to write.
   * @returns the live session plus replayed state, or the rejection.
   */
  async ensureRoom(sessionId: SessionId): Promise<RoomLoad> {
    const live = this.ctx.sessions.get(sessionId)
    if (live === undefined) {
      const cold = await this.loadCold(sessionId)
      if (!cold.ok) return { ok: false, error: cold.error }
      return this.ensureLive(sessionId)
    }
    if (!isRoomLog(live.snapshotEvents())) {
      live.append('room/created', { version: 1 })
      live.append('room/member-added', { name: MAIN_AGENT_MEMBER, kind: 'main-agent', invitedBy: 'human' })
      await this.ctx.sessions.flush(live)
    }
    return { ok: true, session: live, state: replay(live.snapshotEvents()) }
  }

  /**
   * List the invitable CLI providers: the local-agent roster with each
   * harness's auth state, plus the delegation-facade verdict (absent facade =
   * CLI members undispatchable; the dialog greys the section instead of
   * failing). Harnesses without a delegation provider are record-only and
   * are not invitable.
   * @param _request - no parameters.
   * @returns the provider list and the facade verdict.
   */
  @Remote('listProviders')
  async listProviders(request: RoomListProvidersRequest): Promise<RoomProviderList> {
    const localAgentAvailable = probeLocalAgent(this.ctx) !== undefined
    const listed = await this.listPresets()
    const sessionPreset = request.sessionId === undefined || listed === undefined ? undefined : await this.sessionPreset(request.sessionId)
    const presets = listed === undefined ? {} : { presets: listed, ...sessionPreset === undefined ? {} : { sessionPreset } }
    const roster = probeLocalAgentRoster(this.ctx)
    if (roster === undefined) return { localAgentAvailable, providers: [], ...presets }
    const providers: RoomProviderInfo[] = []
    for (const row of roster.roster()) {
      const status = await roster.statusOf(row.name)
      // A harness without a delegation provider cannot carry a CLI member.
      if (status.delegationProvider === undefined) continue
      providers.push({
        provider: status.delegationProvider,
        displayName: row.displayName,
        // The roster name is the localAgentGateway harnessModel lookup key
        // (the invite dialog's model picker).
        harness: row.name,
        authenticated: status.authenticated,
      })
    }
    return { localAgentAvailable, providers, ...presets }
  }

  /** A session's own mode (preset id), live or cold; undefined when unreadable. */
  private async sessionPreset(sessionId: SessionId): Promise<string | undefined> {
    try {
      const live = this.ctx.sessions.get(sessionId)
      if (live !== undefined) return roomSessionPreset(live)
      const inspected = await inspectCold(this.ctx, sessionId)
      return inspected === undefined ? undefined : deriveSessionPreset(presetDerivationHost(), { header: inspected.meta, events: inspected.events })
    } catch { return undefined }
  }

  /** The host's agent presets for a native member, or undefined without a registry. */
  private async listPresets(): Promise<readonly RoomPresetInfo[] | undefined> {
    const presets = probeAgentPresets(this.ctx)
    if (presets?.list === undefined) return undefined
    try {
      const fallback = (await presets.resolve()).id
      return (await presets.list()).map(row => ({
        id: row.id, isDefault: row.id === fallback,
        ...row.name === undefined ? {} : { name: row.name },
        ...row.description === undefined ? {} : { description: row.description },
        ...row.broken === undefined ? {} : { broken: row.broken },
      }))
    } catch { return undefined }
  }

  /** The composer's task tags, consumed by the human's next message in that room. */
  private readonly taskHints = new Map<string, string>()

  private consumeTaskHint(sessionId: string): string | undefined {
    const hint = this.taskHints.get(sessionId)
    this.taskHints.delete(sessionId)
    return hint
  }

  /**
   * File a new human message under a task: the composer's tag when given
   * (a task root id, or `new`), otherwise — while some task is still open —
   * the decision model's suggestion; with neither it starts a task of its own.
   * A filing other than its own task is journaled as a `room/task-link`.
   * @returns the task root id and, for a model suggestion, the note the coordinator should read.
   */
  private async fileHumanMessage(session: Session, messageId: string, text: string, tag: string | undefined): Promise<{ readonly task: string; readonly note?: string }> {
    const jobs = replay(session.snapshotEvents()).jobs ?? []
    if (tag === 'new') return { task: messageId }
    if (tag !== undefined) {
      const target = jobs.find(job => job.id === tag)
      if (target === undefined) return { task: messageId }
      session.append('room/task-link', { message: messageId, task: target.id, by: 'human' })
      return { task: target.id, note: `【任务归属】这条消息是用户在任务页对「任务 ${target.number}：${target.title}」的追问。` }
    }
    const open = jobs.filter(job => job.status === 'running' || job.status === 'attention')
    const events = session.snapshotEvents()
    const state = replay(events)
    // Nothing to file into, or automatic filing switched off: a task of its own.
    if (open.length === 0 || state.settings?.autoTaskFiling === false) return { task: messageId }
    const suggestion = await suggestTask(this.ctx, text, open.map(job => ({
      number: job.number, title: job.title,
      running: (state.deliveries ?? []).filter(row => job.deliveries.includes(row.id) && (row.status === 'running' || row.status === 'queued'))
        .map(row => state.members.find(member => memberId(events, member) === row.memberId)?.name ?? row.memberId),
    })))
    const target = suggestion.task === 'new' ? undefined : jobs.find(job => job.number === suggestion.task)
    // Every filing that weighed the open tasks is recorded (the timeline row, Context Lens).
    session.append('room/decision', decisionRecord('task-filing', {
      outcome: target === undefined ? 'new' : String(target.number),
      ...suggestion.rule === undefined ? {} : { rule: suggestion.rule },
      ...suggestion.probability === undefined ? {} : { probability: suggestion.probability },
      ...suggestion.call === undefined ? {} : { call: suggestion.call },
      about: { message: messageId, ...target === undefined ? {} : { task: { number: target.number, title: target.title.slice(0, 200) } } },
    }))
    if (target === undefined) return { task: messageId }
    const probability = suggestion.probability ?? 0
    session.append('room/task-link', { message: messageId, task: target.id, by: 'model', probability })
    return { task: target.id, note: `【任务归属】这条消息看起来是在接着做「任务 ${target.number}：${target.title}」（判断置信 ${probability.toFixed(2)}）。如果不对，派活时用 task: "new" 或别的任务编号指明，房间会改过来。` }
  }

  /**
   * Tag the human's next message with a task (the task page's 追问 /
   * 新任务), or clear the tag.
   * @param request - room session and the task root id, `new`, or null.
   * @returns acknowledgement.
   */
  @Remote('setTaskHint')
  async setTaskHint(request: RoomSetTaskHintRequest): Promise<{ readonly ok: true }> {
    if (request.task === null) this.taskHints.delete(request.sessionId)
    else this.taskHints.set(request.sessionId, request.task)
    return { ok: true }
  }

  /**
   * Stop a whole task: running rounds of its deliveries are cancelled (the
   * same cancel the stop button uses), queued and held ones never run, and
   * ordinary rounds whose outcome a restart lost close as cancelled — the
   * human gave up on them — which unblocks those members' later messages.
   * @param request - room session and the task root id.
   * @returns how many deliveries were stopped.
   */
  @Remote('stopJob')
  async stopJob(request: RoomStopJobRequest): Promise<RoomStopJobResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const job = loaded.state.jobs?.find(entry => entry.id === request.task)
    if (job === undefined) return { ok: false, error: { code: 'unknown-task' } }
    let stopped = 0
    for (const row of loaded.state.deliveries ?? []) {
      if (!job.deliveries.includes(row.id)) continue
      if (row.status === 'running') {
        const member = loaded.state.members.find(entry => (entry.id ?? entry.name) === row.memberId)
        if (member !== undefined && (await this.cancel({ sessionId: request.sessionId, name: member.name, expectedRunId: row.id })).ok) stopped++
      } else if (row.status === 'queued' || row.status === 'held') {
        loaded.session.append('room/delivery-state', { id: row.id, dispatchSeq: row.dispatchSeq, memberId: row.memberId, state: 'cancelled', error: '任务已被停止' })
        stopped++
      } else if (row.status === 'uncertain' && row.plan?.taskId === undefined) {
        // Stopping is the human abandoning the round whose outcome a restart
        // lost: that settles it, so the member's later messages run again.
        loaded.session.append('room/delivery-state', { id: row.id, dispatchSeq: row.dispatchSeq, memberId: row.memberId, state: 'cancelled', text: '任务已被停止；这一轮的结果没有核对' })
        const run = loaded.state.runs.find(entry => entry.runId === row.id)
        if (run !== undefined) loaded.session.append('room/run-state', { member: run.member, runId: row.id, startedAt: run.startedAt, state: 'cancelled', ...this.terminalRunStateFields(loaded.session, loaded.state, run.member) })
        stopped++
      }
    }
    loaded.session.append('room/job-stopped', { task: job.id })
    await this.ctx.sessions.flush(loaded.session)
    await this.engine.recover(loaded.session)
    return { ok: true, value: { stopped } }
  }

  /**
   * Route the human's edited message (message-tools replaced the bubble in
   * place) to the room: the original message's dispatch stops — editing is
   * changing one's mind — and the edited text dispatches like a new human
   * message, filed under the original's task, without a second bubble.
   * Idempotent per edit trigger.
   */
  private async routeEdit(session: Session, requestId: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly code: string }> {
    const events = session.snapshotEvents()
    if (events.some(event => event.type === 'room/dispatch' && event.data.id === requestId)) return { ok: true }
    const edit = events.findLast(event => event.type === 'user/message' && editedText(event.data.source))
    if (edit?.type !== 'user/message') return { ok: false, code: 'edit-not-found' }
    const text = textBlocks(edit.data.content)
    if (text === '') return { ok: false, code: 'empty-text' }
    const replaced = (edit as { readonly sourceEventSeqs?: readonly number[] }).sourceEventSeqs ?? []
    const originals = events.filter(event => replaced.includes(event.seq) && isHumanMessage(event))
    const links = taskLinks(events)
    const task = originals.length === 0 ? undefined : linkedTask(links, originals[0]!.type === 'user/message' ? originals[0]!.data.id : '')
    // The original's dispatch: the human dispatch that followed it.
    const state = replay(events)
    for (const original of originals) {
      const next = events.find(event => event.seq > original.seq && (event.type === 'room/dispatch' || isHumanMessage(event)))
      if (next?.type !== 'room/dispatch' || next.data.origin !== 'human') continue
      for (const row of (state.deliveries ?? []).filter(entry => entry.dispatchSeq === next.seq)) {
        const member = state.members.find(entry => memberId(events, entry) === row.memberId)
        if (row.status === 'running' && member !== undefined) await this.cancel({ sessionId: session.id, name: member.name, expectedRunId: row.id })
        else if (row.status === 'queued' || row.status === 'held') session.append('room/delivery-state', { id: row.id, dispatchSeq: row.dispatchSeq, memberId: row.memberId, state: 'cancelled', error: '你编辑了这条消息' })
      }
    }
    const parsed = parseMentions(text)
    const targets = [...parsed.targets]
    const current = replay(session.snapshotEvents())
    if (targets.length === 0) {
      const coordinator = coordinatorMember(current, session.snapshotEvents())
      if (coordinator === undefined) return { ok: false, code: 'member-not-found' }
      targets.push(coordinator.name)
    }
    if (targets.some(target => !current.members.some(member => member.name === target))) return { ok: false, code: 'unknown-targets' }
    const body = parsed.targets.length > 0 ? parsed.text : text
    const filed = await this.fileHumanMessage(session, edit.data.id, text, task)
    const carry = this.moveOnFromLostRounds(session, targets)
    const dispatch = session.append('room/dispatch', {
      id: requestId, targets, text: body, origin: 'human', task: filed.task,
      targetIds: targets.map(name => memberId(session.snapshotEvents(), current.members.find(member => member.name === name)!)),
    })
    await this.ctx.sessions.flush(session)
    for (const target of targets) this.engine.dispatch(session, target, carry(target, body), { dispatchSeq: dispatch.seq })
    return { ok: true }
  }

  /**
   * The human messaging a member moves on from that member's ordinary
   * rounds a restart left uncertain: they close as not finished, so the new
   * message runs instead of queueing behind a reconciliation. Formal-goal
   * attempts keep their explicit reconciliation.
   */
  private moveOnFromLostRounds(session: Session, targets: readonly string[], why = MOVED_ON_TEXT): (member: string, text: string) => string {
    const events = session.snapshotEvents()
    const state = replay(events)
    const members = state.members.filter(member => targets.includes(member.name))
    const ids = new Set(members.map(member => memberId(events, member)))
    const backlog = new Map<string, string[]>()
    for (const row of state.deliveries ?? []) {
      if (row.status !== 'uncertain' || row.plan?.taskId !== undefined || !ids.has(row.memberId)) continue
      session.append('room/delivery-state', { id: row.id, dispatchSeq: row.dispatchSeq, memberId: row.memberId, state: 'cancelled', text: why })
      const run = state.runs.find(entry => entry.runId === row.id)
      if (run !== undefined) session.append('room/run-state', { member: run.member, runId: row.id, startedAt: run.startedAt, state: 'cancelled', ...this.terminalRunStateFields(session, state, run.member) })
      // The messages that queued behind the lost round never ran (the round
      // blocked them, the restart lost the queue): they ride along with this
      // message, one round, instead of replaying stale rounds one by one.
      const name = members.find(member => memberId(events, member) === row.memberId)?.name
      if (name === undefined) continue
      for (const queued of state.deliveries ?? []) {
        if (queued.status !== 'queued' || queued.memberId !== row.memberId || queued.dispatchSeq <= row.dispatchSeq || queued.plan?.taskId !== undefined) continue
        session.append('room/delivery-state', { id: queued.id, dispatchSeq: queued.dispatchSeq, memberId: queued.memberId, state: 'done', text: MERGED_BACKLOG_TEXT })
        const from = queued.from === undefined ? undefined : state.members.find(member => memberId(events, member) === queued.from)?.name
        backlog.set(name, [...backlog.get(name) ?? [], `- ${from === undefined ? '' : `来自 ${from}：`}${queued.text}`])
      }
    }
    return (member, text) => {
      const lines = backlog.get(member)
      return lines === undefined ? text : [text, '', '（你被重启打断期间，房间里还有这些消息排着没送到，一并给你：', ...lines, '）'].join('\n')
    }
  }

  /**
   * Where a member's next send belongs: the task and delivery it is working
   * on (a member inside a room round), or — for the room's own agent answering
   * the human directly — the task of the human message that started its turn
   * (`trigger`, which the coordinator may re-file with `task`).
   */
  private sendContext(session: Session, sender: RoomMember): { readonly task?: string; readonly parent?: string; readonly trigger?: string } {
    const events = session.snapshotEvents()
    const state = replay(events)
    const run = state.runs.find(entry => entry.member === sender.name && entry.state === 'running')
    const row = run?.runId === undefined ? undefined : state.deliveries?.find(entry => entry.id === run.runId)
    if (row !== undefined) return { ...row.task === undefined ? {} : { task: row.task }, parent: row.id }
    if (sender.kind !== 'main-agent') return {}
    const human = events.findLast(isHumanMessage)
    if (human === undefined) return {}
    return { task: linkedTask(taskLinks(events), human.data.id), trigger: human.data.id }
  }

  /** The room and member whose held reports a session's agent should carry. */
  private heldTarget(sessionId: string): { readonly room: Session; readonly member: RoomMember } | undefined {
    const own = this.ctx.sessions.get(SessionId(sessionId))
    if (own !== undefined && isRoomLog(own.snapshotEvents())) {
      const member = replay(own.snapshotEvents()).members.find(entry => entry.kind === 'main-agent')
      return member === undefined ? undefined : { room: own, member }
    }
    const routed = this.nativeRoute(sessionId)
    const room = routed === undefined ? undefined : this.ctx.sessions.get(routed.roomId)
    const member = room === undefined ? undefined : replay(room.snapshotEvents()).members.find(entry => entry.childSessionId === routed!.actor)
    return room === undefined || member === undefined ? undefined : { room, member }
  }

  /**
   * A native member's own session calling a room tool: the tools see the
   * child session, so route to its room with the child as the authenticated
   * actor instead of promoting the child into a room of its own.
   * @param sessionId - the calling agent's session.
   * @returns the room and actor, or undefined when the caller is no native member.
   */
  nativeRoute(sessionId: string): { readonly roomId: SessionId; readonly actor: string } | undefined {
    const parent = this.ctx.sessions.get(SessionId(sessionId))?.header.parentSession
    const room = parent === undefined ? undefined : this.ctx.sessions.get(parent)
    if (room === undefined || parent === undefined) return undefined
    const events = room.snapshotEvents()
    if (!isRoomLog(events)) return undefined
    return replay(events).members.some(member => member.kind === 'native' && member.childSessionId === sessionId)
      ? { roomId: parent, actor: sessionId }
      : undefined
  }

  /**
   * Replay the room's journal into the derived state (roster, notification
   * relays, task board, run states).
   * @param request - room session identity.
   * @returns the replayed state, or a rejection from the closed failure union.
   */
  @Remote('getState')
  async getState(request: RoomGetStateRequest): Promise<RoomGetStateResult> {
    // Side-effect-free: a cold room answers from its durable log (see loadCold).
    const loaded = await this.loadCold(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    // A held report's wake timer lives in the process that held it: after a
    // restart nothing would ever hand it over. A cold room holding one is
    // brought live, whose recovery hands every untimed hold over.
    if (this.ctx.sessions.get(request.sessionId) === undefined && (loaded.state.deliveries ?? []).some(row => row.status === 'held')) {
      void this.ensureLive(request.sessionId).catch((error: unknown) => { this.ctx.logger.warn(`room: reviving held reports failed: ${String(error)}`) })
    }
    return { ok: true, value: { ...this.engine.view(request.sessionId, loaded.state), ...loaded.state.plan === undefined ? {} : { plan: this.plans.view(request.sessionId, loaded.state.plan) } } }
  }

  /**
   * Validate, PROMOTE (a plain session becomes a room — see ensureRoom), and
   * journal an invitation: the name must be parseable by the
   * composer @-grammar and unique, the provider non-blank AND a registered
   * delegation provider (the classic slip is the harness name `kimi` where
   * the family registered `kimi-cli` — validated against the roster's
   * `delegationProvider` set, the same probe listProviders serves; a roster-
   * less core skips the check, degrading to the old accept-anything), and
   * (CLI members are undispatchable without it) the local-agent facade must
   * be probed. A first task is journaled as a `room/dispatch` (auto-opening
   * the member's in_progress task) and handed to the engine immediately —
   * the receipt's `pendingFirstTask` means "dispatched". Shared by the
   * Remote surface (`invitedBy: 'human'`) and the room_invite tool
   * (`invitedBy: 'agent'`).
   * @param request - room session, provider, name, optional cwd, instructions and first task.
   * @param invitedBy - the invitation's origin.
   * @returns the invitation receipt, or a rejection.
   */
  async inviteMember(request: RoomInviteRequest, invitedBy: 'human' | 'agent', actorChildSessionId?: string): Promise<RoomInviteResult> {
    const routed = invitedBy === 'agent' && actorChildSessionId === undefined ? this.nativeRoute(request.sessionId) : undefined
    if (routed !== undefined) return this.inviteMember({ ...request, sessionId: routed.roomId }, invitedBy, routed.actor)
    // Invite PROMOTES: inviting an agent into a plain session makes it a room.
    const loaded = await this.ensureRoom(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (this.handoffs.has(request.sessionId)) return { ok: false, error: { code: 'coordinator-busy' } }
    if (invitedBy === 'agent' && !this.isCurrentCoordinator(loaded.session, actorChildSessionId)) return { ok: false, error: { code: 'not-coordinator' } }
    if (!validName(request.name)) return { ok: false, error: { code: 'invalid-name' } }
    if (loaded.state.members.some(member => member.name === request.name)) {
      return { ok: false, error: { code: 'duplicate-name' } }
    }
    if (request.provider.trim() === '') return { ok: false, error: { code: 'empty-provider' } }
    if (request.instructions !== undefined && request.instructions.trim() === '') {
      return { ok: false, error: { code: 'empty-text' } }
    }
    if (request.firstTask !== undefined && request.firstTask.trim() === '') {
      return { ok: false, error: { code: 'empty-text' } }
    }
    if (request.role !== undefined && request.role.trim().length > ROOM_ROLE_MAX) {
      return { ok: false, error: { code: 'role-too-long' } }
    }
    if (request.model !== undefined && request.model.trim() === '') {
      return { ok: false, error: { code: 'empty-text' } }
    }
    if (request.effort !== undefined && request.effort.trim() === '') {
      return { ok: false, error: { code: 'empty-text' } }
    }
    const native = request.kind === 'native'
    // The coordinator's default: the member works in the room's own mode.
    const inherited = request.preset === undefined && request.inheritPreset === true ? roomSessionPreset(loaded.session) : undefined
    if (inherited !== undefined) request = { ...request, preset: inherited }
    if (request.preset !== undefined) {
      // A native member composes a host preset; a CLI member reaches that
      // preset's plugin tools through its bridge. Reject an id the host does
      // not declare instead of failing at the member's first round.
      const presets = probeAgentPresets(this.ctx)
      if (presets !== undefined) {
        try { await presets.resolve(request.preset) } catch {
          const available = (await presets.list?.())?.map(row => row.id) ?? []
          return { ok: false, error: { code: 'unknown-preset', preset: request.preset, available } }
        }
      }
    }
    if (!native && probeLocalAgent(this.ctx) === undefined) {
      return { ok: false, error: { code: 'local-agent-unavailable' } }
    }
    const roster = native ? undefined : probeLocalAgentRoster(this.ctx)
    if (roster !== undefined) {
      // The same delegationProvider set listProviders serves: invite accepts
      // exactly what dispatch can resolve, and the rejection carries the
      // legal set so a model caller can self-correct (rename and retry).
      const available: string[] = []
      // The names a model reaches for first — the harness name (claude-code)
      // and its display name (Claude Code) — resolve to the provider id.
      const aliases = new Map<string, string>()
      const key = (name: string): string => name.toLowerCase().replace(/[\s_-]+/g, '')
      for (const row of roster.roster()) {
        const status = await roster.statusOf(row.name)
        if (status.delegationProvider === undefined) continue
        available.push(status.delegationProvider)
        for (const alias of [row.name, row.displayName, status.delegationProvider]) aliases.set(key(alias), status.delegationProvider)
      }
      const aliased = aliases.get(key(request.provider))
      if (!available.includes(request.provider) && aliased !== undefined) request = { ...request, provider: aliased }
      if (!available.includes(request.provider)) {
        return { ok: false, error: { code: 'unknown-provider', provider: request.provider, available } }
      }
    }
    if (this.handoffs.has(request.sessionId)) return { ok: false, error: { code: 'coordinator-busy' } }
    if (invitedBy === 'agent' && !this.isCurrentCoordinator(loaded.session, actorChildSessionId)) return { ok: false, error: { code: 'not-coordinator' } }
    if (replay(loaded.session.snapshotEvents()).members.some(member => member.name === request.name)) return { ok: false, error: { code: 'duplicate-name' } }
    loaded.session.append('room/member-added', {
      id: randomUUID(),
      name: request.name,
      kind: native ? 'native' : 'cli',
      provider: native ? 'dsh' : request.provider,
      ...request.preset !== undefined ? { preset: request.preset } : {},
      invitedBy,
      ...request.instructions === undefined ? {} : { instructions: request.instructions },
      ...request.role === undefined || request.role.trim() === '' ? {} : { role: request.role.trim() },
      ...request.cwd === undefined || request.cwd.trim() === '' ? {} : { cwd: request.cwd.trim() },
      ...request.model === undefined || request.model.trim() === '' ? {} : { model: request.model.trim() },
      ...request.effort === undefined || request.effort.trim() === '' ? {} : { effort: request.effort.trim() },
    })
    let firstTaskSeq: number | undefined
    if (request.firstTask !== undefined) {
      // A human's invite starts a task of its own; an agent's belongs to the task it is working on.
      const inviter = invitedBy === 'agent'
        ? replay(loaded.session.snapshotEvents()).members.find(member => actorChildSessionId === undefined ? member.kind === 'main-agent' : member.childSessionId === actorChildSessionId)
        : undefined
      const context: { readonly task?: string; readonly parent?: string } = inviter === undefined ? {} : this.sendContext(loaded.session, inviter)
      const dispatchId = randomUUID()
      const firstTaskContext = { id: dispatchId, task: invitedBy === 'human' ? dispatchId : context.task ?? dispatchId,
        ...context.parent === undefined ? {} : { parent: context.parent } }
      firstTaskSeq = loaded.session.append('room/dispatch', {
        origin: invitedBy === 'human' ? 'human' : 'coordinator',
        ...invitedBy === 'human' ? {} : { replyTo: memberId(loaded.session.snapshotEvents(), coordinatorMember(replay(loaded.session.snapshotEvents()), loaded.session.snapshotEvents())!) },
        ...request.note === undefined || request.note.trim() === '' ? {} : { note: request.note.trim().slice(0, 500) },
        ...firstTaskContext,
        targetIds: [memberId(loaded.session.snapshotEvents(), replay(loaded.session.snapshotEvents()).members.find(member => member.name === request.name)!)],
        targets: [request.name], text: request.firstTask,
      }).seq
    }
    await this.ctx.sessions.flush(loaded.session)
    if (request.firstTask !== undefined && firstTaskSeq !== undefined) {
      this.engine.dispatch(loaded.session, request.name, request.firstTask, { dispatchSeq: firstTaskSeq })
    }
    return { ok: true, value: { name: request.name, pendingFirstTask: request.firstTask !== undefined, ...request.preset === undefined ? {} : { preset: request.preset } } }
  }

  /**
   * Invite a CLI member (the human path; see inviteMember).
   * @param request - room session, provider, name, optional cwd, instructions and first task.
   * @returns the invitation receipt, or a rejection.
   */
  @Remote('invite')
  invite(request: RoomInviteRequest): Promise<RoomInviteResult> {
    return this.inviteMember(request, 'human')
  }

  /**
   * Update a member's editable fields: rename (validated like an invite name —
   * unique, parseable; the main agent is the room itself and cannot be
   * renamed), role instructions (null or a blank text CLEARS them — later
   * dispatches inject none), the member-level cwd override (null or a
   * blank text clears back to inheriting the room cwd; still roster-recorded
   * only — the delegation facade's per-call cwd override is the family's open
   * R2), and the intended model (null or a blank text clears it back to the
   * harness default; roster-recorded intent — the first dispatch binds it as
   * the facade start's `model` option, and the live member's immediate switch
   * is the client's localAgentGateway `setMemberModel` call, not this one).
   * An instructions edit rides the member's next dispatch as a context
   * update (the CLI session itself is never rewritten); a rename migrates
   * every name-keyed projection at replay (the journal fold moves the roster
   * key, tasks' member/blockedBy, relays' from/to, and the runs key).
   * @param request - room session, member name, and the fields to change.
   * @returns the update receipt (the CURRENT name), or a rejection.
   */
  @Remote('updateMember')
  async updateMember(request: RoomUpdateMemberRequest): Promise<RoomUpdateMemberResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (this.handoffs.has(request.sessionId)) return { ok: false, error: { code: 'coordinator-busy' } }
    const member = loaded.state.members.find(entry => entry.name === request.name)
    if (member === undefined) {
      return { ok: false, error: { code: 'member-not-found' } }
    }
    if (request.cwd !== undefined && (member.childSessionId !== undefined || this.engine.hasPending(loaded.session, member.name))) return { ok: false, error: { code: 'member-cwd-bound' } }
    if (request.model !== undefined && member.childSessionId !== undefined) return { ok: false, error: { code: 'configuration-owned-by-core' } }
    if (request.effort !== undefined && member.childSessionId !== undefined) return { ok: false, error: { code: 'configuration-owned-by-core' } }
    if (request.rename === undefined && request.instructions === undefined && request.role === undefined
      && request.cwd === undefined && request.model === undefined && request.effort === undefined) {
      return { ok: false, error: { code: 'nothing-to-update' } }
    }
    if (request.rename !== undefined && request.rename !== request.name) {
      if (member.kind === 'main-agent') return { ok: false, error: { code: 'main-member' } }
      if (!validName(request.rename)) return { ok: false, error: { code: 'invalid-name' } }
      if (loaded.state.members.some(entry => entry.name === request.rename)) {
        return { ok: false, error: { code: 'duplicate-name' } }
      }
    }
    // A blank string is a clear, never a stored value (the wire keeps null
    // and blank distinct, the journal stores one form: null).
    const instructions = typeof request.instructions === 'string' && request.instructions.trim() === ''
      ? null
      : request.instructions
    const role = typeof request.role === 'string'
      ? (request.role.trim() === '' ? null : request.role.trim())
      : request.role
    if (typeof role === 'string' && role.length > ROOM_ROLE_MAX) return { ok: false, error: { code: 'role-too-long' } }
    const cwd = typeof request.cwd === 'string'
      ? (request.cwd.trim() === '' ? null : request.cwd.trim())
      : request.cwd
    const model = typeof request.model === 'string'
      ? (request.model.trim() === '' ? null : request.model.trim())
      : request.model
    const effort = typeof request.effort === 'string'
      ? (request.effort.trim() === '' ? null : request.effort.trim())
      : request.effort
    loaded.session.append('room/member-updated', {
      name: request.name,
      ...request.rename === undefined ? {} : { rename: request.rename },
      ...instructions === undefined ? {} : { instructions },
      ...role === undefined ? {} : { role },
      ...cwd === undefined ? {} : { cwd },
      ...model === undefined ? {} : { model },
      ...effort === undefined ? {} : { effort },
    })
    await this.ctx.sessions.flush(loaded.session)
    return { ok: true, value: { name: request.name } }
  }

  /** Native preparation creates no unrelated conversation turn and leaves the role unchanged. */
  @Remote('prepareMember')
  async prepareMember(request: RoomPrepareMemberRequest): Promise<RoomPrepareMemberResult> {
    if (this.handoffs.has(request.sessionId)) return { ok: false, error: { code: 'coordinator-busy' } }
    this.handoffs.add(request.sessionId)
    try { return await this.prepareMemberInRoom(request) }
    finally { this.handoffs.delete(request.sessionId) }
  }

  private async prepareMemberInRoom(request: RoomPrepareMemberRequest): Promise<RoomPrepareMemberResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const member = loaded.state.members.find(member => member.name === request.name)
    if (member?.kind !== 'cli' || member.provider === undefined) return { ok: false, error: { code: 'member-not-found' } }
    const family = probeLocalAgent(this.ctx)
    if (family?.prepareMember === undefined) return { ok: false, error: { code: 'coordinator-not-ready', message: 'Native preparation is unavailable in this family core' } }
    try {
      const childSessionId = await family.prepareMember(request.sessionId, member.provider, member.childSessionId ?? memberId(loaded.session.snapshotEvents(), member), {
        ...member.cwd === undefined ? {} : { cwd: member.cwd }, ...member.model === undefined ? {} : { model: member.model }, ...member.effort === undefined ? {} : { effort: member.effort },
      })
      loaded.session.append('room/member-updated', { name: member.name, childSessionId: SessionId(childSessionId) })
      await this.ctx.sessions.flush(loaded.session)
      return { ok: true, value: { childSessionId } }
    } catch (error) { return { ok: false, error: { code: 'coordinator-not-ready', message: String(error) } } }
  }

  /** A human records the known result before releasing a crashed member's queued work. */
  @Remote('reconcileDelivery')
  async reconcileDelivery(request: RoomReconcileDeliveryRequest): Promise<RoomReconcileDeliveryResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const delivery = loaded.state.deliveries?.find(row => row.id === request.deliveryId)
    if (delivery?.status !== 'uncertain') return { ok: false, error: { code: 'delivery-not-uncertain' } }
    if (delivery.plan?.taskId !== undefined) return { ok: false, error: { code: 'plan-reconciliation-required' } }
    if (request.evidence.trim() === '') return { ok: false, error: { code: 'empty-text' } }
    loaded.session.append('room/delivery-state', { id: delivery.id, dispatchSeq: delivery.dispatchSeq, memberId: delivery.memberId, state: request.outcome, text: request.evidence.trim() })
    const run = loaded.state.runs.find(run => run.runId === delivery.id)
    if (run !== undefined) loaded.session.append('room/run-state', { member: run.member, runId: delivery.id, startedAt: run.startedAt, state: request.outcome, ...this.terminalRunStateFields(loaded.session, loaded.state, run.member) })
    await this.ctx.sessions.flush(loaded.session)
    await this.engine.recover(loaded.session)
    return { ok: true }
  }

  /** Explicit human role change; state is committed only after readiness and idle checks. */
  @Remote('setCoordinator')
  async setCoordinator(request: RoomSetCoordinatorRequest): Promise<RoomSetCoordinatorResult> {
    if (this.handoffs.has(request.sessionId)) return { ok: false, error: { code: 'coordinator-busy' } }
    this.handoffs.add(request.sessionId)
    try {
      const loaded = await this.ensureLive(request.sessionId)
      if (!loaded.ok) return { ok: false, error: loaded.error }
      const events = loaded.session.snapshotEvents()
      let candidate = loaded.state.members.find(member => memberId(events, member) === request.memberId)
      const previous = coordinatorMember(loaded.state, events)
      if (candidate === undefined || previous === undefined) return { ok: false, error: { code: 'member-not-found' } }
      // A native member answers inside this host already; making it the
      // external coordinator would need the CLI coordination contract it does not speak.
      if (candidate.kind === 'native') return { ok: false, error: { code: 'coordinator-not-ready', message: 'A native DSH member cannot coordinate yet; promote the room\'s own dsh or a CLI member' } }
      if ((loaded.state.coordinator?.revision ?? 0) !== request.expectedRevision) return { ok: false, error: { code: 'coordinator-conflict' } }
      const agent = this.ctx.agents.get(request.sessionId)
      if (agent?.status === 'running' || (agent?.inbox?.nextTurn.length ?? 0) > 0 || (agent?.inbox?.nextStep.length ?? 0) > 0 || this.engine.hasPending(loaded.session, previous.name) || this.engine.hasPending(loaded.session, candidate.name)) {
        return { ok: false, error: { code: 'coordinator-busy' } }
      }
      if (candidate.kind === 'cli' && candidate.childSessionId === undefined) {
        const prepared = await this.prepareMemberInRoom({ sessionId: request.sessionId, name: candidate.name })
        if (!prepared.ok) return { ok: false, error: prepared.error }
        candidate = { ...candidate, childSessionId: SessionId(prepared.value.childSessionId) }
      }
      const refreshedEvents = loaded.session.snapshotEvents()
      const refreshed = replay(refreshedEvents)
      candidate = refreshed.members.find(member => memberId(refreshedEvents, member) === request.memberId)
      if (candidate === undefined) return { ok: false, error: { code: 'member-not-found' } }
      if ((refreshed.coordinator?.revision ?? 0) !== request.expectedRevision) return { ok: false, error: { code: 'coordinator-conflict' } }
      const refreshedAgent = this.ctx.agents.get(request.sessionId)
      if (refreshedAgent?.status === 'running' || (refreshedAgent?.inbox?.nextTurn.length ?? 0) > 0 || (refreshedAgent?.inbox?.nextStep.length ?? 0) > 0 || this.engine.hasPending(loaded.session, previous.name) || this.engine.hasPending(loaded.session, candidate.name)) return { ok: false, error: { code: 'coordinator-busy' } }
      if (candidate.kind === 'cli') {
        const family = this.ctx.get('localAgent') as { canCoordinateRoom?: (id: string) => boolean } | undefined
        if (candidate.childSessionId === undefined || family?.canCoordinateRoom?.(candidate.childSessionId) !== true) return { ok: false, error: { code: 'coordinator-not-ready', message: 'The member coordination tool channel is unavailable' } }
      }
      for (const participant of [previous, candidate]) {
        if (participant.kind !== 'cli') continue
        const family = this.ctx.get('localAgent') as { isPreparedMember?: (id: string) => boolean; queuedMemberRounds?: (id: string) => number; readMemberInbox?: (id: string) => { paused: boolean; messages: readonly { status: string }[] }; memberConfiguration?: (id: string) => { status: string; round?: unknown; pending?: unknown; lockedReason?: string } } | undefined
        if (participant.childSessionId === undefined || family?.memberConfiguration === undefined) {
          return { ok: false, error: { code: 'coordinator-not-ready', message: 'Member native session preparation is required before promotion' } }
        }
        const inbox = family.isPreparedMember?.(participant.childSessionId) === true ? undefined : family.readMemberInbox?.(participant.childSessionId)
        if ((family.queuedMemberRounds?.(participant.childSessionId) ?? 0) > 0 || inbox?.messages.some(row => ['queued', 'running', 'uncertain'].includes(row.status))) return { ok: false, error: { code: 'coordinator-busy' } }
        const control = family.memberConfiguration(participant.childSessionId)
        if (control.status !== 'idle' || control.round !== undefined || control.pending !== undefined || control.lockedReason !== undefined) {
          return { ok: false, error: { code: 'coordinator-not-ready', message: 'Member configuration has not converged or is locked' } }
        }
      }
      const handoff = handoffText(events, loaded.state, request.sessionId, previous.name, candidate.name)
      const value = { version: 1 as const, memberId: request.memberId, previousMemberId: memberId(events, previous), revision: request.expectedRevision + 1, handoff }
      loaded.session.append('room/coordinator', value)
      await this.ctx.sessions.flush(loaded.session)
      return { ok: true, value }
    } catch (error) {
      return { ok: false, error: { code: 'coordinator-not-ready', message: String(error) } }
    } finally { this.handoffs.delete(request.sessionId) }
  }

  /**
   * Remove a member and settle everything that depended on it, so the
   * confirmation's promises hold: a running round is stopped first (the same
   * cancel the stop button uses), queued messages to it are cancelled, every
   * member waiting for one of its reports is told it will not come, and only
   * then does it leave the roster. Its own session and history stay;
   * {@link restoreMember} brings it back onto them.
   * @param request - room session, member name.
   * @returns what the removal did, or a rejection.
   */
  @Remote('removeMember')
  async removeMember(request: RoomRemoveMemberRequest): Promise<RoomRemoveMemberResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (this.handoffs.has(request.sessionId)) return { ok: false, error: { code: 'coordinator-busy' } }
    const member = loaded.state.members.find(entry => entry.name === request.name)
    if (member === undefined) return { ok: false, error: { code: 'member-not-found' } }
    if (coordinatorMember(loaded.state, loaded.session.snapshotEvents())?.name === request.name) return { ok: false, error: { code: 'active-coordinator' } }
    if (member.kind === 'main-agent') return { ok: false, error: { code: 'main-member' } }
    const stopped = loaded.state.runs.some(run => run.member === request.name && run.state === 'running')
      && (await this.cancel({ sessionId: request.sessionId, name: request.name })).ok
    const session = loaded.session
    const events = session.snapshotEvents()
    const id = memberId(events, member)
    const queued = replay(events).deliveries?.filter(row => row.memberId === id && row.status === 'queued') ?? []
    for (const row of queued) {
      session.append('room/delivery-state', { id: row.id, dispatchSeq: row.dispatchSeq, memberId: id, state: 'cancelled', error: `${request.name} 已被移除` })
    }
    session.append('room/member-removed', { name: request.name })
    await this.ctx.sessions.flush(session)
    // Tell whoever waits on a cancelled delivery, now that the roster no
    // longer holds the member (the report reads its last known name).
    const before = session.snapshotEvents().filter(event => event.type === 'room/dispatch').length
    for (const row of queued) {
      await this.engine.reportOutcome(session, row.dispatchSeq, row.id, id, 'cancelled', `${request.name} 已被移除，这条没有执行。`)
    }
    const reports = session.snapshotEvents().filter(event => event.type === 'room/dispatch').slice(before)
    const notified = [...new Set(reports.flatMap(event => event.type === 'room/dispatch' ? event.data.targets : []))]
    return { ok: true, value: { name: request.name, stopped, cancelledDeliveries: queued.length, notified } }
  }

  /**
   * Undo a removal: the member rejoins under its old identity, provider,
   * role, instructions and native session, so its memory carries on. Work
   * the removal cancelled stays cancelled. Rejected when the name was taken
   * in between or the member was never removed.
   * @param request - room session, the removed member's name.
   * @returns the restored name, or a rejection.
   */
  @Remote('restoreMember')
  async restoreMember(request: RoomRestoreMemberRequest): Promise<RoomRestoreMemberResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (loaded.state.members.some(entry => entry.name === request.name)) return { ok: false, error: { code: 'duplicate-name' } }
    const events = loaded.session.snapshotEvents()
    const removal = events.findLast(event => event.type === 'room/member-removed' && event.data.name === request.name)
    if (removal === undefined) return { ok: false, error: { code: 'member-not-found' } }
    const member = replay(events.filter(event => event.seq < removal.seq)).members.find(entry => entry.name === request.name)
    if (member === undefined) return { ok: false, error: { code: 'member-not-found' } }
    loaded.session.append('room/member-added', {
      id: memberId(events, member),
      name: member.name,
      kind: member.kind,
      invitedBy: member.invitedBy,
      ...member.provider === undefined ? {} : { provider: member.provider },
      ...member.instructions === undefined ? {} : { instructions: member.instructions },
      ...member.role === undefined ? {} : { role: member.role },
      ...member.preset === undefined ? {} : { preset: member.preset },
      ...member.cwd === undefined ? {} : { cwd: member.cwd },
      ...member.model === undefined ? {} : { model: member.model },
      ...member.effort === undefined ? {} : { effort: member.effort },
      ...member.childSessionId === undefined ? {} : { childSessionId: member.childSessionId },
    })
    await this.ctx.sessions.flush(loaded.session)
    return { ok: true, value: { name: member.name } }
  }

  /**
   * Post a human @-message into the room: leading `@name` tokens address
   * members, and so does the request's `targets` list (the composer's
   * mention-menu picks — explicit addressing wherever the `@name` sits); the
   * two union before the roster check (a `room/dispatch` journal record,
   * executed by the engine, and one auto-opened in_progress task per target).
   * The human's raw text is
   * FIRST appended as a standard `user/message` (source kind 'user' — the
   * human typed it; the official messageDefinition classifies any other kind
   * as a collapsed context-injection row, not the user bubble), so the words
   * render as the official user bubble and enter the main agent's
   * model-visible history. The append wakes nothing: turns start from
   * prompt/followup calls, never from log appends (the agent is the log's
   * writer, not a watcher). The `room/dispatch` record stays as pure
   * bookkeeping (task board, dispatch cursors, replay) — it no longer drives
   * any chat node. A BARE message is a structured `no-targets` rejection —
   * defense only: the room composer releases bare messages to the official
   * submit path (a normal main-agent turn) and never calls this Remote
   * without addressing.
   * @param request - room session, raw composer text, and the menu-picked addressees.
   * @returns the parse receipt, or a rejection.
   */
  @Remote('postMessage')
  async postMessage(request: RoomPostMessageRequest): Promise<RoomPostMessageResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const attached = request.attachments ?? []
    if (request.text.trim() === '' && attached.length === 0) return { ok: false, error: { code: 'empty-text' } }
    const requestSignature = createHash('sha256').update(JSON.stringify({
      text: request.text.trim(), targets: [...new Set(request.targets ?? [])].sort(),
      ...attached.length === 0 ? {} : { attachments: attached.map(entry => entry.type === 'file' ? entry.receiptId : `${entry.mediaType}:${entry.data.length}`) },
    })).digest('hex')
    if (request.requestId !== undefined) {
      if (request.requestId.trim() === '' || request.requestId.length > 128) return { ok: false, error: { code: 'request-conflict' } }
      const previous = loaded.session.snapshotEvents().find(event => event.type === 'room/dispatch' && event.data.id === request.requestId)
      if (previous?.type === 'room/dispatch') {
        const original = previous.data
        const parsedRetry = parseMentions(request.text)
        const retryTargets = [...new Set([...parsedRetry.targets, ...request.targets ?? []])].sort()
        const legacyMatch = original.origin === 'human' && original.text === (parsedRetry.targets.length > 0 ? parsedRetry.text : request.text.trim())
          && (retryTargets.length === 0 || JSON.stringify(retryTargets) === JSON.stringify([...original.targets].sort()))
        if (original.requestSignature === undefined ? !legacyMatch : original.requestSignature !== requestSignature) return { ok: false, error: { code: 'request-conflict' } }
        // An earlier flush may have failed after append; acceptance retries storage before acknowledging.
        await this.ctx.sessions.flush(loaded.session)
        for (const target of original.targetIds ?? []) {
          const member = replay(loaded.session.snapshotEvents()).members.find(member => memberId(loaded.session.snapshotEvents(), member) === target)
          if (member !== undefined) this.engine.dispatch(loaded.session, member.name, withAttachmentPaths(original.text, original.attachments), { dispatchSeq: previous.seq, targetId: target })
        }
        return { ok: true, value: { parsed: { targets: original.targets, text: original.text }, seq: previous.seq } }
      }
    }

    const parsed = parseMentions(request.text)
    // Menu-picked addressees union with the parsed leading tokens: a menu
    // pick is explicit addressing wherever the `@name` sits in the sentence.
    const targets = [...new Set([...parsed.targets, ...request.targets ?? []])]
    if (this.handoffs.has(request.sessionId)) return { ok: false, error: { code: 'coordinator-busy' } }
    if (targets.length === 0) {
      const selected = coordinatorMember(loaded.state, loaded.session.snapshotEvents())
      if (selected === undefined) return { ok: false, error: { code: 'member-not-found' } }
      targets.push(selected.name)
    }
    // Leading tokens are stripped from the dispatched text; a picked mid-
    // sentence mention stays — the sentence is dispatched verbatim.
    const said = parsed.targets.length > 0 ? parsed.text : request.text.trim()
    // The human pointing at a session outside the room is a help request: say
    // so every time (a member's briefing reaches it once, on its first round).
    const outside = [...said.matchAll(/@\[((?:\\.|[^\\\]\n])+)\]\((dsh-session:[^)\s]+)\)/gu)]
    // An attachment-only message still dispatches: its words are the attachments.
    const text = said === '' && attached.length > 0 ? '（见附件）' : said
    // The hint rides the member's prompt only; the journal keeps the human's words.
    const prompt = outside.length === 0 ? text : [
      said,
      '',
      `（人点名了房间外的会话：${outside.map(match => `「${match[1]!.replace(/\\(.)/gu, '$1')}」`).join('、')}。用 room_help 去问：session 参数原样传那个 @[…](dsh-session:…) 引用；标签是「成员（房间）」时会交给那个成员。不要转给别的成员代问。）`,
    ].join('\n')
    if (text === '') return { ok: false, error: { code: 'empty-text' } }
    const roster = new Set(loaded.state.members.map(member => member.name))
    const unknown = targets.filter(target => !roster.has(target))
    if (unknown.length > 0) return { ok: false, error: { code: 'unknown-targets', names: unknown } }
    const admitted = await this.admitAttachments(request.sessionId, attached)
    if (!admitted.ok) return { ok: false, error: admitted.error }
    const human = createUserMessage({
      content: [...admitted.blocks, ...request.text.trim() === '' ? [] : [{ type: 'text' as const, text: request.text.trim() }]] as Parameters<typeof createUserMessage>[0]['content'],
      source: { kind: 'user' },
    })
    {
      // Uploaded files are bound to this message once it is in the log (an unbound receipt is reclaimed).
      using binding = admitted.bind(request.requestId ?? String(human.id))
      loaded.session.append('user/message', human, { surfaceOp: 'append' })
      binding?.commit()
    }
    floatRunningCards(loaded.session)
    const filed = await this.fileHumanMessage(loaded.session, human.id, request.text.trim(), request.task ?? this.consumeTaskHint(request.sessionId))
    const carry = this.moveOnFromLostRounds(loaded.session, targets)
    const dispatch = loaded.session.append('room/dispatch', {
      id: request.requestId ?? randomUUID(), requestSignature, targets, text, origin: 'human', task: filed.task,
      ...admitted.records.length === 0 ? {} : { attachments: admitted.records },
      targetIds: targets.map(name => memberId(loaded.session.snapshotEvents(), loaded.state.members.find(member => member.name === name)!)),
    })
    await this.ctx.sessions.flush(loaded.session)
    for (const target of targets) {
      this.engine.dispatch(loaded.session, target, carry(target, withAttachmentPaths(prompt, admitted.records)), { dispatchSeq: dispatch.seq })
    }
    return { ok: true, value: { parsed: { targets, text }, seq: dispatch.seq } }
  }

  /**
   * Admit a human message's composer attachments the way the host's own
   * prompt path does: file receipts resolve against this room session's
   * uploads, images are stored, and every attachment becomes a durable
   * content block for the message — plus the local path members read it by.
   * @param sessionId - the room session (its agent owns the uploads).
   * @param inputs - the wire attachments.
   * @returns the content blocks, the dispatch records, and the receipt binder; or a refusal.
   */
  private async admitAttachments(sessionId: SessionId, inputs: readonly RoomAttachmentInput[]): Promise<
    | { readonly ok: true; readonly blocks: readonly unknown[]; readonly records: readonly RoomDispatchAttachment[]; readonly bind: (requestId: string) => { commit(): void; [Symbol.dispose](): void } | undefined }
    | { readonly ok: false; readonly error: { readonly code: 'attachment-invalid'; readonly message: string } }
  > {
    if (inputs.length === 0) return { ok: true, blocks: [], records: [], bind: () => undefined }
    const probe = this.ctx.get as (name: string) => unknown
    const services: AttachmentServices = {
      attachments: probe('attachments') as AttachmentServices['attachments'],
      fileUploads: probe('fileUploads') as AttachmentServices['fileUploads'],
    }
    const store = services.attachments
    // The uploads are staged on the room session's agent; a cold room wakes it.
    let agent: Agent | undefined = this.ctx.agents.get(sessionId)
    if (agent === undefined) {
      const controller = (this.ctx.get as (name: string) => unknown)('sessionController') as { resolveAgent?(id: SessionId): Promise<{ readonly agent: Agent } | { readonly error: unknown }> } | undefined
      const resolved = await controller?.resolveAgent?.(sessionId).catch(() => undefined)
      if (resolved !== undefined && 'agent' in resolved) agent = resolved.agent
    }
    if (store === undefined || agent === undefined) return { ok: false, error: { code: 'attachment-invalid', message: 'attachments are unavailable on this host' } }
    const receipts: string[] = []
    const parts: unknown[] = []
    for (const input of inputs) {
      if (input.type === 'image') {
        parts.push({ type: 'image', data: input.data, mediaType: input.mediaType, ...input.name === undefined ? {} : { name: input.name } })
        continue
      }
      const ref = services.fileUploads?.resolve(agent, input.receiptId)
      if (ref === undefined) return { ok: false, error: { code: 'attachment-invalid', message: 'a file was not uploaded to this room' } }
      receipts.push(input.receiptId)
      parts.push({ type: 'file', attachment: ref })
    }
    let blocks: readonly { readonly type: string; readonly attachment?: { readonly name?: string } }[]
    try {
      blocks = await store.admitPromptContent(parts)
    } catch (error) {
      return { ok: false, error: { code: 'attachment-invalid', message: error instanceof Error ? error.message : String(error) } }
    }
    const records = blocks.flatMap((block): RoomDispatchAttachment[] => {
      if (block.type !== 'image' && block.type !== 'file') return []
      const path = block.type === 'image' ? store.imageHostPath?.(block.attachment) : store.fileHostPath?.(block.attachment)
      return [{ kind: block.type, ...block.attachment?.name === undefined ? {} : { name: block.attachment.name }, ...path === undefined ? {} : { path } }]
    })
    const uploads = services.fileUploads
    return {
      ok: true, blocks, records,
      bind: requestId => receipts.length === 0 || uploads === undefined ? undefined : uploads.bindPrompt(agent, receipts, requestId),
    }
  }

  /**
   * Send one message from a member to another (host-only — the `room_message`
   * tool and the bridge's `member_message`/`room_message` land here; the
   * human's path is postMessage). Any member may message any other: the
   * coordinator's sends journal as `coordinator` dispatches, everyone else's
   * as `member` ones. A `task` (default) has the recipient's final reply
   * reported back to the sender; a `notify` is FYI. The room's settings may
   * hold the message for the human instead (see messaging.ts).
   * @param request - room session, addressee, text, kind, optional reply reference.
   * @param actorChildSessionId - the authenticated CLI sender; absent = the room's own agent.
   * @returns the delivery receipt (with its `m<seq>` id) or the hold, or a rejection.
   */
  async messageMember(request: RoomMessageRequest, actorChildSessionId?: string): Promise<RoomMessageResult> {
    const routed = actorChildSessionId === undefined ? this.nativeRoute(request.sessionId) : undefined
    if (routed !== undefined) return this.messageMember({ ...request, sessionId: routed.roomId }, routed.actor)
    // Messaging PROMOTES too (the room_message tool's gate): the main agent
    // answering "把 kimi 拉进来问一下…" promotes its own session, then the
    // roster check runs against the promoted state.
    const loaded = await this.ensureRoom(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (this.handoffs.has(request.sessionId)) return { ok: false, error: { code: 'coordinator-busy' } }
    const events = loaded.session.snapshotEvents()
    const sender = loaded.state.members.find(member => actorChildSessionId === undefined ? member.kind === 'main-agent' : member.childSessionId === actorChildSessionId)
    if (sender === undefined) return { ok: false, error: { code: 'member-not-found' } }
    const target = loaded.state.members.find(member => member.name === request.member || (member.childSessionId !== undefined && member.childSessionId === request.member))
    if (target === undefined) return { ok: false, error: { code: 'member-not-found' } }
    const text = request.text.trim()
    if (text === '') return { ok: false, error: { code: 'empty-text' } }
    if (target.name === sender.name) return { ok: false, error: { code: 'self-message' } }
    const senderId = memberId(events, sender)
    const kind = request.kind ?? 'task'
    const inReplyTo = parseMessageRef(request.inReplyTo)
    const context = this.sendContext(loaded.session, sender)
    let task = context.task
    if (request.task !== undefined && request.task.trim() !== '') {
      const ref = resolveTaskRef(loaded.state.jobs ?? [], request.task)
      if (ref === undefined) return { ok: false, error: { code: 'unknown-task' } }
      // The coordinator's call re-files the human message its turn answers.
      if (context.trigger !== undefined) {
        task = ref === 'new' ? context.trigger : ref
        loaded.session.append('room/task-link', { message: context.trigger, task, by: 'coordinator' })
      } else {
        task = ref === 'new' ? SELF_TASK : ref
      }
    }
    const sent = sendOrHold(loaded.session, {
      to: target, text, fromName: sender.name,
      intent: {
        origin: this.isCurrentCoordinator(loaded.session, actorChildSessionId) ? 'coordinator' : 'member',
        from: senderId, kind, hop: workingHop(events, loaded.state, sender) + 1,
        ...kind === 'task' ? { replyTo: senderId } : {},
        ...inReplyTo === undefined ? {} : { inReplyTo },
        ...request.note === undefined || request.note.trim() === '' ? {} : { note: request.note.trim().slice(0, 500) },
        ...task === undefined ? {} : { task },
        ...context.parent === undefined ? {} : { parent: context.parent },
      },
    })
    await this.ctx.sessions.flush(loaded.session)
    if (!sent.delivered) return { ok: true, value: { member: target.name, held: sent.reason } }
    this.engine.dispatch(loaded.session, target.name, text, { dispatchSeq: sent.seq })
    return { ok: true, value: { member: target.name, messageId: messageId(sent.seq) } }
  }

  /** Host-authenticated actor; model tool arguments never provide the room or sender. */
  private isCurrentCoordinator(session: Session, actorChildSessionId?: string): boolean {
    const events = session.snapshotEvents()
    const coordinator = coordinatorMember(replay(events), events)
    return actorChildSessionId === undefined ? coordinator?.kind === 'main-agent' : coordinator?.childSessionId === actorChildSessionId
  }

  // ── Cross-session help (help.ts) ──────────────────────────────────────────

  private readonly equipped = new WeakSet<object>()

  /** Register the helper tools on one helper agent (agent-local: they unwind with it). */
  private equipHelper(agent: Agent): void {
    if (this.equipped.has(agent)) return
    const tools = (agent.ctx.get as (name: string) => unknown)('tools') as { register(def: object): () => void } | undefined
    if (tools === undefined) return
    this.equipped.add(agent)
    for (const def of helperTools(this)) {
      try {
        tools.register(def)
      } catch (error) {
        this.ctx.logger.warn(`room: helper tool on "${agent.session.id}" was refused: ${String(error)}`)
      }
    }
  }

  /** A room's display title (its latest `session/title`), else its id. */
  private roomTitle(session: Session): string {
    const titled = session.snapshotEvents().findLast(event => (event.type as string) === 'session/title') as { data?: { title?: unknown } } | undefined
    return typeof titled?.data?.title === 'string' && titled.data.title !== '' ? titled.data.title : String(session.id)
  }

  /**
   * Resolve the session a member names: an `@[…](dsh-session:…)` mention, a
   * session id, or a title (through the host's session-reference discovery).
   */
  private async resolveHelpTarget(caller: Agent, name: string): Promise<{ readonly sessionId: string; readonly title: string } | { readonly error: string }> {
    const resolver = (this.ctx.get as (name: string) => unknown)('sessionReferenceResolver') as {
      listCandidates?(agent: Agent, query?: string, limit?: number): Promise<readonly { sessionId: string; label: string; displayTitle?: string }[]>
    } | undefined
    if (resolver?.listCandidates === undefined) return { error: 'This host cannot look sessions up; room_help is unavailable.' }
    const mentioned = mentionedSessions(name)[0]
    const query = (mentioned ?? name.replace(/^@/u, '')).trim()
    let candidates = await resolver.listCandidates(caller, query, 8)
    // 「成员（房间）」 typed as text: look the room up by its own title.
    const inRoom = mentioned === undefined ? /^(.+)（(.+)）$/u.exec(query) : null
    if (candidates.length === 0 && inRoom !== null) candidates = await resolver.listCandidates(caller, inRoom[2]!, 8)
    const titleOf = (entry: { label: string; displayTitle?: string }): string => entry.displayTitle ?? entry.label
    const exact = candidates.find(entry => entry.sessionId === query) ?? candidates.find(entry => titleOf(entry) === query)
      ?? (inRoom === null ? undefined : candidates.find(entry => titleOf(entry) === inRoom[2]))
    const picked = exact ?? (candidates.length === 1 ? candidates[0] : undefined)
    if (picked !== undefined) return { sessionId: picked.sessionId, title: titleOf(picked) }
    if (candidates.length === 0) return { error: `No session matches "${name}". Ask the human to @ the session in the room.` }
    return { error: `"${name}" matches several sessions: ${candidates.map(entry => `"${titleOf(entry)}" (${entry.sessionId})`).join(', ')}. Retry with the exact title or id.` }
  }

  /**
   * A member asks another session for help, or writes again on a thread
   * (the `room_help` tool). The first ask of a session the human never
   * @-mentioned in this room waits for the human's go-ahead.
   * @param request - the calling session, the target session (new thread) or help id (existing), the text.
   * @param caller - the calling agent.
   * @returns the tool's text result.
   */
  async askHelp(request: { readonly sessionId: string; readonly session?: string; readonly member?: string; readonly help?: string; readonly text: string }, caller: Agent | undefined, actorChildSessionId?: string): Promise<string> {
    const text = request.text.trim()
    if (text === '') return 'The help text must be non-blank.'
    // The asker: a CLI member (authenticated by the bridge), a native member
    // (its own session routes to the room), else the room's own agent.
    const routed = actorChildSessionId === undefined ? this.nativeRoute(request.sessionId) : { roomId: SessionId(request.sessionId), actor: actorChildSessionId }
    const roomId = routed?.roomId ?? SessionId(request.sessionId)
    const loaded = this.ctx.sessions.get(roomId) !== undefined && isRoomLog(this.ctx.sessions.get(roomId)!.snapshotEvents())
      ? await this.ensureLive(roomId)
      : undefined
    if (loaded === undefined || !loaded.ok) return 'room_help works from inside a room; this session is not one.'
    const room = loaded.session
    const events = room.snapshotEvents()
    const asker = loaded.state.members.find(member => routed === undefined ? member.kind === 'main-agent' : member.childSessionId === routed.actor)
    if (asker === undefined) return 'Only a member of this room can ask for help.'
    const roomTitle = this.roomTitle(room)
    const helps = replayHelps(events)

    const threadId = request.help?.trim()
    if (threadId !== undefined && threadId !== '') {
      const help = helps.find(entry => entry.id === threadId)
      if (help === undefined) return `No help thread "${threadId}" in this room.`
      room.append('room/help-message', { help: help.id, kind: 'message', text })
      await this.ctx.sessions.flush(room)
      if (help.target.room === true) return this.deliverToRoom(room, help, text, 'message')
      return this.deliverHelp(room, help, messagePrompt(help, roomTitle, text), 'message', text)
    }

    if (request.session === undefined || request.session.trim() === '') return 'Name the session to ask: its title, its id, or the @ mention the human wrote.'
    // Discovery ranks by the asking agent's workspace; a CLI member has no
    // agent here, so the room's own stands in.
    const finder = caller ?? this.ctx.agents.get(room.id)
    if (finder === undefined) return 'This room has no live agent to look sessions up with; try again in a moment.'
    const target = await this.resolveHelpTarget(finder, request.session.trim())
    if ('error' in target) return target.error
    if (target.sessionId === room.id || loaded.state.members.some(member => member.childSessionId === target.sessionId)) {
      return 'That session is this room or one of its members; use room_message instead.'
    }
    // The host fences archived sessions off (they are not listed, cannot be
    // opened, and a waking delivery to their agent is refused): say so.
    const archived = (this.ctx.get as (name: string) => unknown)('workspaceRegistry') as { archivedSessionIds?: readonly string[] } | undefined
    if (archived?.archivedSessionIds?.includes(target.sessionId) === true) {
      return `"${target.title}" is archived; it cannot be asked. Tell the human to unarchive it first, or pick another session.`
    }
    // A room target goes through that room's own roster: the named member
    // (the argument, or the 「成员（房间）」 label the @ menu wrote), else its coordinator.
    const targetRoom = (await this.isRoom({ sessionId: SessionId(target.sessionId) })) === true
    const named = request.member?.trim() || (targetRoom ? memberFromLabel(request.session, target.title) : undefined)
    if (targetRoom) {
      const other = await this.ensureLive(SessionId(target.sessionId))
      if (!other.ok) return `Could not open the room "${target.title}".`
      if (named !== undefined && !other.state.members.some(member => member.name === named)) {
        return `The room "${target.title}" has no member "${named}"; its members are ${other.state.members.map(member => member.name).join(', ')}.`
      }
    }
    const consented = referencedSessions(events).has(target.sessionId) || helps.some(entry => entry.target.sessionId === target.sessionId)
    if (!consented) {
      const answers = await this.askQuestions(room, asker, [{
        id: 'help', header: '求助',
        question: `${asker.name} 想向会话「${target.title}」求助：${text.length > 80 ? `${text.slice(0, 80)}…` : text}`,
        options: [{ label: '允许' }, { label: '不允许' }],
      }], 10 * 60_000, true)
      if (answers?.[0]?.selected[0] !== '允许') return `The human did not allow asking "${target.title}". Do not retry unless they @ that session in the room.`
    }
    const help = {
      id: randomUUID().slice(0, 8), from: memberId(events, asker), fromName: asker.name,
      target: targetRoom ? { ...target, room: true as const, ...named === undefined ? {} : { member: named } } : target, text,
    }
    room.append('room/help', help)
    await this.ctx.sessions.flush(room)
    if (targetRoom) return this.deliverToRoom(room, help, text, 'request')
    return this.deliverHelp(room, help, requestPrompt(help, roomTitle), 'request', text)
  }

  /**
   * Hand a help request (or a follow-up on it) to another room: its named
   * member, else its coordinator, as a `help`-origin dispatch — held like any
   * agent message while that room is paused — and shown on that room's
   * timeline. The member's final reply comes back through {@link helpSettled}.
   */
  private async deliverToRoom(room: Session, help: { readonly id: string; readonly fromName: string; readonly target: { readonly sessionId: string; readonly title: string; readonly member?: string } }, text: string, op: 'request' | 'message'): Promise<string> {
    const fail = async (error: string): Promise<string> => {
      room.append('room/help-state', { help: help.id, state: 'failed', error })
      await this.ctx.sessions.flush(room)
      return `Could not reach "${help.target.title}": ${error}`
    }
    const other = await this.ensureLive(SessionId(help.target.sessionId))
    if (!other.ok) return fail('that room is not available')
    const events = other.session.snapshotEvents()
    const member = help.target.member === undefined
      ? coordinatorMember(other.state, events)
      : other.state.members.find(entry => entry.name === help.target.member)
    if (member === undefined) return fail(help.target.member === undefined ? 'that room has no coordinator' : `that room has no member "${help.target.member}"`)
    const origin = { id: help.id, room: room.id, roomTitle: this.roomTitle(room), from: help.fromName }
    // A round a restart left uncertain blocks the member's later work until a
    // human reconciles it — silently, for a request from outside. Move on
    // from it, as a human message to that member does.
    const carry = this.moveOnFromLostRounds(other.session, [member.name], '另一个协作间来求助；被重启打断的这一轮按没做完处理')
    const sent = sendOrHold(other.session, {
      to: member, text, fromName: `${help.fromName}（${origin.roomTitle}）`,
      intent: { origin: 'help', hop: 1, kind: 'task', help: origin, ...op === 'request' ? { task: SELF_TASK } : {} },
    })
    other.session.append('room/help-in', { ...origin, member: member.name, text, op, ...sent.delivered ? {} : { held: true } })
    await this.ctx.sessions.flush(other.session)
    room.append('room/help-state', { help: help.id, state: sent.delivered ? 'running' : 'queued' })
    await this.ctx.sessions.flush(room)
    if (sent.delivered) this.engine.dispatch(other.session, member.name, carry(member.name, text), { dispatchSeq: sent.seq })
    const who = `${member.name} in the room "${help.target.title}"`
    return `${sent.delivered ? `Sent to ${who}.` : `Sent to ${who}; that room is paused, so the request waits until it resumes.`}`
      + ` Help id: ${help.id}. The reply reaches you on its own — end your turn now; do not poll.`
  }

  /**
   * A help dispatch in this room settled: its final reply (or its failure)
   * goes back to the asking room's thread.
   * @param room - the room that was asked.
   * @param dispatchSeq - the settled dispatch.
   * @param outcome - the run's outcome.
   */
  private async helpSettled(room: Session, dispatchSeq: number | undefined, outcome: { readonly state: string; readonly text?: string; readonly error?: string }): Promise<void> {
    const source = dispatchSeq === undefined ? undefined : room.snapshotEvents().find(event => event.seq === dispatchSeq)
    if (source?.type !== 'room/dispatch' || source.data.help === undefined) return
    const asked = source.data.help
    const loaded = await this.ensureLive(SessionId(asked.room))
    if (!loaded.ok) return
    const thread = replayHelps(loaded.session.snapshotEvents()).find(entry => entry.id === asked.id)
    if (thread === undefined) return
    if (outcome.state === 'done') {
      const text = outcome.text?.trim()
      await this.recordHelperMessage(loaded.session, thread, { kind: 'reply', text: text === undefined || text === '' ? '（对方这一轮结束了，没有给出答复）' : text })
      return
    }
    loaded.session.append('room/help-state', { help: thread.id, state: 'failed', error: outcome.error ?? `对方这一轮${outcome.state === 'cancelled' ? '被取消了' : '没有完成'}` })
    await this.ctx.sessions.flush(loaded.session)
  }

  /** Queue one help message in the helper's session (waking it when cold) and watch its turn. */
  private async deliverHelp(room: Session, help: { readonly id: string; readonly fromName: string; readonly target: { readonly sessionId: string; readonly title: string } }, prompt: string, op: 'request' | 'message', display: string): Promise<string> {
    const fail = async (error: string): Promise<string> => {
      room.append('room/help-state', { help: help.id, state: 'failed', error })
      await this.ctx.sessions.flush(room)
      return `Could not reach "${help.target.title}": ${error}`
    }
    const controller = (this.ctx.get as (name: string) => unknown)('sessionController') as {
      resolveAgent?(sessionId: SessionId): Promise<{ readonly agent: Agent } | { readonly error: { readonly message: string } }>
    } | undefined
    if (controller?.resolveAgent === undefined) return fail('this host cannot wake other sessions')
    let agent: Agent
    try {
      const resolved = await controller.resolveAgent(SessionId(help.target.sessionId))
      if ('error' in resolved) return await fail(resolved.error.message)
      agent = resolved.agent
    } catch (error) {
      return fail(String(error))
    }
    this.equipHelper(agent)
    const queued = (agent as Agent & { readonly status?: string }).status === 'running'
    const message = helpMessage(prompt, { help: help.id, room: room.id, roomTitle: this.roomTitle(room), from: help.fromName, op, text: display.slice(0, 4000) })
    room.append('room/help-state', { help: help.id, state: queued ? 'queued' : 'running' })
    await this.ctx.sessions.flush(room)
    const mark = room.snapshotEvents().at(-1)?.seq ?? -1
    agent.followup(message)
    this.watchHelp(room.id, help.id, agent, String(message.id), mark)
    return `${queued ? `Sent to "${help.target.title}"; it is busy, so the request waits in its queue.` : `Sent to "${help.target.title}".`}`
      + ` Help id: ${help.id}. Its reply reaches you on its own — end your turn now; do not poll.`
  }

  /**
   * After the helper's turn: a turn that never claimed the message failed the
   * thread; one that ended without the reply or question tool hands over its
   * last answer as the reply.
   */
  private watchHelp(roomId: SessionId, helpId: string, agent: Agent, messageId: string, mark: number): void {
    void (async () => {
      await agent.whenIdle()
      const loaded = await this.ensureLive(roomId)
      if (!loaded.ok) return
      const room = loaded.session
      const help = replayHelps(room.snapshotEvents()).find(entry => entry.id === helpId)
      if (help === undefined || help.state === 'failed') return
      const answered = room.snapshotEvents().some(event => event.seq > mark && event.type === 'room/help-message' && event.data.help === helpId && event.data.kind !== 'message')
      if (answered) return
      const helperEvents = agent.session.snapshotEvents()
      if (!claimed(helperEvents, messageId)) {
        room.append('room/help-state', { help: helpId, state: 'failed', error: 'the request left the helper\'s queue without being handled' })
        await this.ctx.sessions.flush(room)
        return
      }
      const answer = turnAnswer(helperEvents, messageId)
      await this.recordHelperMessage(room, help, { kind: 'reply', text: answer === '' ? '（对方这一轮结束了，没有给出答复）' : answer, fallback: true })
    })().catch((error: unknown) => { this.ctx.logger.warn(`room: help ${helpId} watch faulted: ${String(error)}`) })
  }

  /** A help request reached the helper's turn: a queued thread is running now. */
  private async markHelpRunning(source: HelpSource): Promise<void> {
    const room = this.ctx.sessions.get(SessionId(source.room))
    if (room === undefined) return
    const help = replayHelps(room.snapshotEvents()).find(entry => entry.id === source.help)
    if (help === undefined || help.state === 'running') return
    if (help.state !== 'queued' && !(help.state === 'asking' && source.op === 'message') && !(help.state === 'replied' && source.op === 'message')) return
    room.append('room/help-state', { help: help.id, state: 'running' })
    await this.ctx.sessions.flush(room)
  }

  /** Journal a helper's question or reply and hand it to the asking member. */
  private async recordHelperMessage(room: Session, help: RoomHelp, message: { readonly kind: 'question' | 'reply'; readonly text: string; readonly handoff?: string; readonly fallback?: true }): Promise<void> {
    room.append('room/help-message', { help: help.id, kind: message.kind, text: message.text, ...message.handoff === undefined ? {} : { handoff: message.handoff }, ...message.fallback === undefined ? {} : { fallback: true } })
    room.append('room/help-state', { help: help.id, state: message.kind === 'reply' ? 'replied' : 'asking' })
    const events = room.snapshotEvents()
    const state = replay(events)
    const asker = state.members.find(member => memberId(events, member) === help.from) ?? coordinatorMember(state, events)
    if (asker === undefined) {
      await this.ctx.sessions.flush(room)
      return
    }
    const text = askerPrompt(help, message)
    const dispatch = room.append('room/dispatch', {
      id: randomUUID(), origin: 'report', reportFor: `help:${help.id}`, targets: [asker.name], targetIds: [memberId(events, asker)], text,
    })
    await this.ctx.sessions.flush(room)
    this.engine.dispatch(room, asker.name, text, { dispatchSeq: dispatch.seq })
  }

  /**
   * The helper's `room_help_reply` / `room_help_ask`: find the thread from
   * the help requests in the helper's own log, then carry the message back.
   * @param agent - the helper agent.
   * @param request - thread (optional when only one), kind, text, handoff.
   * @returns the tool's text result.
   */
  async helperMessage(agent: Agent, request: { help?: string; kind: 'question' | 'reply'; text: string; handoff?: string }): Promise<string> {
    const received = receivedHelps(agent.session.snapshotEvents())
    const wanted = request.help?.trim()
    const source = wanted === undefined || wanted === '' ? received.at(-1) : received.find(entry => entry.help === wanted)
    if (source === undefined) {
      return received.length === 0
        ? 'No help request reached this session.'
        : `No help "${wanted}" here; the requests this session received: ${received.map(entry => `${entry.help} (from ${entry.from} in "${entry.roomTitle}")`).join(', ')}.`
    }
    const text = request.text.trim()
    if (text === '') return 'The text must be non-blank.'
    const loaded = await this.ensureLive(SessionId(source.room))
    if (!loaded.ok) return `The room "${source.roomTitle}" that asked is no longer available.`
    const help = replayHelps(loaded.session.snapshotEvents()).find(entry => entry.id === source.help)
    if (help === undefined) return 'That help thread is gone.'
    const handoff = request.handoff?.trim()
    await this.recordHelperMessage(loaded.session, help, { kind: request.kind, text, ...handoff === undefined || handoff === '' ? {} : { handoff } })
    return request.kind === 'reply'
      ? `Your reply reached ${help.fromName} in "${source.roomTitle}".`
      : `Your question went to ${help.fromName} in "${source.roomTitle}"; the answer arrives as a new message. End your turn now.`
  }

  /** Bounded shared room context for native and external model tools; reading never wakes an agent. */
  async readRoomContext(sessionId: string): Promise<string> {
    const routed = this.nativeRoute(sessionId)
    if (routed !== undefined) {
      const self = replay(this.ctx.sessions.get(routed.roomId)!.snapshotEvents()).members.find(member => member.childSessionId === routed.actor)?.name
      return JSON.stringify({ self, ...JSON.parse(await this.readRoomContext(routed.roomId)) })
    }
    const state = await this.getState({ sessionId: SessionId(sessionId) })
    if (!state.ok && state.error.code === 'not-a-room') {
      // A plain session: everything an invite needs, instead of an error that
      // sends the model guessing provider ids.
      const offered = await this.listProviders({ sessionId: SessionId(sessionId) })
      return JSON.stringify({
        room: false,
        note: 'This session is not a room yet. room_invite promotes it into one: no other setup is needed.',
        providers: offered.providers.map(entry => ({ provider: entry.provider, name: entry.displayName, ...entry.authenticated ? {} : { loggedOut: true } })),
        ...offered.presets === undefined ? {} : { modes: offered.presets.map(entry => ({ id: entry.id, ...entry.name === undefined ? {} : { name: entry.name } })) },
        ...offered.sessionPreset === undefined ? {} : { sessionMode: offered.sessionPreset },
      })
    }
    if (!state.ok) throw new Error(`Room unavailable: ${state.error.code}`)
    const events = this.ctx.sessions.get(SessionId(sessionId))?.snapshotEvents() ?? []
    const recent = events.filter(event => event.type === 'room/speech').slice(-12).map(event => event.type === 'room/speech' ? { member: event.data.member, text: event.data.text.slice(0, 2000) } : null)
    return JSON.stringify({ planCommands: planCommandContract(), coordinator: coordinatorMember(state.value)?.name,
      state: { ...state.value, deliveries: state.value.deliveries?.slice(-30), jobs: state.value.jobs?.slice(0, 20), relays: state.value.relays.slice(-30) },
      providers: await this.listProviders({}), recent })
  }

  /** Human UI and native/external tools share the same durable transition service. */
  @Remote('planCommand')
  async planCommand(request: { sessionId: SessionId; command: string }): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      const loaded = await this.ensureLive(request.sessionId)
      if (!loaded.ok) return { ok: false, message: loaded.error.code }
      if (this.handoffs.has(request.sessionId)) return { ok: false, message: 'Coordinator handoff is in progress' }
      await this.plans.command(loaded.session, request.command, { kind: 'human', memberId: 'human' })
      return { ok: true }
    } catch (error) { return { ok: false, message: String(error) } }
  }

  /** The actor is derived from the calling native agent or authenticated bridge. */
  async commandPlan(sessionId: string, command: string, actorChildSessionId?: string): Promise<string> {
    const routed = actorChildSessionId === undefined ? this.nativeRoute(sessionId) : undefined
    if (routed !== undefined) return this.commandPlan(routed.roomId, command, routed.actor)
    const loaded = await this.ensureLive(SessionId(sessionId))
    if (!loaded.ok) throw new Error(loaded.error.code)
    if (this.handoffs.has(sessionId)) throw new Error('Coordinator handoff is in progress')
    const events = loaded.session.snapshotEvents()
    const state = replay(events)
    const member = state.members.find(member => actorChildSessionId === undefined ? member.kind === 'main-agent' : member.childSessionId === actorChildSessionId)
    if (member === undefined) throw new Error('Calling member is not in this room')
    const id = memberId(events, member)
    const plan = await this.plans.command(loaded.session, command, { kind: coordinatorMember(state, events)?.name === member.name ? 'coordinator' : 'worker', memberId: id })
    const { requests: _requests, ...view } = plan
    return JSON.stringify(view)
  }

  /**
   * The mode of an external member — the host preset whose plugin tools its
   * bridge offers (local-agent's preset tool host runs them) — with its
   * working directory. Host method for the member channel, never a Remote.
   * @param actor - the authenticated member run.
   * @returns the mode, or undefined when the member has none or is not here.
   */
  async memberMode(actor: LocalAgentMemberRun): Promise<{ readonly preset: string; readonly cwd?: string } | undefined> {
    const loaded = await this.ensureLive(SessionId(actor.parentSessionId))
    if (!loaded.ok) return undefined
    const cli = loaded.state.members.filter(entry => entry.kind === 'cli' && entry.provider === actor.provider)
    // A member's first round asks before the journal knows its child session
    // (claude lists MCP tools at spawn): the one first start in flight for
    // this provider is the asker. Two at once stay ambiguous — no mode.
    const starting = this.engine.startingMembers(actor.parentSessionId)
    const fresh = cli.filter(entry => entry.childSessionId === undefined && starting.includes(memberId(loaded.session.snapshotEvents(), entry)))
    const member = cli.find(entry => entry.childSessionId === actor.childSessionId)
      ?? (fresh.length === 1 ? fresh[0] : undefined)
    if (member?.preset === undefined) return undefined
    const cwd = member.cwd ?? loaded.session.header.cwd
    return { preset: member.preset, ...cwd === undefined ? {} : { cwd } }
  }

  /** Pending member tool approvals this process can still answer: approval id → its waiting call. */
  private readonly approvalWaiters = new Map<string, (outcome: 'allowed-once' | 'rejected' | 'cancelled') => void>()

  /** Close approvals no waiting call stands behind any more (a restart lost it). */
  private expireApprovals(session: Session): void {
    for (const approval of replay(session.snapshotEvents()).approvals ?? []) {
      if (!this.approvalWaiters.has(approval.id)) session.append('room/approval-resolved', { id: approval.id, outcome: 'cancelled' })
    }
  }

  /**
   * A CLI member's mode tool needs the human's approval: ask in the room's
   * conversation (a 允许 / 拒绝 line) and resolve when the human answers,
   * the call is cancelled, or the room is gone. Host method for the member
   * channel (local-agent's approval hook), never a Remote.
   * @param actor - the authenticated member run.
   * @param request - the tool, an optional reason, and the call's signal.
   * @returns the approval outcome the tool registry expects.
   */
  async askMemberApproval(actor: LocalAgentMemberRun, request: { readonly toolName: string; readonly reason?: string; readonly signal?: AbortSignal }): Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'> {
    const loaded = await this.ensureLive(SessionId(actor.parentSessionId))
    if (!loaded.ok) return 'unavailable'
    const events = loaded.session.snapshotEvents()
    const member = loaded.state.members.find(entry => entry.childSessionId === actor.childSessionId && entry.provider === actor.provider)
    if (member === undefined) return 'unavailable'
    if (request.signal?.aborted === true) return 'cancelled'
    const id = randomUUID()
    const session = loaded.session
    const answered = new Promise<'allowed-once' | 'rejected' | 'cancelled'>((resolve) => {
      this.approvalWaiters.set(id, resolve)
      request.signal?.addEventListener('abort', () => { resolve('cancelled') }, { once: true })
    })
    session.append('room/approval', { id, member: member.name, memberId: memberId(events, member), tool: request.toolName,
      ...request.reason === undefined || request.reason.trim() === '' ? {} : { reason: request.reason.trim().slice(0, 500) } })
    await this.ctx.sessions.flush(session)
    const outcome = await answered
    this.approvalWaiters.delete(id)
    if (replay(session.snapshotEvents()).approvals?.some(entry => entry.id === id) === true) {
      session.append('room/approval-resolved', { id, outcome })
      await this.ctx.sessions.flush(session)
    }
    return outcome
  }

  /**
   * The human answers a member's tool approval from the room.
   * @param request - room session, approval id, allow once or reject.
   * @returns ok, or `approval-not-pending` when it already ended.
   */
  @Remote('answerApproval')
  async answerApproval(request: RoomAnswerApprovalRequest): Promise<RoomAnswerApprovalResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const waiter = this.approvalWaiters.get(request.id)
    if (waiter === undefined || loaded.state.approvals?.some(entry => entry.id === request.id) !== true) return { ok: false, error: { code: 'approval-not-pending' } }
    loaded.session.append('room/approval-resolved', { id: request.id, outcome: request.outcome })
    await this.ctx.sessions.flush(loaded.session)
    waiter(request.outcome)
    return { ok: true }
  }

  /** Pending member questions this process can still answer: question id → its waiting call. */
  private readonly questionWaiters = new Map<string, (answers: readonly RoomQuestionAnswer[] | undefined) => void>()

  /** Close question cards no waiting call stands behind any more (a restart lost it). */
  private expireQuestions(session: Session): void {
    for (const question of replay(session.snapshotEvents()).questions ?? []) {
      if (!this.questionWaiters.has(question.id)) session.append('room/question-resolved', { id: question.id, outcome: 'cancelled' })
    }
  }

  /**
   * A member asks the human questions (its bridge's `ask_user_question`):
   * journal a pick-to-answer card in the room and wait for the answer, the
   * timeout, or the room going away.
   * @param session - the live room session.
   * @param member - the asking member.
   * @param questions - the validated questions.
   * @param timeoutMs - how long the call waits before it gives up.
   * @returns the answers, or undefined when nobody answered.
   */
  private async askQuestions(session: Session, member: RoomMember, questions: readonly RoomQuestionItem[], timeoutMs: number, consent = false): Promise<readonly RoomQuestionAnswer[] | undefined> {
    const id = randomUUID()
    const answered = new Promise<readonly RoomQuestionAnswer[] | undefined>((resolve) => {
      this.questionWaiters.set(id, resolve)
      setTimeout(() => { resolve(undefined) }, timeoutMs).unref?.()
    })
    session.append('room/question', { id, member: member.name, memberId: memberId(session.snapshotEvents(), member), questions, ...consent ? { consent: true as const } : {} })
    await this.ctx.sessions.flush(session)
    const answers = await answered
    this.questionWaiters.delete(id)
    if (answers === undefined && replay(session.snapshotEvents()).questions?.some(entry => entry.id === id) === true) {
      session.append('room/question-resolved', { id, outcome: 'cancelled' })
      await this.ctx.sessions.flush(session)
    }
    return answers
  }

  /**
   * The human answers a member's question card from the room.
   * @param request - room session, card id, one answer per question.
   * @returns ok, or `question-not-pending` when it already ended.
   */
  @Remote('answerQuestion')
  async answerQuestion(request: RoomAnswerQuestionRequest): Promise<RoomAnswerQuestionResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const waiter = this.questionWaiters.get(request.id)
    const pending = loaded.state.questions?.find(entry => entry.id === request.id)
    if (waiter === undefined || pending === undefined) return this.answerExpiredQuestion(loaded.session, request)
    // Keep only answers to this card's own questions, in the shape the asker expects.
    const answers = pending.questions.map((question) => {
      const given = request.answers.find(answer => answer.id === question.id)
      const custom = given?.custom?.trim()
      return { id: question.id, selected: [...given?.selected ?? []].filter(label => typeof label === 'string'), ...custom === undefined || custom === '' ? {} : { custom } }
    })
    loaded.session.append('room/question-resolved', { id: request.id, outcome: 'answered', answers })
    await this.ctx.sessions.flush(loaded.session)
    waiter(answers)
    return { ok: true }
  }

  /**
   * Answer a card whose waiting call is gone (it timed out, or a restart
   * ended the member's process): the card records the answers, and they
   * reach the member as a new message that wakes it with its own context —
   * the member asked so it could go on, so a late answer is still worth it.
   * A consent gate is never answered late: its call already decided.
   * @param session - the live room session.
   * @param request - card id and the human's answers.
   * @returns ok, or `question-not-pending` when the card is not an expired, unanswered question.
   */
  private async answerExpiredQuestion(session: Session, request: RoomAnswerQuestionRequest): Promise<RoomAnswerQuestionResult> {
    const events = session.snapshotEvents()
    const asked = events.find(event => event.type === 'room/question' && event.data.id === request.id)
    if (asked?.type !== 'room/question' || asked.data.consent === true) return { ok: false, error: { code: 'question-not-pending' } }
    const outcomes = events.filter(event => event.type === 'room/question-resolved' && event.data.id === request.id)
    // Expired, or still open with no call behind it (a restart this room has not swept yet).
    const last = outcomes.at(-1)
    if (last !== undefined && (last.type !== 'room/question-resolved' || last.data.outcome !== 'cancelled')) return { ok: false, error: { code: 'question-not-pending' } }
    const member = replay(events).members.find(entry => memberId(events, entry) === asked.data.memberId)
    if (member === undefined) return { ok: false, error: { code: 'question-not-pending' } }
    const answers = asked.data.questions.map((question) => {
      const given = request.answers.find(answer => answer.id === question.id)
      const custom = given?.custom?.trim()
      return { id: question.id, selected: [...given?.selected ?? []].filter(label => typeof label === 'string'), ...custom === undefined || custom === '' ? {} : { custom } }
    })
    session.append('room/question-resolved', { id: request.id, outcome: 'answered', answers, late: true })
    const text = lateAnswerText(asked.data.questions, answers)
    const carry = this.moveOnFromLostRounds(session, [member.name])
    const dispatch = session.append('room/dispatch', {
      id: randomUUID(), targets: [member.name], targetIds: [memberId(events, member)], text, origin: 'human',
    })
    await this.ctx.sessions.flush(session)
    this.engine.dispatch(session, member.name, carry(member.name, text), { dispatchSeq: dispatch.seq })
    return { ok: true }
  }

  /** Shared backend for external MCP room tools. Not exposed as a browser Remote. */
  async receiveMemberCommand(actor: LocalAgentMemberRun, command: MemberRoomCommand): Promise<MemberMessageOutcome> {
    try {
      const loaded = await this.ensureLive(SessionId(actor.parentSessionId))
      if (!loaded.ok) return { ok: false, error: `Room unavailable: ${loaded.error.code}` }
      const sender = loaded.state.members.find(member => member.childSessionId === actor.childSessionId && member.provider === actor.provider)
      if (sender === undefined) return { ok: false, error: 'The authenticated member is not in this room roster' }
      if (command === null || typeof command !== 'object' || command.arguments === null || typeof command.arguments !== 'object' || Array.isArray(command.arguments)) return { ok: false, error: 'Malformed room command' }
      const args = command.arguments
      const allowed: Record<string, readonly string[]> = { room_plan: ['command'], room_read: [], room_invite: ['provider', 'name', 'role', 'instructions', 'cwd', 'model', 'effort', 'mode', 'firstTask', 'note'], room_message: ['member', 'text', 'kind', 'inReplyTo', 'note', 'task'], ask_user_question: ['questions'], room_help: ['session', 'member', 'help', 'text'] }
      const keys = allowed[command.name]
      if (keys === undefined || Object.keys(args).some(key => !keys.includes(key))) return { ok: false, error: 'Unknown room command or argument; room and actor identity are host-owned' }
      const required = (key: string): string => {
        const value = args[key]
        if (typeof value !== 'string' || value.trim() === '') throw new Error(`A non-empty ${key} is required`)
        return value
      }
      const optional = (key: string): string | undefined => args[key] === undefined ? undefined : required(key)
      if (command.name === 'ask_user_question') {
        const questions = parseQuestions(args.questions)
        if (typeof questions === 'string') return { ok: false, error: questions }
        const answers = await this.askQuestions(loaded.session, sender, questions, QUESTION_TIMEOUT_MS)
        return answers === undefined
          ? { ok: false, error: 'The human did not answer (the question expired or the room was stopped). Continue with your best judgement and say what you assumed.' }
          : { ok: true, receipt: JSON.stringify({ answers }) }
      }
      if (command.name === 'room_help') {
        const text = await this.askHelp({ sessionId: loaded.session.id, text: required('text'),
          ...optional('session') === undefined ? {} : { session: optional('session')! },
          ...optional('member') === undefined ? {} : { member: optional('member')! },
          ...optional('help') === undefined ? {} : { help: optional('help')! } }, undefined, actor.childSessionId)
        return { ok: true, receipt: text }
      }
      if (command.name === 'room_read') {
        return { ok: true, receipt: JSON.stringify({ self: sender.name, ...JSON.parse(await this.readRoomContext(loaded.session.id)) }) }
      }
      if (command.name === 'room_plan') return { ok: true, receipt: await this.commandPlan(loaded.session.id, required('command'), actor.childSessionId) }
      if (command.name === 'room_message') {
        const kind = optional('kind')
        if (kind !== undefined && kind !== 'task' && kind !== 'notify') return { ok: false, error: 'kind must be "task" or "notify"' }
        const sent = await this.messageMember({ sessionId: loaded.session.id, member: required('member'), text: required('text'),
          ...kind === undefined ? {} : { kind }, ...optional('inReplyTo') === undefined ? {} : { inReplyTo: optional('inReplyTo')! },
          ...optional('note') === undefined ? {} : { note: optional('note')! },
          ...optional('task') === undefined ? {} : { task: optional('task')! } }, actor.childSessionId)
        return sent.ok ? { ok: true, receipt: messageReceipt(sent.value, kind ?? 'task') } : { ok: false, error: sent.error.code }
      }
      if (!this.isCurrentCoordinator(loaded.session, actor.childSessionId)) return { ok: false, error: 'Only the current coordinator may invite members' }
      const result = await this.inviteMember({ sessionId: loaded.session.id, provider: required('provider'), name: required('name'),
          ...optional('role') === undefined ? {} : { role: optional('role')! },
          ...optional('instructions') === undefined ? {} : { instructions: optional('instructions')! },
          ...optional('cwd') === undefined ? {} : { cwd: optional('cwd')! },
          ...optional('model') === undefined ? {} : { model: optional('model')! },
          ...optional('effort') === undefined ? {} : { effort: optional('effort')! },
          ...optional('firstTask') === undefined ? {} : { firstTask: optional('firstTask')! },
          ...optional('note') === undefined ? {} : { note: optional('note')! },
          // Omitted keeps the room's own mode; "none" asks for none.
          ...optional('mode') === undefined ? { inheritPreset: true } : optional('mode') === 'none' ? {} : { preset: optional('mode')! },
        }, 'agent', actor.childSessionId)
      return result.ok ? { ok: true, receipt: JSON.stringify(result.value) } : { ok: false, error: result.error.code }
    } catch (error) { return { ok: false, error: String(error) } }
  }

  /**
   * The bridge's `member_message` entry (contract shared with the local-agent
   * family: `ctx.get('room')` + duck-typed call). The call crosses an untyped
   * package boundary, so the message shape is validated at runtime: a
   * malformed message throws (the bridge treats a rejection as "room does
   * not claim this" and delivers directly) instead of poisoning the journal.
   * A roster sender (resolved by child session id + provider, never
   * self-reported) goes through {@link messageMember}: delivered at once or
   * held by the room's settings. The receipt tells the model what happened
   * (`sent #m12 …` / `pending-confirm …`). A sender the roster does not know
   * keeps the legacy pending relay.
   * @param request - sender, recipient, content, the shared parent session, provenance, kind.
   * @returns the receipt quoted back to the sending model.
   */
  async receiveMemberMessage(request: RoomMemberMessage): Promise<RoomMemberMessageReceipt> {
    if (typeof request?.from !== 'string' || typeof request.to !== 'string'
      || typeof request.content !== 'string' || typeof request.parentSessionId !== 'string') {
      throw new Error('room: malformed member message (from/to/content/parentSessionId must be strings)')
    }
    const loaded = await this.ensureLive(request.parentSessionId)
    if (!loaded.ok) throw new Error(`room: not a room session (${loaded.error.code})`)
    const sender = loaded.state.members.find(member => member.childSessionId === request.from && member.provider === request.provenance?.provider)
    if (sender !== undefined) {
      const kind = request.kind === 'notify' ? 'notify' : 'task'
      const result = await this.messageMember({ sessionId: loaded.session.id, member: request.to, text: request.content, kind,
        ...typeof request.inReplyTo === 'string' ? { inReplyTo: request.inReplyTo } : {},
        ...typeof request.note === 'string' ? { note: request.note } : {},
        ...typeof request.task === 'string' ? { task: request.task } : {} }, request.from)
      if (!result.ok) throw new Error(result.error.code)
      return messageReceipt(result.value, kind)
    }
    const resolveName = (endpoint: string): string => {
      const byName = loaded.state.members.find(member => member.name === endpoint)
      if (byName !== undefined) return byName.name
      return loaded.state.members.find(member => member.childSessionId === endpoint)?.name ?? endpoint
    }
    loaded.session.append('room/relay', {
      id: randomUUID(),
      from: resolveName(request.from),
      to: resolveName(request.to),
      content: request.content,
      ...request.provenance === undefined ? {} : { provenance: request.provenance },
    })
    await this.ctx.sessions.flush(loaded.session)
    return 'pending-confirm'
  }

  /**
   * Confirm a pending relay: journal the confirmed edge and dispatch the
   * notification to the recipient as a continuation (`{from} 给你的通知:
   * {content}`); the engine marks the relay sent once the recipient's own
   * session receives the prompt.
   * @param request - room session, relay id.
   * @returns the resolution receipt, or a rejection.
   */
  @Remote('confirmRelay')
  async confirmRelay(request: RoomRelayResolveRequest): Promise<RoomRelayResolveResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const relay = loaded.state.relays.find(entry => entry.id === request.relayId)
    if (relay === undefined) return { ok: false, error: { code: 'relay-not-found' } }
    if (relay.state !== 'pending') return { ok: false, error: { code: 'relay-not-pending' } }
    if (!loaded.state.members.some(member => member.name === relay.to)) {
      return { ok: false, error: { code: 'member-not-found' } }
    }
    if (relay.intent !== undefined) {
      this.release(loaded.session, relay, true)
      await this.ctx.sessions.flush(loaded.session)
      return { ok: true, value: { relayId: relay.id } }
    }
    loaded.session.append('room/relay-resolved', { id: relay.id, state: 'confirmed' })
    await this.ctx.sessions.flush(loaded.session)
    this.engine.dispatch(loaded.session, relay.to, `${relay.from} 给你的通知: ${relay.content}`, {
      relayIds: [relay.id],
    })
    return { ok: true, value: { relayId: relay.id } }
  }

  /**
   * Deliver a held message as the dispatch it would have been. `force`
   * (the human's confirm) skips the hold rules; otherwise (resuming a paused
   * room) they are re-checked, so a message may be held again for another
   * reason — the old hold is then superseded (dismissed) by the new one.
   * The caller flushes.
   */
  private release(session: Session, relay: RoomRelay, force: boolean): void {
    const intent = releaseIntent(relay)
    const target = replay(session.snapshotEvents()).members.find(member => member.name === relay.to)
    if (intent === undefined || target === undefined) return
    const sent = sendOrHold(session, { to: target, text: relay.content, fromName: relay.from, intent }, force)
    session.append('room/relay-resolved', { id: relay.id, state: sent.delivered ? 'sent' : 'dismissed' })
    if (sent.delivered) this.engine.dispatch(session, target.name, relay.content, { dispatchSeq: sent.seq })
  }

  /**
   * Hand a member the reports the gate holds for it now (the room's
   * 「现在交给」 button).
   * @param request - room session, member name.
   * @returns whether anything was held.
   */
  @Remote('releaseReports')
  async releaseReports(request: RoomReleaseReportsRequest): Promise<RoomReleaseReportsResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const member = loaded.state.members.find(entry => entry.name === request.name)
    if (member === undefined) return { ok: false, error: { code: 'member-not-found' } }
    const released = await this.engine.releaseHeld(loaded.session, memberId(loaded.session.snapshotEvents(), member), 'manual')
    return { ok: true, value: { released } }
  }

  /**
   * Change the room's collaboration settings (any subset). Resuming a paused
   * room releases everything the pause held, in order.
   * @param request - room session and the fields to change.
   * @returns the settings after the change, or a rejection.
   */
  @Remote('setSettings')
  async setSettings(request: RoomSetSettingsRequest): Promise<RoomSetSettingsResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (request.hopLimit !== undefined && (!Number.isInteger(request.hopLimit) || request.hopLimit < 2 || request.hopLimit > 50)) {
      return { ok: false, error: { code: 'invalid-settings' } }
    }
    if (request.memberMessages !== undefined && request.memberMessages !== 'free' && request.memberMessages !== 'confirm') {
      return { ok: false, error: { code: 'invalid-settings' } }
    }
    if (request.reportTiming !== undefined && request.reportTiming !== 'judge' && request.reportTiming !== 'each') {
      return { ok: false, error: { code: 'invalid-settings' } }
    }
    if (request.autoTaskFiling !== undefined && typeof request.autoTaskFiling !== 'boolean') return { ok: false, error: { code: 'invalid-settings' } }
    if (request.reportThreshold !== undefined && (typeof request.reportThreshold !== 'number' || !(request.reportThreshold >= 0.1 && request.reportThreshold <= 0.9))) {
      return { ok: false, error: { code: 'invalid-settings' } }
    }
    if (request.reportWaitMinutes !== undefined && (!Number.isInteger(request.reportWaitMinutes) || request.reportWaitMinutes < 1 || request.reportWaitMinutes > 30)) {
      return { ok: false, error: { code: 'invalid-settings' } }
    }
    if (request.helpReminderMinutes !== undefined && (!Number.isInteger(request.helpReminderMinutes) || request.helpReminderMinutes < 10 || request.helpReminderMinutes > 120)) {
      return { ok: false, error: { code: 'invalid-settings' } }
    }
    const change = {
      ...request.helpReminderMinutes === undefined ? {} : { helpReminderMinutes: request.helpReminderMinutes },
      ...request.memberMessages === undefined ? {} : { memberMessages: request.memberMessages },
      ...request.hopLimit === undefined ? {} : { hopLimit: request.hopLimit },
      ...request.paused === undefined ? {} : { paused: request.paused },
      ...request.reportTiming === undefined ? {} : { reportTiming: request.reportTiming },
      ...request.autoTaskFiling === undefined ? {} : { autoTaskFiling: request.autoTaskFiling },
      ...request.reportThreshold === undefined ? {} : { reportThreshold: Math.round(request.reportThreshold * 100) / 100 },
      ...request.reportWaitMinutes === undefined ? {} : { reportWaitMinutes: request.reportWaitMinutes },
    }
    if (Object.keys(change).length === 0) return { ok: false, error: { code: 'nothing-to-update' } }
    const wasPaused = loaded.state.settings?.paused === true
    loaded.session.append('room/settings', change)
    if (wasPaused && request.paused === false) {
      for (const relay of loaded.state.relays) {
        if (relay.state === 'pending' && relay.reason === 'paused') this.release(loaded.session, relay, false)
      }
    }
    await this.ctx.sessions.flush(loaded.session)
    return { ok: true, value: replay(loaded.session.snapshotEvents()).settings ?? DEFAULT_ROOM_SETTINGS }
  }

  /**
   * Keep an outside session on the member list (「加入房间成员」): only a
   * shortcut for asking it — it stays in its own session, asks still go
   * through room_help, and its usage stays its own.
   * @param request - room session, the outside session and its title.
   * @returns ok, or a rejection.
   */
  @Remote('linkSession')
  async linkSession(request: RoomHelpLinkRequest): Promise<RoomHelpLinkResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const title = request.title?.trim()
    if (request.target === request.sessionId || title === undefined || title === '' || loaded.state.members.some(member => member.childSessionId === request.target)) {
      return { ok: false, error: { code: 'invalid-settings' } }
    }
    if (loaded.state.linked?.some(entry => entry.sessionId === request.target) === true) return { ok: true }
    loaded.session.append('room/help-link', { sessionId: request.target, title })
    await this.ctx.sessions.flush(loaded.session)
    return { ok: true }
  }

  /**
   * Take an outside session off the member list (its own session is untouched).
   * @param request - room session, the outside session.
   * @returns ok, or `member-not-found` when it was not on the list.
   */
  @Remote('unlinkSession')
  async unlinkSession(request: RoomHelpLinkRequest): Promise<RoomHelpLinkResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (loaded.state.linked?.some(entry => entry.sessionId === request.target) !== true) return { ok: false, error: { code: 'member-not-found' } }
    loaded.session.append('room/help-unlink', { sessionId: request.target })
    await this.ctx.sessions.flush(loaded.session)
    return { ok: true }
  }

  /**
   * Dismiss the 加入房间成员 hint for one outside session (it never shows again).
   * @param request - room session, the outside session.
   * @returns ok.
   */
  @Remote('dismissHelpNudge')
  async dismissHelpNudge(request: RoomHelpLinkRequest): Promise<RoomHelpLinkResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    if (loaded.state.helpNudgesDismissed?.includes(request.target) === true) return { ok: true }
    loaded.session.append('room/help-nudge-dismissed', { sessionId: request.target })
    await this.ctx.sessions.flush(loaded.session)
    return { ok: true }
  }

  /**
   * Dismiss a pending relay: the notification never reaches anyone.
   * @param request - room session, relay id.
   * @returns the resolution receipt, or a rejection.
   */
  @Remote('dismissRelay')
  async dismissRelay(request: RoomRelayResolveRequest): Promise<RoomRelayResolveResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const relay = loaded.state.relays.find(entry => entry.id === request.relayId)
    if (relay === undefined) return { ok: false, error: { code: 'relay-not-found' } }
    if (relay.state !== 'pending') return { ok: false, error: { code: 'relay-not-pending' } }
    loaded.session.append('room/relay-resolved', { id: relay.id, state: 'dismissed' })
    await this.ctx.sessions.flush(loaded.session)
    // A dismissed help request from another room ends that room's thread.
    const asked = relay.intent?.help
    if (asked !== undefined) {
      const asking = await this.ensureLive(SessionId(asked.room))
      if (asking.ok && replayHelps(asking.session.snapshotEvents()).some(entry => entry.id === asked.id)) {
        asking.session.append('room/help-state', { help: asked.id, state: 'failed', error: '对方房间没有接这条求助' })
        await this.ctx.sessions.flush(asking.session)
      }
    }
    return { ok: true, value: { relayId: relay.id } }
  }

  /**
   * Set (or, with a blank text, clear) the room's goal. The goal is one
   * journaled line — the latest `room/goal` event wins; it rides the top of
   * the roster section in every member prompt and drives the dock's goal
   * capsule. Pure display/coordination text: it never dispatches anything.
   * @param request - room session and goal text.
   * @returns the now-current goal (absent after a clear), or a rejection.
   */
  @Remote('setGoal')
  async setGoal(request: RoomSetGoalRequest): Promise<RoomSetGoalResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const text = request.text.trim()
    loaded.session.append('room/goal', { text })
    await this.ctx.sessions.flush(loaded.session)
    return { ok: true, value: text === '' ? {} : { goal: text } }
  }

  /**
   * Cancel a member's in-flight run through the local-agent facade. A hit
   * journals the terminal `cancelled` edge immediately (the engine's own
   * settle for that run then no-ops); a miss — no facade, no delegation
   * handle, or nothing in flight — journals nothing and reports
   * `cancelled: false`.
   * @param request - room session, member name.
   * @returns the cancellation receipt, or a rejection.
   */
  @Remote('cancel')
  async cancel(request: RoomCancelRequest): Promise<RoomCancelResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const member = loaded.state.members.find(entry => entry.name === request.name)
    if (member === undefined) return { ok: false, error: { code: 'member-not-found' } }
    const expected = loaded.state.runs.find(entry => entry.member === request.name && entry.state === 'running')
    if ((request.expectedRunId !== undefined && expected?.runId !== request.expectedRunId)
      || (request.expectedStartedAt !== undefined && expected?.startedAt !== request.expectedStartedAt)) {
      return { ok: true, value: { cancelled: false } }
    }
    const facade = probeLocalAgent(this.ctx)
    const native = expected === undefined ? undefined
      : member.kind === 'main-agent' ? this.ctx.agents.get(loaded.session.id)
        : member.kind === 'native' && member.childSessionId !== undefined ? this.ctx.agents.get(member.childSessionId) : undefined
    if (native !== undefined) native.cancel({ kind: 'user' })
    const hit = native !== undefined || (facade !== undefined && member.childSessionId !== undefined
      ? facade.cancel(member.childSessionId)
      : false)
    if (hit) {
      const running = loaded.state.runs.find(entry => entry.member === request.name && entry.state === 'running')
      if (running === undefined) return { ok: true, value: { cancelled: true } }
      loaded.session.append('room/run-state', {
        member: request.name, state: 'cancelled', startedAt: running.startedAt,
        elapsedMs: Math.max(0, Date.now() - running.startedAt),
        ...running.runId === undefined ? {} : { runId: running.runId },
        ...this.terminalRunStateFields(loaded.session, loaded.state, request.name),
      })
      await this.ctx.sessions.flush(loaded.session)
      return { ok: true, value: { cancelled: true } }
    }
    return { ok: true, value: { cancelled: false } }
  }

  /** Native descendant controls share the host's continuation and cancellation channels. */
  @Remote('cancelChild')
  async cancelChild(request: { sessionId: SessionId; childSessionId: SessionId }): Promise<RoomCancelResult> {
    const loaded = await this.ensureLive(request.sessionId)
    if (!loaded.ok) return { ok: false, error: loaded.error }
    const target = this.ctx.sessions.get(request.childSessionId)
    const seen = new Set<string>([request.childSessionId])
    let parent = target?.header.parentSession
    while (parent !== undefined && parent !== request.sessionId && !seen.has(parent)) {
      seen.add(parent)
      parent = this.ctx.sessions.get(parent)?.header.parentSession
    }
    if (!target || target.id === request.sessionId || parent !== request.sessionId) return { ok: true, value: { cancelled: false } }
    const facadeHit = probeLocalAgent(this.ctx)?.cancel(target.id) ?? false
    const agent = this.ctx.agents.get(target.id)
    if (agent) {
      this.ctx.get('subagents')?.interrupt(target.id, { kind: 'user', parentSessionId: target.header.parentSession! })
      agent.cancel({ kind: 'user' })
    }
    return { ok: true, value: { cancelled: facadeHit || agent !== undefined } }
  }
}

export default RoomService
