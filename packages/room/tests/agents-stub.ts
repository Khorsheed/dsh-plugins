/**
 * Shared agents-registry stub for the host benches: `create` mints the
 * session through the real SessionStore (as the agent factory would) and
 * registers a live agent; `get` reads the live map; `resume` is scripted by
 * the specs that exercise the cold-resume path (absent elsewhere, so a cold
 * mutation surfaces `resume-failed`).
 */
import { vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'

export interface AgentsStubOptions {
  /** false: get() never answers (no live agent), even for created sessions. */
  live?: boolean
  /** Scripted cold resume (e.g. reattach from persistence). */
  resume?: (options: { resumeSessionId: SessionId }) => Promise<unknown>
}

/** Provide the stubbed `agents` service; returns the stub for assertions. */
export function stubAgents(ctx: Context, options: AgentsStubOptions = {}) {
  const live = new Map<string, { id: SessionId; session: unknown }>()
  const stub = {
    get: vi.fn((id: SessionId) => options.live === false ? undefined : live.get(id)),
    create: vi.fn(async (request: { sessionId: SessionId; meta?: Record<string, unknown> }) => {
      const session = ctx.sessions.create(request.sessionId, { meta: request.meta ?? {} })
      const agent = { id: session.id, session }
      live.set(session.id, agent)
      return { agent, dispose: async () => { live.delete(session.id) } }
    }),
    ...options.resume === undefined ? {} : { resume: vi.fn(options.resume) },
  }
  ctx.provide('agents', stub as never)
  return stub
}
