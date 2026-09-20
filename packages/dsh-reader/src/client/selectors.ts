/**
 * Pure view selectors: the filter, the search and the sort the list applies to
 * the parsed entries.
 *
 * All three are LOCAL by design (design decision D14). Entries are parsed in
 * this process, so searching and re-sorting never costs a host round trip — and
 * keeping them as pure functions is what makes them testable without a DOM.
 *
 * @module @khorsheed/dsh-reader/client/selectors
 */
import type { ReaderEntry } from './parse-rss.ts'
import type { ReaderFilter, ReaderSort } from './store.ts'
import { kindQuery, READER_SOURCE_KINDS, type ReaderEntryFetchState, type ReaderSourceKind } from '../types.ts'

/** How many entries the pane will show before it stops rendering cards. */
export const LIST_RENDER_LIMIT = 300

/** One entry plus the source it came from, which is what a card needs. */
export interface ReaderRow {
  readonly entry: ReaderEntry
  readonly sourceId: string
  readonly sourceLabel: string
  readonly sourceTile: string
  readonly sourceHue: string
  /** When the source was added — the time key for an entry that has no date. */
  readonly sourceAddedAt: string
  /** The source kind, so a card knows whether "link only" can apply to it. */
  readonly sourceKind: ReaderSourceKind
  /** True for an entry this session has not opened yet. */
  readonly unread: boolean
}

/** The per-source metadata a row needs (kept structural so the selector is pure). */
export interface SourcePresentation {
  readonly id: string
  readonly label: string
  readonly tile: string
  readonly hue: string
  /** The kind, so a kind query can narrow the wall without a second lookup. */
  readonly kind: ReaderSourceKind
  /**
   * When the reader added this source.
   *
   * A saved link has no publication date, so this is the only date it has —
   * and the wall's time sort falls back to it. Without the fallback a
   * freshly added link sorts as the oldest card on the wall, which is exactly
   * where the reader who just added it does not look.
   */
  readonly addedAt: string
}

/** Every parsed entry, flattened in source order. */
export function flattenEntries(
  parsed: Readonly<Record<string, { entries: readonly ReaderEntry[] }>>,
): ReaderEntry[] {
  const out: ReaderEntry[] = []
  for (const source of Object.values(parsed)) out.push(...source.entries)
  return out
}

/**
 * What the plugin holds for one entry, as every surface reads it.
 *
 * The host's annotation is the only authority (a cached body, an in-flight or
 * stored-raw fetch, a classified failure with its reason); the pane mirrors it
 * per entry, and this is the ONE read path into that mirror — including the
 * default, so no surface spells "no record" as anything other than `none`.
 *
 * @param states - the pane's mirror of the host's fetch states.
 * @param entryId - the entry being shown.
 * @returns the entry's fetch state.
 */
export function fetchStateOf(
  states: Readonly<Record<string, ReaderEntryFetchState>>,
  entryId: string,
): ReaderEntryFetchState {
  return states[entryId] ?? { state: 'none' }
}

/**
 * Apply the filter, the query and the sort.
 *
 * @param entries - the parsed entries.
 * @param sources - presentation metadata per source id.
 * @param options - the current filter/query/sort plus the session's read cursor.
 * @returns the rows to render, newest-first unless the sort says otherwise.
 */
export function selectRows(
  entries: readonly ReaderEntry[],
  sources: ReadonlyMap<string, SourcePresentation>,
  options: {
    readonly filter: ReaderFilter
    readonly query: string
    readonly unreadOnly: boolean
    readonly sort: ReaderSort
    readonly read: Readonly<Record<string, true>>
    /** The reader's own tag ids per entry — the third filter dimension. */
    readonly tags?: Readonly<Record<string, readonly string[]>>
    readonly now: Date
  },
): ReaderRow[] {
  const query = options.query.trim().toLowerCase()
  const rows: ReaderRow[] = []
  for (const entry of entries) {
    const source = sources.get(entry.sourceId)
    if (source === undefined) continue
    if (options.unreadOnly && options.read[entry.id] === true) continue
    if (options.filter === 'today' && !isToday(entry.publishedAt, options.now)) continue
    if (query.length > 0 && !matches(entry, source, query, options.tags ?? {})) continue
    rows.push({
      entry,
      sourceId: source.id,
      sourceLabel: source.label,
      sourceTile: source.tile,
      sourceHue: source.hue,
      sourceAddedAt: source.addedAt,
      sourceKind: source.kind,
      unread: options.read[entry.id] !== true,
    })
  }
  sortRows(rows, options.sort)
  // Relevance before the chosen order, but only for a TEXT search: a phrase
  // that appears in a title is what the reader meant, and leaving a title match
  // buried under newer summary matches is how a search "returns the wrong
  // things first". `#sourceId` / `@tagId` selectors are not ranked — every row
  // matches them the same way. Array#sort is stable, so the chosen order is
  // what the rows inside one tier keep.
  if (query.length > 0 && !query.startsWith('#') && !query.startsWith('@')) {
    rows.sort((a, b) => relevance(a.entry.title, query) - relevance(b.entry.title, query))
  }
  return rows.slice(0, LIST_RENDER_LIMIT)
}

/**
 * The row for one entry, when its source is still known.
 *
 * `selectRows` builds rows for the LIST; the detail view needs the same row for
 * one entry it was told to reopen (a restored reading position), and rebuilding
 * the row by hand there would be a second, drifting copy of this mapping.
 *
 * @param entry - the entry to present.
 * @param sources - presentation metadata per source id.
 * @param read - the session's read cursor.
 * @returns the row, or `undefined` when the entry's source is gone.
 */
export function rowFor(
  entry: ReaderEntry,
  sources: ReadonlyMap<string, SourcePresentation>,
  read: Readonly<Record<string, true>>,
): ReaderRow | undefined {
  const source = sources.get(entry.sourceId)
  if (source === undefined) return undefined
  return {
    entry,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceTile: source.tile,
    sourceHue: source.hue,
    sourceAddedAt: source.addedAt,
    sourceKind: source.kind,
    unread: read[entry.id] !== true,
  }
}

/**
 * Whether an entry belongs in the "today" view.
 *
 * An entry with NO usable date is kept, not dropped. The default filter is
 * `today`, and a saved article link carries no `publishedAt` at all — dropping
 * undated entries would make the primary add-a-link flow produce a link the
 * reader can never see. A date the reader cannot compare is likewise not
 * evidence that the entry is old.
 *
 * @param iso - the feed-declared timestamp, when there is one.
 * @param now - the reference day.
 * @returns true when the entry is on that day, or carries no comparable date.
 */
export function isToday(iso: string | undefined, now: Date): boolean {
  if (iso === undefined) return true
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return true
  return parsed.getFullYear() === now.getFullYear()
    && parsed.getMonth() === now.getMonth()
    && parsed.getDate() === now.getDate()
}

/**
 * The query that selects exactly one source's entries.
 *
 * The search box and the source strip are the same mechanism — one local
 * predicate (D14) — so a source filter is a query the reader can also see and
 * edit. The two-character prefix keeps it out of the way of real search terms:
 * no title search will accidentally match it, and the id is stable across
 * renames.
 *
 * @param sourceId - the source to select.
 * @returns the query string.
 */
export function sourceQuery(sourceId: string): string {
  return `#${sourceId}`
}

/**
 * The query that selects everything carrying one tag.
 *
 * @param tagId - the tag to select.
 * @returns the query string.
 */
export function tagQuery(tagId: string): string {
  return `@${tagId}`
}

/**
 * How directly a title answers a text query: 0 exact, 1 contains, 2 elsewhere.
 *
 * @param title - the entry title.
 * @param query - the lower-cased query.
 * @returns the tier, lowest first.
 */
function relevance(title: string, query: string): number {
  const lower = title.toLowerCase()
  if (lower === query) return 0
  return lower.includes(query) ? 1 : 2
}

/** Whether an entry matches the query, across the fields a reader searches by. */
function matches(
  entry: ReaderEntry,
  source: SourcePresentation,
  query: string,
  tags: Readonly<Record<string, readonly string[]>>,
): boolean {
  if (query.startsWith('#')) {
    const selector = query.slice(1)
    // A kind selector first: source ids are always `<kind>-<hash>`, so
    // `#link` can never be one, and the two vocabularies stay disjoint.
    const kind = READER_SOURCE_KINDS.find(candidate => kindQuery(candidate) === query)
    if (kind !== undefined) return source.kind === kind
    return selector === entry.sourceId
  }
  if (query.startsWith('@')) return (tags[entry.id] ?? []).includes(query.slice(1))
  const haystack = [
    entry.title,
    entry.summary ?? '',
    entry.author ?? '',
    source.label,
    ...(entry.tags ?? []),
  ].join(' ').toLowerCase()
  return haystack.includes(query)
}

/**
 * When a row belongs on a time-ordered wall.
 *
 * An entry's own date wins; a saved link has none at all, so it falls back to
 * when the SOURCE was added. An entry with neither (a hand-made link entry
 * from a source whose document predates `addedAt`) sorts as `0`, i.e. last,
 * which is the old behaviour and still deterministic.
 *
 * @param row - the row to date.
 * @returns milliseconds, or `0` when the row carries no comparable date.
 */
function timeOf(row: ReaderRow): number {
  const iso = row.entry.publishedAt ?? row.sourceAddedAt
  const parsed = iso === undefined ? Number.NaN : new Date(iso).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

/** Sort in place: newest first, oldest first, or grouped by source. */
function sortRows(rows: ReaderRow[], sort: ReaderSort): void {
  if (sort === 'newest') {
    rows.sort((a, b) => timeOf(b) - timeOf(a))
    return
  }
  if (sort === 'oldest') {
    rows.sort((a, b) => timeOf(a) - timeOf(b))
    return
  }
  // Grouped: source name first, then newest inside each group. The comparison
  // is total (ties broken by the stable entry id) so repeated renders of the
  // same data never reshuffle.
  rows.sort((a, b) => {
    if (a.sourceLabel !== b.sourceLabel) return a.sourceLabel < b.sourceLabel ? -1 : 1
    const delta = timeOf(b) - timeOf(a)
    if (delta !== 0) return delta
    return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0
  })
}

/** How many of these rows are still unread. */
export function countUnread(rows: readonly ReaderRow[]): number {
  return rows.reduce((count, row) => count + (row.unread ? 1 : 0), 0)
}

/* -------------------------------------------------------------- wall dedupe */

/**
 * Wall dedupe: aggregated feeds republish the same article, and the wall
 * should show it once (measured on the reader's own wall: "An Alien Mind"
 * under both an aggregator and the source blog).
 *
 * Grouping is deliberately NEVER fuzzy — a miss costs one duplicate card, a
 * false positive costs an article. Three tiers, strongest first; a match on
 * ANY tier groups (they compose transitively — an id-match and a link-match
 * bridge two groups into one):
 *
 * 1. **Same entry id** — the strongest signal there is: `stableEntryId` shares
 *    one id across copies BY DESIGN (a shared guid buys shared fetch/read/
 *    translation state), so a guid collision is the publisher saying "same
 *    item", and it folds even when the copies' links differ.
 * 2. **Normalized link** (any entry that has one): scheme, `www.` and
 *    trailing slashes stripped, tracking parameters (`utm_*`, `fbclid`,
 *    `gclid`, `ref`, `spm`, …) removed, the rest of the query sorted.
 * 3. **Folded title + same published day**: case, accents and punctuation
 *    folded; BOTH entries must carry a comparable date, so undated saved links
 *    never title-group.
 */

/** Query keys that never change which article a link names. */
const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  'fbclid', 'gclid', 'spm', 'ref', 'ref_src', 'source', 'mc_cid', 'mc_eid', 'igshid',
])

/** The dedupe key for an entry's link, or `undefined` when it has none worth one. */
function linkKey(link: string | undefined): string | undefined {
  if (link === undefined) return undefined
  try {
    const url = new URL(link.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const path = url.pathname.replace(/\/+$/, '')
    const params = [...url.searchParams.entries()]
      .filter(([key]) => !/^utm_/i.test(key) && !TRACKING_PARAMS.has(key.toLowerCase()))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const query = params.map(([key, value]) => `${key}=${value}`).join('&')
    return `${host}${path}${query === '' ? '' : `?${query}`}`
  } catch {
    return undefined
  }
}

/** The dedupe key for an entry's title + day, or `undefined` when either is missing. */
function titleDayKey(entry: ReaderEntry): string | undefined {
  const title = entry.title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  // A handful of characters is a topic, not a title: folding "Go 语言" onto
  // itself across two feeds is a false positive, not a duplicate.
  if (title.length < 6) return undefined
  const parsed = entry.publishedAt === undefined ? Number.NaN : new Date(entry.publishedAt).getTime()
  if (Number.isNaN(parsed)) return undefined
  return `${title}|${entry.publishedAt!.slice(0, 10)}`
}

/** Every tier key an entry qualifies for (the id tier always applies). */
function dedupeKeysOf(entry: ReaderEntry): string[] {
  const keys = [`i:${entry.id}`]
  const link = linkKey(entry.link)
  if (link !== undefined) keys.push(`l:${link}`)
  const title = titleDayKey(entry)
  if (title !== undefined) keys.push(`t:${title}`)
  return keys
}

/** The result of hiding duplicates behind their survivors. */
export interface DedupedRows {
  /** The rows to render: one per group, in the input's order. */
  readonly rows: ReaderRow[]
  /** Survivor entry id → the rows it hides (input order). */
  readonly dupesBy: ReadonlyMap<string, readonly ReaderRow[]>
  readonly hiddenCount: number
}

/**
 * Fold duplicate rows into their survivors.
 *
 * Survivor choice, in order: a member whose body the host already holds
 * (a `ready` fetch state — the fetched copy opens instantly) beats a NEWER
 * member, and a tie keeps the input order. Same-id copies share the id-keyed
 * fetch-state record, so between them the choice is always the input order —
 * they share every annotation anyway. The survivor sits at its own position in
 * the row order. Read state merges across the group: the card reads as read
 * when ANY copy was read (free via the shared id for same-id copies). Hidden
 * rows are reported, never deleted — the card badges them.
 *
 * All bookkeeping is POSITIONAL (row indexes), never id-keyed for the fold
 * itself: two copies of one article can share ONE entry id by design, and
 * id-keyed folding keeps both — the survivor's id is the hidden copy's id.
 * Only the badge lookup (`dupesBy`) is id-keyed, which is safe: the surviving
 * card is the only rendered row carrying that id.
 *
 * @param rows - the wall's rows (selectRows' output: filtered and sorted).
 * @param fetchStates - the pane's fetch-state mirror, for the ready signal.
 * @returns the rows to render, and where the hidden ones went.
 */
export function dedupeRows(
  rows: readonly ReaderRow[],
  fetchStates: Readonly<Record<string, ReaderEntryFetchState>> = {},
): DedupedRows {
  // Multi-tier grouping with bridging: a row joins the group any of its tier
  // keys names, and a row whose keys name two groups merges them (A≡B by id
  // and B≡C by link fold all three).
  const keyToGroup = new Map<string, number>()
  const groupRows: number[][] = []
  const groupKeys: string[][] = []
  rows.forEach((row, index) => {
    const keys = dedupeKeysOf(row.entry)
    const hits = [...new Set(keys.map(key => keyToGroup.get(key)).filter((group): group is number => group !== undefined))]
    if (hits.length === 0) {
      const created = groupRows.length
      groupRows.push([index])
      groupKeys.push([...keys])
      for (const key of keys) keyToGroup.set(key, created)
      return
    }
    const target = hits[0]!
    groupRows[target]!.push(index)
    groupKeys[target]!.push(...keys)
    for (const key of keys) keyToGroup.set(key, target)
    for (const absorbed of hits.slice(1)) {
      groupRows[target]!.push(...groupRows[absorbed]!)
      for (const key of groupKeys[absorbed]!) keyToGroup.set(key, target)
      groupRows[absorbed] = []
      groupKeys[absorbed] = []
    }
  })

  /** The survivor of one group, by row index: a cached body first, then newest, then input order. */
  const survivorIndexOf = (members: readonly number[]): number => {
    let best = members[0]!
    for (const index of members.slice(1)) {
      const member = rows[index]!
      const bestRow = rows[best]!
      const ready = fetchStates[member.entry.id]?.state === 'ready'
      const bestReady = fetchStates[bestRow.entry.id]?.state === 'ready'
      if (ready !== bestReady) {
        if (ready) best = index
        continue
      }
      if (timeOf(member) > timeOf(bestRow)) best = index
    }
    return best
  }

  const dupesBy = new Map<string, readonly ReaderRow[]>()
  const folded = new Set<number>() // row indexes hidden behind their survivor
  let hiddenCount = 0
  for (const members of groupRows) {
    if (members.length <= 1) continue
    const survivor = survivorIndexOf(members)
    dupesBy.set(rows[survivor]!.entry.id, members.filter(index => index !== survivor).map(index => rows[index]!))
    for (const index of members) {
      if (index === survivor) continue
      folded.add(index)
      hiddenCount += 1
    }
  }
  const out = rows
    .filter((_, index) => !folded.has(index))
    .map(row => {
      const hidden = dupesBy.get(row.entry.id)
      if (hidden === undefined) return row
      // Read state merges across the group: one read copy reads the card.
      const mergedUnread = ![row, ...hidden].some(member => !member.unread)
      return mergedUnread === row.unread ? row : { ...row, unread: mergedUnread }
    })
  return { rows: out, dupesBy, hiddenCount }
}

/** A short, stable, source-derived monogram tile (design decision D11). */
export function tileForSource(label: string): string {
  const first = label.trim().slice(0, 1)
  return first.length > 0 ? first.toUpperCase() : '·'
}

/** A stable hue derived from the source label, so a source keeps its colour. */
export function hueForSource(label: string): string {
  const palette = [
    'rgb(41,41,41)',
    'rgb(84,85,87)',
    'rgb(65,118,230)',
    'rgb(217,119,87)',
    'rgb(47,158,68)',
    'rgb(151,157,166)',
  ]
  let hash = 0
  for (let index = 0; index < label.length; index++) {
    hash = (hash * 31 + label.charCodeAt(index)) >>> 0
  }
  return palette[hash % palette.length] as string
}
