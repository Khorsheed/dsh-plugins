// @vitest-environment jsdom
/** The members tab and the invite/edit dialog. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MembersView } from '../src/client/MembersView.tsx'
import { RoomStore, type RoomGateway } from '../src/client/room-store.ts'
import { zh } from '../src/client/locales.ts'
import { NAME_POOL, rollName } from '../src/client/name-pool.ts'
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
    { provider: 'kimi', displayName: 'Kimi Code', harness: 'kimi', authenticated: true },
    { provider: 'codex', displayName: 'Codex', harness: 'codex', authenticated: false },
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
    modelChoices: ReturnType<typeof vi.fn>
  }
}

/** The member card carrying the given name. */
function cardOf(name: string): HTMLElement {
  return screen.getByText(name, { selector: 'span' }).closest('[data-member]') as HTMLElement
}

/** Render the tab against a primed store and a vi.fn inject face. */
async function bench(options: { room?: boolean; providers?: RoomProviderList; modelChoices?: readonly string[] } = {}): Promise<Bench> {
  const isRoom = options.room !== false
  const list = createSnapshotStore<{ current: SessionId | undefined }>({ current: undefined })
  const gateway: RoomGateway = {
    isRoom: async () => ({ ok: true, value: isRoom }),
    getState: async () => isRoom
      ? { ok: true, value: { ok: true, value: STATE } }
      : { ok: true, value: { ok: false, error: { code: 'not-a-room' } } },
  }
  const roomStore = new RoomStore({ sessions: { list } } as unknown as Context, gateway)
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
    modelChoices: vi.fn(async () => options.modelChoices),
  }
  const props = { sessionId: SESSION, ...face, t } as unknown as MembersViewProps
  render(<MembersView {...props} />)
  return { face: face as Bench['face'] }
}

describe('MembersView', () => {
  it('shows the centered guide state for a plain session (inviting IS the promotion)', async () => {
    const { face } = await bench({ room: false })
    // Glyph → title → one-line explainer → primary action.
    expect(document.querySelector('svg')).not.toBeNull()
    expect(screen.getByText('把会话变成多 agent 协作间')).toBeDefined()
    expect(screen.getByText(/邀请 agent 进来即可开始协作/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '邀请 agent' }))
    expect(await screen.findByRole('dialog')).toBeDefined()
    expect(face.listProviders).toHaveBeenCalled()
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
    await screen.findByText('Kimi Code', { selector: 'option' })
    const codex = screen.getByText(/Codex/, { selector: 'option' }) as HTMLOptionElement
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
    fireEvent.change(textareas[0]!, { target: { value: '搭页面' } })
    fireEvent.change(textareas[1]!, { target: { value: '前端' } })
    fireEvent.click(screen.getByRole('button', { name: '邀请入队' }))
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
    await screen.findByText('Kimi Code', { selector: 'option' })
    fireEvent.change(screen.getByPlaceholderText('ada'), { target: { value: 'cathy' } })
    // The advanced drawer (folded on invite) holds the role instructions.
    fireEvent.change(dialog.querySelectorAll('textarea')[1]!, { target: { value: '前端' } })
    fireEvent.click(screen.getByRole('button', { name: '邀请入队' }))
    await waitFor(() => {
      expect(face.invite).toHaveBeenCalledWith({ provider: 'kimi', name: 'cathy', instructions: '前端' })
    })
  })

  it('the model field offers the harness choices as a datalist and submits a chosen model', async () => {
    const { face } = await bench({ modelChoices: ['kimi-k2', 'kimi-k1'] })
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    const dialog = await screen.findByRole('dialog')
    await screen.findByText('Kimi Code', { selector: 'option' })
    const modelInput = screen.getByPlaceholderText(/留空 = 跟随该 provider 的默认模型/) as HTMLInputElement
    // The datalist lands once the harnessModel read resolves, keyed by the
    // provider's roster harness name.
    await waitFor(() => { expect(face.modelChoices).toHaveBeenCalledWith('kimi') })
    await waitFor(() => { expect(modelInput.getAttribute('list')).toBe('room-invite-model-choices') })
    const datalist = dialog.querySelector('datalist')!
    expect([...datalist.querySelectorAll('option')].map(option => option.getAttribute('value')))
      .toEqual(['kimi-k2', 'kimi-k1'])

    fireEvent.change(screen.getByPlaceholderText('ada'), { target: { value: 'cathy' } })
    fireEvent.change(modelInput, { target: { value: 'kimi-k2' } })
    fireEvent.click(screen.getByRole('button', { name: '邀请入队' }))
    await waitFor(() => {
      expect(face.invite).toHaveBeenCalledWith({ provider: 'kimi', name: 'cathy', model: 'kimi-k2' })
    })
  })

  it('keeps the model field a plain input when the harness serves no choices (family absent or brokerless)', async () => {
    const { face } = await bench({ modelChoices: undefined })
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    const dialog = await screen.findByRole('dialog')
    await screen.findByText('Kimi Code', { selector: 'option' })
    const modelInput = screen.getByPlaceholderText(/留空 = 跟随该 provider 的默认模型/) as HTMLInputElement
    await waitFor(() => { expect(face.modelChoices).toHaveBeenCalledWith('kimi') })
    expect(modelInput.getAttribute('list')).toBeNull()
    expect(dialog.querySelector('datalist')).toBeNull()
  })

  it('shows the host rejection inside the dialog and keeps it open', async () => {
    const { face } = await bench()
    face.invite.mockResolvedValue({ ok: false, message: '名字已被占用' })
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    const dialog = await screen.findByRole('dialog')
    await screen.findByText('Kimi Code', { selector: 'option' })
    fireEvent.change(screen.getByPlaceholderText('ada'), { target: { value: 'ada' } })
    fireEvent.change(dialog.querySelectorAll('textarea')[1]!, { target: { value: '后端' } })
    fireEvent.click(screen.getByRole('button', { name: '邀请入队' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toBe('名字已被占用')
    expect(screen.getByRole('dialog')).toBeDefined()
  })

  it('degrades the provider section when the facade is absent', async () => {
    await bench({ providers: { localAgentAvailable: false, providers: [] } })
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    await screen.findByText(/委派门面未挂载/)
    expect((screen.getByRole('button', { name: '邀请入队' }) as HTMLButtonElement).disabled).toBe(true)
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
    await screen.findByText('Kimi Code', { selector: 'option' })
    fireEvent.change(screen.getByPlaceholderText('ada'), { target: { value: 'cathy' } })
    fireEvent.click(screen.getByRole('button', { name: '邀请入队' }))
    await waitFor(() => {
      expect(face.invite).toHaveBeenCalledWith({ provider: 'kimi', name: 'cathy' })
    })
  })

  it('a failed browse keeps the field and explains the miss inline', async () => {
    const { face } = await bench()
    face.browseDirectory.mockRejectedValue(new Error('no native capability'))
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    await screen.findByRole('dialog')
    await screen.findByText('Kimi Code', { selector: 'option' })
    fireEvent.click(screen.getByRole('button', { name: '浏览…' }))
    await screen.findByText(/目录选择器不可用/)
  })

  it('previews the member card live as the form changes', async () => {
    await bench()
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    const dialog = await screen.findByRole('dialog')
    await screen.findByText('Kimi Code', { selector: 'option' })
    // Empty name: the placeholder identity, always idle, no action foot.
    const preview = dialog.querySelector('[data-member="新成员"]') as HTMLElement
    expect(preview).not.toBeNull()
    expect(preview.textContent).toContain('Kimi Code')
    expect(preview.textContent).toContain('空闲')
    expect(preview.textContent).toContain('未设置角色')
    expect(preview.textContent).not.toContain('轨迹→')
    expect(preview.textContent).not.toContain('移除')
    // Typing a name re-renders the card; the preview avatar stays neutral
    // (no --member-color inline — the name-hash color joins on the roster).
    fireEvent.change(screen.getByPlaceholderText('ada'), { target: { value: 'dex' } })
    const updated = dialog.querySelector('[data-member="dex"]') as HTMLElement
    expect(updated).not.toBeNull()
    const tile = updated.querySelector('[class*="avatarTile"]') as HTMLElement
    expect(tile.style.getPropertyValue('--member-color')).toBe('')
    // The one filled action: the submit button carries the primary class.
    expect(screen.getByRole('button', { name: '邀请入队' }).className).toContain('_primary')
    // Role instructions ride the preview too (advanced drawer stays folded).
    fireEvent.change(dialog.querySelectorAll('textarea')[1]!, { target: { value: '后端' } })
    expect((dialog.querySelector('[data-member="dex"]') as HTMLElement).textContent).toContain('后端')
  })

  it('the name dice rolls a pool name that is neither taken nor current', async () => {
    await bench()
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    await screen.findByRole('dialog')
    const nameInput = screen.getByPlaceholderText('ada') as HTMLInputElement
    fireEvent.click(screen.getByRole('button', { name: '随机起名' }))
    expect(NAME_POOL).toContain(nameInput.value)
    // The roster (main/ada/bill/cathy) is never rolled.
    expect(['main', 'ada', 'bill', 'cathy']).not.toContain(nameInput.value)
    // The preview card follows the rolled name.
    expect(screen.getByRole('dialog').querySelector(`[data-member="${nameInput.value}"]`)).not.toBeNull()
    // A second roll never repeats the displayed name.
    const first = nameInput.value
    fireEvent.click(screen.getByRole('button', { name: '随机起名' }))
    expect(nameInput.value).not.toBe(first)
    expect(NAME_POOL).toContain(nameInput.value)
  })

  it('the advanced drawer is folded on invite and open on edit', async () => {
    await bench()
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    const dialog = await screen.findByRole('dialog')
    const details = dialog.querySelector('details') as HTMLDetailsElement
    expect(details.textContent).toContain('高级设置')
    expect(details.open).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    const adaCard = cardOf('ada')
    fireEvent.click(Array.from(adaCard.querySelectorAll('button')).find(b => b.textContent === '编辑')!)
    const editDialog = await screen.findByRole('dialog')
    expect((editDialog.querySelector('details') as HTMLDetailsElement).open).toBe(true)
  })
})

describe('rollName', () => {
  it('never rolls a taken or the current name, and exhausts cleanly', () => {
    for (let index = 0; index < 50; index += 1) {
      const rolled = rollName(['main', 'ada'], 'bill')!
      expect(rolled).not.toBe('ada')
      expect(rolled).not.toBe('bill')
      expect(NAME_POOL).toContain(rolled)
    }
    // Pool minus taken minus current is empty → undefined.
    expect(rollName(NAME_POOL.filter(name => name !== 'ada'), 'ada')).toBeUndefined()
  })
})
