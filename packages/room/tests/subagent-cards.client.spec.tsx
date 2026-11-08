// @vitest-environment jsdom
/**
 * A member CLI's own subagents in the member session (member-cli-subagents
 * M5): the pure card state, every card state (single running / done,
 * resumed, background, cancelled, lost, group, pending, unsupported, the
 * plain row outside a member session), the toolview over the shared store,
 * and the room run row's 「正在等子智能体」. Claude reads use the M4 mirror's
 * shape (one execution per `Agent` call, `general-purpose`); Kimi `Agent` /
 * `AgentSwarm` reads are synthetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { LocalAgentSubagentCall, LocalAgentSubagentCalls } from '@khorsheed/dsh-local-agent/types'
import {
  cardWantsPolling, foregroundWait, groupRows, subagentCallArgs, subagentCardModel,
} from '../src/client/subagent-card-view.ts'
import {
  RunSubagentWait, SubagentCallsStore, SubagentToolView, runningClock, type SubagentCardsFace,
} from '../src/client/SubagentCards.tsx'
import { ActivityReveals } from '../src/client/MemberActivity.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })

const t = makeTranslate(zh) as never
const NOW = new Date(2026, 10, 8, 21, 0).getTime()
const MEMBER = 'child-edit'

const call = (callId: string, patch: Partial<LocalAgentSubagentCall> = {}): LocalAgentSubagentCall => ({
  callId,
  sessionId: `${MEMBER}.sub.${callId}`,
  executionId: `exec-${callId}`,
  name: 'explore',
  description: '查找可剪的停顿',
  ordinal: 1,
  turn: 1,
  state: 'running',
  startedAt: NOW - 72_000,
  usage: { inputTokens: 2_000, outputTokens: 1_200, cacheReadTokens: 29_000 },
  steps: [
    { kind: 'request', index: 1, text: '决定先列出这一期的素材文件', durationMs: 12_000 },
    { kind: 'tool', name: 'Glob', summary: 'projects/podcast-0412/**/*.json', durationMs: 200 },
    { kind: 'request', index: 2, text: '先读转写稿和已有剪辑点', durationMs: 8_400 },
    { kind: 'tool', name: 'Read', summary: 'transcript.json', durationMs: 400 },
  ],
  ...patch,
})
const reads = (...calls: LocalAgentSubagentCall[]): LocalAgentSubagentCalls => ({ calls })

/** The M4 mirror's shape: a Claude `Agent` call, one execution, general-purpose, no cache split. */
const claudeDone = call('toolu_01', {
  name: 'general-purpose', description: '对照分镜表检查穿帮', state: 'done', startedAt: NOW - 242_000, endedAt: NOW,
  usage: { inputTokens: 23_000, outputTokens: 3_100 },
  steps: [
    { kind: 'request', index: 1, text: '先读分镜表', durationMs: 4_000 },
    { kind: 'tool', name: 'Read', summary: 'storyboard.md', durationMs: 120 },
    { kind: 'request', index: 2 },
    { kind: 'reply', text: '发现 2 处：12:04 背景里有工作人员，27:31 话筒入画' },
  ],
})

const swarm = (...states: LocalAgentSubagentCall['state'][]): LocalAgentSubagentCall[] => states.map((state, index) => call('call-swarm', {
  sessionId: `${MEMBER}.sub.agent-${index}`, executionId: `exec-swarm-${index}`, name: 'coder', description: `片段 ${index + 1}`,
  group: { index, size: states.length }, state, ...state === 'running' ? {} : { endedAt: NOW - 10_000 },
}))

const facts = (patch: Partial<Parameters<typeof subagentCardModel>[0]> = {}) => ({ callId: 'call-1', toolName: 'Agent', phase: 'result' as const, argsRaw: '{"description":"查找可剪的停顿","subagent_type":"explore"}', ...patch })

/** A face whose store answers `read` for every member. */
function face(read: LocalAgentSubagentCalls | null | undefined, open = vi.fn()): SubagentCardsFace & { open: ReturnType<typeof vi.fn> } {
  return { store: new SubagentCallsStore(async () => read), reveals: new ActivityReveals(), open }
}

/** Render the toolview and let the store's first read land. */
async function view(read: LocalAgentSubagentCalls | null | undefined, props: Partial<Parameters<typeof SubagentToolView>[0]> = {}, translate = t) {
  const f = face(read)
  const block = { callTime: NOW - 72_000, call: { argsRaw: '{"description":"查找可剪的停顿","subagent_type":"explore"}' } }
  const utils = render(<SubagentToolView callId="call-1" toolName="Agent" phase="result" block={block} sessionId={MEMBER} subagents={f} t={translate} {...props} />)
  await act(async () => { await Promise.resolve() })
  return { ...utils, face: f }
}

describe('subagent-card-view (the pure state)', () => {
  it('reads the call arguments of Claude Agent/Task and Kimi Agent/AgentSwarm', () => {
    expect(subagentCallArgs('{"description":"看文件","prompt":"…","subagent_type":"general-purpose","run_in_background":true}'))
      .toEqual({ description: '看文件', type: 'general-purpose', background: true })
    expect(subagentCallArgs('{"description":"接着找","resume":"agent-0","runInBackground":false}')).toEqual({ description: '接着找', resume: 'agent-0' })
    expect(subagentCallArgs('{"description":"配字幕","tasks":[{},{},{}]}')).toEqual({ description: '配字幕', count: 3 })
    expect(subagentCallArgs('not json')).toEqual({})
    expect(subagentCallArgs(undefined)).toEqual({})
  })

  it('not a member (null) or nothing read: the plain row', () => {
    expect(subagentCardModel(facts(), null, MEMBER)).toEqual({ kind: 'fallback' })
    expect(subagentCardModel(facts(), undefined, MEMBER)).toEqual({ kind: 'fallback' })
  })

  it('no grandchild: running while the call runs, 「暂不支持」 once it settled', () => {
    expect(subagentCardModel(facts({ phase: 'start', startedAt: NOW - 5_000 }), reads(), MEMBER))
      .toEqual({ kind: 'pending', type: 'explore', description: '查找可剪的停顿', background: false, startedAt: NOW - 5_000 })
    expect(subagentCardModel(facts(), reads(call('other')), MEMBER)).toEqual({ kind: 'unsupported', type: 'explore', description: '查找可剪的停顿' })
  })

  it('one subagent: a single card; a background call keeps its tag', () => {
    const model = subagentCardModel(facts(), reads(call('call-1', { background: true })), MEMBER)
    expect(model).toMatchObject({ kind: 'single', background: true, entry: { item: { status: 'running', label: '查找可剪的停顿', kind: 'subagent' } } })
  })

  it('an AgentSwarm call: one group, rows in their order, counts, the summed usage', () => {
    const [a, b, c] = swarm('done', 'running', 'done')
    const model = subagentCardModel(facts({ callId: 'call-swarm', toolName: 'AgentSwarm' }), reads(c!, a!, b!), MEMBER)
    if (model.kind !== 'group') throw new Error(model.kind)
    expect(model.entries.map(entry => entry.call.description)).toEqual(['片段 1', '片段 2', '片段 3'])
    expect(model.status).toBe('running')
    expect(model.counts).toMatchObject({ done: 2, running: 1 })
    expect(model.usage).toEqual({ inputTokens: 6_000, outputTokens: 3_600, cacheReadTokens: 87_000 })
  })

  it('a group past six rows shows five and 「另外 N 个」', () => {
    expect(groupRows([1, 2, 3, 4, 5, 6])).toEqual({ shown: [1, 2, 3, 4, 5, 6], more: 0 })
    expect(groupRows([1, 2, 3, 4, 5, 6, 7, 8])).toEqual({ shown: [1, 2, 3, 4, 5], more: 3 })
  })

  it('the run row waits for the latest running foreground subagent of this round only', () => {
    const early = call('a', { startedAt: NOW - 600_000 })
    const late = call('b', { startedAt: NOW - 60_000 })
    const bg = call('c', { startedAt: NOW - 30_000, background: true })
    const before = call('d', { startedAt: NOW - 3_600_000 })
    expect(foregroundWait(reads(early, late, bg, before), { startedAt: NOW - 700_000 })?.callId).toBe('b')
    expect(foregroundWait(reads(before, bg), { startedAt: NOW - 700_000 })).toBeUndefined()
    expect(foregroundWait(null, { startedAt: 0 })).toBeUndefined()
  })

  it('a card polls while something runs, and a settled call with no record only a few times', () => {
    const single = subagentCardModel(facts(), reads(call('call-1')), MEMBER)
    expect(cardWantsPolling(single, facts(), 9)).toBe(true)
    const done = subagentCardModel(facts(), reads(call('call-1', { state: 'done', endedAt: NOW })), MEMBER)
    expect(cardWantsPolling(done, facts(), 1)).toBe(false)
    const unsupported = subagentCardModel(facts(), reads(), MEMBER)
    expect(cardWantsPolling(unsupported, facts(), 2)).toBe(true)
    expect(cardWantsPolling(unsupported, facts(), 3)).toBe(false)
  })
})

describe('the subagent cards', () => {
  it('running (collapsed): spinner, the clock, 已用, the latest step; 展开 lists every step, the last one live; 打开 opens the grandchild', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const { container, face: f } = await view(reads(call('call-1')))
    expect(container.querySelector('[data-member-activity] [class*="spin"]')).not.toBeNull()
    expect(screen.getByText('探索')).toBeTruthy()
    expect(screen.getByText('运行中 · 1:12')).toBeTruthy()
    expect(screen.getByText('已用 32.2K')).toBeTruthy()
    expect(screen.getByText('Read transcript.json')).toBeTruthy()
    expect(screen.queryByTestId('subagent-steps')).toBeNull()
    fireEvent.click(screen.getByText('展开 ▾'))
    const steps = screen.getByTestId('subagent-steps')
    expect([...steps.children].map(row => row.textContent)).toEqual([
      '请求 1决定先列出这一期的素材文件12.0 秒',
      '工具Glob projects/podcast-0412/**/*.json0.2 秒',
      '请求 2先读转写稿和已有剪辑点8.4 秒',
      '工具Read transcript.json0.4 秒',
    ])
    expect(steps.lastElementChild?.hasAttribute('data-latest')).toBe(true)
    expect(screen.getByText('收起 ▴')).toBeTruthy()
    fireEvent.click(screen.getByText('打开'))
    expect(f.open).toHaveBeenCalledWith(`${MEMBER}.sub.call-1`, MEMBER)
  })

  it('a Claude Task done (M4 shape): 通用, 完成 · 4 分 02 秒, input and output; the reply is the last step', async () => {
    const { container } = await view(reads(claudeDone), { callId: 'toolu_01', toolName: 'Task' })
    expect(screen.getByText('通用')).toBeTruthy()
    expect(screen.getByText('完成 · 4 分 02 秒')).toBeTruthy()
    expect(screen.getByText('输入 23K · 输出 3.1K')).toBeTruthy()
    expect(container.querySelector('[class*="spin"]')).toBeNull()
    fireEvent.click(screen.getByText('展开 ▾'))
    expect(screen.getByTestId('subagent-steps').lastElementChild?.textContent).toBe('回复发现 2 处：12:04 背景里有工作人员，27:31 话筒入画')
  })

  it('cache hits read as their own bucket once the call ended', async () => {
    await view(reads(call('call-1', { state: 'done', endedAt: NOW })))
    expect(screen.getByText('输入 31K · 缓存 29K · 输出 1.2K')).toBeTruthy()
  })

  it('a Kimi resume reads 「续用 · 第 2 次」; a background one 「后台」', async () => {
    await view(reads(call('call-1', { ordinal: 2, state: 'done', endedAt: NOW - 24_000 })))
    expect(screen.getByText('续用 · 第 2 次')).toBeTruthy()
    cleanup()
    await view(reads(call('call-1', { background: true })))
    expect(screen.getByText('后台')).toBeTruthy()
  })

  it('cancelled and lost say what happened; usage still reads', async () => {
    await view(reads(call('call-1', { state: 'cancelled', endedAt: NOW - 30_000, startedAt: NOW - 181_000 })))
    expect(screen.getByText('已取消 · 2 分 31 秒')).toBeTruthy()
    expect(screen.getByText('成员这一轮被停止，这个子智能体没有完成；已做的部分可以打开查看。')).toBeTruthy()
    expect(screen.getByText('打开')).toBeTruthy()
    cleanup()
    await view(reads(call('call-1', { state: 'lost' })))
    expect(screen.getByText('失去联系')).toBeTruthy()
    expect(screen.getByText(/宿主重启后失去联系/)).toBeTruthy()
  })

  it('a group (AgentSwarm): expanded rows, the summary, 合计, each row opens its own subagent', async () => {
    const { face: f } = await view(reads(...swarm('done', 'running', 'done')), { callId: 'call-swarm', toolName: 'AgentSwarm', block: { call: { argsRaw: '{"description":"为三段素材生成字幕"}' } } })
    expect(screen.getByText('并行 3 个')).toBeTruthy()
    expect(screen.getByText('为三段素材生成字幕')).toBeTruthy()
    expect(screen.getByText('运行中 · 2 完成 · 1 在跑')).toBeTruthy()
    expect(screen.getByText('合计 96.6K')).toBeTruthy()
    const rows = screen.getByTestId('subagent-rows')
    expect(rows.children).toHaveLength(3)
    fireEvent.click(screen.getAllByText('打开')[1]!)
    expect(f.open).toHaveBeenCalledWith(`${MEMBER}.sub.agent-1`, MEMBER)
    fireEvent.click(screen.getByText('收起 ▴'))
    expect(screen.queryByTestId('subagent-rows')).toBeNull()
  })

  it('a group of eight: five rows and 「另外 3 个」', async () => {
    await view(reads(...swarm('done', 'done', 'done', 'done', 'done', 'done', 'done', 'running')), { callId: 'call-swarm', toolName: 'AgentSwarm' })
    expect(screen.getByTestId('subagent-rows').querySelectorAll('[class*="row"]:not([class*="rows"])').length).toBeGreaterThanOrEqual(5)
    expect(screen.getByText('另外 3 个')).toBeTruthy()
  })

  it('a running call with no record yet: the running card, no 打开', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    await view(reads(), { phase: 'start', block: { time: NOW - 5_000, argsRaw: '{"description":"查找可剪的停顿","subagent_type":"explore"}' } })
    expect(screen.getByText('运行中 · 0:05')).toBeTruthy()
    expect(screen.queryByText('打开')).toBeNull()
  })

  it('a settled call with no grandchild (an older log): 「暂不支持查看过程」, no 打开, no usage', async () => {
    await view(reads())
    expect(screen.getByText('暂不支持查看过程')).toBeTruthy()
    expect(screen.queryByText('打开')).toBeNull()
    expect(screen.queryByText('展开 ▾')).toBeNull()
  })

  it('outside a member session: the plain tool row', async () => {
    await view(null)
    expect(screen.getByTestId('subagent-plain-row').textContent).toContain('Agent')
    expect(screen.getByTestId('subagent-plain-row').textContent).toContain('查找可剪的停顿')
  })

  it('reads in English too', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    await view(reads(call('call-1')), {}, makeTranslate(en) as never)
    expect(screen.getByText('Explore')).toBeTruthy()
    expect(screen.getByText('Running · 1:12')).toBeTruthy()
    expect(screen.getByText('32.2K used')).toBeTruthy()
  })

  it('a running clock past an hour', () => {
    expect(runningClock(3_725_000)).toBe('1:02:05')
    expect(runningClock(72_000)).toBe('1:12')
  })
})

describe('a Kimi member (M3 shapes)', () => {
  it('reads the real Agent / AgentSwarm argument names', () => {
    expect(subagentCallArgs('{"description":"核对第一章","subagent_type":"explore","prompt":"…"}')).toEqual({ description: '核对第一章', type: 'explore' })
    expect(subagentCallArgs('{"description":"配字幕","subagent_type":"coder","items":["a","b","c"],"prompt_template":"…"}'))
      .toEqual({ description: '配字幕', type: 'coder', count: 3 })
    expect(subagentCallArgs('{"description":"补字幕","run_in_background":true}')).toEqual({ description: '补字幕', background: true })
  })

  it('an AgentSwarm group: the core\'s 0-based place (wire swarmIndex − 1) orders the rows, numbered from 1', async () => {
    // As local-agent-kimi writes it: swarmIndex 1..3 on the wire → group.index 0..2; read back out of spawn order.
    const kimi = (index: number, state: LocalAgentSubagentCall['state']) => call('swarm-1', {
      sessionId: `${MEMBER}.sub.agent-${index + 1}`, executionId: `e${index}`, name: 'coder', description: '占位任务',
      group: { index, size: 3 }, state, ...state === 'running' ? {} : { endedAt: NOW },
    })
    const { face: f } = await view(reads(kimi(2, 'done'), kimi(0, 'done'), kimi(1, 'running')), { callId: 'swarm-1', toolName: 'AgentSwarm', block: { call: { argsRaw: '{"description":"配字幕","subagent_type":"coder","items":["a","b","c"]}' } } })
    const rows = [...screen.getByTestId('subagent-rows').children]
    expect(rows.map(row => row.firstElementChild?.textContent)).toEqual(['1', '2', '3'])
    expect(rows[1]!.textContent).toContain('运行中')
    fireEvent.click(screen.getAllByText('打开')[0]!)
    expect(f.open).toHaveBeenCalledWith(`${MEMBER}.sub.agent-1`, MEMBER)
  })
})

describe('a Codex member (M8): spawn reads 「暂不支持查看过程」', () => {
  const spawn = { call: { argsRaw: '{"prompt":"试 0.9 倍语速\\n其余照旧","model":"gpt-5.5"}' } }

  it('the card names the subagent by its prompt; no 打开, no usage, no steps', async () => {
    await view(reads(), { callId: 'c2', toolName: 'collab/spawnAgent', block: spawn })
    expect(screen.getByText('子智能体')).toBeTruthy()
    expect(screen.getByText('试 0.9 倍语速')).toBeTruthy()
    expect(screen.getByText('暂不支持查看过程')).toBeTruthy()
    expect(screen.queryByText('打开')).toBeNull()
    expect(screen.queryByText('展开 ▾')).toBeNull()
  })

  it('never a running card, and never polled past the first read', () => {
    const facts = { callId: 'c2', toolName: 'collab/spawnAgent', phase: 'start' as const, argsRaw: '{"prompt":"试"}' }
    const model = subagentCardModel(facts, reads(), MEMBER)
    expect(model).toEqual({ kind: 'unsupported', description: '试' })
    expect(cardWantsPolling(model, facts, 1)).toBe(false)
  })

  it('outside a member session it stays a plain row', async () => {
    await view(null, { callId: 'c2', toolName: 'collab/spawnAgent', block: spawn })
    expect(screen.getByTestId('subagent-plain-row').textContent).toContain('collab/spawnAgent')
  })
})

describe('the room run row: 正在等子智能体', () => {
  it('names the subagent and how long; 看子智能体 opens the member session at that card', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const f = face(reads(call('call-1', { startedAt: NOW - 6 * 60_000 - 5_000 })))
    const openSession = vi.fn()
    render(<RunSubagentWait face={f} childSessionId={MEMBER} startedAt={NOW - 8 * 60_000} openSession={openSession} t={t} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByTestId('run-subagent-wait').textContent).toBe('· 正在等子智能体：探索 · 6 分钟')
    fireEvent.click(screen.getByText('看子智能体'))
    expect(openSession).toHaveBeenCalledWith(MEMBER)
    expect(f.reveals.take('call-1')).toEqual({ expand: false })
  })

  it('nothing while the member waits on nothing (or on background work only)', async () => {
    render(<RunSubagentWait face={face(reads(call('call-1', { background: true })))} childSessionId={MEMBER} startedAt={NOW - 8 * 60_000} openSession={vi.fn()} t={t} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByTestId('run-subagent-wait')).toBeNull()
  })
})

describe('the shared store', () => {
  it('reads on follow, polls only while a follower wants it, stops on the last unfollow', async () => {
    vi.useFakeTimers()
    const read = vi.fn(async () => reads(call('call-1')))
    const store = new SubagentCallsStore(read, 4_000)
    let wanted = true
    const stop = store.follow(MEMBER, () => wanted)
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(1)
    expect(store.get(MEMBER)?.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(4_000)
    expect(read).toHaveBeenCalledTimes(2)
    wanted = false
    await vi.advanceTimersByTimeAsync(8_000)
    expect(read).toHaveBeenCalledTimes(2)
    stop()
    wanted = true
    await vi.advanceTimersByTimeAsync(8_000)
    expect(read).toHaveBeenCalledTimes(2)
    expect(store.reads(MEMBER)).toBe(2)
  })
})
