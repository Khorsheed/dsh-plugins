/**
 * The relation card (关系): the pure ladder arithmetic — banked points, the
 * stage moves, the type-change rules — then the engine round trips on the
 * 《梦境监护者》seed (赵启明 × 艾文, 同盟 · 合作, a full bar): writing a
 * card, the import's four relation rows, and adopting a pended level-up.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { NovelService } from '../src/store.ts'
import {
  readRelationStage, relationMove, relationProgress, relationStanding, typeChangeOf,
  type ExtractPayload, type RelationEntry,
} from '../src/types.ts'
import { type FakeCanvas, provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { CARD, DREAM, seedDreamKeeper } from './seed-dream.ts'

const SESSION = { id: 's-relation' } as unknown as Session

const points = (delta: number): RelationEntry => ({ relationId: 'r', chapter: 1, kind: 'points', delta, createdAt: '' })
const stage = (level?: number): RelationEntry => ({ relationId: 'r', chapter: 1, kind: 'stage', event: 'set', stage: '-', ...(level === undefined ? {} : { level }), createdAt: '' })

describe('the relation ladder (pure)', () => {
  it('banks points inside 0…3, and any stage event empties the bar', () => {
    expect(relationProgress([points(2), points(2)])).toBe(3)
    expect(relationProgress([points(-2), points(1)])).toBe(1)
    expect(relationProgress([points(2), points(1), stage(2), points(1)])).toBe(1)
  })

  it('reads a stage by name, by level number, or as a rift', () => {
    expect(readRelationStage('同盟', '合作')).toEqual({ level: 2 })
    expect(readRelationStage('爱情', 3)).toEqual({ level: 3 })
    expect(readRelationStage('爱情', '裂痕')).toEqual({ rift: '裂痕' })
    expect(readRelationStage('爱情', '合作')).toEqual({})
  })

  it('states where a pair stands: the bar, 可升 with the next stage, the top, or the rift', () => {
    expect(relationStanding({ type: '同盟', level: 2, progress: 1, ready: false })).toBe('1/3')
    expect(relationStanding({ type: '同盟', level: 2, progress: 3, ready: true })).toBe('可升 → 托底')
    expect(relationStanding({ type: '同盟', level: 4, progress: 3, ready: false })).toBe('已到顶')
    expect(relationStanding({ type: '同盟', level: 2, rift: '决裂', progress: 0, ready: false })).toBe('决裂')
  })

  it('友情→爱情 keeps the level; into or out of 对手 restarts, and into 对手 needs a rift first', () => {
    expect(typeChangeOf('友情', '爱情', undefined)).toBe('keep')
    expect(typeChangeOf('同盟', '对手', undefined)).toBe('needs-rift')
    expect(typeChangeOf('同盟', '对手', '决裂')).toBe('restart')
    expect(typeChangeOf('对手', '友情', undefined)).toBe('restart')
  })

  it('moves a pair: up one level, into a rift, back to the pre-rift level on a repair', () => {
    expect(relationMove({ type: '同盟', level: 2 }, 'up', undefined, [])).toEqual({ type: '同盟', stage: '托底', level: 3 })
    expect(relationMove({ type: '同盟', level: 4 }, 'up', undefined, [])).toBeUndefined()
    expect(relationMove({ type: '同盟', level: 2 }, 'crack', undefined, [])).toEqual({ type: '同盟', stage: '裂痕' })
    expect(relationMove({ type: '同盟', rift: '裂痕' }, 'up', undefined, [])).toBeUndefined()
    expect(relationMove({ type: '同盟', rift: '裂痕' }, 'fix', undefined, [stage(1), stage(3), stage()])).toEqual({ type: '同盟', stage: '托底', level: 3 })
    expect(relationMove({ type: '同盟', level: 2 }, 'fix', undefined, [])).toBeUndefined()
    expect(relationMove({ type: '友情', level: 3 }, 'type', '爱情', [])).toEqual({ type: '爱情', stage: '动情', level: 3 })
    expect(relationMove({ type: '同盟', level: 3 }, 'type', '对手', [])).toBeUndefined()
    expect(relationMove({ type: '同盟', rift: '决裂' }, 'type', '对手', [stage(3), stage()])).toMatchObject({ type: '对手', level: 1 })
  })
})

/** A store over the seed, with chapter 5 in the writing state. */
function seededStore(): { store: NovelService; canvas: FakeCanvas } {
  const fs = new FakeFs()
  seedDreamKeeper(fs, { ch5Phase: 'planning' })
  const ctx = new Context()
  ctx.provide('fs', fs as never)
  const canvas = provideCanvas(ctx)
  return { store: new NovelService(ctx, { stateRoot: DREAM.stateRoot }), canvas }
}

const EMPTY: ExtractPayload = { memories: [], foreshadow_mentions: [], new_foreshadows: [], new_characters: [], experiences: [], current_states: [], recap: '赵启明决定推门。' }

describe('relation cards in the engine', () => {
  it('reads the seed pair: 可升 off a full bar, and the derived 关系 line on both characters', async () => {
    const { store } = seededStore()
    const ledger = await store.ledger({ workId: DREAM.workId })
    expect(ledger.relations).toMatchObject([{ cardId: CARD.zhaoAiwen, type: '同盟', stage: '合作', level: 2, progress: 3, ready: true }])
    const brief = await store.gatherBrief({ workId: DREAM.workId })
    const zhao = brief.data!.roster.find(view => view.cardId === CARD.zhao)!
    expect(zhao.relations).toEqual(['艾文 · 同盟 · 合作 — 从戒备到勉强信任，二层梦脱险后升温'])
  })

  it('writes one card per pair: a second card for the pair is refused, a new one is named 甲 × 乙 and starts at the first stage', async () => {
    const { store, canvas } = seededStore()
    const written = await store.writeCard({ workId: DREAM.workId, role: 'relation', fields: { pair: ['赵启明', '艾文'], type: '友情' } }, SESSION)
    expect(written).toMatchObject({ ok: false, error: 'duplicate', cardId: CARD.zhaoAiwen })

    await store.writeCard({ workId: DREAM.workId, role: 'character', fields: { name: '林晚', identity: '档案室管理员' } }, SESSION)
    const fresh = await store.writeCard({ workId: DREAM.workId, role: 'relation', fields: { pair: ['赵启明', '林晚'], type: '友情', now: '点头之交' } }, SESSION)
    expect(fresh.ok).toBe(true)
    expect(canvas.card(DREAM.workId, fresh.cardId!)?.fields).toMatchObject({ name: '赵启明 × 林晚', type: '友情', stage: '结识' })
    expect((await store.listRelationJournal({ workId: DREAM.workId, relationId: fresh.cardId! })).map(entry => entry.kind === 'stage' && entry.event)).toEqual(['start'])
  })

  it('import: points land in the journal clamped to ±2; a milestone for a 可升 pair pends as a level-up; adopting it moves the card and empties the bar', async () => {
    const { store, canvas } = seededStore()
    const report = await store.extractImport({
      workId: DREAM.workId, n: 5, payload: {
        ...EMPTY,
        relation_points: [{ relation_id: 'r1', delta: 5, evidence_in_text: '但他第一次没有拦赵启明' }],
        relation_milestones: [{ relation_id: 'r1', evidence_in_text: '「门后冷。」他只是说，「握着叶子。」' }],
      },
    }, SESSION)
    expect(report.ok).toBe(true)
    const journal = await store.listRelationJournal({ workId: DREAM.workId, relationId: CARD.zhaoAiwen })
    expect(journal.at(-1)).toMatchObject({ kind: 'points', chapter: 5, delta: 2 })

    const pending = (await store.listPending({ workId: DREAM.workId })).filter(item => item.kind === 'relation')
    expect(pending).toHaveLength(1)
    expect(pending[0]!.reason).toContain('合作 → 托底')
    expect(await store.decidePending({ workId: DREAM.workId, id: pending[0]!.id, action: 'accept' }, SESSION)).toEqual({ ok: true })
    expect(canvas.card(DREAM.workId, CARD.zhaoAiwen)?.fields?.['stage']).toBe('托底')
    const [after] = (await store.ledger({ workId: DREAM.workId })).relations
    expect(after).toMatchObject({ level: 3, progress: 0, ready: false })
  })

  it('import: into 对手 without a rift is dropped, and a new pair naming someone off the roster is refused', async () => {
    const { store, canvas } = seededStore()
    const first = await store.extractImport({
      workId: DREAM.workId, n: 5, payload: {
        ...EMPTY,
        relation_points: [{ relation_id: 'r1', delta: -1, evidence_in_text: '但他第一次没有拦赵启明' }],
        relation_changes: [{ relation_id: 'r1', change: '转类型', to_type: '对手', evidence_in_text: '但他第一次没有拦赵启明' }],
        new_relations: [{ a: '赵启明', b: '哼歌的女人', type: '亲情', now: '只听过她的歌声', evidence_in_text: '门后传来一个女人的声音，哼着不成调的摇篮曲' }],
      },
    }, SESSION)
    expect(first.dropped).toContainEqual(expect.objectContaining({ kind: 'relation', reason: 'stage-mismatch' }))
    // The new pair names a character the roster does not hold — refused, not invented.
    expect(canvas.boards.get(DREAM.workId)!.cards.filter(card => card.kind === 'cat_relation')).toHaveLength(1)
  })
})
