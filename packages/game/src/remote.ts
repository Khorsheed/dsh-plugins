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
import type { GameResult, PlayBundle, SessionGameState } from './types.ts'

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
}
