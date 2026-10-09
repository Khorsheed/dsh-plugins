/**
 * The request-inspector service core: owns the per-session capture store and
 * answers the Remote face's queries. M0 stub — the capture listeners
 * (`llm/stream`, `system-prompt/assemble`, `session/event`) land with the
 * capture pipeline; the store API below is the pinned shape they fill.
 *
 * @module @khorsheed/dsh-request-inspector/service
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CapturedRequest, TurnListItem, TurnOverview, TurnTiming } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The request-inspector service core. */
    requestInspector: InspectorService
  }
}

/** Plugin config: capture retention knobs. */
export interface InspectorConfig {
  /** Turns retained per session (oldest evicted first). Default 20. */
  maxTurnsPerSession?: number
  /** Total retained requests across all sessions. Default 200. */
  maxRequestsTotal?: number
}

/** The capture store's query face (Remote delegates here). */
export class InspectorService {
  constructor(
    readonly ctx: Context,
    readonly config: InspectorConfig = {},
  ) {}

  /** Light turn list of one session, newest last. */
  async listTurns(_sessionId: string): Promise<TurnListItem[]> {
    return []
  }

  /** One turn's scope/request overview, without segments. */
  async getTurn(_sessionId: string, _turnSeq: number): Promise<TurnOverview | undefined> {
    return undefined
  }

  /** One request's full four-segment breakdown. */
  async getRequest(_sessionId: string, _seq: number): Promise<CapturedRequest | undefined> {
    return undefined
  }

  /** One turn's whole-turn timing aggregation. */
  async getTurnTiming(_sessionId: string, _turnSeq: number): Promise<TurnTiming | undefined> {
    return undefined
  }

  /** Release every session buffer (plugin dispose). */
  dispose(): void {}
}
