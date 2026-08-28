/**
 * Wire payload vocabulary of the local-files Remote service (the workspace
 * tab's data face). Named re-exports of the service-core types — the browser
 * and (later) other consumers share one semantics by sharing one type source.
 *
 * The read plane mirrors the file-preview vocabulary (`FilePreviewReadKind` /
 * `FilePreviewRead`) so the render layer can reuse the products pane's
 * kind-dispatch logic one-for-one, keeping the two surfaces visually and
 * behaviorally identical.
 *
 * @module @khorsheed/dsh-local-files/types
 */

export type {
  ListLocalDirectoryRequest, ListLocalDirectoryResult, LocalFileEntry,
  LocalFilesService, LocalFilesRead, LocalFilesReadKind, ReadLocalFileRequest,
} from './service.ts'
