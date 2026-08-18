/**
 * Mirror a sub-dsh session's events into the parent-side dsh subagent session,
 * so a dsh delegation shows its full conversation (task, replies, thinking)
 * and real token usage in the standard 子代理 surface — the same fidelity the
 * other family harnesses get from their CLI transcript files. The sub-dsh
 * writes a real dsh session into the harness scoped home with the SAME id as
 * the parent-side child session and the same SessionEvent format, so the
 * mirror copies finalized `user/message`/`assistant/message` events verbatim
 * (no parsing, no re-encoding): reasoning blocks render natively and usage
 * rides the assistant events' own `usage` field into the tokenUsage
 * projection.
 *
 * Round scoping: the parent provider appends one `turn/start` per delegation
 * round, and the sub-dsh session numbers its turns identically (fresh = 1,
 * each resume +1), so a round's span is the sub-dsh events from its
 * `turn/start` with `turn === round` to the next `turn/start`. The sub-dsh's
 * own scaffolding user messages (agent-instructions, plugin, skill-catalog
 * sources) are filtered — only the caller task (`source.kind === 'user'`)
 * crosses. Turn boundaries are NOT copied: the parent's real-time
 * spawn→settle boundaries stay the authoritative timing.
 * @module @khorsheed/dsh-local-agent-dsh/session-mirror
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { zstdDecompress } from 'node:zlib'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/** Decompress one zstd session log (Node ≥22.15 built-in; engines require ^22.19). */
const decompressZstd = promisify(zstdDecompress)

/** Every zstd frame's little-endian magic number, marking a frame start in the stream. */
const ZSTD_FRAME_MAGIC = 0xfd2fb528

/**
 * Decompress a multi-frame zstd session log. The persistence layer appends
 * one frame per flush batch, and Node's single-shot `zstdDecompress` stops at
 * the first frame's end (a streaming decoder does the same), so each frame
 * start is scanned and decompressed independently. A magic-looking byte
 * sequence inside compressed data fails decompression and is skipped.
 * @param content - the raw `.zstd` file bytes.
 * @returns the concatenated plaintext of every frame.
 */
async function decompressZstdFrames(content: Buffer): Promise<string> {
  const parts: string[] = []
  for (let offset = 0; offset + 4 <= content.length; offset += 1) {
    if (content.readUInt32LE(offset) !== ZSTD_FRAME_MAGIC) continue
    try {
      parts.push((await decompressZstd(content.subarray(offset))).toString('utf8'))
    } catch {
      // Not a real frame start; keep scanning.
    }
  }
  return parts.join('')
}

/**
 * Read a sub-dsh session's event log from the scoped home. The session lives
 * at `<homeDir>/sessions/<workspace>/<id>/` (the runner passes the bare uuid)
 * as `session.jsonl.zstd` or plaintext `session.jsonl`; the first line is the
 * header, the rest are events.
 * @param homeDir - the `dsh` harness's scoped home.
 * @param sessionId - the sub-dsh session id (same uuid as the child session).
 * @returns the parsed events, or undefined when the session is absent/unreadable.
 */
export async function readSubDshEvents(homeDir: string, sessionId: string): Promise<SessionEvent[] | undefined> {
  let workspaces: string[]
  try {
    workspaces = await readdir(join(homeDir, 'sessions'))
  } catch {
    return undefined
  }
  for (const workspace of workspaces) {
    for (const name of [sessionId, `session-${sessionId}`]) {
      const dir = join(homeDir, 'sessions', workspace, name)
      for (const file of ['session.jsonl.zstd', 'session.jsonl']) {
        let text: string
        try {
          const content = await readFile(join(dir, file))
          text = file.endsWith('.zstd') ? await decompressZstdFrames(content) : content.toString('utf8')
        } catch {
          continue
        }
        const events: SessionEvent[] = []
        for (const line of text.split('\n')) {
          if (line === '') continue
          try {
            const parsed = JSON.parse(line) as { type?: string }
            if (parsed.type === 'session') continue
            events.push(parsed as SessionEvent)
          } catch {
            // A torn tail line (killed mid-flush) is skipped, not fatal.
          }
        }
        if (events.length > 0) return events
      }
    }
  }
  return undefined
}

/**
 * Mirror the current round's events from the sub-dsh session into the child
 * session, then persist. Runs after the child process exits (however it
 * ended), so it reflects what the sub-dsh flushed before the kill — an
 * aborted round still preserves its partial work and real usage. All failures
 * degrade to a warn: the delegation result is already settled.
 * @param ctx - host context carrying session persistence.
 * @param childSession - the parent-side dsh subagent session.
 * @param homeDir - the `dsh` harness's scoped home.
 * @param subSessionId - the sub-dsh session id (same uuid as the child session).
 */
export async function mirrorDshSession(
  ctx: Context,
  childSession: Session,
  homeDir: string,
  subSessionId: string,
): Promise<void> {
  try {
    const events = await readSubDshEvents(homeDir, subSessionId)
    if (events === undefined) return
    // The round mirrors the sub-dsh turn with the same number: the parent's
    // turn/start count IS this round's number (appended before spawn), and the
    // sub-dsh numbers its turns identically across fresh and resume rounds.
    const round = childSession.events.filter(event => event.type === 'turn/start').length
    if (round === 0) return
    let start = -1
    let end = events.length
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index]
      if (event?.type !== 'turn/start') continue
      if (start === -1 && event.data.turn === round) {
        start = index
        continue
      }
      if (start !== -1) {
        end = index
        break
      }
    }
    if (start === -1) return
    for (const event of events.slice(start, end)) {
      if (event.type === 'user/message') {
        // Only the caller's task crosses; the sub-dsh's own scaffolding
        // (agent-instructions/plugin/skill-catalog user messages) stays behind.
        if (event.data.source.kind === 'user') {
          childSession.append('user/message', event.data, { surfaceOp: 'append' })
        }
      } else if (event.type === 'assistant/message') {
        // Verbatim copy: content blocks (text/reasoning) and usage ride the
        // event's own fields, so the tokenUsage projection counts the round.
        childSession.append('assistant/message', event.data, { surfaceOp: 'append' })
      }
    }
    await ctx.get('sessionPersistence')?.append(childSession.id, childSession.events)
  } catch (error) {
    ctx.logger.warn(`subagent-dsh: session mirror failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
