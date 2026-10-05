/**
 * Genres (创作体裁, 2026-10-04): the registry a genre plugin fills, the
 * per-canvas selection that seeds role categories, and the durable session
 * binding the canvas tools target. The guarantee every case leans on: a
 * canvas without a genre is exactly the canvas it always was — no new keys on
 * disk, no binding, the sidebar focus still decides the tools' target.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { BINDINGS_FILE_NAME, CanvasBoardService } from '../src/store.ts'
import { categoryOfRole, normalizeBoard, type CanvasGenreDefinition } from '../src/types.ts'
import { FakeFs } from './fake-fs.ts'

const STATE = '/state'
const SESSION = { id: 's1', header: { cwd: '/ws' } } as unknown as Session
const OTHER = { id: 's2', header: { cwd: '/ws' } } as unknown as Session

const NOVEL: CanvasGenreDefinition = {
  id: 'novel',
  label: '长篇小说',
  version: 'novel@1',
  description: '人物、伏笔、章节与对账。',
  categories: [
    { role: 'character', label: '人物' },
    {
      role: 'foreshadow',
      label: '伏笔',
      definition: {
        version: 1,
        layout: 'entry',
        fields: [{ key: 'question', label: '悬念', type: 'line', hint: '读者心里的那个问题', required: true }],
        example: { question: '父亲为什么不回家' },
      },
    },
  ],
  agentRow: '@khorsheed/dsh-canvas-novel/agent',
}

/** A board service over a fresh fake, recording every event it emits. */
function bench(): { fs: FakeFs; board: CanvasBoardService; events: unknown[][] } {
  const fs = new FakeFs()
  const events: unknown[][] = []
  const ctx = {
    fs,
    get: () => undefined,
    emit: (...args: unknown[]) => { events.push(args) },
  } as unknown as Context
  const board = new CanvasBoardService(ctx, { stateRoot: STATE }, async path => { fs.removeTree(path) })
  return { fs, board, events }
}

async function plainCanvas(board: CanvasBoardService): Promise<string> {
  const created = await board.createCanvas({ title: '雨夜' }, SESSION)
  if (!created.ok) throw new Error(created.error)
  return created.board.id
}

describe('canvas genres', () => {
  it('leaves a canvas without a genre free of every genre key on disk', async () => {
    const { fs, board } = bench()
    const id = await plainCanvas(board)
    const put = await board.putCard({ canvasId: id, kind: 'fragment', text: '甲' }, SESSION)
    expect(put.ok).toBe(true)
    const text = await fs.readText(`${STATE}/${id}/canvas.json`)
    expect(text).not.toContain('"genre"')
    expect(text).not.toContain('"role"')
    expect((await board.listCanvases()).items[0]).not.toHaveProperty('genre')
  })

  it('lists registered genres, and the disposer removes only its own registration', () => {
    const { board } = bench()
    const dispose = board.registerGenre(NOVEL)
    expect(board.listGenres()).toEqual([{
      id: 'novel', label: '长篇小说', version: 'novel@1', description: NOVEL.description,
      roles: [{ role: 'character', label: '人物' }, { role: 'foreshadow', label: '伏笔' }],
      agentRow: '@khorsheed/dsh-canvas-novel/agent',
    }])
    const replaced = { ...NOVEL, version: 'novel@2' }
    board.registerGenre(replaced)
    dispose()
    expect(board.genre('novel')?.version).toBe('novel@2')
    expect(() => board.registerGenre({ ...NOVEL, id: 'Bad Id' })).toThrow()
  })

  it('seeds the role categories once, and finds them again after a rename', async () => {
    const { board, events } = bench()
    board.registerGenre(NOVEL)
    const id = await plainCanvas(board)
    const first = await board.selectGenre({ canvasId: id, genreId: 'novel' }, SESSION)
    if (!first.ok) throw new Error(first.error)
    expect(first.board.genre).toMatchObject({ id: 'novel', version: 'novel@1' })
    const character = categoryOfRole(first.board, 'character')!
    expect(character.label).toBe('人物')
    expect(categoryOfRole(first.board, 'foreshadow')?.definition?.fields[0]?.key).toBe('question')
    expect(events).toContainEqual(['canvas/genre-changed', id, 'novel'])

    // The user renames 人物 → 角色 through the catalog verb, which never sends roles.
    const renamed = await board.setCategories({
      canvasId: id,
      categories: first.board.categories.map(row => {
        const { role: _role, ...rest } = row
        return row.id === character.id ? { ...rest, label: '角色' } : rest
      }),
    }, SESSION)
    if (!renamed.ok) throw new Error(renamed.error)
    expect(categoryOfRole(renamed.board, 'character')?.label).toBe('角色')

    const again = await board.selectGenre({ canvasId: id, genreId: 'novel' }, SESSION)
    if (!again.ok) throw new Error(again.error)
    expect(again.board.categories).toHaveLength(first.board.categories.length)
    expect((await board.listCanvases()).items[0]?.genre).toBe('novel')
  })

  it('catches a canvas up with a newer genre on its next write, keeping what the user changed', async () => {
    const { fs, board } = bench()
    board.registerGenre(NOVEL)
    const id = await plainCanvas(board)
    const seeded = await board.selectGenre({ canvasId: id, genreId: 'novel' }, SESSION)
    if (!seeded.ok) throw new Error(seeded.error)
    // The user relabels the seeded field (as an adopted type change would); the genre then adds a title field before it.
    const file = `${STATE}/${id}/canvas.json`
    const raw = JSON.parse(await fs.readText(file)) as { categories: { role?: string; definition?: { fields: { label: string }[] } }[] }
    raw.categories.find(row => row.role === 'foreshadow')!.definition!.fields[0]!.label = '谜面'
    fs.seed(file, JSON.stringify(raw))
    const stored = categoryOfRole(normalizeBoard(raw, id, '')!, 'foreshadow')!.definition!
    board.registerGenre({
      ...NOVEL,
      version: 'novel@2',
      categories: NOVEL.categories.map(seed => seed.definition === undefined ? seed : {
        ...seed,
        definition: {
          ...seed.definition,
          version: 2,
          fields: [{ key: 'name', label: '名称', type: 'line', hint: '', required: true }, ...seed.definition.fields],
          example: { name: '父亲', question: '父亲为什么不回家' },
        },
      }),
    })
    const character = categoryOfRole(seeded.board, 'character')!.id
    const put = await board.putCard({ canvasId: id, kind: character, text: '甲' }, SESSION)
    if (!put.ok) throw new Error(put.error)
    expect(put.board.genre?.version).toBe('novel@2')
    const upgraded = categoryOfRole(put.board, 'foreshadow')!.definition!
    expect(upgraded.fields.map(field => [field.key, field.label])).toEqual([['name', '名称'], ['question', '谜面']])
    expect(upgraded.version).toBe(stored.version + 1)
    // Caught up: the next write leaves the type alone.
    const again = await board.putCard({ canvasId: id, kind: character, text: '乙' }, SESSION)
    if (!again.ok) throw new Error(again.error)
    expect(categoryOfRole(again.board, 'foreshadow')!.definition).toEqual(upgraded)
  })

  it('seeds the category of a role a newer genre version added, once', async () => {
    const { board } = bench()
    board.registerGenre(NOVEL)
    const id = await plainCanvas(board)
    const seeded = await board.selectGenre({ canvasId: id, genreId: 'novel' }, SESSION)
    if (!seeded.ok) throw new Error(seeded.error)
    expect(categoryOfRole(seeded.board, 'relation')).toBeUndefined()
    board.registerGenre({
      ...NOVEL,
      version: 'novel@2',
      categories: [...NOVEL.categories, { role: 'relation', label: '关系' }],
    })
    const character = categoryOfRole(seeded.board, 'character')!.id
    const put = await board.putCard({ canvasId: id, kind: character, text: '甲' }, SESSION)
    if (!put.ok) throw new Error(put.error)
    const relation = categoryOfRole(put.board, 'relation')
    expect(relation?.label).toBe('关系')
    expect(relation!.order).toBeGreaterThan(Math.max(...seeded.board.categories.map(category => category.order)))
    const again = await board.putCard({ canvasId: id, kind: character, text: '乙' }, SESSION)
    if (!again.ok) throw new Error(again.error)
    expect(again.board.categories.filter(category => category.role === 'relation')).toHaveLength(1)
  })

  it('refuses an unregistered genre, and clearing keeps the categories', async () => {
    const { board } = bench()
    board.registerGenre(NOVEL)
    const id = await plainCanvas(board)
    expect(await board.selectGenre({ canvasId: id, genreId: 'thesis' }, SESSION)).toEqual({ ok: false, error: 'missing' })
    await board.selectGenre({ canvasId: id, genreId: 'novel' }, SESSION)
    const cleared = await board.selectGenre({ canvasId: id, genreId: null }, SESSION)
    if (!cleared.ok) throw new Error(cleared.error)
    expect(cleared.board.genre).toBeUndefined()
    expect(categoryOfRole(cleared.board, 'character')).toBeDefined()
  })

  it('steps the empty built-ins aside while a genre is on, and restores exactly those on clear', async () => {
    const { board } = bench()
    board.registerGenre(NOVEL)
    const id = await plainCanvas(board)
    const enabledBuiltins = (row: { categories: readonly { id: string; enabled: boolean }[] }) =>
      row.categories.filter(category => category.enabled && ['fragment', 'question', 'grounding', 'reference', 'document'].includes(category.id)).map(category => category.id)
    const before = await board.readBoard({ canvasId: id })
    if (!before.ok) throw new Error(before.error)
    // One built-in holds a card: it stays on.
    const kept = await board.putCard({ canvasId: id, kind: 'fragment', text: '一个梦里的灯塔' }, SESSION)
    if (!kept.ok) throw new Error(kept.error)
    const novel = await board.selectGenre({ canvasId: id, genreId: 'novel' }, SESSION)
    if (!novel.ok) throw new Error(novel.error)
    expect(enabledBuiltins(novel.board)).toEqual(['fragment'])
    expect(categoryOfRole(novel.board, 'character')?.enabled).toBe(true)
    expect(novel.board.genre?.hid).toEqual(['question', 'grounding', 'reference', 'document'])
    // Re-selecting keeps the record rather than re-deriving it from the now-hidden rows.
    const again = await board.selectGenre({ canvasId: id, genreId: 'novel' }, SESSION)
    if (!again.ok) throw new Error(again.error)
    expect(again.board.genre?.hid).toEqual(['question', 'grounding', 'reference', 'document'])
    const cleared = await board.selectGenre({ canvasId: id, genreId: null }, SESSION)
    if (!cleared.ok) throw new Error(cleared.error)
    expect(enabledBuiltins(cleared.board)).toEqual(enabledBuiltins(before.board))
  })

  it('reads a hand-broken genre field as no genre', () => {
    const now = '2026-10-04T00:00:00.000Z'
    const base = { id: 'canvas_x', title: 't' }
    expect(normalizeBoard({ ...base, genre: { id: 'novel' } }, 'canvas_x', now)?.genre).toBeUndefined()
    expect(normalizeBoard({ ...base, genre: { id: 'novel', version: 'v', selectedAt: now } }, 'canvas_x', now)?.genre)
      .toEqual({ id: 'novel', version: 'v', selectedAt: now })
  })
})

describe('session binding', () => {
  it('binds only a canvas with a genre, and the tools target follows the binding', async () => {
    const { board, events } = bench()
    board.registerGenre(NOVEL)
    const plain = await plainCanvas(board)
    const novel = await plainCanvas(board)
    await board.selectGenre({ canvasId: novel, genreId: 'novel' }, SESSION)

    expect(await board.bindSession({ canvasId: plain }, SESSION)).toEqual({ ok: false, error: 'no-genre' })
    await board.focusCanvas({ canvasId: plain }, SESSION)
    expect(await board.targetCanvasId(SESSION)).toBe(plain)

    expect(await board.bindSession({ canvasId: novel }, SESSION)).toEqual({ ok: true, canvasId: novel })
    expect(events).toContainEqual(['canvas/binding-changed', 's1', novel])
    // The sidebar may show any canvas; the bound session still works on its own.
    expect(await board.targetCanvasId(SESSION)).toBe(novel)
    expect(await board.targetCanvasId(OTHER)).toBeUndefined()

    expect(await board.bindSession({ canvasId: null }, SESSION)).toEqual({ ok: true, canvasId: null })
    expect(await board.targetCanvasId(SESSION)).toBe(plain)
  })

  it('survives a restart: the binding lives in the state root', async () => {
    const { fs, board } = bench()
    board.registerGenre(NOVEL)
    const novel = await plainCanvas(board)
    await board.selectGenre({ canvasId: novel, genreId: 'novel' }, SESSION)
    await board.bindSession({ canvasId: novel }, SESSION)
    expect(JSON.parse(await fs.readText(`${STATE}/${BINDINGS_FILE_NAME}`))).toEqual({ s1: novel })

    const restarted = new CanvasBoardService(
      { fs, get: () => undefined, emit: () => {} } as unknown as Context, { stateRoot: STATE },
    )
    expect(await restarted.boundCanvasId('s1')).toBe(novel)
    expect((await restarted.listCanvases()).items).toHaveLength(1)
  })

  it('unbinds every session when the genre is cleared or the canvas deleted', async () => {
    const { board, events } = bench()
    board.registerGenre(NOVEL)
    const a = await plainCanvas(board)
    const b = await plainCanvas(board)
    for (const id of [a, b]) await board.selectGenre({ canvasId: id, genreId: 'novel' }, SESSION)
    await board.bindSession({ canvasId: a }, SESSION)
    await board.bindSession({ canvasId: b }, OTHER)

    await board.selectGenre({ canvasId: a, genreId: null }, SESSION)
    expect(await board.boundCanvasId('s1')).toBeUndefined()
    expect(events).toContainEqual(['canvas/binding-changed', 's1', null])

    await board.deleteCanvas({ canvasId: b }, SESSION)
    expect(await board.boundCanvasId('s2')).toBeUndefined()
  })
})
