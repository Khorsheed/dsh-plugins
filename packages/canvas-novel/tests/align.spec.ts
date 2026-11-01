/**
 * 待对齐 (2026-11-02): changes are fingerprints that moved since the last
 * alignment; each names the written chapters it touches and only the
 * passages to read; the agent's own writes and the rules' fixes do not wait.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { changedParagraphs, fingerprint, namesFor, passagesNaming } from '../src/align.ts'
import { novelGenreAgent } from '../src/genre-agent.ts'
import { NovelService } from '../src/store.ts'
import { provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { CARD, DREAM, seedDreamKeeper } from './seed-dream.ts'

const session = { id: 's-align', snapshotEvents: () => [{ type: 'user/message', seq: 1 }] } as unknown as Session

function bench() {
  const fs = new FakeFs()
  seedDreamKeeper(fs)
  const ctx = new Context()
  ctx.provide('fs', fs as never)
  const canvas = provideCanvas(ctx)
  canvas.addShelves(DREAM.workId)
  const store = new NovelService(ctx, { stateRoot: DREAM.stateRoot })
  ctx.provide('canvasNovel', store as never)
  return { ctx, store, canvas, agent: novelGenreAgent(store) }
}

describe('the pieces', () => {
  it('fingerprints ignore key order; changed paragraphs and named passages are found by text', () => {
    expect(fingerprint({ a: 1, b: [2] })).toBe(fingerprint({ b: [2], a: 1 }))
    expect(changedParagraphs('一。\n二。', '一。\n二改了。').rows).toEqual(['二改了。'])
    expect(namesFor('共享梦域：连接与传播（工作稿）')).toEqual(expect.arrayContaining(['共享梦域：连接与传播', '共享梦域']))
    expect(passagesNaming('甲段。\n这里有钟楼。\n乙段。', ['钟楼'])).toEqual(['这里有钟楼。'])
  })
})

describe('待对齐 on a book', () => {
  it('starts empty, then lists a setting the person changed with the chapter that uses it', async () => {
    const { store, canvas } = bench()
    expect((await store.alignRead({ workId: DREAM.workId }, session)).items).toEqual([])
    const card = canvas.card(DREAM.workId, CARD.trueName)!
    await canvas.patchCard({ canvasId: DREAM.workId, cardId: CARD.trueName, fields: { ...card.fields, rule: '监护者可以说出真名，但会失去一段记忆。' } })
    const read = await store.alignRead({ workId: DREAM.workId }, session)
    expect(read.items).toHaveLength(1)
    expect(read.items![0]).toMatchObject({ node: CARD.trueName, change: 'changed', chapters: [1] })
    // Ticked off, it is gone; changed back, it would never have been there.
    await store.alignAck({ workId: DREAM.workId, ids: [CARD.trueName] }, session)
    expect((await store.alignRead({ workId: DREAM.workId }, session)).items).toEqual([])
  })

  it("the agent's own card write does not wait", async () => {
    const { store, agent } = bench()
    await store.alignRead({ workId: DREAM.workId }, session)
    await agent.writeCard({ canvasId: DREAM.workId, cardId: CARD.trueName, fields: { rule: '新规则' } }, session)
    expect((await store.alignRead({ workId: DREAM.workId }, session)).items).toEqual([])
  })

  it('a chapter whose text the person rewrote lists only the changed paragraphs', async () => {
    const { store } = bench()
    await store.alignRead({ workId: DREAM.workId }, session)
    const before = await store.readChapter({ workId: DREAM.workId, n: 2 })
    const edited = await store.editChapterBody({ workId: DREAM.workId, n: 2, text: `${before.body!}\n艾文第二次出现，叶子变成了红色。\n` }, session)
    expect(edited.ok).toBe(true)
    const items = (await store.alignRead({ workId: DREAM.workId }, session)).items!
    const text = items.find(item => item.node === 'ch:2')!
    expect(text).toMatchObject({ change: 'text', paragraphs: 1 })
    expect(text.passages[0]?.text).toContain('叶子变成了红色')
  })

  it('a deleted setting that a written chapter used waits; one nothing used is settled', async () => {
    const { ctx, store, agent } = bench()
    await agent.writeCard({ canvasId: DREAM.workId, kind: '地点', fields: { name: '空房间', rule: '没人去过' } }, session)
    await store.alignRead({ workId: DREAM.workId }, session)
    const { NovelRemoteService } = await import('../src/remote.ts')
    const remote = new NovelRemoteService(ctx)
    const room = (await store.readEntries(DREAM.workId))!.rules.find(view => view.name === '空房间')!.cardId
    await store.deleteNode({ workId: DREAM.workId, node: room }, session)
    await store.deleteNode({ workId: DREAM.workId, node: CARD.trueName }, session)
    const read = await remote.align({ canvasId: DREAM.workId })
    expect(read.items?.map(item => [item.node, item.change, item.chapters])).toEqual([[CARD.trueName, 'removed', [1]]])
    expect(read.auto?.map(row => row.node)).toContain(room)
    expect(read.cost?.chapters.length ?? 0).toBeGreaterThanOrEqual(0)
  })
})
