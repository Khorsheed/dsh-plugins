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
  flattenEntries,
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
  ['s1', { id: 's1', label: 'Hacker News', tile: 'H', hue: 'rgb(41,41,41)' }],
  ['s2', { id: 's2', label: '阮一峰周刊', tile: '阮', hue: 'rgb(84,85,87)' }],
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
})

describe('isToday', () => {
  it('compares the local calendar day, not a 24h window', () => {
    expect(isToday(todayIso, today)).toBe(true)
    expect(isToday(yesterday, today)).toBe(false)
    expect(isToday(undefined, today)).toBe(false)
    expect(isToday('nonsense', today)).toBe(false)
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
