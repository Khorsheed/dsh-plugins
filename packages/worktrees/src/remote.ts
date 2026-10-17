/**
 * The worktrees Remote service: the badge and changes drawer's data face. A
 * thin adapter over the same `ctx.worktreesCore` service core — no logic is
 * copied here. The AGENT-BOUND half takes the calling `agent` as its first
 * parameter, resolves the session workspace (`header.cwd`, or the session's
 * active-worktree override) from it, and delegates to the service core, so
 * the Remote path is exactly as strong as the tool path. The AGENT-FREE half
 * (the `*At` query verbs, `worktreeBinding`, `switchWorktreeControlled`)
 * takes explicit plain-JSON arguments — an absolute repository anchor, a
 * plain-string session id — so a trusted server-side caller can query and
 * re-bind workspaces WITHOUT the host's unified agent lookup (which may
 * resume offline sessions). Like the local-files verbs, the agent-free half
 * accepts any absolute path: authorization and jailing are the trusted
 * caller's job, never this surface's. The cordis service key is
 * `worktreesRemote` (`worktreesCore` is the core service); the WIRE namespace is
 * `worktrees`, so the browser calls `remote.worktrees.*`.
 *
 * @module @khorsheed/dsh-worktrees
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { boundContextSummary, createUserMessage, type ContextFormed } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ControlledSwitchReceipt, ControlledSwitchRequest, WorktreeBinding } from './bindings.ts'
import {
  assertSafeLocalPath, type BadgeConfig, type ChangesResult, type CommitFilesResult, type FileDiffRequest,
  type FileDiffResult, type ListLocalDirectoryRequest, type ListLocalDirectoryResult, type LocalImageResult,
  type ReadFileAtCommitRequest, type ReadFileRequest, type ReadFileResult,
  type ReadLocalFileRequest, type ReadLocalFileResult, type ReadLocalImageRequest, type ReadRepoImageRequest,
  type SessionSummary, type WorktreeInfo, type WorktreesService,
} from './service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    worktreesRemote: WorktreesRemoteService
  }
}

/**
 * The worktrees producer's durable identity: the current producer-owned kind
 * (`worktrees`) and the released V3 wrapper's `plugin` value (the official
 * V3→V4 migration rewrites it to `kind: 'plugin:@khorsheed/dsh-worktrees'`).
 * {@link isWorktreesSource} accepts all three forms; new writes always carry
 * the producer kind.
 */
export const WORKTREES_PLUGIN = '@khorsheed/dsh-worktrees'

/** The producer-owned source kind identifying the directAgent context message. */
export const WORKTREES_KIND = 'worktrees'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** worktrees producer: the worktree-switch context message appended without waking the agent. */
    worktrees: { kind: 'worktrees' } & ContextFormed
  }
}

/**
 * Whether a durable source belongs to the worktrees producer, in every form
 * the log can hold: the current producer-owned kind, the V3→V4 migrated
 * kind, and the released V3 wrapper a pre-V4 (0.1.5) host still serves
 * verbatim.
 * @param source - the persisted message source to test.
 * @returns true when the source names this producer.
 */
export function isWorktreesSource(source: unknown): boolean {
  if (typeof source !== 'object' || source === null) return false
  const record = source as { kind?: unknown; plugin?: unknown }
  return record.kind === WORKTREES_KIND
    || record.kind === `plugin:${WORKTREES_PLUGIN}`
    || (record.kind === 'plugin' && record.plugin === WORKTREES_PLUGIN)
}

/** Remote construction options: the badge's display gate, forwarded from the plugin config. */
export interface WorktreesRemoteConfig {
  /** The composition's `visiblePresets` (empty = the badge always shows). */
  visiblePresets?: string[]
}

/**
 * Session-scoped worktree status for web surfaces. The wire namespace is
 * `worktrees`; the browser calls `remote.worktrees.<method>(sessionId, …)`.
 */
export class WorktreesRemoteService extends TypertRemoteService<WorktreesRemoteConfig> {
  static inject = ['worktreesCore']

  /**
   * @param ctx - owning Cordis Context carrying `worktreesCore` (provided by the
   *   plugin's apply before this service mounts).
   * @param config - the badge's display gate, forwarded from the plugin config.
   */
  constructor(ctx: Context, config: WorktreesRemoteConfig = {}) {
    super(ctx, 'worktreesRemote', { namespace: 'worktrees' })
    this.visiblePresets = config.visiblePresets ?? []
  }

  /** The composition's `visiblePresets` (empty = the badge always shows). */
  private readonly visiblePresets: string[]

  private get worktrees(): WorktreesService {
    return this.ctx.worktreesCore
  }

  /** The calling session's workspace; '' when the session has none. Prefers
   * the session's active-worktree override (set by the model-facing tool) and
   * falls back to the session's static `header.cwd`. Awaits the bindings load
   * first, so a persisted override survives a host restart for this path too. */
  private async cwd(agent: Agent): Promise<string> {
    await this.worktrees.bindingsReady()
    return this.worktrees.activeWorktreeOf(agent.id) ?? (agent.session.header.cwd ?? '')
  }

  /**
   * The badge's display gate: composition-level config, identical for every
   * session, so the method takes NO caller lookup parameter (pure JSON args).
   * The browser half reads it once per badge mount; an empty `visiblePresets`
   * means the gate is off (the zero-change default).
   */
  @Remote('badgeConfig')
  badgeConfig(): Promise<BadgeConfig> {
    return Promise.resolve({ visiblePresets: this.visiblePresets })
  }

  /** The badge + drawer summary for the calling session's worktree. */
  @Remote('summary')
  async summary(agent: Agent): Promise<SessionSummary> {
    return this.worktrees.summary(await this.cwd(agent))
  }

  /** Both change segments for the drawer's file tree. */
  @Remote('changes')
  async changes(agent: Agent): Promise<ChangesResult> {
    return this.worktrees.changes(await this.cwd(agent))
  }

  /** The repository's committed (tracked) file list. */
  @Remote('repoFiles')
  async repoFiles(agent: Agent): Promise<string[]> {
    return this.worktrees.repoFiles(await this.cwd(agent))
  }

  /** All worktrees of the session's repository (the switcher dropdown). */
  @Remote('listWorktrees')
  async listWorktrees(agent: Agent): Promise<WorktreeInfo[]> {
    return this.worktrees.listWorktrees(await this.cwd(agent))
  }

  /** Point the session's active worktree at another worktree. */
  @Remote('switchWorktree')
  async switchWorktree(agent: Agent, request: { path: string }): Promise<WorktreeInfo> {
    return this.worktrees.switchWorktree(agent.id, await this.cwd(agent), request.path)
  }

  /**
   * Direct the calling agent to work in a specific worktree by appending a
   * context message to the session WITHOUT waking it. The message is appended
   * as a durable `user/message` (`surfaceOp: 'append'`), which the transcript
   * renders immediately as a 上下文注入 row (the renderer classifies by
   * `source.kind`, and any non-`user` producer kind is a non-user context,
   * not a user bubble), and which `session.deriveMessages()` folds into the
   * next model boundary — so the agent reads it on its next natural turn at
   * no extra model call (no wake). Unlike `agent.inject` (inbox,
   * `next-step`), an appended session message is visible even while the
   * agent is idle, instead of sitting pending in the inbox until the agent
   * is next woken.
   */
  @Remote('directAgent')
  directAgent(agent: Agent, request: { path: string; branch: string | null }): Promise<{ ok: true }> {
    const label = request.branch ?? request.path
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `本会话已切换到 worktree「${label}」(${request.path})。后续文件/命令行工具请用 workdir=${request.path} 干活。` }],
      source: {
        kind: WORKTREES_KIND,
        form: 'notice',
        summary: boundContextSummary(`已切换到 worktree「${label}」`),
      },
    }), { surfaceOp: 'append' })
    return Promise.resolve({ ok: true })
  }

  /** The branch's own commit log (`base..HEAD`). */
  @Remote('commitLog')
  async commitLog(agent: Agent): Promise<import('./service.ts').CommitInfo[]> {
    return this.worktrees.commitLog(await this.cwd(agent))
  }

  /** One commit's changed files. */
  @Remote('commitFiles')
  async commitFiles(agent: Agent, request: { sha: string }): Promise<CommitFilesResult> {
    return this.worktrees.commitFiles(await this.cwd(agent), request.sha)
  }

  /** One file's unified diff in one segment (commit segment carries the sha). */
  @Remote('fileDiff')
  async fileDiff(agent: Agent, request: FileDiffRequest): Promise<FileDiffResult> {
    return this.worktrees.fileDiff(await this.cwd(agent), request.path, request.segment, request.commit)
  }

  /** One file's current content. */
  @Remote('readFile')
  async readFile(agent: Agent, request: ReadFileRequest): Promise<ReadFileResult> {
    return this.worktrees.readFile(await this.cwd(agent), request.path)
  }

  /** One file's content at one commit (the commits mode's content view). */
  @Remote('readFileAtCommit')
  async readFileAtCommit(agent: Agent, request: ReadFileAtCommitRequest): Promise<ReadFileResult> {
    return this.worktrees.readFileAtCommit(await this.cwd(agent), request.path, request.commit)
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
  async readRepoImage(agent: Agent, request: ReadRepoImageRequest): Promise<LocalImageResult> {
    return this.worktrees.readRepoImage(await this.cwd(agent), request.path)
  }

  /** Read one local file as an inline image — the git-agnostic browser's image
   * plane. The path is absolute and independent of the session workspace, so
   * the method takes NO caller lookup parameter (pure JSON args). */
  @Remote('readLocalImage')
  readLocalImage(request: ReadLocalImageRequest): Promise<LocalImageResult> {
    return this.worktrees.readLocalImage(request.path)
  }

  /* ------------------------------------------------------------------ *
   * The AGENT-FREE half: every verb takes an explicit absolute repository
   * anchor (`at` — any path inside the target repository/worktree; the
   * toplevel is resolved host-side) or a plain-string session id, so a
   * trusted server-side caller never triggers the host's unified agent
   * lookup (which may RESUME offline sessions). Like the local-files
   * verbs above, any absolute path is accepted — authorization/jailing
   * is the trusted caller's job; the surface only rejects non-absolute
   * or traversal-shaped anchors. Return shapes are exactly the
   * agent-bound twins', by delegation to the same service core.
   * ------------------------------------------------------------------ */

  /** The anchor validation shared by the agent-free verbs. */
  private static anchor(at: string): string {
    return assertSafeLocalPath(at)
  }

  /** Agent-free twin of {@link summary}: the badge/drawer summary for the repository at `at`. */
  @Remote('summaryAt')
  async summaryAt(request: { at: string }): Promise<SessionSummary> {
    return this.worktrees.summary(WorktreesRemoteService.anchor(request.at))
  }

  /** Agent-free twin of {@link changes}: both change segments for the repository at `at`. */
  @Remote('changesAt')
  async changesAt(request: { at: string }): Promise<ChangesResult> {
    return this.worktrees.changes(WorktreesRemoteService.anchor(request.at))
  }

  /** Agent-free twin of {@link repoFiles}: the committed file list of the repository at `at`. */
  @Remote('repoFilesAt')
  async repoFilesAt(request: { at: string }): Promise<string[]> {
    return this.worktrees.repoFiles(WorktreesRemoteService.anchor(request.at))
  }

  /** Agent-free twin of {@link listWorktrees}: all worktrees of the repository at `at`. */
  @Remote('listWorktreesAt')
  async listWorktreesAt(request: { at: string }): Promise<WorktreeInfo[]> {
    return this.worktrees.listWorktrees(WorktreesRemoteService.anchor(request.at))
  }

  /** Agent-free twin of {@link commitLog}: the commit log of the checkout at `at`. */
  @Remote('commitLogAt')
  async commitLogAt(request: { at: string }): Promise<import('./service.ts').CommitInfo[]> {
    return this.worktrees.commitLog(WorktreesRemoteService.anchor(request.at))
  }

  /** Agent-free twin of {@link commitFiles}: one commit's changed files in the repository at `at`. */
  @Remote('commitFilesAt')
  async commitFilesAt(request: { at: string, sha: string }): Promise<CommitFilesResult> {
    return this.worktrees.commitFiles(WorktreesRemoteService.anchor(request.at), request.sha)
  }

  /** Agent-free twin of {@link fileDiff}: one file's unified diff in the repository at `at`. */
  @Remote('fileDiffAt')
  async fileDiffAt(request: FileDiffRequest & { at: string }): Promise<FileDiffResult> {
    return this.worktrees.fileDiff(WorktreesRemoteService.anchor(request.at), request.path, request.segment, request.commit)
  }

  /**
   * Agent-free twin of {@link readFile} AND {@link readFileAtCommit} in one
   * verb: `commit` present reads the file at that commit, absent reads the
   * working-tree content — same return shape, same errors, one anchor.
   */
  @Remote('readFileAt')
  async readFileAt(request: { at: string, path: string, commit?: string }): Promise<ReadFileResult> {
    const anchor = WorktreesRemoteService.anchor(request.at)
    return request.commit === undefined || request.commit === ''
      ? this.worktrees.readFile(anchor, request.path)
      : this.worktrees.readFileAtCommit(anchor, request.path, request.commit)
  }

  /** Agent-free twin of {@link readRepoImage}: a repo-relative file as an inline image from the repository at `at`. */
  @Remote('readRepoImageAt')
  async readRepoImageAt(request: { at: string, path: string }): Promise<LocalImageResult> {
    return this.worktrees.readRepoImage(WorktreesRemoteService.anchor(request.at), request.path)
  }

  /**
   * The current worktree binding of one session: the recorded override, or
   * `{ kind: 'none' }` when no override exists (the session then follows its
   * own static cwd — usually the main checkout, but that fallback is the
   * session's fact; this surface never performs the agent lookup that could
   * read it). Today the badge can only INFER this from `summary`.
   */
  @Remote('worktreeBinding')
  worktreeBinding(sessionId: string): Promise<WorktreeBinding> {
    return this.worktrees.bindingOf(sessionId)
  }

  /**
   * The controlled switch: bind one session to one worktree and get a typed
   * receipt — `switched` (the WorktreeInfo + the effective binding) |
   * `conflict` (`expected` mismatched; carries the ACTUAL current binding) |
   * `not-a-repo` | `no-worktree` | `invalid-request` | `persistence-failed`.
   * With `expected` present the switch is a compare-and-swap, never a silent
   * last-write-wins; the CAS state is single-process (the in-process map plus
   * its write-through file, no cross-process locking). A `switched` receipt
   * is returned only AFTER the binding was persisted (when persistence is
   * on); its `persisted: false` marks a memory-only deployment. The legacy
   * agent-bound {@link switchWorktree} stays for the native UI.
   */
  @Remote('switchWorktreeControlled')
  switchWorktreeControlled(sessionId: string, request: ControlledSwitchRequest): Promise<ControlledSwitchReceipt> {
    return this.worktrees.controlledSwitch(sessionId, request)
  }
}
