/**
 * message-tools client plugin: shadows the official user-message renderer
 * (conversation.chat.node key "user", priority -1) with a version that adds
 * edit and withdraw actions. Zero changes to ui-conversation.
 * @module @khorsheed/dsh-client-message-tools/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls ui-conversation's SlotMap merge ('conversation.chat.node').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { UserMessageView, type UserMessageViewProps } from './UserMessageView.tsx'
import styles from './styles.ts'

/** cordis plugin name used by loader diagnostics. */
export const name = 'message-tools'

/** Required services: the slots registry. */
export const inject = ['slots']

/**
 * Apply the client half: register the shadow user renderer and inject the
 * stylesheet once.
 * @param ctx - client context.
 */
export function apply(ctx: Context): void {
  // Stylesheet: one global injection for the shadow components.
  ctx.effect(() => {
    const el = document.createElement('style')
    el.textContent = styles
    document.head.appendChild(el)
    return () => { el.remove() }
  })

  // Shadow the official user renderer: priority -1 < official 0, lowest renders.
  // The slot is declared by ui-conversation's 'conversation.view' entry, whose
  // apply order relative to this package is not guaranteed — register through
  // slots.inject so the shadow waits for the declaration instead of crashing
  // the loader entry at boot.
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'user',
    priority: -1,
    locale: 'conversation',
    inject: ((): UserMessageViewProps => ({
      message: { seq: 0, text: '', withdrawn: false },
      onEdit: () => {},
      onWithdraw: () => {},
      // Session-scoped data (message seq/text, file impact) arrives from the
      // projection; the host half wires session.append for durability.
    })) as never,
  }, UserMessageView as never))
}
