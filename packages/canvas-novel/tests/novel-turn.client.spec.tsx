// @vitest-environment jsdom
/**
 * The Turn-tail cards: the plans and outline proposals a Turn registered are
 * folded into Turn data from the session events, and rendered beneath the
 * closing prose where the folded tool rows cannot hide them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
      chapterPage="novel:chapter"
      planPage="novel:plan"
      t={t}
    />)
    expect(screen.getByText('光')).toBeTruthy()
    expect(screen.getByText('走向 4 拍')).toBeTruthy()
    expect(openPage).not.toHaveBeenCalled()
  })

  it('renders nothing for a Turn that asked nothing', () => {
    const { container } = render(<NovelTurnTail turn={{ data: { get: () => undefined } }} remote={() => undefined} openPage={() => undefined} chapterPage="novel:chapter" planPage="novel:plan" t={t} />)
    expect(container.innerHTML).toBe('')
  })
})
