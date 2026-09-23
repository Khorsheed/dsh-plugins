/**
 * Stage ⑤'s category catalog, at the three layers that decide what a category
 * is. The data layer: the tolerant read that makes the whole feature
 * zero-migration (`normalizeCategories` always carries the five built-ins,
 * `reconcileCategories` files an orphan card's row back rather than drop the
 * card). The store: the per-canvas write, and the fact that every card write
 * now asks THIS board whether the kind is usable — retired means "no new
 * cards", never "hide the old ones". The model face: the `kind` enum and the
 * menu it is spelled from come off the same list, and the count line spells a
 * category with the same token the card lines do.
 */
import { dirname, join, normalize } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { CanvasService } from '../src/service.ts'
import { CanvasBoardService } from '../src/store.ts'
import { categoryMenuOf, categoryTagOf, renderCanvasPrompt } from '../src/prompt.ts'
import { canvasToolDefinitions } from '../src/tools.ts'
import type { CanvasBoardService as BoardService } from '../src/store.ts'
import {
  BOARD_CARD_KINDS, MAX_CATEGORY_LABEL_LENGTH, defaultCategories, enabledCategories,
  isCardCategoryId, normalizeCategories, reconcileCategories, sanitizeCategoryLabel,
  type BoardCard, type BoardCategory, type CanvasBoard,
} from '../src/types.ts'

/** One custom id, in the shape `makeBoardId('cat', …)` mints. */
const CAT = 'cat_01234567abc'
/** A second custom id, for the "two rows" cases. */
const CAT2 = 'cat_00000000def'

type Entry = { kind: 'dir' } | { kind: 'file'; content: string; version: number }

/** The minimal `ctx.fs` the services touch, over a path → entry map. */
class FakeFs {
  private readonly entries = new Map<string, Entry>([['/', { kind: 'dir' }]])
  private seq = 0

  /** Plant a file directly (setup for the hand-edited-file cases). */
  seed(path: string, content: string): void {
    this.mkdirp(dirname(path))
    this.entries.set(path, { kind: 'file', content, version: ++this.seq })
  }

  /** Read a file's raw bytes back out of the fake. */
  text(path: string): string {
    const entry = this.entries.get(path)
    if (entry === undefined || entry.kind !== 'file') throw new Error(`no file at ${path}`)
    return entry.content
  }

  async resolve(path: string, opts?: { cwd?: string }): Promise<string> {
    return path.startsWith('/') ? normalize(path) : normalize(join(opts?.cwd ?? '/', path))
  }

  processPath(target: string): string {
    return target
  }

  contains(parent: string, child: string): boolean {
    return child === parent || child.startsWith(`${parent}/`)
  }

  async stat(target: string): Promise<{ version: string; type: 'file'; size: number } | undefined> {
    const entry = this.entries.get(target)
    if (entry === undefined || entry.kind !== 'file') return undefined
    return { version: String(entry.version), type: 'file', size: entry.content.length }
  }

  async readText(target: string): Promise<string> {
    const entry = this.entries.get(target)
    if (entry === undefined || entry.kind !== 'file') {
      throw new FsError(`no file at ${target}`, 'FS_NOT_FOUND')
    }
    return entry.content
  }

  async writeText(
    target: string,
    content: string,
    expected?: { kind: string; version?: string },
  ): Promise<{ operation: 'create' | 'update'; version: string; before: string | null; after: string }> {
    const existing = this.entries.get(target)
    if (expected?.kind === 'createIfAbsent' && existing !== undefined) {
      throw new FsError(`already exists: ${target}`, 'FS_NOT_OBSERVED')
    }
    if (expected?.kind === 'replaceIfVersion') {
      if (existing === undefined || existing.kind !== 'file' || String(existing.version) !== expected.version) {
        throw new FsError(`stale: ${target}`, 'FS_STALE_VERSION')
      }
    }
    this.mkdirp(dirname(target))
    const before = existing !== undefined && existing.kind === 'file' ? existing.content : null
    this.entries.set(target, { kind: 'file', content, version: ++this.seq })
    return {
      operation: existing === undefined ? 'create' : 'update',
      version: String(this.seq),
      before,
      after: content,
    }
  }

  async listDir(target: string): Promise<Array<{ name: string; type: 'file' | 'directory'; target: string }>> {
    if (this.entries.get(target) === undefined) {
      throw new FsError(`no directory at ${target}`, 'FS_NOT_FOUND')
    }
    const prefix = target === '/' ? '/' : `${target}/`
    const out = new Map<string, { name: string; type: 'file' | 'directory'; target: string }>()
    for (const [path, entry] of this.entries) {
      if (!path.startsWith(prefix) || path === target) continue
      const rest = path.slice(prefix.length)
      const name = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : rest
      if (out.has(name)) continue
      const childPath = `${prefix}${name}`
      const isDirectory = rest.includes('/') || entry.kind === 'dir'
      out.set(name, { name, type: isDirectory ? 'directory' : 'file', target: childPath })
    }
    return [...out.values()]
  }

  private mkdirp(dir: string): void {
    if (dir === '/' || dir === '.') return
    if (this.entries.get(dir)?.kind === 'dir') return
    this.mkdirp(dirname(dir))
    this.entries.set(dir, { kind: 'dir' })
  }
}

const STATE = '/state'
const SESSION = { id: 's1', header: { cwd: '/ws' } } as unknown as Session

interface Bench {
  fs: FakeFs
  board: BoardService
  /** Where one board's whole state lives (the store's own path rule). */
  fileOf: (canvasId: string) => string
}

/** One board service over a fresh fake filesystem. */
function harness(): Bench {
  const fs = new FakeFs()
  const ctx = { fs } as unknown as Context
  const pad = new CanvasService(ctx)
  ;(ctx as { canvasStore?: CanvasService }).canvasStore = pad
  return { fs, board: new CanvasBoardService(ctx, { stateRoot: STATE }), fileOf: id => `${STATE}/${id}/canvas.json` }
}

/** Create one board and unwrap the success half (tests fail loud otherwise). */
async function createBoard(board: BoardService): Promise<CanvasBoard> {
  const created = await board.createCanvas({ title: '为什么人们不愿表达异议' }, SESSION)
  if (!created.ok) throw new Error(`expected a created canvas, got ${created.error}`)
  return created.board
}

/** A one-card board for the prompt renderers, with the counts the renderer reads. */
function boardOf(cards: BoardCard[], categories: BoardCategory[]): CanvasBoard {
  const counts: Record<string, number> = {}
  for (const card of cards) {
    if (card.status !== 'archived') counts[card.kind] = (counts[card.kind] ?? 0) + 1
  }
  return {
    id: 'canvas_01234567abcdefgh',
    title: '主题',
    attachedWorkspaces: [],
    chat: { sessionId: null },
    cards,
    categories,
    stats: { proposed: { accepted: 0, rejected: 0 }, kindCounts: counts, lastActiveAt: '2026-09-16T08:00:00.000Z' },
    archivedAt: null,
    createdAt: '2026-09-16T08:00:00.000Z',
    updatedAt: '2026-09-16T08:00:00.000Z',
  } as CanvasBoard
}

/** One card fixture. */
function card(kind: string, text: string, overrides: Record<string, unknown> = {}): BoardCard {
  return {
    id: `c_${kind}_${text.length}`,
    kind,
    text,
    status: 'kept',
    comments: [],
    createdBy: 'user',
    createdAt: '2026-09-16T08:00:00.000Z',
    updatedAt: '2026-09-16T08:00:00.000Z',
    ...overrides,
  } as BoardCard
}

describe('the category id grammar', () => {
  it('accepts the five built-ins and cat_-prefixed base36 ids of the minted length', () => {
    for (const kind of BOARD_CARD_KINDS) expect(isCardCategoryId(kind)).toBe(true)
    expect(isCardCategoryId(CAT)).toBe(true)
    expect(isCardCategoryId(`cat_${'z'.repeat(32)}`)).toBe(true)
  })

  it('refuses anything that could shadow a built-in or name no file safely', () => {
    expect(isCardCategoryId('')).toBe(false)
    // Too short, upper-case, a built-in with a suffix, or a foreign prefix.
    expect(isCardCategoryId('cat_abc')).toBe(false)
    expect(isCardCategoryId('cat_01234567ABC')).toBe(false)
    expect(isCardCategoryId('fragment2')).toBe(false)
    expect(isCardCategoryId('cat/../canvas_01234567abcdefgh')).toBe(false)
    expect(isCardCategoryId(undefined)).toBe(false)
    expect(isCardCategoryId(7)).toBe(false)
  })
})

describe('defaultCategories / sanitizeCategoryLabel', () => {
  it('starts every canvas on the five built-ins, unrenamed and enabled', () => {
    expect(defaultCategories()).toEqual(BOARD_CARD_KINDS.map((kind, index) => ({
      id: kind, label: '', order: (index + 1) * 10, enabled: true,
    })))
  })

  it('collapses the label to display text, and returns nothing when none is left', () => {
    expect(sanitizeCategoryLabel('  反方 \t观点\n ')).toBe('反方 观点')
    expect(sanitizeCategoryLabel('a\u0000b\u001fc')).toBe('a b c')
    expect(sanitizeCategoryLabel('   ')).toBeUndefined()
    expect(sanitizeCategoryLabel('\u0000\u001f')).toBeUndefined()
    expect(sanitizeCategoryLabel('x'.repeat(MAX_CATEGORY_LABEL_LENGTH + 12))).toHaveLength(MAX_CATEGORY_LABEL_LENGTH)
  })
})

describe('normalizeCategories — the tolerant catalog read', () => {
  it('carries the five built-ins no matter what the file held, in the chip order they were designed in', () => {
    for (const raw of [undefined, null, 'nope', {}, [], [1, 'x', null]]) {
      // A legacy file (pre-stage-⑤) has no `categories` at all: the read must
      // be exactly what a new canvas starts with, order included.
      expect(normalizeCategories(raw)).toEqual(defaultCategories())
    }
  })

  it('keeps what it recognizes, and never lets a hand-edited file drop a built-in', () => {
    const rows = normalizeCategories([
      { id: CAT, label: '反方观点', order: 5, enabled: true },
      { id: 'fragment', label: '灵感', order: 90, enabled: false },
      { id: 'not-a-category', label: 'x', order: 1, enabled: true },
      { id: CAT, label: 'duplicate wins nothing', order: 6, enabled: true },
    ])
    // Order decides the strip, gaps and all — and an omitted built-in keeps its
    // own default slot, so the five never reshuffle into alphabetical order.
    expect(rows.map(row => row.id)).toEqual([CAT, 'question', 'grounding', 'reference', 'document', 'fragment'])
    expect(rows[0]).toMatchObject({ id: CAT, label: '反方观点', order: 5 })
    // A first-wins dedupe: the duplicate row never overwrites the real one.
    expect(rows.filter(row => row.id === CAT)).toHaveLength(1)
    // A retired built-in stays retired — the file said so, and that is legal.
    expect(rows.find(row => row.id === 'fragment')).toMatchObject({ label: '灵感', enabled: false })
  })

  it('gives a custom row no label its own id, caps a long one, and defaults a missing order', () => {
    const rows = normalizeCategories([
      { id: CAT },
      { id: CAT2, label: 'y'.repeat(MAX_CATEGORY_LABEL_LENGTH + 10), order: 'nope' },
    ])
    const orphan = rows.find(row => row.id === CAT)!
    expect(orphan.label).toBe(CAT)
    const capped = rows.find(row => row.id === CAT2)!
    expect(capped.label).toHaveLength(MAX_CATEGORY_LABEL_LENGTH)
    expect(capped.order).toBeGreaterThan(0)
    // A custom id can never be nameless on screen, a built-in can (it localizes).
    const restored = normalizeCategories([{ id: 'question', label: '' }])
    expect(restored.find(row => row.id === 'question')).toMatchObject({ id: 'question', label: '', enabled: true })
    expect(restored.find(row => row.id === 'question')!.order).toBeGreaterThan(0)
  })
})

describe('reconcileCategories — cards outlive their catalog, never the reverse', () => {
  it('returns the catalog untouched when no card is orphaned', () => {
    const categories = defaultCategories()
    expect(reconcileCategories(categories, ['fragment', 'question'])).toEqual(categories)
  })

  it('files an orphan custom kind back into the strip, last, named after itself', () => {
    const categories = defaultCategories()
    const merged = reconcileCategories(categories, [CAT, CAT, 'fragment'])
    expect(merged.slice(0, 5)).toEqual(categories)
    expect(merged[5]).toEqual({ id: CAT, label: CAT, order: 60, enabled: true })
    expect(merged.filter(row => row.id === CAT)).toHaveLength(1)
  })

  it('restores a missing built-in nameless (so it localizes) and ignores an unusable kind', () => {
    const five = defaultCategories()
    const withoutFragment = five.filter(row => row.id !== 'fragment')
    expect(reconcileCategories(withoutFragment, ['fragment'])[4]).toEqual({
      id: 'fragment', label: '', order: 60, enabled: true,
    })
    expect(reconcileCategories(withoutFragment, ['cat_nope'])).toEqual(withoutFragment)
  })
})

describe('the store: every card write asks THIS board', () => {
  it('starts a new canvas on the five built-ins', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    expect(created.categories.map(row => row.id)).toEqual([...BOARD_CARD_KINDS])
  })

  it('reads a pre-stage-⑤ file (no `categories` field at all) onto the default catalog', async () => {
    const { fs, board, fileOf } = harness()
    const created = await createBoard(board)
    const id = created.id
    const put = await board.putCard({ canvasId: id, kind: 'fragment', text: '沉默并不总是因为恐惧' }, SESSION)
    if (!put.ok) throw new Error('expected a card')
    // The exact shape an upgraded canvas has on disk: everything but the catalog.
    const file = fileOf(id)
    const raw = JSON.parse(fs.text(file)) as Record<string, unknown>
    delete raw['categories']
    fs.seed(file, JSON.stringify(raw))

    const read = await board.readBoard({ canvasId: id })
    if (!read.ok) throw new Error('expected a readable board')
    expect(read.board.categories).toEqual(defaultCategories())
    expect(read.board.cards.map(c => c.kind)).toContain('fragment')
  })

  it('accepts a card under a custom row, and refuses a retired or unknown one', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    const id = created.id
    const catalog = [
      ...created.categories.map(row => ({ ...row })),
      { id: CAT, label: '反方观点', order: 60, enabled: true },
      { id: CAT2, label: '已停用', order: 70, enabled: false },
    ]
    expect((await board.setCategories({ canvasId: id, categories: catalog }, SESSION)).ok).toBe(true)

    const landed = await board.putCard({ canvasId: id, kind: CAT, text: '反对意见也可以是数据' }, SESSION)
    expect(landed.ok).toBe(true)
    if (!landed.ok) return
    expect(landed.board.cards[landed.board.cards.length - 1]?.kind).toBe(CAT)

    // Retired: no new cards, even though the row and its old cards still exist.
    expect(await board.putCard({ canvasId: id, kind: CAT2, text: '进不来' }, SESSION))
      .toMatchObject({ ok: false, error: 'invalid-name' })
    // Unknown: a legal id that this canvas never adopted.
    expect(await board.putCard({ canvasId: id, kind: 'cat_999999999zz', text: '进不来' }, SESSION))
      .toMatchObject({ ok: false, error: 'invalid-name' })
  })

  it('holds the retired chip honest: its existing cards stay readable, only writes stop', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    const id = created.id
    const first = await board.putCard({ canvasId: id, kind: 'reference', text: '一份排期记录' }, SESSION)
    if (!first.ok) throw new Error('expected the card to land')
    const cardId = first.board.cards[first.board.cards.length - 1]!.id
    expect((await board.setCategories(
      { canvasId: id, categories: first.board.categories.map(row => (row.id === 'reference' ? { ...row, enabled: false } : row)) },
      SESSION,
    )).ok).toBe(true)

    const read = await board.readBoard({ canvasId: id })
    if (!read.ok) throw new Error('expected a readable board')
    expect(read.board.categories.find(row => row.id === 'reference')).toMatchObject({ enabled: false })
    expect(enabledCategories(read.board.categories).map(row => row.id)).not.toContain('reference')
    // The card itself is untouched — retire is hide-the-chip, not drop-the-row.
    expect(read.board.cards.map(c => c.id)).toContain(cardId)
    expect(read.board.cards.find(c => c.id === cardId)).toMatchObject({ kind: 'reference', status: 'kept' })
  })

  it('refile moves a card and its question lifecycle with it', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    const id = created.id
    const catalog = [...created.categories.map(row => ({ ...row })), { id: CAT, label: '反方观点', order: 60, enabled: true }]
    const withCat = await board.setCategories({ canvasId: id, categories: catalog }, SESSION)
    if (!withCat.ok) throw new Error('expected the catalog to land')
    const put = await board.putCard({ canvasId: id, kind: 'question', text: '为什么没人说？' }, SESSION)
    if (!put.ok) throw new Error('expected a question card')
    const cardId = put.board.cards[put.board.cards.length - 1]!.id
    expect(put.board.cards.find(c => c.id === cardId)?.question).toEqual({ state: 'open' })

    const out = await board.patchCard({ canvasId: id, cardId, kind: CAT }, SESSION)
    if (!out.ok) throw new Error('expected the refile to land')
    const moved = out.board.cards.find(c => c.id === cardId)!
    expect(moved.kind).toBe(CAT)
    expect(moved.question).toBeUndefined()

    const back = await board.patchCard({ canvasId: id, cardId, kind: 'question' }, SESSION)
    if (!back.ok) throw new Error('expected the second refile to land')
    expect(back.board.cards.find(c => c.id === cardId)?.question).toEqual({ state: 'open' })

    expect(await board.patchCard({ canvasId: id, cardId, kind: 'cat_999999999zz' }, SESSION))
      .toMatchObject({ ok: false, error: 'invalid-name' })
  })

  it('gives the agent the same per-board check on its one entrance', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    const id = created.id
    const catalog = created.categories.map(row => (row.id === 'grounding' ? { ...row, enabled: false } : { ...row }))
    const off = await board.setCategories({ canvasId: id, categories: catalog }, SESSION)
    if (!off.ok) throw new Error('expected the catalog to land')
    expect(await board.proposeCard({ canvasId: id, kind: 'grounding', text: '一条共识' }, SESSION))
      .toMatchObject({ ok: false, error: 'invalid-name' })
    const custom = await board.setCategories(
      { canvasId: id, categories: [...off.board.categories, { id: CAT, label: '反方观点', order: 60, enabled: true }] },
      SESSION,
    )
    if (!custom.ok) throw new Error('expected the catalog to land')
    const proposed = await board.proposeCard({ canvasId: id, kind: CAT, text: '一个反例' }, SESSION)
    expect(proposed.ok).toBe(true)
    if (!proposed.ok) return
    expect(proposed.board.cards[proposed.board.cards.length - 1]).toMatchObject({ kind: CAT, status: 'proposed' })
  })

  it('writes the catalog as one rewrite, and files the retired category cards in the same act', async () => {
    const { fs, board, fileOf } = harness()
    const created = await createBoard(board)
    const id = created.id
    const withCards = await board.putCard({ canvasId: id, kind: 'fragment', text: '沉默并不总是因为恐惧' }, SESSION)
    if (!withCards.ok) throw new Error('expected a card')
    const proposed = await board.proposeCard({ canvasId: id, kind: 'fragment', text: '一条待确认的灵感' }, SESSION)
    if (!proposed.ok) throw new Error('expected a proposal')
    const keptId = withCards.board.cards.find(c => c.text.startsWith('沉默'))!.id
    const proposedId = proposed.board.cards.find(c => c.status === 'proposed')!.id

    const result = await board.setCategories({
      canvasId: id,
      // A hand-made list that forgot the built-ins: the store puts them back.
      categories: [{ id: CAT, label: '反方观点', order: 60, enabled: true }],
      archiveCardIds: [keptId],
    }, SESSION)
    if (!result.ok) throw new Error('expected the catalog write to land')
    const board2 = result.board
    expect(board2.categories.map(row => row.id)).toContain(CAT)
    for (const kind of BOARD_CARD_KINDS) expect(board2.categories.map(row => row.id)).toContain(kind)
    // The custom row first (order 60 vs the restored built-ins at 0).
    expect(board2.categories[board2.categories.length - 1]?.id).toBe(CAT)

    expect(board2.cards.find(c => c.id === keptId)).toMatchObject({ status: 'archived' })
    expect(board2.cards.find(c => c.id === proposedId)).toMatchObject({ status: 'proposed' })
    expect(board2.stats.proposed.rejected).toBe(0)
    // Retiring the category itself is a second, separate act — the archive list
    // alone never flips a row's `enabled`.
    expect(board2.categories.find(row => row.id === 'fragment')).toMatchObject({ enabled: true })

    // The counts follow the visible set, and the file on disk carries the catalog.
    const read = await board.readBoard({ canvasId: id })
    if (!read.ok) throw new Error('expected a readable board')
    expect(read.board.stats.kindCounts['fragment']).toBe(1)
    expect(JSON.parse(fs.text(fileOf(id)))['categories']).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: CAT, label: '反方观点' })]),
    )
  })

  it('re-files an orphan row on read, so a hand-edited file never hides a card', async () => {
    const { fs, board, fileOf } = harness()
    const created = await createBoard(board)
    const id = created.id
    const catalog = [...created.categories.map(row => ({ ...row })), { id: CAT, label: '反方观点', order: 60, enabled: true }]
    const withCat = await board.setCategories({ canvasId: id, categories: catalog }, SESSION)
    if (!withCat.ok) throw new Error('expected the catalog to land')
    const put = await board.putCard({ canvasId: id, kind: CAT, text: '一张自定义卡' }, SESSION)
    if (!put.ok) throw new Error('expected the custom card to land')

    // Hand-edit the file: someone deleted the custom row and renamed nothing.
    // Dropping the card would be data loss, so the read brings the row back.
    const file = fileOf(id)
    const raw = JSON.parse(fs.text(file)) as { categories: unknown[] }
    fs.seed(file, JSON.stringify({ ...raw, categories: raw.categories.filter(row => (row as { id: string }).id !== CAT) }))

    const read = await board.readBoard({ canvasId: id })
    if (!read.ok) throw new Error('expected a readable board')
    expect(read.board.cards.map(c => c.kind)).toContain(CAT)
    expect(read.board.categories.find(row => row.id === CAT)).toMatchObject({ id: CAT, label: CAT, enabled: true })
    // The hand-edit stays behind until a write presents the version it read —
    // a read never rewrites the file.
    expect(JSON.parse(fs.text(file))['categories']).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ id: CAT })]),
    )
  })
})

describe('the model face of the catalog', () => {
  it('spells an untouched built-in as the bare id, and anything named as id（名称）', () => {
    expect(categoryTagOf(undefined, 'fragment')).toBe('fragment')
    expect(categoryTagOf({ id: 'fragment', label: '', order: 10, enabled: true }, 'fragment')).toBe('fragment')
    expect(categoryTagOf({ id: 'fragment', label: '闪念', order: 10, enabled: true }, 'fragment')).toBe('fragment（闪念）')
    expect(categoryTagOf({ id: CAT, label: CAT, order: 60, enabled: true }, CAT)).toBe(`${CAT}（${CAT}）`)
  })

  it('menus the enabled rows, and falls back to the five when all are retired', () => {
    expect(categoryMenuOf(defaultCategories())).toBe(
      'fragment（灵感）、question（问题）、grounding（共识）、reference（来源）、document（文档）',
    )
    expect(categoryMenuOf([
      { id: 'fragment', label: '闪念', order: 10, enabled: true },
      { id: 'question', label: '', order: 20, enabled: false },
      { id: CAT, label: '反方观点', order: 60, enabled: true },
    ])).toBe(`fragment（闪念）、${CAT}（反方观点）`)
    expect(categoryMenuOf(defaultCategories().map(row => ({ ...row, enabled: false }))))
      .toBe('fragment（灵感）、question（问题）、grounding（共识）、reference（来源）、document（文档）')
  })

  it('counts the board with the same token the card lines use', () => {
    const renamed = defaultCategories().map(row => (row.id === 'fragment' ? { ...row, label: '闪念' } : row))
    const prompt = renderCanvasPrompt(boardOf([card('fragment', '沉默并不总是因为恐惧')], renamed))
    expect(prompt).toContain('板上现有 1 张可见卡（fragment（闪念） 1）')
    expect(prompt).toContain('- [fragment（闪念）] 沉默并不总是因为恐惧')
    // Untouched: the count line is the bare id, exactly as before the catalog.
    expect(renderCanvasPrompt(boardOf([card('fragment', '一条灵感')], defaultCategories())))
      .toContain('板上现有 1 张可见卡（fragment 1）')
  })

  it('names the grounding guardrail after the row the user gave it', () => {
    const renamed = defaultCategories().map(row => (row.id === 'grounding' ? { ...row, label: '我们的共识' } : row))
    const prompt = renderCanvasPrompt(boardOf([card('grounding', '先问，再下结论')], renamed))
    expect(prompt).toContain('以下「我们的共识」是用户确认过的既定立场')
    expect(renderCanvasPrompt(boardOf([card('grounding', '先问，再下结论')], defaultCategories())))
      .toContain('以下「共识」是用户确认过的既定立场')
  })

  it('hands the side-chat tools THIS canvas enum, on the same floor as the menu', async () => {
    const { board } = harness()
    const created = await createBoard(board)
    const catalog = [
      ...created.categories.map(row => ({ ...row })),
      { id: CAT, label: '反方观点', order: 60, enabled: true },
      { id: CAT2, label: '已停用', order: 70, enabled: false },
    ]
    // `defineTool` compiles the declarative parameters into a JSON Schema, so
    // the enum the model sees lives under `properties.kind`, and the spelled
    // menu lives in the tool's own description.
    const proposeOf = (categories: readonly BoardCategory[]): { enum?: string[]; description: string } => {
      const def = canvasToolDefinitions(board, created.id, SESSION, categories)
        .find(row => row.name === 'canvas_propose_card')!
      const schema = def.parameters as unknown as { properties: Record<string, { enum?: string[] }> }
      return { enum: schema.properties['kind']?.enum, description: def.description }
    }
    expect(proposeOf(catalog).enum).toEqual([...BOARD_CARD_KINDS, CAT])
    expect(proposeOf(catalog).description).toContain(`${CAT}（反方观点）`)
    expect(proposeOf(catalog).description).not.toContain(`${CAT2}（已停用）`)
    // Retired-everything: still a wire-legal enum, and the menu says the same.
    const allOff = defaultCategories().map(row => ({ ...row, enabled: false }))
    expect(proposeOf(allOff).enum).toEqual([...BOARD_CARD_KINDS])
    expect(proposeOf(allOff).description).toContain('fragment（灵感）')
  })
})
