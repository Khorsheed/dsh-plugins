/**
 * Mirror a kimi session's transcript into a dsh subagent session, so the
 * delegation shows up in the standard 子代理 surface and opening the child
 * session shows the full conversation (user prompts, kimi replies, thinking,
 * and tool activity with arguments and results) instead of a silent one-shot
 * call.
 * @module @khorsheed/dsh-local-agent-kimi/session-mirror
 */

import { join } from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { readKimiTranscript, sumUsageRecords, type KimiTranscriptLine } from './session-view.ts'

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
 * rather than a `[思考]` text prefix; tool activity (call with arguments and
 * result) and reply text stay text (content is never filtered — kimi's own
 * injections remain visible).
 */
function lineBlocks(line: KimiTranscriptLine): ContentBlock[] {
  if (line.kind === 'think') {
    return [{ type: 'reasoning', text: line.text }]
  }
  if (line.kind === 'tool') {
    const call = `[工具 ${line.name}]${line.args !== undefined ? ` ${line.args}` : ''}`
    return [{ type: 'text', text: `${call}${line.result !== undefined ? ` → ${line.result}` : ''}` }]
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
 * messages. Turn numbers come from the rounds already recorded in the child
 * session (`turn/start` count — the dsh round numbering), never from user
 * line counts, and the delta's usage is the SUM of every `usage.record`
 * inside it (kimi reports per-request, not cumulative), attached to the
 * delta's final assistant message.
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
  const steps = new Map<number, number>()
  // The delta's usage is the sum of every usage.record at or after the
  // already-mirrored offset — each record is one LLM request, not cumulative.
  const deltaUsage = sumUsageRecords(
    transcript.usageRecords.filter(record => record.line >= fromLines),
  )
  // Attach the summed usage to the delta's LAST assistant message (text or
  // think both carry the round's accounting; tool lines do not).
  let lastAssistant = -1
  for (let index = 0; index < delta.length; index += 1) {
    const line = delta[index]
    if (line !== undefined && line.kind !== 'user' && line.kind !== 'tool') lastAssistant = index
  }
  for (let index = 0; index < delta.length; index += 1) {
    const line = delta[index]
    if (line === undefined) continue
    // The wire's turn number (1-based, matching the provider's turn/start
    // numbering) is the dsh round; no offset is needed because both count the
    // same rounds.
    const turn = line.turn
    if (line.kind === 'user') {
      steps.set(turn, 1)
      childSession.append('user/message', userEvent(line.text), { surfaceOp: 'append' })
    } else {
      const step = steps.get(turn) ?? 1
      steps.set(turn, step + 1)
      childSession.append('assistant/message', {
        turn,
        step,
        message: assistantEvent(lineBlocks(line)),
        ...index === lastAssistant && deltaUsage !== undefined ? { usage: deltaUsage } : {},
      }, { surfaceOp: 'append' })
    }
  }
  const persistence = ctx.get('sessionPersistence')
  await persistence?.append(childSession.id, childSession.events)
  return transcript.lines.length
}
