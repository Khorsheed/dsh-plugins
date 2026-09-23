// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { WithdrawnDividerView } from '../src/client/WithdrawnDividerView.tsx'
import { RestoredMessageView, type RestoredMessageViewProps } from '../src/client/RestoredMessageView.tsx'
import { IconUndoOutlineMedium } from '../src/client/icons.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { ChatSlice } from '../src/client/chat-hook.ts'
import type { WithdrawnDividerViewProps } from '../src/client/slots.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const t = makeTranslate(zh)

function node(kind: string, anchorSeq: number, data: unknown): ChatConversationViewNode {
  return {
    key: `${kind}:${anchorSeq}`,
    kind,
    id: String(anchorSeq),
    target: 'chat',
    anchorSeq,
    location: { kind: 'unresolved' },
    visibility: 'visible',
    data,
  }
}

function dividerNode(hiddenStartSeq: number, seq: number): ChatConversationViewNode {
  return node('message-tools-withdrawn', seq, { seq, hiddenStartSeq })
}

function userNode(seq: number, text: string): ChatConversationViewNode {
  return node('user', seq, {
    kind: 'user', seq, time: 1000,
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

function assistantStepNode(seq: number, text: string): ChatConversationViewNode {
  return node('assistant-step', seq, {
    status: 'settled',
    blocks: [{ kind: 'text', text }],
    finalNode: { blocks: [{ kind: 'text', text }] },
  })
}

function restoredNode(seq: number, restoredFromSeq: number): ChatConversationViewNode {
  return node('message-tools-restored', seq, {
    seq, time: 2000, restoredFromSeq,
    content: [{ type: 'text', text: '恢复的原文' }], text: '恢复的原文',
  })
}

/** One admitted image block, as a user message's content carries it. */
const imageAttachment = {
  attachmentId: 'a1', mediaType: 'image/png', bytes: 10, width: 200, height: 100, name: 'photo.png',
}

/** A user node whose content blocks are given verbatim (text and/or images). */
function contentNode(seq: number, content: readonly unknown[]): ChatConversationViewNode {
  return node('user', seq, { kind: 'user', seq, time: 1000, content, source: { kind: 'user' } })
}

/** Stand-in for the attachment-slot gallery: one <img> per owned image. */
function galleryStub(): (owner: {
  images: readonly { attachment?: { name?: string } }[]
  align: string
}) => ReactNode {
  return owner => <>{owner.images.map((image, index) => <img key={index} alt={image.attachment?.name ?? 'image'} />)}</>
}

/** Divider props over a stub chat slice: useChat reads `chat.nodes`. */
function dividerProps(over: {
  hiddenStartSeq?: number
  seq?: number
  nodes?: readonly ChatConversationViewNode[]
  restoreMessage?: (targetSeq: number) => Promise<void>
  renderMessageImages?: WithdrawnDividerViewProps['renderMessageImages']
} = {}): WithdrawnDividerViewProps {
  const hiddenStartSeq = over.hiddenStartSeq ?? 5
  const seq = over.seq ?? 10
  const nodes = over.nodes ?? [userNode(5, '被撤回的用户问题'), assistantStepNode(6, '助手回复文本'), dividerNode(5, 10)]
  const chat = {
    nodes: { values: () => nodes },
  } as unknown as ChatSlice
  const useChat = <T,>(select: (snapshot: ChatSlice) => T): T => select(chat)
  return {
    node: dividerNode(hiddenStartSeq, seq),
    t,
    useChat,
    restoreMessage: over.restoreMessage ?? vi.fn(async () => {}),
    // Present-but-undefined exercises the degrade path (a composition without
    // the attachment gallery); the default keeps every other case rendering.
    renderMessageImages: 'renderMessageImages' in over ? over.renderMessageImages : (() => null),
  } as unknown as WithdrawnDividerViewProps
}

const MARKER = { name: '展开查看撤回内容' }
const RESTORE = { name: '恢复到对话末尾' }

describe('WithdrawnDividerView collapsed', () => {
  it('renders the folded marker with the hidden-span count', () => {
    render(<WithdrawnDividerView {...dividerProps()} />)
    const marker = screen.getByRole('button', MARKER)
    expect(marker.getAttribute('aria-expanded')).toBe('false')
    expect(marker.textContent).toContain('已撤回 2 条消息')
    expect(screen.queryByRole('button', RESTORE)).toBeNull()
  })

  it('shows no「已恢复」badge without a live restore row', () => {
    render(<WithdrawnDividerView {...dividerProps()} />)
    expect(screen.queryByText('已恢复')).toBeNull()
  })

  it('shows the「已恢复」badge and disables restore while a live restore row cites the span', () => {
    const nodes = [
      userNode(5, '被撤回的用户问题'),
      assistantStepNode(6, '助手回复文本'),
      dividerNode(5, 10),
      restoredNode(11, 5),
    ]
    render(<WithdrawnDividerView {...dividerProps({ nodes })} />)
    expect(screen.getByText('已恢复')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', MARKER))
    expect(screen.getByRole<HTMLButtonElement>('button', RESTORE).disabled).toBe(true)
  })

  it('disables restore on a superseded divider without showing the restored badge', () => {
    const nodes = [
      userNode(5, '被撤回的用户问题'),
      assistantStepNode(6, '助手回复文本'),
      dividerNode(5, 10),
      restoredNode(11, 5),
      dividerNode(11, 12),
    ]
    render(<WithdrawnDividerView {...dividerProps({ nodes })} />)
    expect(screen.queryByText('已恢复')).toBeNull()
    fireEvent.click(screen.getByRole('button', MARKER))
    expect(screen.getByRole<HTMLButtonElement>('button', RESTORE).disabled).toBe(true)
  })
})

describe('WithdrawnDividerView replay', () => {
  it('expands to the read-only replay of user originals and assistant text, then collapses', () => {
    render(<WithdrawnDividerView {...dividerProps()} />)
    const marker = screen.getByRole('button', MARKER)
    fireEvent.click(marker)
    expect(marker.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('用户消息原文')).toBeTruthy()
    expect(screen.getByText('被撤回的用户问题')).toBeTruthy()
    expect(screen.getByText('助手回复摘要')).toBeTruthy()
    expect(screen.getByText('助手回复文本')).toBeTruthy()
    fireEvent.click(marker)
    expect(marker.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('被撤回的用户问题')).toBeNull()
  })

  it('shows the empty copy when the span is outside the loaded history', () => {
    render(<WithdrawnDividerView {...dividerProps({ nodes: [dividerNode(5, 10)] })} />)
    expect(screen.getByRole('button', MARKER).textContent).toContain('已撤回 0 条消息')
    fireEvent.click(screen.getByRole('button', MARKER))
    expect(screen.getByText('撤回的内容不在当前已加载的历史中')).toBeTruthy()
  })

  it('replays a withdrawn user message\'s images through the attachment gallery', () => {
    const renderMessageImages = vi.fn(galleryStub())
    const nodes = [
      contentNode(5, [{ type: 'text', text: '看图' }, { type: 'image', attachment: imageAttachment }]),
      dividerNode(5, 10),
    ]
    const { container } = render(<WithdrawnDividerView {...dividerProps({ nodes, renderMessageImages })} />)
    fireEvent.click(screen.getByRole('button', MARKER))
    expect(screen.getByText('看图')).toBeTruthy()
    expect(renderMessageImages).toHaveBeenCalledWith({
      images: [{ attachment: imageAttachment }],
      align: 'end',
    })
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('photo.png')
  })

  it('counts and replays an image-only withdrawn message instead of reporting an empty span', () => {
    const renderMessageImages = vi.fn(galleryStub())
    const nodes = [
      contentNode(5, [{ type: 'image', attachment: imageAttachment }]),
      dividerNode(5, 6),
    ]
    const { container } = render(
      <WithdrawnDividerView {...dividerProps({ nodes, hiddenStartSeq: 5, seq: 6, renderMessageImages })} />,
    )
    expect(screen.getByRole('button', MARKER).textContent).toContain('已撤回 1 条消息')
    fireEvent.click(screen.getByRole('button', MARKER))
    expect(screen.queryByText('撤回的内容不在当前已加载的历史中')).toBeNull()
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('photo.png')
  })

  it('degrades to the text replay when the composition has no attachment gallery', () => {
    const nodes = [
      contentNode(5, [{ type: 'text', text: '只有文字' }, { type: 'image', attachment: imageAttachment }]),
      dividerNode(5, 10),
    ]
    const { container } = render(
      <WithdrawnDividerView {...dividerProps({ nodes, renderMessageImages: undefined })} />,
    )
    fireEvent.click(screen.getByRole('button', MARKER))
    expect(screen.getByText('只有文字')).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('WithdrawnDividerView restore action', () => {
  it('calls restoreMessage with the span start on success', async () => {
    const restoreMessage = vi.fn(async () => {})
    render(<WithdrawnDividerView {...dividerProps({ restoreMessage })} />)
    fireEvent.click(screen.getByRole('button', MARKER))
    fireEvent.click(screen.getByRole('button', RESTORE))
    expect(restoreMessage).toHaveBeenCalledWith(5)
    await act(async () => {})
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('disables the button while the restore is in flight', async () => {
    let settle!: () => void
    const restoreMessage = vi.fn(() => new Promise<void>((resolve) => { settle = resolve }))
    render(<WithdrawnDividerView {...dividerProps({ restoreMessage })} />)
    fireEvent.click(screen.getByRole('button', MARKER))
    fireEvent.click(screen.getByRole('button', RESTORE))
    expect(screen.getByRole<HTMLButtonElement>('button', RESTORE).disabled).toBe(true)
    await act(async () => { settle() })
    expect(screen.getByRole<HTMLButtonElement>('button', RESTORE).disabled).toBe(false)
  })

  it('shows the restoreFailed hint when the restore rejects', async () => {
    const restoreMessage = vi.fn(async () => { throw new Error('boom') })
    render(<WithdrawnDividerView {...dividerProps({ restoreMessage })} />)
    fireEvent.click(screen.getByRole('button', MARKER))
    fireEvent.click(screen.getByRole('button', RESTORE))
    expect((await screen.findByRole('status')).textContent).toBe('恢复失败，请重试')
    expect(screen.getByRole<HTMLButtonElement>('button', RESTORE).disabled).toBe(false)
  })
})

describe('RestoredMessageView', () => {
  function restoredProps(text: string): RestoredMessageViewProps {
    return {
      node: node('message-tools-restored-assistant', 21, {
        seq: 21, time: 2000, restoredFromSeq: 6, text,
      }),
      t,
    } as unknown as RestoredMessageViewProps
  }

  it('renders the「已恢复 · 助手回复」caption and the reply body as markdown', () => {
    const { container } = render(<RestoredMessageView {...restoredProps('正文 **粗体** 和 `code` 片段')} />)
    expect(screen.getByText('已恢复 · 助手回复')).toBeTruthy()
    expect(container.querySelector('strong')?.textContent).toBe('粗体')
    expect(container.querySelector('code')?.textContent).toBe('code')
  })
})

describe('IconUndoOutlineMedium', () => {
  it('renders at the authored 16px size by default', () => {
    const { container } = render(<IconUndoOutlineMedium />)
    const svg = container.querySelector('svg') as SVGSVGElement
    expect(svg.getAttribute('width')).toBe('16')
    expect(svg.getAttribute('height')).toBe('16')
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16')
    expect(svg.getAttribute('class')).toBeNull()
  })

  it('honors a custom size and className', () => {
    const { container } = render(<IconUndoOutlineMedium size={24} className="mt-undo" />)
    const svg = container.querySelector('svg') as SVGSVGElement
    expect(svg.getAttribute('width')).toBe('24')
    expect(svg.getAttribute('height')).toBe('24')
    expect(svg.getAttribute('class')).toBe('mt-undo')
  })
})

describe('locales', () => {
  it('keeps zh and en key sets identical with non-empty string values', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    for (const dict of [zh, en]) {
      for (const value of Object.values(dict)) {
        expect(typeof value).toBe('string')
        expect(value.length).toBeGreaterThan(0)
      }
    }
  })
})
