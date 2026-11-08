/**
 * What the genre's surfaces are handed. The owner share is the canvas's
 * (`CanvasGenreOwnerProps` in @khorsheed/dsh-canvas/client), read here
 * structurally: this package does not depend on the canvas — the seats exist
 * only when the canvas declares them, and a composition without it never
 * renders these components.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import type { ComponentType } from 'react'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  NovelCardRequest, NovelCardResult, NovelChapterRequest, NovelChapterResult, NovelChaptersResult, NovelDecideRequest,
  LedgerResult, NovelGestureResult, NovelOutlineDecideRequest, NovelOutlineResult, NovelWorldMapResult, NovelTimelineResult, NovelCodexResult, NovelPinsRequest, NovelIdeasResult, NovelIdeaRequest, NovelDeleteRequest, NovelDeletePreviewResult, NovelAlignResult, NovelAlignAckRequest, NovelBodyEditRequest, NovelBodyEditResult, NovelOwnChapterRequest, NovelImportChapterRequest, NovelImportChapterResult, NovelDirectorySelection, NovelDirectoryImportResult, NovelPendingResult, NovelPlanEditRequest, NovelRecentResult, NovelPlanEditResult, NovelStarRequest, NovelStateRequest,
  NovelWorkRequest, StoryLogResult, NovelMindCorrectRequest,
} from '../types.ts'
import type {
  ChapterFeedbackAddRequest, ChapterFeedbackBatchRequest, ChapterFeedbackCandidateRequest, ChapterFeedbackDeleteRequest,
  ChapterFeedbackMutationResult, ChapterFeedbackPrepareResult, ChapterFeedbackRestoreRequest, ChapterFeedbackResult,
} from '../chapter-feedback.ts'
import type {
  ChapterDeletionApplyRequest, ChapterDeletionListResult, ChapterDeletionMutationResult, ChapterDeletionPreviewRequest, ChapterDeletionPreviewResult, ChapterDeletionPurgeRequest, ChapterDeletionRestoreRequest,
} from '../chapter-deletion.ts'
import type {} from './locales.ts'

/** The canvas's navigation face, as far as the genre uses it. */
export interface NovelNavigate {
  openCard: (cardId: string, heading: string) => void
  openPage: (page: string, heading: string, param?: string) => void
  /**
   * Back to the board on its 成稿 face (the book's contents); with a chapter
   * number, that chapter in the 章节 face's reader (`focus` plan or body).
   * Older canvas builds ignore the arguments and show the contents.
   */
  openManuscripts: (item?: string, focus?: string) => void
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
  editPlan: (sessionId: SessionId, request: NovelPlanEditRequest) => Promise<RemoteResult<NovelPlanEditResult>>
  recentUpdates: (request: NovelWorkRequest) => Promise<RemoteResult<NovelRecentResult>>
  card: (request: NovelCardRequest) => Promise<RemoteResult<NovelCardResult>>
  starForeshadow: (sessionId: SessionId, request: NovelStarRequest) => Promise<RemoteResult<NovelGestureResult>>
  setCurrentState: (sessionId: SessionId, request: NovelStateRequest) => Promise<RemoteResult<NovelGestureResult>>
  correctMind: (sessionId: SessionId, request: NovelMindCorrectRequest) => Promise<RemoteResult<NovelGestureResult>>
  outline: (request: NovelWorkRequest) => Promise<RemoteResult<NovelOutlineResult>>
  worldMap: (request: NovelWorkRequest) => Promise<RemoteResult<NovelWorldMapResult>>
  timeline: (request: NovelWorkRequest) => Promise<RemoteResult<NovelTimelineResult>>
  codex: (request: NovelWorkRequest) => Promise<RemoteResult<NovelCodexResult>>
  setRecallPins: (sessionId: SessionId, request: NovelPinsRequest) => Promise<RemoteResult<NovelGestureResult>>
  ideas: (request: NovelWorkRequest) => Promise<RemoteResult<NovelIdeasResult>>
  changeIdea: (sessionId: SessionId, request: NovelIdeaRequest) => Promise<RemoteResult<NovelGestureResult>>
  editChapterBody: (sessionId: SessionId, request: NovelBodyEditRequest) => Promise<RemoteResult<NovelBodyEditResult>>
  newOwnChapter: (sessionId: SessionId, request: NovelOwnChapterRequest) => Promise<RemoteResult<NovelGestureResult & { readonly n?: number }>>
  importOwnChapter: (sessionId: SessionId, request: NovelImportChapterRequest) => Promise<RemoteResult<NovelImportChapterResult>>
  /** The gateway counts both declared arguments; native selection passes an explicit undefined. */
  importDirectory: (sessionId: SessionId, selection: NovelDirectorySelection | undefined) => Promise<RemoteResult<NovelDirectoryImportResult>>
  decideOutline: (sessionId: SessionId, request: NovelOutlineDecideRequest) => Promise<RemoteResult<NovelGestureResult>>
  deletePreview: (request: NovelDeleteRequest) => Promise<RemoteResult<NovelDeletePreviewResult>>
  deleteNode: (sessionId: SessionId, request: NovelDeleteRequest) => Promise<RemoteResult<NovelGestureResult>>
  chapterDeletionPreview: (sessionId: SessionId, request: ChapterDeletionPreviewRequest) => Promise<RemoteResult<ChapterDeletionPreviewResult>>
  applyChapterDeletion: (sessionId: SessionId, request: ChapterDeletionApplyRequest) => Promise<RemoteResult<ChapterDeletionMutationResult>>
  chapterDeletions: (request: NovelWorkRequest) => Promise<RemoteResult<ChapterDeletionListResult>>
  restoreChapters: (sessionId: SessionId, request: ChapterDeletionRestoreRequest) => Promise<RemoteResult<ChapterDeletionMutationResult>>
  purgeChapters: (sessionId: SessionId, request: ChapterDeletionPurgeRequest) => Promise<RemoteResult<ChapterDeletionMutationResult>>
  align: (request: NovelWorkRequest) => Promise<RemoteResult<NovelAlignResult>>
  alignAck: (sessionId: SessionId, request: NovelAlignAckRequest) => Promise<RemoteResult<NovelGestureResult>>
  chapterFeedback: (request: NovelChapterRequest) => Promise<RemoteResult<ChapterFeedbackResult>>
  addChapterFeedback: (sessionId: SessionId, request: ChapterFeedbackAddRequest) => Promise<RemoteResult<ChapterFeedbackMutationResult>>
  deleteChapterFeedback: (sessionId: SessionId, request: ChapterFeedbackDeleteRequest) => Promise<RemoteResult<ChapterFeedbackMutationResult>>
  restoreChapterFeedback: (sessionId: SessionId, request: ChapterFeedbackRestoreRequest) => Promise<RemoteResult<ChapterFeedbackMutationResult>>
  prepareChapterFeedback: (sessionId: SessionId, request: NovelChapterRequest) => Promise<RemoteResult<ChapterFeedbackPrepareResult>>
  recallChapterFeedback: (sessionId: SessionId, request: ChapterFeedbackBatchRequest) => Promise<RemoteResult<ChapterFeedbackMutationResult>>
  submitChapterFeedbackCandidate: (sessionId: SessionId, request: ChapterFeedbackCandidateRequest) => Promise<RemoteResult<ChapterFeedbackMutationResult>>
}

export interface ConversationDraftReceipt {
  readonly before: string
  readonly after: string
}

/** What every surface is injected with. */
export interface NovelFace {
  /** The mounted Remote, or undefined when the host half is not composed. */
  readonly remote: () => NovelRemote | undefined
  /** The host's registered directory flow, absent when this composition has no picker. */
  readonly directoryFlow?: () => ComponentType<DirectoryFlowOwnerProps> | undefined
  /**
   * Put a line into the session's conversation input without sending it
   * (appended to a draft already there), and hand it the keyboard. False
   * when the composition has no conversation input.
   */
  readonly draftToConversation?: (sessionId: SessionId, text: string) => boolean
  readonly fillConversation?: (sessionId: SessionId, text: string) => ConversationDraftReceipt | false
  readonly restoreConversationDraft?: (sessionId: SessionId, receipt: ConversationDraftReceipt) => boolean
  readonly watchChapterFeedback?: (sessionId: SessionId, canvasId: string, batchId: string) => (() => void) | undefined
  readonly registerChapterComment?: (canvasId: string, n: number, open: (sessionId: SessionId) => void) => () => void
  /**
   * Send a line as the person's message when the input is empty; with a
   * draft in it, append instead and send nothing ('drafted'). False when the
   * composition has no conversation input.
   */
  readonly sendToConversation?: (sessionId: SessionId, text: string) => 'sent' | 'drafted' | false
}

/** Props of a strip/page entry: the owner share, the face, the copy. */
export type NovelSurfaceProps<O extends NovelOwnerProps = NovelOwnerProps> = O & NovelFace & {
  readonly t: TranslateNS<'novel'>
}

/** The story-log page's key under the canvas's `genreKey`. */
export const STORY_LOG_PAGE = 'novel:story-log'
/** The 待对齐 page (2026-11-02). */
export const ALIGN_PAGE = 'novel:align'
/** The 章节 face's ask: one chapter to show, on its plan or its text (the canvas's `target`). */
export interface ChapterTarget {
  readonly item: string
  readonly focus?: string | undefined
  readonly n: number
}
