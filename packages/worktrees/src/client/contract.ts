/**
 * Slot-facing types of the worktrees client half: the injected faces and the
 * composed props of its entries — the session-header badge
 * (`conversation.session.header.utilities`), the right-Sidebar page tab
 * (`sidebar.right.pane.tab`), and the frame-wide local-files browser
 * (`shell.overlay`).
 */
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
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
// Type-only: pulls ui-session's SessionStandardProps merge (sessionId).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the right-Sidebar SlotMap seats ('sidebar.right.pane.tab')
// and the tab-params map this package merges into.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// Type-only: pulls this plugin's LocaleNamespaceMap merge.
import type {} from './locales.ts'
import type {
  BadgeConfig, ChangesResult, CommitFilesResult, CommitInfo, FileDiffRequest, FileDiffResult,
  ListLocalDirectoryRequest, ListLocalDirectoryResult, LocalImageResult,
  ReadFileAtCommitRequest, ReadFileRequest, ReadFileResult,
  ReadLocalFileRequest, ReadLocalFileResult, ReadLocalImageRequest, ReadRepoImageRequest,
  PluginInventorySnapshot, SessionSummary, WorktreeInfo,
} from '../types.ts'
import type { OpenInAppSource } from './open-in-app.ts'
import type { createLocalFilesStore } from './store-local.ts'
import type { createWorktreesStore, DrawerMode } from './store.ts'

/** Business face injected into the session-header badge entry. */
export interface WorktreesBadgeInjected {
  /** Fetch one session's worktree summary (one RPC). */
  summary: (sessionId: SessionId) => Promise<RemoteResult<SessionSummary>>
  /**
   * Fetch the badge's display gate (the composition's `visiblePresets` over
   * the Remote — the web boot hands client entries no config, so the gate
   * arrives through the data face). An empty list keeps the badge visible.
   */
  fetchBadgeConfig: () => Promise<RemoteResult<BadgeConfig>>
  /**
   * Fetch the OFFICIAL plugin inventory — the preset-composition data the
   * badge's DEFAULT visibility criterion reads ("the current session's
   * preset composition names the `@khorsheed/dsh-worktrees-tool` row").
   * Undefined on a host without the pluginInventory namespace (the read is
   * probed, never injected): the badge then has no composition data and
   * fails open. A configured `visiblePresets` overrides this criterion, so
   * the fetch is skipped whenever the list is non-empty anyway.
   */
  fetchComposition?: () => Promise<RemoteResult<PluginInventorySnapshot>>
  /** Open the worktrees right-Sidebar tab in one mode. */
  open: (mode: DrawerMode) => void
  /** Subscribe to active-worktree changes (a tab switch bumps it). */
  subscribeVersion: (listener: () => void) => () => void
  /** The current active-worktree version (for re-fetch sequencing). */
  getVersion: () => number
}

/** Full props of the session-header badge entry. */
export type WorktreesBadgeProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & InjectFace<WorktreesBadgeInjected>
  & PropsLocale<'worktrees'>

/** Business face injected into the right-Sidebar worktrees tab body. */
export interface WorktreesTabInjected {
  fetchSummary: (sessionId: SessionId) => Promise<RemoteResult<SessionSummary>>
  fetchChanges: (sessionId: SessionId) => Promise<RemoteResult<ChangesResult>>
  fetchRepoFiles: (sessionId: SessionId) => Promise<RemoteResult<string[]>>
  fetchCommitLog: (sessionId: SessionId) => Promise<RemoteResult<CommitInfo[]>>
  fetchCommitFiles: (sessionId: SessionId, sha: string) => Promise<RemoteResult<CommitFilesResult>>
  /** List the repository's worktrees (the switcher dropdown). */
  fetchWorktrees: (sessionId: SessionId) => Promise<RemoteResult<WorktreeInfo[]>>
  /** Point the session's active worktree at another worktree. */
  switchWorktree: (sessionId: SessionId, path: string) => Promise<RemoteResult<WorktreeInfo>>
  /** Bump the version so the session-header badge re-fetches its summary. */
  bumpVersion: () => void
  /** Direct the agent to work in the switched worktree (inject, no wake). */
  directAgent: (sessionId: SessionId, path: string, branch: string | null) => Promise<RemoteResult<{ ok: true }>>
  fetchFileDiff: (sessionId: SessionId, request: FileDiffRequest) => Promise<RemoteResult<FileDiffResult>>
  fetchReadFile: (sessionId: SessionId, request: ReadFileRequest) => Promise<RemoteResult<ReadFileResult>>
  fetchReadFileAtCommit: (sessionId: SessionId, request: ReadFileAtCommitRequest) => Promise<RemoteResult<ReadFileResult>>
  /** Read a repo-relative file as an inline image (the repo browser's image data plane). */
  fetchReadRepoImage: (sessionId: SessionId, request: ReadRepoImageRequest) => Promise<RemoteResult<LocalImageResult>>
  hooks: {
    /** The official open-in-app probe feed (null until the host answered), bound by the slot renderer. */
    openInApp: OpenInAppSource
  }
  /**
   * Open a directory with one probed host application (the official
   * open-in-app POST route; directories only).
   */
  openExternal: (appId: string, path: string) => void
  /** Copy the branch name to the clipboard; resolves true only on acceptance. */
  copyBranch: (branch: string) => Promise<boolean>
}

/** Full props of the right-Sidebar worktrees tab body entry. */
export type WorktreesTabProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<ReturnType<typeof createWorktreesStore>>
  & InjectFace<WorktreesTabInjected>
  & PropsLocale<'worktrees'>

/** Business face injected into the root overlay local-files browser entry. */
export interface LocalFilesDrawerInjected {
  /** List one local directory (git-agnostic browser plane). */
  listLocalDirectory: (request: ListLocalDirectoryRequest) => Promise<RemoteResult<ListLocalDirectoryResult>>
  /** Read one local file for preview (git-agnostic content plane). */
  readLocalFile: (request: ReadLocalFileRequest) => Promise<RemoteResult<ReadLocalFileResult>>
  /** Read one local file as an inline image (git-agnostic image plane). */
  readLocalImage: (request: ReadLocalImageRequest) => Promise<RemoteResult<LocalImageResult>>
  /** The registered workspaces feed (the browser's workspace switcher). */
  listWorkspaces: () => readonly { id: string; title: string; path: string }[]
  /** Open the host's native directory picker; resolves the chosen path, or null when cancelled. */
  pickWorkspace: () => Promise<string | null>
  hooks: {
    /** The official open-in-app probe feed (null until the host answered), bound by the slot renderer. */
    openInApp: OpenInAppSource
  }
  /** Open a directory with one probed host application (official open-in-app route; directories only). */
  openExternal: (appId: string, path: string) => void
}

/** Full props of the root overlay local-files browser entry. */
export type LocalFilesDrawerProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createLocalFilesStore>>
  & InjectFace<LocalFilesDrawerInjected>
  & PropsLocale<'worktrees'>

/** The worktrees Remote namespace (as mounted by this plugin). */
export type WorktreesRemote = TypertRemoteNamespaceMap['worktrees']
