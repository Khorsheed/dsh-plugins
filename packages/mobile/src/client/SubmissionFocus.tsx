import { useEffect, useRef } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

type Receipt = { id: string; text: string }
const textOf = (content: unknown): string => Array.isArray(content) ? content.map(b => b?.type === 'text' ? b.text : '').join('') : ''
/** Read durable public chat records, never local optimistic submission echoes. */
export function acceptedMessages(chat: unknown): Receipt[] {
  const value = chat as { nodes?: { values?: () => readonly { kind?: string; seq?: number; content?: unknown }[] } } | undefined
  return (value?.nodes?.values?.() ?? []).flatMap(node =>
    (node.kind === 'user' || node.kind === 'steering') && typeof node.seq === 'number'
      ? [{ id: `message:${node.seq}`, text: textOf(node.content) }] : [])
}

/** A successful admission may hide the keyboard only for this exact local send.
 * Failed sends, history loads, remote sends and newly typed drafts keep focus. */
export class SubmissionFocus {
  private receipts = new Set<string>()
  private attempt: { editor: HTMLElement; text: string } | undefined
  constructor(private doc: Document) {
    doc.addEventListener('pointerdown', this.click, true)
    doc.addEventListener('keydown', this.key, true)
  }
  private editor(): HTMLElement | undefined {
    if (!this.doc.documentElement.hasAttribute('data-dsh-mobile')) return
    const el = this.doc.activeElement
    return el instanceof HTMLElement && el.matches('[contenteditable="true"], textarea') && el.closest('[data-composer-seat]') ? el : undefined
  }
  private value(el: HTMLElement) { return el instanceof HTMLTextAreaElement ? el.value : el.textContent ?? '' }
  private arm() { const editor = this.editor(); if (editor) this.attempt = { editor, text: this.value(editor).trim() } }
  private click = (e: MouseEvent) => {
    const button = e.target instanceof Element ? e.target.closest('button') : null
    if (button && !button.disabled && button.closest('[data-composer-seat]') && /发送|Send|Queue|Steer/i.test(button.getAttribute('aria-label') ?? '')) this.arm()
  }
  private key = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && this.editor()) this.arm()
  }
  update(receipts: Receipt[]) {
    const fresh = receipts.filter(r => !this.receipts.has(r.id))
    this.receipts = new Set(receipts.map(r => r.id))
    const attempt = this.attempt
    if (!attempt || !fresh.some(r => r.text.trim() === attempt.text)) return
    this.attempt = undefined
    // Lexical clears optimistically; sibling composers clear after their RPC.
    requestAnimationFrame(() => {
      if (this.doc.documentElement.hasAttribute('data-dsh-mobile') && this.doc.activeElement === attempt.editor && !this.value(attempt.editor).trim()) attempt.editor.blur()
    })
  }
  dispose() { this.attempt = undefined; this.doc.removeEventListener('pointerdown', this.click, true); this.doc.removeEventListener('keydown', this.key, true) }
}

export function MobileSubmissionFocus({ useConversation, useSession }: PropsRuntime<'conversation.session.header.actions'>) {
  const receipts = useConversation(s => JSON.stringify(acceptedMessages((s.views as { get(key: string): unknown }).get('chat'))))
  const queue = useSession(s => s.queue)
  const controller = useRef<SubmissionFocus>()
  useEffect(() => { const focus = new SubmissionFocus(document); controller.current = focus; return () => focus.dispose() }, [])
  useEffect(() => { controller.current?.update([...JSON.parse(receipts) as Receipt[], ...queue.map(row => ({ id: `queue:${row.id}`, text: textOf(row.content) }))]) }, [receipts, queue])
  return null
}
