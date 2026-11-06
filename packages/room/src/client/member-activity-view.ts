/**
 * Members' background activity as pure state (member-self-started-rounds M2):
 * local-agent's `memberBackgroundTasks` reads, one per CLI member, folded
 * into what each surface shows — the composer's 「后台 N」 capsule and its
 * tray, the members page's one read-only line, and the member session's
 * cards. Background commands and (later) background subagents share it: one
 * status vocabulary (运行中 · 完成 · 失败 · 失去联系 · 已取消), one card
 * shell, one tray. Kept apart from the components so every state is
 * testable without rendering.
 *
 * Only facts reach a surface: a member whose harness answers
 * `supported: false` (or no read at all) shows nothing — never 「0」; a
 * dispatcher appears only when the room's own records name the execution
 * that started the task; a lost task's duration only when its end is known.
 */
import type { LocalAgentBackgroundTask, LocalAgentBackgroundTasks } from '@khorsheed/dsh-local-agent/types'
import type { RoomMember, RoomState } from '../types.ts'

/** The five statuses every activity surface shares. */
export type ActivityStatus = 'running' | 'done' | 'failed' | 'lost' | 'cancelled'

/** A background command, or a subagent the CLI runs in the background. */
export type ActivityKind = 'command' | 'subagent'

/** Whose task started it: the human (你), or a member by name. */
export type ActivityDispatcher = { readonly kind: 'human' } | { readonly kind: 'member'; readonly name: string }

/** One background task as every surface reads it. */
export interface ActivityItem {
  readonly id: string
  readonly member: string
  readonly childSessionId: string
  readonly kind: ActivityKind
  readonly label: string
  readonly status: ActivityStatus
  /** The CLI ended it on its timeout (status `failed`). */
  readonly timedOut?: true
  readonly startedAt: number
  readonly endedAt?: number
  readonly exitCode?: number
  readonly command?: string
  readonly outputTail?: readonly string[]
  /** The tool call that started it (the member session places its card there). */
  readonly callId?: string
  readonly dispatcher?: ActivityDispatcher
  readonly lostBecause?: LocalAgentBackgroundTask['lostBecause']
  /** When the round that took its result began (the room's record of that execution). */
  readonly resultAt?: number
}

/** One member's local-agent read, as the room holds it. */
export interface ActivityRead {
  readonly member: RoomMember
  /** null = not a family member; undefined = no family, no method, or a failed read. */
  readonly read: LocalAgentBackgroundTasks | null | undefined
}

/** One tray group: a member with at least one listed task. */
export interface ActivityGroup {
  readonly member: string
  readonly provider?: string
  readonly childSessionId: string
  /** 进程最晚保留到 HH:MM — only while the process is up and a limit is scheduled. */
  readonly keepAliveUntil?: number
  readonly items: readonly ActivityItem[]
}

/** The composer capsule: hidden, a running count, or the amber lost variant. */
export type ActivityStripState =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'running'; readonly running: number }
  | { readonly kind: 'lost'; readonly running: number; readonly lost: number }

/** The members page line for one member. */
export type MemberActivityLineState =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'counts'; readonly commands: number; readonly subagents: number }
  | { readonly kind: 'lost'; readonly lost: number }

/** What a tray item's link says; every one jumps to the member session's card. */
export type ActivityAction = 'output' | 'open' | 'look' | 'view'

const STATUS: Readonly<Record<LocalAgentBackgroundTask['state'], ActivityStatus>> = {
  running: 'running',
  completed: 'done',
  failed: 'failed',
  'timed-out': 'failed',
  stopped: 'cancelled',
  lost: 'lost',
}

/** The room's records of executions: durable history first, then the live runs. */
function executionsOf(room: RoomState | undefined): ReadonlyArray<{ readonly executionId?: string; readonly runId?: string; readonly id?: string; readonly startedAt: number }> {
  if (room === undefined) return []
  return [...room.executions ?? [], ...room.runs]
}

/**
 * Who dispatched the work whose execution started a task: the room's
 * execution record with that execution id → its delivery → the human or the
 * sending member. Undefined at any missing link (started from the member
 * page, before the room recorded execution ids, another room).
 * @param room - the room state.
 * @param executionId - the task's `startedBy`.
 */
export function dispatcherOf(room: RoomState | undefined, executionId: string | undefined): ActivityDispatcher | undefined {
  if (room === undefined || executionId === undefined) return undefined
  const execution = executionsOf(room).find(entry => entry.executionId === executionId)
  const runId = execution?.runId ?? execution?.id
  if (runId === undefined) return undefined
  const delivery = room.deliveries?.find(entry => entry.id === runId)
  if (delivery === undefined) return undefined
  if (delivery.origin === 'human') return { kind: 'human' }
  if (delivery.origin !== 'coordinator' && delivery.origin !== 'member') return undefined
  const sender = room.members.find(member => member.id === delivery.from)
  return sender === undefined ? undefined : { kind: 'member', name: sender.name }
}

/**
 * One task as a surface reads it.
 * @param task - local-agent's task.
 * @param member - the member's name.
 * @param childSessionId - the member's session.
 * @param room - the room state (dispatcher and result lookups), when known.
 */
export function activityItem(task: LocalAgentBackgroundTask, member: string, childSessionId: string, room?: RoomState): ActivityItem {
  const dispatcher = dispatcherOf(room, task.startedBy)
  const resultAt = task.resultIn === undefined ? undefined : executionsOf(room).find(entry => entry.executionId === task.resultIn)?.startedAt
  return {
    id: task.id,
    member,
    childSessionId,
    kind: task.kind === 'agent' ? 'subagent' : 'command',
    label: task.label,
    status: STATUS[task.state],
    ...task.state === 'timed-out' ? { timedOut: true as const } : {},
    startedAt: task.startedAt,
    ...task.endedAt === undefined ? {} : { endedAt: task.endedAt },
    ...task.exitCode === undefined ? {} : { exitCode: task.exitCode },
    ...task.command === undefined ? {} : { command: task.command },
    ...task.outputTail === undefined || task.outputTail.length === 0 ? {} : { outputTail: task.outputTail },
    ...task.callId === undefined ? {} : { callId: task.callId },
    ...dispatcher === undefined ? {} : { dispatcher },
    ...task.lostBecause === undefined ? {} : { lostBecause: task.lostBecause },
    ...resultAt === undefined ? {} : { resultAt },
  }
}

/** A read the surfaces may show: a family member whose harness supports background tasks. */
function shown(read: LocalAgentBackgroundTasks | null | undefined): read is LocalAgentBackgroundTasks {
  return read !== null && read !== undefined && read.supported
}

/**
 * The tray's groups, in roster order: each supported member with at least one
 * listed task. An unsupported or unread member is left out entirely.
 * @param reads - one read per CLI member.
 * @param room - the room state.
 */
export function activityGroups(reads: readonly ActivityRead[], room?: RoomState): ActivityGroup[] {
  const groups: ActivityGroup[] = []
  for (const { member, read } of reads) {
    const child = member.childSessionId
    if (child === undefined || !shown(read) || read.tasks.length === 0) continue
    groups.push({
      member: member.name,
      ...member.provider === undefined ? {} : { provider: member.provider },
      childSessionId: child,
      ...read.processAlive && read.keepAliveUntil !== undefined ? { keepAliveUntil: read.keepAliveUntil } : {},
      items: read.tasks.map(task => activityItem(task, member.name, child, room)),
    })
  }
  return groups
}

/** Running and lost counts across the tray. */
export function activityTotals(groups: readonly ActivityGroup[]): { readonly running: number; readonly lost: number } {
  let running = 0
  let lost = 0
  for (const item of groups.flatMap(group => group.items)) {
    if (item.status === 'running') running += 1
    if (item.status === 'lost') lost += 1
  }
  return { running, lost }
}

/**
 * The composer capsule: 「后台 N」 counts what is running now; any lost task
 * turns it amber. Nothing running and nothing lost → no capsule (recently
 * ended tasks alone do not raise it).
 * @param groups - the tray groups.
 */
export function activityStrip(groups: readonly ActivityGroup[]): ActivityStripState {
  const { running, lost } = activityTotals(groups)
  if (lost > 0) return { kind: 'lost', running, lost }
  if (running > 0) return { kind: 'running', running }
  return { kind: 'hidden' }
}

/**
 * The members page line for one member: running commands and background
 * subagents, or the amber lost count. Hidden when unsupported, unread, or
 * nothing is running or lost.
 * @param read - the member's read.
 */
export function memberActivityLine(read: LocalAgentBackgroundTasks | null | undefined): MemberActivityLineState {
  if (!shown(read)) return { kind: 'hidden' }
  const lost = read.tasks.filter(task => task.state === 'lost').length
  if (lost > 0) return { kind: 'lost', lost }
  const running = read.tasks.filter(task => task.state === 'running')
  const commands = running.filter(task => task.kind === 'shell').length
  const subagents = running.length - commands
  return running.length === 0 ? { kind: 'hidden' } : { kind: 'counts', commands, subagents }
}

/**
 * How many background tasks a member's LIVE process runs now — what replacing
 * that process (reload, a model switch) would cut off. 0 for an unsupported,
 * unread or non-member read, and when no process is up (nothing to cut off).
 * @param read - the member's read.
 */
export function runningBackground(read: LocalAgentBackgroundTasks | null | undefined): number {
  if (!shown(read) || !read.processAlive) return 0
  return read.tasks.filter(task => task.state === 'running').length
}

/**
 * How long it ran: now − start while running; start → end once ended; a lost
 * task only when its end is known (we do not know when it stopped).
 * @param item - the item.
 * @param now - epoch ms.
 */
export function activityElapsed(item: ActivityItem, now: number): number | undefined {
  if (item.status === 'running') return Math.max(0, now - item.startedAt)
  if (item.endedAt === undefined) return undefined
  return Math.max(0, item.endedAt - item.startedAt)
}

/**
 * The tray item's link: 查看输出 (a running command), 打开 (a subagent),
 * 查看 (a lost command), 去看 (an ended one: the reply that took its result
 * follows its card).
 * @param item - the item.
 */
export function activityAction(item: ActivityItem): ActivityAction {
  if (item.kind === 'subagent') return 'open'
  if (item.status === 'running') return 'output'
  if (item.status === 'lost') return 'view'
  return 'look'
}

/**
 * The member session's cards for one turn: the member's background commands
 * whose starting tool call is one of the turn's calls. Subagent cards are
 * the CLI-subagent design's own and are not drawn here.
 * @param read - the member's read.
 * @param callIds - the turn's tool call ids.
 * @param member - the member's name ('' when the room is unknown).
 * @param childSessionId - the session the cards render in.
 * @param room - the room state, when known.
 */
export function sessionActivityItems(
  read: LocalAgentBackgroundTasks | null | undefined,
  callIds: ReadonlySet<string>,
  member: string,
  childSessionId: string,
  room?: RoomState,
): ActivityItem[] {
  if (!shown(read) || callIds.size === 0) return []
  return read.tasks
    .filter(task => task.kind === 'shell' && task.callId !== undefined && callIds.has(task.callId))
    .map(task => activityItem(task, member, childSessionId, room))
}

/**
 * Split a duration into the parts the copy needs: under a minute in
 * seconds, under an hour in minutes (with seconds when `precise`), then
 * hours and minutes.
 * @param ms - the duration.
 * @param precise - an ended task shows seconds too (3 分 05 秒); a running one whole minutes.
 */
export function durationParts(ms: number, precise: boolean): { readonly key: 'seconds' | 'minutes' | 'minutesSeconds' | 'hours'; readonly vars: Readonly<Record<string, string | number>> } {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return { key: 'seconds', vars: { s: seconds } }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return precise
      ? { key: 'minutesSeconds', vars: { m: minutes, s: String(seconds % 60).padStart(2, '0') } }
      : { key: 'minutes', vars: { m: minutes } }
  }
  return { key: 'hours', vars: { h: Math.floor(minutes / 60), m: minutes % 60 } }
}
