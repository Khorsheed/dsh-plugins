/**
 * The extract import's five gates (proposal §5), each pinned on the
 * 《梦境监护者》seed with chapter 5 reviewed: evidence grep, the ledger
 * whitelist, new_* always pending, confidence splitting (high lands
 * automatically and retractably, medium/low pends), and plan verification
 * with 计划落空 routed to a person.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import type { ExtractPayload } from '../src/store.ts'
import { StoryBibleService } from '../src/store.ts'
import { FakeFs } from './fake-fs.ts'
import { DREAM, seedDreamKeeper } from './seed-dream.ts'

const SESSION = { id: 's-import' } as unknown as Session

/** A store over the seed, with chapter 5 in the writing state (对账只对写作中的章开放). */
function seededStore(): { store: StoryBibleService; fs: FakeFs } {
  const fs = new FakeFs()
  seedDreamKeeper(fs, { ch5Phase: 'planning' })
  const ctx = new Context()
  ctx.provide('fs', fs as never)
  return { store: new StoryBibleService(ctx, { stateRoot: DREAM.stateRoot }), fs }
}

/** The subagent's strict JSON for chapter 5: one row per gate, crafted against the manuscript's own sentences. */
const PAYLOAD: ExtractPayload = {
  memories: [
    { type: 'semantic', content: '门后的敲击以三下为一组，像某种耐心的呼吸。', confidence: 'high', evidence_in_text: '门缝后的敲击声变成了明确的三下' },
    { type: 'semantic', content: '门后空间有一层是监护所的地下室。', confidence: 'high', evidence_in_text: '正文里根本没有这句话' },
    { type: 'semantic', content: '门缝附近的蓝叶会亮得刺眼。', confidence: 'medium', evidence_in_text: '袖口的蓝叶在靠近门缝时亮得刺眼' },
  ],
  foreshadow_mentions: [
    { foreshadow_id: '#15', kind: 'hinted', confidence: 'high', evidence_in_text: '袖口的蓝叶在靠近门缝时亮得刺眼' },
    { foreshadow_id: '#99', kind: 'advanced', confidence: 'high', evidence_in_text: '袖口的蓝叶在靠近门缝时亮得刺眼' },
    { foreshadow_id: '#12', kind: 'advanced', confidence: 'medium', evidence_in_text: '指尖碰到门缝的边缘' },
  ],
  new_foreshadows: [
    { question: '摇篮曲是谁唱的', tension: 3, evidence_in_text: '门后传来一个女人的声音，哼着不成调的摇篮曲' },
  ],
  new_characters: [
    { name: '哼歌的女人', identity: '门后空间里的声音', evidence_in_text: '门后传来一个女人的声音，哼着不成调的摇篮曲' },
  ],
  experiences: [
    { character_id: 'c1', entry: '下定决心推门，握住蓝叶当作依靠', confidence: 'high', evidence_in_text: '想起妹妹走失那天，也是这样的光' },
  ],
  current_states: [
    { character_id: 'c1', where: '档案室门缝前', state: '下定决心', concern: '妹妹的下落', confidence: 'high' },
  ],
  recap: '赵启明按半页守则找到门缝，听见门后的摇篮曲，握住蓝叶决定推门。',
}

describe('story_extract import — the five gates (proposal §5)', () => {
  it('gate 1: a quote the manuscript does not contain is dropped with a log (anti-fabrication)', async () => {
    const { store } = seededStore()
    const report = await store.extractImport({ workId: DREAM.workId, n: 5, payload: PAYLOAD }, SESSION)
    expect(report.ok).toBe(true)
    expect(report.dropped).toContainEqual({ kind: 'memory', reason: 'evidence-not-found', ref: '门后空间有一层是监护所的地下室。'.slice(0, 30) })
    // …and nothing of the fabricated row landed anywhere.
    const memories = await store.listMemories({ workId: DREAM.workId })
    expect(memories.some(memory => memory.content.includes('地下室'))).toBe(false)
  })

  it('gate 2: a foreshadow id outside the active ledger is dropped (whitelist)', async () => {
    const { store } = seededStore()
    const report = await store.extractImport({ workId: DREAM.workId, n: 5, payload: PAYLOAD }, SESSION)
    expect(report.dropped).toContainEqual({ kind: 'mention', reason: 'id-not-in-ledger', ref: '#99' })
  })

  it('gate 3: new characters and new foreshadows ALWAYS wait for review, evidence-grepped first', async () => {
    const { store } = seededStore()
    const report = await store.extractImport({ workId: DREAM.workId, n: 5, payload: PAYLOAD }, SESSION)
    const pending = await store.listPending({ workId: DREAM.workId })
    const newForeshadow = pending.find(item => item.kind === 'new-foreshadow')
    const newCharacter = pending.find(item => item.kind === 'new-character')
    expect(newForeshadow?.payload['question']).toBe('摇篮曲是谁唱的')
    expect(newForeshadow?.reason).toBe('新伏笔必待审')
    expect(newCharacter?.payload['name']).toBe('哼歌的女人')
    expect(newCharacter?.reason).toBe('新角色必进待审')
    // They NEVER materialize by themselves…
    expect((await store.listCharacters({ workId: DREAM.workId })).some(character => character.name === '哼歌的女人')).toBe(false)
    expect((await store.ledger({ workId: DREAM.workId })).active.some(memory => memory.specifics?.question === '摇篮曲是谁唱的')).toBe(false)
    expect(report.pending).toBeGreaterThanOrEqual(4)
  })

  it('gate 4: high lands automatically (reviewed, 自动·可撤销), medium/low pends', async () => {
    const { store } = seededStore()
    const report = await store.extractImport({ workId: DREAM.workId, n: 5, payload: PAYLOAD }, SESSION)
    expect(report.autoImported).toBe(1)
    const memories = await store.listMemories({ workId: DREAM.workId })
    const auto = memories.find(memory => memory.content.includes('门后的敲击以三下为一组'))
    expect(auto).toMatchObject({ layer: 'canon', reviewed: true, extractedBy: 'llm', autoImported: true, confidence: 'high', firstChapter: 5, lastActiveChapter: 5 })
    // …and the automatic write retracts (撤销), while a user row refuses retract.
    const retracted = await store.decideMemory({ workId: DREAM.workId, id: auto!.id, action: 'retract' }, SESSION)
    expect(retracted.ok).toBe(true)
    expect(retracted.memory?.status).toBe('archived')
    const refused = await store.decideMemory({ workId: DREAM.workId, id: 'm1', action: 'retract' }, SESSION)
    expect(refused.ok).toBe(false)
    // The medium row pends instead of landing.
    const pending = await store.listPending({ workId: DREAM.workId })
    expect(pending.some(item => item.kind === 'memory' && item.confidence === 'medium')).toBe(true)
    // A medium MENTION pends too (榜上判不了的疑似提及进人审), and records nothing yet.
    expect(pending.some(item => item.kind === 'mention' && item.payload['foreshadowId'] === 'm12')).toBe(true)
    const m12 = memories.find(memory => memory.id === 'm12')
    expect(m12?.lastActiveChapter).toBe(3)
  })

  it('gate 5: plan ops verify against recorded mentions; a missed plan pends as 计划落空, journal lines carry the flags', async () => {
    const { store, fs } = seededStore()
    const report = await store.extractImport({ workId: DREAM.workId, n: 5, payload: PAYLOAD }, SESSION)
    // 暗示 #15 was touched (hinted mention recorded) → verified; 推进 #12 was not → missed.
    expect(report.verified).toBe(1)
    expect(report.missed).toBe(1)
    const pending = await store.listPending({ workId: DREAM.workId })
    const missed = pending.find(item => item.kind === 'plan-missed')
    expect(missed?.reason).toContain('计划落空：推进 [#12]')
    expect(missed?.reason).toContain('忘了还是改主意')
    // The recorded mention carries planned/reconciled, and the ledger moved.
    const mentions = fs.read(`${DREAM.stateRoot}/${DREAM.workId}/mentions.jsonl`).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const recorded = mentions.find(line => line['chapter'] === 5 && line['foreshadowId'] === 'm15')
    expect(recorded).toMatchObject({ kind: 'hinted', planned: true, reconciled: true })
    const memories = await store.listMemories({ workId: DREAM.workId })
    expect(memories.find(memory => memory.id === 'm15')?.lastActiveChapter).toBe(5)
  })

  it('the reconciliation side effects land: phase, recap, word count, experience, current state', async () => {
    const { store } = seededStore()
    await store.extractImport({ workId: DREAM.workId, n: 5, payload: PAYLOAD }, SESSION)
    const chapter = await store.readChapter({ workId: DREAM.workId, n: 5 })
    expect(chapter.chapter?.phase).toBe('extracted')
    expect(chapter.chapter?.recap).toBe('赵启明按半页守则找到门缝，听见门后的摇篮曲，握住蓝叶决定推门。')
    expect(chapter.chapter?.wordCount).toBeGreaterThan(0)
    const experiences = await store.listExperiences({ workId: DREAM.workId, characterId: 'c1' })
    expect(experiences.some(entry => entry.chapter === 5 && entry.entry.includes('下定决心推门'))).toBe(true)
    const character = await store.readCharacter({ workId: DREAM.workId, idOrName: 'c1' })
    expect(character?.currentState).toEqual({ where: '档案室门缝前', state: '下定决心', concern: '妹妹的下落' })
  })

  it('the extract gate is hard: only a writing chapter reconciles (审过收章永远最后)', async () => {
    const fs = new FakeFs()
    seedDreamKeeper(fs) // chapter 5 seeds extracted; chapter 6 is planning with NO body
    const ctx = new Context()
    ctx.provide('fs', fs as never)
    const store = new StoryBibleService(ctx, { stateRoot: DREAM.stateRoot })
    // 规划中且无正文：没有什么可对账的。
    const prepared = await store.extractPrepare({ workId: DREAM.workId, n: 6 })
    expect(prepared).toMatchObject({ ok: false, error: 'not-reviewed' })
    const report = await store.extractImport({ workId: DREAM.workId, n: 6, payload: {} }, SESSION)
    expect(report).toMatchObject({ ok: false, error: 'not-reviewed' })
    // An already-extracted chapter refuses a re-import (no double-filing)…
    const again = await store.extractImport({ workId: DREAM.workId, n: 5, payload: PAYLOAD }, SESSION)
    expect(again).toMatchObject({ ok: false, error: 'not-reviewed' })
    // …and a reviewed (closed) chapter refuses too.
    fs.seed(`${DREAM.stateRoot}/${DREAM.workId}/chapters.json`, `${JSON.stringify({ version: 1, chapters: [
      { n: 9, seq: 9, title: '收章的', file: '第9章.md', phase: 'reviewed', sessionIds: [], createdAt: 't', updatedAt: 't' },
    ] }, null, 2)}\n`)
    const closed = await store.extractImport({ workId: DREAM.workId, n: 9, payload: PAYLOAD }, SESSION)
    expect(closed).toMatchObject({ ok: false, error: 'not-reviewed' })
  })

  it('decidePending accept materializes through the same doors (new-foreshadow → the ledger)', async () => {
    const { store } = seededStore()
    await store.extractImport({ workId: DREAM.workId, n: 5, payload: PAYLOAD }, SESSION)
    const pending = await store.listPending({ workId: DREAM.workId })
    const newForeshadow = pending.find(item => item.kind === 'new-foreshadow')!
    const decided = await store.decidePending({ workId: DREAM.workId, id: newForeshadow.id, action: 'accept' }, SESSION)
    expect(decided.ok).toBe(true)
    const ledger = await store.ledger({ workId: DREAM.workId })
    const landed = ledger.active.find(memory => memory.specifics?.question === '摇篮曲是谁唱的')
    expect(landed).toMatchObject({ layer: 'canon', type: 'prospective', reviewed: true })
    expect(landed?.specifics).toMatchObject({ status: 'planted', tension: 3, plantedAt: 5 })
    // …and the item settles instead of lingering.
    const after = await store.listPending({ workId: DREAM.workId })
    expect(after.some(item => item.id === newForeshadow.id)).toBe(false)
  })
})
