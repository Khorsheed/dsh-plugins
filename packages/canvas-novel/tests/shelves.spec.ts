/**
 * The 世界观 shelves (novel@5, 2026-11-01): settings filed on 体系 / 地点 /
 * 势力 / 物种与道具, tied together by parent / base / faction / home links
 * that read back both ways, and 整理设定 moving an old 世界 board onto the
 * shelves — proposed first, applied only after the person spoke.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { novelGenreAgent } from '../src/genre-agent.ts'
import { NovelService } from '../src/store.ts'
import { categoryIdOf, provideCanvas } from './fake-canvas.ts'
import { FakeFs } from './fake-fs.ts'
import { CARD, DREAM, seedDreamKeeper } from './seed-dream.ts'

/** A session whose history the apply guard reads: the last user message's seq is `seq.value`. */
function sessionAt(seq: { value: number }): Session {
  return { id: 's-shelves', snapshotEvents: () => [{ type: 'user/message', seq: seq.value }] } as unknown as Session
}

function bench(shelves: boolean) {
  const fs = new FakeFs()
  seedDreamKeeper(fs)
  const ctx = new Context()
  ctx.provide('fs', fs as never)
  const canvas = provideCanvas(ctx)
  if (shelves) canvas.addShelves(DREAM.workId)
  const store = new NovelService(ctx, { stateRoot: DREAM.stateRoot })
  ctx.provide('canvasNovel', store as never)
  return { ctx, store, canvas, agent: novelGenreAgent(store) }
}

describe('settings on the 世界观 shelves', () => {
  it('files a setting by its shelf, resolves its links by name, and reads them back both ways', async () => {
    const { store, canvas, agent } = bench(true)
    const seq = { value: 1 }
    const session = sessionAt(seq)
    expect(await agent.writeCard({ canvasId: DREAM.workId, kind: '地点', fields: { name: '山海梦域', rule: '神话梦域' } }, session)).toContain('地点')
    const town = await agent.writeCard({ canvasId: DREAM.workId, kind: '地点', fields: { name: '山脚小镇', rule: '面包很香', parent: '山海梦域' } }, session)
    expect(town).toMatch(/已落卡 \[w\d+\]（地点/)
    await agent.writeCard({ canvasId: DREAM.workId, kind: '势力', fields: { name: '睡眠公司', rule: '运营方', base: ['山脚小镇'] } }, session)
    const missing = await agent.writeCard({ canvasId: DREAM.workId, kind: '物种与道具', fields: { name: '祝余', rule: '做面包', parent: '不存在的地方' } }, session)
    expect(missing).toContain('parent 对不上画布上的设定卡')
    expect(await agent.writeCard({ canvasId: DREAM.workId, cardId: CARD.zhao, fields: { faction: '睡眠公司', home: '山脚小镇' } }, session)).toContain('已更新')

    const entries = (await store.readEntries(DREAM.workId))!
    const shan = entries.rules.find(view => view.name === '山海梦域')!
    const townView = entries.rules.find(view => view.name === '山脚小镇')!
    expect(shan.sort).toBe('place')
    expect(townView.parents).toEqual([shan.cardId])
    expect(canvas.card(DREAM.workId, townView.cardId)?.kind).toBe(categoryIdOf('place'))
    expect(canvas.card(DREAM.workId, townView.cardId)?.fields?.['kind']).toBeUndefined()

    const lines = await agent.cardLines({ canvasId: DREAM.workId, kind: '地点', includeArchived: false }, session)
    expect(lines.some(line => line.includes('地点 山脚小镇（地点）：面包很香（属于 山海梦域）'))).toBe(true)
    const detail = await agent.cardDetail({ canvasId: DREAM.workId, cardId: townView.cardId }, session)
    expect(detail).toContain('属于：')
    expect(detail).toContain('以此为据点：')
    expect(detail).toContain('相关人物：赵启明')
    const up = await agent.cardDetail({ canvasId: DREAM.workId, cardId: shan.cardId }, session)
    expect(up).toContain('下属：')
    expect(await agent.cardDetail({ canvasId: DREAM.workId, cardId: CARD.zhao }, session)).toContain('所属势力：')
  })
})

describe('整理设定: an old 世界 board onto the shelves', () => {
  it('previews by 类型 plus the agent\'s moves, refuses to apply before the person spoke, then moves everything', async () => {
    const { store, canvas } = bench(false)
    canvas.catchUpOnWrite.add(DREAM.workId)
    const seq = { value: 4 }
    const session = sessionAt(seq)
    const preview = await store.organizePreview({
      workId: DREAM.workId,
      moves: [
        { card: 'w1', to: '体系', parent: '梦境规则' },
        { card: CARD.openEnding, to: '写作原则' },
      ],
      create: [{ to: '体系', name: '梦境规则', rule: '监护者在梦里要守的规矩' }],
    }, session)
    expect(preview.ok).toBe(true)
    expect(preview.text).toContain('## 体系')
    expect(preview.text).toContain('新建「梦境规则」')
    expect(preview.text).toContain('属于 梦境规则（新建）')
    expect(canvas.card(DREAM.workId, CARD.trueName)?.kind).toBe(categoryIdOf('world'))

    expect((await store.organizeApply({ workId: DREAM.workId }, session)).error).toBe('plan-unseen')
    seq.value = 5
    const applied = await store.organizeApply({ workId: DREAM.workId }, session)
    expect(applied).toMatchObject({ ok: true, created: 1 })
    expect(applied.moved).toBeGreaterThanOrEqual(2)
    const moved = canvas.card(DREAM.workId, CARD.trueName)!
    expect(moved.kind).toBe(categoryIdOf('system'))
    expect(moved.fields?.['rule']).toContain('真名是锚')
    const parentId = (moved.fields?.['parent'] as string[])[0]!
    expect(canvas.card(DREAM.workId, parentId)?.fields?.['name']).toBe('梦境规则')
    expect(canvas.card(DREAM.workId, CARD.leafCarrier)?.kind).toBe(categoryIdOf('system'))
    // The 原则 stays where it was: 写作原则 is its shelf already.
    expect(canvas.card(DREAM.workId, CARD.openEnding)?.kind).toBe(categoryIdOf('principle'))
    expect((await store.organizeApply({ workId: DREAM.workId }, session)).error).toBe('no-proposal')
    const entries = (await store.readEntries(DREAM.workId))!
    expect(entries.rules.find(view => view.cardId === CARD.trueName)?.sort).toBe('system')
  })

  it('names what it cannot resolve instead of guessing', async () => {
    const { store } = bench(false)
    const outcome = await store.organizePreview({ workId: DREAM.workId, moves: [{ card: '没有这张', to: '地点' }] }, sessionAt({ value: 1 }))
    expect(outcome).toMatchObject({ ok: false, unknown: ['没有这张'] })
  })
})

describe('the card page reads a setting\'s links both ways', () => {
  it('answers 属于 / 下属 / 以此为据点 / 相关人物 for a place, 所属势力 / 常在地点 for a character', async () => {
    const { ctx, store, agent } = bench(true)
    const session = sessionAt({ value: 1 })
    await agent.writeCard({ canvasId: DREAM.workId, kind: '地点', fields: { name: '山海梦域', rule: '神话梦域' } }, session)
    await agent.writeCard({ canvasId: DREAM.workId, kind: '地点', fields: { name: '山脚小镇', rule: '面包很香', parent: '山海梦域' } }, session)
    await agent.writeCard({ canvasId: DREAM.workId, kind: '势力', fields: { name: '睡眠公司', rule: '运营方', base: '山脚小镇' } }, session)
    await agent.writeCard({ canvasId: DREAM.workId, cardId: CARD.zhao, fields: { faction: '睡眠公司', home: '山脚小镇' } }, session)
    const { NovelRemoteService } = await import('../src/remote.ts')
    const remote = new NovelRemoteService(ctx)
    const entries = (await store.readEntries(DREAM.workId))!
    const town = entries.rules.find(view => view.name === '山脚小镇')!.cardId
    const read = await remote.card({ canvasId: DREAM.workId, cardId: town })
    const kinds = Object.fromEntries((read.links ?? []).map(group => [group.kind, group.items.map(item => item.name)]))
    expect(kinds).toMatchObject({ parent: ['山海梦域'], based: ['睡眠公司'], people: ['赵启明'] })
    const zhao = await remote.card({ canvasId: DREAM.workId, cardId: CARD.zhao })
    expect(Object.fromEntries((zhao.links ?? []).map(group => [group.kind, group.items.map(item => item.name)]))).toEqual({ faction: ['睡眠公司'], home: ['山脚小镇'] })
  })
})

describe('the 总览 world map', () => {
  it('nests a place under the place it belongs to, flags 待定, and counts old 世界 cards left to organize', async () => {
    const { ctx, agent } = bench(true)
    const session = sessionAt({ value: 1 })
    await agent.writeCard({ canvasId: DREAM.workId, kind: '地点', fields: { name: '山海梦域', rule: '神话梦域' } }, session)
    await agent.writeCard({ canvasId: DREAM.workId, kind: '地点', fields: { name: '山脚小镇', rule: '状态：暂定', parent: '山海梦域' } }, session)
    const { NovelRemoteService } = await import('../src/remote.ts')
    const map = await new NovelRemoteService(ctx).worldMap({ canvasId: DREAM.workId })
    const place = map.shelves?.find(shelf => shelf.sort === 'place')
    expect(place?.count).toBe(2)
    expect(place?.nodes.map(node => node.name)).toEqual(['山海梦域'])
    expect(place?.nodes[0]?.children[0]).toMatchObject({ name: '山脚小镇', unsettled: true })
    // The seed's old 世界 cards are still in the 世界 category.
    expect(map.unorganized).toBeGreaterThan(0)
    expect(map.principles?.length).toBeGreaterThan(0)
  })
})
