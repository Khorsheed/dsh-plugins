/**
 * Test double for the attached-session store: the Remote verbs take a session
 * id and resolve it through `ctx.sessions` (see src/panel-session.ts).
 * `attach` registers a session double and returns the id a panel would pass.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'

const attached = new Map<string, Session>()
let next = 0

/**
 * Register a session double; its own id is kept when it has one.
 * @param session - the double the service should see.
 * @returns the id the panel passes.
 */
export function attach(session: object): SessionId {
  const own = (session as { id?: unknown }).id
  const id = typeof own === 'string' ? own : `attached-${next++}`
  attached.set(id, session as Session)
  return SessionId(id)
}

/**
 * Provide the attached-session store on a test context.
 * @param ctx - the context the service is built on.
 */
export function provideAttachedSessions(ctx: Context): void {
  ctx.provide('sessions' as never, { get: (id: string) => attached.get(id) } as never)
}
