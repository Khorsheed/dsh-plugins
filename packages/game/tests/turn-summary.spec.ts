/**
 * The turn summary is data only: one plain line per change, each with the
 * place in the game tab where it is seen (the shell draws the card).
 */
import { describe, expect, it } from 'vitest'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { zh } from '../src/client/locales.ts'
import { turnSummaryOf } from '../src/client/turn-summary.ts'
import type { TurnReport } from '../src/types.ts'

const t = ((key: keyof typeof zh, params?: Record<string, string | number>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match))) as unknown as PropsLocale<'game'>['t']

const report: TurnReport = {
  turn: 3, projectId: 'g_1', title: '灯塔', at: '2026-11-01T00:00:00Z',
  version: { kind: 'deployed', version: 2 },
  check: { ok: true, fixes: 1, gaveUp: false, passed: 4, failures: 0 },
  elements: [
    { id: 'e1', name: '九尾狐', what: 'look', looks: { before: null, after: '{}' } },
    { id: 'e2', name: '雪狼', what: 'fields', fields: ['速度'] },
    { id: 'e3', name: '旧门', what: 'removed' },
  ],
  chapters: [{ id: 'ch2', title: '第 2 关' }],
  params: [{ label: '重力', from: '1', to: '0.8' }],
  code: ['a.js', 'b.js', 'c.js', 'd.js'],
  tests: ['t.js'],
} as unknown as TurnReport

describe('turnSummaryOf', () => {
  it('one line per change, each with its place in the game tab', () => {
    const summary = turnSummaryOf(report, t)
    expect(summary.title).toBe('本轮改动 · 灯塔')
    expect(summary.rows.map(row => [row.label, row.destination?.params])).toEqual([
      ['v2 已上线 · 检查通过，4 个用例 · 自动修复 1 次', { projectId: 'g_1', view: 'play' }],
      ['「九尾狐」换了外观', { projectId: 'g_1', view: 'elements', elementId: 'e1' }],
      ['「雪狼」改了 速度', { projectId: 'g_1', view: 'elements', elementId: 'e2' }],
      ['删除了元素 旧门', { projectId: 'g_1', view: 'elements' }],
      ['策划《第 2 关》有更新', { projectId: 'g_1', view: 'design', chapterId: 'ch2' }],
      ['参数：重力 1→0.8', { projectId: 'g_1', view: 'play' }],
      ['改了 4 个代码/资源文件 · a.js、b.js、c.js…', { projectId: 'g_1', view: 'versions' }],
      ['改了 1 个测试', { projectId: 'g_1', view: 'versions' }],
    ])
    expect(summary.rows.every(row => row.destination?.kind === 'game')).toBe(true)
    expect(new Set(summary.rows.map(row => row.destination?.id)).size).toBe(summary.rows.length)
  })

  it('the version line lands where the version changed — a re-modelled character, not play', () => {
    const rows = turnSummaryOf({
      ...report, elements: [], chapters: [], params: [], code: [], tests: [], check: null,
      version: { kind: 'deployed', version: 35, place: { view: 'elements', elementId: 'xingzhe' }, names: ['行者'] },
    }, t).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]!.label).toBe('v35 已上线 · 改了行者')
    expect(rows[0]!.destination?.params).toEqual({ projectId: report.projectId, view: 'elements', elementId: 'xingzhe' })
  })

  it('a turn that changed nothing has no lines', () => {
    expect(turnSummaryOf({ ...report, version: null, check: null, elements: [], chapters: [], params: [], code: [], tests: [] }, t).rows).toEqual([])
  })
})
