/**
 * The game Remote service: the panel's data face, namespace `game`. A thin
 * adapter over `ctx.gameStore`. Methods that read or act for a session take
 * the calling `agent` first (the wire's lookup convention: the browser passes
 * a session id); project-addressed reads take none.
 * @module @khorsheed/dsh-game
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { GameService } from './store.ts'
import type { GameResult, PlayBundle, ProjectCard, SessionGameState, TurnReport, VersionDiff } from './types.ts'

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
  state(agent: Agent): Promise<SessionGameState> {
    return this.store.sessionState(agent.session.id)
  }

  /** What one of the session's turns changed (null when nothing, or not recorded). */
  @Remote('turnReport')
  turnReport(agent: Agent, request: { turn: number }): Promise<TurnReport | null> {
    return this.store.turnReport(agent.session.id, request.turn)
  }

  /** Every project as a switcher card. */
  @Remote('projectCards')
  projectCards(): Promise<ProjectCard[]> {
    return this.store.projectCards()
  }

  /** Bind the session to a project, or unbind with `projectId: null`. */
  @Remote('bind')
  bind(agent: Agent, request: { projectId: string | null }): Promise<GameResult> {
    return this.store.bind(agent.session.id, request.projectId)
  }

  /** A version's files for the play area. */
  @Remote('bundle')
  bundle(request: { projectId: string; which?: 'current' | 'candidate' }): Promise<GameResult<{ readonly ok: true; readonly bundle: PlayBundle }>> {
    return this.store.bundle(request.projectId, request.which ?? 'current')
  }

  /** Promote the candidate into the play area. */
  @Remote('confirm')
  confirm(agent: Agent, request: { projectId: string }): Promise<GameResult<{ readonly ok: true; readonly version: number }>> {
    return this.store.confirm(request.projectId, agent.session)
  }

  /** Switch the project's auto-confirm. */
  @Remote('setAutoConfirm')
  setAutoConfirm(agent: Agent, request: { projectId: string; on: boolean }): Promise<GameResult> {
    return this.store.setAutoConfirm(request.projectId, request.on, agent.session)
  }

  /** Record one play session into the playtest log. */
  @Remote('logPlay')
  logPlay(agent: Agent, request: { projectId: string; version: number; seconds: number; errors: string[] }): Promise<GameResult> {
    return this.store.logPlay(request.projectId, request, agent.session)
  }

  /** Drop one pending change (the dock's ×). */
  @Remote('dropPending')
  dropPending(agent: Agent, request: { projectId: string; key: string }): Promise<GameResult> {
    return this.store.dropPending(request.projectId, request.key, agent.session)
  }

  /** Set one slider value (user layer). */
  @Remote('setParam')
  setParam(agent: Agent, request: { projectId: string; key: string; value: number }): Promise<GameResult> {
    return this.store.setParam(request.projectId, request.key, request.value, agent.session)
  }

  /** 定稿: write slider values into game.json. */
  @Remote('finalizeParams')
  finalizeParams(agent: Agent, request: { projectId: string }): Promise<GameResult> {
    return this.store.finalizeParams(request.projectId, agent.session)
  }

  /** 还原: drop the slider overrides. */
  @Remote('resetParams')
  resetParams(agent: Agent, request: { projectId: string }): Promise<GameResult> {
    return this.store.resetParams(request.projectId, agent.session)
  }

  /** Edit one element's look (JSON text) and/or scalar fields (JSON text of an object). */
  @Remote('editElement')
  async editElement(agent: Agent, request: { projectId: string; elementId: string; look?: string; fields?: string }): Promise<GameResult<{ readonly ok: true; readonly elementJson: string }>> {
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
    }, agent.session)
    return result.ok ? { ok: true, elementJson: JSON.stringify(result.element) } : result
  }

  /** Pick one appearance variant. */
  @Remote('pickProposal')
  pickProposal(agent: Agent, request: { projectId: string; elementId: string; at: string; index: number }): Promise<GameResult> {
    return this.store.pickProposal(request.projectId, request.elementId, request.at, request.index, agent.session)
  }

  /** Write a design chapter. */
  @Remote('writeChapter')
  writeChapter(agent: Agent, request: { projectId: string; chapterId: string; text: string }): Promise<GameResult> {
    return this.store.writeChapter(request.projectId, request.chapterId, request.text, agent.session)
  }

  /** Edit the one-pager (game.json pitch / element types / pillars). */
  @Remote('setOnePager')
  setOnePager(agent: Agent, request: { projectId: string; pitch?: string; elementTypes?: string; pillars?: string }): Promise<GameResult> {
    return this.store.setOnePager(request.projectId, request, agent.session)
  }

  /** Mark a pending restyle (the next passing version becomes a candidate). */
  @Remote('requestRestyle')
  requestRestyle(agent: Agent, request: { projectId: string; styleId: string }): Promise<GameResult> {
    return this.store.requestRestyle(request.projectId, request.styleId, agent.session)
  }

  /** Throw the candidate away. */
  @Remote('reject')
  reject(agent: Agent, request: { projectId: string; reason: string }): Promise<GameResult> {
    return this.store.reject(request.projectId, request.reason, agent.session)
  }

  /** Put an older version into the play area. */
  @Remote('rollback')
  rollback(agent: Agent, request: { projectId: string; version: number }): Promise<GameResult> {
    return this.store.rollback(request.projectId, request.version, agent.session)
  }

  /** Files that differ between two versions. */
  @Remote('diff')
  diff(request: { projectId: string; from: number; to: number }): Promise<GameResult<{ readonly ok: true; readonly diff: VersionDiff }>> {
    return this.store.diff(request.projectId, request.from, request.to)
  }

  /** The last check's screenshot. */
  @Remote('checkShot')
  checkShot(request: { projectId: string }): Promise<GameResult<{ readonly ok: true; readonly webp: string }>> {
    return this.store.checkShot(request.projectId)
  }

  /** A specific version's files (rollback preview, export). */
  @Remote('versionBundle')
  versionBundle(request: { projectId: string; version: number }): Promise<GameResult<{ readonly ok: true; readonly bundle: PlayBundle }>> {
    return this.store.versionBundle(request.projectId, request.version)
  }
}
