/** Keep the community selection menu as Chat's only quotation action. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'

/** The official interaction selects `quote`; the community overlay owns the visible action instead. */
export function QuoteChatInteraction(): null {
  return null
}

/** Shadow the built-in keyed surface through its public priority, independently of plugin order. */
export function registerQuoteChatInteraction(ctx: Context): void {
  ctx.effect(() => ctx.slots.inject('conversation.chat.text-interaction', () => ctx.slots.register({
    name: 'conversation.chat.text-interaction',
    key: 'quote',
    priority: -1,
  }, QuoteChatInteraction)), 'quote: Chat text interaction')
}
