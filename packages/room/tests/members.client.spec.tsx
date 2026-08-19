// @vitest-environment jsdom
/** The members tab and the invite/edit dialog. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MembersView } from '../src/client/MembersView.tsx'
import { RoomStore, type RoomGateway } from '../src/client/room-store.ts'
import { zh } from '../src/client/locales.ts'
import type { MembersViewProps, RoomMembersInjected } from '../src/client/slots.ts'
import type { RoomProviderList, RoomState } from '../src/types.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = makeTranslate(zh)
const SESSION = 'room-1' as SessionId

const STATE: RoomState = {
  members: [
    { name: 'main', kind: 'main-agent', invitedBy: 'human' },
    { name: 'ada', kind: 'cli', provider: 'kimi', invitedBy: 'human', childSessionId: 'child-1' as SessionId, instructions: '后端' },
    { name: 'bill', kind: 'cli', provider: 'codex', invitedBy: 'agent', childSessionId: 'child-2' as SessionId },
  ],
  relays: [],
  tasks: [],
  runs: [{ member: 'bill', state: 'running', startedAt: Date.now() }],
}

const PROVIDERS: RoomProviderList = {
  localAgentAvailable: true,
  providers: [
    { provider: 'kimi', displayName: 'Kimi Code', authenticated: true },
    { provider: 'codex', displayName: 'Codex', authenticated: false },
  ],
}

interface Bench {
  face: RoomMembersInjected & {
    openSession: ReturnType<typeof vi.fn>
    cancelMember: ReturnType<typeof vi.fn>
    removeMember: ReturnType<typeof vi.fn>
    updateMember: ReturnType<typeof vi.fn>
    invite: ReturnType<typeof vi.fn>
    listProviders: ReturnType<typeof vi.fn>
  }
}

/** Render the tab against a primed store and a vi.fn inject face. */
async function bench(options: { room?: boolean; providers?: RoomProviderList } = {}): Promise<Bench> {
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
  const face = {
    roomStore,
    roomCwd: '/home/user/room',
    openSession: vi.fn(),
    cancelMember: vi.fn(async () => {}),
    removeMember: vi.fn(async () => ({ ok: true as const })),
    updateMember: vi.fn(async () => ({ ok: true as const })),
    invite: vi.fn(async () => ({ ok: true as const, pendingFirstTask: false })),
    listProviders: vi.fn(async () => options.providers ?? PROVIDERS),
  }
  const props = { sessionId: SESSION, ...face, t } as unknown as MembersViewProps
  render(<MembersView {...props} />)
  return { face: face as Bench['face'] }
}

describe('MembersView', () => {
  it('shows the not-room empty state for a plain session', async () => {
    await bench({ room: false })
    expect(screen.getByText('此会话不是 room')).toBeDefined()
  })

  it('renders roster rows with kind/provider, status, and conditional actions', async () => {
    await bench()
    // main: kind label, no edit/remove.
    const mainRow = screen.getByText('main').closest('div')!
    expect(mainRow.textContent).toContain('主 agent')
    expect(mainRow.textContent).not.toContain('编辑')
    expect(mainRow.textContent).not.toContain('移除')
    // ada: provider, role instructions, idle, trajectory + edit + remove.
    const adaRow = screen.getByText('ada').closest('div')!
    expect(adaRow.textContent).toContain('kimi')
    expect(adaRow.textContent).toContain('后端')
    expect(adaRow.textContent).toContain('空闲')
    expect(adaRow.textContent).toContain('轨迹→')
    expect(adaRow.textContent).toContain('编辑')
    expect(adaRow.textContent).toContain('移除')
    // bill: running with elapsed and the interrupt action.
    const billRow = screen.getByText('bill').closest('div')!
    expect(billRow.textContent).toContain('运行中')
    expect(billRow.textContent).toContain('中断')
  })

  it('the trajectory action opens the child session', async () => {
    const { face } = await bench()
    const adaRow = screen.getByText('ada').closest('div')!
    fireEvent.click(Array.from(adaRow.querySelectorAll('button')).find(b => b.textContent === '轨迹→')!)
    expect(face.openSession).toHaveBeenCalledWith('child-1')
  })

  it('interrupt cancels the running member', async () => {
    const { face } = await bench()
    fireEvent.click(screen.getByRole('button', { name: '中断' }))
    expect(face.cancelMember).toHaveBeenCalledWith('bill')
  })

  it('remove asks for confirmation first', async () => {
    const { face } = await bench()
    vi.stubGlobal('confirm', vi.fn(() => false))
    const adaRow = screen.getByText('ada').closest('div')!
    const removeButton = Array.from(adaRow.querySelectorAll('button')).find(b => b.textContent === '移除')!
    fireEvent.click(removeButton)
    expect(face.removeMember).not.toHaveBeenCalled()

    vi.stubGlobal('confirm', vi.fn(() => true))
    fireEvent.click(removeButton)
    await waitFor(() => { expect(face.removeMember).toHaveBeenCalledWith('ada') })
  })

  it('the edit dialog saves instructions through updateMember', async () => {
    const { face } = await bench()
    const adaRow = screen.getByText('ada').closest('div')!
    fireEvent.click(Array.from(adaRow.querySelectorAll('button')).find(b => b.textContent === '编辑')!)
    expect(screen.getByText('编辑 ada')).toBeDefined()
    const area = screen.getByRole('dialog').querySelector('textarea')!
    expect((area as HTMLTextAreaElement).value).toBe('后端')
    fireEvent.change(area, { target: { value: '后端 + 评审' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(face.updateMember).toHaveBeenCalledWith('ada', '后端 + 评审') })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('the invite dialog greys logged-out providers and submits the invite', async () => {
    const { face } = await bench()
    face.invite.mockResolvedValue({ ok: true, pendingFirstTask: true })
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => { expect(face.listProviders).toHaveBeenCalled() })
    await screen.findByText('Kimi Code')
    const codex = screen.getByText(/Codex/) as HTMLOptionElement
    expect(codex.disabled).toBe(true)
    expect(dialog.textContent).toContain('置灰的 provider 未登录')

    fireEvent.change(screen.getByPlaceholderText('ada'), { target: { value: 'cathy' } })
    // The cwd field: empty = inherit the room cwd (the placeholder); a value
    // rides the invite as the member's own working directory.
    const cwdInput = screen.getByText('工作目录（可选）')
      .closest('label')!.querySelector('input')!
    expect((cwdInput as HTMLInputElement).placeholder).toBe('/home/user/room')
    fireEvent.change(cwdInput, { target: { value: '/home/user/web' } })
    const textareas = dialog.querySelectorAll('textarea')
    fireEvent.change(textareas[0]!, { target: { value: '前端' } })
    fireEvent.change(textareas[1]!, { target: { value: '搭页面' } })
    fireEvent.click(screen.getByRole('button', { name: '邀请' }))
    await waitFor(() => {
      expect(face.invite).toHaveBeenCalledWith({
        provider: 'kimi', name: 'cathy', instructions: '前端', cwd: '/home/user/web', firstTask: '搭页面',
      })
    })
    await screen.findByText('已邀请 cathy 并开始工作')
  })

  it('omits cwd from the invite when the field is left empty (inherit)', async () => {
    const { face } = await bench()
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    const dialog = await screen.findByRole('dialog')
    await screen.findByText('Kimi Code')
    fireEvent.change(screen.getByPlaceholderText('ada'), { target: { value: 'cathy' } })
    fireEvent.change(dialog.querySelector('textarea')!, { target: { value: '前端' } })
    fireEvent.click(screen.getByRole('button', { name: '邀请' }))
    await waitFor(() => {
      expect(face.invite).toHaveBeenCalledWith({ provider: 'kimi', name: 'cathy', instructions: '前端' })
    })
  })

  it('shows the host rejection inside the dialog and keeps it open', async () => {
    const { face } = await bench()
    face.invite.mockResolvedValue({ ok: false, message: '名字已被占用' })
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    const dialog = await screen.findByRole('dialog')
    await screen.findByText('Kimi Code')
    fireEvent.change(screen.getByPlaceholderText('ada'), { target: { value: 'ada' } })
    fireEvent.change(dialog.querySelector('textarea')!, { target: { value: '后端' } })
    fireEvent.click(screen.getByRole('button', { name: '邀请' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toBe('名字已被占用')
    expect(screen.getByRole('dialog')).toBeDefined()
  })

  it('degrades the provider section when the facade is absent', async () => {
    await bench({ providers: { localAgentAvailable: false, providers: [] } })
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    await screen.findByText(/委派门面未挂载/)
    expect((screen.getByRole('button', { name: '邀请' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
