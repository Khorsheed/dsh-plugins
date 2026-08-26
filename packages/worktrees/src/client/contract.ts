/**
 * Slot-facing types of the worktrees client half: the injected faces and the
 * composed props of its two entries — the session-header badge
 * (`conversation.session.header.utilities`) and the frame-wide drawer
 * (`shell.overlay`).
 */
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  InjectFace, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@khorsheed/dsh-worktrees/remote'
// Type-only: pulls ui-conversation's SlotMap merge
// ('conversation.session.header.utilities').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-layout frame's SlotMap merge ('shell.overlay').
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls this plugin's LocaleNamespaceMap merge.
import type {} from './locales.ts'
import type {
  ChangesResult, CommitFilesResult, CommitInfo, FileDiffRequest, FileDiffResult,
  ListLocalDirectoryRequest, ListLocalDirectoryResult,
  ReadFileAtCommitRequest, ReadFileRequest, ReadFileResult, ReadLocalFileRequest, ReadLocalFileResult,
  SessionSummary, WorktreeInfo,
} from '../types.ts'
import type { createLocalFilesStore } from './store-local.ts'
import type { createWorktreesStore, DrawerMode } from './store.ts'

/** Business face injected into the session-header badge entry. */
export interface WorktreesBadgeInjected {
  /** Fetch one session's worktree summary (one RPC). */
  summary: (sessionId: SessionId) => Promise<RemoteResult<SessionSummary>>
  /** Open the drawer in one mode (routes to the root drawer store). */
  open: (mode: DrawerMode) => void
  /** Open the local-files browser from a starting directory. */
  openLocalFiles: (start: string) => void
}

/** Full props of the session-header badge entry. */
export type WorktreesBadgeProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & InjectFace<WorktreesBadgeInjected>
  & PropsLocale<'worktrees'>

/** Business face injected into the root overlay drawer entry. */
export interface WorktreesDrawerInjected {
  fetchSummary: (sessionId: SessionId) => Promise<RemoteResult<SessionSummary>>
  fetchChanges: (sessionId: SessionId) => Promise<RemoteResult<ChangesResult>>
  fetchRepoFiles: (sessionId: SessionId) => Promise<RemoteResult<string[]>>
  fetchCommitLog: (sessionId: SessionId) => Promise<RemoteResult<CommitInfo[]>>
  fetchCommitFiles: (sessionId: SessionId, sha: string) => Promise<RemoteResult<CommitFilesResult>>
  /** List the repository's worktrees (the switcher dropdown). */
  fetchWorktrees: (sessionId: SessionId) => Promise<RemoteResult<WorktreeInfo[]>>
  /** Point the session's active worktree at another worktree. */
  switchWorktree: (sessionId: SessionId, path: string) => Promise<RemoteResult<WorktreeInfo>>
  /** Direct the agent to work in the switched worktree (inject, no wake). */
  directAgent: (sessionId: SessionId, path: string, branch: string | null) => Promise<RemoteResult<{ ok: true }>>
  fetchFileDiff: (sessionId: SessionId, request: FileDiffRequest) => Promise<RemoteResult<FileDiffResult>>
  fetchReadFile: (sessionId: SessionId, request: ReadFileRequest) => Promise<RemoteResult<ReadFileResult>>
  fetchReadFileAtCommit: (sessionId: SessionId, request: ReadFileAtCommitRequest) => Promise<RemoteResult<ReadFileResult>>
  /** Whether the browser itself is connected over loopback. */
  isLoopback: boolean
  hooks: {
    /** Current generation's Host description, bound by the slot renderer. */
    hostDescription: HostDescriptionSource
  }
  /** Open the worktree path with the host default application (folder/IDE). */
  openExternal: (path: string) => void
  /** Copy the branch name to the clipboard; resolves true only on acceptance. */
  copyBranch: (branch: string) => Promise<boolean>
}

/** Full props of the root overlay drawer entry. */
export type WorktreesDrawerProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createWorktreesStore>>
  & InjectFace<WorktreesDrawerInjected>
  & PropsLocale<'worktrees'>

/** Business face injected into the root overlay local-files browser entry. */
export interface LocalFilesDrawerInjected {
  /** List one local directory (git-agnostic browser plane). */
  listLocalDirectory: (request: ListLocalDirectoryRequest) => Promise<RemoteResult<ListLocalDirectoryResult>>
  /** Read one local file for preview (git-agnostic content plane). */
  readLocalFile: (request: ReadLocalFileRequest) => Promise<RemoteResult<ReadLocalFileResult>>
  /** The registered workspaces feed (the browser's workspace switcher). */
  workspacesList: () => readonly { id: string; title: string; path: string }[]
  /** Whether the browser itself is connected over loopback. */
  isLoopback: boolean
  hooks: {
    /** Current generation's Host description, bound by the slot renderer. */
    hostDescription: HostDescriptionSource
  }
  /** Open a path with the host default application (folder/IDE). */
  openExternal: (path: string) => void
}

/** Full props of the root overlay local-files browser entry. */
export type LocalFilesDrawerProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createLocalFilesStore>>
  & InjectFace<LocalFilesDrawerInjected>
  & PropsLocale<'worktrees'>

/** The worktrees Remote namespace (as mounted by this plugin). */
export type WorktreesRemote = TypertRemoteNamespaceMap['worktrees']
