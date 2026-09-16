/**
 * Quote-anything (引用任意内容), browser half: one root-level surface — the
 * selection quote menu on the frame-wide `shell.overlay` list seat (the
 * side-chat dock precedent). Select any non-editable text and the card
 * appears beside the selection; its routes:
 *
 * - 「引用到当前会话」 inserts a formatted `> quote` block into the current
 *   conversation's composer through the official input machine
 *   (`ctx.sessions.scope(id).get('conversation').input.for(scope)`, the
 *   ui-shortcuts/message-tools precedent) — never sends;
 * - 「引用到侧边对话」 queues an opaque `{label, text}` ref on the side-chat
 *   context bound to the current session (contextKey = session id) through
 *   this package's own thin Remote (`remote.quote.addRef`), then surfaces
 *   the side-chat tab through the official navigation face (a structural
 *   mirror — the sidechat package is never imported);
 * - 「复制」 rides the official `writeClipboard` helper.
 *
 * Every capability is probed and degrades silently: the registration rides
 * `ctx.slots.inject` (a host without the overlay seat mounts nothing), the
 * conversation item hides with no current session, the side-chat item hides
 * when either Remote namespace is absent, and the selection read itself is
 * the last-resort DOM anchor whose fallback is silent disappearance.
 *
 * @module @khorsheed/dsh-quote/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@khorsheed/dsh-quote/remote'
// Type-only: pulls the ctx.sessions service merge (ISessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the conversation service merge (ctx.conversation / the input machine).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-layout frame's SlotMap merge ('shell.overlay').
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import quoteRemote from '@khorsheed/dsh-quote/remote'
import { mergedQuoteDraft, type QuoteAddRefOutcome, type QuoteAddRefRequest } from '../types.ts'
import type { QuoteMenuInjected } from './contract.ts'
import { en, NS, zh } from './locales.ts'
import { createSelectionSource } from './selection.ts'
import { SelectionQuoteMenu } from './SelectionMenu.tsx'

export { SelectionQuoteMenu } from './SelectionMenu.tsx'
export { classifySelection, createSelectionSource } from './selection.ts'
export type { RootedSelectionSource, SelectionRect, SelectionSnapshot, SelectionSource } from './selection.ts'
export type { QuoteMenuInjected, QuoteMenuProps } from './contract.ts'

/** Required services: slots, the remote channel, and the locale. */
export const inject = ['slots', 'remote', 'locale']

/** The quote Remote namespace, as mounted by this plugin. */
type QuoteRemote = TypertRemoteNamespaceMap['quote']

/** The side-chat Remote's presence probe (structural — never imported). */
type SideChatRemotePresence = { getState?: unknown }

/** The right-Sidebar navigation face, mirrored structurally (the canvas precedent). */
interface SidebarRightMirror {
  openTab(kind: string, options?: { params?: Record<string, unknown> }): void
}

/**
 * Client plugin body: mount the Remote, register the dictionaries, then the
 * overlay entry and its injected business face.
 * @param ctx - client root context.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(quoteRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud at boot; the
    // rest of the plugin still registers.
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'quote: dictionaries')

  // Read lazily and through `ctx.get`: a composition without the host half
  // yields undefined, and the gesture no-ops instead of the plugin pending
  // forever on an inject it cannot satisfy.
  const quoteNamespace = (): QuoteRemote | undefined => ctx.get('remote.quote') as QuoteRemote | undefined
  const addRef = (request: QuoteAddRefRequest): Promise<RemoteResult<QuoteAddRefOutcome>> | undefined =>
    quoteNamespace()?.addRef(request)

  // The side-chat route's visibility gate: both Remote namespaces must be
  // mounted — ours (the host half answers addRef) and sidechat's (its client
  // half loaded). A click that still races a missing side-chat service gets
  // the verb's 'unavailable' refusal and no-ops silently.
  const sideChatAvailable = (): boolean =>
    quoteNamespace() !== undefined
    && (ctx.get('remote.sidechat') as SideChatRemotePresence | undefined) !== undefined

  // 「引用到当前会话」: the message-tools backfill path — resolve the session's
  // scope, read the live draft, and write the merged one back. Every absence
  // (scope gone, conversation service missing) is a silent no-op.
  const insertQuote = (sessionId: SessionId, block: string): void => {
    const scope = ctx.get('sessions')?.scope(sessionId)
    if (scope === undefined) return
    const input = scope.get('conversation')?.input.for(scope)
    if (input === undefined) return
    input.setDraft(mergedQuoteDraft(input.state.getSnapshot().draft, block))
  }

  const face = (): QuoteMenuInjected => ({
    selection: createSelectionSource(window),
    sideChatAvailable,
    insertQuote,
    addSideChatRef: async (sessionId, label, text) => {
      const result = await addRef({ contextKey: sessionId, label, ref: { label, text } })
      return result?.ok === true && result.value.ok
    },
    openSideChat: (contextKey) => {
      const sidebarRight = ctx.get('sidebarRight') as SidebarRightMirror | undefined
      sidebarRight?.openTab('sidechat', { params: { contextKey } })
    },
    copyText: writeClipboard,
  })

  // The selection quote menu on the frame-wide overlay layer (root scope;
  // degrades silently on a host without the seat — the plugin then adds no
  // surface at all).
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'quote-selection',
    order: 160,
    locale: NS,
    inject: face,
  }, SelectionQuoteMenu)), 'quote: selection menu')

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
