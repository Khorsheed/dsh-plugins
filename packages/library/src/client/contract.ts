/**
 * Compile-time contract between the library's browser half and its host half.
 *
 * Nothing here executes: this module holds the shapes only, so a change in the
 * Remote surface or in the injected business face breaks compilation at the
 * components that consume them instead of at runtime.
 *
 * @module @khorsheed/dsh-library/client/contract
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  GlobalStandardProps, InjectFace, PropsLocale, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the generated Remote API (ctx.remote merge + our namespace).
import type {} from '@khorsheed/dsh-library/remote'
// Type-only: pulls ui-session's GlobalStandardProps merge (`useSessions`).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { LibraryProjectSummary } from '../types.ts'
import type { createLibraryStore } from './store.ts'

export type { RemoteResult }

/**
 * The business face every library surface receives from its registration.
 * M2a carries only the project list; the v2 sidebar (M2b) widens it.
 */
export interface LibraryPaneInjected {
  /** Every project with its books' progress. */
  listProjects: () => Promise<RemoteResult<{ projects: LibraryProjectSummary[] }>>
  /**
   * Prime the session's conversation with a request. False when this session
   * has no conversation surface.
   */
  primeConversation: (text: string) => boolean
}

/** Full props of the library pane: the seat's session + store + locale + face. */
export type LibraryPaneProps =
  & { sessionId: SessionId }
  & GlobalStandardProps
  & PropsStore<ReturnType<typeof createLibraryStore>>
  & InjectFace<LibraryPaneInjected>
  & PropsLocale<'library'>
