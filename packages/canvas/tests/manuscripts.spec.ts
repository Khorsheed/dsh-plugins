/**
 * Manuscripts (成稿) in the board store: an entity beside the cards whose body
 * is its own file. Pinned here: create and rewrite through one verb, the
 * base-version conflict (a stale writer learns the version it lost to and
 * leaves no body file behind), the superseded body going once the new one is
 * in, the source lists staying inside the board's cards, rename / final /
 * reopen, the delete taking the body directory with it, and 「保存到工作区」 —
 * the remembered path, the changed / exists stops and their confirmation, the
 * images written beside the markdown, and the fence (attached workspaces only,
 * read-only refused).
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { rewriteImagesForExport } from '../src/manuscript.ts'
import { imageMarkdownOf } from '../src/image-token.ts'
import { CanvasBoardService } from '../src/store.ts'
import type { BoardManuscript, CanvasBoard, CanvasImageRef } from '../src/types.ts'
import { FakeFs, HOST_CWD } from './fake-fs.ts'

const WS = '/ws'
const STATE = '/state'
const SESSION = { id: 's1', header: { cwd: WS } } as unknown as Session

const REF: CanvasImageRef = {
  attachmentId: `sha256:${'ab'.repeat(32)}`, mediaType: 'image/png', bytes: 3, width: 4, height: 2,
}

interface Bench {
  fs: FakeFs
  board: CanvasBoardService
  /** Every binary write the export made, path → bytes. */
  written: Map<string, number[]>
  /** Switch the session's mode (a confining bench only). */
  setMode: (mode: 'workspace-write' | 'read-only') => void
}

/** A board service over a fresh fake, optionally confining and with an attachment store. */
function bench(options: {
  mode?: 'workspace-write' | 'read-only'
  readImage?: (...args: never[]) => Promise<unknown>
} = {}): Bench {
  const fs = new FakeFs()
  const written = new Map<string, number[]>()
  let mode = options.mode
  const sandboxPolicy = options.mode === undefined ? undefined : {
    resolve: (request?: { session?: { id: string; header: { cwd: string } } }) => ({
      mode,
      workspaceRoot: request?.session?.header.cwd ?? HOST_CWD,
    }),
  }
  if (options.mode !== undefined) fs.sandboxMode = options.mode
  const attachments = options.readImage === undefined ? undefined : { readImage: options.readImage }
  const ctx = {
    fs,
    get: (key: string) => key === 'sandboxPolicy' ? sandboxPolicy : key === 'attachments' ? attachments : undefined,
  } as unknown as Context
  const board = new CanvasBoardService(
    ctx, { stateRoot: STATE },
    async path => { fs.removeTree(path) },
    async (path, data) => { written.set(path, [...data]) },
  )
  return { fs, board, written, setMode: next => { mode = next; fs.sandboxMode = next } }
}

/** One canvas with two cards, workspace attached. */
async function seedBoard(board: CanvasBoardService): Promise<{ canvas: CanvasBoard; cardA: string; cardB: string }> {
  const created = await board.createCanvas({ title: '雨夜', attachedWorkspaces: [WS] }, SESSION)
  if (!created.ok) throw new Error(created.error)
  const a = await board.putCard({ canvasId: created.board.id, kind: 'fragment', text: '甲' }, SESSION)
  if (!a.ok) throw new Error(a.error)
  const b = await board.putCard({ canvasId: created.board.id, kind: 'fragment', text: '乙' }, SESSION)
  if (!b.ok) throw new Error(b.error)
  return { canvas: b.board, cardA: b.board.cards[0]!.id, cardB: b.board.cards[1]!.id }
}

/** Create one manuscript and unwrap it. */
async function createManuscript(board: CanvasBoardService, canvasId: string, body = '# 第一章\n\n正文'): Promise<BoardManuscript> {
  const written = await board.writeManuscript({ canvasId, body }, SESSION, 'agent')
  if (!written.ok) throw new Error(written.error)
  return written.manuscript
}

/** The body files one manuscript has on disk. */
async function bodyFiles(fs: FakeFs, canvasId: string, manuscriptId: string): Promise<string[]> {
  const dir = `${STATE}/${canvasId}/manuscripts/${manuscriptId}`
  return (await fs.listDir(dir).catch(() => [])).map(entry => entry.name).sort()
}

describe('writeManuscript', () => {
  it('creates at version 1, titled from the body heading, with its body in its own file', async () => {
    const { fs, board } = bench()
    const { canvas } = await seedBoard(board)
    const manuscript = await createManuscript(board, canvas.id)
    expect(manuscript).toMatchObject({ title: '第一章', version: 1, status: 'writing', createdBy: 'agent' })
    expect(await bodyFiles(fs, canvas.id, manuscript.id)).toEqual([manuscript.file])
    const read = await board.readManuscript({ canvasId: canvas.id, manuscriptId: manuscript.id })
    expect(read).toMatchObject({ ok: true, body: '# 第一章\n\n正文' })
    // The board carries the metadata only.
    expect(JSON.stringify((await board.readBoard({ canvasId: canvas.id })))).not.toContain('正文')
  })

  it('refuses a create with no words, or no title to be found', async () => {
    const { board } = bench()
    const { canvas } = await seedBoard(board)
    await expect(board.writeManuscript({ canvasId: canvas.id, body: '  ' }, SESSION))
      .resolves.toEqual({ ok: false, error: 'invalid-name' })
    await expect(board.writeManuscript({ canvasId: canvas.id, body: 'x', title: '   ' }, SESSION))
      .resolves.toEqual({ ok: false, error: 'invalid-name' })
  })

  it('rewrites from the current version, and removes the superseded body file', async () => {
    const { fs, board } = bench()
    const { canvas } = await seedBoard(board)
    const first = await createManuscript(board, canvas.id)
    const second = await board.writeManuscript({
      canvasId: canvas.id, manuscriptId: first.id, baseVersion: 1, body: '# 第一章\n\n改过',
    }, SESSION, 'user')
    if (!second.ok) throw new Error(second.error)
    expect(second.manuscript).toMatchObject({ version: 2, lastWrittenBy: 'user' })
    expect(await bodyFiles(fs, canvas.id, first.id)).toEqual([second.manuscript.file])
  })

  it('refuses a stale base with the version it lost to, and leaves no body file behind', async () => {
    const { fs, board } = bench()
    const { canvas } = await seedBoard(board)
    const first = await createManuscript(board, canvas.id)
    await board.writeManuscript({ canvasId: canvas.id, manuscriptId: first.id, baseVersion: 1, body: 'v2' }, SESSION)
    const late = await board.writeManuscript({
      canvasId: canvas.id, manuscriptId: first.id, baseVersion: 1, body: '晚到的',
    }, SESSION, 'agent')
    expect(late).toEqual({ ok: false, error: 'stale', currentVersion: 2 })
    // A rewrite without any base is the same refusal: the writer must read first.
    await expect(board.writeManuscript({ canvasId: canvas.id, manuscriptId: first.id, body: 'x' }, SESSION))
      .resolves.toEqual({ ok: false, error: 'stale', currentVersion: 2 })
    expect(await bodyFiles(fs, canvas.id, first.id)).toHaveLength(1)
    const read = await board.readManuscript({ canvasId: canvas.id, manuscriptId: first.id })
    expect(read).toMatchObject({ ok: true, body: 'v2' })
  })

  it('keeps sources inside the board, used winning over unused, and a card delete drops its id', async () => {
    const { board } = bench()
    const { canvas, cardA, cardB } = await seedBoard(board)
    const written = await board.writeManuscript({
      canvasId: canvas.id, body: '# 稿', sources: { used: [cardA, 'c_ghost', cardA], unused: [cardB, cardA] },
    }, SESSION, 'agent')
    if (!written.ok) throw new Error(written.error)
    expect(written.manuscript.sources).toEqual({ used: [cardA], unused: [cardB] })
    const after = await board.deleteCard({ canvasId: canvas.id, cardId: cardB }, SESSION)
    if (!after.ok) throw new Error(after.error)
    expect(after.board.manuscripts[0]!.sources).toEqual({ used: [cardA], unused: [] })
  })

  it('turns a card into a manuscript: the card is its first used source', async () => {
    const { board } = bench()
    const { canvas, cardA } = await seedBoard(board)
    const written = await board.writeManuscript({
      canvasId: canvas.id, body: '甲', title: '从卡片来', fromCardId: cardA,
    }, SESSION)
    if (!written.ok) throw new Error(written.error)
    expect(written.manuscript).toMatchObject({ fromCardId: cardA, sources: { used: [cardA], unused: [] }, createdBy: 'user' })
  })

  it('reopens a final manuscript when the agent rewrites it; a label change keeps the version', async () => {
    const { board } = bench()
    const { canvas } = await seedBoard(board)
    const first = await createManuscript(board, canvas.id)
    const patched = await board.patchManuscript({ canvasId: canvas.id, manuscriptId: first.id, status: 'final', title: '定名' }, SESSION)
    if (!patched.ok) throw new Error(patched.error)
    expect(patched.board.manuscripts[0]).toMatchObject({ status: 'final', title: '定名', version: 1 })
    const rewritten = await board.writeManuscript({ canvasId: canvas.id, manuscriptId: first.id, baseVersion: 1, body: '再改' }, SESSION, 'agent')
    if (!rewritten.ok) throw new Error(rewritten.error)
    expect(rewritten.manuscript).toMatchObject({ status: 'writing', title: '定名', version: 2 })
  })

  it('refuses ids that are not a manuscript\'s shape before any path is built', async () => {
    const { board } = bench()
    const { canvas } = await seedBoard(board)
    await expect(board.readManuscript({ canvasId: canvas.id, manuscriptId: '../canvas.json' }))
      .resolves.toEqual({ ok: false, error: 'invalid-name' })
    await expect(board.writeManuscript({ canvasId: canvas.id, manuscriptId: 'ms_../x', baseVersion: 1, body: 'x' }, SESSION))
      .resolves.toEqual({ ok: false, error: 'invalid-name' })
  })
})

describe('deleteManuscript', () => {
  it('takes the metadata and the body directory, and stays inside the fence', async () => {
    const { fs, board } = bench()
    const { canvas } = await seedBoard(board)
    const first = await createManuscript(board, canvas.id)
    const deleted = await board.deleteManuscript({ canvasId: canvas.id, manuscriptId: first.id }, SESSION)
    if (!deleted.ok) throw new Error(deleted.error)
    expect(deleted.board.manuscripts).toEqual([])
    expect(await bodyFiles(fs, canvas.id, first.id)).toEqual([])
    await expect(board.deleteManuscript({ canvasId: canvas.id, manuscriptId: first.id }, SESSION))
      .resolves.toEqual({ ok: false, error: 'missing' })
  })
})

describe('exportManuscript', () => {
  it('saves <title>.md into the attached workspace and remembers where', async () => {
    const { fs, board } = bench()
    const { canvas } = await seedBoard(board)
    const first = await createManuscript(board, canvas.id)
    const saved = await board.exportManuscript({ canvasId: canvas.id, manuscriptId: first.id, workspace: WS }, SESSION)
    if (!saved.ok) throw new Error(saved.error)
    expect(saved.path).toBe('/ws/第一章.md')
    expect(await fs.readText('/ws/第一章.md')).toBe('# 第一章\n\n正文')
    expect(saved.board.manuscripts[0]!.exported).toMatchObject({ workspace: WS, path: '/ws/第一章.md' })
    // Saving again, nothing touched in between, just writes.
    await board.writeManuscript({ canvasId: canvas.id, manuscriptId: first.id, baseVersion: 1, body: '新' }, SESSION)
    const again = await board.exportManuscript({ canvasId: canvas.id, manuscriptId: first.id, workspace: WS }, SESSION)
    expect(again).toMatchObject({ ok: true, path: '/ws/第一章.md' })
    expect(await fs.readText('/ws/第一章.md')).toBe('新')
  })

  it('goes to the remembered file even after a rename', async () => {
    const { fs, board } = bench()
    const { canvas } = await seedBoard(board)
    const first = await createManuscript(board, canvas.id)
    await board.exportManuscript({ canvasId: canvas.id, manuscriptId: first.id, workspace: WS }, SESSION)
    await board.patchManuscript({ canvasId: canvas.id, manuscriptId: first.id, title: '改名' }, SESSION)
    const again = await board.exportManuscript({ canvasId: canvas.id, manuscriptId: first.id, workspace: WS }, SESSION)
    expect(again).toMatchObject({ ok: true, path: '/ws/第一章.md' })
    expect(await fs.stat('/ws/改名.md')).toBeUndefined()
  })

  it('stops on a file edited since the last save, or a foreign one, until confirmed', async () => {
    const { fs, board } = bench()
    const { canvas } = await seedBoard(board)
    const first = await createManuscript(board, canvas.id)
    fs.seed('/ws/第一章.md', '别人的文件')
    await expect(board.exportManuscript({ canvasId: canvas.id, manuscriptId: first.id, workspace: WS }, SESSION))
      .resolves.toEqual({ ok: false, error: 'exists', path: '/ws/第一章.md' })
    expect(await fs.readText('/ws/第一章.md')).toBe('别人的文件')
    const forced = await board.exportManuscript({ canvasId: canvas.id, manuscriptId: first.id, workspace: WS, overwrite: true }, SESSION)
    expect(forced.ok).toBe(true)
    fs.seed('/ws/第一章.md', '在编辑器里改过')
    await expect(board.exportManuscript({ canvasId: canvas.id, manuscriptId: first.id, workspace: WS }, SESSION))
      .resolves.toEqual({ ok: false, error: 'changed', path: '/ws/第一章.md' })
  })

  it('writes the images beside the markdown and links them relatively; an unreadable one stays a pointer', async () => {
    const other: CanvasImageRef = { ...REF, attachmentId: `sha256:${'cd'.repeat(32)}` }
    const readImage = vi.fn(async (ref: CanvasImageRef) => {
      if (ref.attachmentId === other.attachmentId) throw Object.assign(new Error('gone'), { code: 'ATTACHMENT_NOT_FOUND' })
      return { data: new Uint8Array([1, 2, 3]), ref }
    })
    const { fs, board, written } = bench({ readImage: readImage as never })
    const { canvas } = await seedBoard(board)
    const body = `# 图\n\n${imageMarkdownOf(REF, '甲图')}\n\n${imageMarkdownOf(REF, '再来')}\n\n${imageMarkdownOf(other, '丢了')}`
    const first = await createManuscript(board, canvas.id, body)
    const saved = await board.exportManuscript({ canvasId: canvas.id, manuscriptId: first.id, workspace: WS }, SESSION)
    expect(saved).toMatchObject({ ok: true, images: 1, missingImages: 1 })
    const file = `${'ab'.repeat(8)}.png`
    expect([...written.keys()]).toEqual([`/ws/图.assets/${file}`])
    const text = await fs.readText('/ws/图.md')
    expect(text).toContain(`![甲图](<图.assets/${file}>)`)
    expect(text).toContain(`![再来](<图.assets/${file}>)`)
    expect(text).toContain(imageMarkdownOf(other, '丢了'))
  })

  it('refuses a workspace the canvas has not attached, and a read-only session', async () => {
    const { board, setMode, written } = bench({ mode: 'workspace-write' })
    const { canvas } = await seedBoard(board)
    const first = await createManuscript(board, canvas.id)
    await expect(board.exportManuscript({ canvasId: canvas.id, manuscriptId: first.id, workspace: '/elsewhere' }, SESSION))
      .resolves.toEqual({ ok: false, error: 'denied' })
    setMode('read-only')
    await expect(board.exportManuscript({ canvasId: canvas.id, manuscriptId: first.id, workspace: WS }, SESSION))
      .resolves.toEqual({ ok: false, error: 'denied' })
    expect(written.size).toBe(0)
  })

  it('writes under the workspace fence, not the state root\'s', async () => {
    const { fs, board } = bench({ mode: 'workspace-write' })
    const { canvas } = await seedBoard(board)
    const first = await createManuscript(board, canvas.id)
    const saved = await board.exportManuscript({ canvasId: canvas.id, manuscriptId: first.id, workspace: WS }, SESSION)
    expect(saved.ok).toBe(true)
    expect(fs.policies.some(policy => policy?.workspaceRoot === WS)).toBe(true)
  })
})

describe('rewriteImagesForExport', () => {
  it('leaves a pointer that does not parse exactly as it was', () => {
    const body = '![x](attachment://sha256:nothex?mediaType=image/png&bytes=1&width=1&height=1)'
    expect(rewriteImagesForExport(body, 'a.assets')).toEqual({ text: body, images: [] })
  })
})
