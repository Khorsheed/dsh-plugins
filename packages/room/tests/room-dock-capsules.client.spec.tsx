// @vitest-environment jsdom
/**
 * The dock capsules: collapsed counts and guide state, the goal card
 * (edit / progress / advances), the task panel (member filter chips, rows,
 * blocked greying, inline add), and outside-click collapse.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RoomDockCapsules } from '../src/client/RoomDockCapsules.tsx'
import { RoomStore, type RoomGateway } from '../src/client/room-store.ts'
import { zh } from '../src/client/locales.ts'
import type { RoomDockCapsulesProps } from '../src/client/slots.ts'
import type { RoomState } from '../src/types.ts'

afterEach(() => {
  cleanup()
})

const t = makeTranslate(zh)
const SESSION = 'room-1' as SessionId
const NOW = Date.now()

const STATE: RoomState = {
  members: [
    { name: 'main', kind: 'main-agent', invitedBy: 'human' },
    { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human' },
    { name: 'bill', kind: 'cli', provider: 'codex', invitedBy: 'agent' },
  ],
  relays: [],
  goal: '插件 API v2 上线',
  tasks: [
    { id: 't1', member: 'ada', title: '出方案', status: 'done', updatedAt: NOW - 3 * 60_000 },
    { id: 't2', member: 'ada', title: '补测试', status: 'in_progress', updatedAt: NOW - 60_000 },
    { id: 't3', member: 'bill', title: '搭页面', status: 'pending', blockedBy: 'ada', updatedAt: NOW },
    { id: 't4', member: 'bill', title: '砍掉的', status: 'cancelled', updatedAt: NOW - 9 * 60_000 },
  ],
  runs: [],
}

interface Bench {
  addTask: ReturnType<typeof vi.fn>
  closeTask: ReturnType<typeof vi.fn>
  setGoal: ReturnType<typeof vi.fn>
}

/** Render the capsules against a store primed with the fixture. */
async function bench(options: { room?: boolean; state?: RoomState } = {}): Promise<Bench> {
  const isRoom = options.room !== false
  const state = options.state ?? STATE
  const list = createSnapshotStore<{ current: SessionId | undefined }>({ current: undefined })
  const gateway: RoomGateway = {
    isRoom: async () => ({ ok: true, value: isRoom }),
    getState: async () => isRoom
      ? { ok: true, value: { ok: true, value: state } }
      : { ok: true, value: { ok: false, error: { code: 'not-a-room' } } },
  }
  const roomStore = new RoomStore({ sessions: { list } } as unknown as ClientContext, gateway)
  await roomStore.ensure(SESSION)
  const addTask = vi.fn(async () => ({ ok: true as const }))
  const closeTask = vi.fn(async () => ({ ok: true as const }))
  const setGoal = vi.fn(async () => ({ ok: true as const }))
  const props = {
    sessionId: SESSION, roomStore, addTask, closeTask, setGoal, t,
  } as unknown as RoomDockCapsulesProps
  render(<RoomDockCapsules {...props} />)
  return { addTask, closeTask, setGoal }
}

describe('RoomDockCapsules', () => {
  it('renders nothing for a non-room session', async () => {
    await bench({ room: false })
    expect(screen.queryByRole('button', { name: '目标' })).toBeNull()
  })

  it('collapsed row: the goal capsule carries text + progress, the task capsule the open counts', async () => {
    await bench()
    const goal = screen.getByRole('button', { name: '目标' })
    expect(goal.textContent).toContain('插件 API v2 上线')
    // Progress: 1 done over 3 countable (the cancelled task leaves the denominator).
    expect(goal.textContent).toContain('1/3')
    const tasks = screen.getByRole('button', { name: '任务' })
    expect(tasks.textContent).toContain('1 待办')
    expect(tasks.textContent).toContain('1 进行中')
    // Collapsed: no task rows yet.
    expect(screen.queryByText('出方案')).toBeNull()
  })

  it('without a goal the capsule shows the guide state and expands straight into the editor', async () => {
    const { setGoal } = await bench({ state: { ...STATE, goal: undefined } })
    const goal = screen.getByRole('button', { name: '目标' })
    expect(goal.textContent).toContain('＋ 设定目标')
    fireEvent.click(goal)
    const input = screen.getByPlaceholderText('本房间的目标…')
    fireEvent.change(input, { target: { value: '插件 API v2 上线' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(setGoal).toHaveBeenCalledWith('插件 API v2 上线') })
  })

  it('the goal card edits inline, and lists recent advances with relative time', async () => {
    const { setGoal } = await bench()
    fireEvent.click(screen.getByRole('button', { name: '目标' }))
    // The capsule and the card both carry the goal text.
    expect(screen.getAllByText('插件 API v2 上线')).toHaveLength(2)
    expect(screen.getByRole('progressbar')).toBeDefined()
    // The done task is the advance record (3 minutes ago).
    expect(screen.getByText(/✓ ada 完成了「出方案」/)).toBeDefined()
    expect(screen.getByText(/3 分钟前/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const input = screen.getByDisplayValue('插件 API v2 上线')
    fireEvent.change(input, { target: { value: '插件 API v2.1 上线' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(setGoal).toHaveBeenCalledWith('插件 API v2.1 上线') })
  })

  it('the task panel groups by member under 全部 and closes an open task', async () => {
    const { closeTask } = await bench()
    fireEvent.click(screen.getByRole('button', { name: '任务' }))
    const groups = document.querySelectorAll('[class*="_groups"] [class*="_group"]')
    expect(groups).toHaveLength(2)
    expect(groups[0]!.textContent).toContain('ada')
    expect(groups[1]!.textContent).toContain('bill')
    // Every row leads with a status glyph (4 tasks, cancelled included).
    expect(document.querySelectorAll('[class*="_glyph"] svg')).toHaveLength(4)
    const doneButtons = screen.getAllByRole('button', { name: '完成' })
    expect(doneButtons).toHaveLength(2)
    fireEvent.click(doneButtons[0]!)
    await waitFor(() => { expect(closeTask).toHaveBeenCalledWith('t2') })
  })

  it('a single-member filter flattens the list and repeats the member name', async () => {
    await bench()
    fireEvent.click(screen.getByRole('button', { name: '任务' }))
    fireEvent.click(screen.getByRole('button', { name: 'ada' }))
    expect(document.querySelectorAll('[class*="_groups"] [class*="_group"]')).toHaveLength(0)
    expect(document.querySelectorAll('[class*="_glyph"] svg')).toHaveLength(2)
    expect(screen.getByText('出方案')).toBeDefined()
    expect(screen.queryByText('搭页面')).toBeNull()
  })

  it('a blocked task greys out with the 等 ada tag until the blocker has no open task', async () => {
    await bench()
    fireEvent.click(screen.getByRole('button', { name: '任务' }))
    const blocked = screen.getByText('搭页面').closest('li')!
    expect(blocked.getAttribute('data-blocked')).toBe('true')
    expect(screen.getByText('等 ada')).toBeDefined()
    cleanup()
    // ada's open task closed: the wait is over, the row brightens.
    await bench({
      state: {
        ...STATE,
        tasks: STATE.tasks.map(task => task.id === 't2' ? { ...task, status: 'done' as const } : task),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: '任务' }))
    expect(screen.getByText('搭页面').closest('li')!.getAttribute('data-blocked')).toBeNull()
    expect(screen.queryByText('等 ada')).toBeNull()
  })

  it('a task never counts as its own blocker (等谁 pointing at the owner)', async () => {
    await bench({
      state: {
        ...STATE,
        tasks: [
          { id: 't9', member: 'main', title: '写文档', status: 'pending', blockedBy: 'main', updatedAt: NOW },
        ],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: '任务' }))
    expect(screen.getByText('写文档').closest('li')!.getAttribute('data-blocked')).toBeNull()
    expect(screen.queryByText('等 main')).toBeNull()
  })

  it('the inline add carries the member, the title, and the optional 等谁', async () => {
    const { addTask } = await bench()
    fireEvent.click(screen.getByRole('button', { name: '添加任务' }))
    fireEvent.change(screen.getByPlaceholderText('新任务…'), { target: { value: '补文档' } })
    fireEvent.change(screen.getByRole('combobox', { name: '任务成员' }), { target: { value: 'bill' } })
    fireEvent.change(screen.getByRole('combobox', { name: '等待成员（可选）' }), { target: { value: 'ada' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => { expect(addTask).toHaveBeenCalledWith('bill', '补文档', 'ada') })
  })

  it('the add form collapses to the ＋ expander inside the panel', async () => {
    await bench()
    fireEvent.click(screen.getByRole('button', { name: '任务' }))
    expect(screen.queryByPlaceholderText('新任务…')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /＋ 添加任务/ }))
    expect(screen.getByPlaceholderText('新任务…')).toBeDefined()
  })

  it('a click outside collapses the expanded card', async () => {
    await bench()
    fireEvent.click(screen.getByRole('button', { name: '任务' }))
    expect(screen.getByText('搭页面')).toBeDefined()
    fireEvent.mouseDown(document.body)
    await waitFor(() => { expect(screen.queryByText('搭页面')).toBeNull() })
  })
})
