/**
 * Quote-anything (引用任意内容), browser half: one root-level surface — the
 * selection quote menu on the frame-wide `shell.overlay` list seat (the
 * side-chat dock precedent). Select any non-editable text and the card
 * appears beside the selection; its routes:
 *
 * - 「引用到当前会话」 inserts the quote into the current conversation's
 *   composer through the official input machine
 *   (`ctx.sessions.scope(id).get('conversation').input.for(scope)`, the
 *   ui-shortcuts/message-tools precedent) — never sends. On hosts with the
 *   insert-reference seam the insert is a structured reference chip (the
 *   `slash/input-insert-reference` scoped bail event; serialized back to the
 *   same block at submit by this plugin's own codec, carried by a headless
 *   trigger source on the probed `ctx.inputTriggers` service); older hosts
 *   and declined spans fall back to the merged plain-text `> quote` block;
 * - 「引用到侧边对话」 queues an opaque `{label, text}` ref on the side-chat
 *   context bound to the current session (contextKey = session id) through
 *   this package's own thin Remote (`remote.quote.addRef`), then surfaces
 *   the side-chat tab through the official navigation face (a structural
 *   mirror — the sidechat package is never imported);
 * - 「复制」 rides the official `writeClipboard` helper.
 *
 * Other plugins contribute their own menu rows through the action registry
 * this half provides as `ctx.quoteActions` (the ui-shortcuts `ctx.shortcuts`
 * precedent): a contribution owns its label, visibility gate and body, and
 * receives the same opaque `{text, label, sessionId}` target — the menu
 * never learns where a contributed row delivers to.
 *
 * Every capability is probed and degrades silently: the registration rides
 * `ctx.slots.inject` (a host without the overlay seat mounts nothing), the
 * conversation item hides with no current session, the side-chat item hides
 * when either Remote namespace is absent, the transcript card's rule and
 * keyed renderer skip on a host without the userText seam (sent messages
 * keep their raw wire form there), and the selection read itself is the
 * last-resort DOM anchor whose fallback is silent disappearance.
 *
 * The transcript pair: sent user messages carry the quote's wire blockquote,
 * which the `quote-block` UserTextRule matches and the keyed
 * `conversation.user.text.node` renderer shows as a styled card — so the
 * quote reads structured after send, not only in the composer. And a click on
 * a composer chip routes through the trigger source's `openReference` to the
 * overlay preview card (`quote-preview`), showing the quote's full text —
 * the chip label alone never tells you what you quoted.
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
import { createQuotePreviewStore, createQuoteTriggerSource, insertQuoteChip, type QuoteBailScope, type QuoteInputTriggersMirror } from './reference.ts'
import { QuoteActionRegistryRuntime } from './registry.ts'
import { createSelectionSource } from './selection.ts'
import { SelectionQuoteMenu } from './SelectionMenu.tsx'
import { QuotePreview } from './QuotePreview.tsx'
import { QuoteTextNode } from './QuoteTextNode.tsx'
import { quoteTextRule } from './usertext.ts'

export { SelectionQuoteMenu } from './SelectionMenu.tsx'
export { QuoteActionRegistryRuntime } from './registry.ts'
export type {
  QuoteActionContribution, QuoteActionFeed, QuoteActionRegistry, QuoteActionTarget, ResolvedQuoteAction,
} from './registry.ts'
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
  // The contribution registry leads the apply: provided before any other
  // step, a consumer plugin applying right after this one already probes it
  // successfully. The cordis fiber owns the provide's lifetime (the
  // ui-shortcuts `ctx.shortcuts` precedent) — no manual disposal.
  const registry = new QuoteActionRegistryRuntime(error => ctx.logger.error(error))
  ctx.provide('quoteActions', registry)
  try {
    disposers.push(await ctx.remote.$mount(quoteRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud at boot; the
    // rest of the plugin still registers.
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'quote: dictionaries')

  // The quote chip codec rides a headless trigger source on the input-trigger
  // service: the submit-time serializer resolves codecs by source name, so the
  // source must exist for any chip we insert to send at all. The registration
  // rides a deferred inject arm — mount order between client plugins is
  // unconstrained, so a one-shot ctx.get probe misreads a not-yet-applied
  // service as absent (the room uiConversation precedent); a composition
  // without the service never fires the arm, and every insert falls back to
  // plain text. codecMounted flips with the arm's effect, so a click never
  // inserts a chip whose codec is gone; a duplicate-name throw is a
  // composition error and degrades the same way. The source also carries the
  // chip-click preview: openReference decodes the ref and shows the full
  // quote on the overlay card below, anchored to the recorded pointer
  // position (openReference carries no coordinates, so the card floats beside
  // the click via this capture-phase record).
  const previewStore = createQuotePreviewStore()
  let lastPointer: { readonly x: number; readonly y: number } | undefined
  const onPointerDown = (event: PointerEvent): void => {
    lastPointer = { x: event.clientX, y: event.clientY }
  }
  window.addEventListener('pointerdown', onPointerDown, { capture: true })
  disposers.push(async () => { window.removeEventListener('pointerdown', onPointerDown, { capture: true }) })
  let codecMounted = false
  ctx.inject(['inputTriggers'], (lctx) => {
    lctx.effect(() => {
      try {
        const service = lctx.get('inputTriggers') as QuoteInputTriggersMirror | undefined
        if (service === undefined) return () => {}
        const disposeSource = service.registerSource(createQuoteTriggerSource(data => previewStore.show(data, lastPointer)))
        codecMounted = true
        return () => {
          codecMounted = false
          disposeSource()
        }
      } catch (error) {
        ctx.logger.error(error)
        return () => {}
      }
    }, 'quote: trigger source')
  })

  // The chip-click preview card: a second entry on the same frame-wide
  // overlay seat as the selection menu (a host without the seat mounts
  // neither; a host without the chip seam never opens it).
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'quote-preview',
    order: 170,
    locale: NS,
    inject: () => ({ preview: previewStore }),
  }, QuotePreview)), 'quote: preview card')

  // The transcript half: sent user messages keep the block's wire form, and
  // this rule + keyed renderer pair turns it into the styled card. The rule
  // registration rides the same deferred-arm pattern (mount order is
  // unconstrained); a composition without the userText registry keeps the raw
  // wire text, as does a declined duplicate registration.
  ctx.inject(['uiConversation'], (lctx) => {
    lctx.effect(() => {
      try {
        const disposeRule = lctx.uiConversation.userText.register(quoteTextRule)
        return () => { disposeRule() }
      } catch (error) {
        ctx.logger.error(error)
        return () => {}
      }
    }, 'quote: user-text rule')
  })
  ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register({
    name: 'conversation.user.text.node',
    key: 'quote-block',
    locale: NS,
  }, QuoteTextNode))

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
  // scope, then prefer the structured chip (the insert-reference seam) and
  // fall back to the merged plain-text blockquote when the seam is unprobed
  // or declines. Every absence (scope gone, conversation service missing) is
  // a silent no-op.
  const insertQuote = (sessionId: SessionId, block: string, chipLabel: string): void => {
    const scope = ctx.get('sessions')?.scope(sessionId)
    if (scope === undefined) return
    const input = scope.get('conversation')?.input.for(scope)
    if (input === undefined) return
    if (codecMounted && insertQuoteChip(scope as unknown as QuoteBailScope, input, block, chipLabel)) return
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
    actions: registry,
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
