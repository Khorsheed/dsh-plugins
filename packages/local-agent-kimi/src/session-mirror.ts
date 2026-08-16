/**
 * Mirror a kimi session's transcript into a dsh subagent session, so the
 * delegation shows up in the standard 子代理 surface and opening the child
 * session shows the full conversation (user prompts, kimi replies, and the
 * tool activity) instead of a silent one-shot call.
 * @module @khorsheed/dsh-local-agent-kimi/session-mirror
 */

import { join } from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { readKimiTranscript, type KimiTranscriptLine } from './session-view.ts'

/** One user-role message event. */
function userEvent(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/** One assistant-role message event, attributed to the kimi route. */
function assistantEvent(blocks: readonly ContentBlock[]) {
  return createAssistantMessage({
    content: blocks as ContentBlock[],
    source: { provider: 'kimi-cli', model: 'k3' },
  })
}

/**
 * Fold one transcript line into message blocks. Thinking maps to the native
 * `reasoning` block so the standard conversation renders it as thinking
 * rather than a `[思考]` text prefix; tool activity and reply text stay text
 * (content is never filtered — kimi's own injections remain visible).
 */
function lineBlocks(line: KimiTranscriptLine): ContentBlock[] {
  if (line.kind === 'think') {
    return [{ type: 'reasoning', text: line.text }]
  }
  if (line.kind === 'tool') {
    return [{ type: 'text', text: `[工具 ${line.name}]${line.result !== undefined ? ` → ${line.result}` : ''}` }]
  }
  return [{ type: 'text', text: line.text }]
}

/**
 * Mirror one kimi session's transcript into the dsh subagent session: each
 * user prompt becomes a `user/message`, each assistant reply (including
 * folded thinking and tool activity) an `assistant/message`, then the events
 * are appended to persistence so the child session is viewable.
 *
 * A resumed round passes the already-mirrored transcript-line count so only
 * the delta is appended — re-mirroring earlier rounds would duplicate their
 * messages. Turn numbering continues from the rounds already recorded in the
 * child session, and the wire's last usage record (the newest turn's) rides
 * the delta's final assistant message.
 * @param ctx - host context carrying the session persistence service.
 * @param childSession - the dsh subagent session created for this delegation.
 * @param homeDir - the `kimi` harness's scoped home.
 * @param kimiSessionId - the kimi session to mirror; omitted mirrors the most
 *   recent session (a one-shot `kimi -p` run always creates a fresh one).
 * @param fromLines - transcript lines already mirrored into the child session
 *   (0 for the first round); only lines after this offset are appended.
 * @returns the new total transcript-line count mirrored into the child session.
 */
export async function mirrorKimiSession(
  ctx: Context,
  childSession: Session,
  homeDir: string,
  kimiSessionId?: string,
  fromLines = 0,
): Promise<number> {
  let workspaces: string[]
  try {
    workspaces = await readdir(join(homeDir, 'sessions'))
  } catch {
    // No kimi sessions at all; nothing to mirror.
    return 0
  }
  let transcript: Awaited<ReturnType<typeof readKimiTranscript>> | undefined
  if (kimiSessionId !== undefined) {
    for (const workspace of workspaces) {
      const dir = join(homeDir, 'sessions', workspace, `session_${kimiSessionId}`)
      try {
        transcript = await readKimiTranscript(dir)
      } catch {
        // Not this workspace's session; keep looking.
        continue
      }
      // A missing wire log reads as an empty transcript, so keep looking —
      // the named session may live in a later workspace.
      if (transcript.lines.length > 0) break
    }
  } else {
    // Most recent session across workspaces: a one-shot `kimi -p` run just
    // created the newest one.
    let newest: { dir: string; time: number } | undefined
    for (const workspace of workspaces) {
      let sessions: string[]
      try {
        sessions = await readdir(join(homeDir, 'sessions', workspace))
      } catch {
        continue
      }
      for (const name of sessions) {
        if (!name.startsWith('session_')) continue
        const dir = join(homeDir, 'sessions', workspace, name)
        const meta = await stat(dir)
        if (newest === undefined || meta.mtimeMs > newest.time) {
          newest = { dir, time: meta.mtimeMs }
        }
      }
    }
    if (newest !== undefined) {
      try {
        transcript = await readKimiTranscript(newest.dir)
      } catch {
        transcript = undefined
      }
    }
  }
  if (transcript === undefined || transcript.lines.length === 0) return 0

  const delta = transcript.lines.slice(fromLines)
  if (delta.length === 0) return transcript.lines.length
  // The turn counter continues from the rounds already in the child session:
  // each user message already mirrored opened one turn, so the delta's first
  // user line opens the next turn.
  let turn = childSession.events.filter(event => event.type === 'user/message').length
  let step = 1
  // The wire's last usage record belongs to the latest (resumed) turn's final
  // assistant message; find its index within the delta so the accounting
  // attaches to exactly that event.
  let lastAssistant = -1
  for (let index = 0; index < delta.length; index += 1) {
    if (delta[index]?.kind !== 'user') lastAssistant = index
  }
  for (let index = 0; index < delta.length; index += 1) {
    const line = delta[index]
    if (line === undefined) continue
    if (line.kind === 'user') {
      turn += 1
      step = 1
      childSession.append('user/message', userEvent(line.text), { surfaceOp: 'append' })
    } else {
      childSession.append('assistant/message', {
        turn,
        step,
        message: assistantEvent(lineBlocks(line)),
        ...index === lastAssistant && transcript.usage !== undefined ? { usage: transcript.usage } : {},
      }, { surfaceOp: 'append' })
      step += 1
    }
  }
  const persistence = ctx.get('sessionPersistence')
  await persistence?.append(childSession.id, childSession.events)
  return transcript.lines.length
}