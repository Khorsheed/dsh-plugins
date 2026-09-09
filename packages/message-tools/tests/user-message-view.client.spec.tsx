// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { UserMessageView } from '../src/client/UserMessageView.tsx'
import type { ChatSlice } from '../src/client/chat-hook.ts'
import type { UserMessageViewProps } from '../src/client/slots.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const t: UserMessageViewProps['t'] = makeTranslate(zh)

const COPY = { name: 'copy' }
const COPIED = { name: 'copied' }
const EDIT = { name: 'edit' }
const WITHDRAW = { name: '撤回' }

function chatNode(kind: string, seq: number, data: Record<string, unknown>): ChatConversationViewNode {
  return {
    key: `${kind}:${seq}`,
    kind,
    id: `${kind}:${seq}`,
    target: 'chat',
    anchorSeq: seq,
    location: { kind: 'unresolved' },
    visibility: 'visible',
    data,
  } as unknown as ChatConversationViewNode
}

/** A user-kind chat node; `kind`/`data` overrides cover the edited and restored rows. */
function userNode(
  content: readonly unknown[],
  over: { seq?: number; kind?: string; data?: Record<string, unknown> } = {},
): ChatConversationViewNode {
  const seq = over.seq ?? 5
  return chatNode(over.kind ?? 'user', seq, {
    seq, time: 1_700_000_000_000, content, source: { kind: 'user' }, ...over.data,
  })
}

/** One withdrawal divider node hiding [hiddenStartSeq, seq). */
function dividerNode(hiddenStartSeq: number, seq: number): ChatConversationViewNode {
  return chatNode('message-tools-withdrawn', seq, { seq, hiddenStartSeq })
}

function conversationWith(nodes: readonly ChatConversationViewNode[]): ChatSlice {
  return { nodes: { values: () => nodes } } as unknown as ChatSlice
}

/** Ready directory with the current route advertised, for the modelsAvailable seat. */
function directoryState(over: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek', model: 'deepseek-chat' },
    routable: true,
    groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] }],
    failures: [],
    status: 'ready',
    error: null,
    ...over,
  }
}

function props(over: {
  node?: ChatConversationViewNode
  snapshotNodes?: readonly ChatConversationViewNode[]
  renderMessageImages?: (owner: { images: readonly { attachment?: { name?: string } }[]; align: 'start' | 'end' }) => ReactNode
  editMessage?: (seq: number, text: string) => Promise<void>
  withdrawMessage?: (seq: number) => Promise<void>
  backfillDraft?: (text: string) => void
  modelsAvailable?: boolean
  directory?: ModelDirectoryState
  loadModels?: () => void
  selectModel?: (selection: ModelSelection) => Promise<boolean>
} = {}): UserMessageViewProps {
  const node = over.node ?? userNode([{ type: 'text', text: '你好' }])
  const chat = conversationWith(over.snapshotNodes ?? [node])
  const directory = over.directory ?? directoryState()
  return {
    node,
    renderMessageImages: over.renderMessageImages ?? vi.fn(() => null),
    t,
    useChat: (select: (snapshot: ChatSlice) => unknown) => select(chat),
    editMessage: over.editMessage ?? vi.fn(async () => {}),
    withdrawMessage: over.withdrawMessage ?? vi.fn(async () => {}),
    backfillDraft: over.backfillDraft ?? vi.fn(),
    useModelDirectory: (select: (snapshot: ModelDirectoryState) => unknown) => select(directory),
    modelsAvailable: over.modelsAvailable ?? false,
    loadModels: over.loadModels ?? vi.fn(),
    selectModel: over.selectModel ?? vi.fn(async () => true),
  } as unknown as UserMessageViewProps
}

/** Stub the async Clipboard API; jsdom omits it and writeClipboard falls back to a refused execCommand. */
function stubClipboard(writeText: () => Promise<void>): void {
  vi.stubGlobal('navigator', { clipboard: { writeText } })
}

describe('UserMessageView hidden spans', () => {
  it('renders nothing for a message inside a withdrawn span', () => {
    const node = userNode([{ type: 'text', text: '被撤回的' }], { seq: 5 })
    const { container } = render(<UserMessageView {...props({ node, snapshotNodes: [node, dividerNode(5, 10)] })} />)
    expect(container.textContent).toBe('')
  })

  it('renders messages outside the withdrawn span', () => {
    const node = userNode([{ type: 'text', text: '后来的' }], { seq: 20 })
    render(<UserMessageView {...props({ node, snapshotNodes: [node, dividerNode(5, 10)] })} />)
    expect(screen.getByText('后来的')).toBeTruthy()
  })
})

describe('UserMessageView bubble', () => {
  it('renders the message text', () => {
    render(<UserMessageView {...props()} />)
    expect(screen.getByText('你好')).toBeTruthy()
  })

  it('marks edit replacements with the edited badge', () => {
    const node = userNode([{ type: 'text', text: '改过的' }], {
      kind: 'message-tools-edited', data: { hiddenStartSeq: 4 },
    })
    render(<UserMessageView {...props({ node })} />)
    expect(screen.getByText('已编辑')).toBeTruthy()
    expect(screen.getByText('改过的')).toBeTruthy()
  })

  it('marks restore replays with the restored badge', () => {
    const node = userNode([{ type: 'text', text: '原文' }], {
      kind: 'message-tools-restored', data: { restoredFromSeq: 3, text: '原文' },
    })
    render(<UserMessageView {...props({ node })} />)
    expect(screen.getByText('已恢复')).toBeTruthy()
    expect(screen.getByText('原文')).toBeTruthy()
  })

  it('decorates /skill and @subagent tokens as chips and keeps the rest as text', () => {
    const node = userNode([{ type: 'text', text: '/plan 先规划，再让 @reviewer 检查' }])
    const { container, rerender } = render(<UserMessageView {...props({ node })} />)
    expect(container.querySelector('[data-ref-chip="skill"]')?.textContent).toBe('/plan')
    expect(container.querySelector('[data-ref-chip="subagent"]')?.textContent).toBe('@reviewer')
    expect(screen.getByText(/先规划/)).toBeTruthy()
    expect(screen.getByText(/检查/)).toBeTruthy()

    // A token at the very end leaves no trailing text part.
    rerender(<UserMessageView {...props({ node: userNode([{ type: 'text', text: '直接 @bot' }]) })} />)
    expect(container.querySelector('[data-ref-chip="subagent"]')?.textContent).toBe('@bot')
    expect(container.textContent).toContain('直接 ')
  })
})

describe('UserMessageView images and extra blocks', () => {
  const attachment = {
    attachmentId: 'a1', mediaType: 'image/png', bytes: 10, width: 200, height: 100, name: 'photo.png',
  }

  /** Stand-in for the rc8 attachment-slot renderer: one <img> per owned image. */
  const galleryStub = (owner: { images: readonly { attachment?: { name?: string } }[] }): ReactNode => (
    <>{owner.images.map((image, index) => <img key={index} alt={image.attachment?.name ?? 'image'} />)}</>
  )

  it('renders image blocks through the owner-prop attachment slot next to the bubble text', async () => {
    const renderMessageImages = vi.fn(galleryStub)
    const node = userNode([{ type: 'text', text: '看图' }, { type: 'image', attachment }])
    render(<UserMessageView {...props({ node, renderMessageImages })} />)
    expect(screen.getByText('看图')).toBeTruthy()
    expect(renderMessageImages).toHaveBeenCalledWith({ images: [{ attachment }], align: 'end' })
    expect(await screen.findByRole('img', { name: 'photo.png' })).toBeTruthy()
  })

  it('omits the bubble for an image-only message', async () => {
    const node = userNode([{ type: 'image', attachment }])
    render(<UserMessageView {...props({ node, renderMessageImages: vi.fn(galleryStub) })} />)
    expect(await screen.findByRole('img')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /附加内容块/ })).toBeNull()
  })

  it('renders leftover blocks as collapsible JSON, capped with the truncation footer', () => {
    const node = userNode([
      { type: 'text' },
      { type: 'image' },
      { type: 'blob', data: 'x'.repeat(20_100) },
    ])
    render(<UserMessageView {...props({ node })} />)
    const toggles = screen.getAllByRole('button', { name: /附加内容块/ })
    expect(toggles).toHaveLength(3)
    fireEvent.click(toggles[2]!)
    expect(screen.getByText(/已截断/).textContent).toContain('已截断')
  })
})

describe('UserMessageView copy', () => {
  it('keeps the copy affordance when the host refuses the write (jsdom has no clipboard)', async () => {
    render(<UserMessageView {...props()} />)
    fireEvent.click(screen.getByRole('button', COPY))
    await act(async () => {})
    expect(screen.getByRole('button', COPY)).toBeTruthy()
  })

  it('swaps to a short-lived check after a successful write and ignores repeat clicks meanwhile', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn(async () => {})
    stubClipboard(writeText)
    render(<UserMessageView {...props()} />)
    fireEvent.click(screen.getByRole('button', COPY))
    expect(writeText).toHaveBeenCalledWith('你好')
    await act(async () => {})
    expect(screen.getByRole('button', COPIED)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', COPIED))
    expect(writeText).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByRole('button', COPY)).toBeTruthy()
  })

  it('ignores a second click while a write is in flight and settles silently after unmount', async () => {
    let settle!: () => void
    const writeText = vi.fn(() => new Promise<void>((resolve) => { settle = resolve }))
    stubClipboard(writeText)
    const { unmount } = render(<UserMessageView {...props()} />)
    const copy = screen.getByRole('button', COPY)
    fireEvent.click(copy)
    fireEvent.click(copy)
    expect(writeText).toHaveBeenCalledTimes(1)
    unmount()
    settle()
    await act(async () => {})
  })

  it('clears the check-revert timer when the row unmounts while the check shows', async () => {
    vi.useFakeTimers()
    stubClipboard(vi.fn(async () => {}))
    const { unmount } = render(<UserMessageView {...props()} />)
    fireEvent.click(screen.getByRole('button', COPY))
    await act(async () => {})
    unmount()
    act(() => { vi.advanceTimersByTime(2000) })
  })
})

describe('UserMessageView edit', () => {
  it('opens the editor backfilled with the original text and closes on cancel', () => {
    render(<UserMessageView {...props()} />)
    fireEvent.click(screen.getByRole('button', EDIT))
    const input = screen.getByRole('textbox', { name: '编辑消息' }) as HTMLTextAreaElement
    expect(input.value).toBe('你好')
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('你好')).toBeTruthy()
  })

  it('saves through editMessage and closes on success', async () => {
    const editMessage = vi.fn(async () => {})
    render(<UserMessageView {...props({ editMessage })} />)
    fireEvent.click(screen.getByRole('button', EDIT))
    fireEvent.change(screen.getByRole('textbox', { name: '编辑消息' }), { target: { value: '改后' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并重新发送' }))
    expect(editMessage).toHaveBeenCalledWith(5, '改后')
    await act(async () => {})
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('keeps the editor open with the failure hint when editMessage rejects', async () => {
    const editMessage = vi.fn(async () => { throw new Error('boom') })
    render(<UserMessageView {...props({ editMessage })} />)
    fireEvent.click(screen.getByRole('button', EDIT))
    fireEvent.change(screen.getByRole('textbox', { name: '编辑消息' }), { target: { value: '改后' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并重新发送' }))
    expect((await screen.findByRole('status')).textContent).toBe('编辑失败，请重试')
    expect(screen.getByRole('textbox', { name: '编辑消息' })).toBeTruthy()
  })

  it('disables the editor controls while the save is in flight', async () => {
    let settle!: () => void
    const editMessage = vi.fn(() => new Promise<void>((resolve) => { settle = resolve }))
    render(<UserMessageView {...props({ editMessage })} />)
    fireEvent.click(screen.getByRole('button', EDIT))
    fireEvent.change(screen.getByRole('textbox', { name: '编辑消息' }), { target: { value: '忙' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并重新发送' }))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存并重新发送' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'cancel' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: '编辑消息' }).disabled).toBe(true)
    await act(async () => { settle() })
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('keeps save disabled for an empty draft and never submits it', () => {
    const editMessage = vi.fn(async () => {})
    render(<UserMessageView {...props({ editMessage })} />)
    fireEvent.click(screen.getByRole('button', EDIT))
    fireEvent.change(screen.getByRole('textbox', { name: '编辑消息' }), { target: { value: '   ' } })
    const save = screen.getByRole('button', { name: '保存并重新发送' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(save)
    expect(editMessage).not.toHaveBeenCalled()
  })

  it('renders the model chip in the trailing seat when the session directory is available', () => {
    render(<UserMessageView {...props({ modelsAvailable: true })} />)
    fireEvent.click(screen.getByRole('button', EDIT))
    expect(screen.getByRole('button', { name: '切换模型，当前 DeepSeek Chat' })).toBeTruthy()
  })

  it('omits the model chip when the session has no model directory', () => {
    render(<UserMessageView {...props()} />)
    fireEvent.click(screen.getByRole('button', EDIT))
    expect(screen.queryByRole('button', { name: /切换模型/ })).toBeNull()
  })
})

describe('UserMessageView withdraw', () => {
  it('gates confirmation behind the acknowledgement, then withdraws and backfills the original text', async () => {
    const withdrawMessage = vi.fn(async () => {})
    const backfillDraft = vi.fn()
    render(<UserMessageView {...props({ withdrawMessage, backfillDraft })} />)
    fireEvent.click(screen.getByRole('button', WITHDRAW))
    expect(screen.getByRole('dialog', { name: '撤回这条消息？' })).toBeTruthy()
    const confirm = screen.getByRole('button', { name: '确认撤回' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: '我已了解撤回的影响' }))
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(withdrawMessage).toHaveBeenCalledWith(5)
    await act(async () => {})
    expect(backfillDraft).toHaveBeenCalledWith('你好')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the failure hint and backfills nothing when withdrawMessage rejects', async () => {
    const withdrawMessage = vi.fn(async () => { throw new Error('boom') })
    const backfillDraft = vi.fn()
    render(<UserMessageView {...props({ withdrawMessage, backfillDraft })} />)
    fireEvent.click(screen.getByRole('button', WITHDRAW))
    fireEvent.click(screen.getByRole('checkbox', { name: '我已了解撤回的影响' }))
    fireEvent.click(screen.getByRole('button', { name: '确认撤回' }))
    expect((await screen.findByRole('status')).textContent).toBe('撤回失败，请重试')
    expect(backfillDraft).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the confirmation without withdrawing on cancel', () => {
    const withdrawMessage = vi.fn(async () => {})
    render(<UserMessageView {...props({ withdrawMessage })} />)
    fireEvent.click(screen.getByRole('button', WITHDRAW))
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(withdrawMessage).not.toHaveBeenCalled()
  })
})
