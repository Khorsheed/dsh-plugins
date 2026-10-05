/**
 * The extract import's five gates (proposal §5), each pinned on the
 * 《梦境监护者》seed with chapter 5 in the writing state: evidence grep, the
 * ledger whitelist, new_* land live (marked new), confidence splitting (high
 * lands directly, medium/low becomes a pending item), and plan verification with 计划落空 routed to a person.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import type { ExtractPayload } from '../src/types.ts'
import { NovelService } from '../src/store.ts'
import { type FakeCanvas, provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { CARD, DREAM, seedDreamKeeper } from './seed-dream.ts'

const SESSION = { id: 's-import' } as unknown as Session

/** A store over the seed, with chapter 5 in the writing state (对账只对写作中的章开放). */
function seededStore(): { store: NovelService; fs: FakeFs; canvas: FakeCanvas } {
  const fs = new FakeFs()
  seedDreamKeeper(fs, { ch5Phase: 'planning' })
  const ctx = new Context()
  ctx.provide('fs', fs as never)
  const canvas = provideCanvas(ctx)
  return { store: new NovelService(ctx, { stateRoot: DREAM.stateRoot }), fs, canvas }
}

/** The subagent's strict JSON for chapter 5: one row per gate, crafted against the manuscript's own sentences. */
const PAYLOAD: ExtractPayload = {
  memories: [
    { kind: '世界', content: '门后的敲击以三下为一组，像某种耐心的呼吸。', evidence_in_text: '门缝后的敲击声变成了明确的三下' },
    { kind: '世界', content: '门后空间有一层是监护所的地下室。', evidence_in_text: '正文里根本没有这句话' },
    { kind: '世界', content: '门缝附近的蓝叶会亮得刺眼。', evidence_in_text: '袖口的蓝叶在靠近门缝时亮得刺眼' },
  ],
  foreshadow_mentions: [
    { foreshadow_id: '#15', kind: 'hinted', confidence: 'high', evidence_in_text: '袖口的蓝叶在靠近门缝时亮得刺眼' },
    { foreshadow_id: '#99', kind: 'advanced', confidence: 'high', evidence_in_text: '袖口的蓝叶在靠近门缝时亮得刺眼' },
    { foreshadow_id: '#12', kind: 'advanced', confidence: 'medium', evidence_in_text: '指尖碰到门缝的边缘' },
  ],
  new_foreshadows: [
    { question: '摇篮曲是谁唱的', evidence_in_text: '门后传来一个女人的声音，哼着不成调的摇篮曲' },
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

/** The cards whose main field holds `text`. */
function cardsWith(canvas: FakeCanvas, text: string) {
  return canvas.boards.get(DREAM.workId)!.cards.filter(card => Object.values(card.fields ?? {}).includes(text))
}

describe('novel_extract import — the five gates (proposal §5)', () => {
  it('gate 1: a quote the manuscript does not contain is dropped with a log (anti-fabrication)', async () => {
    const { store, canvas } = seededStore()
    const report = await store.extractImport({ workId: DREAM.workId, n: 5, payload: PAYLOAD }, SESSION)
    expect(report.ok).toBe(true)
    expect(report.dropped).toContainEqual({ kind: 'memory', reason: 'evidence-not-found', ref: '门后空间有一层是监护所的地下室。'.slice(0, 30) })
    // …and nothing of the fabricated row landed on the board.
    expect(cardsWith(canvas, '门后空间有一层是监护所的地下室。')).toEqual([])
  })

  it('gate 2: a foreshadow id outside the active ledger is dropped (whitelist)', async () => {
    const { store } = seededStore()
    const report = await store.extractImport({ workId: DREAM.workId, n: 5, payload: PAYLOAD }, SESSION)
    expect(report.dropped).toContainEqual({ kind: 'mention', reason: 'id-not-in-ledger', ref: '#99' })
  })

  it('gate 3: new rules, characters and foreshadows land as live cards, evidence-grepped first', async () => {
    const { store, canvas } = seededStore()
    const report = await store.extractImport({ workId: DREAM.workId, n: 5, payload: PAYLOAD }, SESSION)
    const [foreshadow] = cardsWith(canvas, '摇篮曲是谁唱的')
    const [character] = cardsWith(canvas, '哼歌的女人')
    expect(foreshadow).toMatchObject({ status: 'kept', kind: 'cat_foreshadow', fields: { question: '摇篮曲是谁唱的', status: '已埋', plantedAt: 5 } })
    expect(foreshadow?.comments[0]?.text).toContain('第5章新埋')
    expect(character).toMatchObject({ status: 'kept', kind: 'cat_character', fields: { name: '哼歌的女人', identity: '门后空间里的声音' } })
    expect(character?.comments[0]?.text).toContain('第5章登场')
    expect(report.newCards.map(card => card.role).sort()).toEqual(['character', 'foreshadow', 'world', 'world'])
    // Live cards are canon at once: the roster has the character, the ledger the foreshadow…
    const entries = (await store.readEntries(DREAM.workId))!
    expect(entries.characters.find(view => view.name === '哼歌的女人')?.cardStatus).toBe('kept')
    expect((await store.ledger({ workId: DREAM.workId })).active.find(view => view.ref === '#21'))
      .toMatchObject({ question: '摇篮曲是谁唱的', state: '已埋', plantedAt: 5, starred: false })
    // …and the sidecar numbered them (world, principle and foreshadow share one
    // number space: the two new rules took 19 and 20) and kept the evidence.
    const annotations = entries.annotations
    expect(annotations.refs[foreshadow!.id]).toBe(21)
    expect(annotations.refs[character!.id]).toBe(3)
    expect(annotations.notes[foreshadow!.id]).toEqual({ evidenceInText: '门后传来一个女人的声音，哼着不成调的摇篮曲' })
  })

  it('gate 4: rule cards land live with their evidence; medium/low journal lines pend', async () => {
    const { store, canvas } = seededStore()
    await store.extractImport({ workId: DREAM.workId, n: 5, payload: PAYLOAD }, SESSION)
    const [high] = cardsWith(canvas, '门后的敲击以三下为一组，像某种耐心的呼吸。')
    expect(high).toMatchObject({ status: 'kept', kind: 'cat_world' })
    const entries = (await store.readEntries(DREAM.workId))!
    expect(entries.annotations.notes[high!.id]).toEqual({ evidenceInText: '门缝后的敲击声变成了明确的三下' })
    // Every rule lands live with its evidence on the card for the user's look (rules carry no confidence).
    const [medium] = cardsWith(canvas, '门缝附近的蓝叶会亮得刺眼。')
    expect(medium?.status).toBe('kept')
    expect(medium?.comments[0]?.text).toBe('第5章：「袖口的蓝叶在靠近门缝时亮得刺眼」')
    // ✗ on a wrong one archives it.
    expect(await store.archiveCard({ workId: DREAM.workId, id: medium!.id }, SESSION)).toMatchObject({ ok: true })
    expect(canvas.card(DREAM.workId, medium!.id)?.status).toBe('archived')
    // A medium MENTION pends (榜上判不了的疑似提及进人审), and moves nothing yet.
    const pending = await store.listPending({ workId: DREAM.workId })
    expect(pending.some(item => item.kind === 'mention' && item.payload.foreshadowId === CARD.doorGap)).toBe(true)
    expect((await store.listMentions({ workId: DREAM.workId, foreshadowId: CARD.doorGap })).map(entry => entry.chapter)).toEqual([1, 3])
  })

  it('gate 5: plan ops verify against recorded mentions; a missed plan pends as 计划落空, journal lines carry the planned flag', async () => {
    const { store, fs, canvas } = seededStore()
    const report = await store.extractImport({ workId: DREAM.workId, n: 5, payload: PAYLOAD }, SESSION)
    // 暗示 #15 was touched (hinted mention recorded) → verified; 推进 #12 was not → missed.
    expect(report.verified).toBe(1)
    expect(report.missed).toBe(1)
    const pending = await store.listPending({ workId: DREAM.workId })
    const missed = pending.find(item => item.kind === 'plan-missed')
    expect(missed?.reason).toContain('计划落空：推进 [#12]')
    expect(missed?.reason).toContain('忘了还是改主意')
    // The recorded mention carries the planned flag, and the card's status moved.
    const mentions = fs.read(`${DREAM.stateRoot}/${DREAM.workId}/mentions.jsonl`).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const recorded = mentions.find(line => line['chapter'] === 5 && line['foreshadowId'] === CARD.leafGlow)
    expect(recorded).toEqual({ foreshadowId: CARD.leafGlow, chapter: 5, kind: 'hinted', planned: true, createdAt: expect.any(String) })
    expect(canvas.card(DREAM.workId, CARD.leafGlow)?.fields).toMatchObject({ question: '蓝色叶子为什么发光', status: '推进中', plantedAt: 2 })
    const ledger = await store.ledger({ workId: DREAM.workId })
    expect(ledger.active.find(view => view.cardId === CARD.leafGlow)?.lastActiveChapter).toBe(5)
  })

  it('信息差: a planned gap the text closed pends; adopting it moves the fact from 不知道 to 知道', async () => {
    const { store, fs, canvas } = seededStore()
    const file = `${DREAM.stateRoot}/${DREAM.workId}/chapters.json`
    const table = JSON.parse(fs.read(file)) as { chapters: { n: number; plan?: Record<string, unknown> }[] }
    table.chapters.find(row => row.n === 5)!.plan!['infoGaps'] = [
      { who: '赵启明', fact: '门缝里有什么' },
      { who: CARD.aiwen, fact: '赵启明妹妹的下落' },
      { who: '没这个人', fact: '随便什么' },
    ]
    fs.seed(file, `${JSON.stringify(table, null, 2)}\n`)
    const report = await store.extractImport({ workId: DREAM.workId, n: 5, payload: { info_gaps_closed: [
      { gap: 1, evidence_in_text: '门后传来一个女人的声音' },
      { gap: 2, evidence_in_text: '正文里没有这句' },
      { gap: 3, evidence_in_text: '门后传来一个女人的声音' },
      { gap: 9, evidence_in_text: '门后传来一个女人的声音' },
    ] } }, SESSION)
    expect(report.dropped).toEqual([
      { kind: 'info-gap', reason: 'evidence-not-found', ref: '2' },
      { kind: 'info-gap', reason: 'character-not-in-roster', ref: '没这个人' },
    ])
    const gap = (await store.listPending({ workId: DREAM.workId })).find(item => item.kind === 'info-gap')!
    expect(gap).toMatchObject({ chapter: 5, reason: '信息差：得知「门缝里有什么」', payload: { characterId: CARD.zhao, fact: '门缝里有什么' } })
    expect(await store.decidePending({ workId: DREAM.workId, id: gap.id, action: 'accept' }, SESSION)).toEqual({ ok: true })
    expect(canvas.card(DREAM.workId, CARD.zhao)?.fields).toMatchObject({
      knows: '监护守则的全部条文\n二层梦的基本规则\n门缝里有什么（第5章得知）',
      unaware: '蓝色叶子的来历\n艾文的真实身份',
    })
  })

  it('the reconciliation side effects land: phase, recap, word count, experience, current state', async () => {
    const { store } = seededStore()
    await store.extractImport({ workId: DREAM.workId, n: 5, payload: PAYLOAD }, SESSION)
    const chapter = await store.readChapter({ workId: DREAM.workId, n: 5 })
    expect(chapter.chapter?.phase).toBe('extracted')
    expect(chapter.chapter?.recap).toBe('赵启明按半页守则找到门缝，听见门后的摇篮曲，握住蓝叶决定推门。')
    expect(chapter.chapter?.wordCount).toBeGreaterThan(0)
    const experiences = await store.listExperiences({ workId: DREAM.workId, characterId: CARD.zhao })
    expect(experiences.find(entry => entry.chapter === 5 && entry.entry.includes('下定决心推门'))).toBeDefined()
    const entries = (await store.readEntries(DREAM.workId))!
    expect(entries.characters.find(view => view.cardId === CARD.zhao)?.currentState).toEqual({ where: '档案室门缝前', state: '下定决心', concern: '妹妹的下落' })
  })

  it('the extract gate is hard: only a writing chapter reconciles (审过收章永远最后)', async () => {
    const fs = new FakeFs()
    seedDreamKeeper(fs) // chapter 5 seeds extracted; chapter 6 is planning with NO body
    const ctx = new Context()
    ctx.provide('fs', fs as never)
    provideCanvas(ctx)
    const store = new NovelService(ctx, { stateRoot: DREAM.stateRoot })
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

  it('decidePending accept materializes through the same doors (a pended mention → the journal and the card)', async () => {
    const { store, canvas } = seededStore()
    await store.extractImport({ workId: DREAM.workId, n: 5, payload: PAYLOAD }, SESSION)
    const pending = await store.listPending({ workId: DREAM.workId })
    const mention = pending.find(item => item.kind === 'mention')!
    expect(await store.decidePending({ workId: DREAM.workId, id: mention.id, action: 'accept' }, SESSION)).toEqual({ ok: true })
    expect((await store.listMentions({ workId: DREAM.workId, foreshadowId: CARD.doorGap })).map(entry => entry.chapter)).toEqual([1, 3, 5])
    expect(canvas.card(DREAM.workId, CARD.doorGap)?.fields?.['status']).toBe('推进中')
    // …and the item settles instead of lingering.
    const after = await store.listPending({ workId: DREAM.workId })
    expect(after.some(item => item.id === mention.id)).toBe(false)
  })

  it('names world rules, refuses names the canvas already holds, and files a new character\'s experience on its own new card', async () => {
    const { store, canvas } = seededStore()
    const evidence = '门后传来一个女人的声音，哼着不成调的摇篮曲'
    const report = await store.extractImport({ workId: DREAM.workId, n: 5, payload: {
      memories: [
        { kind: '世界', name: '门后的歌', world_kind: '地点', content: '门后有人在哼摇篮曲。', evidence_in_text: evidence },
        { kind: '世界', name: '门后的歌', content: '同一件事换个说法。', evidence_in_text: evidence },
        { kind: '世界', content: '摇篮曲不成调，像在模仿谁。', evidence_in_text: evidence },
      ],
      new_characters: [
        { name: '哼歌的女人', identity: '门后空间里的声音', evidence_in_text: evidence },
        { name: '艾文', identity: '重复登场', evidence_in_text: evidence },
      ],
      experiences: [{ character_id: '哼歌的女人', entry: '在门后哼歌', confidence: 'high', evidence_in_text: evidence }],
    } }, SESSION)
    // A named rule keeps its name and kind; an unnamed one takes its first clause.
    const [named] = cardsWith(canvas, '门后有人在哼摇篮曲。')
    expect(named?.fields).toMatchObject({ name: '门后的歌', kind: '地点' })
    expect(cardsWith(canvas, '摇篮曲不成调，像在模仿谁。')[0]?.fields?.['name']).toBe('摇篮曲不成调')
    // The second 门后的歌 never becomes a card; 艾文 is simply not new (her experiences would still reach c2).
    expect(cardsWith(canvas, '同一件事换个说法。')).toEqual([])
    expect(canvas.boards.get(DREAM.workId)!.cards.filter(card => card.fields?.['name'] === '艾文')).toHaveLength(1)
    expect(report.dropped.filter(drop => drop.reason === 'duplicate').map(drop => drop.ref)).toEqual(['门后的歌（本次已提过）'])
    // The new character's experience lands on its new card instead of dropping out of the roster.
    const [singer] = cardsWith(canvas, '哼歌的女人')
    expect((await store.listExperiences({ workId: DREAM.workId, characterId: singer!.id })).map(entry => entry.entry)).toEqual(['在门后哼歌'])
    expect(report.dropped.some(drop => drop.reason === 'character-not-in-roster')).toBe(false)
    // Every new card carries its ref, so the model edits it instead of starting another.
    expect(report.newCards.map(card => card.ref)).toEqual(['w19', 'w20', 'c3'])
  })
})
