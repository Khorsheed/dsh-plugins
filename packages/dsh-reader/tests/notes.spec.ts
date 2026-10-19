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
import { READ_PAGE_CHARS, headerOf, pointsOf, readerToolDefinitions, renderArticle, resolveEntry } from '../src/tools.ts'

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

describe('conclusions and discussion notes', () => {
  it('threads conclusions under a note and turns a rewritten one into the reader\'s', async () => {
    await store.addNote({ ...article, block: 0, quote: 'q' })
    expect(await store.addReply({ entryId: article.entryId, noteId: 'n1', text: 'agent says', by: 'agent', sessionId: 's1' })).toBe('ok')
    expect(await store.addReply({ entryId: article.entryId, noteId: 'n9', text: 'x', by: 'user' })).toBe('not-found')
    await store.editReply({ entryId: article.entryId, noteId: 'n1', index: 0, text: 'my words' })
    expect(store.entry(article.entryId)?.notes[0]?.replies).toMatchObject([{ by: 'user', text: 'my words', editedFrom: 'agent', sessionId: 's1' }])
    await store.editReply({ entryId: article.entryId, noteId: 'n1', index: 0, text: '' })
    expect(store.entry(article.entryId)?.notes[0]?.replies).toBeUndefined()
  })

  it('keeps discussion notes newest first, with never-reused ids, and remembers their conversation', async () => {
    await store.addDiscussion({ ...article, kind: 'discussion', sessionId: 's1', points: [{ text: 'one' }] })
    const second = await store.addDiscussion({ ...article, kind: 'check', sessionId: 's2', points: [{ text: 'two', para: 3 }], aside: '其余 2 题讲到位了' })
    expect(second).toMatchObject({ id: 'd2', kind: 'check', points: [{ text: 'two', para: 3 }] })
    expect(store.entry(article.entryId)?.discussions?.map(item => item.id)).toEqual(['d2', 'd1'])
    expect(store.sessionEntry('s2')).toBe(article.entryId)
    await store.deleteDiscussion({ entryId: article.entryId, discussionId: 'd2' })
    expect((await store.addDiscussion({ ...article, kind: 'discussion', points: [{ text: 'three' }] })) as { id: string }).toMatchObject({ id: 'd3' })
    expect(await store.addDiscussion({ ...article, kind: 'discussion', points: [] })).toBe('empty')
  })

  it('reads points one per line, with ¶ citations and the aside', () => {
    expect(pointsOf('1. RoPE 不加在输入上。原文 ¶3。\n- 外推更长的序列（¶4）\n其余 2 题讲到位了')).toEqual({
      points: [{ text: 'RoPE 不加在输入上。', para: 3 }, { text: '外推更长的序列', para: 4 }],
      aside: '其余 2 题讲到位了',
    })
    expect(headerOf('笔记：n2\n类型：考考我\n正文')).toEqual({ note: 'n2', kind: 'check', body: '正文' })
  })
})

describe('reader_note', () => {
  const recent = [{ entryId: article.entryId, sourceId: 's', title: article.title, url: article.url, readAt: '' }]
  const run = async (args: Record<string, unknown>, sessionId = 'sess-1'): Promise<string> => {
    const tool = readerToolDefinitions({ listRecent: async () => ({ entries: recent }) }, store).find(item => item.name === 'reader_note')!
    const execute = (tool as unknown as { execute: (args: unknown, exec: unknown) => Promise<unknown> }).execute
    return JSON.stringify(await execute(args, { agent: { session: { id: sessionId } } }))
  }

  it('refuses to guess the article when the conversation never discussed one', async () => {
    await expect(run({ op: 'discussion', text: 'x' })).rejects.toThrow(/还没有讨论过/)
  })

  it('writes a conclusion under a note, and names the notes that exist when the id is wrong', async () => {
    await store.addNote({ ...article, block: 0, quote: 'q' })
    await store.recordSession({ ...article, sessionId: 'sess-1' })
    expect(await run({ op: 'conclusion', note: 'n1', text: '是和角公式。' })).toContain('笔记 n1')
    expect(store.entry(article.entryId)?.notes[0]?.replies?.[0]).toMatchObject({ by: 'agent', text: '是和角公式。', sessionId: 'sess-1' })
    await expect(run({ op: 'conclusion', note: 'n7', text: 'x' })).rejects.toThrow(/现有：n1/)
  })

  it('takes the text-only form when the flat arguments did not arrive', async () => {
    await store.recordSession({ ...article, sessionId: 'sess-1' })
    expect(await run({ text: '类型：考考我\n- RoPE 不加在输入上 ¶3\n其余 2 题讲到位了' })).toContain('考考我笔记 d1')
    expect(store.entry(article.entryId)?.discussions?.[0]).toMatchObject({ kind: 'check', points: [{ para: 3 }], aside: '其余 2 题讲到位了' })
  })

  it('shows conclusions and discussion notes to reader_read', async () => {
    await store.addNote({ ...article, block: 0, quote: 'q' })
    await store.addReply({ entryId: article.entryId, noteId: 'n1', text: 'concluded', by: 'agent' })
    await store.addDiscussion({ ...article, kind: 'check', points: [{ text: 'gap', para: 2 }] })
    const text = renderArticle(article, undefined, store.entry(article.entryId))
    expect(text).toContain('讨论结论：concluded')
    expect(text).toContain('d1 考考我')
    expect(text).toContain('- gap（¶2）')
  })
})

describe('sync marks', () => {
  it('remembers which canvas card a note and a discussion note became', async () => {
    await store.addNote({ ...article, block: 0, quote: 'q' })
    await store.addDiscussion({ ...article, kind: 'discussion', points: [{ text: 'p' }] })
    expect(await store.markSynced({ entryId: article.entryId, noteId: 'n1', canvasId: 'c', cardId: 'k1', canvasTitle: 'Board' })).toBe('ok')
    expect(await store.markSynced({ entryId: article.entryId, discussionId: 'd1', canvasId: 'c', cardId: 'k2', canvasTitle: 'Board' })).toBe('ok')
    expect(await store.markSynced({ entryId: article.entryId, noteId: 'n5', canvasId: 'c', cardId: 'k', canvasTitle: 'B' })).toBe('not-found')
    const entry = store.entry(article.entryId)
    expect(entry?.notes[0]?.syncedTo).toMatchObject([{ canvasId: 'c', cardId: 'k1', canvasTitle: 'Board' }])
    expect(entry?.discussions?.[0]?.syncedTo).toMatchObject([{ cardId: 'k2' }])
  })
})
