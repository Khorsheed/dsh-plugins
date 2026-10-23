/**
 * The team view's projection: who works for whom in a room, read from the
 * replayed state the client already holds. A room's members are standing
 * (one member takes many deliveries), so the member is the node and each
 * delivery it received hangs under it; edges count what flowed between two
 * members — tasks handed over, reports that came back, FYIs.
 *
 * The tree places every member under whoever handed it the most tasks (the
 * human included), walking out from the human so the result is always a
 * tree; a member nobody has tasked yet sits under the coordinator. Edges the
 * tree does not draw stay available as cross links.
 * @module @khorsheed/dsh-room/client/team
 */
import { coordinatorMember } from '../journal.ts'
import type { RoomDelivery, RoomMember, RoomState } from '../types.ts'

/** The human, as a tree root. */
export const TEAM_ROOT = 'you'

/** One delivery a member received. */
export interface TeamDelivery {
  readonly id: string
  readonly seq: number
  /** Sender name, or {@link TEAM_ROOT} for the human. */
  readonly from: string
  readonly text: string
  readonly status: RoomDelivery['status']
  readonly kind: 'task' | 'notify' | 'report'
}

/** One member node. */
export interface TeamNode {
  /** Member id (name for legacy members without one). */
  readonly id: string
  readonly member: RoomMember
  /** Parent node id, or {@link TEAM_ROOT}. */
  readonly parent: string
  readonly coordinator: boolean
  readonly status: 'running' | 'idle' | 'failed'
  /** The running delivery's task title, when running. */
  readonly current?: string
  readonly model?: string
  readonly tokens: number
  readonly elapsedMs: number
  readonly rounds: number
  /** Newest first. */
  readonly deliveries: readonly TeamDelivery[]
}

/** What flowed from one node to another. */
export interface TeamEdge {
  readonly from: string
  readonly to: string
  readonly tasks: number
  readonly reports: number
  readonly notifies: number
}

/** The whole projection. */
export interface Team {
  readonly nodes: readonly TeamNode[]
  readonly edges: readonly TeamEdge[]
  readonly totals: { readonly members: number; readonly running: number; readonly deliveries: number; readonly tokens: number; readonly elapsedMs: number }
}

const idOf = (member: RoomMember): string => member.id ?? member.name

/**
 * Project the room state into the team tree.
 * @param state - the replayed room state.
 * @returns nodes in tree order (parents before children), edges and totals.
 */
export function teamOf(state: RoomState): Team {
  const coordinator = coordinatorMember(state)
  const byId = new Map(state.members.map(member => [idOf(member), member]))
  const nameOf = (id: string): string => id === TEAM_ROOT ? TEAM_ROOT : byId.get(id)?.name ?? id
  const edges = new Map<string, { from: string; to: string; tasks: number; reports: number; notifies: number }>()
  const edge = (from: string, to: string) => {
    const key = `${from}\u0000${to}`
    let row = edges.get(key)
    if (row === undefined) edges.set(key, row = { from, to, tasks: 0, reports: 0, notifies: 0 })
    return row
  }
  const received = new Map<string, TeamDelivery[]>()
  for (const delivery of state.deliveries ?? []) {
    if (!byId.has(delivery.memberId) || delivery.origin === 'relay') continue
    const from = delivery.origin === 'human' ? TEAM_ROOT
      : delivery.origin === 'report' ? undefined
        : delivery.from ?? (delivery.origin === 'coordinator' && coordinator !== undefined ? idOf(coordinator) : undefined)
    const kind = delivery.origin === 'report' ? 'report' : delivery.kind === 'notify' ? 'notify' : 'task'
    if (from !== undefined && from !== delivery.memberId) {
      const row = edge(from, delivery.memberId)
      if (kind === 'notify') row.notifies++
      else {
        row.tasks++
        if (delivery.replyTo !== undefined && ['done', 'failed', 'cancelled', 'uncertain'].includes(delivery.status)) row.reports++
      }
    }
    const list = received.get(delivery.memberId) ?? []
    list.push({ id: delivery.id, seq: delivery.dispatchSeq, from: from === undefined ? '' : nameOf(from), text: delivery.text, status: delivery.status, kind })
    received.set(delivery.memberId, list)
  }

  // Parent = the source that handed this member the most tasks, placed by a
  // walk from the human so no cycle can form.
  const best = new Map<string, string>()
  for (const member of state.members) {
    const id = idOf(member)
    if (coordinator !== undefined && id === idOf(coordinator)) continue
    const top = [...edges.values()].filter(row => row.to === id && row.tasks > 0).sort((a, b) => b.tasks - a.tasks)[0]
    if (top !== undefined) best.set(id, top.from)
  }
  const parent = new Map<string, string>()
  const order: string[] = []
  const queue = [TEAM_ROOT]
  if (coordinator !== undefined) { parent.set(idOf(coordinator), TEAM_ROOT) }
  while (queue.length > 0) {
    const at = queue.shift()!
    const children = at === TEAM_ROOT && coordinator !== undefined
      ? [idOf(coordinator), ...state.members.map(idOf).filter(id => best.get(id) === TEAM_ROOT)]
      : state.members.map(idOf).filter(id => best.get(id) === at)
    for (const child of children) {
      if (order.includes(child)) continue
      parent.set(child, at)
      order.push(child)
      queue.push(child)
    }
  }
  for (const member of state.members) {
    const id = idOf(member)
    if (order.includes(id)) continue
    parent.set(id, coordinator !== undefined && idOf(coordinator) !== id ? idOf(coordinator) : TEAM_ROOT)
    order.push(id)
  }

  const nodes = order.map((id): TeamNode => {
    const member = byId.get(id)!
    const run = state.runs.find(entry => entry.member === member.name)
    const executions = (state.executions ?? []).filter(row => row.memberId === id)
    const current = run?.state === 'running'
      ? (state.deliveries ?? []).find(row => row.memberId === id && row.status === 'running' && (run.runId === undefined || row.id === run.runId))?.text.trim().split('\n', 1)[0]
      : undefined
    const model = executions.findLast(row => row.model !== undefined)?.model ?? member.model
    return {
      id, member, parent: parent.get(id) ?? TEAM_ROOT,
      coordinator: coordinator !== undefined && idOf(coordinator) === id,
      status: run?.state === 'running' ? 'running' : run?.state === 'failed' ? 'failed' : 'idle',
      ...current === undefined ? {} : { current },
      ...model === undefined ? {} : { model },
      tokens: executions.reduce((sum, row) => sum + (row.tokens ?? 0), 0),
      elapsedMs: executions.reduce((sum, row) => sum + (row.elapsedMs ?? 0), 0),
      rounds: executions.length,
      deliveries: (received.get(id) ?? []).slice().reverse(),
    }
  })
  return {
    nodes,
    edges: [...edges.values()],
    totals: {
      members: nodes.length,
      running: nodes.filter(node => node.status === 'running').length,
      deliveries: (state.deliveries ?? []).filter(row => row.origin !== 'report' && row.origin !== 'relay').length,
      tokens: nodes.reduce((sum, node) => sum + node.tokens, 0),
      elapsedMs: nodes.reduce((sum, node) => sum + node.elapsedMs, 0),
    },
  }
}

/** Compact token count: 1.2M / 288k / 512. */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`
  return String(tokens)
}
