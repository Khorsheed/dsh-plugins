/**
 * Composed props contract for the story-bible surface's seats. Both tabs are
 * session scope — their mutations fence through the tab's own session — and
 * share ONE injected face: the work strip atop each tab reads and switches
 * the same registry/focus, and the two tab bodies take the slices they render
 * from it. The surface's own layout state and freshness ride the shared store
 * exposed as `hooks.story` (the slot runtime binds it into the `useStory`
 * prop).
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { GlobalStandardProps, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the generated Remote API (ctx.remote merge + namespace).
import type {} from '@khorsheed/dsh-story-bible/remote'
// Type-only: pulls ui-session's GlobalStandardProps merge (useSessions).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls ui-workspace's GlobalStandardProps merge (useWorkspaces).
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls the right-Sidebar SlotMap seat ('sidebar.right.pane.tab').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {
  ChapterRow, CharacterRecord, ExperienceEntry, ForeshadowExitAction, LedgerResult, MemoryRecord, MentionEntry,
  PatchMemoryRequest, PendingItem, ReviewAction, StoryError, WorkIndexEntry, WorkInfo, WorkMeta,
  WriteCharacterRequest, WriteMemoryRequest,
} from '../types.ts'
import type {} from './locales.ts'
import type { FragmentsView, StoryUiSource } from './store.ts'

/** The story Remote namespace, as mounted by this plugin. */
export type StoryRemote = TypertRemoteNamespaceMap['story']

/** The chapters list's row shape (the Remote's ChapterRow re-exported for the views). */
export type { ChapterRow }

/** One read slice's result: the Remote answers every slice with these. */
export interface StoryDataInjected {
  /** The work registry (the work strip's dropdown source). */
  listWorks: () => Promise<RemoteResult<WorkIndexEntry[]>>
  /** One work's information page (counts computed live; also the strip's counters). */
  readWork: (request: { workId: string }) => Promise<RemoteResult<{ ok: boolean; error?: StoryError; info?: WorkInfo }>>
  /** The session's focused work, or null (the strip's echo). */
  getFocus: (sessionId: SessionId) => Promise<RemoteResult<{ workId: string; title: string } | null>>
  /** Memories, filters ANDed (the wall, the sets, the world rules). */
  listMemories: (request: {
    workId: string
    layer?: MemoryRecord['layer']
    type?: MemoryRecord['type']
    kind?: MemoryRecord['kind']
    intentStatus?: MemoryRecord['intentStatus']
    includeArchived?: boolean
  }) => Promise<RemoteResult<MemoryRecord[]>>
  /** The character cards. */
  listCharacters: (request: { workId: string; includeArchived?: boolean }) => Promise<RemoteResult<CharacterRecord[]>>
  /** One character's experience journal. */
  listExperiences: (request: { workId: string; characterId?: string }) => Promise<RemoteResult<ExperienceEntry[]>>
  /** The chapter index, seq-ordered, phases derived. */
  listChapters: (request: { workId: string }) => Promise<RemoteResult<ChapterRow[]>>
  /** One chapter's metadata and manuscript body. */
  readChapter: (request: { workId: string; n: number }) => Promise<RemoteResult<{
    ok: boolean
    error?: StoryError
    chapter?: ChapterRow['chapter']
    phase?: ChapterRow['phase']
    body?: string
  }>>
  /** The 伏笔沉睡榜 + 健康度. */
  ledger: (request: { workId: string }) => Promise<RemoteResult<LedgerResult>>
  /** The mention journal (the dot strip). */
  listMentions: (request: { workId: string; foreshadowId?: string }) => Promise<RemoteResult<MentionEntry[]>>
  /** The pending queue. */
  listPending: (request: { workId: string; includeResolved?: boolean }) => Promise<RemoteResult<PendingItem[]>>
}

/** The mutation slice: every wrapper touches the shared store on a landed write. */
export interface StoryMutationInjected {
  /** Create one work (title + the mounted workspace's path). */
  createWork: (sessionId: SessionId, request: { title: string; workspace: string }) => Promise<RemoteResult<{ ok: boolean; error?: StoryError; work?: WorkMeta }>>
  /** Switch this session's focus (the work strip's switch). */
  focusWork: (sessionId: SessionId, request: { workId: string }) => Promise<RemoteResult<{ ok: boolean; error?: StoryError }>>
  /** The user's own memory entrance (设定页手写一条). */
  writeMemory: (sessionId: SessionId, request: WriteMemoryRequest) => Promise<RemoteResult<{ ok: boolean; error?: StoryError; memory?: MemoryRecord }>>
  /** The review verb on one memory (采纳/丢弃/归档/撤销). */
  decideMemory: (sessionId: SessionId, request: { workId: string; id: string; action: ReviewAction }) => Promise<RemoteResult<{ ok: boolean; error?: StoryError; memory?: MemoryRecord }>>
  /** Field-level memory edit (derives_from 修订链). */
  patchMemory: (sessionId: SessionId, request: PatchMemoryRequest) => Promise<RemoteResult<{ ok: boolean; error?: StoryError; memory?: MemoryRecord }>>
  /** The field-level character edit. */
  writeCharacter: (sessionId: SessionId, request: WriteCharacterRequest) => Promise<RemoteResult<{ ok: boolean; error?: StoryError; character?: CharacterRecord }>>
  /** The ✓审过 gate. */
  reviewChapter: (sessionId: SessionId, request: { workId: string; n: number }) => Promise<RemoteResult<{ ok: boolean; error?: StoryError }>>
  /** The ✓确认计划 gate. */
  confirmChapterPlan: (sessionId: SessionId, request: { workId: string; n: number }) => Promise<RemoteResult<{ ok: boolean; error?: StoryError }>>
  /** The foreshadow card's three exits. */
  foreshadowExit: (sessionId: SessionId, request: { workId: string; id: string; action: ForeshadowExitAction; answer?: string }) => Promise<RemoteResult<{ ok: boolean; error?: StoryError }>>
  /** The person's answer to one pending item. */
  decidePending: (sessionId: SessionId, request: { workId: string; id: string; action: 'accept' | 'discard' }) => Promise<RemoteResult<{ ok: boolean; error?: StoryError }>>
  /** Take one automatic experience back. */
  retractExperience: (sessionId: SessionId, request: { workId: string; id: string }) => Promise<RemoteResult<{ ok: boolean; error?: StoryError }>>
}

/** The doors out of the surface (each probed, each degrading to hidden). */
export interface StoryDoorInjected {
  /**
   * Open the chapter's manuscript in an external editor: the open-in-app
   * probe's picked IDE on the manuscript DIRECTORY when the host offers one,
   * else the official document preview on the file (`sidebarRight.openResource`)
   * — and the button hides when neither door exists.
   */
  openInEditor: (sessionId: SessionId, workspace: string, title: string, file: string) => void
  /** Whether the editor door exists at all (the button reads it once probed). */
  editorAvailable: () => boolean
  /** The plan row's 「去确认」: point the reader at one chapter and open its tab. */
  openReaderAt: (n: number) => void
  /** The extract row's 「去处理」: pulse the pending queue and open the fragments tab. */
  openPending: () => void
  /** Jump the 设定集's 「角色记忆 →」 link (fragments tab, characters view, that character). */
  openCharacter: (characterId: string) => void
  /** Switch the fragments tab's view. */
  setFragmentsView: (view: FragmentsView) => void
  /** Select the 角色记忆 pane's character. */
  setCmCharacter: (id: string | null) => void
  /** Move the 心智时间游标 (null = latest). */
  setCmCursor: (n: number | null) => void
  /** Nudge every reader to re-read (the main session's writes are unannounced; the visible tab polls on a slow beat). */
  refresh: () => void
}

/** Business face injected into both story tabs. */
export interface StoryTabInjected extends StoryDataInjected, StoryMutationInjected, StoryDoorInjected {
  hooks: {
    /** The shared layout/freshness feed, bound by the slot renderer. */
    story: StoryUiSource
  }
}

/** Full props of either story tab body. */
export type StoryTabProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & GlobalStandardProps
  & InjectFace<StoryTabInjected>
  & PropsLocale<'story'>

/** The fragments tab's chip needs the pending count: the chip face is read-only. */
export interface StoryTabTitleInjected {
  /** The pending count (already resolved by the apply-level poller). */
  pendingCount: () => number
  hooks: {
    story: StoryUiSource
  }
}

/** Full props of the fragments tab's chip title. */
export type StoryTabTitleProps =
  PropsRuntime<'sidebar.right.pane.tab.title'>
  & GlobalStandardProps
  & InjectFace<{ hooks: { story: StoryUiSource } }>

/** What a toolview row reaches outside its own block. */
export interface StoryRowFace {
  /** The plan row's door: reader tab at one chapter. */
  openReaderAt: (n: number) => void
  /** The extract row's door: fragments tab's pending queue. */
  openPending: () => void
}
