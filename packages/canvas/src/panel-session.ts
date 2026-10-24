/**
 * The session a panel call names, by id. The wire's `agent`/`session` lookups
 * refuse identities owned by subagent routing (a room's CLI member, a native
 * subagent), so a panel opened on such a session could not even read. Panel
 * calls take the session id instead: an attached session — subagent ones
 * included — answers directly; anything else goes through the host's own
 * `session` lookup, which resumes an ordinary cold session and raises the
 * same errors a lookup parameter did.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Resolve the session a panel call names.
 * @param ctx - host context carrying the session store and the typert lookups.
 * @param sessionId - the session the panel shows.
 * @returns the session.
 * @throws the host lookup's refusal, or when no session has that id.
 */
export async function panelSession(ctx: Context, sessionId: SessionId): Promise<Session> {
  const attached = ctx.get('sessions')?.get(sessionId)
  if (attached !== undefined) return attached
  const resolved = await ctx.get('typert')?.lookups.get('session')?.resolve(sessionId) as Session | undefined
  if (resolved === undefined) throw new Error(`session "${sessionId}" not found`)
  return resolved
}
