/**
 * Stage ⑥'s layout data: the lines, the lanes and the places. The whole point of
 * this layer is that a board without any of them is not a migration — the
 * tolerant read answers `[]` for both fields and no position for a card, so the
 * link view opens onto the same cards the 卡板 shows, unconnected and flowing.
 * The second point is the SHAPE of the write: one verb, and `absent ≠ empty`,
 * because 「清空」 and 「这次没动它」 have to be distinguishable or clearing never
 * saves (the lesson the drawing field already paid for, §11.4). The third is
 * that a stored number is a UNIT of the logical frame, never a screen pixel —
 * including a negative one, which the frame's edge would have eaten.
 */
import { dirname, join, normalize } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { CanvasService } from '../src/service.ts'
import { CanvasBoardService } from '../src/store.ts'
import type { CanvasBoardService as BoardService } from '../src/store.ts'
import {
  DRAW_BOX, LAYOUT_BOX, MAX_BOARD_LANES, MAX_BOARD_LINKS, MAX_LANE_LABEL_LENGTH, MIN_LANE_SIZE,
  normalizeBoard, normalizeLanes, normalizeLinks, normalizePositions,
  type BoardCard, type CanvasBoard,
} from '../src/types.ts'

type Entry = { kind: 'dir' } | { kind: 'file'; content: string; version: number }

/** The minimal `ctx.fs` the store touches, over a path → entry map. */
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

  private mkdirp(dir: string): void {
    if (dir === '/' || dir === '.') return
    if (this.entries.get(dir)?.kind === 'dir') return
    this.mkdirp(dirname(dir))
    this.entries.set(dir, { kind: 'dir' })
  }
}

const STATE = '/state'
const SESSION = { id: 's1', header: { cwd: '/ws' } } as unknown as Session

/** One board service over a fresh fake filesystem. */
function harness(): { fs: FakeFs; board: BoardService; fileOf: (canvasId: string) => string } {
  const fs = new FakeFs()
  const ctx = { fs } as unknown as Context
  const pad = new CanvasService(ctx)
  ;(ctx as { canvasStore?: CanvasService }).canvasStore = pad
  return {
    fs,
    board: new CanvasBoardService(ctx, { stateRoot: STATE }),
    fileOf: id => `${STATE}/${id}/canvas.json`,
  }
}

/** Create one board and hand back the service plus its fresh token. */
async function created(): Promise<{
  fs: FakeFs
  board: BoardService
  id: string
  version: string
  fileOf: (id: string) => string
}> {
  const { fs, board, fileOf } = harness()
  const result = await board.createCanvas({ title: '为什么人们不愿表达异议' }, SESSION)
  if (!result.ok) throw new Error(`expected a created canvas, got ${result.error}`)
  return { fs, board, id: result.board.id, version: result.version, fileOf }
}

/** Add one card and unwrap its id. */
async function putCard(board: BoardService, canvasId: string, text: string): Promise<string> {
  const result = await board.putCard({ canvasId, kind: 'fragment', text }, SESSION)
  if (!result.ok) throw new Error(`expected a card, got ${result.error}`)
  const card = result.board.cards.find(candidate => candidate.text === text)
  if (card === undefined) throw new Error('the card did not land')
  return card.id
}

/** Read one board back, tolerating the caller's token bookkeeping. */
async function read(board: BoardService, canvasId: string): Promise<CanvasBoard> {
  const result = await board.readBoard({ canvasId })
  if (!result.ok) throw new Error(`expected a readable board, got ${result.error}`)
  return result.board
}

/** A card object for the pure reads (only its id matters to them). */
function card(id: string): BoardCard {
  return {
    id,
    kind: 'fragment',
    text: '一张卡',
    status: 'kept',
    comments: [],
    createdBy: 'user',
    createdAt: '2026-09-23T08:00:00.000Z',
    updatedAt: '2026-09-23T08:00:00.000Z',
  }
}

describe('normalizeLanes', () => {
  it('reads a non-array as no lanes at all', () => {
    for (const raw of [undefined, null, 'nope', {}, 7]) {
      expect(normalizeLanes(raw)).toEqual([])
    }
  })

  it('keeps a well-formed row and drops the ones that cannot be drawn', () => {
    const lanes = normalizeLanes([
      { id: 'lane_01', label: '论据', x: 0, y: 0, w: 200, h: 120 },
      { id: 'lane_02', label: '缺几何', x: 0 },
      { id: 'lane_03', label: 'NaN 宽', x: 0, y: 0, w: Number.NaN, h: 120 },
      'nope',
      null,
      { x: 0, y: 0, w: 200, h: 120 },
    ])
    expect(lanes).toEqual([{ id: 'lane_01', label: '论据', x: 0, y: 0, w: 200, h: 120 }])
  })

  it('never stores a lane too small to hold its own title', () => {
    const [lane] = normalizeLanes([{ id: 'lane_01', label: '小', x: 10, y: 10, w: 3, h: 3 }])
    expect(lane).toEqual({
      id: 'lane_01',
      label: '小',
      x: 10,
      y: 10,
      w: MIN_LANE_SIZE.width,
      h: MIN_LANE_SIZE.height,
    })
  })

  it('rounds a drag float to whole units and keeps the lane first-seen', () => {
    const lanes = normalizeLanes([
      { id: 'lane_01', label: '第一个', x: 12.4, y: 8.6, w: 200.5, h: 120 },
      { id: 'lane_01', label: '第二个', x: 900, y: 900, w: 300, h: 300 },
    ])
    expect(lanes).toHaveLength(1)
    expect(lanes[0]).toEqual({ id: 'lane_01', label: '第一个', x: 12, y: 9, w: 201, h: 120 })
  })

  it('leaves an unnamed lane unnamed — the words belong to the client', () => {
    const [lane] = normalizeLanes([{ id: 'lane_01', x: 0, y: 0, w: 200, h: 120 }])
    expect(lane?.label).toBe('')
    expect(lane?.x).toBe(0)
  })

  it('folds a title the way a title folds, and caps it', () => {
    const [lane] = normalizeLanes([{
      id: 'lane_01',
      label: `  这一组\u0000在\u0000回答   什么  ${'长'.repeat(40)}`,
      x: 0,
      y: 0,
      w: 200,
      h: 120,
    }])
    expect(lane?.label).toBe(`这一组 在 回答 什么 ${'长'.repeat(40)}`.slice(0, MAX_LANE_LABEL_LENGTH))
    expect(lane?.label).toHaveLength(MAX_LANE_LABEL_LENGTH)
  })

  it('stops at the lane cap', () => {
    const rows = Array.from({ length: MAX_BOARD_LANES + 20 }, (_, index) => ({
      id: `lane_${index}`,
      label: '',
      x: index,
      y: index,
      w: 200,
      h: 120,
    }))
    expect(normalizeLanes(rows)).toHaveLength(MAX_BOARD_LANES)
  })
})

describe('normalizeLinks', () => {
  const ids = ['c_01', 'c_02', 'c_03']

  it('reads a non-array as no lines at all', () => {
    for (const raw of [undefined, null, 'nope', {}, 7]) {
      expect(normalizeLinks(raw, ids)).toEqual([])
    }
  })

  it('drops a line whose far end names a card the board does not have', () => {
    const links = normalizeLinks([
      { from: 'c_01', to: 'c_02' },
      { from: 'c_01', to: 'c_gone' },
      { from: 'c_stranger', to: 'c_03' },
    ], ids)
    expect(links).toEqual([{ from: 'c_01', to: 'c_02' }])
  })

  it('keeps one unordered pair once, and refuses a line to itself', () => {
    const links = normalizeLinks([
      { from: 'c_01', to: 'c_02' },
      { from: 'c_02', to: 'c_01' },
      { from: 'c_01', to: 'c_01' },
    ], ids)
    expect(links).toEqual([{ from: 'c_01', to: 'c_02' }])
  })

  it('reads junk entries and a missing end as no line', () => {
    const links = normalizeLinks([
      'nope',
      null,
      { from: 'c_01' },
      { from: 7, to: 'c_02' },
      { from: 'c_01', to: 'c_03' },
    ], ids)
    expect(links).toEqual([{ from: 'c_01', to: 'c_03' }])
  })

  it('stops at the line cap', () => {
    const many = Array.from({ length: MAX_BOARD_LINKS + 5 }, (_, index) => ({ from: 'c_01', to: `c_${index}` }))
    const every = ['c_01', ...many.map(row => row.to)]
    expect(normalizeLinks(many, every)).toHaveLength(MAX_BOARD_LINKS)
  })
})

describe('normalizePositions', () => {
  it('reads a non-array as nothing moved', () => {
    for (const raw of [undefined, null, 'nope', {}, 7]) {
      expect(normalizePositions(raw)).toEqual([])
    }
  })

  it('requires a complete pair, because half a position is not a place', () => {
    const positions = normalizePositions([
      { id: 'c_01', x: 10, y: 20 },
      { id: 'c_02', x: 10 },
      { id: 'c_03', y: 20 },
      { id: 'c_04', x: Number.NaN, y: 20 },
      { x: 10, y: 20 },
    ])
    expect(positions).toEqual([{ id: 'c_01', x: 10, y: 20 }])
  })

  it('writes one card once (the first row wins)', () => {
    expect(normalizePositions([
      { id: 'c_01', x: 10, y: 20 },
      { id: 'c_01', x: 900, y: 900 },
    ])).toEqual([{ id: 'c_01', x: 10, y: 20 }])
  })
})

describe('the layout frame', () => {
  it('is the pen’s box under its other name — one frame, two consumers (§11.3)', () => {
    expect(LAYOUT_BOX).toBe(DRAW_BOX)
  })
})

describe('normalizeBoard (layout fields)', () => {
  const ID = 'canvas_01234567abcdefgh'

  /** Serialize a file the way the store does, then read it back. */
  function parse(value: Record<string, unknown>): CanvasBoard | undefined {
    return normalizeBoard(JSON.parse(JSON.stringify(value)), ID, '2026-09-23T09:00:00.000Z')
  }

  it('opens a pre-⑥ file with no lines, no lanes and no places', () => {
    const read = parse({
      id: ID,
      title: '主题',
      cards: [card('c_01'), card('c_02')],
      createdAt: '2026-09-16T08:00:00.000Z',
      updatedAt: '2026-09-16T08:00:00.000Z',
    })
    expect(read?.links).toEqual([])
    expect(read?.lanes).toEqual([])
    expect(read?.cards[0]).not.toHaveProperty('x')
  })

  it('carries a placed card through the read, both numbers or neither', () => {
    const placed = { ...card('c_01'), x: 12.7, y: 40 }
    const orphan = { ...card('c_02'), x: 300 }
    const read = parse({
      id: ID,
      title: '主题',
      cards: [placed, orphan],
      links: [{ from: 'c_01', to: 'c_02' }],
    })
    expect(read?.cards[0]).toMatchObject({ x: 13, y: 40 })
    expect(read?.cards[1]).not.toHaveProperty('x')
    expect(read?.links).toEqual([{ from: 'c_01', to: 'c_02' }])
  })

  it('prunes a line that outlived its card instead of drawing to nowhere', () => {
    const read = parse({
      id: ID,
      title: '主题',
      cards: [card('c_01')],
      links: [{ from: 'c_01', to: 'c_gone' }],
      lanes: [{ id: 'lane_01', label: '论据', x: 0, y: 0, w: 200, h: 120 }],
    })
    expect(read?.links).toEqual([])
    // A lane holds nothing by id, so a hand-edited file losing a card cannot
    // leave an inconsistent lane — the containment is geometric, read off the
    // places.
    expect(read?.lanes).toEqual([{ id: 'lane_01', label: '论据', x: 0, y: 0, w: 200, h: 120 }])
  })
})

describe('CanvasBoardService.setLayout', () => {
  it('defaults a new canvas to an unarranged board', async () => {
    const { board, id } = await created()
    const value = await read(board, id)
    expect(value.links).toEqual([])
    expect(value.lanes).toEqual([])
  })

  it('writes places, lanes and lines in one rewrite, and hands back a fresh token', async () => {
    const { board, id, version } = await created()
    const first = await putCard(board, id, '第一张')
    const second = await putCard(board, id, '第二张')
    const result = await board.setLayout({
      canvasId: id,
      positions: [{ id: first, x: 40, y: 60 }, { id: second, x: 300, y: 60 }],
      lanes: [{ id: 'lane_01', label: '论据', x: 0, y: 0, w: 420, h: 200 }],
      links: [{ from: first, to: second }],
    }, SESSION)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.version).not.toBe(version)
    expect(result.board.lanes).toEqual([{ id: 'lane_01', label: '论据', x: 0, y: 0, w: 420, h: 200 }])
    expect(result.board.links).toEqual([{ from: first, to: second }])
    expect(result.board.cards.find(candidate => candidate.id === first)).toMatchObject({ x: 40, y: 60 })
    // And it is the file that changed, not just the returned object.
    const stored = await read(board, id)
    expect(stored.links).toEqual([{ from: first, to: second }])
    expect(stored.cards.find(candidate => candidate.id === second)).toMatchObject({ x: 300, y: 60 })
  })

  it('leaves alone what the request omits, and clears what it sends as empty', async () => {
    const { board, id } = await created()
    const first = await putCard(board, id, '第一张')
    const second = await putCard(board, id, '第二张')
    await board.setLayout({
      canvasId: id,
      positions: [{ id: first, x: 40, y: 60 }],
      lanes: [{ id: 'lane_01', label: '论据', x: 0, y: 0, w: 420, h: 200 }],
      links: [{ from: first, to: second }],
    }, SESSION)

    // Only the lanes moved: the place and the line survive the write.
    const lanesOnly = await board.setLayout({
      canvasId: id,
      lanes: [{ id: 'lane_01', label: '论据改', x: 10, y: 10, w: 420, h: 200 }],
    }, SESSION)
    expect(lanesOnly.ok).toBe(true)
    if (!lanesOnly.ok) return
    expect(lanesOnly.board.lanes[0]).toMatchObject({ label: '论据改', x: 10 })
    expect(lanesOnly.board.links).toEqual([{ from: first, to: second }])
    expect(lanesOnly.board.cards.find(candidate => candidate.id === first)).toMatchObject({ x: 40, y: 60 })

    // `links: []` is 「删掉这条线」, and it must be sayable.
    const cleared = await board.setLayout({ canvasId: id, links: [] }, SESSION)
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expect(cleared.board.links).toEqual([])
    expect(cleared.board.lanes).toHaveLength(1)
    expect(cleared.board.cards.find(candidate => candidate.id === first)).toMatchObject({ x: 40, y: 60 })
  })

  it('moves every card of a dragged lane in the single write that carries them', async () => {
    const { board, id } = await created()
    const first = await putCard(board, id, '第一张')
    const second = await putCard(board, id, '第二张')
    const result = await board.setLayout({
      canvasId: id,
      positions: [
        { id: first, x: 20, y: 20 },
        { id: second, x: 120, y: 20 },
      ],
      lanes: [{ id: 'lane_01', label: '论据', x: 0, y: 0, w: 420, h: 200 }],
    }, SESSION)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const places = result.board.cards.map(candidate => `${candidate.id}:${candidate.x},${candidate.y}`)
    expect(places).toEqual([`${first}:20,20`, `${second}:120,20`])
  })

  it('ignores a place for a card the board does not have, and a line to one', async () => {
    const { board, id } = await created()
    const first = await putCard(board, id, '第一张')
    const result = await board.setLayout({
      canvasId: id,
      positions: [{ id: 'c_gone', x: 999, y: 999 }, { id: first, x: 10, y: 20 }],
      links: [{ from: first, to: 'c_gone' }],
    }, SESSION)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.board.links).toEqual([])
    expect(result.board.cards).toHaveLength(1)
    expect(result.board.cards[0]).toMatchObject({ x: 10, y: 20 })
  })

  it('refuses a canvas that is not there, and never invents one', async () => {
    const { board } = harness()
    const missing = await board.setLayout({
      canvasId: 'canvas_01234567abcdefgh',
      lanes: [{ id: 'lane_01', label: '', x: 0, y: 0, w: 200, h: 120 }],
    }, SESSION)
    expect(missing).toEqual({ ok: false, error: 'missing' })
  })

  it('keeps a placed card placeable across a reload of the file', async () => {
    const { board, id } = await created()
    const first = await putCard(board, id, '第一张')
    await board.setLayout({
      canvasId: id,
      positions: [{ id: first, x: -80, y: 640 }],
    }, SESSION)
    const value = await read(board, id)
    // Negative and past the frame: the link view pans, so both are places a
    // user can drag a card to, and the file must not eat them.
    expect(value.cards[0]).toMatchObject({ x: -80, y: 640 })
  })

  it('leaves the layout as plain JSON in the file, not as a client blob', async () => {
    const { fs, board, id, fileOf } = await created()
    const first = await putCard(board, id, '第一张')
    await board.setLayout({
      canvasId: id,
      positions: [{ id: first, x: 40, y: 60 }],
      lanes: [{ id: 'lane_01', label: '论据', x: 0, y: 0, w: 420, h: 200 }],
    }, SESSION)
    const stored = JSON.parse(fs.text(fileOf(id))) as {
      links: unknown
      lanes: unknown
      cards: Array<Record<string, unknown>>
    }
    expect(stored.lanes).toEqual([{ id: 'lane_01', label: '论据', x: 0, y: 0, w: 420, h: 200 }])
    expect(stored.links).toEqual([])
    expect(stored.cards[0]).toMatchObject({ x: 40, y: 60 })
  })
})
