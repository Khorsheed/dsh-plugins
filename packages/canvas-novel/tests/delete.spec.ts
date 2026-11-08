/**
 * Deleting anything (2026-11-02): the graph's reverse index says what points
 * at the node; the rules fix what they can at once, and written chapters are
 * left for 待对齐.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { novelGenreAgent } from '../src/genre-agent.ts'
import { buildGraph, deleteImpact } from '../src/graph.ts'
import { NovelService } from '../src/store.ts'
import { provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { CARD, DREAM, seedDreamKeeper } from './seed-dream.ts'

const session = { id: 's-delete', snapshotEvents: () => [{ type: 'user/message', seq: 1 }] } as unknown as Session

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

describe('the graph', () => {
  it('indexes who points at a node, and drops edges to nodes the book does not hold', () => {
    const graph = buildGraph({
      chapters: [{ n: 1, title: '门', written: true, settings: ['w1'] }],
      settings: [{ id: 'w1', name: '小镇', parents: ['w0'] }, { id: 'w0', name: '梦域' }],
      characters: [{ id: 'c1', name: '赵', homes: ['w1'] }],
      relations: [],
      foreshadows: [],
      events: [{ id: 'e1', title: '集市', chapters: [1], places: ['w1', 'gone'] }],
      ideas: [{ id: 'i1', text: '一句', eventId: 'e1' }],
    })
    expect(graph.into('w1').map(edge => `${edge.from}:${edge.kind}`).sort()).toEqual(['c1:home', 'ch:1:uses', 'e1:at'])
    expect(graph.out('e1').some(edge => edge.to === 'gone')).toBe(false)
    const impact = deleteImpact(graph, 'w1', new Set([1]))!
    expect(impact.chapters).toEqual([1])
    expect(impact.auto).toEqual(expect.arrayContaining([{ kind: 'unlink', id: 'c1', edge: 'home' }, { kind: 'unlink', id: 'e1', edge: 'at' }]))
    expect(deleteImpact(graph, 'e1', new Set([1]))!.auto).toEqual([{ kind: 'unbind', id: 'i1' }])
  })

  it('uses a chapter generation id for edges and impact while keeping n for display', () => {
    const graph = buildGraph({
      chapters: [{ id: 'ch_new-generation', n: 1, title: '新第一章', written: true, settings: ['w1'] }],
      settings: [{ id: 'w1', name: '小镇' }], characters: [], relations: [], foreshadows: [],
      events: [{ id: 'e1', title: '新事件', chapters: [1] }], ideas: [],
    })
    expect(graph.chapterOf('ch_new-generation')).toBe(1)
    expect(graph.out('e1').find(edge => edge.kind === 'told-in')?.to).toBe('ch_new-generation')
    expect(deleteImpact(graph, 'w1', new Set([1]))?.chapters).toEqual([1])
  })
})

describe('deleting from the book', () => {
  it('a place: children move up, people and factions and events let go of it, the card is gone', async () => {
    const { store, canvas, agent } = bench()
    await agent.writeCard({ canvasId: DREAM.workId, kind: '地点', fields: { name: '山海梦域', rule: '神话梦域' } }, session)
    await agent.writeCard({ canvasId: DREAM.workId, kind: '地点', fields: { name: '山脚小镇', rule: '面包', parent: '山海梦域' } }, session)
    await agent.writeCard({ canvasId: DREAM.workId, kind: '地点', fields: { name: '面包房', rule: '炉', parent: '山脚小镇' } }, session)
    await agent.writeCard({ canvasId: DREAM.workId, kind: '势力', fields: { name: '睡眠公司', rule: '运营方', base: '山脚小镇' } }, session)
    await agent.writeCard({ canvasId: DREAM.workId, cardId: CARD.zhao, fields: { home: '山脚小镇' } }, session)
    await store.writeEvent({ workId: DREAM.workId, title: '集市', status: 'preset', places: ['山脚小镇'] }, session)
    const entries = async () => (await store.readEntries(DREAM.workId))!
    const id0 = new Map((await entries()).rules.map(view => [view.name, view.cardId]))
    const id = (name: string): string => id0.get(name)!
    const town = id('山脚小镇')
    const preview = await store.deletePreview({ workId: DREAM.workId, node: town })
    expect(preview?.auto.map(fix => fix.kind).sort()).toEqual(['move-up', 'unlink', 'unlink', 'unlink'])
    expect((await store.deleteNode({ workId: DREAM.workId, node: town }, session)).ok).toBe(true)
    expect(canvas.card(DREAM.workId, town)).toBeUndefined()
    expect(canvas.card(DREAM.workId, id('面包房'))?.fields?.['parent']).toEqual([id('山海梦域')])
    expect(canvas.card(DREAM.workId, id('睡眠公司'))?.fields?.['base']).toEqual([])
    expect(canvas.card(DREAM.workId, CARD.zhao)?.fields?.['home']).toEqual([])
    expect((await store.readTimeline(DREAM.workId)).events.find(event => event.title === '集市')?.places ?? []).toEqual([])
  })

  it('a person takes their relations along', async () => {
    const { store, canvas } = bench()
    expect((await store.deleteNode({ workId: DREAM.workId, node: CARD.aiwen }, session)).ok).toBe(true)
    expect(canvas.card(DREAM.workId, CARD.aiwen)).toBeUndefined()
    expect(canvas.card(DREAM.workId, CARD.zhaoAiwen)).toBeUndefined()
  })

  it('an event lets go of its ideas and of the events it caused', async () => {
    const { store } = bench()
    const first = await store.writeEvent({ workId: DREAM.workId, title: '门开了', status: 'preset' }, session)
    await store.writeEvent({ workId: DREAM.workId, title: '后果', status: 'preset', causes: [first.id!] }, session)
    const idea = await store.changeIdea({ workId: DREAM.workId, add: '门后有风' }, session)
    await store.changeIdea({ workId: DREAM.workId, id: idea.id!, eventId: first.id! }, session)
    expect((await store.deleteNode({ workId: DREAM.workId, node: first.id! }, session)).ok).toBe(true)
    const events = (await store.readTimeline(DREAM.workId)).events
    expect(events.some(event => event.id === first.id)).toBe(false)
    expect(events.find(event => event.title === '后果')?.causes ?? []).toEqual([])
    expect((await store.readIdeas(DREAM.workId)).ideas[0]?.eventId).toBeUndefined()
  })

  it('refuses a chapter', async () => {
    const { store } = bench()
    expect((await store.deleteNode({ workId: DREAM.workId, node: 'ch:1' }, session)).ok).toBe(false)
  })
})
