/**
 * The card change history: the plot-field diff (pure), then the engine on
 * the 《梦境监护者》seed — the first sync only takes the snapshot; after it,
 * every move is logged on whose behalf it was made (模型整理 / 采纳 / 你改的),
 * and the person's own edit of a relation card's type or stage lands in the
 * relation journal instead.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { NovelService } from '../src/store.ts'
import { plotDiff, plotOf } from '../src/types.ts'
import { type FakeCanvas, provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { CARD, DREAM, seedDreamKeeper } from './seed-dream.ts'

const SESSION = { id: 's-history' } as unknown as Session

describe('the plot diff (pure)', () => {
  it('reads list fields line by line, the rest as values; bookkeeping fields stay out', () => {
    const before = plotOf('character', { name: '赵启明', voice: '短句', knows: '甲\n乙' }, { where: '门前' })
    const after = plotOf('character', { name: '赵启明·改', identity: '监护员', voice: '短句，爱自嘲', knows: '乙\n丙' }, {})
    expect(before).toEqual({ voice: '短句', knows: '甲\n乙', now: '门前' })
    expect(plotDiff('character', before, after)).toEqual([
      { field: 'identity', op: '+', value: '监护员' },
      { field: 'voice', op: '→', value: '短句，爱自嘲', from: '短句' },
      { field: 'knows', op: '+', value: '丙' },
      { field: 'knows', op: '−', value: '甲' },
      { field: 'now', op: '−', value: '门前' },
    ])
  })
})

/** A store over the seed (chapter 5 in the writing state), synced once so the history has its baseline. */
async function trackedStore(): Promise<{ store: NovelService; fs: FakeFs; canvas: FakeCanvas }> {
  const fs = new FakeFs()
  seedDreamKeeper(fs, { ch5Phase: 'planning' })
  const ctx = new Context()
  ctx.provide('fs', fs as never)
  const canvas = provideCanvas(ctx)
  const store = new NovelService(ctx, { stateRoot: DREAM.stateRoot })
  await store.ensureRefs(DREAM.workId, SESSION)
  return { store, fs, canvas }
}

/** Edit one card on the canvas as the person would (no engine call). */
async function editOnCanvas(canvas: FakeCanvas, cardId: string, fields: Record<string, string>): Promise<void> {
  const card = canvas.card(DREAM.workId, cardId)!
  await canvas.patchCard({ canvasId: DREAM.workId, cardId, fields: { ...card.fields, ...fields } })
}

describe('the change history in the engine', () => {
  it('the first sync takes the snapshot and logs nothing', async () => {
    const { store } = await trackedStore()
    const entries = (await store.readEntries(DREAM.workId))!
    expect(entries.annotations.historySince).toBeDefined()
    expect(entries.annotations.notes[CARD.zhao]?.plot?.['identity']).toBeDefined()
    expect(await store.listHistory({ workId: DREAM.workId })).toEqual([])
  })

  it('a canvas edit is 你改的 at the current chapter; a model write in the same pass keeps only its own fields', async () => {
    const { store, canvas } = await trackedStore()
    await editOnCanvas(canvas, CARD.zhao, { voice: '短句；紧张时重复别人的话' })
    await store.writeCard({ workId: DREAM.workId, role: 'character', id: 'c1', fields: { identity: '代理监护员' } }, SESSION)
    const history = await store.listHistory({ workId: DREAM.workId, cardId: CARD.zhao })
    expect(history).toMatchObject([
      { source: 'model', kind: 'change', chapter: 6, changes: [{ field: 'identity', op: '→', value: '代理监护员' }] },
      { source: 'user', kind: 'change', chapter: 6, changes: [{ field: 'voice', op: '→', value: '短句；紧张时重复别人的话' }] },
    ])
    // Synced: the next pass logs nothing more.
    await store.ensureRefs(DREAM.workId, SESSION)
    expect(await store.listHistory({ workId: DREAM.workId })).toHaveLength(2)
  })

  it('the import logs a new card as created by the model, 此刻 as the model\'s, at the chapter; an adopted 信息差 is 采纳 with its evidence', async () => {
    const { store, fs } = await trackedStore()
    const file = `${DREAM.stateRoot}/${DREAM.workId}/chapters.json`
    const table = JSON.parse(fs.read(file)) as { chapters: { n: number; plan?: Record<string, unknown> }[] }
    table.chapters.find(row => row.n === 5)!.plan!['infoGaps'] = [{ who: '赵启明', fact: '门缝里有什么' }]
    fs.seed(file, `${JSON.stringify(table, null, 2)}\n`)
    await store.extractImport({
      workId: DREAM.workId, n: 5, payload: {
        new_characters: [{ name: '哼歌的女人', identity: '门后空间里的声音', evidence_in_text: '门后传来一个女人的声音，哼着不成调的摇篮曲' }],
        current_states: [{ character_id: 'c1', where: '档案室门缝前', state: '下定决心', concern: '妹妹的下落', confidence: 'high' }],
        info_gaps_closed: [{ gap: 1, evidence_in_text: '门后传来一个女人的声音' }],
      },
    }, SESSION)
    const history = await store.listHistory({ workId: DREAM.workId })
    expect(history).toContainEqual(expect.objectContaining({
      source: 'model', kind: 'create', chapter: 5, evidence: '门后传来一个女人的声音，哼着不成调的摇篮曲',
      changes: [{ field: 'identity', op: '+', value: '门后空间里的声音' }],
    }))
    expect(history).toContainEqual(expect.objectContaining({
      cardId: CARD.zhao, source: 'model', chapter: 5, changes: [expect.objectContaining({ field: 'now', value: '档案室门缝前 · 下定决心 · 妹妹的下落' })],
    }))
    // The 信息差 the text closed is applied by the 对账 itself: the model's, with its evidence.
    expect((await store.listHistory({ workId: DREAM.workId, cardId: CARD.zhao })).at(-1)).toMatchObject({
      source: 'model', chapter: 5, evidence: '门后传来一个女人的声音',
      changes: [{ field: 'knows', op: '+', value: '门缝里有什么（第5章得知）' }, { field: 'unaware', op: '−', value: '门缝里有什么' }],
    })
  })

  it('the person\'s edit of a relation card\'s stage or type goes to the relation journal (the bar restarts), not the history', async () => {
    const { store, canvas } = await trackedStore()
    await editOnCanvas(canvas, CARD.zhaoAiwen, { stage: '托底' })
    await store.ensureRefs(DREAM.workId, SESSION)
    await editOnCanvas(canvas, CARD.zhaoAiwen, { type: '友情', stage: '知己' })
    await store.ensureRefs(DREAM.workId, SESSION)
    const journal = await store.listRelationJournal({ workId: DREAM.workId, relationId: CARD.zhaoAiwen })
    expect(journal.slice(-2)).toMatchObject([
      { kind: 'stage', event: 'set', stage: '托底', level: 3, chapter: 6 },
      { kind: 'stage', event: 'type', stage: '知己', level: 3, fromType: '同盟', toType: '友情' },
    ])
    expect((await store.ledger({ workId: DREAM.workId })).relations[0]).toMatchObject({ type: '友情', level: 3, progress: 0 })
    expect(await store.listHistory({ workId: DREAM.workId })).toEqual([])
  })
})
