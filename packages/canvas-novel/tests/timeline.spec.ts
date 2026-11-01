/**
 * The timeline and the character memory (2026-11-01): tension and its
 * tiers, recall with the person's pins, event writes that resolve their
 * people by name, and the 对账 writing this chapter's events, moving future
 * events, ticking preconditions, recording beliefs and intents, and marking
 * a realized event's ideas 已写入.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { renderPlanBrief, renderWriteBrief } from '../src/brief.ts'
import { NovelService } from '../src/store.ts'
import { recall, tensionOf, type StoryEvent } from '../src/timeline.ts'
import { provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { CARD, DREAM, seedDreamKeeper } from './seed-dream.ts'

const SESSION = { id: 's-timeline' } as unknown as Session

function event(id: string, extra: Partial<StoryEvent> = {}): StoryEvent {
  return { id, title: id, order: 1, status: 'preset', createdAt: '', since: 1, value: 0.6, ...extra }
}

describe('tension and tiers', () => {
  it('checks 饱和 → 搁置 → 临近 → 积压 → 就绪, in that order', () => {
    expect(tensionOf(event('a', { touched: [3, 4, 5] }), 5).tier).toBe('sat')
    expect(tensionOf(event('b', { pre: [{ text: '第二个案例' }] }), 5).tier).toBe('hold')
    expect(tensionOf(event('c', { windowChapter: 7 }), 5).tier).toBe('near')
    expect(tensionOf(event('d', { since: 1 }), 5).tier).toBe('backlog')
    expect(tensionOf(event('e', { since: 4 }), 5).tier).toBe('ready')
    const parts = tensionOf(event('f', { pre: [{ text: 'x', met: 2 }, { text: 'y' }] }), 5)
    expect(parts.E).toBe(0.5)
  })

  it('recalls preferred first, never blocked, every 临近, then by tension — at most two per character beside the POV', () => {
    const events = [
      event('near', { windowChapter: 6, who: ['hero'] }),
      event('sat', { touched: [3, 4, 5] }),
      event('hold', { pre: [{ text: 'x' }] }),
      event('a', { who: ['hero', 'qy'], since: 1 }),
      event('b', { who: ['qy'], since: 1 }),
      event('c', { who: ['qy'], since: 1 }),
      event('blocked', { since: 1 }),
      event('past', { status: 'happened' }),
    ]
    const picked = recall(events, 5, { prefer: ['hold'], block: ['blocked'], pov: 'hero' }).map(row => row.event.id)
    expect(picked[0]).toBe('hold')
    expect(picked).toContain('near')
    expect(picked).not.toContain('blocked')
    expect(picked).not.toContain('sat')
    expect(picked).not.toContain('past')
    expect(picked.filter(id => ['a', 'b', 'c'].includes(id))).toHaveLength(2)
  })
})

function bench() {
  const fs = new FakeFs()
  seedDreamKeeper(fs, { ch5Phase: 'planning' })
  const ctx = new Context()
  ctx.provide('fs', fs as never)
  provideCanvas(ctx)
  return { store: new NovelService(ctx, { stateRoot: DREAM.stateRoot }), fs }
}

describe('the timeline in the store', () => {
  it('writes events with people by name, places them after another, and reads foreshadows as reveal events', async () => {
    const { store } = bench()
    const first = await store.writeEvent({ workId: DREAM.workId, title: '赵启明推开门', status: 'preset', source: '打算', who: ['赵启明'], pre: ['找到门缝'], windowChapter: 7 }, SESSION)
    expect(first).toMatchObject({ ok: true, id: 'e1' })
    expect((await store.writeEvent({ workId: DREAM.workId, title: '没这人', who: ['不存在'] }, SESSION)).unknown).toEqual(['不存在'])
    const backstory = await store.writeEvent({ workId: DREAM.workId, title: '前任监护者失踪', status: 'happened', when: '十年前' }, SESSION)
    await store.writeEvent({ workId: DREAM.workId, title: '监护所成立', status: 'happened', after: undefined }, SESSION)
    await store.writeEvent({ workId: DREAM.workId, id: backstory.id!, after: 'e3' }, SESSION)
    const { events } = await store.allEvents(DREAM.workId)
    const doorEvent = events.find(row => row.id === 'e1')!
    expect(doorEvent.who).toEqual([CARD.zhao])
    expect(events.find(row => row.id === `fs:${CARD.doorGap}`)?.source).toBe('揭晓')
    const happened = events.filter(row => row.status === 'happened' && row.foreshadowId === undefined).sort((a, b) => a.order - b.order).map(row => row.title)
    expect(happened).toEqual(['监护所成立', '前任监护者失踪'])
    expect((await store.writeEvent({ workId: DREAM.workId, id: 'e2', delete: true }, SESSION)).ok).toBe(true)
  })

  it('applies the person\'s pins only to the chapter they were set for, and the plan brief lists the candidates', async () => {
    const { store } = bench()
    await store.writeEvent({ workId: DREAM.workId, title: '赵启明推开门', who: ['赵启明'] }, SESSION)
    await store.setRecallPins({ workId: DREAM.workId, chapter: 6, prefer: [], block: ['e1'] }, SESSION)
    expect((await store.recallFor({ workId: DREAM.workId, chapter: 6 })).candidates.map(row => row.event.id)).not.toContain('e1')
    expect((await store.recallFor({ workId: DREAM.workId, chapter: 7 })).candidates.map(row => row.event.id)).toContain('e1')
    const plan = await store.gatherBrief({ workId: DREAM.workId, chapter: 5, for: 'plan' })
    expect(renderPlanBrief(plan.data!)).toContain('[e1] 赵启明推开门（赵启明）')
  })

  it('the 对账 writes events, moves future ones, ticks preconditions, records minds, and marks ideas 已写入', async () => {
    const { store } = bench()
    await store.writeEvent({ workId: DREAM.workId, title: '赵启明推开门', who: ['赵启明'], pre: ['找到门缝'] }, SESSION)
    const idea = await store.changeIdea({ workId: DREAM.workId, add: '他把手按在门上，门是温的。' }, SESSION)
    await store.changeIdea({ workId: DREAM.workId, id: idea.id!, eventId: 'e1' }, SESSION)
    const report = await store.extractImport({
      workId: DREAM.workId, n: 5, payload: {
        events: [{ title: '敲击变成三下一组', people: ['c1'], evidence_in_text: '门缝后的敲击声变成了明确的三下' }, { title: '编的', evidence_in_text: '正文里没有这句' }],
        event_progress: [{ event_id: 'e1', kind: 'happened', evidence_in_text: '门缝后的敲击声变成了明确的三下' }],
        preconditions_met: [{ event_id: 'e1', index: 1, evidence_in_text: '门缝后的敲击声变成了明确的三下' }],
        beliefs: [{ character_id: '赵启明', belief: '门后的东西在回应他', source: '推测', evidence_in_text: '门缝后的敲击声变成了明确的三下' }],
        intents: [{ character_id: '赵启明', intent: '推开门', evidence_in_text: '门缝后的敲击声变成了明确的三下' }],
      },
    }, SESSION)
    expect(report.memory).toMatchObject({ events: 1, happened: ['赵启明推开门'], preconditions: 1, beliefs: 1, intents: 1 })
    expect(report.dropped.some(drop => drop.kind === 'event')).toBe(true)
    const { events } = await store.allEvents(DREAM.workId)
    expect(events.find(row => row.id === 'e1')).toMatchObject({ status: 'happened', chapters: [5], pre: [{ text: '找到门缝', met: 5 }] })
    expect(events.find(row => row.title === '敲击变成三下一组')?.who).toEqual([CARD.zhao])
    expect((await store.readIdeas(DREAM.workId)).ideas[0]?.writtenIn).toBe(5)
    const minds = await store.listMinds({ workId: DREAM.workId, characterId: CARD.zhao })
    expect(minds.map(row => row.kind)).toEqual(['belief', 'intent'])
  })

  it('the write brief expands the events the plan advances, with the ideas bound to them, and carries the minds', async () => {
    const { store } = bench()
    await store.writeEvent({ workId: DREAM.workId, title: '赵启明推开门', who: ['赵启明'] }, SESSION)
    const idea = await store.changeIdea({ workId: DREAM.workId, add: '门是温的。' }, SESSION)
    await store.changeIdea({ workId: DREAM.workId, id: idea.id!, eventId: 'e1' }, SESSION)
    await store.writeChapter({ workId: DREAM.workId, n: 6, title: '门后', plan: { summary: '推门', beats: [], foreshadowOps: [], cast: [{ who: CARD.zhao }], advances: ['e1'] } }, SESSION)
    const write = await store.gatherBrief({ workId: DREAM.workId, chapter: 6, for: 'write' })
    const text = renderWriteBrief(write.data!)
    expect(text).toContain('## 本章推进的事件')
    expect(text).toContain('作者写的片段（尽量保留原文，可以改衔接）：「门是温的。」')
  })
})
