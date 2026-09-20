/**
 * The annotation tables: the article cache, its TTL, its budget, and the reader's
 * tags. All of it pure — the store's normalizer and pruner run without a fs, a
 * context, or a network, which is why these two are pure functions.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_CACHED_BODIES,
  MAX_RECENT_ENTRIES,
  boundAnnotations,
  boundTranslations,
  emptyStateDoc,
  normalizeStateDoc,
  pruneOrphanTags,
  ReaderStore,
} from '../src/store.ts'
import { MAX_TRANSLATION_MEMORY_ENTRIES } from '../src/types.ts'
import type { ReaderEntryAnnotation, ReaderStateDoc } from '../src/types.ts'

/** A document with one cached body per entry, oldest first. */
function withBodies(count: number): ReaderStateDoc {
  const annotations: Record<string, { body: { html: string; fetchedAt: string; expiresAt: string; url: string } }> = {}
  for (let index = 0; index < count; index++) {
    const at = new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString()
    annotations[`e${index}`] = {
      body: { html: `<p>entry ${index}</p>`, fetchedAt: at, expiresAt: at, url: `https://example.com/${index}` },
    }
  }
  return { ...emptyStateDoc(), annotations }
}

describe('the document keeps the reader’s own state apart from the feeds', () => {
  it('drops malformed annotations instead of trusting the file', () => {
    const doc = normalizeStateDoc({
      sources: [],
      annotations: {
        good: { body: { html: '<p>x</p>', fetchedAt: 'a', expiresAt: 'b', url: 'u' }, tagIds: ['t1', 't1', 't2'] },
        bodyless: { tagIds: [] },
        emptyBody: { body: { html: '', fetchedAt: 'a', expiresAt: 'b', url: 'u' } },
        withError: { error: 'boom', failedAt: 'when' },
      },
      tags: { t1: { name: 'AI', createdAt: 'x' }, t2: { name: '  ' }, '': { name: 'nameless id' } },
    })
    // Duplicate tag ids collapse; a body with no html is not a body; an entry
    // carrying nothing at all disappears.
    expect(doc.annotations?.good?.tagIds).toEqual(['t1', 't2'])
    expect(doc.annotations?.emptyBody).toBeUndefined()
    expect(doc.annotations?.bodyless).toBeUndefined()
    expect(doc.annotations?.withError?.error).toBe('boom')
    // A tag needs both an id and a name.
    expect(Object.keys(doc.tags ?? {})).toEqual(['t1'])
  })

  it('bounds the cached bodies newest-first', () => {
    const bounded = boundAnnotations(withBodies(MAX_CACHED_BODIES + 40))
    const kept = Object.keys(bounded.doc.annotations ?? {})
    expect(bounded.changed).toBe(true)
    expect(kept.length).toBe(MAX_CACHED_BODIES)
    // The newest entries survive: nothing kept is older than anything released.
    const released = Array.from({ length: MAX_CACHED_BODIES + 40 }, (_, i) => `e${i}`).filter(id => !kept.includes(id))
    expect(released.length).toBe(40)
    expect(Math.max(...released.map(id => Number(id.slice(1))))).toBeLessThan(Math.min(...kept.map(id => Number(id.slice(1)))))
  })

  it('never evicts a tag to make room for a cached page', () => {
    const base = withBodies(MAX_CACHED_BODIES + 1)
    const oldest = 'e0'
    const doc: ReaderStateDoc = {
      ...base,
      annotations: { ...base.annotations, [oldest]: { ...base.annotations?.[oldest], tagIds: ['t-keep'] } },
      tags: { 't-keep': { id: 't-keep', name: 'important', createdAt: 'x' } },
    }
    const bounded = boundAnnotations(doc).doc
    // Its body is released (it is the oldest), but the tag on it survives.
    expect(bounded.annotations?.[oldest]?.body).toBeUndefined()
    expect(bounded.annotations?.[oldest]?.tagIds).toEqual(['t-keep'])
  })

  it('prunes tags nothing references', () => {
    const doc: ReaderStateDoc = {
      ...emptyStateDoc(),
      tags: {
        used: { id: 'used', name: 'used', createdAt: 'x' },
        orphan: { id: 'orphan', name: 'orphan', createdAt: 'x' },
      },
      annotations: { e1: { tagIds: ['used'] } },
    }
    const { doc: pruned, removed } = pruneOrphanTags(doc)
    expect(removed).toBe(1)
    expect(Object.keys(pruned.tags ?? {})).toEqual(['used'])
  })

  it('round-trips the annotations through the disk document', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-reader-ann-'))
    try {
      const store = new ReaderStore({ stateRoot: dir })
      await store.update(current => ({
        ...current,
        cache: { ttlHours: 12, maxEntries: 50 },
        tags: { 't-1': { id: 't-1', name: '灵感', createdAt: '2026-09-17T00:00:00.000Z' } },
        annotations: {
          e1: {
            body: { html: '<p>full text</p>', fetchedAt: '2026-09-17T10:00:00.000Z', expiresAt: '2026-09-17T22:00:00.000Z', url: 'https://example.com/a' },
            tagIds: ['t-1'],
          },
        },
      }))
      const { doc } = await store.read()
      expect(doc.cache).toEqual({ ttlHours: 12, maxEntries: 50 })
      expect(doc.tags?.['t-1']?.name).toBe('灵感')
      expect(doc.annotations?.e1?.body?.html).toBe('<p>full text</p>')
      expect(doc.annotations?.e1?.tagIds).toEqual(['t-1'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('defaults the cache policy when the file says nothing', () => {
    const doc = normalizeStateDoc({ sources: [] })
    expect(doc.cache).toBeUndefined()
    expect(emptyStateDoc().cache).toBeUndefined()
  })
})

describe('the recent list', () => {
  const item = (entryId: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
    entryId,
    sourceId: 's1',
    title: `文章 ${entryId}`,
    url: `https://example.com/${entryId}`,
    readAt: '2026-09-19T10:00:00.000Z',
    ...over,
  })

  it('drops records that cannot be reopened or ordered', () => {
    // The file is user-editable state, and a recent entry is only useful if it
    // knows what to reopen (both ids) and when it was read.
    const doc = normalizeStateDoc({
      sources: [],
      recent: [
        item('ok'),
        item('no-source', { sourceId: '' }),
        item('no-entry', { entryId: '  ' }),
        item('no-time', { readAt: 42 }),
        'not-an-object',
        item('no-title', { title: '', url: 'https://example.com/x' }),
        item('no-url', { url: undefined }),
      ],
    })
    expect(doc.recent?.map(entry => entry.entryId)).toEqual(['ok', 'no-title', 'no-url'])
    // A missing url is legal (an entry opened from a feed body alone).
    expect(doc.recent?.[2]?.url).toBeUndefined()
  })

  it('keeps one row per entry and keeps the file order', () => {
    const doc = normalizeStateDoc({ sources: [], recent: [item('a'), item('b'), item('a')] })
    expect(doc.recent?.map(entry => entry.entryId)).toEqual(['a', 'b'])
  })

  it('caps the list at MAX_RECENT_ENTRIES', () => {
    const recent = Array.from({ length: MAX_RECENT_ENTRIES + 25 }, (_, index) => item(`e${String(index)}`))
    const doc = normalizeStateDoc({ sources: [], recent })
    expect(doc.recent).toHaveLength(MAX_RECENT_ENTRIES)
    expect(doc.recent?.[0]?.entryId).toBe('e0')
    expect(doc.recent?.at(-1)?.entryId).toBe(`e${String(MAX_RECENT_ENTRIES - 1)}`)
  })

  it('round-trips the list through the disk document', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-reader-recent-'))
    try {
      const store = new ReaderStore({ stateRoot: dir })
      await store.update(current => ({ ...current, recent: [item('e1'), item('e2')] }))
      const { doc } = await store.read()
      expect(doc.recent?.map(entry => entry.entryId)).toEqual(['e1', 'e2'])
      expect(doc.recent?.[0]?.title).toBe('文章 e1')
      expect(doc.recent?.[0]?.readAt).toBe('2026-09-19T10:00:00.000Z')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})


describe('the translation tiers', () => {
  /** One annotation whose only content is a translation segment map. */
  const translated = (entryId: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
    [entryId]: {
      translation: {
        version: 1,
        pair: 'en→zh',
        bodyHash: `body-${entryId}`,
        segments: { h1: '译文一' },
        translatedAt: '2026-09-20T10:00:00.000Z',
        lastUsedAt: '2026-09-20T10:00:00.000Z',
        ...over,
      },
    },
  })

  it('keeps the translation records as recorded — a stale schema version included', () => {
    // Lazy invalidation is a contract of the READ path (a version mismatch is a
    // miss); the normalizer must not wipe the record, or "lazy" would be a lie.
    const doc = normalizeStateDoc({
      sources: [],
      annotations: {
        ...translated('e1'),
        ...translated('e2', { version: 0 }),
        bad: { translation: { pair: '', bodyHash: '' } },
      },
      translationMemory: { version: 0, file: 'translation-memory.json', entries: 3, chars: 120, updatedAt: '2026-09-20T10:00:00.000Z' },
    })
    expect(doc.annotations?.e1?.translation?.segments).toEqual({ h1: '译文一' })
    expect(doc.annotations?.e2?.translation?.version).toBe(0)
    // A translation record alone keeps the annotation, exactly like a fetch record.
    expect(doc.annotations?.bad).toBeUndefined()
    expect(doc.translationMemory).toEqual({ version: 0, file: 'translation-memory.json', entries: 3, chars: 120, updatedAt: '2026-09-20T10:00:00.000Z' })
  })

  it('refuses a translation file name that is not a bare file name', () => {
    // The name is joined into bodies/ on reads and prunes; a hand-edited
    // document must not turn that into a path.
    const doc = normalizeStateDoc({
      sources: [],
      annotations: { e1: { translation: { version: 1, pair: 'en→zh', bodyHash: 'b', file: '../escape', translatedAt: 'x', lastUsedAt: 'y' } } },
      translationMemory: { version: 1, file: '../../etc/passwd', entries: 1, chars: 1, updatedAt: 'z' },
    })
    expect(doc.annotations?.e1?.translation).toBeUndefined()
    expect(doc.translationMemory).toBeUndefined()
  })

  it('never evicts a translation to make room for a cached page', () => {
    // Same rule as tags: the costly-to-rebuild record survives the body budget.
    const base = withBodies(MAX_CACHED_BODIES + 1)
    const oldest = 'e0'
    const doc: ReaderStateDoc = {
      ...base,
      annotations: {
        ...base.annotations,
        [oldest]: {
          ...base.annotations?.[oldest],
          translation: {
            version: 1,
            pair: 'en→zh',
            bodyHash: 'b',
            segments: { h1: 't1' },
            translatedAt: 'x',
            lastUsedAt: 'y',
          },
        },
      },
    }
    const bounded = boundAnnotations(doc).doc
    expect(bounded.annotations?.[oldest]?.body).toBeUndefined()
    expect(bounded.annotations?.[oldest]?.translation?.segments).toEqual({ h1: 't1' })
  })
})

describe('the shared translation budget', () => {
  /** One memory entry with a controlled clock and size. */
  const mem = (at: string, size = 10): [string, { source: string; target: string; lastUsedAt: string }] => [
    `en→zh:${at}`,
    { source: 's'.repeat(size), target: 't'.repeat(size), lastUsedAt: at },
  ]
  /** One annotation carrying an entry translation with a controlled clock and size. */
  const entryMap = (at: string, size: number, version = 1): ReaderEntryAnnotation => ({
    translation: {
      version,
      pair: 'en→zh',
      bodyHash: 'b',
      segments: { h: 't'.repeat(size) },
      chars: size,
      translatedAt: at,
      lastUsedAt: at,
    },
  })

  it('evicts the least recently used across BOTH tiers, not per tier', () => {
    const memory = Object.fromEntries([
      mem('2026-09-20T00:00:03.000Z', 100), // newest
      mem('2026-09-20T00:00:01.000Z', 100), // oldest overall
      mem('2026-09-20T00:00:04.000Z', 100),
    ])
    const annotations: Record<string, ReaderEntryAnnotation> = {
      e1: entryMap('2026-09-20T00:00:02.000Z', 100), // second oldest
    }
    // Each memory entry measures ~253 chars (key + both texts + stamp), the map
    // 100: total 859. A budget of 550 fits exactly the two newest items.
    const bounded = boundTranslations(memory, annotations, 550)
    expect(bounded.evictedMemoryKeys).toEqual(['en→zh:2026-09-20T00:00:01.000Z'])
    expect(bounded.evictedEntryIds).toEqual(['e1'])
    expect(Object.keys(bounded.memory)).toHaveLength(2)
    expect(bounded.annotations.e1?.translation).toBeUndefined()
  })

  it('evicts a stale-schema entry map on sight, even with budget to spare', () => {
    const bounded = boundTranslations({}, { e1: entryMap('2026-09-20T00:00:00.000Z', 10, 0) }, 10_000)
    expect(bounded.evictedEntryIds).toEqual(['e1'])
    expect(bounded.annotations.e1?.translation).toBeUndefined()
  })

  it('caps the memory by count even when the budget has room', () => {
    const stamp = (index: number): string => new Date(Date.UTC(2026, 8, 20) + index * 1000).toISOString()
    const memory = Object.fromEntries(
      Array.from({ length: MAX_TRANSLATION_MEMORY_ENTRIES + 2 }, (_, index) => mem(stamp(index), 1)),
    )
    const bounded = boundTranslations(memory, {}, Number.MAX_SAFE_INTEGER)
    expect(bounded.evictedMemoryKeys).toEqual([`en→zh:${stamp(0)}`, `en→zh:${stamp(1)}`])
    expect(Object.keys(bounded.memory)).toHaveLength(MAX_TRANSLATION_MEMORY_ENTRIES)
  })

  it('leaves an under-budget pair untouched (same records, no evictions)', () => {
    const memory = Object.fromEntries([mem('2026-09-20T00:00:01.000Z', 10)])
    const annotations: Record<string, ReaderEntryAnnotation> = { e1: entryMap('2026-09-20T00:00:02.000Z', 10) }
    const bounded = boundTranslations(memory, annotations, 100_000)
    expect(bounded.memory).toBe(memory)
    expect(bounded.annotations).toBe(annotations)
    expect(bounded.evictedMemoryKeys).toEqual([])
    expect(bounded.evictedEntryIds).toEqual([])
  })
})
