/**
 * The genre's hooks into canvas_read / canvas_write against the seeded work:
 * a card lands live with its ref and enters the ledger at once, a ref
 * patches in place, a namesake is refused in favour of patching, archive
 * (the canvas's own status) retires it, a category without a role stays the
 * canvas's, and the chapters list in order as the canvas's 成稿.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { novelGenreAgent } from '../src/genre-agent.ts'
import { NovelService } from '../src/store.ts'
import { provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { CARD, DREAM, seedDreamKeeper } from './seed-dream.ts'

const SESSION = { id: 's-genre' } as unknown as Session

/** The seeded work, its store, and the hooks the genre registers. */
function bench() {
  const fs = new FakeFs()
  seedDreamKeeper(fs, {})
  const ctx = new Context()
  ctx.provide('fs', fs as never)
  const canvas = provideCanvas(ctx)
  const store = new NovelService(ctx, { stateRoot: DREAM.stateRoot })
  return { canvas, store, agent: novelGenreAgent(store) }
}

describe('the novel genre hooks', () => {
  it('canvas_write lands a role card live by name, patches by ref, refuses a namesake; archive retires it', async () => {
    const { canvas, store, agent } = bench()
    const canvasId = DREAM.workId
    const landed = await agent.writeCard({ canvasId, kind: '伏笔', fields: { question: '梦主可能是赵启明的妹妹？', bogus: 1 } }, SESSION)
    expect(landed).toContain('已落卡 [#19]（伏笔·已进 brief，画布上带 ✦ 新卡标记）')
    expect(landed).toContain('忽略了不认识的字段：bogus')
    const ledger = await store.ledger({ workId: canvasId })
    expect(ledger.active.some(view => view.ref === '#19')).toBe(true)
    // The ref resolves to the card id canvas_write op=archive patches.
    const cardId = await agent.resolveCard({ canvasId, token: '#19' }, SESSION)
    expect(cardId).toBeDefined()
    await canvas.patchCard({ canvasId, cardId: cardId!, status: 'archived' }, SESSION)
    expect((await store.ledger({ workId: canvasId })).active.some(view => view.ref === '#19')).toBe(false)
    expect(await agent.cardLines({ canvasId, kind: '伏笔', includeArchived: true }, SESSION)).toContainEqual(expect.stringContaining('[#19] 伏笔 梦主可能是赵启明的妹妹？'))
    // A ref patches in place, merging the fields.
    expect(await agent.writeCard({ canvasId, cardId: 'c1', fields: { voice: '说话更短了' } }, SESSION)).toContain('已更新 [c1]')
    expect(canvas.card(canvasId, CARD.zhao)?.fields).toMatchObject({ voice: '说话更短了', name: '赵启明' })
    // A namesake is refused, pointing at the existing card.
    expect(await agent.writeCard({ canvasId, kind: '人物', fields: { name: '赵启明' } }, SESSION)).toContain('canvas_write(op=card, cardId=c1')
    expect(await agent.writeCard({ canvasId, kind: '人物' }, SESSION)).toContain('放在 fields 里')
    expect(await agent.writeCard({ canvasId, cardId: 'c_nope', fields: { name: 'x' } }, SESSION)).toContain('找不到卡片「c_nope」')
    // A category without a role is the canvas's: the hook steps aside.
    expect(await agent.writeCard({ canvasId, kind: 'fragment', text: '随想' }, SESSION)).toBeUndefined()
  })

  it('canvas_read gets the role cards with refs, one card in full, and the chapters in order', async () => {
    const { canvas, agent } = bench()
    const canvasId = DREAM.workId
    const lines = await agent.cardLines({ canvasId, includeArchived: false }, SESSION)
    expect(lines).toContainEqual(expect.stringContaining('[c1] 人物 赵启明'))
    const relations = await agent.cardLines({ canvasId, kind: '关系', includeArchived: false }, SESSION)
    expect(relations.length).toBeGreaterThan(0)
    expect(relations.every(line => line.includes(' 关系 '))).toBe(true)
    expect(await agent.cardDetail({ canvasId, cardId: '赵启明' }, SESSION)).toContain('秘密：他在梦里见过走失的妹妹')
    const chapters = await agent.manuscripts({ canvasId })
    expect(chapters).toContain('按顺序')
    expect(chapters.indexOf('第5章')).toBeLessThan(chapters.indexOf('第6章 门后（规划中）'))
    expect(agent.manuscriptGuide).toContain('novel_write(what=chapter)')
    // A plain canvas is no work: nothing to list, every write is the canvas's.
    canvas.addBoard({ id: 'canvas_plain0001', title: '杂记', genre: null })
    expect(await agent.cardLines({ canvasId: 'canvas_plain0001', includeArchived: false }, SESSION)).toEqual([])
    expect(await agent.writeCard({ canvasId: 'canvas_plain0001', kind: '人物', fields: { name: 'x' } }, SESSION)).toBeUndefined()
  })
})
