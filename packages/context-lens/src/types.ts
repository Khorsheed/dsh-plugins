/**
 * The context-lens data model — the single contract between the host
 * capture half and the browser panel. Everything the panel renders comes from
 * these shapes; nothing else crosses the wire.
 *
 * Hierarchy: session → turn → agent scope (main / one per delegation run) →
 * request → four segments (system / tools / history / added). All text the
 * panel shows is captured verbatim from the `llm/stream` waterfall's
 * `GenerateOptions` (the assembly layer, BEFORE adapter projection), so the
 * panel never reconstructs — it replays what was actually sent.
 *
 * Measurement honesty: per-segment sizes are exact CHARACTER counts (the host
 * exposes no per-segment tokenizer); request-level token totals are the real
 * provider `usage` figures. The panel footer states this split.
 *
 * @module @khorsheed/dsh-context-lens/types
 */

/** Category buckets behind the stacked bar / legend filter / detail rows. */
export type SegmentCategory =
  /** 系统提示词（systemPrompt 组装，来源 = assemble section 名）。 */
  | 'system'
  /** 工具定义。 */
  | 'tool-definition'
  /** 用户消息。 */
  | 'user'
  /** 助手消息。 */
  | 'assistant'
  /** 工具结果。 */
  | 'tool-result'
  /** 技能注入（skill catalog / skill content）。 */
  | 'skill-injection'
  /** 提醒注入（system-reminder）。 */
  | 'reminder-injection'
  /** 插件注入（plugin prompt sections carried in messages）。 */
  | 'plugin-injection'
  /** 运行时快照（runtime-context durable user snapshot）。 */
  | 'runtime-snapshot'
  /** 工具变更通告。 */
  | 'tool-change'
  | 'compaction'

/** A retained request address; only emitted while the target is readable. */
export interface RequestLink { turnSeq: number; scopeId: string; seq: number; requestNumber?: number }
/** Durable compression identity, separate from a model request's display ordinal. */
export interface CompactionInfo {
  id: string
  hostTurn?: number
  /** True only after a checkpoint replacement actually committed. */
  applied?: boolean
  replacedCount?: number
  replacedChars?: number
  /** Log recovery knows the selected region, but not the complete model input. */
  inputPartial?: boolean
  before?: RequestLink
}

/** One message row inside a request's four-segment breakdown. */
export interface SegmentItem {
  /**
   * Position in the wire message stream (0-based across the whole request).
   * `-1` marks the one-shot system slot (`GenerateOptions.system`), which sits
   * ahead of the message array rather than inside it.
   */
  index: number
  messageId?: string
  compactionId?: string
  compactionRequest?: RequestLink
  pruning?: { beforeChars: number; afterChars: number; before?: RequestLink }
  category: SegmentCategory
  /** 角色/来源标签：model、runtime-context、skill-catalog、section 名等。 */
  source: string
  /** Tool calls this assistant row issued (the chip on assistant rows). */
  toolCalls?: string[]
  /** Exact tool-result provenance when the issuing request is retained. */
  toolCallId?: string
  sourceRequestNumber?: number
  /** Single-line preview (whitespace-collapsed). */
  preview: string
  /**
   * Verbatim full text — the panel's expand affordance shows exactly this.
   * Assistant rows carry a JSON string `{reasoning?, text?, calls?}` (calls
   * keep the raw argument JSON); every other role is its plain text.
   */
  full: string
  /** Exact character count of `full`. */
  chars: number
  /** Generation time of this assistant row, when it is one. */
  durationMs?: number
  /** `new` = arrived since the previous request in this scope; `history` otherwise. */
  /** Durable source turn, when supplied by the host. */
  sourceTurn?: number
  /** Explicit tool failure; never inferred from response prose. */
  isError?: boolean
  freshness: 'new' | 'history'
}

/** One tool definition as sent in the request's `tools` array. */
export interface ToolDefItem {
  name: string
  description: string
  /** Serialized parameter schema (pretty JSON). */
  parameters: string
  /** Exact character count of the serialized definition. */
  chars: number
  /** True when this definition was not present in the previous request. */
  added: boolean
}

/** Real provider usage figures (never estimated). */
export interface RequestUsage {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  /** Measured cache hits — the cache column's only source of truth. */
  cacheReadTokens?: number
}

/** The six-way timing split of one request (same vocabulary as the host product). */
export interface RequestTiming {
  /** Request dispatched → first chunk（模型等待）. */
  waitMs?: number
  /** reasoning blocks, summed（模型思考）. */
  reasoningMs?: number
  /** tool-call argument generation, summed（工具参数）. */
  toolArgsMs?: number
  /** text blocks, summed（模型输出）. */
  textMs?: number
  /** tool/call → tool/result for tools this request started（工具执行）. */
  toolExecMs?: number
  /** Dispatch → stream settled（总耗时）. */
  totalMs?: number
}

/** The request's model configuration snapshot — scopes may differ. */
export interface RequestConfig {
  provider?: string
  model?: string
  maxTokens?: number
  reasoningEffort?: string
  temperature?: number
}

/**
 * 明细头锚点：本请求的响应干了什么，结构化承载（面板负责本地化与拼装）。
 * 来自响应流的 tool-call / text blocks。
 */
export type ResponseSummary =
  | { kind: 'compaction' }
  /**
   * 响应以工具调用收尾：`name` 为首个调用的工具名，`hint` 为其参数摘要
   *（what → 文件 basename → for → description）。多调用用 `toolCounts` 按名称计数；
   * `more` 为兼容旧客户端保留的其余调用个数。
   */
  | { kind: 'tool'; name: string; hint?: string; more?: number; toolCounts?: { name: string; count: number }[] }
  /** 助手回复（有可见文本、无工具调用）。 */
  | { kind: 'text' }
  /** 空响应（无文本也无工具调用——失败/中断的响应落这里）。 */
  | { kind: 'none' }

/** The request's own response, verbatim content blocks. */
export interface CapturedResponse {
  /** Assembled reasoning text, when the model produced any. */
  reasoning?: string
  /** Assembled visible text, when any. */
  text?: string
  /** Tool calls issued: name + raw arguments string. */
  toolCalls: {
    callId?: string
    name: string
    arguments: string
    /** Execution happens after the model response; never part of input composition. */
    execution?: { status: 'running' | 'ok' | 'failed'; result?: string }
  }[]
}

/** Bounded view of the smallest replacement span, with unchanged context on either side. */
export interface PrefixTextChange {
  /** Unicode character offset, zero based. */
  offset: number
  leading: string
  trailing: string
  leadingOmitted: boolean
  trailingOmitted: boolean
  removed: string
  added: string
  removedChars: number
  addedChars: number
}

/** One message as a change entry shows it. */
export interface ChangeRow {
  /** Wire position in its own request (removed rows: the previous request). */
  index: number
  messageId?: string
  category: SegmentCategory
  source: string
  /** Whitespace-collapsed, at most 120 characters. */
  preview: string
  chars: number
}

/**
 * One change between consecutive requests. `kind` names the host fact behind
 * it: a surface replacement (`replace`), one metered by `compaction/summary`
 * (`compaction`) or `compaction/prune` (`prune`), or — with no event to pair
 * them — a bare id-level `remove` / `add`.
 */
export interface RequestChange {
  kind: 'replace' | 'compaction' | 'prune' | 'remove' | 'add'
  /** All rows are system messages; constituent events are listed in `parts`. */
  system?: true
  removed: ChangeRow[]
  added: ChangeRow[]
  /** The replacing message's producer, verbatim (`kind · op`). */
  source?: { kind: string; op?: string }
  /** Host log seq of the replacement event and of what it shadowed. */
  eventSeq?: number
  replacedSeqs?: number[]
  compactionId?: string
  /** Retained compaction request, when this change is a compaction. */
  compactionRequest?: RequestLink
  /** Retained request that still carried the un-pruned text. */
  pruneBefore?: RequestLink
  /** Character diff when one text became another (system: head against head). */
  text?: PrefixTextChange
  /** Assemble section holding the diff start, when the live lane attributed it. */
  section?: string
  /** A removed row whose full text equals the new head — a checkable equality, not a claim. */
  sameAs?: ChangeRow
  parts?: { kind: RequestChange['kind']; removed: ChangeRow[]; added: ChangeRow[]; eventSeq?: number; replacedSeqs?: number[] }[]
  /** The cache prefix first differs inside this change. */
  isBreak?: true
}

/** One tool definition difference, paired by name. */
export interface ToolChange {
  name: string
  change: 'added' | 'removed' | 'modified'
  description?: PrefixTextChange
  parameters?: PrefixTextChange
  /** Declaring package from the tool's host-side origin tag, when tagged. */
  owner?: string
  /** The message prefix is unchanged and this is the first differing tool. */
  isBreak?: true
}

/** One model call, fully captured. */
export interface CapturedRequest {
  /** Stable 1-based request ordinal within this agent’s history; absent when the beginning is unknown. */
  requestNumber?: number
  /**
   * Collector-assigned process-wide query ID, separate from the displayed request number.
   * Process-local and ephemeral — the counter resets on restart, so a seq
   * only selects within the answering instance's `generation`.
   */
  seq: number
  scopeId: string
  sessionId: string
  purpose?: string
  compaction?: CompactionInfo
  startedAt: number
  status: 'streaming' | 'ok' | 'failed'
  error?: string
  config: RequestConfig
  usage?: RequestUsage
  timing: RequestTiming
  /** The answering instance's epoch — see {@link ListTurnsResult.generation}. */
  generation?: string
  /**
   * 明细头锚点：本请求的响应干了什么（结构化；面板本地化渲染为
   * `name:hint` / 「助手回复」 / —）。
   */
  responseSummary: ResponseSummary
  /**
   * 本请求自己的响应原文（输出段）：streaming 中缺席；在任何 block 之前
   * 就失败的调用也缺席（error 字段承担失败展示）。一个 turn 的最后一次
   * 请求的响应只在这里可见（下一请求的 新增上下文 看不到它）。
   */
  response?: CapturedResponse
  /** Exact comparison with the preceding retained request in this scope. */
  prefix?: {
    previousSeq: number; previousRequestNumber?: number; gapMs: number
    changed?: { index: number; before: string; after: string; beforeCategory?: SegmentCategory; afterCategory?: SegmentCategory; text?: PrefixTextChange }
    toolsChanged: boolean
    /** Every message-level change since the previous request (tail appends excluded). */
    changes?: RequestChange[]
    /** Tool definitions added, removed, or rewritten, by name. */
    toolChanges?: ToolChange[]
    /** The ordinary tail append: how many messages, from which producers. */
    tail?: { count: number; sources: string[] }
    /** Provider or model differs from the previous request (caches never cross models). */
    configChanged?: { from: string; to: string }
  }
  segments: {
    /** systemPrompt 组装原文；source 为 assemble section 名。 */
    system: SegmentItem[]
    tools: ToolDefItem[]
    /** 继承自之前请求的消息（默认折叠）。 */
    history: SegmentItem[]
    /** 相对上一请求新收到的内容（含上一响应及其工具返回；默认展开）。 */
    added: SegmentItem[]
  }
}

/** One agent scope of a turn: the main conversation, or one delegation run. */
export interface AgentScopeSummary {
  /** 'main' or the subagent childId. */
  scopeId: string
  /**
   * Per-session 1-based ordinal in scope-creation order — the delegation chip's
   * `#N` anchor. Unlike a request seq it exists even for a 0-request failed run.
   */
  scopeSeq: number
  kind: 'main' | 'subagent'
  /** Delegation label from `subagent/catalog` (e.g. 第一章对账 JSON 提取). */
  label?: string
  status: 'running' | 'ok' | 'failed'
  error?: string
  config: RequestConfig
  requests: CapturedRequest[]
  startedAt: number
  endedAt?: number
}

/** Where one captured unit's content came from — the fidelity marker. */
export type CaptureOrigin =
  /** The in-process stream tee (full fidelity, system-section attribution). */
  | 'live'
  /**
   * Rebuilt from the on-disk session log (a one-shot child log carries no
   * system prompt / tool definitions; the system segment keeps no section names).
   */
  | 'log-reconstructed'

/** `listTurns` row — deliberately light (no segments, no request payloads). */
export interface TurnListItem {
  sessionId: string
  /**
   * The panel-facing address. Real turns key on the host's own turn number
   * (stable across live capture and log backfill, and durable across process
   * restarts); purpose pseudo-turns (compaction / session-title buckets) take
   * negative addresses that are NOT durable — they re-derive from the
   * session's bucket counter on every mount. Address semantics:
   * `(sessionId, turnSeq)` names a TURN, never a request.
   */
  turnSeq: number
  /** The host's turn number on real turns; absent marks a purpose pseudo-turn. */
  hostTurn?: number
  /** 用户 query 预览（单行截断）。 */
  query: string
  startedAt: number
  endedAt?: number
  requestCount: number
  scopeCount: number
  failedScopeCount: number
  totalInputTokens: number
  totalOutputTokens: number
  /**
   * Fidelity marker: `live` once any in-process capture landed on the turn
   * (the log lane never merges into such a turn), `log-reconstructed` when
   * the whole turn was rebuilt from the session log.
   */
  origin?: CaptureOrigin
  /**
   * The turn-tail assistant message id — the `conversation.chat.assistant-actions`
   * owner prop, so the message-row icon can map itself back to this turn.
   */
  closingMessageId?: string
}

/**
 * The history-backfill watermark of one session, surfaced so the panel can
 * tell "genuinely nothing captured" from "log unreadable" from "older turns
 * dropped by the memory budget".
 */
export interface BackfillInfo {
  /**
   * `none` — never read (no durable log yet, or no persistence backend);
   * `partial` — some turns reconstructed, older ones dropped by budget (the
   * read retries on later queries as room frees); `complete` — every turn in
   * the log is represented; `broken` — the log refused to decode.
   */
  state: 'none' | 'partial' | 'complete' | 'broken'
  /** The decode failure summary when `state` is `broken`. */
  reason?: string
}

/**
 * The scope allow-list of one read, computed by the CALLER from its own
 * authorization facts — the plugin treats it as an opaque filter and never
 * derives one itself. Absent (or no `scopes` key) is the unfiltered local
 * semantics.
 *
 * Scope identifiers are the ones `AgentScopeOverview.scopeId` exposes: the
 * main conversation scope's id is the stable string `'main'`; child scopes
 * key on the subagent childId (`call:<callId>` when the run never reached
 * the catalog). A scope outside the list contributes nothing to the answer:
 * no request rows, no scope counts, no lanes or tool names, no token sums —
 * and its child log is never opened on the query's behalf.
 */
export interface ScopeFilter {
  readonly scopes?: readonly string[]
}

/**
 * The refusal half of a single-object scoped read: the address resolved to
 * captured content, but the query's {@link ScopeFilter} excluded the scope
 * holding it. Distinct from `undefined` (no such address) so a filtering
 * caller never renders one as the other — the refusal confirms the address
 * exists and carries nothing of the excluded scope.
 */
export interface ScopedRefusal {
  readonly refused: 'no-authorized-content'
  /** The answering instance's epoch — same restart-invalidation role as on the result envelopes. */
  readonly generation?: string
}

/** `listTurns` payload: the turn rows plus the session's backfill watermark. */
export interface ListTurnsResult {
  turns: TurnListItem[]
  backfill: BackfillInfo
  /**
   * The answering instance's epoch (a mount-time id). Request `seq` values
   * are process-local and reset on restart: a caller holding seqs across
   * calls tags them with the generation of the result that yielded them and
   * treats a changed generation as invalidating every held seq — an old seq
   * must never silently resolve to a different request.
   */
  generation?: string
  /**
   * Turns this session collected and later evicted under the retention caps
   * — the "collected then dropped" signal next to the backfill watermark,
   * present only when non-zero. Blind spot: a session whose last turn
   * evicts frees its whole slot, so fully-evicted reads exactly like
   * never-seen (the store cannot tell the two apart).
   */
  evictedTurnCount?: number
  /**
   * Present exactly when the query carried a {@link ScopeFilter}: the
   * authorized scopes that exist in the session. An empty array is the
   * explicit zero-authorized-content signal — distinct from the field's
   * absence (unfiltered) and from unknown-session emptiness.
   */
  authorizedScopes?: readonly string[]
}

/** `getTurn` payload: scopes with request headers but without segments. */
export interface TurnOverview {
  turn: TurnListItem
  scopes: AgentScopeOverview[]
  /** The answering instance's epoch — see {@link ListTurnsResult.generation}. */
  generation?: string
  /**
   * Present exactly when the query carried a {@link ScopeFilter}: this
   * turn's authorized scopes. An empty array means the turn exists but the
   * filter excluded every scope on it (the turn row's own fields are
   * session-level metadata and still answer).
   */
  authorizedScopes?: readonly string[]
}

/** Scope with light request rows (the left request list). */
export interface AgentScopeOverview {
  scopeId: string
  /** Per-session 1-based ordinal in scope-creation order (the chip's `#N`). */
  scopeSeq: number
  kind: 'main' | 'subagent'
  label?: string
  status: 'running' | 'ok' | 'failed'
  error?: string
  config: RequestConfig
  startedAt: number
  endedAt?: number
  /**
   * Fidelity marker: where this scope's captured content came from (the two
   * lanes are mutually exclusive per scope — whichever fills first owns it).
   * Absent while the scope holds no captured content yet.
   */
  origin?: CaptureOrigin
  requests: RequestListItem[]
}

/** `getTurn` request row — everything the left list card shows. */
export interface RequestListItem {
  requestNumber?: number
  /** Per-request snapshot; never substitute the scope’s latest config. */
  config?: RequestConfig
  seq: number
  scopeId: string
  status: 'streaming' | 'ok' | 'failed'
  responseSummary: ResponseSummary
  startedAt: number
  usage?: RequestUsage
  totalMs?: number
  /** Logged compaction bracket, not an exact provider-call duration. */
  timingApproximate?: boolean
  /** 请求体总字符数（明细头右上）。 */
  totalChars: number
  toolErrors?: number
}

/** One turn's whole-turn timing view (the 耗时分布 tab). */
export interface TurnTiming {
  startedAt?: number
  turnSeq: number
  totalMs: number
  /** Six buckets summed across the turn's requests, in timeline order. */
  buckets: {
    waitMs: number
    reasoningMs: number
    toolArgsMs: number
    textMs: number
    toolExecMs: number
    otherMs: number
  }
  /** Strictly ordered lane entries for the timeline. */
  lanes: TimingLane[]
  /** Per-tool aggregation for the 按工具拆分 section. */
  tools: ToolTiming[]
  /** The answering instance's epoch — see {@link ListTurnsResult.generation}. */
  generation?: string
  /**
   * Present exactly when the query carried a {@link ScopeFilter}: this
   * turn's authorized scopes. An empty array means the turn exists but the
   * filter excluded every scope on it — buckets, lanes, and tools then
   * aggregate over nothing (the session-level `totalMs` still answers).
   */
  authorizedScopes?: readonly string[]
}

/** One entry on the timing timeline. */
export interface TimingLane {
  kind: 'wait' | 'reasoning' | 'tool-args' | 'text' | 'tool-exec' | 'other'
  /** Request seq this entry belongs to (click → token tab request). */
  requestSeq: number
  scopeId: string
  startedAt: number
  durationMs: number
  /** tool name for tool-exec lanes. */
  tool?: string
  callId?: string
  isError?: boolean
}

/** Per-tool timing aggregate. */
export interface ToolTiming {
  tool: string
  calls: number
  totalMs: number
  /** Sum of the model's argument-generation time for this tool's calls. */
  argsMs: number
}

/** Lightweight per-request session map, retaining the same scope authorization as all reads. */
export interface SessionTrend extends ListTurnsResult {
  requests: (RequestListItem & { turnSeq: number })[]
}
