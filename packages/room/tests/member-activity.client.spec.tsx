// @vitest-environment jsdom
/**
 * Members' background activity (member-self-started-rounds M2): the pure
 * state, the composer capsule and tray, the members page line, the member
 * session's command card, the shared polling store — one case per state,
 * including an unsupported harness that renders nothing.
 */
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { LocalAgentBackgroundTask, LocalAgentBackgroundTasks } from '@khorsheed/dsh-local-agent/types'
import {
  activityAction, activityElapsed, activityGroups, activityStrip, dispatcherOf, durationParts, memberActivityLine, sessionActivityItems,
} from '../src/client/member-activity-view.ts'
import {
  ActivityCapsule, ActivityReveals, ActivityTray, CommandCard, MemberActivityLine, MemberActivityStore,
} from '../src/client/MemberActivity.tsx'
import { activityCallsDefinition, MemberActivityTail, turnActivityCalls } from '../src/client/MemberActivityTail.tsx'
import { RoomTaskCapsule } from '../src/client/RoomTaskCapsule.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { RoomMember, RoomState } from '../src/types.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })

const t = makeTranslate(zh) as never
const MIN = 60_000
const NOW = new Date(2026, 10, 6, 22, 50).getTime()

const canvas: RoomMember = { id: 'm-canvas', name: 'kimi-canvas', kind: 'cli', provider: 'kimi-cli', invitedBy: 'human', childSessionId: 'child-canvas' as never }
const modeler: RoomMember = { id: 'm-model', name: '人物建模大师', kind: 'cli', provider: 'kimi-cli', invitedBy: 'human', childSessionId: 'child-model' as never }
const voice: RoomMember = { id: 'm-voice', name: '配音员', kind: 'cli', provider: 'codex', invitedBy: 'human', childSessionId: 'child-voice' as never }
const lead: RoomMember = { id: 'm-lead', name: '人物协调', kind: 'main-agent', invitedBy: 'human' }

const task = (id: string, patch: Partial<LocalAgentBackgroundTask> = {}): LocalAgentBackgroundTask => ({
  id, label: '构建并测试 canvas-novel', kind: 'shell', command: 'pnpm run build && pnpm run test', startedAt: NOW - 12 * MIN, state: 'running', callId: `call-${id}`, ...patch,
})
const supported = (tasks: LocalAgentBackgroundTask[], patch: Partial<LocalAgentBackgroundTasks> = {}): LocalAgentBackgroundTasks => ({ supported: true, tasks, processAlive: true, ...patch })
const UNSUPPORTED: LocalAgentBackgroundTasks = { supported: false, tasks: [], processAlive: false }

/** A room where the coordinator's delivery #d1 started execution exec-1, and the human's #d2 started exec-2. */
const room: RoomState = {
  members: [lead, canvas, modeler, voice],
  relays: [],
  tasks: [],
  runs: [],
  deliveries: [
    { id: 'd1', dispatchSeq: 1, memberId: 'm-canvas', status: 'done', origin: 'coordinator', from: 'm-lead', text: 'build', queuedAt: 1 },
    { id: 'd2', dispatchSeq: 2, memberId: 'm-model', status: 'done', origin: 'human', text: 'export', queuedAt: 2 },
  ],
  executions: [
    { id: 'd1', runId: 'd1', member: 'kimi-canvas', state: 'done', startedAt: NOW - 13 * MIN, executionId: 'exec-1' },
    { id: 'd2', runId: 'd2', member: '人物建模大师', state: 'done', startedAt: NOW - 30 * MIN, executionId: 'exec-2' },
    { id: 'self-1', runId: 'self-1', member: '人物建模大师', state: 'done', startedAt: new Date(2026, 10, 6, 22, 41).getTime(), executionId: 'exec-self' },
  ],
} as never

describe('member-activity-view (the pure state)', () => {
  it('maps the CLI states onto the five shared statuses', () => {
    const groups = activityGroups([{ member: canvas, read: supported([
      task('a'), task('b', { state: 'completed', endedAt: NOW }), task('c', { state: 'failed', exitCode: 2, endedAt: NOW }),
      task('d', { state: 'timed-out', endedAt: NOW }), task('e', { state: 'stopped', endedAt: NOW }), task('f', { state: 'lost' }),
    ]) }])
    expect(groups[0]!.items.map(item => [item.id, item.status, item.timedOut ?? false])).toEqual([
      ['a', 'running', false], ['b', 'done', false], ['c', 'failed', false], ['d', 'failed', true], ['e', 'cancelled', false], ['f', 'lost', false],
    ])
  })

  it('unsupported, not a member, or unread: no group, no capsule, no line', () => {
    for (const read of [UNSUPPORTED, null, undefined]) {
      expect(activityGroups([{ member: voice, read }])).toEqual([])
      expect(memberActivityLine(read)).toEqual({ kind: 'hidden' })
      expect(sessionActivityItems(read, new Set(['call-a']), 'x', 'child')).toEqual([])
    }
    expect(activityStrip([])).toEqual({ kind: 'hidden' })
  })

  it('the capsule counts what runs; any lost task turns it amber; recently ended ones alone raise nothing', () => {
    const run = activityGroups([{ member: canvas, read: supported([task('a'), task('b', { kind: 'agent' })]) }, { member: modeler, read: supported([task('c', { state: 'completed', endedAt: NOW })]) }])
    expect(activityStrip(run)).toEqual({ kind: 'running', running: 2 })
    expect(activityStrip(activityGroups([{ member: modeler, read: supported([task('c', { state: 'completed', endedAt: NOW })]) }]))).toEqual({ kind: 'hidden' })
    expect(activityStrip(activityGroups([{ member: canvas, read: supported([task('a', { state: 'lost' }), task('b', { state: 'lost' })]) }]))).toEqual({ kind: 'lost', running: 0, lost: 2 })
  })

  it('groups by member in roster order, with the keep-alive limit only while the process is up', () => {
    const groups = activityGroups([
      { member: canvas, read: supported([task('a')], { keepAliveUntil: NOW + 4 * 60 * MIN }) },
      { member: voice, read: UNSUPPORTED },
      { member: modeler, read: supported([task('c')], { processAlive: false, keepAliveUntil: NOW }) },
    ], room)
    expect(groups.map(group => [group.member, group.keepAliveUntil])).toEqual([['kimi-canvas', NOW + 4 * 60 * MIN], ['人物建模大师', undefined]])
  })

  it('names who started it only from the room\'s own records', () => {
    expect(dispatcherOf(room, 'exec-1')).toEqual({ kind: 'member', name: '人物协调' })
    expect(dispatcherOf(room, 'exec-2')).toEqual({ kind: 'human' })
    expect(dispatcherOf(room, 'exec-unknown')).toBeUndefined()
    expect(dispatcherOf(room, undefined)).toBeUndefined()
    expect(dispatcherOf(undefined, 'exec-1')).toBeUndefined()
  })

  it('the members line: running commands and subagents, or the lost count; nothing when idle', () => {
    expect(memberActivityLine(supported([task('a'), task('b', { kind: 'agent' })]))).toEqual({ kind: 'counts', commands: 1, subagents: 1 })
    expect(memberActivityLine(supported([task('a', { state: 'lost' }), task('b')]))).toEqual({ kind: 'lost', lost: 1 })
    expect(memberActivityLine(supported([task('a', { state: 'completed', endedAt: NOW })]))).toEqual({ kind: 'hidden' })
    expect(memberActivityLine(supported([]))).toEqual({ kind: 'hidden' })
  })

  it('elapsed is known for running and ended tasks, and for a lost one only with its end', () => {
    const [running, ended, lost, lostEnded] = activityGroups([{ member: canvas, read: supported([
      task('a'), task('b', { state: 'completed', endedAt: NOW - 9 * MIN }), task('c', { state: 'lost' }), task('d', { state: 'lost', endedAt: NOW - 3 * MIN }),
    ]) }])[0]!.items
    expect(activityElapsed(running!, NOW)).toBe(12 * MIN)
    expect(activityElapsed(ended!, NOW)).toBe(3 * MIN)
    expect(activityElapsed(lost!, NOW)).toBeUndefined()
    expect(activityElapsed(lostEnded!, NOW)).toBe(9 * MIN)
    expect(durationParts(45_000, false)).toEqual({ key: 'seconds', vars: { s: 45 } })
    expect(durationParts(12 * MIN + 5_000, false)).toEqual({ key: 'minutes', vars: { m: 12 } })
    expect(durationParts(3 * MIN + 5_000, true)).toEqual({ key: 'minutesSeconds', vars: { m: 3, s: '05' } })
    expect(durationParts(125 * MIN, false)).toEqual({ key: 'hours', vars: { h: 2, m: 5 } })
  })

  it('each item gets one jump: output, open, view, look', () => {
    const items = activityGroups([{ member: canvas, read: supported([
      task('a'), task('b', { kind: 'agent' }), task('c', { state: 'lost' }), task('d', { state: 'completed', endedAt: NOW }),
    ]) }])[0]!.items
    expect(items.map(activityAction)).toEqual(['output', 'open', 'view', 'look'])
  })

  it('the session cards: the turn\'s own background commands only', () => {
    const read = supported([task('a'), task('b', { kind: 'agent' }), task('c', { callId: 'other' }), task('d', { callId: undefined })])
    expect(sessionActivityItems(read, new Set(['call-a', 'call-b']), 'kimi-canvas', 'child-canvas').map(item => item.id)).toEqual(['a'])
    expect(sessionActivityItems(read, new Set(), 'kimi-canvas', 'child-canvas')).toEqual([])
  })
})

describe('the composer capsule and tray', () => {
  const groups = activityGroups([
    { member: canvas, read: supported([task('a', { startedBy: 'exec-1' }), task('b', { kind: 'agent', label: '编写：补全全片字幕', startedAt: NOW - 6 * MIN })], { keepAliveUntil: new Date(2026, 10, 7, 2, 41).getTime() }) },
    { member: modeler, read: supported([task('c', { label: '导出阿沅 glb 并跑审查', state: 'completed', startedAt: NOW - 20 * MIN, endedAt: NOW - 20 * MIN + 185_000, resultIn: 'exec-self', startedBy: 'exec-2' })]) },
  ], room)

  it('running: 「◔ 后台 2」, toggling the tray', () => {
    const toggle = vi.fn()
    render(<ActivityCapsule groups={groups} open={false} onToggle={toggle} t={t} />)
    const capsule = screen.getByTestId('room-activity-capsule')
    expect(capsule.textContent).toBe('◔后台 2')
    expect(capsule.hasAttribute('data-lost')).toBe(false)
    fireEvent.click(capsule)
    expect(toggle).toHaveBeenCalled()
  })

  it('lost: amber 「⚠ 后台 · 2 失去联系」', () => {
    const lost = activityGroups([{ member: canvas, read: supported([task('a', { state: 'lost', lostBecause: 'host-restart' }), task('b', { state: 'lost' })]) }])
    render(<ActivityCapsule groups={lost} open={false} onToggle={() => {}} t={t} />)
    const capsule = screen.getByTestId('room-activity-capsule')
    expect(capsule.textContent).toBe('⚠后台 · 2 失去联系')
    expect(capsule.hasAttribute('data-lost')).toBe(true)
  })

  it('nothing running or lost (or unsupported): no capsule', () => {
    const { container } = render(<ActivityCapsule groups={activityGroups([{ member: voice, read: UNSUPPORTED }])} open={false} onToggle={() => {}} t={t} />)
    expect(container.innerHTML).toBe('')
  })

  it('the tray groups by member: status, time, who started it, the keep-alive limit, one jump each', () => {
    vi.useFakeTimers({ now: NOW })
    const jump = vi.fn()
    render(<ActivityTray groups={groups} now={NOW} jump={jump} onClose={() => {}} t={t} />)
    const tray = screen.getByTestId('room-activity-tray')
    expect(tray.textContent).toContain('后台活动2 项在跑')
    expect(tray.textContent).toContain('kimi-canvaskimi-cli· 进程最晚保留到 02:41')
    expect(tray.textContent).toContain('运行中 · 12 分钟')
    expect(tray.textContent).toContain('后台命令 · 由 人物协调 派活启动')
    expect(tray.textContent).toContain('后台子智能体')
    expect(tray.textContent).toContain('完成 · 3 分 05 秒')
    expect(tray.textContent).toContain('后台命令 · 由 你 派活启动 · 结果在 22:41 那条回复')
    expect(tray.textContent).toContain('只列在跑的、失去联系的和 1 小时内结束的。')
    fireEvent.click(screen.getByText('查看输出'))
    expect(jump).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a', childSessionId: 'child-canvas' }), true)
    fireEvent.click(screen.getByText('打开'))
    expect(jump).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }), false)
    fireEvent.click(screen.getByText('去看'))
    expect(jump).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'c' }), false)
  })

  it('the tray after a restart: 「失去联系」 says what we know and never claims it stopped', () => {
    const lost = activityGroups([{ member: canvas, read: supported([task('a', { state: 'lost', lostBecause: 'host-restart', startedBy: 'exec-1', endedAt: NOW - 3 * MIN })]) }], room)
    render(<ActivityTray groups={lost} now={NOW} jump={() => {}} onClose={() => {}} t={t} />)
    const tray = screen.getByTestId('room-activity-tray')
    expect(tray.textContent).toContain('1 项失去联系')
    expect(tray.textContent).toContain('失去联系 · 跑了 9 分钟')
    expect(tray.textContent).toContain('后台命令 · 由 人物协调 派活启动 · 宿主重启后失去联系，它可能已经结束，也可能还在跑；结果不会自动回来')
    expect(tray.textContent).not.toContain('终止')
    expect(screen.getByText('查看')).toBeTruthy()
  })

  it('the capsule row opens the tray above it, and a jump closes it', () => {
    let open = false
    const setOpen = vi.fn((value: boolean) => { open = value })
    const jump = vi.fn()
    const state: RoomState = { ...room, jobs: [{ id: 'j1', title: 'x', status: 'running' }] } as never
    const view = (): ReactElement => <RoomTaskCapsule state={state} openTasks={() => {}} invite={async () => ({ ok: true, pendingFirstTask: false })} listProviders={async () => undefined} browseDirectory={async () => null} background={{ groups, open, setOpen, jump }} t={t} />
    const { rerender } = render(view())
    expect(screen.queryByTestId('room-activity-tray')).toBeNull()
    fireEvent.click(screen.getByTestId('room-activity-capsule'))
    expect(setOpen).toHaveBeenLastCalledWith(true)
    rerender(view())
    fireEvent.click(screen.getByText('查看输出'))
    expect(setOpen).toHaveBeenLastCalledWith(false)
    expect(jump).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), true)
  })
})

describe('the members page line', () => {
  it('「◔ 后台：命令 1 · 子智能体 1」', () => {
    render(<MemberActivityLine read={supported([task('a'), task('b', { kind: 'agent' })])} t={t} />)
    expect(screen.getByTestId('member-activity-line').textContent).toBe('◔后台：命令 1 · 子智能体 1')
  })

  it('amber 「⚠ 后台 1 失去联系」', () => {
    render(<MemberActivityLine read={supported([task('a', { state: 'lost' })])} t={t} />)
    const line = screen.getByTestId('member-activity-line')
    expect(line.textContent).toBe('⚠后台 1 失去联系')
    expect(line.hasAttribute('data-lost')).toBe(true)
  })

  it('unsupported or idle: no line, never 「0」', () => {
    for (const read of [UNSUPPORTED, null, undefined, supported([])]) {
      const { container } = render(<MemberActivityLine read={read} t={t} />)
      expect(container.innerHTML).toBe('')
      cleanup()
    }
  })

  it('reads in English too', () => {
    render(<MemberActivityLine read={supported([task('a')])} t={makeTranslate(en) as never} />)
    expect(screen.getByTestId('member-activity-line').textContent).toBe('◔Background: 1 command')
  })
})

describe('the member session\'s command card', () => {
  const [item] = sessionActivityItems(supported([task('a', { startedBy: 'exec-1', outputTail: ['✓ tests/store.spec.ts (112 tests)', '✓ tests/chapter-markdown.spec.ts (38 tests)'] })]), new Set(['call-a']), 'kimi-canvas', 'child-canvas', room)

  it('running: one line with the last output; 查看输出 opens the command, the output and who started it', () => {
    vi.useFakeTimers({ now: NOW })
    const { container } = render(<CommandCard item={item!} keepAliveUntil={new Date(2026, 10, 7, 2, 41).getTime()} t={t} />)
    expect(container.textContent).toContain('后台命令构建并测试 canvas-novel运行中 · 12 分钟查看输出')
    expect(container.textContent).toContain('最后输出 ✓ tests/chapter-markdown.spec.ts (38 tests)')
    fireEvent.click(screen.getByText('查看输出'))
    expect(container.textContent).toContain('命令pnpm run build && pnpm run test')
    expect(container.textContent).toContain('输出（最后 2 行，随时刷新）✓ tests/store.spec.ts (112 tests)\n✓ tests/chapter-markdown.spec.ts (38 tests)')
    expect(container.textContent).toContain('由 人物协调 的派活启动')
    expect(container.textContent).toContain('进程最晚保留到 02:41')
    expect(screen.getByText('收起 ▴')).toBeTruthy()
  })

  it('ended: the exit code replaces the time', () => {
    const [done] = sessionActivityItems(supported([task('a', { state: 'completed', exitCode: 0, endedAt: NOW })]), new Set(['call-a']), '', 'child')
    const [failed] = sessionActivityItems(supported([task('a', { state: 'failed', exitCode: 2, endedAt: NOW })]), new Set(['call-a']), '', 'child')
    expect(render(<CommandCard item={done!} t={t} />).container.textContent).toContain('完成 · 退出码 0')
    expect(render(<CommandCard item={failed!} t={t} />).container.textContent).toContain('失败 · 退出码 2')
  })

  it('lost: amber, with what we know', () => {
    const [lost] = sessionActivityItems(supported([task('a', { state: 'lost', lostBecause: 'process-reclaimed' })]), new Set(['call-a']), '', 'child')
    const { container } = render(<CommandCard item={lost!} t={t} />)
    expect(container.querySelector('[data-member-activity]')?.getAttribute('data-status')).toBe('lost')
    expect(container.textContent).toContain('失去联系查看输出成员进程被收回后失去联系，它可能已经结束，也可能还在跑；结果不会自动回来')
  })

  it('a jump from the tray opens the card it names, once', () => {
    const reveals = new ActivityReveals()
    reveals.request('a', true)
    const { container } = render(<CommandCard item={item!} reveals={reveals} t={t} />)
    expect(container.textContent).toContain('收起 ▴')
    expect(reveals.take('a')).toBeUndefined()
  })
})

describe('the turn tail and the turn\'s calls', () => {
  it('the definition keeps each turn\'s Bash call ids', () => {
    const start = activityCallsDefinition.start(undefined, { event: { type: 'turn/start', data: { turn: 3 } } })
    expect(activityCallsDefinition.match({ type: 'tool/call', data: { turn: 3, name: 'Read', callId: 'r' } })).toBeNull()
    expect(activityCallsDefinition.match({ type: 'tool/call', data: { turn: 3, name: 'Bash', callId: 'b' } })).toEqual({ id: '3', role: 'update' })
    const next = activityCallsDefinition.update({ state: start }, { event: { type: 'tool/call', data: { turn: 3, name: 'Bash', callId: 'b' } } })
    expect(activityCallsDefinition.buildLocationData({ state: next }, 'turn', null)).toEqual({ kind: 'turn', turn: 3, key: 'room/activity-calls', value: { calls: ['b'] } })
    expect(activityCallsDefinition.buildLocationData({ state: start }, 'turn', null)).toBeNull()
  })

  it('a member session\'s turn shows its command card; an unsupported member shows none', async () => {
    const reads: Record<string, LocalAgentBackgroundTasks | null> = { 'child-canvas': supported([task('a')]), 'child-voice': UNSUPPORTED }
    const store = new MemberActivityStore(async id => reads[id] ?? null)
    const owner = { turn: { data: { get: () => ({ calls: ['call-a'] }) } } }
    expect(turnActivityCalls(owner)).toEqual(new Set(['call-a']))
    const face = { memberActivity: { store, reveals: new ActivityReveals() }, memberRoom: () => undefined, subscribeRooms: () => () => {} }
    const { container } = render(<MemberActivityTail {...owner} {...face} sessionId="child-canvas" t={t} />)
    await act(async () => { await Promise.resolve() })
    expect(container.textContent).toContain('后台命令构建并测试 canvas-novel')
    const other = render(<MemberActivityTail {...owner} {...face} sessionId="child-voice" t={t} />)
    await act(async () => { await Promise.resolve() })
    expect(other.container.innerHTML).toBe('')
    // A turn without a Bash call never reads at all.
    const read = vi.fn(async () => supported([task('a')]))
    const quiet = new MemberActivityStore(read)
    render(<MemberActivityTail turn={{ data: { get: () => undefined } }} memberActivity={{ store: quiet, reveals: new ActivityReveals() }} memberRoom={() => undefined} subscribeRooms={() => () => {}} sessionId="child-canvas" t={t} />)
    expect(read).not.toHaveBeenCalled()
  })
})

describe('the shared polling store', () => {
  it('polls a followed member every 4 s, stops on unsubscribe, and stops for an unsupported or non-member read', async () => {
    vi.useFakeTimers()
    const answers: Record<string, LocalAgentBackgroundTasks | null> = { live: supported([task('a')]), off: UNSUPPORTED, none: null }
    const read = vi.fn(async (id: string) => answers[id] ?? null)
    const store = new MemberActivityStore(read)
    const stop = store.follow(['live', 'off', 'none'])
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(read.mock.calls.map(call => call[0]).sort()).toEqual(['live', 'none', 'off'])
    read.mockClear()
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(read.mock.calls.map(call => call[0])).toEqual(['live'])
    expect(store.get('live')?.tasks).toHaveLength(1)
    stop()
    read.mockClear()
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000) })
    expect(read).not.toHaveBeenCalled()
  })
})
