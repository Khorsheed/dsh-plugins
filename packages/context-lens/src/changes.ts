/**
 * The change list between two consecutive requests of one scope. Every entry
 * is a fact the host recorded or an exact comparison — never an inference:
 *
 * - Messages pair by durable id (content hash for id-less ones): ids only in
 *   the previous request were removed, ids only in the current one were added,
 *   a shared id whose text differs was rewritten in place.
 * - A surface replacement event (`surfaceOp: replace`) names the ids it
 *   shadowed and the id it put in their place; that pairing — and its
 *   producer's `kind · op` — comes from the {@link ReplacementFact} registry,
 *   fed by the live `session/event` lane and by log backfill alike. The
 *   metering event the host appends right before a replacement
 *   (`compaction/summary`, `compaction/prune`) types it as a compaction or a
 *   prune. Without a fact the same rows stay an honest remove + add.
 * - System rows group into one entry (the user's question is "did the system
 *   prompt change"), diffed head against head, with a checkable equality when
 *   the new head repeats a removed in-history system update verbatim.
 * - Unexplained additions after the last kept row are the ordinary tail
 *   append, summarized rather than listed.
 *
 * @module @khorsheed/dsh-context-lens/changes
 */
import { prefixTextChange } from './prefix-diff.ts'
import type { ChangeRow, PrefixTextChange, RequestChange, SegmentItem, ToolChange, ToolDefItem } from './types.ts'

/** One surface replacement as the host logged it. */
export interface ReplacementFact {
  /** The replacing message's id (a prune keeps the shadowed id). */
  newId: string
  /** Ids of the shadowed surface messages, in surface order. */
  replacedIds: string[]
  kind: 'replace' | 'compaction' | 'prune'
  /** The replacing message's producer, verbatim. */
  sourceKind: string
  sourceOp?: string
  /** Host log seq of the replacement event and of what it shadowed. */
  eventSeq?: number
  replacedSeqs?: number[]
  compactionId?: string
}

/** Structural minimum of one session event / log row this module reads. */
export interface ReplacementRow {
  type: string
  seq?: number
  data?: unknown
  surfaceOp?: unknown
  sourceEventSeqs?: readonly number[]
}

/** The metering event a replacement immediately follows, when any. */
export interface PendingMeter { kind: 'compaction' | 'prune'; compactionId?: string }

/** Read the meter a `compaction/*` row announces for the next replacement. */
export function meterOf(row: ReplacementRow): PendingMeter | undefined {
  if (row.type === 'compaction/prune') return { kind: 'prune' }
  if (row.type !== 'compaction/summary') return undefined
  const id = record(row.data)?.['compactionId']
  return { kind: 'compaction', ...typeof id === 'string' ? { compactionId: id } : {} }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

/** The message a surface event carries: `data.message` for step events, `data` itself for user messages. */
export function messageOfRow(row: ReplacementRow): { id?: string; source?: Record<string, unknown> } | undefined {
  const data = record(row.data)
  if (data === undefined) return undefined
  const message = record(data['message']) ?? data
  const id = message['id']
  const source = record(message['source'])
  return { ...typeof id === 'string' ? { id } : {}, ...source === undefined ? {} : { source } }
}

/**
 * The fact one replacement row records, or undefined for appends and rows
 * whose ids cannot be read.
 * @param idAt - resolve a shadowed log seq to its message id.
 * @param meter - the metering row immediately before this one, if any.
 */
export function replacementFact(row: ReplacementRow, idAt: (seq: number) => string | undefined, meter?: PendingMeter): ReplacementFact | undefined {
  const op = record(row.surfaceOp)
  if (op === undefined || op['op'] !== 'replace') return undefined
  const message = messageOfRow(row)
  if (message?.id === undefined) return undefined
  const seqs = row.sourceEventSeqs !== undefined && row.sourceEventSeqs.length > 0
    ? [...row.sourceEventSeqs]
    : typeof op['startSeq'] === 'number' && typeof op['endSeq'] === 'number' && op['endSeq'] >= op['startSeq']
      ? Array.from({ length: op['endSeq'] - op['startSeq'] + 1 }, (_, i) => (op['startSeq'] as number) + i)
      : []
  const replacedIds = seqs.map(idAt).filter((id): id is string => id !== undefined)
  const sourceKind = typeof message.source?.['kind'] === 'string' ? message.source['kind'] : row.type
  const sourceOp = typeof message.source?.['op'] === 'string' ? message.source['op'] : undefined
  const compactionId = typeof message.source?.['compactionId'] === 'string' ? message.source['compactionId'] : meter?.compactionId
  const kind = meter?.kind ?? (compactionId !== undefined ? 'compaction' : 'replace')
  return {
    newId: message.id,
    replacedIds,
    kind,
    sourceKind,
    ...sourceOp === undefined ? {} : { sourceOp },
    ...row.seq === undefined ? {} : { eventSeq: row.seq },
    ...seqs.length === 0 ? {} : { replacedSeqs: seqs },
    ...kind === 'compaction' && compactionId !== undefined ? { compactionId } : {},
  }
}

/** Every replacement fact of one whole log (the backfill path). */
export function replacementFactsOf(rows: readonly ReplacementRow[]): ReplacementFact[] {
  const ids = new Map<number, string>()
  const facts: ReplacementFact[] = []
  let meter: PendingMeter | undefined
  for (const row of rows) {
    const fact = replacementFact(row, seq => ids.get(seq), meter)
    if (fact !== undefined) facts.push(fact)
    const id = messageOfRow(row)?.id
    if (row.seq !== undefined && id !== undefined) ids.set(row.seq, id)
    meter = meterOf(row)
  }
  return facts
}

/** Fact lookup the diff needs; the store's bounded registry implements it. */
export interface FactLookup {
  byNewId(id: string): ReplacementFact | undefined
  byReplacedId(id: string): ReplacementFact | undefined
}

/** The comparable face of one request. */
export interface RequestFace {
  rows: readonly SegmentItem[]
  tools: readonly ToolDefItem[]
}

/** One wire message rebuilt from its segment rows (system rows may be split into sections). */
interface Msg {
  index: number
  key: string
  id?: string
  category: SegmentItem['category']
  source: string
  text: string
  sections: { name: string; start: number; end: number }[]
}

function messagesOf(rows: readonly SegmentItem[]): Msg[] {
  const byIndex = new Map<number, SegmentItem[]>()
  for (const row of rows) byIndex.set(row.index, [...byIndex.get(row.index) ?? [], row])
  const seen = new Map<string, number>()
  return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([index, parts]) => {
    const first = parts[0]!
    const sectioned = parts.length > 1
    const sections: Msg['sections'] = []
    let cursor = 0
    for (const part of parts) {
      sections.push({ name: part.source, start: cursor, end: cursor + Array.from(part.full).length })
      cursor += Array.from(part.full).length + 2
    }
    const text = parts.map(part => part.full).join('\n\n')
    const id = parts.find(part => part.messageId !== undefined)?.messageId
    const base = id === undefined ? `h:${first.category}:${text.length}:${hashText(text)}` : `id:${id}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return {
      index,
      key: n === 0 ? base : `${base}#${n}`,
      ...id === undefined ? {} : { id },
      category: first.category,
      source: first.category === 'system' && sectioned ? 'system-prompt' : first.source,
      text,
      sections: sectioned ? sections : [],
    }
  })
}

function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function rowOf(message: Msg): ChangeRow {
  return {
    index: message.index,
    ...message.id === undefined ? {} : { messageId: message.id },
    category: message.category,
    source: message.source,
    preview: message.text.replace(/\s+/g, ' ').trim().slice(0, 120),
    chars: Array.from(message.text).length,
  }
}

function sectionAt(message: Msg, offset: number): string | undefined {
  return message.sections.find(section => offset >= section.start && offset <= section.end)?.name
}

/** Contiguous runs (by index) of rows; system and non-system rows never share a run. */
function runs(messages: Msg[]): Msg[][] {
  const out: Msg[][] = []
  for (const message of messages) {
    const last = out[out.length - 1]
    const tail = last?.[last.length - 1]
    if (last !== undefined && tail !== undefined && message.index === tail.index + 1 && (message.category === 'system') === (tail.category === 'system')) last.push(message)
    else out.push([message])
  }
  return out
}

/** Result of {@link diffRequests}. */
export interface RequestChanges {
  changes: RequestChange[]
  tools: ToolChange[]
  tail?: { count: number; sources: string[] }
}

/**
 * Diff two consecutive requests.
 * @param breakIndex - the message index where the exact prefix comparison first differs, if it does.
 */
export function diffRequests(previous: RequestFace, current: RequestFace, facts: FactLookup, breakIndex?: number): RequestChanges {
  const prev = messagesOf(previous.rows), cur = messagesOf(current.rows)
  const prevByKey = new Map(prev.map(m => [m.key, m])), curByKey = new Map(cur.map(m => [m.key, m]))
  const removed = prev.filter(m => !curByKey.has(m.key))
  const added = cur.filter(m => !prevByKey.has(m.key))
  const rewritten = cur.filter(m => m.id !== undefined && prevByKey.has(m.key) && prevByKey.get(m.key)!.text !== m.text)

  // Resolve a replacement's shadowed ids back to ids the previous request carried (replace chains).
  const resolve = (ids: readonly string[], depth = 0): string[] => ids.flatMap(id => {
    if (prev.some(m => m.id === id) || depth > 8) return [id]
    const inner = facts.byNewId(id)
    return inner === undefined || inner.newId === id ? [id] : resolve(inner.replacedIds, depth + 1)
  })

  const explained = new Set<string>()
  const changes: RequestChange[] = []
  const seenFacts = new Set<string>()
  const candidates: ReplacementFact[] = []
  const want = (fact: ReplacementFact | undefined) => {
    if (fact === undefined || seenFacts.has(fact.newId)) return
    seenFacts.add(fact.newId); candidates.push(fact)
  }
  for (const m of added) if (m.id !== undefined) want(facts.byNewId(m.id))
  for (const m of rewritten) want(facts.byNewId(m.id!))
  for (const m of removed) if (m.id !== undefined) want(facts.byReplacedId(m.id))

  for (const fact of candidates) {
    const shadowed = new Set(resolve(fact.replacedIds))
    const gone = removed.filter(m => m.id !== undefined && shadowed.has(m.id) && !explained.has(m.key))
    const fresh = cur.filter(m => m.id === fact.newId)
    const inPlace = fresh.filter(m => prevByKey.has(m.key))
    const freshAdded = fresh.filter(m => !prevByKey.has(m.key))
    if (gone.length === 0 && freshAdded.length === 0 && inPlace.length === 0) continue
    for (const m of [...gone, ...freshAdded, ...inPlace]) explained.add(m.key)
    const before = inPlace.length > 0 ? prevByKey.get(inPlace[0]!.key) : gone.length === 1 ? gone[0] : undefined
    const after = inPlace[0] ?? freshAdded[0]
    const text = before !== undefined && after !== undefined ? prefixTextChange(before.text, after.text) : undefined
    changes.push({
      kind: fact.kind,
      removed: inPlace.length > 0 ? inPlace.map(m => rowOf(prevByKey.get(m.key)!)) : gone.map(rowOf),
      added: [...inPlace, ...freshAdded].map(rowOf),
      source: { kind: fact.sourceKind, ...fact.sourceOp === undefined ? {} : { op: fact.sourceOp } },
      ...fact.eventSeq === undefined ? {} : { eventSeq: fact.eventSeq },
      ...fact.replacedSeqs === undefined ? {} : { replacedSeqs: fact.replacedSeqs },
      ...fact.compactionId === undefined ? {} : { compactionId: fact.compactionId },
      ...text === undefined ? {} : { text },
    })
  }

  // Same id, new text, no fact: an in-place rewrite the host did not label.
  for (const m of rewritten) {
    if (explained.has(m.key)) continue
    explained.add(m.key)
    const before = prevByKey.get(m.key)!
    changes.push({ kind: 'replace', removed: [rowOf(before)], added: [rowOf(m)], text: prefixTextChange(before.text, m.text) })
  }

  const keptPrev = prev.filter(m => curByKey.has(m.key))
  const keptCur = cur.filter(m => prevByKey.has(m.key))
  const lastKeptPrev = Math.max(-1, ...keptPrev.map(m => m.index))
  const anchor = Math.max(-1, ...keptCur.map(m => m.index), ...cur.filter(m => explained.has(m.key)).map(m => m.index))
  const looseRemoved = removed.filter(m => !explained.has(m.key))
  const looseAdded = added.filter(m => !explained.has(m.key))
  const trailingRemovals = looseRemoved.some(m => m.index > lastKeptPrev)
  // System rows never fold into the tail: a prompt update appended mid-history is what this list is for.
  const tailRows = trailingRemovals ? [] : looseAdded.filter(m => m.index > anchor && m.category !== 'system')
  const tailKeys = new Set(tailRows.map(m => m.key))
  for (const run of runs(looseRemoved)) changes.push({ kind: 'remove', removed: run.map(rowOf), added: [] })
  for (const run of runs(looseAdded.filter(m => !tailKeys.has(m.key)))) changes.push({ kind: 'add', removed: [], added: run.map(rowOf) })

  const grouped = groupSystem(changes, prev, cur)
  grouped.sort((a, b) => firstIndex(a) - firstIndex(b))
  const tools = diffTools(previous.tools, current.tools)

  const breakAt = breakIndex === undefined ? undefined
    : grouped.find(c => c.added.some(r => r.index === breakIndex)) ?? grouped.find(c => c.removed.some(r => r.index === breakIndex))
  if (breakAt !== undefined) breakAt.isBreak = true
  else if (breakIndex === undefined && tools[0] !== undefined) tools[0].isBreak = true

  return {
    changes: grouped,
    tools,
    ...tailRows.length === 0 ? {} : { tail: { count: tailRows.length, sources: [...new Set(tailRows.map(m => m.source))] } },
  }
}

function firstIndex(change: RequestChange): number {
  return Math.min(...change.added.map(r => r.index), ...change.removed.map(r => r.index))
}

/**
 * Fold every all-system change into one entry. The text diff compares the
 * head system message of both requests (the cache prefix); when the new head
 * repeats a removed system message verbatim, that equality is recorded.
 */
function groupSystem(changes: RequestChange[], prev: Msg[], cur: Msg[]): RequestChange[] {
  const isSystem = (c: RequestChange) => [...c.removed, ...c.added].length > 0 && [...c.removed, ...c.added].every(r => r.category === 'system')
  const system = changes.filter(isSystem)
  if (system.length === 0) return changes
  const rest = changes.filter(c => !isSystem(c))
  const prevHead = prev.find(m => m.category === 'system'), curHead = cur.find(m => m.category === 'system')
  let text: PrefixTextChange | undefined
  let section: string | undefined
  if (prevHead !== undefined && curHead !== undefined && prevHead.index === curHead.index && prevHead.text !== curHead.text) {
    text = prefixTextChange(prevHead.text, curHead.text)
    section = sectionAt(curHead, text.offset)
  } else {
    // Head untouched: the update landed elsewhere; diff the effective (last non-empty) prompts.
    const effective = (list: Msg[]) => list.filter(m => m.category === 'system' && m.text.length > 0).at(-1)
    const before = effective(prev), after = effective(cur)
    if (before !== undefined && after !== undefined && before.text !== after.text) text = prefixTextChange(before.text, after.text)
  }
  const removed = system.flatMap(c => c.removed)
  const sameAs = curHead === undefined ? undefined
    : removed.find(r => r.index !== curHead.index && prev.find(m => m.index === r.index)?.text === curHead.text)
  const anyFact = system.some(c => c.kind !== 'add' && c.kind !== 'remove')
  const merged: RequestChange = {
    kind: anyFact ? 'replace' : removed.length > 0 ? 'remove' : 'add',
    system: true,
    removed,
    added: system.flatMap(c => c.added),
    source: { kind: 'system-prompt' },
    parts: system.map(c => ({
      kind: c.kind,
      removed: c.removed,
      added: c.added,
      ...c.eventSeq === undefined ? {} : { eventSeq: c.eventSeq },
      ...c.replacedSeqs === undefined ? {} : { replacedSeqs: c.replacedSeqs },
    })),
    ...text === undefined ? {} : { text },
    ...section === undefined ? {} : { section },
    ...sameAs === undefined ? {} : { sameAs },
  }
  return [merged, ...rest]
}

/** Tool definitions pair by name; description and parameters diff separately. */
export function diffTools(previous: readonly ToolDefItem[], current: readonly ToolDefItem[]): ToolChange[] {
  const before = new Map(previous.map(tool => [tool.name, tool]))
  const after = new Set(current.map(tool => tool.name))
  const out: ToolChange[] = []
  for (const tool of current) {
    const old = before.get(tool.name)
    if (old === undefined) { out.push({ name: tool.name, change: 'added' }); continue }
    const description = old.description === tool.description ? undefined : prefixTextChange(old.description, tool.description)
    const parameters = old.parameters === tool.parameters ? undefined : prefixTextChange(old.parameters, tool.parameters)
    if (description === undefined && parameters === undefined) continue
    out.push({ name: tool.name, change: 'modified', ...description === undefined ? {} : { description }, ...parameters === undefined ? {} : { parameters } })
  }
  for (const tool of previous) if (!after.has(tool.name)) out.push({ name: tool.name, change: 'removed' })
  return out
}
