/**
 * The side-chat Remote service: the browser's wire face, mounted under the
 * `sidechat` namespace. A thin adapter over the same `ctx.sideChat` service
 * core — no logic is copied.
 *
 * The MUTATING verbs take the calling `agent` first (the wire's lookup
 * convention): `send` and `quoteMessage` write plugin state fenced by the
 * caller's own session (the store re-roots that session's mode at the plugin
 * state dir), and `send` also inherits the caller's cwd for a fresh side
 * session. The READS take no agent — a cold context answers from a
 * persistence inspection, and no read ever resumes an agent.
 *
 * @module @khorsheed/dsh-sidechat
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SideChatService } from './service.ts'
import type {
  SideChatListResult, SideChatQuoteOutcome, SideChatQuoteRequest,
  SideChatSendOutcome, SideChatSendRequest, SideChatStateOutcome,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The side chat's Remote face. */
    sidechatRemote: SideChatRemoteService
  }
}

/** Remote construction options (reserved for future config-driven knobs). */
export interface SideChatRemoteConfig {}

/**
 * The side chat's wire namespace: the browser calls `remote.sidechat.*`.
 */
export class SideChatRemoteService extends TypertRemoteService<SideChatRemoteConfig> {
  static inject = ['sideChat']

  /**
   * @param ctx - host context carrying the side-chat service core.
   * @param _config - reserved.
   */
  constructor(ctx: Context, _config: SideChatRemoteConfig = {}) {
    super(ctx, 'sidechatRemote', { namespace: 'sidechat' })
  }

  private get sideChat(): SideChatService {
    return this.ctx.sideChat
  }

  /** Read one context's full state (label, pending refs, transcript, status). */
  @Remote('getState')
  getState(request: { contextKey: string }): Promise<SideChatStateOutcome> {
    return this.sideChat.getState(request.contextKey)
  }

  /** List every known context, most recently active first. */
  @Remote('listContexts')
  listContexts(): Promise<SideChatListResult> {
    return this.sideChat.listContexts()
  }

  /**
   * Send one user message into one context (pending refs fold in and clear).
   * @param agent - the calling session's agent; its session fences the state write and donates the cwd.
   * @param request - contextKey, text, optional label and one-shot refs.
   * @returns the fresh state (already `running`), or the refusal.
   */
  @Remote('send')
  send(agent: Agent, request: SideChatSendRequest): Promise<SideChatSendOutcome> {
    return this.sideChat.send(agent, request)
  }

  /**
   * Land one assistant message of the calling session as a ref on its side chat.
   * @param agent - the calling session's agent; its session is both quote source and context owner.
   * @param request - the message id and an optional display label.
   * @returns the bound contextKey and the pending-ref count, or the refusal.
   */
  @Remote('quoteMessage')
  quoteMessage(agent: Agent, request: SideChatQuoteRequest): Promise<SideChatQuoteOutcome> {
    return this.sideChat.quoteMessage(agent, request)
  }
}

export default SideChatRemoteService
