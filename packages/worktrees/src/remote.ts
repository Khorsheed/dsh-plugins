/**
 * The worktrees Remote service: the badge and changes drawer's data face. A
 * thin adapter over the same `ctx.worktrees` service core — no logic is
 * copied here. Every method takes the calling `agent` as its first
 * parameter, resolves the session workspace (`header.cwd`) from it, and
 * delegates to the service core, so the Remote path is exactly as strong as
 * the tool path. The cordis service key is `worktreesRemote` (`worktrees` is
 * the core service); the WIRE namespace is `worktrees`, so the browser calls
 * `remote.worktrees.*`.
 *
 * @module @khorsheed/dsh-worktrees
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ChangesResult, CommitFilesResult, FileDiffRequest, FileDiffResult,
  ReadFileAtCommitRequest, ReadFileRequest, ReadFileResult, SessionSummary, WorktreesService,
} from './service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    worktreesRemote: WorktreesRemoteService
  }
}

/** Remote construction options (reserved for future config-driven knobs). */
export interface WorktreesRemoteConfig {}

/**
 * Session-scoped worktree status for web surfaces. The wire namespace is
 * `worktrees`; the browser calls `remote.worktrees.<method>(sessionId, …)`.
 */
export class WorktreesRemoteService extends TypertRemoteService<WorktreesRemoteConfig> {
  static inject = ['worktrees']

  /**
   * @param ctx - owning Cordis Context carrying `worktrees` (provided by the
   *   plugin's apply before this service mounts).
   * @param _config - reserved for future knobs (unused today).
   */
  constructor(ctx: Context, _config: WorktreesRemoteConfig = {}) {
    super(ctx, 'worktreesRemote', { namespace: 'worktrees' })
  }

  private get worktrees(): WorktreesService {
    return this.ctx.worktrees
  }

  /** The calling session's workspace; '' when the session has none. Prefers
   * the session's active-worktree override (set by the model-facing tool) and
   * falls back to the session's static `header.cwd`. */
  private cwd(agent: Agent): string {
    return this.worktrees.activeWorktreeOf(agent.id) ?? (agent.session.header.cwd ?? '')
  }

  /** The badge + drawer summary for the calling session's worktree. */
  @Remote('summary')
  summary(agent: Agent): Promise<SessionSummary> {
    return this.worktrees.summary(this.cwd(agent))
  }

  /** Both change segments for the drawer's file tree. */
  @Remote('changes')
  changes(agent: Agent): Promise<ChangesResult> {
    return this.worktrees.changes(this.cwd(agent))
  }

  /** The repository's full tracked+untracked file list. */
  @Remote('repoFiles')
  repoFiles(agent: Agent): Promise<string[]> {
    return this.worktrees.repoFiles(this.cwd(agent))
  }

  /** The branch's own commit log (`base..HEAD`). */
  @Remote('commitLog')
  commitLog(agent: Agent): Promise<import('./service.ts').CommitInfo[]> {
    return this.worktrees.commitLog(this.cwd(agent))
  }

  /** One commit's changed files. */
  @Remote('commitFiles')
  commitFiles(agent: Agent, request: { sha: string }): Promise<CommitFilesResult> {
    return this.worktrees.commitFiles(this.cwd(agent), request.sha)
  }

  /** One file's unified diff in one segment (commit segment carries the sha). */
  @Remote('fileDiff')
  fileDiff(agent: Agent, request: FileDiffRequest): Promise<FileDiffResult> {
    return this.worktrees.fileDiff(this.cwd(agent), request.path, request.segment, request.commit)
  }

  /** One file's current content. */
  @Remote('readFile')
  readFile(agent: Agent, request: ReadFileRequest): Promise<ReadFileResult> {
    return this.worktrees.readFile(this.cwd(agent), request.path)
  }

  /** One file's content at one commit (the commits mode's content view). */
  @Remote('readFileAtCommit')
  readFileAtCommit(agent: Agent, request: ReadFileAtCommitRequest): Promise<ReadFileResult> {
    return this.worktrees.readFileAtCommit(this.cwd(agent), request.path, request.commit)
  }
}
