/**
 * Composed props contract for the selection quote menu — the plugin's one
 * browser surface, registered on the frame-wide `shell.overlay` list seat.
 *
 * Spelled structurally: `PropsRuntime` brings the seat's global standard kit
 * (`useSessions` — the menu is ROOT-scoped while both quote routes bind the
 * CURRENTLY SELECTED session, the side-chat dock's fence pattern), and the
 * business face is injected per registration, so no seat-owner share leaks
 * into the contract. The selection source rides the injected face too: the
 * real one listens at app level, and tests drive a manual one — component
 * tests never touch the real `window.getSelection()`.
 *
 * @module @khorsheed/dsh-quote/client
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the generated Remote API (ctx.remote merge + the `quote` namespace).
import type {} from '@khorsheed/dsh-quote/remote'
// Type-only: pulls ui-session's GlobalStandardProps merge (useSessions).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the ui-layout frame's SlotMap merge ('shell.overlay').
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from './locales.ts'
import type { SelectionSource } from './selection.ts'

/**
 * Business face injected into the selection quote menu. Every verb is
 * degrade-safe: the routes no-op silently when their service is gone, and
 * `sideChatAvailable` is a cheap synchronous probe re-evaluated per menu
 * open (a hot-added side-chat shows up on the next selection).
 */
export interface QuoteMenuInjected {
  /** The app-level selection source the menu subscribes to. */
  readonly selection: SelectionSource
  /** Whether the side-chat route is wired (both Remote namespaces mounted). */
  sideChatAvailable: () => boolean
  /** Insert the formatted quote block into one session's composer draft (never sends). */
  insertQuote: (sessionId: SessionId, block: string) => void
  /**
   * Queue one opaque ref on the side-chat context bound to one session.
   * @returns whether the host accepted the ref (a refusal no-ops silently).
   */
  addSideChatRef: (sessionId: SessionId, label: string, text: string) => Promise<boolean>
  /** Surface the side-chat tab focused on one context (probed; no-op without the seat). */
  openSideChat: (contextKey: string) => void
  /** Copy text to the host clipboard (the official writeClipboard helper). */
  copyText: (text: string) => Promise<boolean>
}

/** Full props of the selection quote menu. */
export type QuoteMenuProps =
  PropsRuntime<'shell.overlay'>
  & InjectFace<QuoteMenuInjected>
  & PropsLocale<'quote'>
