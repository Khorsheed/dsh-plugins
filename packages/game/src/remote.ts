/**
 * The game Remote service: the panel's data face, namespace `game`. A thin
 * adapter over `ctx.gameStore`. Methods that read or act for a session take
 * its id first and resolve it with {@link panelSession} (subagent sessions
 * included); project-addressed reads take none.
 * @module @khorsheed/dsh-game
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { panelSession } from './panel-session.ts'
import type { GameService } from './store.ts'
import type { CommitResult, DeleteProjectResult, WorkingChanges, GameResult, PlayBundle, ProjectCard, SessionGameState, TurnReport, VersionDiff } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The game panel's Remote face. */
    gameRemote: GameRemoteService
  }
}

/** Remote construction options (reserved). */
export interface GameRemoteConfig {}

/** The `game` wire namespace. */
export class GameRemoteService extends TypertRemoteService<GameRemoteConfig> {
  static inject = ['gameStore']

  /**
   * @param ctx - host context carrying the service core.
   * @param _config - reserved.
   */
  constructor(ctx: Context, _config: GameRemoteConfig = {}) {
    super(ctx, 'gameRemote', { namespace: 'game' })
  }

  private get store(): GameService {
    return this.ctx.gameStore
  }

  /** The session's bound project (full view) and the project list. */
  @Remote('state')
  state(sessionId: SessionId): Promise<SessionGameState> {
    return this.store.sessionState(sessionId)
  }

  /** What one of the session's turns changed (null when nothing, or not recorded). */
  @Remote('turnReport')
  turnReport(sessionId: SessionId, request: { turn: number }): Promise<TurnReport | null> {
    return this.store.turnReport(sessionId, request.turn)
  }

  /** Every project as a switcher card. */
  @Remote('projectCards')
  projectCards(): Promise<ProjectCard[]> {
    return this.store.projectCards()
  }

  /** Delete a project: `trash` moves its folder to the system trash, `forget` only removes it from the plugin. */
  @Remote('deleteProject')
  async deleteProject(sessionId: SessionId, request: { projectId: string; mode: 'trash' | 'forget' }): Promise<DeleteProjectResult> {
    return this.store.deleteProject(request.projectId, request.mode === 'forget' ? 'forget' : 'trash', await panelSession(this.ctx, sessionId))
  }

  /** Bind the session to a project, or unbind with `projectId: null`. */
  @Remote('bind')
  bind(sessionId: SessionId, request: { projectId: string | null }): Promise<GameResult> {
    return this.store.bind(sessionId, request.projectId)
  }

  /** A version's files for the play area. */
  @Remote('bundle')
  bundle(request: { projectId: string; which?: 'current' | 'candidate' }): Promise<GameResult<{ readonly ok: true; readonly bundle: PlayBundle }>> {
    return this.store.bundle(request.projectId, request.which ?? 'current')
  }

  /** Promote the candidate into the play area. */
  @Remote('confirm')
  async confirm(sessionId: SessionId, request: { projectId: string }): Promise<GameResult<{ readonly ok: true; readonly version: number }>> {
    return this.store.confirm(request.projectId, await panelSession(this.ctx, sessionId))
  }

  /** What the working files hold that the play area does not (the commit bar polls it). */
  @Remote('changes')
  changes(request: { projectId: string }): Promise<GameResult<WorkingChanges & { readonly ok: true }>> {
    return this.store.changes(request.projectId)
  }

  /** 检查并发版: check the working files and cut a version (by the user) carrying every change. */
  @Remote('commit')
  async commit(sessionId: SessionId, request: { projectId: string }): Promise<GameResult<CommitResult>> {
    return this.store.commit(request.projectId, await panelSession(this.ctx, sessionId))
  }

  /** Switch the project's auto-confirm. */
  @Remote('setAutoConfirm')
  async setAutoConfirm(sessionId: SessionId, request: { projectId: string; on: boolean }): Promise<GameResult> {
    return this.store.setAutoConfirm(request.projectId, request.on, await panelSession(this.ctx, sessionId))
  }

  /** Record one play session into the playtest log. */
  @Remote('logPlay')
  async logPlay(sessionId: SessionId, request: { projectId: string; version: number; seconds: number; errors: string[] }): Promise<GameResult> {
    return this.store.logPlay(request.projectId, request, await panelSession(this.ctx, sessionId))
  }

  /** Drop one pending change (the dock's ×). */
  @Remote('dropPending')
  async dropPending(sessionId: SessionId, request: { projectId: string; key: string }): Promise<GameResult> {
    return this.store.dropPending(request.projectId, request.key, await panelSession(this.ctx, sessionId))
  }

  /** Set one slider value (user layer). */
  @Remote('setParam')
  async setParam(sessionId: SessionId, request: { projectId: string; key: string; value: number }): Promise<GameResult> {
    return this.store.setParam(request.projectId, request.key, request.value, await panelSession(this.ctx, sessionId))
  }

  /** 定稿: write slider values into game.json. */
  @Remote('finalizeParams')
  async finalizeParams(sessionId: SessionId, request: { projectId: string }): Promise<GameResult> {
    return this.store.finalizeParams(request.projectId, await panelSession(this.ctx, sessionId))
  }

  /** 还原: drop the slider overrides. */
  @Remote('resetParams')
  async resetParams(sessionId: SessionId, request: { projectId: string }): Promise<GameResult> {
    return this.store.resetParams(request.projectId, await panelSession(this.ctx, sessionId))
  }

  /** Edit one element's look (JSON text) and/or scalar fields (JSON text of an object). */
  @Remote('editElement')
  async editElement(sessionId: SessionId, request: { projectId: string; elementId: string; look?: string; fields?: string }): Promise<GameResult<{ readonly ok: true; readonly elementJson: string }>> {
    let look: unknown
    let fields: Record<string, string | number | boolean | null> | undefined
    try {
      if (request.look !== undefined) look = JSON.parse(request.look)
      if (request.fields !== undefined) fields = JSON.parse(request.fields) as Record<string, string | number | boolean | null>
    } catch {
      return { ok: false, error: 'invalid' }
    }
    const result = await this.store.editElement(request.projectId, request.elementId, {
      ...(look === undefined ? {} : { look }), ...(fields === undefined ? {} : { fields }),
    }, await panelSession(this.ctx, sessionId))
    return result.ok ? { ok: true, elementJson: JSON.stringify(result.element) } : result
  }

  /** Pick one appearance variant. */
  @Remote('pickProposal')
  async pickProposal(sessionId: SessionId, request: { projectId: string; elementId: string; at: string; index: number }): Promise<GameResult> {
    return this.store.pickProposal(request.projectId, request.elementId, request.at, request.index, await panelSession(this.ctx, sessionId))
  }

  /** Write a design chapter. */
  @Remote('writeChapter')
  async writeChapter(sessionId: SessionId, request: { projectId: string; chapterId: string; text: string }): Promise<GameResult> {
    return this.store.writeChapter(request.projectId, request.chapterId, request.text, await panelSession(this.ctx, sessionId))
  }

  /** Edit the one-pager (game.json pitch / element types / pillars). */
  @Remote('setOnePager')
  async setOnePager(sessionId: SessionId, request: { projectId: string; pitch?: string; elementTypes?: string; pillars?: string }): Promise<GameResult> {
    return this.store.setOnePager(request.projectId, request, await panelSession(this.ctx, sessionId))
  }

  /** Mark a pending restyle (the next passing version becomes a candidate). */
  @Remote('requestRestyle')
  async requestRestyle(sessionId: SessionId, request: { projectId: string; styleId: string }): Promise<GameResult> {
    return this.store.requestRestyle(request.projectId, request.styleId, await panelSession(this.ctx, sessionId))
  }

  /** Throw the candidate away. */
  @Remote('reject')
  async reject(sessionId: SessionId, request: { projectId: string; reason: string }): Promise<GameResult> {
    return this.store.reject(request.projectId, request.reason, await panelSession(this.ctx, sessionId))
  }

  /** Put an older version into the play area. */
  @Remote('rollback')
  async rollback(sessionId: SessionId, request: { projectId: string; version: number }): Promise<GameResult> {
    return this.store.rollback(request.projectId, request.version, await panelSession(this.ctx, sessionId))
  }

  /** Files that differ between two versions. */
  @Remote('diff')
  diff(request: { projectId: string; from: number; to: number }): Promise<GameResult<{ readonly ok: true; readonly diff: VersionDiff }>> {
    return this.store.diff(request.projectId, request.from, request.to)
  }

  /** The last check's screenshot. */
  @Remote('checkShot')
  checkShot(request: { projectId: string; version?: number }): Promise<GameResult<{ readonly ok: true; readonly webp: string }>> {
    return this.store.checkShot(request.projectId, request.version)
  }

  /** A specific version's files (rollback preview, export). */
  @Remote('versionBundle')
  versionBundle(request: { projectId: string; version: number }): Promise<GameResult<{ readonly ok: true; readonly bundle: PlayBundle }>> {
    return this.store.versionBundle(request.projectId, request.version)
  }
}
