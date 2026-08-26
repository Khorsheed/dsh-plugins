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
    { name: 'cathy', kind: 'cli', provider: 'kimi', invitedBy: 'human' },
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
    removeMember: ReturnType<typeof vi.fn>
    updateMember: ReturnType<typeof vi.fn>
    invite: ReturnType<typeof vi.fn>
    listProviders: ReturnType<typeof vi.fn>
    browseDirectory: ReturnType<typeof vi.fn>
  }
}

/** The member card carrying the given name. */
function cardOf(name: string): HTMLElement {
  return screen.getByText(name, { selector: 'span' }).closest('[data-member]') as HTMLElement
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
    removeMember: vi.fn(async () => ({ ok: true as const })),
    updateMember: vi.fn(async () => ({ ok: true as const })),
    invite: vi.fn(async () => ({ ok: true as const, pendingFirstTask: false })),
    listProviders: vi.fn(async () => options.providers ?? PROVIDERS),
    browseDirectory: vi.fn(async () => '/home/user/web' as string | null),
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

  it('renders member cards with avatar letters, provider/kind, and status chips', async () => {
    await bench()
    // main: kind label, no instructions row, no edit/remove.
    const mainCard = cardOf('main')
    expect(mainCard.textContent).toContain('主 agent')
    expect(mainCard.textContent).not.toContain('未设置角色')
    expect(mainCard.textContent).not.toContain('编辑')
    expect(mainCard.textContent).not.toContain('移除')
    // ada: provider, role instructions, idle chip, trajectory + edit + remove,
    // and the avatar tile carries the member's initial.
    const adaCard = cardOf('ada')
    expect(adaCard.textContent).toContain('Aada')
    expect(adaCard.textContent).toContain('kimi')
    expect(adaCard.textContent).toContain('后端')
    expect(adaCard.textContent).toContain('空闲')
    expect(adaCard.textContent).toContain('轨迹→')
    expect(adaCard.textContent).toContain('编辑')
    expect(adaCard.textContent).toContain('移除')
    // bill: the running chip with elapsed; no instructions → the placeholder.
    const billCard = cardOf('bill')
    expect(billCard.textContent).toContain('运行中')
    expect(billCard.textContent).toContain('未设置角色')
  })

  it('carries no interrupt action — interrupt lives on the run surfaces', async () => {
    await bench()
    expect(screen.queryByRole('button', { name: '中断' })).toBeNull()
    expect(screen.queryByText('中断')).toBeNull()
  })

  it('the trajectory action opens the child session', async () => {
    const { face } = await bench()
    const adaCard = cardOf('ada')
    fireEvent.click(Array.from(adaCard.querySelectorAll('button')).find(b => b.textContent === '轨迹→')!)
    expect(face.openSession).toHaveBeenCalledWith('child-1')
  })

  it('the running chip jumps into the member session', async () => {
    const { face } = await bench()
    fireEvent.click(screen.getByRole('button', { name: /运行中/ }))
    expect(face.openSession).toHaveBeenCalledWith('child-2')
  })

  it('greys the trajectory action when the member has no child session', async () => {
    await bench()
    const cathyCard = cardOf('cathy')
    const trajectory = Array.from(cathyCard.querySelectorAll('button')).find(b => b.textContent === '轨迹→')!
    expect((trajectory as HTMLButtonElement).disabled).toBe(true)
  })

  it('the dashed invite card opens the invite dialog', async () => {
    await bench()
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    await screen.findByRole('dialog')
  })

  it('remove asks for confirmation first', async () => {
    const { face } = await bench()
    vi.stubGlobal('confirm', vi.fn(() => false))
    const adaCard = cardOf('ada')
    const removeButton = Array.from(adaCard.querySelectorAll('button')).find(b => b.textContent === '移除')!
    fireEvent.click(removeButton)
    expect(face.removeMember).not.toHaveBeenCalled()

    vi.stubGlobal('confirm', vi.fn(() => true))
    fireEvent.click(removeButton)
    await waitFor(() => { expect(face.removeMember).toHaveBeenCalledWith('ada') })
  })

  it('the edit dialog saves instructions through updateMember', async () => {
    const { face } = await bench()
    const adaCard = cardOf('ada')
    fireEvent.click(Array.from(adaCard.querySelectorAll('button')).find(b => b.textContent === '编辑')!)
    expect(screen.getByText('编辑 ada')).toBeDefined()
    const area = screen.getByRole('dialog').querySelector('textarea')!
    expect((area as HTMLTextAreaElement).value).toBe('后端')
    fireEvent.change(area, { target: { value: '后端 + 评审' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(face.updateMember).toHaveBeenCalledWith('ada', { instructions: '后端 + 评审' }) })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('the edit dialog renames and re-cwds a member (clears ride as null)', async () => {
    const { face } = await bench()
    const adaCard = cardOf('ada')
    fireEvent.click(Array.from(adaCard.querySelectorAll('button')).find(b => b.textContent === '编辑')!)
    const dialog = await screen.findByRole('dialog')
    // Name and cwd are prefilled from the member record.
    const nameInput = dialog.querySelector('input[class*="_input"]') as HTMLInputElement
    expect(nameInput.value).toBe('ada')
    fireEvent.change(nameInput, { target: { value: 'K酱' } })
    // Empty the instructions: a clear, not a rejection.
    fireEvent.change(dialog.querySelector('textarea')!, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(face.updateMember).toHaveBeenCalledWith('ada', { rename: 'K酱', instructions: null })
    })
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
    // The cwd field: empty = inherit the room cwd (the placeholder); the
    // read-only display fills through the 浏览… button (the official
    // pickDirectory wire primitive).
    const cwdInput = screen.getByText('工作目录（可选）')
      .closest('label')!.querySelector('input')!
    expect((cwdInput as HTMLInputElement).placeholder).toBe('/home/user/room')
    expect((cwdInput as HTMLInputElement).readOnly).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '浏览…' }))
    await waitFor(() => { expect((cwdInput as HTMLInputElement).value).toBe('/home/user/web') })
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

  it('the instructions field carries the first-task-message copy and an example placeholder', async () => {
    await bench()
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('角色指令')
    expect(dialog.textContent).toContain('第一条任务消息最前面')
    expect(screen.getByPlaceholderText(/你是这个 room 的后端工程师/)).toBeDefined()
  })

  it('instructions are optional: a blank role is omitted from the invite, not sent', async () => {
    const { face } = await bench()
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    await screen.findByRole('dialog')
    await screen.findByText('Kimi Code')
    fireEvent.change(screen.getByPlaceholderText('ada'), { target: { value: 'cathy' } })
    fireEvent.click(screen.getByRole('button', { name: '邀请' }))
    await waitFor(() => {
      expect(face.invite).toHaveBeenCalledWith({ provider: 'kimi', name: 'cathy' })
    })
  })

  it('a failed browse keeps the field and explains the miss inline', async () => {
    const { face } = await bench()
    face.browseDirectory.mockRejectedValue(new Error('no native capability'))
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    await screen.findByRole('dialog')
    await screen.findByText('Kimi Code')
    fireEvent.click(screen.getByRole('button', { name: '浏览…' }))
    await screen.findByText(/目录选择器不可用/)
  })
})
