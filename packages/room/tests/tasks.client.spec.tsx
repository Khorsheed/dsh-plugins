// @vitest-environment jsdom
/** The task page: list and filters, the detail (stop, follow-up tag, subtask tree, timeline) and the pure projections behind it. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { TasksView } from '../src/client/TasksView.tsx'
import { attentionCount, filterJobs, segmentsOf, subtaskTree } from '../src/client/tasks.ts'
import { zh } from '../src/client/locales.ts'
import type { RoomComposerProps } from '../src/client/slots.ts'
import type { RoomState } from '../src/types.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(zh) as unknown as RoomComposerProps['t']

const STATE: RoomState = {
  members: [
    { id: 'm-dsh', name: 'dsh', kind: 'main-agent', invitedBy: 'human' },
    { id: 'm-kimi', name: 'kimi', kind: 'cli', provider: 'kimi', invitedBy: 'human', childSessionId: 'child-k' as never },
    { id: 'm-claude', name: 'claude', kind: 'cli', provider: 'claude', invitedBy: 'human' },
  ],
  relays: [],
  tasks: [],
  runs: [],
  deliveries: [
    { id: '2:m-dsh', dispatchSeq: 2, memberId: 'm-dsh', status: 'done', origin: 'human', text: '让 kimi 实现登录接口，做完让 claude 审查', task: 'msg-1', queuedAt: 1000, startedAt: 1000, endedAt: 3000 },
    { id: '3:m-kimi', dispatchSeq: 3, memberId: 'm-kimi', status: 'done', origin: 'coordinator', text: '实现登录接口', task: 'msg-1', parent: '2:m-dsh', queuedAt: 2000, startedAt: 4000, endedAt: 20000 },
    { id: '4:m-dsh', dispatchSeq: 4, memberId: 'm-dsh', status: 'done', origin: 'report', text: '回报', task: 'msg-1', queuedAt: 20000, heldAt: 20000, releasedAt: 21000, startedAt: 21000, endedAt: 22000 },
    { id: '5:m-claude', dispatchSeq: 5, memberId: 'm-claude', status: 'running', origin: 'coordinator', text: '审查登录实现', task: 'msg-1', parent: '4:m-dsh', queuedAt: 22000, startedAt: 23000 },
    { id: '6:m-kimi', dispatchSeq: 6, memberId: 'm-kimi', status: 'running', origin: 'agent', text: '为边界写测试', task: 'msg-1', parent: '5:m-claude', queuedAt: 24000, startedAt: 24500 },
    { id: '8:m-kimi', dispatchSeq: 8, memberId: 'm-kimi', status: 'uncertain', origin: 'human', text: '翻日志找报错', task: 'msg-2', queuedAt: 30000, startedAt: 30100, endedAt: 31000 },
  ],
  jobs: [
    { id: 'msg-2', number: 2, title: '查一下线上报错', messages: [{ id: 'msg-2', time: 30000, text: '@kimi 查一下线上报错' }], status: 'attention', startedAt: 30000, deliveries: ['8:m-kimi'], members: ['m-kimi'] },
    { id: 'msg-1', number: 1, title: '让 kimi 实现登录接口，做完让 claude 审查', messages: [
      { id: 'msg-1', time: 1000, text: '让 kimi 实现登录接口，做完让 claude 审查' },
      { id: 'msg-3', time: 25000, text: '顺便把注册也测一下', by: 'model', probability: 0.86 },
    ], status: 'running', startedAt: 1000, deliveries: ['2:m-dsh', '3:m-kimi', '4:m-dsh', '5:m-claude', '6:m-kimi'], members: ['m-dsh', 'm-kimi', 'm-claude'] },
    { id: 'msg-0', number: 0, title: '旧任务', messages: [{ id: 'msg-0', time: 10, text: '旧任务' }], status: 'done', startedAt: 10, endedAt: 20, deliveries: [], members: [] },
  ],
}

describe('task projections', () => {
  it('filters: running includes tasks needing the human; attention counts uncertain outcomes and held relays', () => {
    expect(filterJobs(STATE, 'running').map(job => job.number)).toEqual([2, 1])
    expect(filterJobs(STATE, 'attention').map(job => job.number)).toEqual([2])
    expect(filterJobs(STATE, 'done').map(job => job.number)).toEqual([0])
    expect(attentionCount(STATE)).toBe(1)
    const relay = { id: 'r1', from: 'kimi', to: 'claude', content: 'x', state: 'pending' as const, intent: { task: 'msg-1' } as never }
    expect(attentionCount({ ...STATE, relays: [relay] })).toBe(2)
    expect(filterJobs({ ...STATE, relays: [relay] }, 'attention').map(job => job.number)).toEqual([2, 1])
  })

  it('the subtask tree nests each delivery under the round that sent it; reports are not nodes', () => {
    const tree = subtaskTree(STATE, STATE.jobs![1]!)
    expect(tree.map(node => node.delivery.id)).toEqual(['2:m-dsh', '5:m-claude'])
    expect(tree[0]!.children.map(node => node.delivery.id)).toEqual(['3:m-kimi'])
    expect(tree[1]!.children.map(node => node.delivery.id)).toEqual(['6:m-kimi'])
  })

  it('segments split queue, held and exec; open edges run to now', () => {
    const [, , report, review] = STATE.deliveries!
    expect(segmentsOf(report!, 50000)).toEqual([{ kind: 'held', from: 20000, to: 21000 }, { kind: 'exec', from: 21000, to: 22000 }])
    expect(segmentsOf(review!, 50000)).toEqual([{ kind: 'queue', from: 22000, to: 23000 }, { kind: 'exec', from: 23000, to: 50000 }])
  })
})

describe('TasksView', () => {
  it('lists tasks under the filters and opens a task\'s detail', () => {
    render(<TasksView state={STATE} t={t} />)
    const filters = screen.getByRole('group', { name: '任务' })
    expect(within(filters).getByRole('button', { name: '进行中2' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(filters).getByRole('button', { name: '需要处理1' })).toBeDefined()
    fireEvent.click(screen.getByText('让 kimi 实现登录接口，做完让 claude 审查'))
    expect(screen.getByText('任务 1 · 让 kimi 实现登录接口，做完让 claude 审查')).toBeDefined()
    expect(screen.getByText('决策模型归入 · 0.86')).toBeDefined()
    expect(screen.getByText('子任务')).toBeDefined()
    expect(screen.getByText('时间线')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '全部任务' }))
    expect(screen.getByRole('group', { name: '任务' })).toBeDefined()
  })

  it('stopping the whole task confirms in place, naming who will be stopped', async () => {
    const stopJob = vi.fn(async () => ({ ok: true as const }))
    render(<TasksView state={STATE} focus={{ task: 'msg-1', revision: 1 }} stopJob={stopJob} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '停止整个任务' }))
    const confirm = screen.getByRole('alertdialog')
    expect(confirm.textContent).toContain('claude、kimi')
    fireEvent.click(within(confirm).getByRole('button', { name: '停止' }))
    await vi.waitFor(() => expect(stopJob).toHaveBeenCalledWith('msg-1'))
  })

  it('追问 and ＋ 新任务 tag the main composer', () => {
    const compose = vi.fn()
    render(<TasksView state={STATE} compose={compose} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '＋ 新任务' }))
    expect(compose).toHaveBeenLastCalledWith({ task: 'new', label: '新任务' })
    fireEvent.click(screen.getByText('查一下线上报错'))
    fireEvent.click(screen.getByRole('button', { name: '追问这个任务' }))
    expect(compose).toHaveBeenLastCalledWith({ task: 'msg-2', label: '任务 2' })
  })

  it('a running subtask can be stopped on its own; a settled one opens its member session', () => {
    const stopDelivery = vi.fn()
    const openSession = vi.fn()
    render(<TasksView state={STATE} focus={{ task: 'msg-1', revision: 1 }} stopDelivery={stopDelivery} openSession={openSession} t={t} />)
    const review = document.querySelector('[data-delivery="5:m-claude"]') as HTMLElement
    fireEvent.click(within(review).getByRole('button', { name: '停止' }))
    expect(stopDelivery).toHaveBeenCalledWith('claude', '5:m-claude')
    const build = document.querySelector('[data-delivery="3:m-kimi"]') as HTMLElement
    fireEvent.click(within(build).getByRole('button', { name: '会话 →' }))
    expect(openSession).toHaveBeenCalledWith('child-k')
  })
})
