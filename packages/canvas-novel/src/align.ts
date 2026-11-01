/**
 * 待对齐 (2026-11-02): what changed since the book was last aligned, and
 * what each change touches — without walking the book.
 *
 * At each alignment every node of the graph (graph.ts) gets a fingerprint,
 * its kind and name, and the written chapters that carry it; each written
 * chapter's text is kept as it was. A change is a node whose fingerprint
 * differs now, or that is gone. It does not matter where the change came
 * from — the 设定 page, the canvas's card page, a file edited by hand, a
 * tool — and a node edited five times is one change; edited back, none.
 *
 * Each change follows one step of the graph to the written chapters it
 * touches and takes from them only the paragraphs that name it (or, for a
 * chapter's own text, the paragraphs that changed). That, and nothing more,
 * is what the agent reads.
 *
 * @module @khorsheed/dsh-canvas-novel
 */
import { chapterNode, chapterOfNode, type BookGraph, type NodeKind } from './graph.ts'

/** One node as the last alignment saw it. */
export interface AlignedNode {
  readonly fp: string
  readonly kind: NodeKind
  readonly name: string
  /** Written chapters that carried it then. */
  readonly chapters: readonly number[]
}

/** The baseline: the book as last aligned. */
export interface AlignDoc {
  /** 2: card fingerprints leave the category out (2026-11-02); an older baseline is retaken. */
  readonly version: 1 | 2
  readonly at: string
  readonly nodes: Readonly<Record<string, AlignedNode>>
  /** Written chapters' text as last aligned. */
  readonly bodies: Readonly<Record<string, string>>
}

/** One node now: its fingerprint (and, for a chapter, its text). */
export interface NodeNow {
  readonly fp: string
  readonly body?: string
}

/** One change that needs the agent. */
export interface AlignItem {
  /** The changed node. */
  readonly node: string
  readonly kind: NodeKind
  readonly name: string
  readonly change: 'changed' | 'removed' | 'text'
  /** Written chapters it touches. */
  readonly chapters: readonly number[]
  /** For a chapter's text: how many paragraphs changed, and the share of the text. */
  readonly paragraphs?: number
  readonly share?: number
  /** Nodes one step away, by edge, for the little graph. */
  readonly near: readonly { readonly label: string; readonly names: readonly string[] }[]
  /** The passages to read: ≤ 6, each ≤ 160 chars. */
  readonly passages: readonly { readonly chapter: number; readonly text: string }[]
}

/** A change the rules settled without the agent. */
export interface AlignAuto {
  readonly node: string
  readonly name: string
  readonly change: 'changed' | 'removed'
  readonly kind: NodeKind
}

/** FNV-1a over a stable JSON: a fingerprint, not a secret. */
export function fingerprint(value: unknown): string {
  const text = stable(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${text.length.toString(36)}-${hash.toString(36)}`
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined).map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** A text's paragraphs (blank-line or line separated), trimmed, empties dropped. */
export function paragraphs(text: string): string[] {
  return text.split(/\n+/).map(row => row.trim()).filter(Boolean)
}

/** The paragraphs of `now` not in `was`, and the share of `now` they make up. */
export function changedParagraphs(was: string, now: string): { readonly rows: readonly string[]; readonly share: number } {
  const before = new Set(paragraphs(was))
  const rows = paragraphs(now).filter(row => !before.has(row))
  const removed = paragraphs(was).filter(row => !paragraphs(now).includes(row))
  const size = Math.max(1, now.replace(/\s+/g, '').length)
  const touched = rows.reduce((sum, row) => sum + row.replace(/\s+/g, '').length, 0) + (rows.length === 0 ? removed.reduce((sum, row) => sum + row.replace(/\s+/g, '').length, 0) : 0)
  return { rows, share: Math.min(1, touched / size) }
}

/** Names a passage may use for a node: its name, and its name less 「（工作稿）」 and a trailing 世界 / 梦域. */
export function namesFor(name: string): string[] {
  const bare = name.replace(/[（(][^）)]*[）)]/g, '').trim()
  const short = bare.replace(/(世界|梦域)$/u, '')
  const head = bare.split(/[：:]/)[0]!.trim()
  return [...new Set([bare, short, head].filter(item => item.length >= 2))]
}

/** Paragraphs of a text that name any of `names`, clipped around the first hit. */
export function passagesNaming(text: string, names: readonly string[], max = 3): string[] {
  const out: string[] = []
  for (const row of paragraphs(text)) {
    const at = Math.min(...names.map(name => row.indexOf(name)).filter(index => index >= 0))
    if (!Number.isFinite(at)) continue
    out.push(clip(row, at))
    if (out.length >= max) break
  }
  return out
}

function clip(row: string, at: number): string {
  if (row.length <= 160) return row
  const start = Math.max(0, Math.min(at - 50, row.length - 160))
  return `${start > 0 ? '……' : ''}${row.slice(start, start + 160)}${start + 160 < row.length ? '……' : ''}`
}

const EDGE_LABEL: Readonly<Record<string, string>> = {
  'told-in': '写在', at: '发生在这', with: '参与的事件', cause: '引出', reveals: '揭晓', parent: '下属', base: '以此为据点',
  faction: '成员', home: '常在这里', pair: '关系', uses: '写到它的章节', advances: '推进它的章节', cast: '出场章节', moves: '推进过的章节', bound: '绑定的灵感',
}

/**
 * The changes since `doc`, split into what needs the agent and what the
 * rules settled. A node added since does not count: nothing written yet
 * points at it.
 */
export function alignChanges(
  doc: AlignDoc,
  graph: BookGraph,
  now: ReadonlyMap<string, NodeNow>,
  written: ReadonlySet<number>,
  bodies: ReadonlyMap<number, string>,
): { readonly items: readonly AlignItem[]; readonly auto: readonly AlignAuto[] } {
  const items: AlignItem[] = []
  const auto: AlignAuto[] = []
  const near = (id: string): AlignItem['near'] => {
    const groups = new Map<string, string[]>()
    for (const edge of graph.into(id)) {
      const label = EDGE_LABEL[edge.kind] ?? edge.kind
      groups.set(label, [...groups.get(label) ?? [], graph.nodes.get(edge.from)?.name ?? edge.from])
    }
    for (const edge of graph.out(id).filter(edge => edge.kind === 'told-in')) {
      groups.set('写在', [...groups.get('写在') ?? [], graph.nodes.get(edge.to)?.name ?? edge.to])
    }
    return [...groups].map(([label, names]) => ({ label, names: names.slice(0, 6) }))
  }
  const carriedBy = (id: string): number[] => {
    const out = new Set<number>()
    for (const edge of graph.into(id)) {
      const n = chapterOfNode(edge.from)
      if (n !== undefined && written.has(n)) out.add(n)
    }
    for (const edge of graph.out(id)) {
      const n = edge.kind === 'told-in' ? chapterOfNode(edge.to) : undefined
      if (n !== undefined && written.has(n)) out.add(n)
    }
    return [...out].sort((a, b) => a - b)
  }
  const passages = (chapters: readonly number[], name: string): AlignItem['passages'] => {
    const names = namesFor(name)
    return chapters.flatMap(n => passagesNaming(bodies.get(n) ?? '', names, 2).map(text => ({ chapter: n, text }))).slice(0, 6)
  }

  for (const [id, was] of Object.entries(doc.nodes)) {
    const current = now.get(id)
    const n = chapterOfNode(id)
    if (n !== undefined) {
      if (current === undefined || current.body === undefined || !written.has(n)) continue
      const before = doc.bodies[String(n)]
      if (before === undefined || current.fp === was.fp) continue
      const diff = changedParagraphs(before, current.body)
      items.push({
        node: id, kind: 'chapter', name: graph.nodes.get(id)?.name ?? was.name, change: 'text', chapters: [n],
        paragraphs: diff.rows.length, share: diff.share, near: near(id),
        passages: diff.rows.slice(0, 6).map(text => ({ chapter: n, text: clip(text, 0) })),
      })
      continue
    }
    if (current !== undefined && current.fp === was.fp) continue
    if (current === undefined) {
      const chapters = was.chapters.filter(c => written.has(c))
      if (chapters.length === 0) { auto.push({ node: id, name: was.name, change: 'removed', kind: was.kind }); continue }
      items.push({ node: id, kind: was.kind, name: was.name, change: 'removed', chapters, near: [], passages: passages(chapters, was.name) })
      continue
    }
    const chapters = carriedBy(id)
    // An idea, a relation's numbers or an event no written chapter tells: nothing in the text to check.
    if (chapters.length === 0 || was.kind === 'idea') { auto.push({ node: id, name: graph.nodes.get(id)?.name ?? was.name, change: 'changed', kind: was.kind }); continue }
    const name = graph.nodes.get(id)?.name ?? was.name
    items.push({ node: id, kind: was.kind, name, change: 'changed', chapters, near: near(id), passages: passages(chapters, name) })
  }
  return { items, auto }
}

/** A fresh baseline from the book as it is now. */
export function baselineOf(graph: BookGraph, now: ReadonlyMap<string, NodeNow>, written: ReadonlySet<number>, at: string): AlignDoc {
  const nodes: Record<string, AlignedNode> = {}
  const bodies: Record<string, string> = {}
  for (const [id, node] of graph.nodes) {
    const current = now.get(id)
    if (current === undefined) continue
    nodes[id] = { fp: current.fp, kind: node.kind, name: node.name, chapters: chaptersOf(graph, id, written) }
    const n = chapterOfNode(id)
    if (n !== undefined && current.body !== undefined) bodies[String(n)] = current.body
  }
  return { version: 2, at, nodes, bodies }
}

/** The baseline with some nodes brought up to now (or dropped when gone). */
export function ackNodes(doc: AlignDoc, ids: readonly string[], graph: BookGraph, now: ReadonlyMap<string, NodeNow>, written: ReadonlySet<number>, at: string): AlignDoc {
  const nodes = { ...doc.nodes }
  const bodies = { ...doc.bodies }
  for (const id of ids) {
    const current = now.get(id)
    const node = graph.nodes.get(id)
    const n = chapterOfNode(id)
    if (current === undefined || node === undefined) {
      delete nodes[id]
      if (n !== undefined) delete bodies[String(n)]
      continue
    }
    nodes[id] = { fp: current.fp, kind: node.kind, name: node.name, chapters: chaptersOf(graph, id, written) }
    if (n !== undefined && current.body !== undefined) bodies[String(n)] = current.body
  }
  return { ...doc, at, nodes, bodies }
}

function chaptersOf(graph: BookGraph, id: string, written: ReadonlySet<number>): number[] {
  const out = new Set<number>()
  for (const edge of graph.into(id)) { const n = chapterOfNode(edge.from); if (n !== undefined && written.has(n)) out.add(n) }
  for (const edge of graph.out(id)) { const n = edge.kind === 'told-in' ? chapterOfNode(edge.to) : undefined; if (n !== undefined && written.has(n)) out.add(n) }
  return [...out].sort((a, b) => a - b)
}

/** The baseline version this code writes; an older one is retaken whole. */
export const ALIGN_VERSION = 2

/** Read an align doc off disk (undefined when absent or unreadable). */
export function normalizeAlign(raw: unknown): AlignDoc | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  if ((r['version'] !== 1 && r['version'] !== 2) || typeof r['nodes'] !== 'object' || r['nodes'] === null) return undefined
  return { version: r['version'] as 1 | 2, at: typeof r['at'] === 'string' ? r['at'] : '', nodes: r['nodes'] as AlignDoc['nodes'], bodies: (typeof r['bodies'] === 'object' && r['bodies'] !== null ? r['bodies'] : {}) as AlignDoc['bodies'] }
}

export { chapterNode }
