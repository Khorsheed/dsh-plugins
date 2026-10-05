/**
 * The story-log read on the 《梦境监护者》seed (chapter 5 being written,
 * chapter 6 planned): foreshadow marks from the mention journal plus hollow
 * plan marks for the unreconciled chapters, the relation journal with the two
 * names, each character's chapters (plan cast and POV, the experience
 * journal), the world cards, and a canvas edit the engine has not synced yet
 * showing as 你改的 at the current chapter.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { NovelService } from '../src/store.ts'
import { provideCanvas, type FakeCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { CARD, DREAM, seedDreamKeeper } from './seed-dream.ts'

const SESSION = { id: 's-story-log' } as unknown as Session

function seededStore(): { store: NovelService; canvas: FakeCanvas } {
  const fs = new FakeFs()
  seedDreamKeeper(fs, { ch5Phase: 'planning' })
  const ctx = new Context()
  ctx.provide('fs', fs as never)
  const canvas = provideCanvas(ctx)
  return { store: new NovelService(ctx, { stateRoot: DREAM.stateRoot }), canvas }
}

describe('the story log', () => {
  it('lays the foreshadow marks out by chapter: the journal solid, the unreconciled plans hollow', async () => {
    const { store } = seededStore()
    const log = await store.storyLog({ workId: DREAM.workId })
    expect(log.ok).toBe(true)
    expect(log.chapters.map(row => [row.n, row.phase])).toEqual([
      [1, 'extracted'], [2, 'extracted'], [3, 'extracted'], [4, 'extracted'], [5, 'writing'], [6, 'planning'],
    ])
    const doorGap = log.foreshadows.find(view => view.cardId === CARD.doorGap)!
    expect(doorGap.marks).toEqual([
      { chapter: 1, kind: 'planted', planned: false },
      { chapter: 3, kind: 'advanced', planned: false },
      { chapter: 5, kind: 'advanced', planned: true, note: '门缝第一次被找到' },
      { chapter: 6, kind: 'advanced', planned: true, note: '门后第一层' },
    ])
    const tower = log.foreshadows.find(view => view.cardId === CARD.towerShadow)!
    expect(tower).toMatchObject({ state: '已揭晓', marks: [{ chapter: 4, kind: 'resolved', planned: false }] })
  })

  it('reads the relation journal with both names, oldest first', async () => {
    const { store } = seededStore()
    const [pair] = (await store.storyLog({ workId: DREAM.workId })).relations
    expect(pair).toMatchObject({ cardId: CARD.zhaoAiwen, names: ['赵启明', '艾文'], type: '同盟', stage: '合作', progress: 3, ready: true })
    expect(pair!.journal.map(entry => [entry.chapter, entry.kind === 'points' ? entry.delta : entry.event])).toEqual([
      [2, 'start'], [2, 1], [3, 2], [3, 'up'], [4, 2], [5, 1],
    ])
  })

  it('places each character: the experience journal settled, the plan cast and POV planned', async () => {
    const { store } = seededStore()
    const log = await store.storyLog({ workId: DREAM.workId })
    const zhao = log.characters.find(card => card.cardId === CARD.zhao)!
    expect(zhao.appearances).toEqual([
      { chapter: 3, pov: false, planned: false, experiences: ['在档案室发现前任监护者留下的半页守则'] },
      { chapter: 4, pov: false, planned: false, experiences: ['首次独自进入二层梦，迷失后被艾文救下'] },
      { chapter: 5, pov: true, planned: true, role: '找门、决定推门', experiences: ['按半页守则的指引找到档案室的门缝，决定一探究竟'] },
      { chapter: 6, pov: true, planned: true, experiences: [] },
    ])
    expect(zhao.plot['now']).toBe('档案室门外走廊 · 刚经历二层梦脱险，心跳未平 · 妹妹的下落')
    expect(log.world.map(card => card.cardId)).toEqual([CARD.trueName, CARD.leafCarrier])
    expect(log.world[0]!.plot).toEqual({ rule: '监护者不能在梦里说出自己的真名——真名是锚，说出即被梦主锁定。' })
  })

  it('shows a canvas edit the engine has not synced yet as 你改的 at the current chapter, without writing it', async () => {
    const { store, canvas } = seededStore()
    await store.ensureRefs(DREAM.workId, SESSION)
    const card = canvas.card(DREAM.workId, CARD.zhao)!
    await canvas.patchCard({ canvasId: DREAM.workId, cardId: CARD.zhao, fields: { ...card.fields, voice: '短句；紧张时重复别人的话' } })
    const zhao = (await store.storyLog({ workId: DREAM.workId })).characters.find(item => item.cardId === CARD.zhao)!
    expect(zhao.history).toEqual([{
      cardId: CARD.zhao, chapter: 6, source: 'user', kind: 'change', createdAt: '',
      changes: [expect.objectContaining({ field: 'voice', op: expect.any(String), value: '短句；紧张时重复别人的话' })],
    }])
    expect(await store.listHistory({ workId: DREAM.workId })).toEqual([])
  })
})
