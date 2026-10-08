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
  NovelCardRequest, NovelCardResult, NovelChapterRequest, NovelChapterResult, NovelChaptersResult, NovelDecideRequest,
  LedgerResult, NovelGestureResult, NovelOutlineDecideRequest, NovelOutlineResult, NovelPendingResult, NovelStarRequest, NovelStateRequest,
  NovelWorkRequest, StoryLogResult,
} from '../types.ts'
import type {} from './locales.ts'

/** The canvas's navigation face, as far as the genre uses it. */
export interface NovelNavigate {
  openCard: (cardId: string, heading: string) => void
  openPage: (page: string, heading: string, param?: string) => void
  /** Back to the board on its 成稿 face (the book's contents). */
  openManuscripts: () => void
  refresh: () => void
}

/** The canvas's owner share (structural). */
export interface NovelOwnerProps {
  readonly canvasId: string
  readonly board: {
    readonly id: string
    readonly title?: string
    readonly genre?: { readonly id: string } | undefined
    /** The board's cards and categories, as far as the 设定 scopes read them. */
    readonly cards?: readonly { readonly id: string; readonly kind: string }[]
    readonly categories?: readonly { readonly id: string; readonly role?: string | undefined }[]
  }
  readonly rev: number
  readonly navigate: NovelNavigate
  readonly sessionId?: SessionId | undefined
}

/** A genre page's owner share (structural). */
export interface NovelPageOwnerProps extends NovelOwnerProps {
  readonly page: string
  readonly param?: string | undefined
}

/** A card page's owner share (structural): the card and the category it is filed under. */
export interface NovelCardOwnerProps extends NovelOwnerProps {
  readonly card: { readonly id: string }
  readonly category: { readonly id: string; readonly role?: string | undefined }
}

/** The `novel` Remote namespace as the surfaces call it. */
export interface NovelRemote {
  pending: (request: NovelWorkRequest) => Promise<RemoteResult<NovelPendingResult>>
  ledger: (request: NovelWorkRequest) => Promise<RemoteResult<LedgerResult>>
  storyLog: (request: NovelWorkRequest) => Promise<RemoteResult<StoryLogResult>>
  chapters: (request: NovelWorkRequest) => Promise<RemoteResult<NovelChaptersResult>>
  chapter: (request: NovelChapterRequest) => Promise<RemoteResult<NovelChapterResult>>
  decidePending: (sessionId: SessionId, request: NovelDecideRequest) => Promise<RemoteResult<NovelGestureResult>>
  reviewChapter: (sessionId: SessionId, request: NovelChapterRequest) => Promise<RemoteResult<NovelGestureResult>>
  confirmPlan: (sessionId: SessionId, request: NovelChapterRequest) => Promise<RemoteResult<NovelGestureResult>>
  card: (request: NovelCardRequest) => Promise<RemoteResult<NovelCardResult>>
  starForeshadow: (sessionId: SessionId, request: NovelStarRequest) => Promise<RemoteResult<NovelGestureResult>>
  setCurrentState: (sessionId: SessionId, request: NovelStateRequest) => Promise<RemoteResult<NovelGestureResult>>
  outline: (request: NovelWorkRequest) => Promise<RemoteResult<NovelOutlineResult>>
  decideOutline: (sessionId: SessionId, request: NovelOutlineDecideRequest) => Promise<RemoteResult<NovelGestureResult>>
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

/** The story-log page's key under the canvas's `genreKey`. */
export const STORY_LOG_PAGE = 'novel:story-log'
/** The 规划 page's key: the lead face opened as a page (a conversation card's door). */
export const PLAN_PAGE = 'novel:plan'
/** The chapter page's key (param: the chapter number). */
export const CHAPTER_PAGE = 'novel:chapter'
