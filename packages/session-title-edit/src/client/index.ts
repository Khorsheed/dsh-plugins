/**
 * Session-title-edit plugin, browser half: contributes one
 * `conversation.session.header.actions` entry — a pencil control beside the
 * session title that swaps in an inline editor. The rename verb rides the
 * official session.rename RPC (`session.rename` → `sessions.rename` →
 * `ctx.sessionTitle.rename`), so the plugin needs no host half, no new RPC,
 * and no edits to core packages; the accepted user-sourced `session/title`
 * event pins the title against automatic regeneration. Composing this plugin
 * out of cordis.yml removes every surface it adds.
 * @module @khorsheed/dsh-client-session-title-edit/client
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ui-conversation's SlotMap merge
// ('conversation.session.header.actions').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { en, NS, zh } from './locales.ts'
import type { RenameFailure, SessionTitleEditInjected } from './slots.ts'
import { TitleEditAction } from './TitleEditAction.tsx'

export type { TitleEditActionProps } from './slots.ts'

/** Required services: slot contribution, session binding, and the copy. */
export const inject = ['slots', 'sessions', 'locale']

/**
 * Client plugin body: register the dictionaries and the header action.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-title-edit: dictionaries')
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'session-title-edit',
      // Lead the actions row: this control is the title's own affordance, so
      // it sits immediately right of the title text, ahead of the static
      // agent-preset context (order -10). The slot convention reserves the
      // negative band for static context, but the user-visible requirement is
      // "edit beside the title, not after the preset label".
      order: -20,
      locale: NS,
      inject: (sessionId: SessionId): SessionTitleEditInjected => ({
        renameSession: async (title) => {
          const session = ctx.sessions.binding(sessionId)?.session
          if (session === undefined) {
            throw new Error(`session-title-edit: unknown session "${sessionId}"`)
          }
          const result = await session.rename(title)
          if (!result.ok) {
            const failure = new Error(result.error.message) as RenameFailure
            failure.code = result.error.code
            throw failure
          }
        },
      }),
    }, TitleEditAction),
  )
}
