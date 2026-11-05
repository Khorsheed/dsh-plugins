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

  it('keeps current events in chapter order and appends unanchored backstories to the backstory group', async () => {
    const { store, fs } = bench()
    await store.writeEvent({ workId: DREAM.workId, title: '开场', status: 'happened', chapters: [1] }, SESSION)
    const evidence = '门缝后的敲击声变成了明确的三下'
    const report = await store.extractImport({
      workId: DREAM.workId, n: 5, payload: {
        events: [
          { title: '当前甲', evidence_in_text: evidence },
          { title: '往事甲', backstory: true, evidence_in_text: evidence },
          { title: '当前乙', evidence_in_text: evidence },
          { title: '往事乙', backstory: true, evidence_in_text: evidence },
          { title: '锚点不存在', after: 'e404', evidence_in_text: evidence },
        ],
      },
    }, SESSION)
    expect(report.memory).toMatchObject({ events: 4 })
    expect(report.dropped).toContainEqual({ kind: 'event', reason: 'id-not-in-ledger', ref: '锚点不存在（after=e404）' })
    let { events } = await store.allEvents(DREAM.workId)
    const happened = () => events.filter(event => event.status === 'happened' && event.foreshadowId === undefined).sort((a, b) => a.order - b.order).map(event => event.title)
    expect(happened()).toEqual(['往事甲', '往事乙', '开场', '当前甲', '当前乙'])
    const current = events.find(event => event.title === '当前甲')!
    await store.writeEvent({ workId: DREAM.workId, title: '定点往事', status: 'happened', backstory: true, after: current.id }, SESSION)
    events = (await store.allEvents(DREAM.workId)).events
    expect(happened()).toEqual(['往事甲', '往事乙', '开场', '当前甲', '定点往事', '当前乙'])
    fs.seed(`${DREAM.workspace}/${DREAM.title}/第4章.md`, `${fs.read(`${DREAM.workspace}/${DREAM.title}/第4章.md`)}\n后续往事被补记。\n`)
    const followup = await store.extractImport({
      workId: DREAM.workId, n: 4, payload: {
        events: [{ title: '无锚后续往事', backstory: true, evidence_in_text: '后续往事被补记' }],
      },
    }, SESSION)
    expect(followup.memory).toMatchObject({ events: 1 })
    events = (await store.allEvents(DREAM.workId)).events
    expect(happened()).toEqual(['往事甲', '往事乙', '无锚后续往事', '开场', '当前甲', '定点往事', '当前乙'])
  })

  it('keeps chapter 1 current events and interleaved backstories in their respective story-time groups', async () => {
    const { store, fs } = bench()
    fs.seed(`${DREAM.workspace}/${DREAM.title}/第1章.md`, '开场钟声响起。\n\n当前甲发生。\n\n往事甲被讲起。\n\n当前乙发生。\n\n往事乙被讲起。\n')
    const report = await store.extractImport({
      workId: DREAM.workId, n: 1, payload: {
        events: [
          { title: '开场', evidence_in_text: '开场钟声响起' },
          { title: '当前甲', evidence_in_text: '当前甲发生' },
          { title: '往事甲', backstory: true, evidence_in_text: '往事甲被讲起' },
          { title: '当前乙', evidence_in_text: '当前乙发生' },
          { title: '往事乙', backstory: true, evidence_in_text: '往事乙被讲起' },
        ],
      },
    }, SESSION)
    expect(report.memory).toMatchObject({ events: 5 })
    const { events } = await store.allEvents(DREAM.workId)
    expect(events.filter(event => event.status === 'happened' && event.foreshadowId === undefined).sort((a, b) => a.order - b.order).map(event => event.title))
      .toEqual(['往事甲', '往事乙', '开场', '当前甲', '当前乙'])
  })

  it('moves an existing event before another or to the opening and rejects bad positions', async () => {
    const { store } = bench()
    for (const title of ['甲', '乙', '丙']) await store.writeEvent({ workId: DREAM.workId, title, status: 'happened' }, SESSION)
    expect((await store.writeEvent({ workId: DREAM.workId, id: 'e3', before: 'e1' }, SESSION)).ok).toBe(true)
    expect((await store.writeEvent({ workId: DREAM.workId, id: 'e2', before: 'first' }, SESSION)).ok).toBe(true)
    const { events } = await store.allEvents(DREAM.workId)
    expect(events.filter(event => event.foreshadowId === undefined).sort((a, b) => a.order - b.order).map(event => event.title)).toEqual(['乙', '丙', '甲'])
    expect((await store.writeEvent({ workId: DREAM.workId, id: 'e1', before: 'e404' }, SESSION)).ok).toBe(false)
    expect((await store.writeEvent({ workId: DREAM.workId, id: 'e1', after: 'e404' }, SESSION)).ok).toBe(false)
    expect((await store.writeEvent({ workId: DREAM.workId, id: 'e1', after: 'e2', before: 'e3' }, SESSION)).ok).toBe(false)
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

  it('manual mind corrections reach the brief and survive automatic reconciliation', async () => {
    const { store } = bench()
    expect((await store.correctMind({ workId: DREAM.workId, cardId: CARD.zhao, kind: 'intent', text: '先核实再推门' }, SESSION)).ok).toBe(true)
    expect((await store.correctMind({ workId: DREAM.workId, cardId: CARD.zhao, kind: 'belief', text: '不能只听门后的声音', source: '推测' }, SESSION)).ok).toBe(true)
    const write = await store.gatherBrief({ workId: DREAM.workId, chapter: 5, for: 'write' })
    expect(write.data?.inScene.find(row => row.character.cardId === CARD.zhao)?.mind).toMatchObject({ intent: '先核实再推门', beliefs: [{ text: '不能只听门后的声音', origin: 'manual' }] })
    const payload = { intents: [{ character_id: '赵启明', intent: '立即推门', evidence_in_text: '门缝后的敲击声变成了明确的三下' }] }
    await store.extractImport({ workId: DREAM.workId, n: 5, payload }, SESSION)
    await store.extractImport({ workId: DREAM.workId, n: 5, payload }, SESSION)
    const minds = await store.listMinds({ workId: DREAM.workId, characterId: CARD.zhao })
    expect(minds.filter(row => row.origin === 'manual')).toHaveLength(2)
    expect(minds.filter(row => row.kind === 'intent').map(row => row.text)).toEqual(['先核实再推门', '立即推门'])
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
