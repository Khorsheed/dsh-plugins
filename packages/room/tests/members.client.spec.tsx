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
import type { LocalAgentModelInfo } from '@khorsheed/dsh-local-agent/types'
import type {
  MembersViewProps, RoomMembersInjected, RoomModelDirectory, RoomModelDirectoryState,
} from '../src/client/slots.ts'
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
    modelSurface: ReturnType<typeof vi.fn>
    memberModel: ReturnType<typeof vi.fn>
    setMemberModel: ReturnType<typeof vi.fn>
  }
}

/** A pickable model surface (settings layer effective, two choices). */
function modelInfo(over: Partial<LocalAgentModelInfo> = {}): LocalAgentModelInfo {
  return {
    effective: 'kimi-k2',
    source: 'settings',
    settings: 'kimi-k2',
    choices: ['kimi-k2', 'kimi-k1'],
    live: false,
    switchable: true,
    ...over,
  }
}

/** A stubbed official per-session directory (the main-agent card's hint source). */
function modelDirectory(): RoomModelDirectory {
  const store = createSnapshotStore<RoomModelDirectoryState>({
    current: { provider: 'p1', model: 'm1' },
    groups: [
      { id: 'p1', name: 'Provider One', models: [{ id: 'm1', name: 'Model One' }] },
    ],
    status: 'ready',
    error: null,
  })
  return {
    store,
    load: vi.fn(async () => store.getSnapshot()),
    select: vi.fn(async () => {}),
  }
}

/** The member card carrying the given name. */
function cardOf(name: string): HTMLElement {
  return screen.getByText(name, { selector: 'span' }).closest('[data-member]') as HTMLElement
}

/** The edit dialog's model input (the edit-mode placeholder). */
function editModelInput(): HTMLInputElement {
  return screen.getByPlaceholderText(zh['invite.modelPlaceholderEdit']) as HTMLInputElement
}

/** Render the tab against a primed store and a vi.fn inject face. */
async function bench(options: {
  room?: boolean
  providers?: RoomProviderList
  modelSurface?: LocalAgentModelInfo
  memberModel?: (child: string) => Promise<LocalAgentModelInfo | null | undefined>
  setMemberModel?: (child: string, model?: string) => Promise<{ ok: true } | { ok: false; error: string }>
  modelDirectory?: RoomModelDirectory
} = {}): Promise<Bench> {
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
    modelSurface: vi.fn(async () => options.modelSurface),
    memberModel: vi.fn(options.memberModel ?? (async () => undefined)),
    setMemberModel: vi.fn(options.setMemberModel ?? (async () => ({ ok: true as const }))),
    modelDirectory: options.modelDirectory,
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
    // Name and cwd are prefilled from the member record (the name input is
    // the one with the dice's placeholder).
    const nameInput = screen.getByPlaceholderText('ada') as HTMLInputElement
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

  it('the model field sits in the main form (out of the advanced drawer), right after the provider row', async () => {
    await bench()
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    const dialog = await screen.findByRole('dialog')
    await screen.findByText('Kimi Code', { selector: 'option' })
    // Promoted: the 默认模型 label lives outside the folded advanced drawer.
    const details = dialog.querySelector('details') as HTMLDetailsElement
    expect(details.textContent).not.toContain('默认模型')
    const labels = [...dialog.querySelectorAll('[class*="label"]')].map(node => node.textContent)
    expect(labels.indexOf('默认模型')).toBeGreaterThan(labels.indexOf('Provider'))
    expect(labels.indexOf('默认模型')).toBeLessThan(labels.indexOf('称呼（@ 寻址名）'))
  })

  it('the model menu offers the harness choices; an unset field displays the provider default dimmed', async () => {
    const { face } = await bench({ modelSurface: modelInfo() })
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    const dialog = await screen.findByRole('dialog')
    await screen.findByText('Kimi Code', { selector: 'option' })
    const modelInput = screen.getByLabelText('默认模型') as HTMLInputElement
    // The surface lands once the harnessModel read resolves, keyed by the
    // provider's roster harness name; the unset field shows the effective
    // default as its placeholder (display, never a pinned value).
    await waitFor(() => { expect(face.modelSurface).toHaveBeenCalledWith('kimi') })
    await waitFor(() => { expect(modelInput.placeholder).toBe('跟随该 provider 默认：kimi-k2') })
    expect(modelInput.value).toBe('')
    expect(dialog.querySelector('datalist')).toBeNull()

    // The chevron menu leads with the checked 默认 item over the full vocabulary.
    fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
    const items = screen.getAllByRole('menuitemradio')
    expect(items[0].textContent).toBe('默认（跟随该 provider 默认：kimi-k2）✓')
    expect(items[0].getAttribute('aria-checked')).toBe('true')
    expect(items.slice(1).map(item => item.textContent)).toEqual(['kimi-k2', 'kimi-k1'])
  })

  it('picking a menu model fills the field and the invite submits it', async () => {
    const { face } = await bench({ modelSurface: modelInfo() })
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    await screen.findByRole('dialog')
    await screen.findByText('Kimi Code', { selector: 'option' })
    await waitFor(() => { expect(face.modelSurface).toHaveBeenCalledWith('kimi') })
    fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'kimi-k2' }))
    expect((screen.getByLabelText('默认模型') as HTMLInputElement).value).toBe('kimi-k2')

    fireEvent.change(screen.getByPlaceholderText('ada'), { target: { value: 'cathy' } })
    fireEvent.click(screen.getByRole('button', { name: '邀请入队' }))
    await waitFor(() => {
      expect(face.invite).toHaveBeenCalledWith({ provider: 'kimi', name: 'cathy', model: 'kimi-k2' })
    })
  })

  it('the 默认 item clears the field back to follow-default; the invite then omits the model', async () => {
    const { face } = await bench({ modelSurface: modelInfo() })
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    await screen.findByRole('dialog')
    await screen.findByText('Kimi Code', { selector: 'option' })
    await waitFor(() => { expect(face.modelSurface).toHaveBeenCalledWith('kimi') })
    fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'kimi-k1' }))
    fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '默认（跟随该 provider 默认：kimi-k2）' }))
    expect((screen.getByLabelText('默认模型') as HTMLInputElement).value).toBe('')

    fireEvent.change(screen.getByPlaceholderText('ada'), { target: { value: 'cathy' } })
    fireEvent.click(screen.getByRole('button', { name: '邀请入队' }))
    await waitFor(() => {
      expect(face.invite).toHaveBeenCalledWith({ provider: 'kimi', name: 'cathy' })
    })
  })

  it('keeps the model field a plain input when the harness serves no surface (family absent or brokerless)', async () => {
    const { face } = await bench({ modelSurface: undefined })
    fireEvent.click(screen.getByRole('button', { name: '＋ 邀请成员' }))
    const dialog = await screen.findByRole('dialog')
    await screen.findByText('Kimi Code', { selector: 'option' })
    const modelInput = screen.getByLabelText('默认模型') as HTMLInputElement
    await waitFor(() => { expect(face.modelSurface).toHaveBeenCalledWith('kimi') })
    expect(modelInput.placeholder).toBe('留空 = 跟随该 provider 的默认模型')
    expect(screen.queryByRole('button', { name: '选择模型' })).toBeNull()
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

  it('the member card shows the effective model from memberModel, appended to the provider line', async () => {
    await bench({
      memberModel: async (child) => child === 'child-1' ? modelInfo() : null,
    })
    // ada (child-1): the broker's effective model joins the provider line.
    const adaCard = cardOf('ada')
    await waitFor(() => { expect(adaCard.textContent).toContain('kimi · kimi-k2') })
    // bill (child-2): a null answer (brokerless harness) renders no hint —
    // the pre-broker card exactly. cathy (never dispatched) and main take none.
    const billCard = cardOf('bill')
    expect(billCard.textContent).not.toContain('kimi-k2')
    expect(billCard.textContent).toContain('codex')
    expect(cardOf('cathy').textContent).not.toContain('kimi-k2')
    expect(cardOf('main').textContent).toContain('主 agent')
  })

  it('renders no model hint when the gateway answer never comes (RPC failure stays invisible)', async () => {
    await bench() // default memberModel: undefined on every call
    const adaCard = cardOf('ada')
    await waitFor(() => { expect(adaCard.textContent).toContain('空闲') })
    expect(adaCard.textContent).toContain('kimi')
    expect(adaCard.textContent).not.toContain(' · ')
  })

  it('the main-agent card shows the session model from the official directory', async () => {
    await bench({ modelDirectory: modelDirectory() })
    const mainCard = cardOf('main')
    await waitFor(() => { expect(mainCard.textContent).toContain('主 agent · Model One') })
    // CLI members stay on their own memberModel surface (default: no hint).
    expect(cardOf('ada').textContent).not.toContain('Model One')
  })

  it('the edit dialog prefills the member\'s effective model and serves the broker choices', async () => {
    const { face } = await bench({
      memberModel: async (child) => child === 'child-1' ? modelInfo() : null,
    })
    const adaCard = cardOf('ada')
    fireEvent.click(Array.from(adaCard.querySelectorAll('button')).find(b => b.textContent === '编辑')!)
    const dialog = await screen.findByRole('dialog')
    const input = editModelInput()
    await waitFor(() => { expect(input.value).toBe('kimi-k2') })
    expect(face.memberModel).toHaveBeenCalledWith('child-1')
    // The menu rides the member's own choices (memberModel, not harnessModel).
    await waitFor(() => { expect(screen.getByRole('button', { name: '选择模型' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
    const items = screen.getAllByRole('menuitemradio')
    // The leading 默认 item means "clear the override, follow settings" here;
    // the prefilled effective model reads checked.
    expect(items[0].textContent).toBe('默认（清除覆盖，跟随设置）')
    expect(items.slice(1).map(item => item.textContent)).toEqual(['kimi-k2✓', 'kimi-k1'])
    expect(dialog.querySelector('datalist')).toBeNull()
  })

  it('the edit save switches the live member through setMemberModel and journals the model', async () => {
    const { face } = await bench({
      memberModel: async (child) => child === 'child-1' ? modelInfo() : null,
    })
    const adaCard = cardOf('ada')
    fireEvent.click(Array.from(adaCard.querySelectorAll('button')).find(b => b.textContent === '编辑')!)
    await screen.findByRole('dialog')
    const input = editModelInput()
    await waitFor(() => { expect(input.value).toBe('kimi-k2') })
    fireEvent.change(input, { target: { value: 'kimi-k1' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(face.setMemberModel).toHaveBeenCalledWith('child-1', 'kimi-k1') })
    await waitFor(() => { expect(face.updateMember).toHaveBeenCalledWith('ada', { model: 'kimi-k1' }) })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('clearing the model field clears the override (undefined to the broker, null to the journal)', async () => {
    const { face } = await bench({
      memberModel: async (child) => child === 'child-1' ? modelInfo({ source: 'override', override: 'kimi-k2' }) : null,
    })
    const adaCard = cardOf('ada')
    fireEvent.click(Array.from(adaCard.querySelectorAll('button')).find(b => b.textContent === '编辑')!)
    await screen.findByRole('dialog')
    const input = editModelInput()
    await waitFor(() => { expect(input.value).toBe('kimi-k2') })
    fireEvent.change(input, { target: { value: ' ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(face.setMemberModel).toHaveBeenCalledWith('child-1', undefined) })
    await waitFor(() => { expect(face.updateMember).toHaveBeenCalledWith('ada', { model: null }) })
  })

  it('a broker refusal rides the dialog error line and aborts the save (no journal write, no close)', async () => {
    const { face } = await bench({
      memberModel: async (child) => child === 'child-1' ? modelInfo() : null,
      setMemberModel: async () => ({ ok: false as const, error: 'localAgent: a round is in flight' }),
    })
    const adaCard = cardOf('ada')
    fireEvent.click(Array.from(adaCard.querySelectorAll('button')).find(b => b.textContent === '编辑')!)
    await screen.findByRole('dialog')
    const input = editModelInput()
    await waitFor(() => { expect(input.value).toBe('kimi-k2') })
    fireEvent.change(input, { target: { value: 'kimi-k1' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toBe('localAgent: a round is in flight')
    expect(face.updateMember).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeDefined()
  })

  it('a never-started member persists the model through updateMember alone (no broker call)', async () => {
    const { face } = await bench()
    const cathyCard = cardOf('cathy')
    fireEvent.click(Array.from(cathyCard.querySelectorAll('button')).find(b => b.textContent === '编辑')!)
    await screen.findByRole('dialog')
    // No child session yet: the field opens on the journaled intent (empty).
    const input = editModelInput()
    expect(input.value).toBe('')
    fireEvent.change(input, { target: { value: 'kimi-k2' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(face.updateMember).toHaveBeenCalledWith('cathy', { model: 'kimi-k2' }) })
    expect(face.setMemberModel).not.toHaveBeenCalled()
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
