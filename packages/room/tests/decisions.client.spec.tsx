// @vitest-environment jsdom
/** The room decision row: one dim line per decision; 查看判断 only for a decision that called the model. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { roomDecisionDefinition } from '../src/client/nodes.ts'
import { decisionLine, RoomDecisionView } from '../src/client/RoomDecisionView.tsx'
import { zh } from '../src/client/locales.ts'
import type { RoomDecisionViewProps } from '../src/client/slots.ts'
import type { RoomDecisionEvent } from '../src/types.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(zh) as unknown as RoomDecisionViewProps['t']
const call = { model: 'jev-latest', latencyMs: 1200, request: { state: {}, questions: [] } }

describe('room-decision', () => {
  it('reads each scenario and rule as one sentence', () => {
    const line = (decision: Omit<RoomDecisionEvent, 'id'>) => decisionLine({ id: 'd', ...decision }, t)
    expect(line({ scenario: 'task-filing', outcome: '3', probability: 0.82, call, about: { task: { number: 3, title: '修导出报错' } } })).toBe('合并到任务 3 · 修导出报错')
    expect(line({ scenario: 'task-filing', outcome: 'new', probability: 0.7, call, about: {} })).toBe('判断为新任务')
    expect(line({ scenario: 'report-timing', outcome: 'later', probability: 0.31, call, about: { from: '剪刀手', to: 'dsh' } })).toBe('剪刀手 的结果稍后统一汇报给 dsh')
    expect(line({ scenario: 'report-timing', outcome: 'now', rule: 'last', about: { from: 'bill', to: 'dsh' } })).toBe('bill 的结果立即汇报给 dsh（最后一个结果）')
    expect(line({ scenario: 'report-timing', outcome: 'now', rule: 'unavailable', call: { ...call, failure: { reason: 'timeout' } }, about: { from: 'bill', to: 'dsh' } }))
      .toBe('决策模型没有给出判断，bill 的结果立即汇报给 dsh')
  })

  it('a model decision offers 查看判断 with its probability and latency; a rule decision does not', () => {
    const event = { seq: 9, time: 1009, type: 'room/decision', data: { id: 'd1', scenario: 'report-timing', outcome: 'later', probability: 0.31, call, about: { from: '剪刀手', to: 'dsh' } } } as never
    expect(roomDecisionDefinition.match(event)).toEqual({ id: 'd1', role: 'start' })
    const data = roomDecisionDefinition.start({} as never, { event, role: 'start' } as never, undefined as never)
    const openDecision = vi.fn()
    const { rerender } = render(<RoomDecisionView {...{ node: { data }, openDecision, t } as unknown as RoomDecisionViewProps} />)
    expect(screen.getByText('0.31 · 1.2s')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '查看判断' }))
    expect(openDecision).toHaveBeenCalledWith('d1')
    rerender(<RoomDecisionView {...{ node: { data: { ...data, decision: { id: 'd2', scenario: 'report-timing', outcome: 'now', rule: 'last', about: { from: 'bill', to: 'dsh' } } } }, openDecision, t } as unknown as RoomDecisionViewProps} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
