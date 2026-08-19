// @vitest-environment jsdom
/** The input-dock task board: visibility gate, grouping, close/add actions. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RoomTaskDock } from '../src/client/RoomTaskDock.tsx'
import { RoomStore, type RoomGateway } from '../src/client/room-store.ts'
import { zh } from '../src/client/locales.ts'
import type { RoomTaskDockProps } from '../src/client/slots.ts'
import type { RoomState } from '../src/types.ts'

afterEach(() => {
  cleanup()
})

const t = makeTranslate(zh)
const SESSION = 'room-1' as SessionId

const STATE: RoomState = {
  members: [
    { name: 'main', kind: 'main-agent', invitedBy: 'human' },
    { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human' },
    { name: 'bill', kind: 'cli', provider: 'codex', invitedBy: 'agent' },
  ],
  relays: [],
  tasks: [
    { id: 't1', member: 'ada', title: '出方案', status: 'done' },
    { id: 't2', member: 'ada', title: '补测试', status: 'in_progress' },
    { id: 't3', member: 'bill', title: '搭页面', status: 'pending' },
  ],
  runs: [],
}

interface Bench {
  addTask: ReturnType<typeof vi.fn>
  closeTask: ReturnType<typeof vi.fn>
}

/** Render the dock strip against a store primed with the fixture. */
async function bench(options: { room?: boolean } = {}): Promise<Bench> {
  const isRoom = options.room !== false
  const list = createSnapshotStore<{ current: SessionId | undefined }>({ current: undefined })
  const gateway: RoomGateway = {
    isRoom: async () => ({ ok: true, value: isRoom }),
    getState: async () => isRoom
      ? { ok: true, value: { ok: true, value: STATE } }
      : { ok: true, value: { ok: false, error: { code: 'not-a-room' } } },
  }
  const roomStore = new RoomStore({ sessions: { list } } as unknown as ClientContext, gateway)
  await roomStore.ensure(SESSION)
  const addTask = vi.fn(async () => ({ ok: true as const }))
  const closeTask = vi.fn(async () => ({ ok: true as const }))
  const props = {
    sessionId: SESSION, roomStore, addTask, closeTask, t,
  } as unknown as RoomTaskDockProps
  render(<RoomTaskDock {...props} />)
  return { addTask, closeTask }
}

describe('RoomTaskDock', () => {
  it('renders nothing for a non-room session', async () => {
    await bench({ room: false })
    expect(screen.queryByRole('button', { name: /任务板/ })).toBeNull()
  })

  it('renders the collapsed strip with the open/closed summary for a room', async () => {
    await bench()
    const header = screen.getByRole('button', { name: /任务板/ })
    expect(header.textContent).toContain('2 项待办')
    expect(header.textContent).toContain('1 项已关闭')
    // Collapsed: no task rows yet.
    expect(screen.queryByText('出方案')).toBeNull()
  })

  it('expands to member-grouped tasks and closes an open one', async () => {
    const { closeTask } = await bench()
    fireEvent.click(screen.getByRole('button', { name: /任务板/ }))
    // Grouped by member; closed rows render struck through without an action.
    const groups = document.querySelectorAll('[class*="_group"]')
    expect(groups).toHaveLength(2)
    expect(groups[0]!.textContent).toContain('ada')
    expect(groups[1]!.textContent).toContain('bill')
    expect(screen.getByText('出方案')).toBeDefined()
    expect(screen.getByText('补测试')).toBeDefined()
    expect(screen.getByText('搭页面')).toBeDefined()
    const doneButtons = screen.getAllByRole('button', { name: '完成' })
    expect(doneButtons).toHaveLength(2)
    fireEvent.click(doneButtons[0]!)
    await waitFor(() => { expect(closeTask).toHaveBeenCalledWith('t2') })
  })

  it('adds a task to the chosen member', async () => {
    const { addTask } = await bench()
    fireEvent.click(screen.getByRole('button', { name: /任务板/ }))
    fireEvent.change(screen.getByPlaceholderText('新任务…'), { target: { value: '补文档' } })
    fireEvent.change(screen.getByRole('combobox', { name: '任务成员' }), { target: { value: 'bill' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => { expect(addTask).toHaveBeenCalledWith('bill', '补文档') })
  })

  it('surfaces a rejected add as an inline error', async () => {
    const { addTask } = await bench()
    addTask.mockResolvedValue({ ok: false, message: '操作失败，请重试' })
    fireEvent.click(screen.getByRole('button', { name: /任务板/ }))
    fireEvent.change(screen.getByPlaceholderText('新任务…'), { target: { value: '补文档' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toBe('操作失败，请重试')
  })
})
