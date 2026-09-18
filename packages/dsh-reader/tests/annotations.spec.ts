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
  emptyStateDoc,
  normalizeStateDoc,
  pruneOrphanTags,
  ReaderStore,
} from '../src/store.ts'
import type { ReaderStateDoc } from '../src/types.ts'

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
