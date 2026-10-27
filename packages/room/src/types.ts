/**
 * Wire vocabulary shared by the room Host Remote and its browser callers,
 * plus the `room/*` custom session-event vocabulary (merged onto the official
 * SessionEventMap — the schedule package's `schedule/change` is the in-tree
 * precedent). Types only: the generated Remote codecs import this module
 * type-side, and the client bundle never inlines host runtime code.
 * @module @khorsheed/dsh-room/types
 */
import type { RoomPlan } from './plan.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * A JSON-safe value (mirrors the host's JsonValue shape without importing the
 * dsh-session MAIN entry — that entry's Context merge is host-side and must
 * not leak into the client type program). Relay provenance crosses the Remote
 * boundary, so it must be constrained JSON.
 */
export type RoomJsonValue = null | boolean | number | string | RoomJsonValue[] | { [key: string]: RoomJsonValue }

/**
 * Room identity marker payload. Appended once at room creation; replaying the
 * session's event log recovers room identity, so no session-header change is
 * needed. `version` gates future payload evolution.
 */
export interface RoomCreatedEvent {
  readonly version: 1
}

/**
 * A member joined the roster. `name` is both the addressing name and the
 * display name: unique within the room, free of whitespace and `@` (composer
 * @-addressing must stay parseable), and decoupled from the provider so two
 * instances of one provider can coexist (`ada (kimi-cli)`).
 */
export interface RoomMemberAddedEvent {
  /** Stable identity; older journals derive it from their original join event. */
  readonly id?: string
  readonly name: string
  readonly kind: 'main-agent' | 'cli' | 'native'
  /** CLI provider id on `kind: 'cli'` members; `dsh` on native ones. */
  readonly provider?: string
  /**
   * The host agent preset a native DSH member composes (`kind: 'native'`):
   * a child session + agent in this host process, mounted with that preset
   * at creation and locked from then on. Absent = the host's default preset.
   */
  readonly preset?: string
  /** Role instructions, prepended to the member's first dispatch. */
  readonly instructions?: string
  /**
   * The member's short public role (≤ 30 chars — journal `ROOM_ROLE_MAX` — e.g.
   * 「代码审查」): what the roster, the cards and the team view show to
   * everyone else. The instructions stay private to the member.
   */
  readonly role?: string
  readonly invitedBy: 'human' | 'agent'
  /**
   * The member's own working directory (empty = inherits the room session's
   * cwd). Roster-only for now: the local-agent facade's per-call cwd override
   * (family need R2) has not landed, so the adapter does NOT pass it down yet.
   */
  readonly cwd?: string
  /**
   * The delegation's model (invite-time only, local-agent harness providers):
   * recorded on the roster and passed to the facade as the `start` call's
   * `model` option on the member's first dispatch — providers bind it at
   * spawn for both exec and live rounds. Blank/omitted = follow the harness
   * default.
   */
  readonly model?: string
  /**
   * The delegation's reasoning effort (invite-time only, local-agent harness
   * providers): recorded and consumed exactly like {@link RoomMemberAddedEvent.model}
   * — the facade `start` call's `effort` option on the first dispatch, bound
   * at spawn. Blank/omitted = follow the harness default.
   */
  readonly effort?: string
  /** The CLI member's dsh child session, once delegation has started. */
  readonly childSessionId?: SessionId
}

/** A roster member's editable fields changed. */
export interface RoomMemberUpdatedEvent {
  /**
   * The member this update addresses, by its CURRENT name (a rename carries
   * the new name in `rename`; keeping `name` as the addressing key keeps
   * every pre-rename journal replayable).
   */
  readonly name: string
  /** Rename: the member's new @-addressing name (validated at write: unique, no whitespace, no "@"). */
  readonly rename?: string
  /** New role instructions; null CLEARS them (later dispatches inject none). */
  readonly instructions?: string | null
  /** New public role; null CLEARS it. */
  readonly role?: string | null
  /**
   * New member-level cwd (roster-recorded; the delegation facade's per-call
   * override is the family's open R2). null CLEARS the override — the member
   * inherits the room session's cwd again.
   */
  readonly cwd?: string | null
  /**
   * The member's intended model, edited through the members tab's edit dialog.
   * Roster-recorded intent: consumed as the facade `start` call's `model`
   * option while the member was never dispatched (the live member's immediate
   * switch rides the localAgentGateway `setMemberModel` — the client calls
   * both). null CLEARS it — the member follows the harness default again.
   */
  readonly model?: string | null
  /**
   * The member's intended reasoning effort, edited through the members tab's
   * edit dialog. Roster-recorded intent consumed like the model above (a
   * never-dispatched member's first facade `start`; a live member's switch
   * rides the member-configuration channel). null CLEARS it.
   */
  readonly effort?: string | null
  /**
   * The CLI member's delegation handle, journaled when the member's first
   * run starts (invite predates the handle; the dispatch engine appends this
   * update so a reload reattaches the member to its child session).
   */
  readonly childSessionId?: SessionId
}

/** A member left the roster. */
export interface RoomMemberRemovedEvent {
  readonly name: string
}

/**
 * A human @-message: the dispatch record. Pure bookkeeping — the task
 * auto-open, the engine's instruction cursors, and replay. It drives NO chat
 * node: the human's words land as a standard `user/message` event (appended
 * alongside, see RoomService.postMessage) and render as the official user
 * bubble. It never feeds any prompt either — a member's prompt is role
 * instructions + roster + notifications + the dispatch text, never a running
 * log.
 */
export interface RoomDispatchEvent {
  /** Goal work/report correlation, absent for ordinary chat. */
  readonly plan?: { readonly goalId: string; readonly taskId?: string; readonly attemptId?: string }
  /** Fingerprint of the original human request, independent of later roster/role changes. */
  readonly requestSignature?: string
  /** Caller retry identity, persisted before accepting input. */
  readonly id?: string
  readonly targetIds?: readonly string[]
  /**
   * Who sent it: the human, the coordinator, any other member (`member`,
   * free member-to-member messaging), a delivery's report, or a legacy
   * confirmed relay.
   */
  readonly origin?: 'human' | 'coordinator' | 'member' | 'report' | 'relay' | 'help'
  /** A help request from another room (origin `help`): its final reply goes back there. */
  readonly help?: RoomHelpOrigin
  /** The sending member's id (coordinator/member origins). */
  readonly from?: string
  /**
   * `task` (default for member sends): the recipient's final reply is reported
   * back to the sender. `notify`: an FYI, never reported.
   */
  readonly kind?: 'task' | 'notify'
  /**
   * Position in its causal chain: 1 for a human message (or a send outside
   * any room round), the sender's own delivery hop + 1 otherwise; reports
   * count too. A send past the room's hop limit is held for the human.
   */
  readonly hop?: number
  /** The message this one answers (`#m<seq>` of an earlier dispatch). */
  readonly inReplyTo?: number
  /**
   * The sender's own words on what it is waiting for ("三位都打完招呼再一起跟
   * 用户说"): read by the report gate when this delivery's report arrives.
   */
  readonly note?: string
  /**
   * A report the gate HELD: not run as its own round. A native recipient has
   * it in its inbox already; a CLI recipient gets it carried by its next round.
   */
  readonly held?: true
  /** A release round: wakes the recipient for the reports it holds (these dispatch seqs). */
  readonly releases?: readonly number[]
  /**
   * The task (job) this message belongs to: the id of the human message that
   * started it (its `user/message` id), or this dispatch's own `id` for a
   * human dispatch that has no message (an invite's first task).
   */
  readonly task?: string
  /**
   * The delivery during which the sender sent this (`<seq>:<memberId>`), so
   * a member's sub-delegations nest under its own work in the task tree.
   */
  readonly parent?: string
  /** The member id this delivery's outcome is reported to. */
  readonly replyTo?: string
  /** Completion report deduplication key (one source delivery). */
  readonly reportFor?: string
  readonly targets: readonly string[]
  readonly text: string
}

/**
 * A member's final reply, mirrored into the room journal for UI projection
 * and replay. Never re-injected into any prompt: the member's own CLI
 * session (resume chain) holds its working memory.
 */
export interface RoomSpeechEvent {
  /** Partial output from a stopped or failed run; never a completed answer. */
  readonly interrupted?: 'cancelled' | 'failed'
  /** The member this reply was also reported to (the delivery's sender), by name. */
  readonly reportedTo?: string
  readonly member: string
  readonly text: string
  readonly childSessionId?: SessionId
  /** Native admission→settle milliseconds, excluding queue time. */
  readonly durationMs?: number
  /** The run this speech closed (its execution metadata — tokens, model — is keyed by it). */
  readonly runId?: string
  /** The member's closing assistant message in its own session (`childSessionId`): what per-message tools address. */
  readonly messageId?: string
}

/** Observed execution metadata; separate from lifecycle edges to avoid restarting chat nodes. */
export interface RoomExecutionMetadataEvent {
  readonly runId: string
  readonly model?: string
  readonly effort?: string
  readonly tokens?: number
  /** The round's billing breakdown as the harness reported it (disjoint counts, the host's TokenUsage). */
  readonly usage?: RoomRunUsage
}

/** One round's billing breakdown: uncached input, cache read/write and output are disjoint. */
export interface RoomRunUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly reasoningTokens?: number
}

/** A member run's lifecycle edge. */
export interface RoomRunStateEvent {
  readonly childSessionId?: SessionId
  /** The child session's round this run reached (the last turn/start it wrote); terminal edges only, live sessions only. */
  readonly childTurn?: number
  /** Observed round metadata, never a requested-model guess or session total. */
  readonly model?: string
  readonly effort?: string
  readonly tokens?: number
  /** Stable execution identity; legacy journals use startedAt. */
  readonly runId?: string
  readonly member: string
  readonly state: 'running' | 'done' | 'cancelled' | 'failed'
  readonly startedAt: number
  readonly elapsedMs?: number
  /**
   * Why the run failed (terminal `failed` edges only): the engine's caught
   * fault message, surfaced by the client's dim failure row. Optional so old
   * journal events replay fine.
   */
  readonly error?: string
}

/** A relay's lifecycle states (see the design note's notification channel). */
export type RoomRelayState = 'pending' | 'confirmed' | 'dismissed' | 'sent'

/**
 * A member-to-member notification arrived at the room gate (journaled as
 * pending): the family bridge's `receiveMemberMessage` call, or the fallback
 * parse of a reply's trailing `@name <content>` own line. `provenance` is
 * the origin record (the bridge passes the sender's delegation record; the
 * fallback records the speech it was parsed from).
 */
export interface RoomRelayEvent {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly content: string
  readonly provenance?: Record<string, RoomJsonValue>
  /**
   * Why the message waits for the human: the room asks for confirmation of
   * member messages, the chain reached the hop limit, or the room is paused
   * (released automatically on resume). Absent on legacy relays.
   */
  readonly reason?: RoomHoldReason
  /** The dispatch to create once released (absent on legacy relays). */
  readonly intent?: RoomHeldDispatch
}

/** Why a member message is held at the gate. */
export type RoomHoldReason = 'confirm' | 'hop-limit' | 'paused'

/** A held message's would-be dispatch. */
export interface RoomHeldDispatch {
  readonly origin: 'coordinator' | 'member' | 'report' | 'help'
  /** A help request from another room (origin `help`): its final reply goes back there. */
  readonly help?: RoomHelpOrigin
  readonly from?: string
  readonly kind?: 'task' | 'notify'
  readonly hop: number
  readonly inReplyTo?: number
  readonly replyTo?: string
  readonly reportFor?: string
  readonly plan?: { readonly goalId: string }
  readonly note?: string
  readonly task?: string
  readonly parent?: string
}

/**
 * The room's collaboration settings (latest event wins per field). Members
 * message each other freely by default; `confirm` holds every non-coordinator
 * member message for the human. `hopLimit` caps a causal chain (each delivery
 * and report is one hop) before the room stops relaying automatically.
 * `paused` holds every agent-originated message until resumed.
 */
export interface RoomSettingsEvent {
  readonly memberMessages?: 'free' | 'confirm'
  readonly hopLimit?: number
  readonly paused?: boolean
  /**
   * When a report reaches the member waiting on it: `judge` (default) asks
   * the decision model whether to hand it over now or hold it in the
   * recipient's inbox; `each` hands every report over at once.
   */
  readonly reportTiming?: 'judge' | 'each'
  /** Automatic task filing: false = an untagged human message always starts a new task. */
  readonly autoTaskFiling?: boolean
  /** Report timing: the "hand it over now" probability that delivers at once (0.1–0.9). */
  readonly reportThreshold?: number
  /** Report timing: the longest a held report waits before it is handed over anyway, in minutes (1–30). */
  readonly reportWaitMinutes?: number
  /** Cross-session help: minutes an unanswered request waits before its row turns amber (10–120). */
  readonly helpReminderMinutes?: number
}

/** The folded settings with defaults applied. */
export interface RoomSettings {
  readonly memberMessages: 'free' | 'confirm'
  readonly hopLimit: number
  readonly paused: boolean
  readonly reportTiming: 'judge' | 'each'
  readonly autoTaskFiling: boolean
  readonly reportThreshold: number
  readonly reportWaitMinutes: number
  readonly helpReminderMinutes: number
}

/** The room's own decision scenarios (the decision-model table, see decisions.ts). */
export type RoomDecisionScenario = 'task-filing' | 'report-timing'

/** One call to the decision model (typesafe), recorded as it went out and came back. */
export interface RoomDecisionCall {
  /** The model the service answered with (or was asked, on a failure). */
  readonly model: string
  readonly latencyMs?: number
  readonly cached?: boolean
  readonly inputTokens?: number
  readonly outputTokens?: number
  /** The request body's judged parts: the state and the questions, as sent. */
  readonly request: { readonly state: RoomJsonValue; readonly questions: RoomJsonValue }
  /** The answers as they came back. */
  readonly response?: RoomJsonValue
  /** Why the call produced no usable answer (timeout, circuit-open, http …). */
  readonly failure?: { readonly reason: string; readonly detail?: string }
}

/**
 * One decision the room made on its own — by a rule, or by asking the
 * decision model — with what it was about. The timeline shows the outcome;
 * Context Lens lists the ones with a model call as requests.
 */
export interface RoomDecisionEvent {
  readonly id: string
  readonly scenario: RoomDecisionScenario
  /** task-filing: `new` or the task number; report-timing: `now` or `later`. */
  readonly outcome: string
  /** The rule that decided (a fallback after a failed call included); absent = the model decided. */
  readonly rule?: string
  /** The probability the outcome was taken with, when the model decided. */
  readonly probability?: number
  readonly call?: RoomDecisionCall
  /** What it was about: the human message (task-filing) or the report's sender and recipient (report-timing). */
  readonly about: {
    readonly message?: string
    readonly task?: { readonly number: number; readonly title: string }
    readonly from?: string
    readonly to?: string
  }
}

/**
 * Which task a human message belongs to, when it is not a task of its own:
 * the composer's explicit tag (`human`), the coordinator's own call
 * (`coordinator`), or the decision model's suggestion (`model`). The latest
 * link for a message wins; a message with no link starts its own task.
 */
export interface RoomTaskLinkEvent {
  /** The human message's `user/message` id. */
  readonly message: string
  /** The task it belongs to (that task's root message id; its own id = a new task). */
  readonly task: string
  readonly by: 'human' | 'coordinator' | 'model'
  readonly probability?: number
}

/** A human stopped a whole task: its open work was cancelled. */
export interface RoomJobStoppedEvent {
  readonly task: string
}

/** The report gate's verdict on one arrived report (journal record, UI line). */
export interface RoomReportGateEvent {
  /** The report dispatch the verdict is about. */
  readonly dispatchSeq: number
  /** The member the report is for. */
  readonly memberId: string
  /** Its name when the verdict was written (the room line's label). */
  readonly member: string
  readonly verdict: 'deliver' | 'hold' | 'release'
  /**
   * Why: a rule (`failure`, `last`, `question`, `setting`, `unavailable`,
   * `timeout`, `manual`, `carried`) or the model (`model`).
   */
  readonly reason: string
  /** The model's yes-probability for "hand it over now", when asked. */
  readonly probability?: number
}

/**
 * A CLI member's mode tool (a host preset's plugin tool reached through its
 * bridge) needs the human's approval before it runs; the room asks in the
 * conversation instead of the member's own session.
 */
export interface RoomApprovalEvent {
  readonly id: string
  readonly member: string
  readonly memberId: string
  readonly tool: string
  readonly reason?: string
}

/** How a member's tool approval ended. */
export interface RoomApprovalResolvedEvent {
  readonly id: string
  /** `cancelled`: the call ended, or the host restarted, before an answer. */
  readonly outcome: 'allowed-once' | 'rejected' | 'cancelled'
}

/** A member's tool approval still waiting for the human. */
export interface RoomApproval {
  readonly id: string
  readonly member: string
  readonly tool: string
  readonly reason?: string
  readonly time: number
}

/** answerApproval request: the human's answer to a pending approval. */
export interface RoomAnswerApprovalRequest {
  readonly sessionId: SessionId
  readonly id: string
  readonly outcome: 'allowed-once' | 'rejected'
}

/** answerApproval outcome. */
export type RoomAnswerApprovalResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: RoomFailure }

/** One option of a member's question to the human. */
export interface RoomQuestionOption {
  readonly label: string
  readonly description?: string
}

/** One question a member asks the human (the host's ask_user_question shape). */
export interface RoomQuestionItem {
  readonly id: string
  readonly question: string
  readonly header?: string
  readonly options?: readonly RoomQuestionOption[]
  readonly multiSelect?: boolean
}

/** The human's answer to one question: the picked option labels and/or free text. */
export interface RoomQuestionAnswer {
  readonly id: string
  readonly selected: readonly string[]
  readonly custom?: string
}

/**
 * A member asks the human questions through its bridge (`ask_user_question`)
 * instead of writing them into its reply: the room shows them as a card the
 * human answers by picking, and the member's call waits for the answer.
 */
export interface RoomQuestionEvent {
  readonly id: string
  readonly member: string
  readonly memberId: string
  readonly questions: readonly RoomQuestionItem[]
  /** A consent gate (room_help's 允许/不允许): its answer only matters while the call waits, so it is never answered late. */
  readonly consent?: true
}

/** How a member's questions ended. */
export interface RoomQuestionResolvedEvent {
  readonly id: string
  /** `cancelled`: the call ended, timed out, or the host restarted before an answer. */
  readonly outcome: 'answered' | 'cancelled'
  readonly answers?: readonly RoomQuestionAnswer[]
  /** Answered after the card expired: the answers went to the member as a new message instead of its (gone) waiting call. */
  readonly late?: true
}

/** A member's questions still waiting for the human. */
export interface RoomQuestion {
  readonly id: string
  readonly member: string
  readonly questions: readonly RoomQuestionItem[]
  readonly time: number
}

/** answerQuestion request: the human's answers to a pending question card. */
export interface RoomAnswerQuestionRequest {
  readonly sessionId: SessionId
  readonly id: string
  readonly answers: readonly RoomQuestionAnswer[]
}

/** answerQuestion outcome. */
export type RoomAnswerQuestionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: RoomFailure }

/** A relay left the pending state (confirmed, dismissed, or delivered). */
export interface RoomRelayResolvedEvent {
  readonly id: string
  readonly state: 'confirmed' | 'dismissed' | 'sent'
}

/**
 * Legacy: the retired task board (`room/task-*` events) is no longer
 * written; old logs still replay into `RoomState.tasks`, which no view shows.
 * Tasks are now `RoomJob`s, folded from dispatches.
 *
 * Task-board task statuses. `failed` is terminal-from-the-engine (the run
 * settle writes it) but stays human-actionable: the board keeps the row
 * visible until the human dismisses it (closeTask → cancelled) or
 * re-dispatches.
 */
export type RoomTaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled' | 'failed'

/**
 * The room's goal was set (or cleared: an empty text). Log-only; the journal
 * fold keeps the LATEST goal event's text as the current goal (empty/absent =
 * unset). The goal rides the roster section of every member prompt, and the
 * task page shows and edits it.
 */
export interface RoomGoalEvent {
  readonly text: string
}

/**
 * A task entered the board: an @-dispatch opens it `in_progress` (title is
 * the dispatch text, truncated), a human addTask opens it `pending`.
 * `blockedBy` names the MEMBER the task waits on — pure display ("等 ada"):
 * the row renders grey until that member has no open task left. It never
 * triggers any automatic dispatch.
 */
export interface RoomTaskAddedEvent {
  /** Only this delivery may automatically settle this legacy chat task row. */
  readonly deliveryId?: string
  readonly id: string
  readonly member: string
  readonly title: string
  readonly status: 'pending' | 'in_progress'
  readonly blockedBy?: string
}

/**
 * A task changed status (a run settle closes the auto-opened task to the
 * run's own terminal state — done/cancelled/failed; the human manages the
 * rest).
 */
export interface RoomTaskUpdatedEvent {
  readonly id: string
  readonly status: 'in_progress' | 'done' | 'cancelled' | 'failed'
}

/**
 * A task's editable fields changed (the `room_task` tool's `update` action):
 * a title rename and/or a `blockedBy` re-target (`null` clears the wait).
 * Status changes stay on `room/task-updated`; closed tasks take no edits.
 */
export interface RoomTaskEditedEvent {
  readonly id: string
  readonly title?: string
  /** New blocking member; explicit null clears the wait. */
  readonly blockedBy?: string | null
  /** Hand the task to another member's lane (a removal's transfer). */
  readonly member?: string
}

/**
 * Cross-session help: a member of this room asked another session for help.
 * The helper stays in its own session (its own queue, model and context); the
 * room journals the thread and carries messages both ways.
 */
export interface RoomHelpEvent {
  readonly id: string
  /** The asking member's id and name. */
  readonly from: string
  readonly fromName: string
  /**
   * The helper's session. A room target (`room`) routes through that room:
   * to the named `member`, else to its coordinator.
   */
  readonly target: { readonly sessionId: string; readonly title: string; readonly room?: true; readonly member?: string }
  /** The request as the helper reads it. */
  readonly text: string
}

/** An outside session kept on this room's member list (「加入房间成员」): a shortcut for asking it. */
export interface RoomLinkedSession {
  readonly sessionId: string
  readonly title: string
  readonly time: number
}

/** link / unlink / dismiss-hint requests: the room and the outside session. */
export interface RoomHelpLinkRequest {
  readonly sessionId: SessionId
  /** The outside session. */
  readonly target: string
  /** Its title (link only). */
  readonly title?: string
}

/** link / unlink / dismiss-hint outcome. */
export type RoomHelpLinkResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: RoomFailure }

/** Where a help request in this room came from (the asking room's thread). */
export interface RoomHelpOrigin {
  /** The thread id in the asking room. */
  readonly id: string
  readonly room: string
  readonly roomTitle: string
  /** The asking member's name. */
  readonly from: string
}

/** Another room asked this room for help (shown on this room's timeline). */
export interface RoomHelpInEvent extends RoomHelpOrigin {
  /** The member it was handed to (the named one, else the coordinator). */
  readonly member: string
  readonly text: string
  /** `message`: the asker writing again on the thread. */
  readonly op: 'request' | 'message'
  /** Held at the gate (this room is paused) instead of delivered. */
  readonly held?: true
}

/** One message on a help thread after the request. */
export interface RoomHelpMessageEvent {
  readonly help: string
  /**
   * `question`: the helper asks the asker. `reply`: the helper's answer (its
   * final reply plus a short handoff). `message`: the asker writes again
   * (an answer to a question, or a follow-up).
   */
  readonly kind: 'question' | 'reply' | 'message'
  readonly text: string
  /** The helper's short handoff note on a reply. */
  readonly handoff?: string
  /** A reply taken from the helper's last answer because it never called the reply tool. */
  readonly fallback?: true
}

/** Where a help thread stands. */
export type RoomHelpStatus = 'queued' | 'running' | 'asking' | 'replied' | 'failed'

/** A help thread changed state. */
export interface RoomHelpStateEvent {
  readonly help: string
  readonly state: RoomHelpStatus
  readonly error?: string
}

/** A help thread, folded from its events. */
export interface RoomHelp extends RoomHelpEvent {
  readonly state: RoomHelpStatus
  /** When the thread entered its current state (epoch ms). */
  readonly since: number
  readonly error?: string
  readonly messages: readonly (RoomHelpMessageEvent & { readonly time: number })[]
  readonly time: number
}

declare module '@deepseek-ai/dsh-session/types' {
  // External readers: Context Lens reads room/dispatch (origin/text/targets/
  // targetIds), room/run-state (runId/member/state/startedAt/elapsedMs/
  // childSessionId/childTurn), room/coordinator (memberId/previousMemberId)
  // and room/member-added (id/name) as its room-turn correlation interface —
  // rename or reshape them with a heads-up.
  interface SessionEventMap {
    /**
     * Room identity marker: the session carrying this log-only event is a
     * room. Log-only (no surface intent), so it never reaches the model.
     */
    'room/created': RoomCreatedEvent
    /** Roster mutation: a member joined. */
    'room/member-added': RoomMemberAddedEvent
    /** Roster mutation: a member's editable fields changed. */
    'room/member-updated': RoomMemberUpdatedEvent
    /** Roster mutation: a member left. */
    'room/member-removed': RoomMemberRemovedEvent
    /** Dispatch record: a human @-message (bookkeeping: task auto-open, dispatch cursors). */
    'room/dispatch': RoomDispatchEvent
    /** Member speech mirror (UI projection; never re-injected into prompts). */
    'room/speech': RoomSpeechEvent
    /** Member run lifecycle. */
    'room/run-state': RoomRunStateEvent
    /** Log-only observed metadata for a single execution. */
    'room/execution-metadata': RoomExecutionMetadataEvent
    /** Notification gate: a member-to-member relay arrived (pending). */
    'room/relay': RoomRelayEvent
    /** Notification gate: a relay was confirmed, dismissed, or delivered. */
    'room/relay-resolved': RoomRelayResolvedEvent
    /** A CLI member's mode tool waits for the human's approval. */
    'room/approval': RoomApprovalEvent
    /** That approval was answered, or expired with its call. */
    'room/approval-resolved': RoomApprovalResolvedEvent
    /** A CLI member asks the human questions (a pick-to-answer card). */
    'room/question': RoomQuestionEvent
    /** Those questions were answered, or expired with the call. */
    'room/question-resolved': RoomQuestionResolvedEvent
    /** Task board: a task was added. */
    'room/task-added': RoomTaskAddedEvent
    /** Task board: a task changed status. */
    'room/task-updated': RoomTaskUpdatedEvent
    /** Task board: a task's title/blockedBy was edited (the room_task tool's update). */
    'room/task-edited': RoomTaskEditedEvent
    /** Goal: the room's goal was set (or cleared). */
    'room/goal': RoomGoalEvent
    /** Collaboration settings changed. */
    'room/settings': RoomSettingsEvent
    /** The report gate decided on an arrived report. */
    'room/report-gate': RoomReportGateEvent
    /** The room decided something on its own (a rule, or the decision model). */
    'room/decision': RoomDecisionEvent
    /** A human message was attributed to a task. */
    'room/task-link': RoomTaskLinkEvent
    /** A human stopped a task. */
    'room/job-stopped': RoomJobStoppedEvent
    /** Cross-session help: a member asked another session. */
    'room/help': RoomHelpEvent
    /** A message on a help thread (the helper's question or reply, the asker's follow-up). */
    'room/help-message': RoomHelpMessageEvent
    /** A help thread changed state. */
    'room/help-state': RoomHelpStateEvent
    /** Another room asked this room for help. */
    'room/help-in': RoomHelpInEvent
    /** An outside session joined this room's member list (a shortcut for asking it). */
    'room/help-link': { readonly sessionId: string; readonly title: string }
    /** It left the list (its own session is untouched). */
    'room/help-unlink': { readonly sessionId: string }
    /** The human dismissed the 加入房间成员 hint for a session. */
    'room/help-nudge-dismissed': { readonly sessionId: string }
  }
}

/** One roster member, as folded by the journal replay. */
export interface RoomMember {
  readonly id?: string
  readonly name: string
  readonly kind: 'main-agent' | 'cli' | 'native'
  readonly provider?: string
  readonly instructions?: string
  /** Short public role shown to the other members (see {@link RoomMemberAddedEvent.role}). */
  readonly role?: string
  /** Native members: the host agent preset (see {@link RoomMemberAddedEvent.preset}). */
  readonly preset?: string
  readonly invitedBy: 'human' | 'agent'
  /** Member-level working directory (roster record; not yet passed to the facade). */
  readonly cwd?: string
  /** The member's intended model (roster record; the facade start's `model` option on the first dispatch). */
  readonly model?: string
  /** The member's intended reasoning effort (roster record; the facade start's `effort` option on the first dispatch). */
  readonly effort?: string
  readonly childSessionId?: SessionId
}

/** One notification relay, as folded by the journal replay. */
export interface RoomRelay {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly content: string
  readonly provenance?: Record<string, RoomJsonValue>
  readonly state: RoomRelayState
  readonly reason?: RoomHoldReason
  readonly intent?: RoomHeldDispatch
}

/** One task-board task, as folded by the journal replay. */
export interface RoomTask {
  /** Only this delivery may automatically settle this legacy chat task row. */
  readonly deliveryId?: string
  readonly id: string
  readonly member: string
  readonly title: string
  readonly status: RoomTaskStatus
  /** The member this task waits on (display only; never dispatches anything). */
  readonly blockedBy?: string
  /**
   * Epoch ms of the task's latest journal event (add or status update): the
   * goal card's "latest advance" ordering and the row's relative time.
   */
  readonly updatedAt: number
}

/** A member's current run state, as folded by the journal replay. */
export interface RoomMemberRun {
  /** Stable execution identity; legacy journals use startedAt. */
  readonly runId?: string
  readonly member: string
  readonly state: 'running' | 'done' | 'cancelled' | 'failed'
  readonly startedAt: number
  readonly elapsedMs?: number
  /** Why the run failed (failed edges only), when the edge carried one. */
  readonly error?: string
}

/** Durable per-execution history; unlike runs this retains earlier member rounds. */
export interface RoomExecution extends RoomMemberRun {
  readonly id: string
  readonly memberId?: string
  readonly childSessionId?: SessionId
  /** The child session round the run reached, as recorded by its terminal run-state edge. */
  readonly childTurn?: number
  readonly provider?: string
  readonly model?: string
  readonly effort?: string
  readonly tokens?: number
  readonly usage?: RoomRunUsage
}

/**
 * The replayed room state: roster, notification relays, the task board, run
 * states, and the current goal. There is deliberately NO blackboard/log
 * projection here — members never consume the room's running log (see the
 * design note).
 */
export interface RoomState {
  readonly executions?: readonly RoomExecution[]
  readonly plan?: Omit<RoomPlan, 'requests'>
  readonly deliveries?: readonly RoomDelivery[]
  readonly coordinator?: RoomCoordinatorEvent
  readonly members: readonly RoomMember[]
  readonly relays: readonly RoomRelay[]
  /** Members' tool approvals still waiting for the human. */
  readonly approvals?: readonly RoomApproval[]
  /** Members' questions still waiting for the human. */
  readonly questions?: readonly RoomQuestion[]
  readonly tasks: readonly RoomTask[]
  readonly runs: readonly RoomMemberRun[]
  /** The current goal text (the latest `room/goal` event), undefined when unset. */
  readonly goal?: string
  /** Seq of the newest member speech addressed to the room (no `reportedTo`): the reply the human is reading, shown unfolded. */
  readonly latestReplySeq?: number
  /** Seq of the newest member speech of any kind: its action row stays shown, older rows reveal on hover. */
  readonly latestSpeechSeq?: number
  /** Collaboration settings (defaults when never set). */
  readonly settings?: RoomSettings
  /** Tasks, newest first (absent in rooms that never dispatched work). */
  readonly jobs?: readonly RoomJob[]
  /** Cross-session help threads this room opened (absent when none). */
  readonly helps?: readonly RoomHelp[]
  /** Outside sessions kept on the member list (absent when none). */
  readonly linked?: readonly RoomLinkedSession[]
  /** Sessions whose 加入房间成员 hint was dismissed (absent when none). */
  readonly helpNudgesDismissed?: readonly string[]
}

/**
 * The goal progress pair: done tasks over the COUNTABLE total — cancelled
 * and failed tasks leave the denominator (a cancelled task was never part of
 * the plan; a failed one never advanced it).
 */
export interface RoomTaskProgress {
  readonly done: number
  readonly total: number
}

/** Closed failure vocabulary of the room Remote surface. */
export type RoomFailure =
  | { readonly code: 'request-conflict' }
  | { readonly code: 'member-cwd-bound' }
  | { readonly code: 'not-coordinator' }
  | { readonly code: 'delivery-not-uncertain' }
  | { readonly code: 'plan-reconciliation-required' }
  | { readonly code: 'coordinator-busy' }
  | { readonly code: 'coordinator-not-ready'; readonly message: string }
  | { readonly code: 'coordinator-conflict' }
  | { readonly code: 'active-coordinator' }
  | { readonly code: 'configuration-owned-by-core' }
  | { readonly code: 'session-not-found' }
  | { readonly code: 'not-a-room' }
  | { readonly code: 'invalid-name' }
  | { readonly code: 'duplicate-name' }
  | { readonly code: 'empty-provider' }
  | { readonly code: 'member-not-found' }
  | { readonly code: 'empty-text' }
  /** The public role is longer than 30 characters. */
  | { readonly code: 'role-too-long' }
  /** A settings value is out of range (hop limit 2–50). */
  | { readonly code: 'invalid-settings' }
  /** A member cannot message itself. */
  | { readonly code: 'self-message' }
  /** The `task` argument names no task of this room. */
  | { readonly code: 'unknown-task' }
  /** The preset is not one the host declares (carries the declared ids). */
  | { readonly code: 'unknown-preset'; readonly preset: string; readonly available: readonly string[] }
  | { readonly code: 'nothing-to-update' }
  | { readonly code: 'local-agent-unavailable' }
  /**
   * The provider is not any harness's delegation provider (the classic slip:
   * the harness name `kimi` instead of the delegation provider `kimi-cli`).
   * Carries the legal set so the caller (the room_invite tool's model caller,
   * the dialog) can self-correct.
   */
  | { readonly code: 'unknown-provider'; readonly provider: string; readonly available: readonly string[] }
  | { readonly code: 'unknown-targets'; readonly names: readonly string[] }
  /** postMessage without any leading @-mention (bare messages belong to the official submit path). */
  | { readonly code: 'no-targets' }
  | { readonly code: 'relay-not-found' }
  /** The relay exists but already left the pending state. */
  | { readonly code: 'relay-not-pending' }
  | { readonly code: 'approval-not-pending' }
  | { readonly code: 'question-not-pending' }
  /** The main agent is the room itself: it cannot be renamed. */
  | { readonly code: 'main-member' }
  | { readonly code: 'task-not-found' }
  /** The task exists but is already closed (done/cancelled). */
  | { readonly code: 'task-closed' }
  /** A cold room's agent resume failed (persistence or preset composition). */
  | { readonly code: 'resume-failed'; readonly message: string }

/**
 * The family bridge's gate entry, verbatim-frozen contract
 * (`proposals/closed/2026-08-19-local-agent-member-channel.md`): the bridge
 * probes `ctx.get('room')` and duck-type-calls this method. Phase 1's gate is
 * always human confirmation, so the receipt is always 'pending-confirm';
 * 'sent'/'busy' belong to the phase-2 auto gate.
 */
export interface RoomMemberMessage {
  readonly from: string
  readonly to: string
  readonly content: string
  readonly parentSessionId: SessionId
  readonly provenance?: Record<string, RoomJsonValue>
  /** `task` (default): the reply is reported back; `notify`: FYI only. */
  readonly kind?: 'task' | 'notify'
  /** `m<seq>` (or the bare seq) of the message being answered. */
  readonly inReplyTo?: string
  /** What the sender waits for before acting on the result. */
  readonly note?: string
  /** `new` or a task number (see RoomMessageRequest.task). */
  readonly task?: string
}

/**
 * The gate receipt handed back to the sending member through the bridge,
 * quoted verbatim to the model: `sent #m<seq>…` or `pending-confirm …` with a
 * short explanation (the bare legacy words remain valid).
 */
export type RoomMemberMessageReceipt = 'sent' | 'pending-confirm' | 'busy' | `sent ${string}` | `pending-confirm ${string}`

/** isRoom probe: does this session carry the room marker? */
export interface RoomIsRoomRequest {
  /** Session to probe. */
  readonly sessionId: SessionId
}

/** getState request. */
export interface RoomGetStateRequest {
  /** Room session to replay. */
  readonly sessionId: SessionId
}

/** getState outcome: the replayed state or a rejection. */
export type RoomGetStateResult =
  | { readonly ok: true; readonly value: RoomState }
  | { readonly ok: false; readonly error: RoomFailure }

/** invite request: add a CLI member to the roster. */
export interface RoomInviteRequest {
  /** Room session. */
  readonly sessionId: SessionId
  /**
   * `cli` (default): an external CLI through the local-agent family.
   * `native`: a DSH child agent in this host process, composing `preset`.
   */
  readonly kind?: 'cli' | 'native'
  /**
   * The member's mode: the host agent preset id. A native member composes it
   * (omitted = the host default); a CLI member reaches its plugin tools
   * through the bridge (omitted = no mode).
   */
  readonly preset?: string
  /** With no `preset`: take the room session's own mode (the coordinator's invite default). */
  readonly inheritPreset?: boolean
  /** CLI provider id (non-blank). */
  readonly provider: string
  /** Addressing/display name: unique in the room, no whitespace, no `@`. */
  readonly name: string
  /** Role instructions, prepended to the member's first dispatch. */
  readonly instructions?: string
  /** Short public role (≤ 30 chars); blank/omitted = none. */
  readonly role?: string
  /**
   * Member-level working directory (empty/omitted = inherits the room
   * session's cwd). Recorded on the roster; not yet passed to the delegation
   * facade (family need R2 pending).
   */
  readonly cwd?: string
  /** Optional first task, dispatched to the member as soon as it joins. */
  readonly firstTask?: string
  /** What the inviter waits for when the first task reports (see RoomDispatchEvent.note). */
  readonly note?: string
  /**
   * The delegation's model (blank/omitted = follow the harness default).
   * Applies to local-agent harness providers only: it lands as the facade
   * `start` call's `model` option, bound at spawn for exec and live alike.
   */
  readonly model?: string
  /**
   * The delegation's reasoning effort (blank/omitted = follow the harness
   * default): the facade `start` call's `effort` option, bound at spawn
   * alongside the model.
   */
  readonly effort?: string
}

/** invite receipt. */
export interface RoomInvitation {
  /** The accepted member name. */
  readonly name: string
  /** True when a first task was supplied and dispatched with the invitation. */
  readonly pendingFirstTask: boolean
  /** The member's mode (preset id), when it has one. */
  readonly preset?: string
}

/** invite outcome. */
export type RoomInviteResult =
  | { readonly ok: true; readonly value: RoomInvitation }
  | { readonly ok: false; readonly error: RoomFailure }

/** updateMember request: edit a member's name, role instructions, cwd, or model. */
export interface RoomUpdateMemberRequest {
  /** Room session. */
  readonly sessionId: SessionId
  /** Member to update (its CURRENT name). */
  readonly name: string
  /** Rename: the new @-addressing name (unique, no whitespace, no "@"). */
  readonly rename?: string
  /** New role instructions; null (or a blank string) CLEARS them. */
  readonly instructions?: string | null
  /** New public role; null (or a blank string) CLEARS it. */
  readonly role?: string | null
  /** New member-level cwd; null (or a blank string) CLEARS the override back to inheriting the room cwd. */
  readonly cwd?: string | null
  /**
   * New intended model (roster-recorded; the first dispatch binds it as the
   * facade start's `model` option); null (or a blank string) CLEARS it back
   * to following the harness default.
   */
  readonly model?: string | null
  /**
   * New intended reasoning effort (roster-recorded, bound like the model on
   * the first dispatch); null (or a blank string) CLEARS it back to following
   * the harness default.
   */
  readonly effort?: string | null
}

/** updateMember outcome. */
export type RoomUpdateMemberResult =
  | { readonly ok: true; readonly value: { readonly name: string } }
  | { readonly ok: false; readonly error: RoomFailure }

/** removeMember request. */
export interface RoomRemoveMemberRequest {
  /** Room session. */
  readonly sessionId: SessionId
  /** Member to remove. */
  readonly name: string
}

/** What a removal actually did, for the undo toast and the room record. */
export interface RoomRemoval {
  readonly name: string
  /** True when a running round was stopped first. */
  readonly stopped: boolean
  /** Queued messages that will never be delivered. */
  readonly cancelledDeliveries: number
  /** Members that were waiting for a report and were told instead. */
  readonly notified: readonly string[]
}

/** restoreMember request: undo a removal (the member rejoins with its own session). */
export interface RoomRestoreMemberRequest {
  readonly sessionId: SessionId
  readonly name: string
}

/** removeMember outcome. */
export type RoomRemoveMemberResult =
  | { readonly ok: true; readonly value: RoomRemoval }
  | { readonly ok: false; readonly error: RoomFailure }

/** restoreMember outcome. */
export type RoomRestoreMemberResult =
  | { readonly ok: true; readonly value: { readonly name: string } }
  | { readonly ok: false; readonly error: RoomFailure }

/** postMessage request: a human @-message into the room. */
/** setTaskHint request: the composer's task tag for the human's next message. */
export interface RoomSetTaskHintRequest {
  readonly sessionId: SessionId
  /** `new`, a task root id, or null to clear. */
  readonly task: string | null
}

/** stopJob request: stop every open delivery of one task. */
export interface RoomStopJobRequest {
  readonly sessionId: SessionId
  /** The task's root id. */
  readonly task: string
}

/** stopJob outcome. */
export type RoomStopJobResult =
  | { readonly ok: true; readonly value: { readonly stopped: number } }
  | { readonly ok: false; readonly error: RoomFailure }

export interface RoomPostMessageRequest {
  readonly requestId?: string
  /** Room session. */
  readonly sessionId: SessionId
  /** Raw composer text: leading `@name` tokens address members. */
  readonly text: string
  /**
   * Menu-picked addressees (the room composer's mention menu records a pick
   * as explicit addressing even when the `@name` sits mid-sentence). Unioned
   * with the parsed leading tokens and validated against the roster the same
   * way; the text itself is dispatched verbatim either way.
   */
  readonly targets?: readonly string[]
  /** The composer's task tag: `new` or a task root id (see RoomSetTaskHintRequest). */
  readonly task?: string
}

/** What the postMessage parser made of the raw text. */
export interface RoomPostParsed {
  /** Addressed members (never empty — a bare message is a `no-targets` rejection). */
  readonly targets: readonly string[]
  /** The message body with the leading @-tokens stripped. */
  readonly text: string
}

/** postMessage receipt. */
export interface RoomPostReceipt {
  readonly parsed: RoomPostParsed
  /** Seq of the appended journal event. */
  readonly seq: number
}

/**
 * messageMember request (host-only — the `room_message` tool's path; NOT a
 * Remote): dispatch one message to one member. Identical dispatch semantics
 * to a human's `@member text` minus the user/message bubble (the caller is
 * the main agent, not the human).
 */
export interface RoomMessageRequest {
  /** Room session. */
  readonly sessionId: SessionId
  /** The addressee's roster name. */
  readonly member: string
  /** The message text. */
  readonly text: string
  /** `task` (default): the reply is reported back to the sender; `notify`: FYI only. */
  readonly kind?: 'task' | 'notify'
  /** `m<seq>` (or the bare seq) of the message being answered. */
  readonly inReplyTo?: string
  /** What the sender is waiting for, for the report gate (see RoomDispatchEvent.note). */
  readonly note?: string
  /**
   * Which task this belongs to: `new`, or a task number (「任务 N」). From the
   * room's own agent answering the human, it also re-files that human message.
   */
  readonly task?: string
}

/** What happened to one member message. */
export interface RoomMessageReceipt {
  readonly member: string
  /** `m<seq>`: the message id the report will cite (absent while held). */
  readonly messageId?: string
  /** Set when the message waits for the human instead of being delivered. */
  readonly held?: RoomHoldReason
}

/** messageMember outcome. */
export type RoomMessageResult =
  | { readonly ok: true; readonly value: RoomMessageReceipt }
  | { readonly ok: false; readonly error: RoomFailure }

/** releaseReports request: hand a member its held reports now. */
export interface RoomReleaseReportsRequest {
  readonly sessionId: SessionId
  readonly name: string
}

/** releaseReports outcome: whether anything was held. */
export type RoomReleaseReportsResult =
  | { readonly ok: true; readonly value: { readonly released: boolean } }
  | { readonly ok: false; readonly error: RoomFailure }

/** setSettings request: change any subset of the collaboration settings. */
export interface RoomSetSettingsRequest {
  readonly sessionId: SessionId
  readonly reportTiming?: 'judge' | 'each'
  readonly autoTaskFiling?: boolean
  readonly reportThreshold?: number
  readonly reportWaitMinutes?: number
  /** 10–120, in steps of 10. */
  readonly helpReminderMinutes?: number
  readonly memberMessages?: 'free' | 'confirm'
  /** 2–50. */
  readonly hopLimit?: number
  readonly paused?: boolean
}

/** setSettings outcome: the folded settings after the change. */
export type RoomSetSettingsResult =
  | { readonly ok: true; readonly value: RoomSettings }
  | { readonly ok: false; readonly error: RoomFailure }

/** postMessage outcome. */
export type RoomPostMessageResult =
  | { readonly ok: true; readonly value: RoomPostReceipt }
  | { readonly ok: false; readonly error: RoomFailure }

/** cancel request: interrupt a member's in-flight run. */
export interface RoomCancelRequest {
  /** Optional fencing for an execution card; a stale card must never stop a successor. */
  readonly expectedRunId?: string
  readonly expectedStartedAt?: number
  /** Room session. */
  readonly sessionId: SessionId
  /** Member whose run should be cancelled. */
  readonly name: string
}

/** cancel receipt. */
export interface RoomCancellation {
  /** True when an in-flight run was found and cancelled. */
  readonly cancelled: boolean
}

/** cancel outcome. */
export type RoomCancelResult =
  | { readonly ok: true; readonly value: RoomCancellation }
  | { readonly ok: false; readonly error: RoomFailure }

/** confirmRelay/dismissRelay request: resolve a pending notification relay. */
export interface RoomRelayResolveRequest {
  /** Room session. */
  readonly sessionId: SessionId
  /** The relay to resolve. */
  readonly relayId: string
}

/** confirmRelay/dismissRelay outcome. */
export type RoomRelayResolveResult =
  | { readonly ok: true; readonly value: { readonly relayId: string } }
  | { readonly ok: false; readonly error: RoomFailure }

/** setGoal request: set (or, with a blank text, clear) the room's goal. */
export interface RoomSetGoalRequest {
  /** Room session. */
  readonly sessionId: SessionId
  /** Goal text; blank clears the goal. */
  readonly text: string
}

/** setGoal outcome. */
export type RoomSetGoalResult =
  | { readonly ok: true; readonly value: { readonly goal?: string } }
  | { readonly ok: false; readonly error: RoomFailure }

/** listProviders request. */
export interface RoomListProvidersRequest {
  /** The session the invite is for: the result then carries its mode (`sessionPreset`). */
  readonly sessionId?: SessionId
}

/** One invitable CLI provider. */
export interface RoomProviderInfo {
  /** The provider id invite/dispatch uses (the harness's delegationProvider). */
  readonly provider: string
  readonly displayName: string
  /**
   * The roster harness name — the lookup key for the localAgentGateway
   * `harnessModel` read (the invite dialog's model picker). Absent only on
   * a pre-model-broker family core; the dialog then serves a plain text input.
   */
  readonly harness?: string
  /** Whether the harness's scoped home holds usable credentials. */
  readonly authenticated: boolean
}

/** listProviders result: the facade verdict plus the roster. */
export interface RoomProviderList {
  /** False when the local-agent delegation facade is absent (CLI members undispatchable). */
  readonly localAgentAvailable: boolean
  readonly providers: readonly RoomProviderInfo[]
  /**
   * The host's agent presets a native DSH member may compose; absent when
   * the composition mounts no preset registry (native members then run the
   * plain composition).
   */
  readonly presets?: readonly RoomPresetInfo[]
  /** The requested session's own mode (preset id), when known: the dialog's default mode. */
  readonly sessionPreset?: string
}

/** One host agent preset, as the invite dialog lists it. */
export interface RoomPresetInfo {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly isDefault: boolean
  /** Why the preset cannot be composed right now. */
  readonly broken?: string
}

/** Durable role change. Handoff is bounded context, never native history migration. */
export interface RoomCoordinatorEvent {
  readonly version: 1
  readonly memberId: string
  readonly revision: number
  readonly previousMemberId: string
  readonly handoff: string
}

export interface RoomSetCoordinatorRequest {
  readonly sessionId: SessionId
  readonly memberId: string
  readonly expectedRevision: number
}
export type RoomSetCoordinatorResult =
  | { readonly ok: true; readonly value: RoomCoordinatorEvent }
  | { readonly ok: false; readonly error: RoomFailure }

/** A dispatch target's durable lifecycle. An uncertain crashed run is never replayed. */
export interface RoomDeliveryStateEvent {
  readonly id: string
  readonly dispatchSeq: number
  readonly memberId: string
  readonly state: 'running' | 'done' | 'cancelled' | 'failed' | 'uncertain'
  readonly text?: string
  readonly error?: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'room/plan-state': RoomPlan
    'room/coordinator': RoomCoordinatorEvent
    'room/delivery-state': RoomDeliveryStateEvent
  }
}

export interface RoomDelivery {
  readonly id: string
  readonly dispatchSeq: number
  readonly memberId: string
  /** `held`: a report the gate keeps for a later round (never run on its own). */
  readonly status: 'queued' | 'held' | RoomDeliveryStateEvent['state']
  readonly origin: NonNullable<RoomDispatchEvent['origin']>
  /** The member id this delivery's outcome is reported to, when any. */
  readonly replyTo?: string
  /** The sending member's id (coordinator/member origins). */
  readonly from?: string
  /** `task` or `notify` (member sends); absent on human and legacy dispatches. */
  readonly kind?: 'task' | 'notify'
  readonly text: string
  readonly error?: string
  readonly plan?: RoomDispatchEvent['plan']
  /** The task this delivery belongs to (see RoomDispatchEvent.task). */
  readonly task?: string
  /** The sender's own delivery this was sent from (the task tree's parent). */
  readonly parent?: string
  /** Epoch ms: dispatched, admitted (first running edge), settled. */
  readonly queuedAt: number
  readonly startedAt?: number
  readonly endedAt?: number
  /** Epoch ms the report gate held this report, and released it. */
  readonly heldAt?: number
  readonly releasedAt?: number
}

/**
 * One task: a human message that led to work (at least one delivery), the
 * follow-up messages attributed to it, and everything that work spawned.
 */
export interface RoomJob {
  /** Root message id (or the root human dispatch's id). */
  readonly id: string
  /** 1-based ordinal in the room, for 「任务 N」 and the coordinator's `task` argument. */
  readonly number: number
  readonly title: string
  readonly messages: readonly { readonly id: string; readonly time: number; readonly text: string; readonly by?: RoomTaskLinkEvent['by']; readonly probability?: number }[]
  readonly status: 'running' | 'attention' | 'done' | 'stopped'
  readonly startedAt: number
  /** Last settlement, when nothing is open any more. */
  readonly endedAt?: number
  /** Delivery ids, in dispatch order. */
  readonly deliveries: readonly string[]
  /** Member ids that took part. */
  readonly members: readonly string[]
  /** The formal goal (room_plan) this task's work belongs to, when any. */
  readonly goalId?: string
}
export interface RoomReconcileDeliveryRequest {
  readonly sessionId: SessionId
  readonly deliveryId: string
  readonly outcome: 'done' | 'cancelled'
  readonly evidence: string
}
export type RoomReconcileDeliveryResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: RoomFailure }

export interface RoomPrepareMemberRequest {
  readonly sessionId: SessionId
  readonly name: string
}
export type RoomPrepareMemberResult =
  | { readonly ok: true; readonly value: { readonly childSessionId: string } }
  | { readonly ok: false; readonly error: RoomFailure }
