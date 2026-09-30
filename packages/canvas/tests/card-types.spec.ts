/**
 * Card types (P1a): the definition's normalization and the strict field check
 * the agent's writes go through, the drawing rasterizer, the store's type
 * verbs (brief, propose, adopt / reject with renames, the catalog verb never
 * wiping a type), and the two type tools plus `fields` on the card proposal.
 */
import { inflateSync } from 'node:zlib'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import {
  applyRenames, checkFieldValues, faceFieldsOf, fieldSignature, normalizeDefinition, titleFieldOf, typedTitleOf,
} from '../src/card-types.ts'
import { rasterizeDrawing } from '../src/raster.ts'
import { CanvasBoardService } from '../src/store.ts'
import { canvasMainSessionToolDefinitions } from '../src/tools.ts'
import { DRAW_BOX, type CanvasBoard, type CanvasImageRef } from '../src/types.ts'
import { FakeFs } from './fake-fs.ts'

const STATE = '/state'
const SESSION = { id: 's1', header: { cwd: '/ws' } } as unknown as Session

const PERSON = {
  layout: 'profile',
  fields: [
    { key: 'name', label: '名字', type: 'line', hint: '人物的称呼', required: true },
    { key: 'role', label: '身份', type: 'select', options: ['主角', '配角'], hint: '在故事里的位置', face: true },
    { key: 'traits', label: '特征', type: 'tags', hint: '三五个词', face: true },
    { key: 'allies', label: '同伴', type: 'ref', refKind: 'fragment', hint: '和谁一路' },
    { key: 'age', label: '年龄', type: 'number', hint: '岁数' },
  ],
  example: { name: '林澈', role: '主角', traits: ['固执'] },
}

describe('normalizeDefinition', () => {
  it('keeps valid fields, dedupes keys, downgrades an optionless select and drops foreign example keys', () => {
    const definition = normalizeDefinition({
      fields: [
        { key: 'name', label: '名字', type: 'line', hint: 'h' },
        { key: 'name', label: '重复', type: 'text', hint: 'h' },
        { key: 'mood', label: '情绪', type: 'select', hint: 'h' },
        { key: 'Bad Key', label: 'x', type: 'line', hint: 'h' },
      ],
      example: { name: '甲', ghost: '乙' },
    })
    expect(definition?.fields.map(field => [field.key, field.type])).toEqual([['name', 'line'], ['mood', 'line']])
    expect(definition?.layout).toBe('note')
    expect(definition?.example).toEqual({ name: '甲' })
  })

  it('refuses a definition with no surviving field', () => {
    expect(normalizeDefinition({ fields: [{ key: '1x', type: 'line' }] })).toBeUndefined()
    expect(normalizeDefinition('nope')).toBeUndefined()
  })

  it('names the title field and caps the face fields', () => {
    const definition = normalizeDefinition(PERSON)!
    expect(titleFieldOf(definition)?.key).toBe('name')
    expect(faceFieldsOf(definition).map(field => field.key)).toEqual(['role', 'traits'])
    expect(typedTitleOf(definition, { name: '林澈' })).toBe('林澈')
    expect(fieldSignature(definition.fields[1]!)).toBe('role（身份）: select[主角|配角] 卡面')
  })
})

describe('checkFieldValues', () => {
  const definition = normalizeDefinition(PERSON)!
  const resolve = (entry: string): string | undefined => (entry === 'c_a' || entry === '阿岚' ? 'c_a' : undefined)

  it('accepts well-formed values, splitting a tag string and resolving a ref by name', () => {
    expect(checkFieldValues(definition, { name: '林澈', traits: '固执、温和', allies: '阿岚', age: '17' }, resolve)).toEqual({
      ok: true, values: { name: '林澈', traits: ['固执', '温和'], allies: ['c_a'], age: 17 },
    })
  })

  it('lists every problem at once', () => {
    const check = checkFieldValues(definition, { role: '反派', allies: ['无名氏'], age: 'old', mood: 'x' }, resolve)
    expect(check.ok).toBe(false)
    if (check.ok) return
    expect(check.problems).toHaveLength(5)
    expect(check.problems.join('\n')).toContain('没有字段「mood」')
    expect(check.problems.join('\n')).toContain('缺必填字段 name（名字）')
    expect(check.problems.join('\n')).toContain('只能取：主角、配角')
    expect(check.problems.join('\n')).toContain('「无名氏」对不上')
    expect(check.problems.join('\n')).toContain('应是数字')
  })

  it('moves values along renames, a value already under the new key winning', () => {
    expect(applyRenames({ nick: 'A', name: 'B', role: 'x' }, { nick: 'name', role: 'part' })).toEqual({ name: 'B', part: 'x' })
  })
})

describe('rasterizeDrawing', () => {
  it('paints a stroke as dark pixels in a grayscale PNG the size of the drawing box', () => {
    const png = rasterizeDrawing([{ color: 'ink', size: 'bold', pts: [{ x: 100, y: 200, w: 1 }, { x: 500, y: 200, w: 1 }] }])
    expect([...png.subarray(1, 4)].map(code => String.fromCharCode(code)).join('')).toBe('PNG')
    const view = new DataView(png.buffer, png.byteOffset)
    expect(view.getUint32(16)).toBe(DRAW_BOX.width)
    expect(view.getUint32(20)).toBe(DRAW_BOX.height)
    const idatLength = view.getUint32(33)
    const raw = inflateSync(png.subarray(41, 41 + idatLength))
    const pixel = (x: number, y: number): number => raw[y * (DRAW_BOX.width + 1) + 1 + x]!
    expect(pixel(300, 200)).toBeLessThan(60)
    expect(pixel(300, 100)).toBe(255)
  })
})

interface Bench {
  board: CanvasBoardService
  canvasId: string
  read: () => Promise<CanvasBoard>
  execute: (name: string, args: Record<string, unknown>) => Promise<unknown>
  saveImage: ReturnType<typeof vi.fn>
}

/** One focused board; optionally an image-capable route and an attachment store. */
async function bench(options: { images?: boolean } = {}): Promise<Bench> {
  const saveImage = vi.fn(async (request: { data: Uint8Array }) => ({
    attachmentId: `sha256:${'d'.repeat(64)}`, mediaType: 'image/png', bytes: request.data.byteLength, width: 600, height: 400,
  }))
  const llm = { resolveModelInfo: async () => ({ inputModalities: options.images === true ? ['text', 'image'] : ['text'] }) }
  const ctx = {
    fs: new FakeFs(),
    get: (key: string) => key === 'attachments' ? { saveImage } : key === 'llm' ? llm : undefined,
  } as unknown as Context
  const board = new CanvasBoardService(ctx, { stateRoot: STATE })
  const created = await board.createCanvas({ title: '小说' }, SESSION)
  if (!created.ok) throw new Error('expected a canvas')
  const canvasId = created.board.id
  await board.focusCanvas({ canvasId }, SESSION)
  const tools = canvasMainSessionToolDefinitions(board)
  const agent = { session: SESSION, options: { provider: 'p', model: 'm' } } as unknown as Agent
  return {
    board,
    canvasId,
    saveImage,
    read: async () => {
      const read = await board.readBoard({ canvasId })
      if (!read.ok) throw new Error('expected a board')
      return read.board
    },
    execute: async (name, args) => tools.find(tool => tool.name === name)!.execute(args, { agent } as never),
  }
}

describe('the store type verbs', () => {
  it('starts a type as a retired draft, adopts it enabled, and a rejected fresh draft goes away', async () => {
    const { board, canvasId, read } = await bench()
    const proposed = await board.proposeType({ canvasId, label: '人物', definition: PERSON, rationale: '先够用' }, SESSION)
    expect(proposed.ok).toBe(true)
    if (!proposed.ok) return
    const row = proposed.board.categories.find(category => category.id === proposed.kind)!
    expect(row).toMatchObject({ label: '人物', enabled: false, draft: true })
    expect(row.proposal?.definition.version).toBe(1)
    // Filing under a draft is refused until the user adopts.
    expect((await board.putCard({ canvasId, kind: proposed.kind as never, text: 'x' }, SESSION)).ok).toBe(false)

    expect((await board.decideType({ canvasId, kind: proposed.kind as never, decision: 'adopt' }, SESSION)).ok).toBe(true)
    const adopted = (await read()).categories.find(category => category.id === proposed.kind)!
    expect(adopted.enabled).toBe(true)
    expect(adopted.draft).toBeUndefined()
    expect(adopted.proposal).toBeUndefined()
    expect(adopted.definition?.fields).toHaveLength(5)

    const second = await board.proposeType({ canvasId, label: '地点', definition: PERSON, rationale: '' }, SESSION)
    if (!second.ok) throw new Error('expected a draft')
    await board.decideType({ canvasId, kind: second.kind as never, decision: 'reject' }, SESSION)
    expect((await read()).categories.some(category => category.id === second.kind)).toBe(false)
  })

  it('moves card values along the renames on adoption', async () => {
    const { board, canvasId, read } = await bench()
    const first = await board.proposeType({ canvasId, label: '人物', definition: PERSON, rationale: '' }, SESSION)
    if (!first.ok) throw new Error('expected a draft')
    const kind = first.kind as never
    await board.decideType({ canvasId, kind, decision: 'adopt' }, SESSION)
    await board.putCard({ canvasId, kind, text: '', fields: { name: '林澈', role: '主角' } }, SESSION)
    const renamed = { ...PERSON, fields: PERSON.fields.map(field => (field.key === 'role' ? { ...field, key: 'part' } : field)) }
    await board.proposeType({ canvasId, kind, definition: renamed, rationale: '', renames: { role: 'part' } }, SESSION)
    expect((await read()).categories.find(category => category.id === first.kind)?.proposal?.definition.version).toBe(2)
    await board.decideType({ canvasId, kind, decision: 'adopt' }, SESSION)
    expect((await read()).cards[0]?.fields).toEqual({ name: '林澈', part: '主角' })
  })

  it('logs each adoption with its summary, the request and the proposing session — a rejection logs nothing', async () => {
    const { board, canvasId, read } = await bench()
    const first = await board.proposeType({ canvasId, label: '人物', definition: PERSON, rationale: '先够用。再说。' }, SESSION)
    if (!first.ok) throw new Error('expected a draft')
    const kind = first.kind as never
    await board.decideType({ canvasId, kind, decision: 'adopt' }, SESSION)
    await board.proposeType({ canvasId, kind, definition: PERSON, rationale: '', summary: '加了危险度', request: '要能看出危险' }, SESSION)
    expect((await read()).categories.find(row => row.id === first.kind)?.proposal).toMatchObject({ summary: '加了危险度', request: '要能看出危险', sessionId: 's1' })
    await board.decideType({ canvasId, kind, decision: 'reject' }, SESSION)
    await board.proposeType({ canvasId, kind, definition: PERSON, rationale: '', summary: '加了危险度', request: '要能看出危险' }, SESSION)
    await board.decideType({ canvasId, kind, decision: 'adopt' }, SESSION)
    const history = (await read()).categories.find(row => row.id === first.kind)?.history
    // Without a summary the rationale's first sentence stands in.
    expect(history?.map(({ adoptedAt: _at, ...row }) => row)).toEqual([
      { version: 1, summary: '先够用', sessionId: 's1' },
      { version: 2, summary: '加了危险度', request: '要能看出危险', sessionId: 's1' },
    ])
  })

  it('keeps a type through a catalog rewrite that carries none of it', async () => {
    const { board, canvasId, read } = await bench()
    const first = await board.proposeType({ canvasId, kind: 'fragment', definition: PERSON, rationale: '' }, SESSION)
    if (!first.ok) throw new Error('expected a proposal')
    await board.setTypeBrief({ canvasId, kind: 'fragment', brief: '要有名字' }, SESSION)
    const stale = (await read()).categories.map(({ id, label, order, enabled }) => ({ id, label, order, enabled }))
    await board.setCategories({ canvasId, categories: stale.map(row => (row.id === 'fragment' ? { ...row, label: '人物' } : row)) }, SESSION)
    const row = (await read()).categories.find(category => category.id === 'fragment')!
    expect(row.label).toBe('人物')
    expect(row.brief).toBe('要有名字')
    expect(row.proposal).toBeDefined()
    await board.decideType({ canvasId, kind: 'fragment', decision: 'adopt' }, SESSION)
    await board.setCategories({ canvasId, categories: stale }, SESSION)
    expect((await read()).categories.find(category => category.id === 'fragment')?.history).toHaveLength(1)
  })

  it('lets a card with fields but no body stand, and refuses a card emptied of both', async () => {
    const { board, canvasId, read } = await bench()
    const put = await board.putCard({ canvasId, kind: 'fragment', text: '', fields: { name: '甲' } }, SESSION)
    expect(put.ok).toBe(true)
    const cardId = (await read()).cards[0]!.id
    expect((await board.patchCard({ canvasId, cardId, fields: {}, text: '' }, SESSION)).ok).toBe(false)
    expect((await board.patchCard({ canvasId, cardId, fields: {}, text: '有正文了' }, SESSION)).ok).toBe(true)
    expect((await read()).cards[0]?.fields).toBeUndefined()
  })
})

describe('the type tools', () => {
  it('reads a type with its brief, marking drawings as unseen on a text-only route', async () => {
    const { board, canvasId, execute, saveImage } = await bench()
    await board.setTypeBrief({
      canvasId, kind: 'fragment', brief: '人物卡要像档案\n\n![](draw://sketch1)',
      drawings: { sketch1: [{ color: 'ink', pts: [{ x: 1, y: 1, w: 1 }, { x: 50, y: 50, w: 1 }] }] },
    }, SESSION)
    const read = await execute('canvas_read_type', { kind: 'fragment' }) as { text: string; images: CanvasImageRef[] }
    expect(read.images).toEqual([])
    expect(read.text).toContain('人物卡要像档案')
    expect(read.text).toContain('[手绘：当前模型不支持看图]')
    expect(saveImage).not.toHaveBeenCalled()
  })

  it('attaches the rasterized drawing when the route sees images', async () => {
    const { board, canvasId, execute, saveImage } = await bench({ images: true })
    await board.setTypeBrief({
      canvasId, kind: 'fragment', brief: '![](draw://sketch1)',
      drawings: { sketch1: [{ color: 'ink', pts: [{ x: 1, y: 1, w: 1 }, { x: 50, y: 50, w: 1 }] }] },
    }, SESSION)
    const read = await execute('canvas_read_type', { kind: 'fragment' }) as { text: string; images: CanvasImageRef[] }
    expect(saveImage).toHaveBeenCalledOnce()
    expect(read.images).toHaveLength(1)
    expect(read.text).toContain('[手绘 1：见附图 1]')
  })

  it('proposes a type, then checks a card proposal\'s fields against the adopted definition', async () => {
    const { board, canvasId, execute, read } = await bench()
    const answer = await execute('canvas_propose_type', { label: '人物', definition: PERSON, rationale: '档案式' }) as string
    expect(answer).toMatch(/^完成：cat_[a-z0-9]+（人物）的类型提议已放到类型页，5 个字段/)
    const kind = (await read()).categories.find(category => category.label === '人物')!.id
    await board.decideType({ canvasId, kind, decision: 'adopt' }, SESSION)

    expect(await execute('canvas_read_board', {})).toContain('name（名字）: line 必填')
    const refused = await execute('canvas_propose_card', { kind, fields: { role: '反派' } }) as string
    expect(refused).toContain('缺必填字段 name')
    expect(refused).toContain('只能取：主角、配角')
    const landed = await execute('canvas_propose_card', { kind, fields: { name: '林澈', role: '主角' } }) as string
    expect(landed).toMatch(/^完成：/)
    expect((await read()).cards[0]).toMatchObject({ status: 'proposed', text: '', fields: { name: '林澈', role: '主角' } })
    expect(await execute('canvas_read_board', {})).toContain('林澈')
    expect(await execute('canvas_propose_card', { kind: 'fragment', fields: { x: 1 } }))
      .toBe('失败：分类「灵感」没有字段定义，不能填 fields——把内容写进 text。')
  })

  it('explains an empty definition and a missing target', async () => {
    const { execute } = await bench()
    expect(await execute('canvas_propose_type', { label: '人物', definition: { fields: [] }, rationale: '' }))
      .toContain('definition 里没有一个合格的字段')
    expect(await execute('canvas_propose_type', { kind: 'cat_nopenopenope', definition: PERSON, rationale: '' }))
      .toContain('没有 id 为「cat_nopenopenope」')
  })
})
