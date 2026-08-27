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
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ChangesResult, CommitFilesResult, FileDiffRequest, FileDiffResult,
  ListLocalDirectoryRequest, ListLocalDirectoryResult, LocalImageResult,
  ReadFileAtCommitRequest, ReadFileRequest, ReadFileResult,
  ReadLocalFileRequest, ReadLocalFileResult, ReadLocalImageRequest, ReadRepoImageRequest,
  SessionSummary, WorktreeInfo, WorktreesService,
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

  /** The repository's committed (tracked) file list. */
  @Remote('repoFiles')
  repoFiles(agent: Agent): Promise<string[]> {
    return this.worktrees.repoFiles(this.cwd(agent))
  }

  /** All worktrees of the session's repository (the switcher dropdown). */
  @Remote('listWorktrees')
  listWorktrees(agent: Agent): Promise<WorktreeInfo[]> {
    return this.worktrees.listWorktrees(this.cwd(agent))
  }

  /** Point the session's active worktree at another worktree. */
  @Remote('switchWorktree')
  switchWorktree(agent: Agent, request: { path: string }): Promise<WorktreeInfo> {
    return this.worktrees.switchWorktree(agent.id, this.cwd(agent), request.path)
  }

  /**
   * Direct the calling agent to work in a specific worktree by appending a
   * context message to the session WITHOUT waking it. The message is appended
   * as a durable `user/message` (`surfaceOp: 'append'`), which the transcript
   * renders immediately as a 上下文注入 row (the renderer classifies by
   * `source.kind`, and a `plugin` source is a non-user context, not a user
   * bubble), and which `session.deriveMessages()` folds into the next model
   * boundary — so the agent reads it on its next natural turn at no extra
   * model call (no wake). Unlike `agent.inject` (inbox, `next-step`), an
   * appended session message is visible even while the agent is idle, instead
   * of sitting pending in the inbox until the agent is next woken.
   */
  @Remote('directAgent')
  directAgent(agent: Agent, request: { path: string; branch: string | null }): Promise<{ ok: true }> {
    const label = request.branch ?? request.path
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `本会话已切换到 worktree「${label}」(${request.path})。后续文件/命令行工具请用 workdir=${request.path} 干活。` }],
      source: {
        kind: 'plugin',
        plugin: '@khorsheed/dsh-worktrees',
        form: 'notice',
        summary: boundContextSummary(`已切换到 worktree「${label}」`),
      },
    }), { surfaceOp: 'append' })
    return Promise.resolve({ ok: true })
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

  /** List one local directory — the git-agnostic browser's directory plane.
   * The path is absolute and independent of the session workspace, so the
   * method takes NO caller lookup parameter (pure JSON args): any session or
   * the global frame may call it. */
  @Remote('listLocalDirectory')
  listLocalDirectory(request: ListLocalDirectoryRequest): Promise<ListLocalDirectoryResult> {
    return this.worktrees.listLocalDirectory(request.path)
  }

  /** Read one local file for preview — the git-agnostic browser's content
   * plane. The path is absolute and independent of the session workspace, so
   * the method takes NO caller lookup parameter (pure JSON args). */
  @Remote('readLocalFile')
  readLocalFile(request: ReadLocalFileRequest): Promise<ReadLocalFileResult> {
    return this.worktrees.readLocalFile(request.path)
  }

  /** Read a repo-relative file as an inline image (the repo browser's data
   * plane; resolves the session's repository, like the other git data face). */
  @Remote('readRepoImage')
  readRepoImage(agent: Agent, request: ReadRepoImageRequest): Promise<LocalImageResult> {
    return this.worktrees.readRepoImage(this.cwd(agent), request.path)
  }

  /** Read one local file as an inline image — the git-agnostic browser's image
   * plane. The path is absolute and independent of the session workspace, so
   * the method takes NO caller lookup parameter (pure JSON args). */
  @Remote('readLocalImage')
  readLocalImage(request: ReadLocalImageRequest): Promise<LocalImageResult> {
    return this.worktrees.readLocalImage(request.path)
  }
}
