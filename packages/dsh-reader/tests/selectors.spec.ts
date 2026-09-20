/**
 * The list predicates: filter, search, sort and the two derivation helpers.
 *
 * Pure functions over parsed entries, which is what makes them worth testing
 * directly — the pane renders whatever these return, so a mistake here is a
 * wrong list, not a rendering glitch.
 */
import { describe, expect, it } from 'vitest'
import type { ReaderEntry } from '../src/client/parse-rss.ts'
import {
  countUnread,
  dedupeRows,
  flattenEntries,
  fetchStateOf,
  hueForSource,
  isToday,
  selectRows,
  tileForSource,
  type SourcePresentation,
} from '../src/client/selectors.ts'

const entry = (over: Partial<ReaderEntry> & { id: string; sourceId: string }): ReaderEntry => ({
  title: `title ${over.id}`,
  ...over,
})

const sources: ReadonlyMap<string, SourcePresentation> = new Map([
  ['s1', { id: 's1', label: 'Hacker News', tile: 'H', hue: 'rgb(41,41,41)', kind: 'rss', addedAt: '2026-09-01T00:00:00.000Z' }],
  ['s2', { id: 's2', label: '阮一峰周刊', tile: '阮', hue: 'rgb(84,85,87)', kind: 'rss', addedAt: '2026-09-02T00:00:00.000Z' }],
  ['s3', { id: 's3', label: '保存的文章', tile: '保', hue: 'rgb(65,118,230)', kind: 'link', addedAt: '2026-09-17T11:00:00.000Z' }],
])

const today = new Date('2026-09-17T12:00:00.000Z')
const yesterday = '2026-09-16T09:00:00.000Z'
const todayIso = '2026-09-17T08:00:00.000Z'

const entries: ReaderEntry[] = [
  entry({ id: 'a', sourceId: 's1', title: 'SQLite is not a toy', publishedAt: todayIso, tags: ['database'] }),
  entry({ id: 'b', sourceId: 's2', title: '随机数，这是一个问题', publishedAt: yesterday, author: '阮一峰' }),
  entry({ id: 'c', sourceId: 's2', title: '如何写 README', publishedAt: '2026-09-15T09:00:00.000Z', summary: 'docs' }),
]

const base = { filter: 'all' as const, query: '', unreadOnly: false, sort: 'newest' as const, read: {}, now: today }

describe('selectRows', () => {
  it('sorts newest first and oldest first', () => {
    expect(selectRows(entries, sources, base).map(row => row.entry.id)).toEqual(['a', 'b', 'c'])
    expect(selectRows(entries, sources, { ...base, sort: 'oldest' }).map(row => row.entry.id)).toEqual(['c', 'b', 'a'])
  })

  it('groups by source without reshuffling equal data', () => {
    const first = selectRows(entries, sources, { ...base, sort: 'source' }).map(row => row.entry.id)
    const again = selectRows(entries, sources, { ...base, sort: 'source' }).map(row => row.entry.id)
    // Hacker News before 阮一峰周刊 (string order), newest inside each group.
    expect(first).toEqual(['a', 'b', 'c'])
    expect(again).toEqual(first)
  })

  it('keeps only today when the filter says so', () => {
    const rows = selectRows(entries, sources, { ...base, filter: 'today' })
    expect(rows.map(row => row.entry.id)).toEqual(['a'])
  })

  it('keeps an undated saved link under the default today filter', () => {
    // A saved article link carries no `publishedAt`; dropping it here would
    // make the add-a-link flow produce a link the reader can never see.
    const saved = entry({ id: 'link-1', sourceId: 's1', title: '保存的文章' })
    const rows = selectRows([...entries, saved], sources, { ...base, filter: 'today' })
    expect(rows.map(row => row.entry.id)).toEqual(['a', 'link-1'])
  })

  it('matches the query across title, author, source and tags', () => {
    expect(selectRows(entries, sources, { ...base, query: 'sqlite' }).map(r => r.entry.id)).toEqual(['a'])
    // The author name also matches the SOURCE label, so both of that feed's
    // entries come back — searching by source is a feature, not a leak.
    expect(selectRows(entries, sources, { ...base, query: '阮一峰' }).map(r => r.entry.id)).toEqual(['b', 'c'])
    expect(selectRows(entries, sources, { ...base, query: '随机数' }).map(r => r.entry.id)).toEqual(['b'])
    expect(selectRows(entries, sources, { ...base, query: 'hacker' }).map(r => r.entry.id)).toEqual(['a'])
    expect(selectRows(entries, sources, { ...base, query: 'database' }).map(r => r.entry.id)).toEqual(['a'])
    expect(selectRows(entries, sources, { ...base, query: 'README' }).map(r => r.entry.id)).toEqual(['c'])
    expect(selectRows(entries, sources, { ...base, query: 'nothing here' })).toEqual([])
  })

  it('hides what the session has already read when unread-only is on', () => {
    const rows = selectRows(entries, sources, { ...base, unreadOnly: true, read: { a: true } })
    expect(rows.map(row => row.entry.id)).toEqual(['b', 'c'])
  })

  it('marks a row unread until the session opens it', () => {
    const before = selectRows(entries, sources, base)
    expect(countUnread(before)).toBe(3)
    const after = selectRows(entries, sources, { ...base, read: { a: true } })
    expect(countUnread(after)).toBe(2)
    expect(after.find(row => row.entry.id === 'a')?.unread).toBe(false)
  })

  it('skips entries whose source is gone and keeps the rest', () => {
    const rows = selectRows([...entries, entry({ id: 'orphan', sourceId: 'gone' })], sources, base)
    expect(rows.map(row => row.entry.id)).toEqual(['a', 'b', 'c'])
  })

  it('narrows by source KIND as well as by source id', () => {
    // Both narrowings write a `#…` selector into the search box, so they share
    // one mechanism — and the kind vocabulary cannot collide with a source id,
    // which is always `<kind>-<hash>`.
    const saved = entry({ id: 'link-1', sourceId: 's3', title: '保存的文章' })
    const all = [...entries, saved]
    expect(selectRows(all, sources, { ...base, query: '#link' }).map(r => r.entry.id)).toEqual(['link-1'])
    expect(selectRows(all, sources, { ...base, query: '#rss' }).map(r => r.entry.id)).toEqual(['a', 'b', 'c'])
    expect(selectRows(all, sources, { ...base, query: '#s1' }).map(r => r.entry.id)).toEqual(['a'])
  })

  it('dates an undated saved link by when its source was added', () => {
    // Before this, a link the reader had JUST added sorted to the bottom of
    // "newest first" (an entry with no date scored 0), which is the opposite of
    // where they look for it.
    const saved = entry({ id: 'link-1', sourceId: 's3', title: '保存的文章' })
    const rows = selectRows([...entries, saved], sources, base)
    // s3 was added 11:00 today, which lands it above the 08:00 entry.
    expect(rows.map(row => row.entry.id)).toEqual(['link-1', 'a', 'b', 'c'])
    expect(selectRows([...entries, saved], sources, { ...base, sort: 'oldest' }).map(r => r.entry.id))
      .toEqual(['c', 'b', 'a', 'link-1'])
  })
})

describe('isToday', () => {
  it('compares the local calendar day, not a 24h window', () => {
    expect(isToday(todayIso, today)).toBe(true)
    expect(isToday(yesterday, today)).toBe(false)
  })

  it('keeps an entry the reader cannot date', () => {
    expect(isToday(undefined, today)).toBe(true)
    expect(isToday('nonsense', today)).toBe(true)
  })
})

describe('flattenEntries', () => {
  it('collects every source\u2019s entries', () => {
    expect(flattenEntries({ s1: { entries: [entries[0] as ReaderEntry] }, s2: { entries: [] } })).toHaveLength(1)
    expect(flattenEntries({})).toEqual([])
  })
})

describe('source presentation', () => {
  it('derives a stable monogram and hue from the label', () => {
    expect(tileForSource('Hacker News')).toBe('H')
    expect(tileForSource('阮一峰周刊')).toBe('阮')
    expect(tileForSource('   ')).toBe('·')
    expect(hueForSource('Hacker News')).toBe(hueForSource('Hacker News'))
    expect(hueForSource('Hacker News')).toMatch(/^rgb\(/)
  })
})

describe('a text search ranks what it matched', () => {
  it('puts a title match above a newer summary match', () => {
    // Reported: searching a paper's title returned newer posts first, so the
    // entry the reader meant sat at the bottom of the wall. Relevance comes
    // before the chosen order; the order still decides inside one tier.
    const titleMatch = entry({ id: 'title', sourceId: 's1', title: 'Verbalizable Representations Form a Global Workspace', publishedAt: '2026-08-01T00:00:00.000Z' })
    const summaryMatch = entry({ id: 'summary', sourceId: 's1', title: 'Something else entirely', publishedAt: '2026-09-17T00:00:00.000Z', summary: 'inside OpenAI, agents explore verbalizable representations daily' })
    const rows = selectRows([titleMatch, summaryMatch], sources, { ...base, query: 'verbalizable representations' })
    expect(rows.map(row => row.entry.id)).toEqual(['title', 'summary'])
  })

  it('leaves a source selector unranked', () => {
    const rows = selectRows(entries, sources, { ...base, query: '#s1' })
    expect(rows.map(row => row.entry.id)).toEqual(['a'])
  })
})


describe('fetchStateOf', () => {
  it('defaults to none for an entry the host has no record of', () => {
    expect(fetchStateOf({}, 'a')).toEqual({ state: 'none' })
  })

  it('hands back the mirrored record, failure reason and code included', () => {
    // The code is what the card's sentence is chosen by, and what the ingest
    // milestone's reason taxonomy will consume — the mirror must carry it
    // through, not just the fact of the failure.
    const failed = { state: 'failed' as const, at: '2026-09-20T00:00:00.000Z', message: 'HTTP 403', code: 'blocked' as const }
    expect(fetchStateOf({ a: { state: 'ready' }, b: failed }, 'b')).toBe(failed)
  })
})

/**
 * Wall dedupe: aggregated feeds republish the same article (the reader's wall
 * had "An Alien Mind" from two feeds). Group by normalized link first, then by
 * folded title + same published day — never fuzzy: a miss costs a duplicate
 * card, a false positive costs an article.
 */
describe('dedupeRows', () => {
  /** A row as selectRows emits it, straight from the parts a group cares about. */
  const row = (over: {
    id: string
    sourceId?: string
    title?: string
    link?: string
    publishedAt?: string
    unread?: boolean
    sourceLabel?: string
  }) => {
    const sourceId = over.sourceId ?? 's1'
    const source = sources.get(sourceId)!
    return {
      entry: entry({
        id: over.id,
        sourceId,
        ...(over.title === undefined ? {} : { title: over.title }),
        ...(over.link === undefined ? {} : { link: over.link }),
        ...(over.publishedAt === undefined ? {} : { publishedAt: over.publishedAt }),
      }),
      sourceId,
      sourceLabel: over.sourceLabel ?? source.label,
      sourceTile: source.tile,
      sourceHue: source.hue,
      sourceAddedAt: source.addedAt,
      sourceKind: source.kind,
      unread: over.unread ?? true,
    }
  }

  it('groups the same link across feeds, protocol/www/utm differences included', () => {
    const rows = [
      row({ id: 'a', sourceId: 's1', link: 'https://example.com/papers/alien?utm_source=feed&utm_medium=rss', publishedAt: todayIso }),
      row({ id: 'b', sourceId: 's2', link: 'https://www.example.com/papers/alien/?ref=share', publishedAt: yesterday }),
      row({ id: 'c', sourceId: 's1', link: 'https://example.com/papers/other', publishedAt: todayIso }),
    ]
    const result = dedupeRows(rows)
    expect(result.rows.map(r => r.entry.id)).toEqual(['a', 'c'])
    expect(result.hiddenCount).toBe(1)
    // The survivor is the NEWEST member; the hidden one rides with it.
    expect(result.dupesBy.get('a')?.map(r => r.entry.id)).toEqual(['b'])
  })

  it('groups by folded title + same day only when no link matches', () => {
    const rows = [
      row({ id: 'a', sourceId: 's1', title: 'An Alien Mind: Notes', publishedAt: todayIso }),
      row({ id: 'b', sourceId: 's2', title: 'an alien mind— notes!', publishedAt: '2026-09-17T01:00:00.000Z' }),
      // Same title, another day: NOT a duplicate — a miss beats a false positive.
      row({ id: 'c', sourceId: 's2', title: 'An Alien Mind: Notes', publishedAt: yesterday }),
    ]
    const result = dedupeRows(rows)
    expect(result.rows.map(r => r.entry.id)).toEqual(['a', 'c'])
    expect(result.dupesBy.get('a')?.map(r => r.entry.id)).toEqual(['b'])
  })

  it('never groups undated or untitled entries, and never two links that differ', () => {
    const rows = [
      row({ id: 'a', title: 'Same Title Same Title' }),                    // no date
      row({ id: 'b', title: 'same title same title' }),                    // no date
      row({ id: 'c', link: 'https://example.com/a?utm_campaign=x', publishedAt: todayIso }),
      row({ id: 'd', link: 'https://example.com/a?page=2', publishedAt: todayIso }),
    ]
    const result = dedupeRows(rows)
    expect(result.rows).toHaveLength(4)
    expect(result.hiddenCount).toBe(0)
  })

  it('prefers the member with a fetched body when the mirror says so', () => {
    const rows = [
      row({ id: 'a', sourceId: 's1', link: 'https://example.com/p', publishedAt: todayIso }),
      row({ id: 'b', sourceId: 's2', link: 'https://example.com/p', publishedAt: yesterday }),
    ]
    const result = dedupeRows(rows, { b: { state: 'ready', at: todayIso } })
    expect(result.rows.map(r => r.entry.id)).toEqual(['b'])
    expect(result.dupesBy.get('b')?.map(r => r.entry.id)).toEqual(['a'])
  })

  it('merges read state across the group: one read copy reads the card', () => {
    const rows = [
      row({ id: 'a', sourceId: 's1', link: 'https://example.com/p', publishedAt: todayIso, unread: true }),
      row({ id: 'b', sourceId: 's2', link: 'https://example.com/p', publishedAt: yesterday, unread: false }),
    ]
    const result = dedupeRows(rows)
    expect(result.rows[0]?.unread).toBe(false)
    // …but nothing unread was invented, either.
    const bothUnread = dedupeRows(rows.map(r => ({ ...r, unread: true })))
    expect(bothUnread.rows[0]?.unread).toBe(true)
  })

  it('keeps the survivor at its own position in the row order', () => {
    const rows = [
      row({ id: 'x', sourceId: 's1', link: 'https://example.com/else', publishedAt: todayIso }),
      row({ id: 'a', sourceId: 's1', link: 'https://example.com/p', publishedAt: todayIso }),
      row({ id: 'b', sourceId: 's2', link: 'https://example.com/p', publishedAt: yesterday }),
    ]
    const result = dedupeRows(rows)
    expect(result.rows.map(r => r.entry.id)).toEqual(['x', 'a'])
  })
})
