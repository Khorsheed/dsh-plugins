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
