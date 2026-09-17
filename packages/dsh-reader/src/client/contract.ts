/**
 * Compile-time contract between the reader's browser half and its host half.
 *
 * Nothing here executes: this module holds the shapes only, so a change in the
 * Remote surface or in the injected business face breaks compilation at the
 * components that consume them instead of at runtime.
 *
 * @module @khorsheed/dsh-reader/client/contract
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  GlobalStandardProps, InjectFace, PropsLocale, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the generated Remote API (ctx.remote merge + our namespace).
import type {} from '@khorsheed/dsh-reader/remote'
// Type-only: pulls ui-session's GlobalStandardProps merge (`useSessions`).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {
  ReaderAddOutcome,
  ReaderAddRefusal,
  ReaderBody,
  ReaderCapabilities,
  ReaderMutationOutcome,
  ReaderRefreshResult,
  ReaderSourceSummary,
} from '../types.ts'
import type { createReaderStore } from './store.ts'

export type { RemoteResult }

/** The result of extracting one article, as the detail view consumes it. */
export interface ReaderArticle {
  /** Whitelisted body markup, ready to render. */
  readonly html: string
  /** True when the body is known to be incomplete (size cap or partial parse). */
  readonly truncated: boolean
  /** Set when nothing usable could be extracted. */
  readonly error?: string
}

/**
 * The business face every reader surface receives from its registration.
 *
 * The wire verbs come straight off the Remote; the last four are local
 * gestures the pane cannot perform itself (they need the session scope, the
 * clipboard, or the browser), so `client/index.ts` injects them.
 */
export interface ReaderPaneInjected {
  /** Round-trip the capability handshake. */
  capabilities: () => Promise<RemoteResult<ReaderCapabilities>>
  /** The configured sources, newest first. */
  listSources: () => Promise<RemoteResult<{ sources: ReaderSourceSummary[] }>>
  /** Add a feed or a pasted article; the host decides which by content. */
  addSource: (url: string) => Promise<RemoteResult<ReaderAddOutcome | ReaderAddRefusal>>
  /** Change a source's label/enabled flag, or the global refresh time. */
  updateSource: (request: {
    id: string
    enabled?: boolean
    label?: string
    timeOfDay?: string
  }) => Promise<RemoteResult<ReaderMutationOutcome>>
  /** Drop a source. */
  removeSource: (id: string) => Promise<RemoteResult<ReaderMutationOutcome>>
  /** Fetch the named sources, or every enabled one. */
  refresh: (ids?: string[]) => Promise<RemoteResult<{ results: ReaderRefreshResult[] }>>
  /** Raw payloads, for this process to parse (the host never parses). */
  getBodies: (ids: string[]) => Promise<RemoteResult<{ bodies: ReaderBody[] }>>
  /** Offer a ref block to the side-chat service when one is composed. */
  quoteToSideChat: (request: {
    contextKey: string
    label: string
    text: string
  }) => Promise<RemoteResult<'ok' | 'unavailable'>>
  /** Read the current conversation draft (the merge `setDraft` needs). */
  readDraft: () => string
  /** Replace the conversation draft with `merged`; a no-op without a session surface. */
  setDraft: (merged: string) => void
  /** Copy text to the clipboard; resolves false when the API is unavailable. */
  copyText: (text: string) => Promise<boolean>
  /** Open a URL in the user's browser; false when the platform refuses. */
  openExternal: (url: string) => boolean
}

/** Full props of the reader pane: the seat's session + store + locale + face. */
export type ReaderPaneProps =
  & { sessionId: SessionId }
  & GlobalStandardProps
  & PropsStore<ReturnType<typeof createReaderStore>>
  & InjectFace<ReaderPaneInjected>
  & PropsLocale<'reader'>
