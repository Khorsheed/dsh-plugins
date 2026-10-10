import type { SessionTrend } from './types.ts'
/**
 * The context-lens Remote: the wire face, and nothing else. Each verb is
 * a one-line delegation to {@link InspectorService} and returns the BARE domain
 * value; the wire layer wraps it in the protocol's result envelope, and thrown
 * `RemoteError`s arrive as that envelope's error branch.
 *
 * Namespace `requestInspector`: the browser calls
 * `remote.requestInspector.listTurns` etc. Pull-based (no subscription): the
 * panel refetches on open / turn switch; capture is cheap and in-memory.
 *
 * @module @khorsheed/dsh-context-lens/remote
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { InspectorService } from './service.ts'
import type { CapturedRequest, ListTurnsResult, ScopeFilter, ScopedRefusal, TurnOverview, TurnTiming } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    requestInspectorRemote: RequestInspectorRemoteService
  }
}

/** Reserved for future config-driven knobs; the service owns today's config. */
export interface RequestInspectorRemoteConfig {}

/** The wire namespace is `requestInspector`. */
export class RequestInspectorRemoteService extends TypertRemoteService<RequestInspectorRemoteConfig> {
  static inject = ['requestInspector']

  constructor(ctx: Context, _config: RequestInspectorRemoteConfig = {}) {
    super(ctx, 'requestInspectorRemote', { namespace: 'requestInspector' })
  }

  /** The service core this face delegates to. */
  private get core(): InspectorService {
    return this.ctx.requestInspector
  }

  /** Light turn list of one session plus its backfill watermark, newest last. */
  @Remote('listTurns')
  listTurns(sessionId: string, filter?: ScopeFilter): Promise<ListTurnsResult> {
    return this.core.listTurns(sessionId, filter)
  }

  /** One turn's scope/request overview — the left column, no segments. */
  @Remote('getTurn')
  getTurn(sessionId: string, turnSeq: number, filter?: ScopeFilter): Promise<TurnOverview | undefined> {
    return this.core.getTurn(sessionId, turnSeq, filter)
  }

  /** One request's full four-segment breakdown — the right column. */
  @Remote('getRequest')
  getRequest(sessionId: string, seq: number, filter?: ScopeFilter): Promise<CapturedRequest | ScopedRefusal | undefined> {
    return this.core.getRequest(sessionId, seq, filter)
  }

  /** Lightweight session map, with no message bodies. */
  @Remote('getSessionTrend')
  getSessionTrend(sessionId: string, filter?: ScopeFilter): Promise<SessionTrend> {
    return this.core.getSessionTrend(sessionId, filter)
  }

  /** One turn's whole-turn timing aggregation — the 耗时分布 tab. */
  @Remote('getTurnTiming')
  getTurnTiming(sessionId: string, turnSeq: number, filter?: ScopeFilter): Promise<TurnTiming | undefined> {
    return this.core.getTurnTiming(sessionId, turnSeq, filter)
  }
}

export default RequestInspectorRemoteService
