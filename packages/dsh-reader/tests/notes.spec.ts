/**
 * The notes store and the model-facing reader_read tool's rendering.
 *
 * The store's promises: a note outlives everything the article cache does
 * (its own file), ids are never reused, concurrent writes do not lose one
 * another, and article snapshots are bounded. The tool's promise: the model
 * gets numbered paragraphs it can cite, the reader's notes beside them, and an
 * honest line when the text is not on the host.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_LOOSE_SNAPSHOTS,
  MAX_SNAPSHOT_CHARS,
  ReaderNotesStore,
  boundParagraphs,
  normalizeNotesDoc,
} from '../src/notes.ts'
import { READ_PAGE_CHARS, readerToolDefinitions, renderArticle, resolveEntry } from '../src/tools.ts'

const article = { entryId: 'https://example.com/a', title: 'Positional encoding', url: 'https://example.com/a', source: 'Example' }

let root: string
let store: ReaderNotesStore

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'reader-notes-'))
  store = new ReaderNotesStore({ stateRoot: root })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('notes live in their own file and keep their ids', () => {
  it('writes notes.json, never state.json', async () => {
    const note = await store.addNote({ ...article, block: 2, start: 5, quote: '  rotate the\nquery and key ', comment: 'why relative?' })
    expect(note).toMatchObject({ id: 'n1', anchor: { block: 2, start: 5, quote: 'rotate the query and key' }, comment: 'why relative?' })
    expect(existsSync(join(root, 'notes.json'))).toBe(true)
    expect(existsSync(join(root, 'state.json'))).toBe(false)
    expect(store.counts()).toEqual({ [article.entryId]: 1 })
  })

  it('keeps notes in article order and never hands out a deleted id again', async () => {
    await store.addNote({ ...article, block: 3, quote: 'third' })
    await store.addNote({ ...article, block: 1, quote: 'first' })
    expect(store.entry(article.entryId)?.notes.map(note => note.anchor.quote)).toEqual(['first', 'third'])
    expect(await store.deleteNote({ entryId: article.entryId, noteId: 'n2' })).toBe('ok')
    const next = await store.addNote({ ...article, block: 0, quote: 'zeroth' })
    expect(next).toMatchObject({ id: 'n3' })
  })

  it('stores the translated selection beside the original excerpt', async () => {
    const note = await store.addNote({ ...article, block: 0, quote: 'Attention is order-blind.', translated: '注意力不看顺序。' })
    expect(note).toMatchObject({ anchor: { quote: 'Attention is order-blind.', translated: '注意力不看顺序。' } })
  })

  it('refuses an empty excerpt and reports a missing note', async () => {
    expect(await store.addNote({ ...article, block: 0, quote: '   ' })).toBe('empty')
    expect(await store.updateNote({ entryId: article.entryId, noteId: 'n9', comment: 'x' })).toBe('not-found')
  })

  it('edits and clears a comment', async () => {
    await store.addNote({ ...article, block: 0, quote: 'q', comment: 'old' })
    await store.updateNote({ entryId: article.entryId, noteId: 'n1', comment: 'new' })
    expect(store.entry(article.entryId)?.notes[0]?.comment).toBe('new')
    await store.updateNote({ entryId: article.entryId, noteId: 'n1', comment: '  ' })
    expect(store.entry(article.entryId)?.notes[0]?.comment).toBeUndefined()
  })

  it('serializes concurrent writes instead of losing one', async () => {
    await Promise.all(Array.from({ length: 12 }, (_, index) => store.addNote({ ...article, block: index, quote: `q${String(index)}` })))
    const notes = store.entry(article.entryId)?.notes ?? []
    expect(notes).toHaveLength(12)
    expect(new Set(notes.map(note => note.id)).size).toBe(12)
  })

  it('drops the article row once it carries nothing', async () => {
    await store.addNote({ ...article, block: 0, quote: 'q' })
    await store.deleteNote({ entryId: article.entryId, noteId: 'n1' })
    expect(store.entry(article.entryId)).toBeUndefined()
  })

  it('remembers discussing conversations, most recent first, without duplicates', async () => {
    await store.recordSession({ ...article, sessionId: 's1', sessionTitle: 'first' })
    await store.recordSession({ ...article, sessionId: 's2' })
    await store.recordSession({ ...article, sessionId: 's1' })
    expect(store.entry(article.entryId)?.sessions.map(item => [item.sessionId, item.title])).toEqual([['s1', 'first'], ['s2', undefined]])
  })

  it('refuses to write over a notes file that does not parse', async () => {
    writeFileSync(join(root, 'notes.json'), '{ broken')
    await expect(store.addNote({ ...article, block: 0, quote: 'q' })).rejects.toThrow(/does not parse/)
    expect(readFileSync(join(root, 'notes.json'), 'utf8')).toBe('{ broken')
  })

  it('normalizes a hand-edited document and keeps the id counter ahead of every id', () => {
    const doc = normalizeNotesDoc({
      entries: {
        e: { title: 'T', nextNote: 1, notes: [{ id: 'n7', anchor: { quote: 'q', block: -3 } }, { id: 'n8' }] },
        empty: { title: 'nothing', notes: [] },
      },
      snapshots: { e: { file: '../../etc/passwd' } },
    })
    expect(doc.entries.e?.notes).toHaveLength(1)
    expect(doc.entries.e?.notes[0]?.anchor.block).toBe(0)
    expect(doc.entries.e?.nextNote).toBe(8)
    expect(doc.entries.empty).toBeUndefined()
    expect(doc.snapshots).toEqual({})
  })
})

describe('snapshots are the model\'s copy of the text, bounded', () => {
  it('keeps one string per block, empty blocks included, and reads it back', async () => {
    await store.snapshot({ ...article, paragraphs: ['First  para.', '', 'Third\npara.'] })
    expect(store.readSnapshot(article.entryId)?.paragraphs).toEqual(['First para.', '', 'Third para.'])
  })

  it('cuts at a paragraph boundary past the cap and says so', () => {
    const big = 'x'.repeat(MAX_SNAPSHOT_CHARS - 10)
    const bounded = boundParagraphs([big, 'y'.repeat(20), 'z'])
    expect(bounded.paragraphs).toHaveLength(1)
    expect(bounded.truncated).toBe(true)
  })

  it('prunes loose snapshots but keeps every one whose article has notes', async () => {
    await store.addNote({ ...article, block: 0, quote: 'kept' })
    await store.snapshot({ ...article, paragraphs: ['noted'] })
    for (let index = 0; index < MAX_LOOSE_SNAPSHOTS + 5; index++) {
      await store.snapshot({ entryId: `loose-${String(index)}`, title: `L${String(index)}`, paragraphs: ['p'] })
    }
    expect(store.readSnapshot(article.entryId)?.paragraphs).toEqual(['noted'])
    expect(store.readSnapshot('loose-0')).toBeUndefined()
    expect(readdirSync(join(root, 'snapshots'))).toHaveLength(MAX_LOOSE_SNAPSHOTS + 1)
  })

  it('works memory-only when the root cannot be written', async () => {
    const blocked = join(root, 'file')
    writeFileSync(blocked, '')
    const memory = new ReaderNotesStore({ stateRoot: join(blocked, 'below') })
    expect(memory.available).toBe(false)
    await memory.addNote({ ...article, block: 0, quote: 'q' })
    await memory.snapshot({ ...article, paragraphs: ['p'] })
    expect(memory.counts()).toEqual({ [article.entryId]: 1 })
    expect(memory.readSnapshot(article.entryId)?.paragraphs).toEqual(['p'])
  })
})

describe('reader_read', () => {
  it('numbers paragraphs, skips empty ones and lists notes with their ¶', async () => {
    await store.snapshot({ ...article, paragraphs: ['Alpha.', '', 'Gamma.'] })
    await store.addNote({ ...article, block: 2, quote: 'Gamma.', comment: 'hm', translated: '伽马。' })
    const text = renderArticle(article, store.readSnapshot(article.entryId), store.entry(article.entryId))
    expect(text).toContain('¶1 Alpha.')
    expect(text).not.toContain('¶2 ')
    expect(text).toContain('¶3 Gamma.')
    expect(text).toContain('n1 ¶3「Gamma.」')
    expect(text).toContain('译文：伽马。')
    expect(text).toContain('评论：hm')
  })

  it('pages a long article and points at the next ¶', () => {
    const paragraphs = Array.from({ length: 5 }, () => 'p'.repeat(READ_PAGE_CHARS / 2))
    const snapshot = { ...article, paragraphs, capturedAt: '' }
    const first = renderArticle(article, snapshot, undefined)
    expect(first).toContain('from=3')
    const next = renderArticle(article, snapshot, undefined, 3)
    expect(next).toContain('¶3 ')
    expect(next).not.toContain('¶1 ')
  })

  it('says plainly when the text is not on the host', () => {
    expect(renderArticle(article, undefined, undefined)).toContain('还没有这篇的正文')
  })

  it('resolves an id, a link (any scheme or slash) or a piece of the title', () => {
    const candidates = [
      { entryId: 'a', title: 'Positional encoding', url: 'https://example.com/a/' },
      { entryId: 'b', title: 'Rotary embeddings', url: 'https://example.com/b' },
    ]
    expect(resolveEntry('b', candidates).map(item => item.entryId)).toEqual(['b'])
    expect(resolveEntry('http://www.example.com/a', candidates).map(item => item.entryId)).toEqual(['a'])
    expect(resolveEntry('rotary', candidates).map(item => item.entryId)).toEqual(['b'])
    expect(resolveEntry('e', candidates)).toHaveLength(2)
  })

  it('reads the last opened article with no arguments and records the conversation', async () => {
    await store.snapshot({ ...article, paragraphs: ['Alpha.'] })
    const recent = [{ entryId: article.entryId, sourceId: 's', title: article.title, url: article.url, readAt: '' }]
    const [tool] = readerToolDefinitions({ listRecent: async () => ({ entries: recent }) }, store)
    const execute = (tool as unknown as { execute: (args: unknown, exec: unknown) => Promise<unknown> }).execute
    const answer = await execute({}, { agent: { session: { id: 'sess-1' } } })
    expect(JSON.stringify(answer)).toContain('¶1 Alpha.')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(store.entry(article.entryId)?.sessions.map(item => item.sessionId)).toEqual(['sess-1'])
  })
})
