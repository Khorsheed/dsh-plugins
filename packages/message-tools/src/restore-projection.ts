/**
 * Restore-assistant message projection (seam registry S12): the pure
 * `user/message` interpreter that rewrites a restore replay's derived message
 * to assistant role with the model-facing frame stripped, plus the
 * registration helper that probes the host for the capability and degrades to
 * the framed user-role channel when it cannot carry the projection. The
 * durable log is identical on both channels — the restore append keeps its
 * `restore-assistant` source mark and its frame prefix; only the model-facing
 * derivation differs.
 * @module @khorsheed/dsh-client-message-tools/restore-projection
 */
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm/message'
// Type-only: pulls the `sessions` SessionStore merge onto Context.
import type {} from '@deepseek-ai/dsh-session'
// Value: the branded seq constructor the probe events require.
import { SessionSeq } from '@deepseek-ai/dsh-session'
// Namespace: foldSurface/deriveEventMessage are 0.1.6 additions — a named
// import would fail module linking on a 0.1.5 host, so the probe reaches them
// through the namespace object (absent members read as undefined).
import * as sessionApi from '@deepseek-ai/dsh-session'
import type { SessionMessageProjection } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  RESTORED_ASSISTANT_NOTICE, messageToolsOp, restoreAssistantSource, stripRestoreAssistantFrame,
} from './marker.ts'

/**
 * The `user/message` projection correcting restore replays at derivation
 * time. It registers on the SHARED user-message vocabulary (a custom event
 * type could never persist — S2), so the fold calls `project` synchronously
 * for EVERY user message, inside append validation: it must be a pure
 * pass-through (empty map) for anything without the restore mark, and it must
 * NEVER throw — a throw atomically rejects the candidate append, so a
 * throwing projection would break ordinary user messages instance-wide. Any
 * malformed durable payload therefore also yields an empty map.
 */
export const restoreAssistantProjection: SessionMessageProjection<'user/message'> = {
  type: 'user/message',
  project(event, context) {
    try {
      const source = (event.data as { source?: unknown } | undefined)?.source
      if (messageToolsOp(source) !== 'restore-assistant') return new Map()
      // The current message at the candidate's own seq: a prior projection's
      // rewrite wins, then the committed window entry (fold replay), then the
      // candidate's own data (live append validation, where the window
      // excludes the candidate). Mirrors the official image-offload
      // projection's message fetch.
      const committed = context.events[event.seq - context.baseSeq]
      const message = context.messages.get(event.seq)
        ?? (committed?.type === 'user/message' ? committed.data : undefined)
        ?? event.data
      const content = message.content.map(block =>
        block.type === 'text' && typeof block.text === 'string'
          ? { ...block, text: stripRestoreAssistantFrame(block.text) }
          : block)
      return new Map([[event.seq, { ...message, role: 'assistant' as const, content }]])
    } catch {
      return new Map()
    }
  },
}

/** One synthetic user/message event for the fold-semantics probe. */
function probeEvent(seq: number, text: string, source: MessageSource): SessionEvent<'user/message'> {
  return {
    type: 'user/message',
    seq: SessionSeq(seq),
    time: 0,
    data: createUserMessage({ content: [{ type: 'text', text }], source }),
    surfaceOp: 'append',
  }
}

/**
 * Whether this host's surface fold can carry a `user/message` projection at
 * all. 0.1.6-alpha.1 routes every event of a projected type through the
 * projection plan and never joins it to the surface (probe-verified): a
 * registered user/message projection would silently drop EVERY user message
 * from the model context. This probe folds two synthetic events through the
 * real `foldSurface` and accepts only the composing semantics the design
 * needs — plain messages keep their node, and a restore replay keeps its
 * node AND derives assistant-role with the frame stripped — so the channel
 * stays dormant on 0.1.6-alpha.1 and lights up by itself on a host whose
 * fold composes. Pure, synchronous, side-effect-free.
 * @param fold - the host's surface fold, injectable for tests.
 * @param derive - the host's single-event derivation, injectable for tests.
 * @returns true when a registered user/message projection is safe.
 */
export function restoreProjectionFoldSupported(
  fold: typeof sessionApi.foldSurface | undefined = sessionApi.foldSurface,
  derive: typeof sessionApi.deriveEventMessage | undefined = sessionApi.deriveEventMessage,
): boolean {
  try {
    if (typeof fold !== 'function' || typeof derive !== 'function') return false
    const events = [
      probeEvent(0, 'probe', { kind: 'user' }),
      probeEvent(1, `${RESTORED_ASSISTANT_NOTICE}\nprobe answer`, restoreAssistantSource()),
    ] as const
    const folded = fold(events, [restoreAssistantProjection])
    if (folded.nodes.length !== events.length) return false
    const derived = derive(events[1], folded.projectedMessages)
    return derived?.role === 'assistant'
      && derived.content.some(block => block.type === 'text' && block.text === 'probe answer')
  } catch {
    return false
  }
}

/**
 * Probe and register the restore-assistant projection, degrading to the
 * framed user-role channel (which the durable events already carry) whenever
 * the host cannot carry the projection: pre-0.1.6 (`registerMessageProjection`
 * absent), a fold that cannot compose projections with surface membership, or
 * a registration conflict (the projection slot is one-per-type per instance —
 * a future official projection claiming user/message throws, and the plugin
 * must not take the instance down with it).
 * @param ctx - host context carrying the session store.
 * @param foldSupported - fold-semantics probe, injectable for tests.
 * @returns true when the projection channel is active.
 */
export function registerRestoreProjection(
  ctx: Context,
  foldSupported: () => boolean = restoreProjectionFoldSupported,
): boolean {
  const sessions = ctx.sessions as {
    registerMessageProjection?: (projection: SessionMessageProjection) => () => Promise<void>
  }
  if (typeof sessions.registerMessageProjection !== 'function') {
    ctx.logger.info('message-tools: host has no sessions.registerMessageProjection — restored assistant text stays in the framed user-role channel')
    return false
  }
  if (!foldSupported()) {
    ctx.logger.warn('message-tools: host message-projection fold drops projected user/message events from the surface — restored assistant text stays in the framed user-role channel')
    return false
  }
  try {
    const dispose = sessions.registerMessageProjection(restoreAssistantProjection)
    // The host's returned disposer is fiber-owned and idempotent (cordis
    // effect disposal re-entry is a no-op); wiring it here as well keeps
    // unregister-on-unload exact even if a future host binds it elsewhere.
    ctx.effect(() => () => dispose(), 'message-tools: restore-assistant projection')
    return true
  } catch {
    ctx.logger.warn('message-tools: a user/message message-projection is already registered — restored assistant text stays in the framed user-role channel')
    return false
  }
}
