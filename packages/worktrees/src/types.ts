/**
 * Wire payload vocabulary of the worktrees Remote service (the badge and the
 * changes drawer's data face). Everything here is a named re-export of the
 * service-core types — the badge, the drawer, and (later) the governance
 * tools share one semantics by sharing one type source.
 *
 * @module @khorsheed/dsh-worktrees/types
 */

export type { ChangedFile, LogRow } from './git.ts'
export type {
  ChangesResult, CommitFilesResult, CommitInfo, FileDiffRequest, FileDiffResult,
  ListLocalDirectoryRequest, ListLocalDirectoryResult, LocalFileEntry,
  ReadFileAtCommitRequest, ReadFileRequest, ReadFileResult, ReadLocalFileRequest, ReadLocalFileResult,
  SessionSummary, WorktreeInfo, WorktreesService,
} from './service.ts'
