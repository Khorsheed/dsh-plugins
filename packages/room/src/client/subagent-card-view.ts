/**
 * A member CLI's own subagents as pure card state (member-cli-subagents M5;
 * UI source of truth: proposals/prototypes/member-activity.html, the
 * 「成员会话」 group and 「运行卡片 · 正在等子智能体」). The member session's
 * `Agent` / `AgentSwarm` (Kimi) and `Task` (Claude Code) calls read
 * local-agent's `memberSubagentCalls` — one entry per grandchild execution
 * whose cause names the call — and fold into one of:
 *
 * - **single**: one subagent (collapsed by default; expand = its ordered steps);
 * - **group**: an `AgentSwarm` call's subagents, one row each (expanded by default);
 * - **pending**: the call runs and the grandchild has not been written yet;
 * - **unsupported**: no grandchild for a settled call (an older log, a
 *   provider that does not mirror subagents, Codex phase 1) — 「暂不支持查看过程」;
 * - **fallback**: not a member session (or nothing read): the host's generic row.
 *
 * Kept apart from the components so every state is testable without rendering.
 */
import type { LocalAgentSubagentCall, LocalAgentSubagentCalls } from '@khorsheed/dsh-local-agent/types'
import type { ActivityItem, ActivityStatus } from './member-activity-view.ts'

/** One call's token usage (local-agent's TokenUsage: disjoint buckets). */
export type TokenUsage = NonNullable<LocalAgentSubagentCall['usage']>

/** The member tool names whose calls start a CLI subagent (Kimi `Agent`/`AgentSwarm`, Claude `Agent`/`Task`). */
export const SUBAGENT_TOOLS: readonly string[] = ['Agent', 'AgentSwarm', 'Task']

/**
 * Codex's own subagent spawn (multi_agent), as its live driver mirrors the
 * app-server `collabAgentToolCall` item. Phase 1 mirrors no grandchild for
 * it: the card always reads 「暂不支持查看过程」 (member-cli-subagents M8).
 */
export const CODEX_SUBAGENT_TOOLS: readonly string[] = ['collab/spawnAgent']

/** A group shows this many rows before 「另外 N 个」 (only past {@link GROUP_ROWS_ALL}). */
export const GROUP_ROWS_SHOWN = 5
/** Up to this many rows a group shows them all. */
export const GROUP_ROWS_ALL = 6

/** What a member call's arguments say about the subagent it starts. */
export interface SubagentCallArgs {
  readonly description?: string
  /** `subagent_type` (Claude, Kimi) or a profile name. */
  readonly type?: string
  readonly background?: boolean
  /** Kimi `resume`: the subagent id it continues. */
  readonly resume?: string
  /** `AgentSwarm`: how many subagents it asks for (`items`). */
  readonly count?: number
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

/**
 * Read a member call's arguments (raw JSON text). Unknown shapes read empty.
 * @param raw - the call's argument text.
 */
export function subagentCallArgs(raw: string | undefined): SubagentCallArgs {
  let args: Record<string, unknown> | undefined
  try { args = raw === undefined ? undefined : record(JSON.parse(raw)) } catch { args = undefined }
  if (args === undefined) return {}
  // Kimi AgentSwarm: `items` (with `prompt_template`); older shapes `tasks` / `agents`.
  const tasks = Array.isArray(args['items']) ? args['items'] : Array.isArray(args['tasks']) ? args['tasks'] : Array.isArray(args['agents']) ? args['agents'] : undefined
  const description = text(args['description']) ?? text(args['task_name']) ?? text(args['name'])
  const type = text(args['subagent_type']) ?? text(args['subagentType']) ?? text(args['profile'])
  const resume = text(args['resume'])
  return {
    ...description === undefined ? {} : { description },
    ...type === undefined ? {} : { type },
    ...args['run_in_background'] === true || args['runInBackground'] === true ? { background: true } : {},
    ...resume === undefined ? {} : { resume },
    ...tasks === undefined ? {} : { count: tasks.length },
  }
}

/** A Codex spawn's description: its prompt's first line. */
function codexPrompt(raw: string | undefined): string | undefined {
  let args: Record<string, unknown> | undefined
  try { args = raw === undefined ? undefined : record(JSON.parse(raw)) } catch { args = undefined }
  const line = text(args?.['prompt'])?.split('\n').map(part => part.trim()).find(part => part !== '')
  return line === undefined ? undefined : line.length > 80 ? `${line.slice(0, 79)}…` : line
}

/** One subagent as the card shell reads it. */
export interface SubagentEntry {
  readonly call: LocalAgentSubagentCall
  /** The shell's item (status, times; kind `subagent`). */
  readonly item: ActivityItem
}

/** The card state of one member call. */
export type SubagentCardModel =
  | { readonly kind: 'fallback' }
  | { readonly kind: 'pending'; readonly type?: string; readonly description?: string; readonly background: boolean; readonly startedAt?: number }
  | { readonly kind: 'unsupported'; readonly type?: string; readonly description?: string }
  | { readonly kind: 'single'; readonly entry: SubagentEntry; readonly background: boolean }
  | {
    readonly kind: 'group'
    readonly description?: string
    readonly entries: readonly SubagentEntry[]
    readonly status: ActivityStatus
    readonly counts: Readonly<Record<ActivityStatus, number>>
    readonly usage?: TokenUsage
  }

/** What the card knows about the call itself. */
export interface SubagentCallFacts {
  readonly callId: string
  readonly toolName: string
  /** The tool row's stage: a settled call has its result. */
  readonly phase: 'preparing' | 'start' | 'result'
  readonly argsRaw?: string
  /** When the call started (the tool row's own time), for a card with no record yet. */
  readonly startedAt?: number
}

/**
 * The shell item for one subagent call.
 * @param call - local-agent's call.
 * @param member - the member session id.
 * @param label - the card's description.
 */
export function subagentItem(call: LocalAgentSubagentCall, member: string, label: string): ActivityItem {
  return {
    id: `${call.callId}:${call.executionId}`,
    member: '',
    childSessionId: member,
    kind: 'subagent',
    label,
    status: call.state,
    startedAt: call.startedAt,
    ...call.endedAt === undefined ? {} : { endedAt: call.endedAt },
    callId: call.callId,
  }
}

const zeroCounts = (): Record<ActivityStatus, number> => ({ running: 0, done: 0, failed: 0, lost: 0, cancelled: 0 })

/** A group's status: running while any runs, then the worst end (lost, failed, cancelled), else done. */
export function groupStatus(counts: Readonly<Record<ActivityStatus, number>>): ActivityStatus {
  if (counts.running > 0) return 'running'
  if (counts.lost > 0) return 'lost'
  if (counts.failed > 0) return 'failed'
  if (counts.cancelled > 0 && counts.done === 0) return 'cancelled'
  return 'done'
}

/** Add two usages bucket by bucket. */
export function addTokens(sum: TokenUsage | undefined, usage: TokenUsage | undefined): TokenUsage | undefined {
  if (usage === undefined) return sum
  const add = (a: number | undefined, b: number | undefined): number | undefined => a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0)
  const cacheRead = add(sum?.cacheReadTokens, usage.cacheReadTokens)
  const cacheWrite = add(sum?.cacheWriteTokens, usage.cacheWriteTokens)
  return {
    inputTokens: (sum?.inputTokens ?? 0) + usage.inputTokens,
    outputTokens: (sum?.outputTokens ?? 0) + usage.outputTokens,
    ...cacheRead === undefined ? {} : { cacheReadTokens: cacheRead },
    ...cacheWrite === undefined ? {} : { cacheWriteTokens: cacheWrite },
  }
}

/** Every token the usage counts (the buckets are disjoint): 「已用」, 「合计」. */
export function totalTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

/**
 * The card for one member call.
 * @param facts - the call as its tool row has it.
 * @param read - the member's `memberSubagentCalls` read: null = not a member;
 *   undefined = not read (yet), no family, or a failed read.
 * @param member - the member session id.
 */
export function subagentCardModel(
  facts: SubagentCallFacts,
  read: LocalAgentSubagentCalls | null | undefined,
  member: string,
): SubagentCardModel {
  if (read === null || read === undefined) return { kind: 'fallback' }
  const args = subagentCallArgs(facts.argsRaw)
  if (CODEX_SUBAGENT_TOOLS.includes(facts.toolName)) {
    const prompt = codexPrompt(facts.argsRaw)
    return { kind: 'unsupported', ...prompt === undefined ? {} : { description: prompt } }
  }
  const calls = read.calls.filter(call => call.callId === facts.callId)
  if (calls.length === 0) {
    if (facts.phase === 'result') {
      return { kind: 'unsupported', ...args.type === undefined ? {} : { type: args.type }, ...args.description === undefined ? {} : { description: args.description } }
    }
    return {
      kind: 'pending',
      ...args.type === undefined ? {} : { type: args.type },
      ...args.description === undefined ? {} : { description: args.description },
      background: args.background === true,
      ...facts.startedAt === undefined ? {} : { startedAt: facts.startedAt },
    }
  }
  const grouped = facts.toolName === 'AgentSwarm' || calls.length > 1 || calls.some(call => call.group !== undefined && call.group.size > 1)
  if (!grouped) {
    const call = calls[0]!
    return {
      kind: 'single',
      entry: { call, item: subagentItem(call, member, call.description ?? args.description ?? '') },
      background: call.background === true || args.background === true,
    }
  }
  const ordered = [...calls].sort((a, b) => (a.group?.index ?? Number.MAX_SAFE_INTEGER) - (b.group?.index ?? Number.MAX_SAFE_INTEGER) || a.startedAt - b.startedAt)
  const counts = zeroCounts()
  let usage: TokenUsage | undefined
  for (const call of ordered) {
    counts[call.state] += 1
    usage = addTokens(usage, call.usage)
  }
  return {
    kind: 'group',
    ...args.description === undefined ? {} : { description: args.description },
    entries: ordered.map(call => ({ call, item: subagentItem(call, member, call.description ?? '') })),
    status: groupStatus(counts),
    counts,
    ...usage === undefined ? {} : { usage },
  }
}

/** The rows a group shows: all up to {@link GROUP_ROWS_ALL}, else the first {@link GROUP_ROWS_SHOWN} and how many more. */
export function groupRows<T>(entries: readonly T[]): { readonly shown: readonly T[]; readonly more: number } {
  if (entries.length <= GROUP_ROWS_ALL) return { shown: entries, more: 0 }
  return { shown: entries.slice(0, GROUP_ROWS_SHOWN), more: entries.length - GROUP_ROWS_SHOWN }
}

/**
 * The foreground subagent a member's running round waits for (the room run
 * card's 「正在等子智能体：探索 · 6 分钟」): the latest running, non-background
 * call that started in this round — the round's own execution when both
 * sides name it, else any started after the round did.
 * @param read - the member's read.
 * @param round - the round's start and, when known, its execution id.
 */
export function foregroundWait(
  read: LocalAgentSubagentCalls | null | undefined,
  round: { readonly startedAt: number; readonly executionId?: string | undefined },
): LocalAgentSubagentCall | undefined {
  if (read === null || read === undefined) return undefined
  const running = read.calls.filter(call => call.state === 'running' && call.background !== true && call.startedAt >= round.startedAt - 1000)
  return running.reduce<LocalAgentSubagentCall | undefined>((latest, call) => latest === undefined || call.startedAt > latest.startedAt ? call : latest, undefined)
}

/**
 * Whether a card still needs fresh reads: the call runs (or has no record
 * yet while its row runs), or one of its subagents runs. A settled call with
 * no record is read a few more times (the mirror can land just after the
 * member's result), then left alone.
 * @param model - the card state.
 * @param facts - the call.
 * @param reads - how many reads of the member landed so far.
 */
export function cardWantsPolling(model: SubagentCardModel, facts: SubagentCallFacts, reads: number): boolean {
  switch (model.kind) {
    case 'fallback': return reads === 0
    case 'pending': return true
    case 'unsupported': return reads < 3 && !CODEX_SUBAGENT_TOOLS.includes(facts.toolName)
    case 'single': return model.entry.call.state === 'running'
    case 'group': return model.status === 'running' || facts.phase !== 'result'
  }
}
