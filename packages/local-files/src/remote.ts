/**
 * The local-files Remote service: the workspace tab's data face. A thin
 * adapter over the same `ctx.localFiles` service core — no logic is copied.
 * Every method takes an ABSOLUTE path independent of any session workspace, so
 * the methods take NO caller lookup parameter (pure JSON args): any session or
 * the global frame may call them.
 *
 * @module @khorsheed/dsh-local-files
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ListLocalDirectoryRequest, ListLocalDirectoryResult, LocalFilesRead,
  ReadLocalFileRequest, LocalFilesService,
} from './service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    localFilesRemote: LocalFilesRemoteService
  }
}

/** Remote construction options (reserved for future config-driven knobs). */
export interface LocalFilesRemoteConfig {}

/**
 * Session-scoped local-files status for web surfaces. The wire namespace is
 * `localFiles`; the browser calls `remote.localFiles.*`.
 */
export class LocalFilesRemoteService extends TypertRemoteService<LocalFilesRemoteConfig> {
  static inject = ['localFiles']

  constructor(ctx: Context, _config: LocalFilesRemoteConfig = {}) {
    super(ctx, 'localFilesRemote', { namespace: 'localFiles' })
  }

  private get localFiles(): LocalFilesService {
    return this.ctx.localFiles
  }

  /** List one local directory — the git-agnostic browser's directory plane.
   * The path is absolute and independent of the session workspace, so the
   * method takes NO caller lookup parameter (pure JSON args). */
  @Remote('listDirectory')
  listDirectory(request: ListLocalDirectoryRequest): Promise<ListLocalDirectoryResult> {
    return this.localFiles.listLocalDirectory(request.path)
  }

  /** Read one local file for preview — the git-agnostic browser's content
   * plane. The path is absolute; no caller lookup parameter. The optional
   * `offset` starts the text window mid-file (a truncated read's `nextOffset`
   * continues it); image reads ignore it. */
  @Remote('readFile')
  readFile(request: ReadLocalFileRequest): Promise<LocalFilesRead> {
    return this.localFiles.readFile(request.path, request.offset)
  }
}
