/**
 * The quote Remote service: the wire face the browser drives, mounted under
 * the `quote` namespace. One verb — `addRef` queues one opaque ref on the
 * side-chat context bound to a conversation (contextKey = the session id).
 *
 * The side-chat Remote (M2 audit) has no client-reachable refs verb: its
 * `send` starts a whole turn and its `quoteMessage` addresses an assistant
 * message by id, while this plugin's quote is arbitrary selected text that
 * must land as a PENDING ref. So the route crosses through this thin face,
 * whose host half probes `ctx.get('sideChat')` and calls `openWith` — the
 * sanctioned host-to-host seam (the canvas `askAgent` precedent), mirrored
 * STRUCTURALLY: the sidechat package is never imported (the one edge is the
 * probed service name, declared in the manifest's `dsh.references`).
 *
 * The verb takes no calling agent: `openWith` owns no session-scoped write —
 * the side-chat store fences host-side calls on the deployment default mode
 * (the same shape canvas's prime-only gestures use).
 *
 * @module @khorsheed/dsh-quote
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { QuoteAddRefOutcome, QuoteAddRefRequest, QuoteRef } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The quote plugin's Remote face. */
    quoteRemote: QuoteRemoteService
  }
}

/**
 * The probed side-chat seam, mirrored structurally — the canvas `SideChatMirror`
 * precedent narrowed to the one call this plugin makes.
 */
export interface SideChatMirror {
  /** Open (or update) one chat context: display label plus queued refs. */
  openWith(input: {
    readonly contextKey: string
    readonly label: string
    readonly refs?: readonly QuoteRef[]
  }): Promise<void>
}

/** Remote construction options (reserved for future config-driven knobs). */
export interface QuoteRemoteConfig {}

/**
 * The quote wire namespace: the browser calls `remote.quote.*`. Deliberately
 * NO `static inject`: the side-chat seam is probed per call, so a composition
 * without side-chat boots this face normally and every gesture degrades to
 * the `unavailable` refusal.
 */
export class QuoteRemoteService extends TypertRemoteService<QuoteRemoteConfig> {
  /**
   * @param ctx - host context (the side-chat service is probed, never injected).
   * @param _config - reserved.
   */
  constructor(ctx: Context, _config: QuoteRemoteConfig = {}) {
    super(ctx, 'quoteRemote', { namespace: 'quote' })
  }

  /**
   * Queue one opaque ref on the side-chat context bound to one conversation.
   * @param request - contextKey (the session id), the context display label, and the ref.
   * @returns the queue acknowledgement, or the refusal.
   */
  @Remote('addRef')
  async addRef(request: QuoteAddRefRequest): Promise<QuoteAddRefOutcome> {
    if (request.contextKey.trim() === '' || request.ref.text.trim() === '') {
      return { ok: false, error: 'empty' }
    }
    const sideChat = this.ctx.get('sideChat') as SideChatMirror | undefined
    if (sideChat === undefined) return { ok: false, error: 'unavailable' }
    try {
      await sideChat.openWith({
        contextKey: request.contextKey,
        label: request.label ?? request.contextKey,
        refs: [request.ref],
      })
      return { ok: true }
    } catch {
      return { ok: false, error: 'io' }
    }
  }
}

export default QuoteRemoteService
