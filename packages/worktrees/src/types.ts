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
  BadgeConfig, ChangesResult, CommitFilesResult, CommitInfo, FileDiffRequest, FileDiffResult,
  ListLocalDirectoryRequest, ListLocalDirectoryResult, LocalFileEntry,
  LocalImageResult, ReadFileAtCommitRequest, ReadFileRequest, ReadFileResult,
  ReadLocalFileRequest, ReadLocalFileResult, ReadLocalImageRequest, ReadRepoImageRequest,
  SessionSummary, WorktreeInfo, WorktreesService,
} from './service.ts'

/**
 * Minimal structural mirror of the OFFICIAL pluginInventory snapshot — only
 * the slice the badge's default visibility criterion reads (the
 * agentPresets composition groups). The full contract lives in the host's
 * `@deepseek-ai/dsh-plugin-inventory`; mirroring the two fields here keeps
 * the read duck-typed and host-version tolerant (an extra field never
 * breaks a structural read).
 */

/** One plugin row a preset composition names (only the read field mirrored). */
export interface PluginInventoryCompositionRow {
  readonly moduleName: string
}

/** One preset's composition in the inventory (broken = rows unreadable). */
export interface PluginInventoryPresetGroup {
  readonly id: string
  readonly broken?: string
  readonly rows: readonly PluginInventoryCompositionRow[]
}

/** The inventory snapshot's preset slice (absent on roster-less hosts). */
export interface PluginInventorySnapshot {
  readonly agentPresets?: readonly PluginInventoryPresetGroup[]
}
