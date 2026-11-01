/**
 * The book as a graph (2026-11-02): every chapter, setting, character,
 * relation, foreshadow, event and idea is a node; the references the data
 * already holds are the edges — an event is told in a chapter, happens at a
 * place, involves people, follows other events; a setting sits under
 * another; a faction has a base; a character has a faction and a home; a
 * relation pairs two characters; a chapter's plan uses settings, advances
 * events and casts people; a reconciled chapter found settings and moved
 * foreshadows; an idea is bound to an event.
 *
 * Nothing is stored: the graph is computed from the data each time, and the
 * reverse index (`into`) answers 「what points at this」 without walking the
 * book. Deleting a node and the 待对齐 list both read it.
 *
 * @module @khorsheed/dsh-canvas-novel
 */

export type NodeKind = 'chapter' | 'setting' | 'character' | 'relation' | 'foreshadow' | 'event' | 'idea'

export type EdgeKind =
  | 'told-in' // event → chapter that tells it
  | 'at' // event → setting it happens at
  | 'with' // event → character it involves
  | 'cause' // event → event it follows from
  | 'reveals' // derived reveal event → its foreshadow
  | 'parent' // setting → the setting it sits under
  | 'base' // faction → its base place
  | 'faction' // character → faction
  | 'home' // character → place
  | 'pair' // relation → character
  | 'uses' // chapter → setting (its plan's uses, or what its 对账 found)
  | 'advances' // chapter → event (its plan)
  | 'cast' // chapter → character (its plan's cast / pov)
  | 'moves' // chapter → foreshadow (planted / advanced / resolved there)
  | 'bound' // idea → event

export interface GraphNode {
  readonly id: string
  readonly kind: NodeKind
  readonly name: string
}

export interface GraphEdge {
  readonly from: string
  readonly to: string
  readonly kind: EdgeKind
}

/** What the graph is built from: plain rows, so the module stays pure. */
export interface GraphInput {
  readonly chapters: readonly {
    readonly n: number
    readonly title: string
    readonly written: boolean
    readonly settings?: readonly string[]
    readonly uses?: readonly string[]
    readonly advances?: readonly string[]
    readonly cast?: readonly string[]
  }[]
  readonly settings: readonly { readonly id: string; readonly name: string; readonly parents?: readonly string[]; readonly base?: readonly string[] }[]
  readonly characters: readonly { readonly id: string; readonly name: string; readonly factions?: readonly string[]; readonly homes?: readonly string[] }[]
  readonly relations: readonly { readonly id: string; readonly name: string; readonly pair: readonly string[] }[]
  readonly foreshadows: readonly { readonly id: string; readonly name: string; readonly chapters: readonly number[] }[]
  readonly events: readonly {
    readonly id: string
    readonly title: string
    readonly chapters?: readonly number[]
    readonly places?: readonly string[]
    readonly who?: readonly string[]
    readonly causes?: readonly string[]
    readonly foreshadowId?: string
  }[]
  readonly ideas: readonly { readonly id: string; readonly text: string; readonly eventId?: string }[]
}

export interface BookGraph {
  readonly nodes: ReadonlyMap<string, GraphNode>
  readonly edges: readonly GraphEdge[]
  /** Edges pointing at a node. */
  into(id: string): readonly GraphEdge[]
  /** Edges leaving a node. */
  out(id: string): readonly GraphEdge[]
}

/** A chapter's node id. */
export const chapterNode = (n: number): string => `ch:${n}`

/** The chapter number of a chapter node id, or undefined. */
export function chapterOfNode(id: string): number | undefined {
  const m = /^ch:(\d+)$/.exec(id)
  return m === null ? undefined : Number(m[1])
}

/** Build the graph; edges to nodes the book does not hold are dropped. */
export function buildGraph(input: GraphInput): BookGraph {
  const nodes = new Map<string, GraphNode>()
  const add = (id: string, kind: NodeKind, name: string): void => { if (!nodes.has(id)) nodes.set(id, { id, kind, name }) }
  for (const row of input.chapters) add(chapterNode(row.n), 'chapter', row.title)
  for (const row of input.settings) add(row.id, 'setting', row.name)
  for (const row of input.characters) add(row.id, 'character', row.name)
  for (const row of input.relations) add(row.id, 'relation', row.name)
  for (const row of input.foreshadows) add(row.id, 'foreshadow', row.name)
  for (const row of input.events) add(row.id, 'event', row.title)
  for (const row of input.ideas) add(row.id, 'idea', row.text.length > 24 ? `${row.text.slice(0, 24)}…` : row.text)

  const edges: GraphEdge[] = []
  const seen = new Set<string>()
  const link = (from: string, to: string, kind: EdgeKind): void => {
    const key = `${from}>${to}>${kind}`
    if (from === to || seen.has(key) || !nodes.has(from) || !nodes.has(to)) return
    seen.add(key)
    edges.push({ from, to, kind })
  }
  for (const row of input.events) {
    for (const n of row.chapters ?? []) link(row.id, chapterNode(n), 'told-in')
    for (const id of row.places ?? []) link(row.id, id, 'at')
    for (const id of row.who ?? []) link(row.id, id, 'with')
    for (const id of row.causes ?? []) link(row.id, id, 'cause')
    if (row.foreshadowId !== undefined) link(row.id, row.foreshadowId, 'reveals')
  }
  for (const row of input.settings) {
    for (const id of row.parents ?? []) link(row.id, id, 'parent')
    for (const id of row.base ?? []) link(row.id, id, 'base')
  }
  for (const row of input.characters) {
    for (const id of row.factions ?? []) link(row.id, id, 'faction')
    for (const id of row.homes ?? []) link(row.id, id, 'home')
  }
  for (const row of input.relations) for (const id of row.pair) link(row.id, id, 'pair')
  for (const row of input.chapters) {
    const ch = chapterNode(row.n)
    for (const id of [...row.settings ?? [], ...row.uses ?? []]) link(ch, id, 'uses')
    for (const id of row.advances ?? []) link(ch, id, 'advances')
    for (const id of row.cast ?? []) link(ch, id, 'cast')
  }
  for (const row of input.foreshadows) for (const n of row.chapters) link(chapterNode(n), row.id, 'moves')
  for (const row of input.ideas) if (row.eventId !== undefined) link(row.id, row.eventId, 'bound')

  const into = new Map<string, GraphEdge[]>()
  const out = new Map<string, GraphEdge[]>()
  for (const edge of edges) {
    into.set(edge.to, [...into.get(edge.to) ?? [], edge])
    out.set(edge.from, [...out.get(edge.from) ?? [], edge])
  }
  return { nodes, edges, into: id => into.get(id) ?? [], out: id => out.get(id) ?? [] }
}

/** What deleting a node does: the fixes made at once, and the written chapters that still carry it. */
export interface DeleteImpact {
  readonly node: GraphNode
  /** Fixes the rules make at once (no model). */
  readonly auto: readonly DeleteFix[]
  /** Written chapters whose text still carries the node: the 待对齐 list asks about them. */
  readonly chapters: readonly number[]
}

export type DeleteFix =
  | { readonly kind: 'move-up'; readonly id: string; readonly to: readonly string[] } // a child setting moves to the deleted one's parents
  | { readonly kind: 'unlink'; readonly id: string; readonly edge: EdgeKind } // drop the reference from that node
  | { readonly kind: 'drop'; readonly id: string } // delete that node too (a relation of a deleted person)
  | { readonly kind: 'unbind'; readonly id: string } // an idea comes off the event

/**
 * The impact of deleting one node, by the fixed rules: one step along the
 * edges that point at it. Written chapters that tell or use it are not
 * changed — they are what the person (and the agent) look at afterwards.
 */
export function deleteImpact(graph: BookGraph, id: string, written: ReadonlySet<number>): DeleteImpact | undefined {
  const node = graph.nodes.get(id)
  if (node === undefined) return undefined
  const auto: DeleteFix[] = []
  const chapters = new Set<number>()
  const parents = graph.out(id).filter(edge => edge.kind === 'parent').map(edge => edge.to)
  for (const edge of graph.into(id)) {
    switch (edge.kind) {
      case 'parent': auto.push({ kind: 'move-up', id: edge.from, to: parents }); break
      case 'pair': auto.push({ kind: 'drop', id: edge.from }); break
      case 'bound': auto.push({ kind: 'unbind', id: edge.from }); break
      case 'reveals': auto.push({ kind: 'drop', id: edge.from }); break
      case 'uses': case 'moves': case 'cast': case 'advances': {
        const n = chapterOfNode(edge.from)
        if (n !== undefined && written.has(n)) chapters.add(n)
        else auto.push({ kind: 'unlink', id: edge.from, edge: edge.kind })
        break
      }
      default: auto.push({ kind: 'unlink', id: edge.from, edge: edge.kind })
    }
  }
  if (node.kind === 'event') {
    for (const edge of graph.out(id)) {
      const n = edge.kind === 'told-in' ? chapterOfNode(edge.to) : undefined
      if (n !== undefined && written.has(n)) chapters.add(n)
    }
  }
  // An event that only happens at / involves the deleted node still stands: the reference goes.
  return { node, auto, chapters: [...chapters].sort((a, b) => a - b) }
}
