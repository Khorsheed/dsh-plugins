/**
 * The request-inspector data model — the single contract between the host
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
 * @module @khorsheed/dsh-request-inspector/types
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

/** One message row inside a request's four-segment breakdown. */
export interface SegmentItem {
  /**
   * Position in the wire message stream (0-based across the whole request).
   * `-1` marks the one-shot system slot (`GenerateOptions.system`), which sits
   * ahead of the message array rather than inside it.
   */
  index: number
  category: SegmentCategory
  /** 角色/来源标签：model、runtime-context、skill-catalog、section 名等。 */
  source: string
  /** Tool calls this assistant row issued (the chip on assistant rows). */
  toolCalls?: string[]
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
}

/**
 * 明细头锚点：本请求的响应干了什么，结构化承载（面板负责本地化与拼装）。
 * 来自响应流的 tool-call / text blocks。
 */
export type ResponseSummary =
  /**
   * 响应以工具调用收尾：`name` 为首个调用的工具名，`hint` 为其参数摘要
   *（what → 文件 basename → for → description），`more` 为其余调用的个数。
   */
  | { kind: 'tool'; name: string; hint?: string; more?: number }
  /** 直接回答（有可见文本、无工具调用）。 */
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
  toolCalls: { name: string; arguments: string }[]
}

/** One model call, fully captured. */
export interface CapturedRequest {
  /** Collector-assigned process-wide monotonic sequence (the panel's `#784`). */
  seq: number
  scopeId: string
  sessionId: string
  purpose?: string
  startedAt: number
  status: 'streaming' | 'ok' | 'failed'
  error?: string
  config: RequestConfig
  usage?: RequestUsage
  timing: RequestTiming
  /**
   * 明细头锚点：本请求的响应干了什么（结构化；面板本地化渲染为
   * `name:hint` / 「直接回答」 / —）。
   */
  responseSummary: ResponseSummary
  /**
   * 本请求自己的响应原文（输出段）：streaming 中缺席；在任何 block 之前
   * 就失败的调用也缺席（error 字段承担失败展示）。一个 turn 的最后一次
   * 请求的响应只在这里可见（下一请求的 新增上下文 看不到它）。
   */
  response?: CapturedResponse
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

/** `listTurns` row — deliberately light (no segments, no request payloads). */
export interface TurnListItem {
  sessionId: string
  /**
   * The panel-facing address. Real turns key on the host's own turn number
   * (stable across live capture and log backfill); purpose pseudo-turns
   * (compaction / session-title buckets) take negative addresses.
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

/** `listTurns` payload: the turn rows plus the session's backfill watermark. */
export interface ListTurnsResult {
  turns: TurnListItem[]
  backfill: BackfillInfo
}

/** `getTurn` payload: scopes with request headers but without segments. */
export interface TurnOverview {
  turn: TurnListItem
  scopes: AgentScopeOverview[]
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
  requests: RequestListItem[]
}

/** `getTurn` request row — everything the left list card shows. */
export interface RequestListItem {
  seq: number
  scopeId: string
  status: 'streaming' | 'ok' | 'failed'
  responseSummary: ResponseSummary
  startedAt: number
  usage?: RequestUsage
  totalMs?: number
  /** 请求体总字符数（明细头右上）。 */
  totalChars: number
}

/** One turn's whole-turn timing view (the 耗时分布 tab). */
export interface TurnTiming {
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
}

/** Per-tool timing aggregate. */
export interface ToolTiming {
  tool: string
  calls: number
  totalMs: number
  /** Sum of the model's argument-generation time for this tool's calls. */
  argsMs: number
}
