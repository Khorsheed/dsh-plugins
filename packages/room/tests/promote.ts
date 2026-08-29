/**
 * Shared test helper: mint a room the way the product does now — a plain
 * session through the agents stub (so dispatch resolves a live parent agent),
 * promoted by the service's public ensureRoom. createRoom is gone with the
 * room-session-promotion entry model.
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type RoomService from '../src/index.ts'

/**
 * Create a live session through the agents stub and promote it to a room.
 * @param ctx - the bench's host context.
 * @param service - the room service.
 * @param meta - optional session header metadata (e.g. cwd).
 * @returns the promoted session's id.
 */
export async function createRoom(
  ctx: Context,
  service: RoomService,
  meta: Record<string, unknown> = {},
): Promise<SessionId> {
  const sessionId = SessionId(`session-${randomUUID()}`)
  const agents = ctx.agents as unknown as {
    create(request: { sessionId: SessionId; meta: Record<string, unknown> }): Promise<unknown>
  }
  await agents.create({ sessionId, meta })
  const promoted = await service.ensureRoom(sessionId)
  if (!promoted.ok) throw new Error(`ensureRoom failed: ${promoted.error.code}`)
  return sessionId
}
