// @vitest-environment jsdom
/**
 * The Turn-tail cards: the plans and outline proposals a Turn registered are
 * folded into Turn data from the session events, and rendered beneath the
 * closing prose where the folded tool rows cannot hide them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { NovelRemote, NovelSurfaceProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { asksInTurn, novelTurnDefinition, NOVEL_TURN_KEY } from '../src/client/novel-turn.ts'
import { NovelTurnTail } from '../src/client/WriteToolRow.tsx'

afterEach(cleanup)

const t = ((key: keyof typeof zh, params?: Record<string, string | number>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match))) as NovelSurfaceProps['t']

const CANVAS = 'canvas_novel0001'
const call = (callId: string, name: string, seq: number) => ({ type: 'tool/call', seq, data: { turn: 3, callId, name, arguments: '{}' } })
const result = (callId: string, text: string, seq: number) => ({
  type: 'tool/result', seq, surfaceOp: 'append',
  data: { turn: 3, message: { role: 'tool', source: { kind: 'tool', callId }, content: [{ type: 'text', text }], isError: false } },
})

/** Fold events through the definition the way ui-conversation would. */
function fold(events: Array<Record<string, unknown>>) {
  let state = novelTurnDefinition.start(undefined, { event: { type: 'turn/start', data: { turn: 3 } } })
  for (const event of events) {
    if (novelTurnDefinition.match(event as never) !== null) state = novelTurnDefinition.update({ state }, { event: event as never })
  }
  return novelTurnDefinition.buildLocationData({ state }, 'turn', null)!
}

describe('novel turn asks', () => {
  it('keeps a Turn\'s plans and outline proposals, once each, latest answer winning', () => {
    const data = fold([
      call('a', 'novel_write', 10),
      result('a', `已登记第 2 章《光》（画布 ${CANVAS}）plan：走向 4 拍 / 伏笔 0 条 / 出场 3 人。`, 11),
      call('b', 'canvas_write', 12),
      result('b', '已落卡 [w1]。', 13),
      call('c', 'novel_write', 14),
      result('c', `已提交大纲提议（画布 ${CANVAS}），在「规划」页等用户采用。`, 15),
      call('d', 'novel_write', 16),
      result('d', `已登记第 2 章《临摹不出来的光》（画布 ${CANVAS}）plan：走向 5 拍 / 伏笔 0 条 / 出场 3 人。`, 17),
      call('e', 'novel_write', 18),
      result('e', '失败：没有第 9 章。', 19),
    ])
    expect(data.key).toBe(NOVEL_TURN_KEY)
    expect(data.value.asks.map(ask => ask.key)).toEqual([`chapter:${CANVAS}:2`, `outline:${CANVAS}`])
    expect(data.value.asks[0]!.row.chapter?.title).toBe('临摹不出来的光')
    const owner = { turn: { data: { get: (key: string) => key === NOVEL_TURN_KEY ? data.value : undefined }, end: { seq: 20 } } }
    expect(asksInTurn(owner)).toHaveLength(2)
  })

  it('renders the cards in the Turn tail, opening nothing by itself', async () => {
    const data = fold([call('a', 'novel_write', 10), result('a', `已登记第 2 章《光》（画布 ${CANVAS}）plan：走向 4 拍 / 伏笔 0 条 / 出场 3 人。`, 11)])
    const remote = { chapter: vi.fn(() => new Promise(() => {})) } as unknown as NovelRemote
    const openPage = vi.fn()
    render(<NovelTurnTail
      turn={{ data: { get: () => data.value }, end: { seq: 20 } }}
      remote={() => remote}
      openPage={() => openPage}
      openFace={() => undefined}
      chapterPage="novel:chapter"
      planPage="novel:plan"
      recentScope="recent"
      t={t}
    />)
    expect(screen.getByText('光')).toBeTruthy()
    expect(screen.getByText('情节 4 段')).toBeTruthy()
    expect(openPage).not.toHaveBeenCalled()
  })

  it('a written text gets its own card: length, first lines, 读正文', async () => {
    const data = fold([
      call('a', 'novel_write', 10),
      result('a', `已写入第 3 章《温老师》正文（画布 ${CANVAS} · 3120 字）。\n正文在右栏章节页能读。`, 11),
    ])
    expect(data.value.asks.map(ask => ask.key)).toEqual([`body:${CANVAS}:3`])
    const remote = {
      chapter: vi.fn(async () => ({ ok: true, value: { ok: true, phase: 'writing', pending: 0, names: {}, targetWords: 3000, body: '# 第3章\n闹钟响的时候，江眠先看手机。\n录像停在四点十一分。', chapter: {
        n: 3, seq: 3, title: '温老师', file: '第3章.md', phase: 'planning', sessionIds: [], createdAt: '', updatedAt: '',
      } } })),
    } as unknown as NovelRemote
    const openPage = vi.fn()
    render(<NovelTurnTail turn={{ data: { get: () => data.value }, end: { seq: 20 } }} remote={() => remote} openPage={() => openPage} openFace={() => undefined} chapterPage="novel:chapter" planPage="novel:plan" recentScope="recent" t={t} />)
    expect(screen.getByText('第 3 章 · 正文')).toBeTruthy()
    expect(await screen.findByText('闹钟响的时候，江眠先看手机。录像停在四点十一分。')).toBeTruthy()
    expect(screen.getByText(zh['card.bodyWritten'])).toBeTruthy()
    expect(screen.getByText('目标 3,000 字')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `${zh['card.read']} →` }))
    expect(openPage).toHaveBeenCalledWith(CANVAS, 'novel:chapter', expect.any(String), '3')
  })

  it('a reconciled chapter says what landed and opens 设定 · 最近更新', async () => {
    const data = fold([
      call('p', 'novel_extract', 10),
      result('p', '你是长篇小说的记忆对账员。输入是第3章正文', 11),
      call('i', 'novel_extract', 12),
      result('i', `第 3 章已对账（画布 ${CANVAS}）。\n计划命中 ✓×1 / 计划落空 ×1 / 新卡 ×2 / 改了已有卡 ×1`, 13),
    ])
    expect(data.value.asks.map(ask => ask.key)).toEqual([`extract:${CANVAS}:3`])
    const plan = { summary: '', beats: [{ text: 'a' }, { text: 'b' }], foreshadowOps: [{ op: '推进', id: 'f1' }, { op: '暗示', id: 'f2' }], cast: [] }
    const remote = {
      chapter: vi.fn(async () => ({ ok: true, value: { ok: true, phase: 'extracted', pending: 0, names: {}, chapter: {
        n: 3, seq: 3, title: '回声', file: '第3章.md', phase: 'extracted', sessionIds: [], createdAt: '', updatedAt: '',
        plan, delivery: { beats: [true, true], ops: [true, false] },
      } } })),
    } as unknown as NovelRemote
    const openFace = vi.fn()
    render(<NovelTurnTail turn={{ data: { get: () => data.value }, end: { seq: 20 } }} remote={() => remote} openPage={() => vi.fn()} openFace={() => openFace} chapterPage="novel:chapter" planPage="novel:plan" recentScope="recent" t={t} />)
    expect(screen.getByText('第 3 章已对账')).toBeTruthy()
    expect(screen.getByText(zh['card.written'])).toBeTruthy()
    expect(await screen.findByText('情节 2/2 · 伏笔 1/2')).toBeTruthy()
    expect(screen.getByText('新建 2')).toBeTruthy()
    expect(screen.getByText('改了已有卡 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `${zh['card.recent']} →` }))
    expect(openFace).toHaveBeenCalledWith(CANVAS, 'board', 'recent')
  })

  it('renders nothing for a Turn that asked nothing', () => {
    const { container } = render(<NovelTurnTail turn={{ data: { get: () => undefined } }} remote={() => undefined} openPage={() => undefined} openFace={() => undefined} chapterPage="novel:chapter" planPage="novel:plan" recentScope="recent" t={t} />)
    expect(container.innerHTML).toBe('')
  })
})
