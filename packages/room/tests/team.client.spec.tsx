// @vitest-environment jsdom
/** The team view: its projection from room state and the narrow tree. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { formatTokens, TEAM_ROOT, teamOf } from '../src/client/team.ts'
import { TeamView } from '../src/client/TeamView.tsx'
import { zh } from '../src/client/locales.ts'
import type { MembersViewProps } from '../src/client/slots.ts'
import type { RoomState } from '../src/types.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(zh) as unknown as MembersViewProps['t']

/** dsh coordinates; kimi takes three tasks from dsh; claude two from dsh; codex one from claude; kimi FYIs codex. */
const STATE: RoomState = {
  members: [
    { id: 'm-dsh', name: 'dsh', kind: 'main-agent', invitedBy: 'human' },
    { id: 'm-kimi', name: 'kimi', kind: 'cli', provider: 'kimi-cli', role: '实现', invitedBy: 'agent' },
    { id: 'm-claude', name: 'claude', kind: 'cli', provider: 'claude-code', role: '代码审查', invitedBy: 'agent', childSessionId: 'child-claude' as SessionId },
    { id: 'm-codex', name: 'codex', kind: 'cli', provider: 'codex-cli', role: '测试', invitedBy: 'agent' },
  ],
  relays: [],
  tasks: [{ id: 't9', member: 'claude', title: '复审修复', status: 'in_progress', deliveryId: '9:m-claude', updatedAt: 1 }],
  runs: [{ member: 'claude', state: 'running', startedAt: 1, runId: '9:m-claude' }],
  executions: [
    { id: '1:m-kimi', memberId: 'm-kimi', member: 'kimi', state: 'done', startedAt: 1, elapsedMs: 600_000, tokens: 400_000, model: 'k3' },
    { id: '6:m-kimi', memberId: 'm-kimi', member: 'kimi', state: 'done', startedAt: 2, elapsedMs: 300_000, tokens: 240_000 },
    { id: '9:m-claude', memberId: 'm-claude', member: 'claude', state: 'running', startedAt: 3 },
  ],
  deliveries: [
    { id: '0:m-dsh', dispatchSeq: 0, memberId: 'm-dsh', status: 'done', origin: 'human', text: '做登录功能' },
    { id: '1:m-kimi', dispatchSeq: 1, memberId: 'm-kimi', status: 'done', origin: 'coordinator', from: 'm-dsh', kind: 'task', replyTo: 'm-dsh', text: '实现登录' },
    { id: '2:m-claude', dispatchSeq: 2, memberId: 'm-claude', status: 'done', origin: 'coordinator', from: 'm-dsh', kind: 'task', replyTo: 'm-dsh', text: '审查' },
    { id: '3:m-codex', dispatchSeq: 3, memberId: 'm-codex', status: 'done', origin: 'member', from: 'm-claude', kind: 'task', replyTo: 'm-claude', text: '补测试' },
    { id: '4:m-codex', dispatchSeq: 4, memberId: 'm-codex', status: 'done', origin: 'member', from: 'm-kimi', kind: 'notify', text: '路径改了' },
    { id: '5:m-claude', dispatchSeq: 5, memberId: 'm-claude', status: 'done', origin: 'report', text: '6 个用例通过' },
    { id: '6:m-kimi', dispatchSeq: 6, memberId: 'm-kimi', status: 'done', origin: 'coordinator', from: 'm-dsh', kind: 'task', replyTo: 'm-dsh', text: '按意见修' },
    { id: '8:m-kimi', dispatchSeq: 8, memberId: 'm-kimi', status: 'queued', origin: 'coordinator', from: 'm-dsh', kind: 'task', replyTo: 'm-dsh', text: '补迁移' },
    { id: '9:m-claude', dispatchSeq: 9, memberId: 'm-claude', status: 'running', origin: 'coordinator', from: 'm-dsh', kind: 'task', replyTo: 'm-dsh', text: '复审修复' },
  ],
}

describe('teamOf', () => {
  it('places each member under whoever tasked it most, coordinator under the human', () => {
    const team = teamOf(STATE)
    expect(team.nodes.map(node => [node.member.name, node.parent])).toEqual([
      ['dsh', TEAM_ROOT], ['kimi', 'm-dsh'], ['claude', 'm-dsh'], ['codex', 'm-claude'],
    ])
  })

  it('counts tasks, returned reports and FYIs per edge', () => {
    const team = teamOf(STATE)
    expect(team.edges.find(edge => edge.from === 'm-dsh' && edge.to === 'm-kimi')).toMatchObject({ tasks: 3, reports: 2, notifies: 0 })
    expect(team.edges.find(edge => edge.from === 'm-claude' && edge.to === 'm-codex')).toMatchObject({ tasks: 1, reports: 1 })
    expect(team.edges.find(edge => edge.from === 'm-kimi' && edge.to === 'm-codex')).toMatchObject({ tasks: 0, notifies: 1 })
  })

  it('sums each member\'s rounds, time and tokens, and reads the running task', () => {
    const team = teamOf(STATE)
    const kimi = team.nodes.find(node => node.member.name === 'kimi')!
    expect(kimi).toMatchObject({ tokens: 640_000, elapsedMs: 900_000, rounds: 2, model: 'k3', status: 'idle' })
    expect(kimi.deliveries.map(row => row.seq)).toEqual([8, 6, 1])
    expect(team.nodes.find(node => node.member.name === 'claude')).toMatchObject({ status: 'running', current: '复审修复' })
    expect(team.totals).toMatchObject({ members: 4, running: 1, deliveries: 8, tokens: 640_000 })
  })

  it('a member nobody tasked yet hangs under the coordinator', () => {
    const team = teamOf({ ...STATE, members: [...STATE.members, { id: 'm-new', name: 'new', kind: 'cli', provider: 'kimi-cli', invitedBy: 'human' }] })
    expect(team.nodes.at(-1)).toMatchObject({ member: { name: 'new' }, parent: 'm-dsh' })
  })

  it('formats token counts compactly', () => {
    expect([formatTokens(512), formatTokens(288_000), formatTokens(1_540_000), formatTokens(12_000_000)]).toEqual(['512', '288k', '1.5M', '12M'])
  })
})

describe('TeamView (narrow)', () => {
  it('renders the tree, expands a node into its deliveries, and opens the member session', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const openSession = vi.fn()
    render(<TeamView state={STATE} openSession={openSession} t={t} />)
    screen.getByText('派活 3 · 回报 2')
    screen.getByText('▶ 复审修复')
    screen.getByText('kimi 知会 1')
    fireEvent.click(screen.getByText('claude').closest('button')!)
    screen.getByText('复审修复', { selector: 'span[title]' })
    fireEvent.click(screen.getByRole('button', { name: '打开它的会话 →' }))
    expect(openSession).toHaveBeenCalledWith('child-claude')
    vi.unstubAllGlobals()
  })

  it('a focus param selects and expands that member', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { fn(); return 0 })
    Element.prototype.scrollIntoView = vi.fn()
    render(<TeamView state={STATE} focus={{ member: 'codex', revision: 1 }} openSession={() => {}} t={t} />)
    screen.getByText('补测试')
    vi.unstubAllGlobals()
  })
})
