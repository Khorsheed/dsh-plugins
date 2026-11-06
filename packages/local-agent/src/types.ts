/**
 * Local-agent family type vocabulary, exported through the `./types` subpath
 * so Typert Remote boundary types resolve from a public non-root subpath
 * (the wire-schema generator's requirement for {@link LocalAgentGateway}
 * method signatures).
 * @module @khorsheed/dsh-local-agent/types
 */

import type { AssistantStreamRecord, ContentBlock, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import type { LocalAgentToolTiming } from './tool-timing.ts'

export { localAgentToolTimingMeta } from './tool-timing.ts'
export type { LocalAgentToolTiming } from './tool-timing.ts'
export { localAgentStreamRecords } from './model-stream.ts'
export type { LocalAgentModelBlock } from './model-stream.ts'

/** Read-only model timing reconstructed from one member's original CLI records. */
export interface LocalAgentMemberModelTiming {
  /** `${turn}:${step}` → the request's native model stream. */
  streams: Record<string, AssistantStreamRecord[]>
  /** `${turn}:${step}` → request dispatch, when the original records preserve it. */
  requestStarts?: Record<string, number>
  /** Tool call id → its actual execution interval. */
  toolTimings: Record<string, LocalAgentToolTiming>
}

/** Optional provider-owned reader for historical model and tool timing. */
export interface LocalAgentTimingAdapter {
  read(homeDir: string, cliSessionId: string): Promise<LocalAgentMemberModelTiming | undefined>
}

/** In-flight text item, identified by the durable turn/step coordinate. */
export interface LocalAgentStreamItem {
  id: string
  turn: number
  step: number
  kind: 'think' | 'text'
  text: string
  revision: number
  receivedAt: number
}

/** Reconnection starts with a baseline; subsequent updates carry suffixes or explicit replacements. */
export interface LocalAgentStreamFrame {
  baseline: boolean
  updates: readonly (LocalAgentStreamItem & { append: boolean })[]
  removed: readonly string[]
}

/** One browser connection multiplexes every currently rendered member surface. */
export interface LocalAgentMemberFeedRequest {
  memberId: string
  channel: 'configuration' | 'directory' | 'output'
}

export type LocalAgentMemberFeedEvent =
  | { memberId: string; channel: 'configuration'; value: LocalAgentMemberControlState }
  | { memberId: string; channel: 'directory'; value: LocalAgentModelDirectory }
  | { memberId: string; channel: 'output'; value: LocalAgentStreamFrame }
  | { memberId: string; channel: 'error'; source: 'configuration' | 'directory' | 'output'; message: string }

/** Log-only recovery checkpoint; never injected into a model's conversation. */
export interface LocalAgentStreamCheckpoint extends Omit<LocalAgentStreamItem, 'revision'> {
  sessionId: string
  opening?: boolean
  /** Final native message has replaced this subitem presentation. */
  closed?: boolean
  append: boolean
}

/** The member command that compacts a member's context instead of prompting it. */
export const COMPACT_COMMAND = '/compact'

/**
 * The single definition of "this member input is `/compact`": the command
 * alone on the line (trailing text would be a prompt that merely starts
 * with it). Room and Context Lens cannot import the core at runtime (room
 * takes it as an optional peer, lens has no dependency at all), so each
 * keeps a one-line mirror pinned to this function by a contract test (room
 * `tests/lens-contract.host.spec.ts`, whose fixture lens replays).
 * @param text - one member input.
 * @returns whether it asks for a compaction.
 */
export function isCompactCommand(text: string): boolean {
  return text.trim() === COMPACT_COMMAND
}

/**
 * The brand property of a retryable native-start failure (see
 * {@link LocalAgentRetryableStartError}). A plain property, not a class
 * check, so a provider bundled against another copy of the core (or one that
 * cannot import it) can still set it.
 */
export const RETRYABLE_START_FAILURE = 'localAgentRetryableStart'

/**
 * A provider's native start failed BEFORE any prompt left for the model, for
 * a reason that clears on its own (a stale lock left by a killed process, a
 * resume that raced a shutdown). Thrown from the provider's round start (the
 * function {@link LocalAgentHarness} hands the core, before it returns the
 * run) or from `prepareMember`.
 *
 * Contract: the core then treats the failure like a refused admission — the
 * member's configuration shows failed with this message, and the member's
 * NEXT admission (its next message, a room dispatch, 立即载入) reconciles and
 * retries the start once, instead of waiting for the user's 对账并重试. The
 * failed round itself is never re-run. Throw it ONLY when nothing paid can
 * have started: a failure after the prompt was sent, or one whose effect is
 * unknown, must stay a plain `Error` (it waits for the user). A failure
 * thrown after the run was returned (from `run.result`) is never retried.
 * `message` is shown to the user after 「上次启动没有成功：」, so write it
 * as plain language, without protocol words.
 */
export class LocalAgentRetryableStartError extends Error {
  readonly localAgentRetryableStart = true as const
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options)
    this.name = 'LocalAgentRetryableStartError'
  }
}

/**
 * The second accepted mark: a provider error that states the failure
 * happened before any prompt went out (`beforePrompt === true`, e.g. Kimi's
 * `KimiSessionOccupiedError`). Nothing paid can have started, so retrying it
 * at the next admission is safe whether or not the cause has cleared.
 */
export const BEFORE_PROMPT_FAILURE = 'beforePrompt'

/**
 * Whether a native-start failure is marked safe to retry: the error itself or
 * one in its `cause` chain (a core wrapper keeps the provider's verdict)
 * carries {@link RETRYABLE_START_FAILURE} `=== true` or
 * {@link BEFORE_PROMPT_FAILURE} `=== true`.
 * @param error - what the start threw.
 * @returns whether the next admission may retry it automatically.
 */
export function isRetryableStartFailure(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const marks = current as Record<string, unknown>
    if (marks[RETRYABLE_START_FAILURE] === true || marks[BEFORE_PROMPT_FAILURE] === true) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/**
 * One context compaction of a CLI member, in its own session: the CLI
 * replaced its history before `boundarySeq` with a summary. Display and
 * accounting only — never the host's own `compaction/*` events, whose
 * surface replacement must not run on a mirrored CLI log.
 */
export interface LocalAgentCompactionEvent {
  /** `manual`: /compact or the reminder button; `auto`: the CLI's own. */
  source: 'manual' | 'auto'
  outcome: 'completed' | 'failed' | 'cancelled'
  /** The delegation provider (`kimi-cli`, `codex-local`, …). */
  provider: string
  model?: string
  /**
   * Context occupancy before and after, as the CLI reported it. A SIZE of the
   * context, never spend: readers must not add these to, or show them as,
   * usage — the compaction call's spend is `usage` alone.
   */
  beforeTokens?: number
  afterTokens?: number
  contextWindow?: number
  /** The compaction call's own spend (never a round's); the only place it is recorded. */
  usage?: TokenUsage
  /** The CLI's summary text, when it gives one (Kimi does, Codex does not). */
  summary?: string
  /** The text the CLI puts in its context in place of the history, when it differs from `summary` (Kimi wraps it). */
  contextSummary?: string
  /** User messages the CLI kept verbatim across the compaction (Kimi keeps them; the rest becomes the summary). */
  keptUserMessages?: number
  error?: string
  startedAt: number
  endedAt: number
  /** Every message before this seq is replaced by the summary in later requests. */
  boundarySeq: number
  /**
   * What the source does not report about this compaction, marked when it is
   * written (never inferred later from an absent field):
   * - `usage`: the compaction call's spend;
   * - `before-after`: the context sizes before and after;
   * - `summary`: the summary text.
   *
   * The core writes the event itself, with all three, for a `/compact`
   * execution whose provider wrote none (Claude Code, DSH): the command ran,
   * nothing more is known, and `outcome` is the execution's. Codex's own
   * automatic compaction carries `['usage']`. Absent = the source reported
   * every field it has (a missing field is then just not applicable).
   */
  unrecorded?: LocalAgentCompactionUnrecorded[]
}

/** One thing a compaction's source does not report (see {@link LocalAgentCompactionEvent.unrecorded}). */
export type LocalAgentCompactionUnrecorded = 'usage' | 'before-after' | 'summary'

/**
 * A CLI member's context occupancy as the CLI last reported it (Kimi's ACP
 * `usage_update`, Codex's `thread/tokenUsage/updated`), written after a round
 * when it moved. The occupancy ring and the compaction reminder read it.
 */
export interface LocalAgentContextEvent {
  /** The delegation provider (`kimi-cli`, `codex-local`, …). */
  provider: string
  /** Tokens in the CLI's context. */
  usedTokens: number
  /** The model's context window, when the CLI states it. */
  contextWindow?: number
}

/**
 * Who asked the core for an execution. `cli`: the member's CLI itself — a
 * round it opened on its own (cause `self`) or one of its own subagents'
 * executions (cause `cli-subagent`); the two are told apart by `cause.kind`.
 */
export type LocalAgentExecutionCaller = 'tool' | 'composer' | 'room' | 'api' | 'cli'

/** What one execution was for: a prompt round, or a `/compact`. */
export type LocalAgentExecutionOperation = 'prompt' | 'compact'

/** How an execution ended. */
export type LocalAgentExecutionOutcome = 'done' | 'failed' | 'cancelled' | 'uncertain'

/**
 * The task an execution worked for, by reference: room writes its
 * `room/dispatch` task id; the host tool path writes `turn:<n>` of the
 * calling session. Spend summed per task adds every execution whose `task`
 * is equal.
 */
export interface LocalAgentTaskRef {
  sessionId: string
  id: string
}

/**
 * Why an execution ran, as the caller recorded it. Room assembles it from
 * its own facts; the core stores it and never interprets it.
 */
export type LocalAgentExecutionCause =
  /** A human asked: a room message, the member composer, or the compact button. */
  | { kind: 'human'; sessionId: string; messageId?: string; dispatchSeq?: number; via?: 'room' | 'member-composer' | 'compact-button' }
  /** The coordinator or another member sent it (including the old relay). */
  | { kind: 'member'; sessionId: string; fromMemberId: string; dispatchSeq: number }
  /** A help request from another room. */
  | { kind: 'help'; sessionId: string; helpId: string; fromRoom: string; fromTask?: LocalAgentTaskRef }
  /** A release round the report gate let through. */
  | { kind: 'decision'; sessionId: string; decisionId: string }
  /** A round a previous execution's report triggered. */
  | { kind: 'execution'; executionId: string }
  /** A host session's `subagent` tool call (including a room's main agent continuing a member directly). */
  | { kind: 'tool-call'; sessionId: string; callId: string }
  /** The hand-off of held work after a restart. */
  | { kind: 'restart'; sessionId: string }
  /**
   * A round the member's CLI opened on its own: a background task it started
   * completed, failed or timed out while the member was idle (Kimi's
   * `turn.prompt` with `origin.kind: 'task'`). Caller `cli`.
   */
  | {
    kind: 'self'
    reason: 'background-task'
    /** The CLI's own task id (Kimi `bash-…` / `agent-…`). */
    taskId: string
    /** The task's ending, from the CLI's notification: `completed` | `failed` | `timed_out` | `killed`. */
    taskStatus: string
    /** The CLI's notification id (Kimi `task:<id>:<status>`); the mirror pairs the round by it. */
    notificationId?: string
    /**
     * The execution that started the task, followed through recorded facts
     * (the task's tool call → the mirrored call's turn → the execution whose
     * turns hold it). Absent = not recorded; never guessed.
     */
    startedBy?: string
  }
  /**
   * One execution of a subagent the member's CLI ran itself (Kimi
   * `Agent`/`AgentSwarm`, Claude Code `Agent`/`Task`), written in its
   * grandchild session under the member. Caller `cli`.
   */
  | {
    kind: 'cli-subagent'
    /** The member's child session. */
    sessionId: string
    /** The member's `Agent`/`AgentSwarm`/`Task` tool call id (Kimi `parentToolCallId`, Claude `toolUseId`). */
    callId: string
    /** The member execution the call ran in (a per-task sum climbs through it). */
    executionId?: string
    /** The subagent type: `explore`, `coder`, `general-purpose`, … */
    name?: string
    /** Its place in an `AgentSwarm` call. */
    group?: { index: number; size: number }
    /** Started in the background (`runInBackground` / `run_in_background`). */
    background?: true
    /** A Kimi `resume`: another execution of an existing subagent. */
    resumed?: true
  }

/**
 * A fact the source never reports, declared statically per harness (exec and
 * live separately) and copied onto the execution's end record — never
 * guessed from a run's outcome.
 */
export type LocalAgentUnrecorded =
  /** Model calls the CLI makes internally that never reach its stream. */
  | 'internal-calls'
  /** Call boundaries cannot be told apart (codex exec). */
  | 'call-boundaries'
  /** Only a whole-round usage exists (codex exec): the step carrying it reads as a round total. */
  | 'per-call-usage'
  /** `/compact` ran, but the CLI reports no compaction facts (Claude Code, dsh). */
  | 'compaction'

/**
 * `local-agent/execution`, phase `start`: written in the member's child
 * session at the admission point (for a first round, before its first
 * `turn/start`; written once per `executionId`).
 */
export interface LocalAgentExecutionStartEvent {
  phase: 'start'
  executionId: string
  caller: LocalAgentExecutionCaller
  /** The caller's own handle for this execution (room run id, tool call id, …). */
  callerRef?: string
  operation: LocalAgentExecutionOperation
  /**
   * Why it ran, as the caller recorded it. Absent = the caller recorded no
   * cause (a facade caller that passed none; S1 takes causes only from
   * {@link DelegationCallOptions.cause} and the family tool): read it as
   * "not recorded", never infer one.
   */
  cause?: LocalAgentExecutionCause
  task?: LocalAgentTaskRef
  /** The session that owns the member (a room, or the host session that delegated). */
  parentSessionId: string
  admittedAt: number
}

/**
 * `local-agent/execution`, phase `end`: written by the core when the run
 * settles — after the execution's last `turn/end`. It carries no turn/step
 * relationship, so the host's released-log check places no constraint on it.
 */
export interface LocalAgentExecutionEndEvent {
  phase: 'end'
  executionId: string
  outcome: LocalAgentExecutionOutcome
  /**
   * The `turn/start` turns this execution wrote after its start record: the
   * explicit range, never inferred from time. Empty for a compaction or a run
   * that failed before its first turn.
   */
  turns: number[]
  endedAt: number
  /** The harness's static "not recorded" declarations, copied verbatim. */
  unrecorded?: LocalAgentUnrecorded[]
  /**
   * The CLI's own whole-round total, as it reported it (user decision
   * 2026-11-03 ②): an independent fact to check against the sum of the
   * per-call `assistant/message.usage` in `turns`, never a copy of it and
   * never added to it.
   */
  providerReportedUsage?: TokenUsage
  /**
   * The outcome is an operator's finding, not the run's own settlement: a
   * restart left the execution `uncertain` and it was reconciled
   * (`reconcileExecution`, batch 5 S7). The core writes this end after the
   * fact, so the child log closes the execution; `turns` are the turns its
   * range holds, `endedAt` the reconciliation time.
   */
  reconciled?: true
}

/**
 * A harness's static "not recorded" declarations (`LocalAgentHarness.unrecorded`),
 * by how the execution ran: a prompt round on the one-shot CLI (`exec`) or on
 * the resident process (`live`), and a `/compact` execution (`compact`). The
 * core copies the matching list onto the execution's end record verbatim.
 */
export interface LocalAgentUnrecordedDeclaration {
  readonly exec?: readonly LocalAgentUnrecorded[]
  readonly live?: readonly LocalAgentUnrecorded[]
  readonly compact?: readonly LocalAgentUnrecorded[]
}

/**
 * The execution facts a caller hands the core with a round (staged on the
 * delegation intent, read at the admission point): who asked, its own handle,
 * and — only when the caller recorded them — cause and task.
 */
export interface LocalAgentExecutionIntent {
  /** The ledger row's execution id, reused by the records; absent = the recorder mints one. */
  readonly executionId?: string
  readonly caller: LocalAgentExecutionCaller
  /** Set by the core from the round's operation; absent = `prompt`. */
  readonly operation?: LocalAgentExecutionOperation
  readonly callerRef?: string
  readonly cause?: LocalAgentExecutionCause
  readonly task?: LocalAgentTaskRef
}

/**
 * One `local-agent/execution` record: a member execution's cause and task at
 * its start, its outcome and turn range at its end. Paired by `executionId`.
 */
export type LocalAgentExecutionEvent = LocalAgentExecutionStartEvent | LocalAgentExecutionEndEvent

/**
 * One execution read back from the member's log (batch 5 S6,
 * `LocalAgentRegistry.readExecution`): computed from the records on every
 * read, never stored anywhere. Usage has exactly one written home per kind —
 * a call's on its `assistant/message.usage`, the CLI's round total on the end
 * record, a compaction call's on its `local-agent/compaction` — and this
 * reading only adds and passes them through.
 */
export interface LocalAgentExecutionReading {
  executionId: string
  operation: LocalAgentExecutionOperation
  /** Absent while the execution is open (no end record yet). */
  outcome?: LocalAgentExecutionOutcome
  /** The execution's turns: the end record's, or (open) the `turn/start`s after its start record. */
  turns: number[]
  /**
   * The sum of every `assistant/message.usage` in `turns` (the per-call
   * usage). Absent when no call in the range carried usage. Never includes a
   * compaction's spend or context sizes.
   */
  callUsage?: TokenUsage
  /** How many `assistant/message` events with usage the sum adds. */
  calls: number
  /** The CLI's own round total from the end record, verbatim (claude-code, codex report one; kimi, dsh do not). */
  providerReportedUsage?: TokenUsage
  /** The end record's "not recorded" declarations, verbatim (empty while open). */
  unrecorded: LocalAgentUnrecorded[]
  /**
   * The `local-agent/compaction` facts inside the execution's range, in
   * order. Their `beforeTokens`/`afterTokens` are context SIZES, never usage;
   * their `usage` is the compaction call's own spend and is never part of
   * {@link callUsage}.
   */
  compactions: LocalAgentCompactionEvent[]
  /**
   * The member CLI's own subagents that ran for this execution: each
   * grandchild execution whose `cli-subagent` cause names this execution.
   * Absent when the reader did not look (or found none to report).
   */
  subagents?: LocalAgentExecutionSubagentReading[]
  /**
   * The sum of the subagents' per-call usage ({@link LocalAgentExecutionSubagentReading.callUsage}),
   * kept apart from {@link callUsage} (the member's own calls) so the
   * member-vs-CLI-total check compares like with like. Absent when no
   * subagent call carried usage.
   */
  subagentUsage?: TokenUsage
}

/** One subagent execution read back for its member's execution (see {@link LocalAgentExecutionReading.subagents}). */
export interface LocalAgentExecutionSubagentReading {
  /** The grandchild session (one per CLI subagent). */
  sessionId: string
  /** The grandchild execution. */
  executionId: string
  /** The subagent type, from the cause. */
  name?: string
  /** The sum of every `assistant/message.usage` in the grandchild execution's turns. */
  callUsage?: TokenUsage
  calls: number
  /** The CLI's own total for the subagent (Kimi `subagent.completed.usage`), verbatim. */
  providerReportedUsage?: TokenUsage
}

/**
 * The state of one CLI background task (`LocalAgentBackgroundTask.state`),
 * in the CLI's own terms: `stopped` is a task the CLI killed, `lost` one
 * whose process went away before it reported an ending.
 */
export type LocalAgentBackgroundTaskState = 'running' | 'completed' | 'failed' | 'timed-out' | 'stopped' | 'lost'

/**
 * One background task the member's CLI runs on its own (Kimi's detached
 * Bash and background subagents), read from the CLI's own task state —
 * the core never runs, adopts or replays one.
 */
export interface LocalAgentBackgroundTask {
  /** The CLI's task id. */
  id: string
  /** The CLI's description (the model's one line); else the command's first 60 characters. */
  label: string
  /** The full command, for a shell task. */
  command?: string
  kind: 'shell' | 'agent'
  startedAt: number
  endedAt?: number
  state: LocalAgentBackgroundTaskState
  exitCode?: number
  /** The execution that started it (the same fact chain as the `self` cause's `startedBy`); absent = not recorded. */
  startedBy?: string
  /** Why it is `lost`, only when we know: our own restart, our own reclaim, or the process's own exit. */
  lostBecause?: 'host-restart' | 'process-reclaimed' | 'process-exited'
  /** The execution its result went to: the round the CLI opened for it, or the round it folded into. */
  resultIn?: string
  /** A background subagent's grandchild session (same task id), when it has one. */
  subagentSessionId?: string
}

/**
 * A member's background tasks, as the `memberBackgroundTasks` Remote answers
 * it. `supported: false` = the harness (or its current way of running) has
 * no background tasks to show — the room shows nothing, not "0".
 */
export interface LocalAgentBackgroundTasks {
  supported: boolean
  /** Running and lost tasks, and those that ended within the last hour. */
  tasks: LocalAgentBackgroundTask[]
  /** Whether the member's resident CLI process is up in this host process. */
  processAlive: boolean
  /** When an idle reclaim would end the process at the latest (epoch ms), when one is scheduled. */
  keepAliveUntil?: number
}

/**
 * What the core hands {@link LocalAgentHarness.backgroundTasks}: where the
 * member's CLI session lives, and lookups over the member's own child log
 * (read lazily, only when the harness asks).
 */
export interface LocalAgentBackgroundTasksRequest {
  readonly childSessionId: string
  /** The member's scoped home. */
  readonly homeDir: string
  /** The member's CLI session; absent before its first round recorded one. */
  readonly cliSessionId?: string
  /**
   * The execution whose turns hold the mirrored tool call `callId`;
   * undefined when any link of the chain is missing.
   */
  readonly executionOfCall: (callId: string) => Promise<string | undefined>
  /** The execution the CLI opened for task `taskId` (cause `self`); undefined when none is recorded. */
  readonly selfExecutionOf: (taskId: string) => Promise<string | undefined>
}

/** A member's context occupancy, as the `memberContext` Remote answers it. */
export interface LocalAgentMemberContext {
  provider: string
  /** The owning harness (`kimi`, `codex`, …) and its display name, when one claims the provider. */
  harness?: string
  harnessDisplayName?: string
  usedTokens?: number
  contextWindow?: number
  /** `compacting` while a compaction round runs; `running` for any other round. */
  state: 'idle' | 'running' | 'compacting'
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** A CLI member's context occupancy after a round. */
    'local-agent/context': LocalAgentContextEvent
    /** Plugin-owned live presentation anchor and incremental recovery checkpoints. */
    'local-agent/stream': LocalAgentStreamCheckpoint
    /** A CLI member's context compaction (display + accounting). */
    'local-agent/compaction': LocalAgentCompactionEvent
    /**
     * A member execution's start and end (cause, task, turn range). Never
     * unregister once any build writes it: the stored reader refuses a log
     * with an unregistered type, so the member's history would not open.
     */
    'local-agent/execution': LocalAgentExecutionEvent
  }
}

/** One session record a harness's records adapter lists. */
export interface LocalAgentSessionRecord {
  /** Harness session id. */
  id: string
  /** The workspace directory the session ran in. */
  workDir: string
  /** Optional session title when the harness records one. */
  title?: string
  /** Optional epoch-millis start time when the harness records one. */
  startedAt?: number
}

/**
 * How much is known about a harness's credential, from the two channels a
 * status read has: the scoped home's own shape, and what delegation rounds
 * observed.
 *
 * - `absent` — no credential in the scoped home (or the harness declares no
 *   probe at all). Nothing to try.
 * - `present-unverified` — a credential record exists and nothing has
 *   exercised it in this host process. The record could be expired and
 *   unrefreshable and still look exactly like this; saying so is the point.
 * - `verified` — a delegation round reached the CLI's endpoint and completed
 *   since the last login/logout, so the credential is known live.
 * - `rejected` — a round's endpoint rejected the credential (a 401/403 a
 *   presence probe cannot see) and no fresh login has rewritten the
 *   credential marker since.
 *
 * The grade is per host process: after a restart a present credential reports
 * `present-unverified` until a round exercises it, because that is what is
 * actually known. An eager liveness probe at status time is deliberately NOT
 * this field's job.
 */
export type LocalAgentCredentialState = 'absent' | 'present-unverified' | 'verified' | 'rejected'

/**
 * One harness's endpoint state, per field, for the settings card: the
 * resolved baseUrl verbatim (not a secret) and the two credentials as
 * presence booleans — secrets never cross this seam. The state is the
 * RESOLVED view (scope file over the deployment config), which is exactly
 * what a delegation round would use.
 */
export interface LocalAgentEndpointAuthState {
  readonly baseUrl?: string
  readonly apiKeySet: boolean
  readonly authTokenSet: boolean
}

/**
 * One endpoint-credential edit: a string SETS the field, `null` (or a blank
 * string) CLEARS it, and an absent key LEAVES it. Clearing lets the
 * deployment-config layer answer for that field again (the merge is per
 * field, file over config).
 */
export interface LocalAgentEndpointAuthFields {
  readonly baseUrl?: string | null
  readonly apiKey?: string | null
  readonly authToken?: string | null
}

/** One harness's auth-status snapshot, shared by the command and Remote channels. */
export interface LocalAgentStatus {
  /** Harness command prefix. */
  name: string
  /** Human display name. */
  displayName: string
  /**
   * Whether the scoped home holds usable credentials — the SHAPE answer,
   * kept for every surface written before {@link LocalAgentCredentialState}
   * existed. Exactly `credentialState === 'verified' || 'present-unverified'`:
   * a record that is present but never exercised still reads true, which is
   * why the finer field exists.
   */
  authenticated: boolean
  /**
   * How much is actually known about the credential — the liveness grade
   * behind {@link LocalAgentStatus.authenticated}. Always present.
   */
  credentialState: LocalAgentCredentialState
  /**
   * Absolute scoped home — of the SCOPE this status was asked about (see
   * {@link LocalAgentStatus.scope}), which for the default scope is the
   * directory it always was.
   */
  homeDir: string
  /**
   * The named scope this status describes, when it describes one. Absent
   * means the default scope — the only one that existed before named scopes,
   * so every surface written before the field keeps reading exactly what it
   * read. A named scope holds its own account: its credential grade, its
   * session records and its delegation mappings are its own.
   */
  scope?: string
  /** Subagent provider name, when the harness delegates. */
  delegationProvider?: string
  /**
   * Whether the harness declares a device-code login flow (`/<name> login`).
   * A harness without one authenticates through the host instance (e.g. by
   * resolving a credential), so surfaces must not offer a login action.
   */
  loginable?: boolean
  /**
   * A pty login is waiting for the user to paste the OAuth code
   * (`/<name> code <value>`). Surfaces render the paste box while set.
   */
  loginAwaitingCode?: boolean
  /**
   * Whether the harness declares a sign-out path (`/<name> logout`). A
   * harness without one has no account to switch, so surfaces must not offer
   * a logout action.
   */
  logoutable?: boolean
  /**
   * The harness's fairness-relevant effective settings, when the harness
   * declares a snapshot ({@link LocalAgentHarness.effectiveSettings}).
   * Additive: surfaces and clients written before the field simply ignore it.
   */
  effectiveSettings?: LocalAgentEffectiveSettings
}

/**
 * One harness's fairness-relevant effective settings — the read side of the
 * web-eval condition hash. Everything here is a knob the evaluation must hold
 * equal across harnesses (drive, approval boundary, reasoning effort,
 * endpoint route, CLI version) expressed as PURE JSON. Credentials never
 * enter: no keys, no tokens, no full URLs (an endpoint reports its hostname
 * only — a URL's path could carry tenant or project ids).
 *
 * A field the harness has no knob for — or one whose knob this deployment
 * leaves unset — stays ABSENT (`sandbox`, `permissionMode`, `autoApprove`,
 * `reasoningEffort`, `model`, `cliVersion`): absence is itself the honest
 * condition-hash input, never a substituted default. `drive` and
 * `baseUrlSet` are always present.
 */
export interface LocalAgentEffectiveSettings {
  /**
   * How delegation rounds run: a one-shot CLI process per round (`exec`) or a
   * resident runtime driven over its wire (`live`). The reported value is the
   * configured driver preference in force; a live round may still fall back
   * to exec when its channel cannot come up.
   */
  drive: 'exec' | 'live'
  /**
   * The file-effect boundary in force, in the harness's own vocabulary.
   * Codex: the sandbox policy every round passes to `codex exec --sandbox`.
   * dsh: the permission preset provisioning pins into the sub-profile
   * (`read-only` / `workspace-write` / `danger-full-access`), which also
   * decides the sub-dsh's approval policy through dsh-base's own preset
   * table. Absent when the deployment pins none.
   */
  sandbox?: string
  /** Claude Code: the `claude -p` permission handling (`skip` or `normal`). */
  permissionMode?: string
  /**
   * Kimi: whether the scoped config's permission rules auto-approve tool use
   * (the `Bash(*)` allow rule the provisioning gate keys on).
   */
  autoApprove?: boolean
  /**
   * The reasoning effort in force, when the harness has one. Kimi reads its
   * scoped config (`[thinking] effort`, falling back to the model's
   * `default_effort`); codex reads its scoped config's
   * `model_reasoning_effort`. Absent when the harness exposes no effort knob.
   */
  reasoningEffort?: string
  /** Whether a non-default endpoint is in force (a provider-pinned or env-provided base URL). */
  baseUrlSet: boolean
  /**
   * The endpoint's HOSTNAME only, present exactly when `baseUrlSet`. Never
   * the full URL — its path can carry credential-adjacent segments.
   */
  baseUrlHost?: string
  /**
   * The CLI's own version, as the CLI itself reports it — the version a
   * delegation round would run with right now. Resolved by the family's
   * `<cli> --version` probe, which spawns at most once per executable
   * identity (resolved path + mtime + size) and is therefore cheap enough for
   * a status read while still re-probing across an upgrade. Absent when the
   * CLI cannot be asked (not installed, non-zero exit, timeout, no
   * version-shaped token in its banner) — absence is the honest condition
   * input, never a substituted guess.
   */
  cliVersion?: string
  /**
   * The configured model identifier a delegation round would run with — read
   * in one fixed order, never guessed: the harness's OWN `model` plugin-config
   * key first (codex, claude-code, and kimi each accept one, and a set key
   * rides every round's CLI launch), then the harness's scoped configuration
   * surface (kimi's `default_model`, codex's `model`, claude-code's
   * `settings.json` `model`, dsh's host `agentDefaultModel` selection
   * formatted `provider/model` — the CLI's own default stays unnamed), then
   * absent. Absence is the honest answer, never a substituted default.
   *
   * This deliberately does NOT report a delegation-level model
   * ({@link DelegationCallOptions.model}): that one belongs to one
   * delegation, while this field answers "what would a round with no model of
   * its own run" — the harness-wide setting, which is what the evaluation's
   * condition snapshot is asking about.
   *
   * This is a LIVE read of what the NEXT such round would run with. A run's
   * condition hash freezes it at run setup, so changing the key mid-run does
   * not rewrite the recorded condition — the next round's model read-back
   * fails the run as misattributed instead (web-eval frozen decision 5).
   */
  model?: string
  /**
   * Extra `NODE_OPTIONS` the harness injects when a round runs against a
   * container exec target ({@link DelegationExecTarget}). Only the dsh
   * harness declares one: its HTTP client is node's `fetch` (undici), which
   * does not read `HTTP(S)_PROXY` by default, so a round inside a unit whose
   * only egress is a whitelist proxy needs `--use-env-proxy` to open
   * undici's `EnvHttpProxyAgent` — without it the CLI dials the API directly
   * and the proxy never even sees a `CONNECT`. Reported unconditionally
   * because the injection is unconditional in code; absent means the harness
   * injects none. Never a credential — a node flag.
   */
  containerNodeOptions?: string
}

/**
 * The hostname of an endpoint URL, or undefined when the value does not parse
 * as a URL (scheme-less `host:port` forms included — still reported via
 * `baseUrlSet`, just without a hostname).
 */
export function endpointHost(url: string): string | undefined {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

/** Roster row: enough of a harness for a client list. */
export interface LocalAgentRosterRow {
  /** Harness command prefix. */
  name: string
  /** Human display name. */
  displayName: string
}

/**
 * One family delegation's CLI-session mapping, recorded by the harness
 * provider after its first round settles (the CLI session id is only known
 * from the round's output). The resume tool resolves a caller-supplied dsh
 * child session id against this registry, and ownership is proven by the
 * recorded parent session id: a forged handle naming another session is
 * rejected instead of resuming someone else's conversation context.
 */
export interface LocalAgentDelegationRecord {
  /** Creation-time reasoning request and optional frozen evaluation lock. */
  effort?: string
  configurationLock?: string
  /** The dsh subagent child session id (the run id of the first round). */
  childSessionId: string
  /** The `ctx.subagents` provider name that owns the CLI session. */
  provider: string
  /** The delegating parent session id that created the child. */
  parentSessionId: string
  /**
   * The CLI's own session/thread id, used to build the resume command.
   */
  cliSessionId: string
  /**
   * The resolved working directory the FIRST round ran in — the anchor the
   * resume-consistency check compares a later round's effective cwd against.
   * Recorded by the provider at the delegation's first-round record point;
   * absent on records written before the field existed (they opt out of the
   * check rather than guess).
   */
  cwd?: string
  /**
   * The named scope whose scoped home this delegation ran against — the
   * anchor a resume round must repeat. Absent means the DEFAULT scope, which
   * is what every record written before the field existed is; a resume that
   * names a scope against such a record (or names none against a scoped one)
   * is refused rather than continuing the CLI session under another account's
   * credentials.
   */
  scope?: string
  /**
   * The model identifier the provider observed in its own output stream for
   * the latest settled round (claude's stream-json init, codex's rollout
   * turn_context, kimi's wire usage/request records, the sub-dsh session's
   * assistant source). Read back verbatim, never guessed: absent when the
   * stream yielded none. This is the observed half of the evaluation's
   * "declared model == actually-run model" check (web-eval frozen decision
   * 5); it never enters any prompt or model-visible face.
   */
  observedModel?: string
  /**
   * The model this delegation REQUESTED — the `model` call option its first
   * round carried, recorded so every resume round re-requests the same value.
   * The requested half of the pair whose observed half is
   * {@link LocalAgentDelegationRecord.observedModel}: a delegation that asked
   * for one model and read back another is exactly what the evaluation's
   * declared-vs-run check exists to catch.
   *
   * Absent means the delegation named none — its rounds fall back to the
   * plugin config, the scoped file, then the CLI's default, and a resume of
   * it does the same. Records written before this field existed are that
   * case, unchanged.
   */
  model?: string
  /**
   * The CLI version the latest settled round actually ran, read back the same
   * way {@link LocalAgentDelegationRecord.observedModel} is: from the CLI's
   * own stream or records when it names one (codex's rollout `session_meta`
   * carries `cli_version`, claude's stream-json init carries
   * `claude_code_version`), otherwise from the family's `--version` probe of
   * the executable the round spawned. Absent when neither channel answered.
   */
  cliVersion?: string
  /**
   * Kimi transcript lines already mirrored into the child session. The kimi
   * provider advances this after every round so a resumed round mirrors only
   * its delta instead of duplicating earlier messages.
   */
  kimiMirroredLines?: number
}

/**
 * One delegation's record WITHOUT the CLI-session resume handle — the
 * read-only projection {@link LocalAgentRegistry.delegationOf} returns for
 * surfaces that need a delegation's facts (provider, parent, observed model,
 * first-round cwd) but must never see the resume handle, which stays a
 * first-class parameter plus the intent channel.
 */
export type LocalAgentDelegationInfo = Omit<LocalAgentDelegationRecord, 'cliSessionId'>

/**
 * The member-channel view of one delegation, projected by the gateway's
 * `memberOf` Remote for the composer: everything the browser needs to decide
 * "this child session is a family member" and to label it, without the
 * CLI-session resume handle (which never leaves the host).
 */
export interface LocalAgentDelegationView {
  /** The dsh subagent child session id. */
  childSessionId: string
  /** The `ctx.subagents` provider name that owns the CLI session. */
  provider: string
  /** The delegating parent session id that created the child. */
  parentSessionId: string
  /** The owning harness's human display name, when a harness claims the provider. */
  harnessDisplayName?: string
}

/**
 * Result of one user-initiated member prompt (`promptMember` Remote). Facade
 * failures (unknown delegation, parent not live, resume locked, …) arrive as
 * structured errors for the composer to render inline, never as raw exceptions
 * over the wire.
 */
/**
 * One row of a member's execution ledger (batch 5 S4; the member composer's
 * inbox grew into it). Every member execution has one, whoever asked.
 */
export interface LocalAgentMemberInput {
  /** The execution id (the `local-agent/execution` records' `executionId`); a pre-ledger inbox row keeps its request id. */
  id: string
  /** Who submitted it. Pre-ledger inbox rows read as `composer`. */
  caller: LocalAgentExecutionCaller
  /** The caller's idempotency key (composer: its request id; room: its delivery id). */
  key?: string
  /** The input text: composer rows only (their only source; they replay after a restart). */
  text?: string
  /** `compact` for a compaction execution; absent = a prompt. */
  operation?: 'compact'
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'uncertain'
  createdAt: number
  updatedAt: number
  admittedAt?: number
  settledAt?: number
  /**
   * Set when an operator reconciled the row from `uncertain`
   * (`reconcileExecution`): its terminal status is the operator's finding,
   * and `error` holds their evidence (batch 5 S7).
   */
  reconciledAt?: number
  error?: string
}
export interface LocalAgentMemberInbox {
  memberId: string
  paused: boolean
  error?: string
  messages: LocalAgentMemberInput[]
}

export type LocalAgentPromptResult = { ok: true; requestId?: string } | { ok: false; error: string }

/**
 * Where a member's effective model comes from, in the family's fixed
 * resolution order (first match wins): the session-level override set through
 * the composer's model picker, then the delegation's own recorded model, then
 * the harness's plugin-config `model` (settings card / YAML), then the scoped
 * config file's own default, and last the CLI's built-in default — which by
 * itself names nothing, exactly as it did before any of these layers existed.
 * A harness MAY still name that compiled default through a side channel:
 * codex's app-server `model/list` marks the account's built-in default with
 * `isDefault`, so a broker that probed the catalog reports `cli-builtin` WITH
 * `effective` set (the one case this source names a model). And even when
 * nothing names it, the delegation records show what last actually ran —
 * {@link LocalAgentModelInfo.lastObserved}.
 */
export type LocalAgentModelSource = 'override' | 'delegation' | 'settings' | 'cli-config' | 'cli-builtin'

/** Provider-native values, never normalized into a supposedly equivalent budget. */
export interface LocalAgentReasoningOption {
  value: string
  label: string
  description?: string
}

/** A catalog candidate is not proof that an account can successfully run it. */
export interface LocalAgentModelEntry {
  value: string
  label: string
  resolvedModel?: string
  description?: string
  source: 'native' | 'configuration' | 'history'
  hidden?: boolean
  reasoning?: { options: readonly LocalAgentReasoningOption[]; default?: string }
}

export interface LocalAgentModelDirectoryData {
  entries: readonly LocalAgentModelEntry[]
  defaultModel?: string
  /** Complete enumeration of this source, not a guarantee of account access. */
  complete: boolean
  customInput: boolean
  unsupported?: boolean
  reason?: string
}

export interface LocalAgentModelDirectory extends LocalAgentModelDirectoryData {
  status: 'loading' | 'ready' | 'stale' | 'error' | 'unsupported'
  refreshing: boolean
  revision: number
  refreshedAt?: number
}

/** Inherit the member's creation settings, ask for the harness default, or pin a native value. */
export type LocalAgentConfigurationChoice = { mode: 'inherit' | 'default' } | { mode: 'value'; value: string }

export interface LocalAgentMemberConfiguration {
  model: LocalAgentConfigurationChoice
  effort: LocalAgentConfigurationChoice
}

/** Resolved control facts; actual generation observations are recorded separately. */
export interface LocalAgentResolvedConfiguration {
  model?: string
  effort?: string
}

export interface LocalAgentAppliedConfiguration {
  revision: number
  selection: LocalAgentMemberConfiguration
  resolved: LocalAgentResolvedConfiguration
}

export interface LocalAgentPendingConfiguration {
  revision: number
  requestId: string
  kind: 'selection' | 'cancel'
  selection: LocalAgentMemberConfiguration
}

export interface LocalAgentMemberControlState {
  memberId: string
  /** Monotonic intent revision, including cancellation. */
  revision: number
  current: LocalAgentAppliedConfiguration
  pending?: LocalAgentPendingConfiguration
  operation?: LocalAgentPendingConfiguration & { previous: LocalAgentAppliedConfiguration }
  status: 'idle' | 'pending' | 'applying' | 'reconciling' | 'failed'
  /** Immutable configuration captured at admission, including tool continuation. */
  round?: { id: string; configuration: LocalAgentAppliedConfiguration }
  lockedReason?: string
  /** First admitted configuration of a frozen evaluation; defaults cannot drift on resume. */
  frozen?: LocalAgentAppliedConfiguration
  error?: string
}

export interface LocalAgentControlReceipt {
  requestId: string
  revision: number
  status: 'pending' | 'applying' | 'applied' | 'cancelled' | 'failed' | 'conflict' | 'locked' | 'unsupported'
  error?: string
}

/**
 * The model surface for one member — or, without a member, for a harness's
 * next round (the settings card's "what would run" line). Every layer reports
 * its own value so a UI can explain WHY the effective model is what it is;
 * `choices` is the pickable vocabulary (settings + scoped-config default +
 * config-discovered + recently used, deduped), never a hardcoded catalog.
 */
export interface LocalAgentModelInfo {
  /** Durable current/pending selection, shared by every member entry point. */
  configuration?: LocalAgentMemberControlState
  /** The model the next round would actually run with, when any layer names one. */
  effective?: string
  /** Which layer {@link LocalAgentModelInfo.effective} came from. */
  source: LocalAgentModelSource
  /** The session-level override, when one is active for the member. */
  override?: string
  /** The delegation's recorded model, when the delegation named one. */
  delegation?: string
  /** The harness's plugin-config `model`, when the settings layer sets one. */
  settings?: string
  /** The scoped config file's own default model, when the file names one. */
  cliDefault?: string
  /**
   * The most recent model the provider was OBSERVED running (the delegation
   * records' {@link LocalAgentDelegationRecord.observedModel}), filled by the
   * core gateway when the broker itself names none. Display context for the
   * cli-builtin layer: the CLI's compiled default names nothing, but "what
   * ran last time" is exactly what a member still on that default would run
   * again — so surfaces show it as the last-observed hint, never as
   * {@link LocalAgentModelInfo.effective} (an observation is not a layer).
   */
  lastObserved?: string
  /**
   * The pickable model identifiers (deduped; empty when nothing names a
   * model). The core gateway appends {@link LocalAgentModelInfo.lastObserved}
   * as the final entry when no broker choice already lists it, so a member
   * that only ever ran its CLI default still has a one-item menu.
   */
  choices: readonly string[]
  /** Rich, source-labelled directory; choices remains the legacy read face. */
  directory?: LocalAgentModelDirectory
  /** Whether the harness's live driver is on for the member's rounds. */
  live: boolean
  /**
   * False while a round is in flight for the member: a model switch retires
   * the member's resident runtime so the NEXT round respawns with the new
   * model, and retiring a runtime mid-round would kill the run.
   */
  switchable: boolean
  /** Why a switch is currently refused, when {@link LocalAgentModelInfo.switchable} is false. */
  reason?: string
}

/**
 * A harness's model knob, registered with the harness and routed by the
 * gateway: the settings card reads the memberless info, the member composer
 * reads and switches per member. A harness without a broker keeps its old
 * faces exactly (the card's free-text model input still writes plugin config).
 */
/** Stable execution identity, available before the first native session ID arrives. */
export interface MemberConfigurationAdapter {
  /** Re-resolve defaults and validate before every whole-turn admission. */
  prepare?(selection: LocalAgentMemberConfiguration): Promise<LocalAgentResolvedConfiguration>
  /** Read-only validation. Unknown native values can fail later at the control boundary. */
  validate(selection: LocalAgentMemberConfiguration): Promise<void>
  /** No generation. Implementations must bound native controls and preserve session history. */
  apply(selection: LocalAgentMemberConfiguration, previous: LocalAgentAppliedConfiguration, operationId: string): Promise<LocalAgentResolvedConfiguration>
  /** Reconcile before retry/recovery; unknown never authorizes another round. */
  reconcile(state: LocalAgentMemberControlState): Promise<{
    active: boolean
    matches: 'current' | 'operation' | 'unknown'
    resolved: LocalAgentResolvedConfiguration
  }>
}

export interface LocalAgentMemberBinding {
  childSessionId: string
  provider: string
  parentSessionId: string
  cwd: string
  scope?: string
  model?: string
  effort?: string
  configurationLock?: string
}

export interface LocalAgentModelBroker {
  /** Native preparation for the core-owned configuration admission barrier. */
  configurationAdapter?(binding: LocalAgentMemberBinding): MemberConfigurationAdapter
  /** Refresh only discovery; never starts a model turn or changes selection. */
  modelDirectory?(childSessionId?: string, refresh?: boolean): LocalAgentModelDirectory | Promise<LocalAgentModelDirectory>
  /** Keeps an open picker current after a background probe. */
  followModelDirectory?(childSessionId: string | undefined, signal: AbortSignal): AsyncIterable<LocalAgentModelDirectory>
  /**
   * Read the model surface. With a member, `delegationModel` carries the
   * delegation record's requested model (the record lives in the core; the
   * broker ranks it between override and settings).
   * @param childSessionId - the member to read, absent for the harness default.
   * @param delegationModel - the delegation's recorded model, when it named one.
   * @returns the layer-by-layer surface.
   */
  modelInfo(childSessionId?: string, delegationModel?: string): LocalAgentModelInfo | Promise<LocalAgentModelInfo>
  /**
   * Set (or clear, with undefined) a member's session-level model override.
   * The override outranks the delegation's recorded model and the settings
   * layer; it is in-memory and deliberately does not survive a host restart.
   * When the member has a live runtime, setting a DIFFERENT model retires the
   * runtime so the next round respawns with the new model; the same model is
   * a no-op. Throws when a round is in flight for the member.
   * @param childSessionId - the member to switch.
   * @param model - the model identifier, or undefined to clear the override.
   */
  setMemberModel(childSessionId: string, model: string | undefined): Promise<void>
}

/**
 * One member-to-member notification handed to the room gate — the frozen
 * contract (`proposals/closed/2026-08-19-local-agent-member-channel.md` §3):
 * `{ from, to, content, parentSessionId, provenance }`. The bridge cannot
 * speak roster names for the SENDER (only room owns the roster), so `from`
 * is the sender's dsh child session id and the full delegation view rides
 * as `provenance`; room resolves both endpoints to roster names. The
 * CLI-session resume handle never crosses.
 */
export interface LocalAgentMemberMessage {
  /** The sending member's dsh child session id (resolved from its run token). */
  from: string
  /**
   * The raw `to` argument: a member's dsh child session id, or — only
   * meaningful to a claiming room — a member name from the room roster.
   */
  to: string
  /** The notification text. */
  content: string
  /** The parent session both members belong to. */
  parentSessionId: string
  /** The sender's delegation view, recorded as the delivery's provenance. */
  provenance: Record<string, string>
  /** `task` (default): a claiming room reports the reply back; `notify`: FYI only. */
  kind?: 'task' | 'notify'
  /** The message id this one answers (e.g. `m12`). */
  inReplyTo?: string
  /** What the sender waits for before acting on the result (a claiming room's report gate reads it). */
  note?: string
  /** `new` or a task number (a claiming room files the message under it). */
  task?: string
}

/**
 * The room gate's answer to a member notification, passed back to the sender
 * verbatim. Phase 1's gate is always human confirmation
 * ('pending-confirm'); 'sent'/'busy' belong to the phase-2 auto gate. A
 * DECLINE is not a value: the gate throws (the parent session is not a room
 * this instance manages) and the family direct-sends.
 */
export type RoomMemberMessageReceipt = 'sent' | 'pending-confirm' | 'busy' | `sent ${string}` | `pending-confirm ${string}`

/**
 * Duck-typed shape of the room service's member-message gate, probed via
 * `ctx.get('room')` — deliberately NO import of any room package, so the
 * optional local-agent → room edge needs no inter-plugin dependency and no
 * independence-checker sanction: room absent or declining is invisible to the
 * family path. Room implements this shape to own the dispatch gate.
 */
export type MemberRoomCommandName = 'room_plan' | 'room_read' | 'room_invite' | 'room_message' | 'ask_user_question' | 'room_help'

export interface MemberRoomCommand {
  name: MemberRoomCommandName
  arguments: Record<string, unknown>
}

/**
 * The room session a member's mode tools treat as the shared workspace, and
 * the member's role there (see preset-tool-host's desk mark).
 */
export interface MemberDesk {
  readonly sessionId: string
  readonly role: 'coordinator' | 'member'
  readonly member: string
  readonly runId?: string
}

export interface RoomMemberMessageGate {
  /** Explicit ownership prevents a rejected room operation falling through to direct execution. */
  isRoom?(request: { sessionId: string }): Promise<boolean>
  receiveMemberCommand?(actor: LocalAgentMemberRun, command: MemberRoomCommand): Promise<MemberMessageOutcome>
  receiveMemberMessage(message: LocalAgentMemberMessage): Promise<RoomMemberMessageReceipt>
  /**
   * The member's mode (a host agent preset id) whose plugin tools its bridge
   * offers, with the member's working directory and (newer rooms) its desk;
   * undefined = no mode tools.
   */
  memberMode?(member: LocalAgentMemberRun): Promise<{ readonly preset: string; readonly cwd?: string; readonly desk?: MemberDesk } | undefined>
  /**
   * A member's mode tool needs the human's approval: the room asks in its
   * conversation and answers with the registry's approval outcome.
   */
  askMemberApproval?(member: LocalAgentMemberRun, request: { readonly toolName: string; readonly reason?: string; readonly signal?: AbortSignal }): Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>
  /**
   * Something the human should know about a member's mode tools, as one line
   * in the room's conversation: its process was replaced at round start
   * because it lacked them (`reloaded`), or a replaced process still could
   * not get them (`unavailable`). Fire-and-forget; an older room lacks it.
   */
  noteMemberTools?(member: LocalAgentMemberRun, notice: MemberToolsNotice): Promise<void>
}

/** One room-visible fact about a member's mode tools (see {@link RoomMemberMessageGate.noteMemberTools}). */
export interface MemberToolsNotice {
  readonly kind: 'reloaded' | 'unavailable'
  /** The member's mode (host preset id) the tools belong to. */
  readonly preset: string
  /** `round`: it happened as a round started (the round goes on); `idle`: between rounds (a reload the human asked for). */
  readonly during: 'round' | 'idle'
}

/**
 * What one member's CURRENT process holds of its mode tools (the edit
 * dialog's 模式工具 line). Only mode tools are counted: room tools are built
 * into the bridge and the CLI's own tools are not ours to list.
 * - `full`: it listed the host's mode tools (`received`);
 * - `placeholder`: the bridge could not ask, the CLI holds none of them;
 * - `empty`: it listed none, while its mode has tools now;
 * - `unreported`: a live process that never listed (a bridge from before the
 *   report, or a CLI that lists late);
 * - `none`: no resident process; the next round's process lists afresh.
 */
export interface LocalAgentMemberToolsStatus {
  /** The member's mode (host preset id). A member without a mode has no status at all. */
  readonly preset: string
  /** The mode's plugin tools as the host lists them now. */
  readonly expected: readonly string[]
  /**
   * The host could not tell what the mode has right now (the member's
   * session is not loaded yet, e.g. right after a host restart): `expected`
   * is empty and must read as unknown (「—」), never as 0.
   */
  readonly expectedUnknown?: true
  readonly process: 'full' | 'placeholder' | 'empty' | 'unreported' | 'none'
  /** The mode tools the current process received (`full` only). */
  readonly received: readonly string[]
  /** When the current process got its list or its placeholder. */
  readonly loadedAt?: number
  /** A round-start reload replaced the process because it lacked its tools; kept until the next normal load. */
  readonly autoReloadAt?: number
  /** A reload in progress: waiting for the member's round to end, or replacing the process now. */
  readonly reload?: { readonly state: 'scheduled' | 'reloading'; readonly since: number }
  /**
   * The last finished reload: the new process listed its tools (`loaded`),
   * still could not get them (`missing`), has not listed yet (`pending`: its
   * CLI lists at the next message), had no process to replace
   * (`no-process`), or could not start (`failed`).
   */
  readonly lastReload?: {
    readonly at: number
    readonly by: 'manual' | 'auto'
    readonly outcome: 'loaded' | 'missing' | 'pending' | 'no-process' | 'failed'
    /** Why a `failed` start did not come up (the provider's words), when it said. */
    readonly error?: string
  }
  /** Whether a reload can be asked for (the member runs on a resident process of a harness that supports it). */
  readonly reloadable: boolean
  /**
   * No process, and one can be started right now without a round (立即载入):
   * the harness resumes the member's recorded CLI session on a fresh
   * resident process, which lists its tools. False while a round is starting
   * or running, and for a harness that cannot.
   */
  readonly startable?: boolean
}

/**
 * The answer to a reload request: `now` (the member was idle) or
 * `after-round` (it is running; never interrupted). `start-failed`: the
 * member's last native start had failed, the load retried it first, and it
 * failed again — `error` is the new reason (the member's configuration
 * control shows the same).
 */
export type LocalAgentMemberToolsReload =
  | { readonly ok: true; readonly when: 'now' | 'after-round' }
  | { readonly ok: false; readonly reason: 'unknown-member' | 'unsupported' | 'no-process' | 'busy' }
  | { readonly ok: false; readonly reason: 'start-failed'; readonly error: string }

/**
 * Outcome of one `member_message` delivery. Channel-level failures (unknown or
 * expired token, unknown member) are `ok: false` tool errors;
 * delivery verdicts — including a failed direct send — are receipts the sender
 * can quote in its conclusion: `sent` / `pending-confirm` / `busy` /
 * `error: <reason>` (or whatever a claiming room returns, passed verbatim).
 */
export type MemberMessageOutcome =
  | { readonly ok: true; readonly receipt: string }
  | { readonly ok: false; readonly error: string }

/** Environment variable carrying the member-bridge socket path (spawn env → bridge). */
export const MEMBER_BRIDGE_SOCKET_ENV = 'DSH_MEMBER_SOCKET'

/** Environment variable carrying the per-run member-bridge token. */
export const MEMBER_BRIDGE_TOKEN_ENV = 'DSH_MEMBER_TOKEN'

/**
 * One in-flight CLI run registered for the member channel: the per-run token's
 * resolution target. The token is minted at run start (fresh or resume) and
 * invalidated when the run settles — a member's identity is never
 * self-reported. The token is the sole credential (host 0.1.5 removed the
 * child pid the parentage cross-check used; the auth-hardening proposal
 * tracks a stronger second factor).
 */
export interface LocalAgentMemberRun {
  /** The dsh child session id of the run (its member identity). */
  childSessionId: string
  /** The delegating parent session id. */
  parentSessionId: string
  /** The `ctx.subagents` provider name running the CLI. */
  provider: string
}

/**
 * What one delegation tool call intends for the provider's next `start()`.
 * The tool stages exactly one intent per call before awaiting
 * `ctx.subagents.startActivation()`, and the provider consumes exactly one per
 * start, so a per-(parent, provider) FIFO keeps fresh and resume rounds
 * paired even under parallel delegation.
 */
export type LocalAgentDelegationIntent =
  | {
    readonly kind: 'fresh'
    readonly onAdmitted?: () => void | Promise<void>
    /** The execution facts the core records at admission (see {@link LocalAgentExecutionIntent}). */
    readonly execution?: LocalAgentExecutionIntent
    readonly preparedMemberId?: string
    /**
     * The dsh child session id the caller minted for this round (facade/tool
     * fresh starts). Host 0.2.1 activation semantics forbid a provider run id
     * that names a live Session (`startActivation` rejects it as
     * DUPLICATE_CHILD), so the provider's returned run carries a per-execution
     * id and the durable child identity rides this channel instead. Absent
     * means the provider mints one (a direct start with no staged intent).
     */
    readonly childSessionId?: string
    readonly effort?: string
    readonly configurationLock?: string
    /**
     * The working directory the round's CLI process runs in, when the caller
     * supplied one (the `cwd` call option riding the staged intent). Absent
     * means the provider's default — the parent session's cwd.
     */
    readonly cwd?: string
    /**
     * Run the CLI inside this container instead of on the host (the `exec`
     * call option riding the same staged intent). Absent means the host.
     */
    readonly exec?: DelegationExecTarget
    /**
     * The named scope whose scoped home the round runs against (the `scope`
     * call option riding the same staged intent). Absent means the default
     * scope — the provider then resolves the same directory it always did.
     */
    readonly scope?: string
    /**
     * The model this delegation requested (the `model` call option riding the
     * same staged intent). The provider passes it to the CLI and RECORDS it,
     * so every resume round of this delegation re-requests the same value.
     * Absent means the provider falls back to its plugin config, then the
     * scoped file, then the CLI default.
     */
    readonly model?: string
  }
  | {
    readonly kind: 'resume'
    readonly onAdmitted?: () => void | Promise<void>
    /** The execution facts the core records at admission (see {@link LocalAgentExecutionIntent}). */
    readonly execution?: LocalAgentExecutionIntent
    /** The dsh child session id to continue (the resume handle). */
    readonly childSessionId: string
    /** The CLI session id the resume command continues. */
    readonly cliSessionId: string
    /**
     * The working directory the caller asks the resume round to run in, when
     * supplied. The provider compares it (or the parent-session default)
     * against the recorded first-round cwd and fails loud on a mismatch.
     */
    readonly cwd?: string
    /**
     * Run the resume round's CLI inside this container. The caller repeats
     * the first round's target; nothing recorded can verify that for it.
     */
    readonly exec?: DelegationExecTarget
    /**
     * The named scope the resume round runs against. Unlike the container
     * target this one IS anchored: the record carries the first round's
     * scope, and a round naming another (or none) is refused.
     */
    readonly scope?: string
    /**
     * `compact`: this round compacts the CLI's context instead of sending a
     * prompt (Kimi `/compact`, Codex `thread/compact/start`). It holds the
     * member's queue like any round — input sent meanwhile waits for it —
     * writes no turn, and records one `local-agent/compaction` event.
     */
    readonly operation?: 'compact'
  }

/**
 * One settled round's tool-call accounting, counted from the events the
 * provider ALREADY parses for its transcript mirror — no second parse, no new
 * readback channel. Per round, never cumulative.
 *
 * `byName` keys are whatever the harness's own CLI calls the tool, verbatim
 * and un-normalized: codex reports its stream item types (`command_execution`,
 * `web_search_call`), claude the `tool_use` name (`Bash`, `Read`, `TodoWrite`,
 * an MCP tool's full name), kimi and dsh the tool name their own events carry.
 * Cross-harness comparison is therefore `count` ONLY — the names are for a
 * reader, and normalizing them would invent an equivalence the CLIs never
 * agreed to. `byName` is absent when the events carried no usable name, and
 * its values always sum to `count`.
 */
export interface LocalAgentToolCalls {
  /** Tool calls the round made. Zero is a real observation — the round used none. */
  readonly count: number
  /** Per-tool counts under the CLI's own names; absent when no name was available. */
  readonly byName?: Readonly<Record<string, number>>
}

/**
 * One progress update for a delegation run. Providers report the data-bearing
 * kinds ({@link reportRunProgress} on the registry — the facade only forwards);
 * the facade itself emits the `heartbeat` kind while a facade-tracked run is
 * in flight, so a caller can render "in progress" without any provider
 * support.
 */
export type LocalAgentRunProgress =
  | {
    readonly kind: 'heartbeat'
    /** Milliseconds since the facade started tracking the run. */
    readonly elapsedMs: number
  }
  | {
    readonly kind: 'mirror'
    /** Total CLI transcript lines mirrored into the child session so far. */
    readonly mirroredLines: number
  }
  | {
    readonly kind: 'delta'
    /** A live transcript increment (M3; not yet emitted by any provider). */
    readonly text: string
  }
  | {
    readonly kind: 'settled'
    /** Native generation observation only, never copied from the requested effort. */
    readonly observedEffort?: string
    /**
     * The model identifier the provider observed in its own output stream for
     * this round, when the stream carried one — absent otherwise, never
     * guessed. The observed half of the evaluation's declared-vs-run model
     * check; never enters any prompt or model-visible face.
     */
    readonly observedModel?: string
    /**
     * The CLI version the round ran, when the provider could read one back
     * (its own stream or records first, the `--version` probe second).
     */
    readonly cliVersion?: string
    /** The settled round's token usage, when the harness reported one. */
    readonly usage?: TokenUsage
    /**
     * The round's tool-call accounting, counted from the transcript events the
     * provider already parsed. Absent when the harness reported none for this
     * round — absence is "not observed", which is not the same fact as a
     * `count: 0` round that ran no tools, so it is never filled in with zero.
     */
    readonly toolCalls?: LocalAgentToolCalls
  }

/**
 * Where one delegation round's CLI process runs when the caller has already
 * acquired a container for it (a lab unit). Given a target, the provider
 * spawns `docker exec -w <workdir> [-e NAME…] <container> <the same argv>`
 * instead of the CLI directly; stdio stays piped and every downstream
 * layer — stream parse, settle, readback, delegation record — is the host
 * path's, unchanged.
 *
 * The scoped home stays a HOST directory, bind-mounted read-write into the
 * unit: readback (codex's rollout, kimi's wire log, the sub-dsh session log)
 * reads it straight off the host filesystem, and credential refreshes the CLI
 * writes land back on the host. `env` is where the caller names those
 * in-container paths (`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `KIMI_CODE_HOME`,
 * `DSH_HOME`), which is why every provider REQUIRES its own scoped-home
 * variable here: the host path it would otherwise forward means nothing
 * inside the unit.
 *
 * Absent everywhere means the host path, byte-for-byte the behavior before
 * this option existed.
 */
export interface DelegationExecTarget {
  /**
   * The container the round runs in — a name or id the caller acquired (lab's
   * `UnitInfo.resource`). The family only ever runs `docker exec` against it:
   * creating, inspecting, mounting and destroying it belong to the caller.
   */
  readonly container: string
  /** Absolute in-container working directory (`docker exec -w`). */
  readonly workdir: string
  /**
   * Environment entries for the in-container process, overriding the
   * provider's own per key. Values travel in the docker CLIENT's environment
   * and reach the container through NAME-only `-e` flags, so nothing here
   * lands in the host process table.
   */
  readonly env?: Readonly<Record<string, string>>
}

/**
 * Call options for the public delegation facade (`LocalAgentRegistry.start` /
 * `resume`). The interface is deliberately additive: later milestones extend
 * it without changing the existing fields.
 */
export interface DelegationCallOptions {
  /** Resume only: compact the member's context instead of prompting it (see the resume intent). */
  readonly operation?: 'compact'
  /**
   * Who is asking, written on the execution's `local-agent/execution` start
   * record. Absent = `api` (a plugin calling the facade).
   */
  readonly caller?: LocalAgentExecutionCaller
  /** The caller's own handle for this execution (a room run id, …), recorded verbatim. */
  readonly callerRef?: string
  /**
   * Why this execution runs, recorded verbatim on its start record; the core
   * never interprets or guesses it. Absent records no cause.
   */
  readonly cause?: LocalAgentExecutionCause
  /** The task this execution works for, recorded verbatim on its start record. */
  readonly task?: LocalAgentTaskRef
  /** Host-only durable input edge, executed at the provider admission boundary. */
  readonly onAdmitted?: () => void | Promise<void>
  /** Reserved identity returned by prepareMember; never a caller-selected resume override. */
  readonly preparedMemberId?: string
  /** Native reasoning value, fixed at creation unless changed through member controls. */
  readonly effort?: string
  /** Frozen evaluation condition: rejects interactive configuration changes. */
  readonly configurationLock?: string
  /**
   * Child display label persisted with a session-backed child; omitted, the
   * harness's own display name labels the delegation.
   */
  readonly label?: string
  /**
   * Caller-owned extra cancellation channel. It is fused with the facade's
   * internal `cancel()` controller: aborting either cancels the run.
   */
  readonly signal?: AbortSignal
  /**
   * Per-call progress callback: receives the same {@link LocalAgentRunProgress}
   * payloads the `localAgent/run-progress` cordis event carries, routed to the
   * tracked run this call started. For callers that cannot conveniently
   * subscribe to cordis events.
   */
  readonly onProgress?: (event: LocalAgentRunProgress) => void
  /**
   * `resume` only: when the child session is not live, reattach it from
   * persistence (the default, true). Pass `false` to fail loud instead — the
   * pre-facade behavior — leaving the absent session untouched.
   */
  readonly reattach?: boolean
  /**
   * The working directory the CLI round runs in. On a fresh delegation it
   * replaces the parent session's cwd (the `resolveChildCwd` override — an
   * orchestrator giving each cell its own directory); on a resume it must
   * match the first round's recorded cwd or the call fails loud, since the
   * CLI conversation continues in the directory its earlier rounds ran in.
   * Absent everywhere means the parent session's cwd — the behavior before
   * this option existed, unchanged.
   */
  readonly cwd?: string
  /**
   * Run the round's CLI inside an already-acquired container instead of on
   * the host ({@link DelegationExecTarget}). The transport is the only thing
   * it changes; a round with a target still parses, settles, reads back and
   * records exactly as a host round does. On a resume, repeat the SAME target
   * the first round used — the recorded first-round anchor is the host `cwd`,
   * so a swapped container is a caller error the record cannot catch.
   */
  readonly exec?: DelegationExecTarget
  /**
   * Run the round against a NAMED scoped home of the harness
   * (`<homesRoot>/<harness>@<scope>`) instead of the default one. A scope is
   * a name matching `[a-z0-9-]`, never a path; the directory is materialized
   * (0700, then the harness's own provisioning) the first time anything names
   * it, and it holds its own credentials — nothing is copied from the default
   * scope, so a fresh scope needs its own `/<harness> login --scope <name>`.
   *
   * On a resume the scope must be the one the first round recorded, absence
   * included: continuing a CLI session against another account's credentials
   * is refused rather than attempted.
   *
   * Absent everywhere means the default scope — byte for byte the behavior
   * before scopes existed. A scoped round is exec-only (the live drivers bind
   * the default scoped home) and, on kimi, carries no member channel (the
   * bridge declaration is written into the default scope's `mcp.json`).
   */
  readonly scope?: string
  /**
   * The model this DELEGATION runs — `start` only. It outranks the harness's
   * `model` plugin-config key, which in turn outranks the scoped
   * configuration file and, last, the CLI's own default. Absent leaves that
   * pre-existing order exactly as it was, so a caller that names no model
   * gets byte-identical behavior.
   *
   * **Not accepted on `resume`.** A model belongs to the delegation, not to
   * one of its rounds: the first round records what it requested and every
   * later round of the same CLI session re-requests that same value (none,
   * when the first round named none). Passing it to `resume` is a caller
   * error and fails loud rather than switching a conversation's model
   * mid-way — which the CLI would honour and the transcript would not show.
   *
   * A round with a model is exec-only, for the reason a scoped round is: the
   * live drivers bind their model when the resident runtime spawns, and one
   * runtime serves many rounds.
   *
   * dsh spells it `provider/model` (the shape `effectiveSettings.model`
   * reports); the three CLI harnesses take whatever identifier their own CLI
   * takes.
   */
  readonly model?: string
}

/**
 * The fixed creation identity of a member's FIRST execution
 * ({@link LocalAgentExecutionRequest.member}); ignored once the member has a
 * delegation record — a continuing execution takes scope, cwd and model from
 * the record.
 */
export interface LocalAgentMemberCreate {
  readonly model?: string
  readonly effort?: string
  readonly cwd?: string
  readonly scope?: string
  readonly exec?: DelegationExecTarget
  readonly configurationLock?: string
  readonly label?: string
}

/** What one execution's admission looked like (`run`'s `on.admitted`). */
export interface LocalAgentExecutionAdmitted {
  readonly executionId: string
  readonly admittedAt: number
  /** The first child-log seq that can belong to this execution (0 for a child that did not exist yet). */
  readonly childFromSeq: number
}

/** How one execution ended (`run`'s `settled`). */
export interface LocalAgentExecutionSettlement {
  readonly executionId: string
  readonly outcome: 'done' | 'failed' | 'cancelled'
  /** The published run; absent when the execution failed or was cancelled before admission. */
  readonly run?: SubagentRun
  /** The `turn/start` turns this execution wrote in the child (its end record's range). */
  readonly turns: readonly number[]
  /** Observations the provider's settle report carried, when it arrived by settlement; absent = not recorded. */
  readonly observedModel?: string
  readonly observedEffort?: string
  readonly cliVersion?: string
  /** Why it failed or was cancelled, when it did. */
  readonly error?: string
}

/**
 * One member execution request — the single entry every caller uses (the
 * host `subagent` tool, the member composer, room, plugin facade calls). The
 * core decides whether it is the member's first round or a continuation (it
 * has a delegation record → continuation), queues it in the member's ledger,
 * admits it, and records it.
 */
export interface LocalAgentExecutionRequest {
  readonly parentSessionId: string
  readonly provider: string
  readonly member: {
    /** The member's stable dsh child session id (a first round creates it under this id). */
    readonly childSessionId: string
    /** First round only: its creation identity. */
    readonly create?: LocalAgentMemberCreate
  }
  /** The input, or a function evaluated when the execution reaches the head of the member's queue. */
  readonly input: readonly ContentBlock[] | (() => Promise<readonly ContentBlock[]>)
  readonly operation?: LocalAgentExecutionOperation
  /** Who asks; absent = `api`. */
  readonly caller?: LocalAgentExecutionCaller
  /** Why it runs, recorded verbatim on the execution's start record. */
  readonly cause?: LocalAgentExecutionCause
  readonly task?: LocalAgentTaskRef
  /**
   * The caller's idempotency key (room: its delivery id; the composer: its
   * input id). A key the member's ledger already holds is never run twice:
   * a queued or running one returns the same execution, a finished one its
   * settlement, an uncertain one an error.
   */
  readonly key?: string
  /** The caller's own handle (room run id, tool call id), recorded verbatim. */
  readonly callerRef?: string
  /** Display label of this round's activation; absent = `member.create.label`, then the harness name. */
  readonly label?: string
  /** Cancels the execution while queued and while running. */
  readonly signal?: AbortSignal
  readonly on?: {
    admitted?(execution: LocalAgentExecutionAdmitted): void | Promise<void>
    progress?(event: LocalAgentRunProgress): void
    settled?(settlement: LocalAgentExecutionSettlement): void
  }
}

/** What `run` returns once the execution is durably queued. */
export interface LocalAgentExecutionHandle {
  readonly executionId: string
  /** Resolves when the execution ends (never rejects). */
  readonly settled: Promise<LocalAgentExecutionSettlement>
  /**
   * Resolves with the published run once admitted and started; rejects when
   * it ended before that (the start/resume/compact wrappers return it).
   */
  readonly started: Promise<SubagentRun>
}

/** One settings-card value (JSON scalars and string lists — what the cards write). See card-settings.ts. */
export type CardSettingValue = string | number | boolean | readonly string[]

/** A harness's stored settings-card overrides, field → value. */
export interface CardSettings {
  readonly [field: string]: CardSettingValue
}
