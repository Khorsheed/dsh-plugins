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

/** How many entries the pane will show before it stops rendering cards. */
export const LIST_RENDER_LIMIT = 300

/** One entry plus the source it came from, which is what a card needs. */
export interface ReaderRow {
  readonly entry: ReaderEntry
  readonly sourceId: string
  readonly sourceLabel: string
  readonly sourceTile: string
  readonly sourceHue: string
  /** True for an entry this session has not opened yet. */
  readonly unread: boolean
}

/** The per-source metadata a row needs (kept structural so the selector is pure). */
export interface SourcePresentation {
  readonly id: string
  readonly label: string
  readonly tile: string
  readonly hue: string
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
    if (query.length > 0 && !matches(entry, source, query)) continue
    rows.push({
      entry,
      sourceId: source.id,
      sourceLabel: source.label,
      sourceTile: source.tile,
      sourceHue: source.hue,
      unread: options.read[entry.id] !== true,
    })
  }
  sortRows(rows, options.sort)
  return rows.slice(0, LIST_RENDER_LIMIT)
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

/** Whether an entry matches the query, across the fields a reader searches by. */
function matches(entry: ReaderEntry, source: SourcePresentation, query: string): boolean {
  const haystack = [
    entry.title,
    entry.summary ?? '',
    entry.author ?? '',
    source.label,
    ...(entry.tags ?? []),
  ].join(' ').toLowerCase()
  return haystack.includes(query)
}

/** Sort in place: newest first, oldest first, or grouped by source. */
function sortRows(rows: ReaderRow[], sort: ReaderSort): void {
  const timeOf = (row: ReaderRow): number => {
    const parsed = row.entry.publishedAt === undefined ? Number.NaN : new Date(row.entry.publishedAt).getTime()
    return Number.isNaN(parsed) ? 0 : parsed
  }
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
