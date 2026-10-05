/**
 * What the genre's surfaces are handed. The owner share is the canvas's
 * (`CanvasGenreOwnerProps` in @khorsheed/dsh-canvas/client), read here
 * structurally: this package does not depend on the canvas — the seats exist
 * only when the canvas declares them, and a composition without it never
 * renders these components.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  NovelChapterRequest, NovelChapterResult, NovelChaptersResult, NovelDecideRequest,
  NovelGestureResult, NovelLedgerResult, NovelPendingResult, NovelWorkRequest,
} from '../types.ts'
import type {} from './locales.ts'

/** The canvas's navigation face, as far as the genre uses it. */
export interface NovelNavigate {
  openCard: (cardId: string, heading: string) => void
  openPage: (page: string, heading: string, param?: string) => void
  refresh: () => void
}

/** The canvas's owner share (structural). */
export interface NovelOwnerProps {
  readonly canvasId: string
  readonly board: { readonly id: string; readonly genre?: { readonly id: string } | undefined }
  readonly rev: number
  readonly navigate: NovelNavigate
  readonly sessionId?: SessionId | undefined
}

/** A genre page's owner share (structural). */
export interface NovelPageOwnerProps extends NovelOwnerProps {
  readonly page: string
  readonly param?: string | undefined
}

/** The `novel` Remote namespace as the surfaces call it. */
export interface NovelRemote {
  pending: (request: NovelWorkRequest) => Promise<RemoteResult<NovelPendingResult>>
  ledger: (request: NovelWorkRequest) => Promise<RemoteResult<NovelLedgerResult>>
  chapters: (request: NovelWorkRequest) => Promise<RemoteResult<NovelChaptersResult>>
  chapter: (request: NovelChapterRequest) => Promise<RemoteResult<NovelChapterResult>>
  decidePending: (sessionId: SessionId, request: NovelDecideRequest) => Promise<RemoteResult<NovelGestureResult>>
  reviewChapter: (sessionId: SessionId, request: NovelChapterRequest) => Promise<RemoteResult<NovelGestureResult>>
  confirmPlan: (sessionId: SessionId, request: NovelChapterRequest) => Promise<RemoteResult<NovelGestureResult>>
}

/** What every surface is injected with. */
export interface NovelFace {
  /** The mounted Remote, or undefined when the host half is not composed. */
  readonly remote: () => NovelRemote | undefined
}

/** Props of a strip/page entry: the owner share, the face, the copy. */
export type NovelSurfaceProps<O extends NovelOwnerProps = NovelOwnerProps> = O & NovelFace & {
  readonly t: TranslateNS<'novel'>
}

/** The ledger page's key under the canvas's `genreKey`. */
export const LEDGER_PAGE = 'novel:ledger'
/** The chapter page's key (param: the chapter number). */
export const CHAPTER_PAGE = 'novel:chapter'
