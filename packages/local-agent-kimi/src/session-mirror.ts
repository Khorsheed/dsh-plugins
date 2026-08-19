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

/** The result of one mirror pass: the new offset plus what was newly mirrored. */
export interface KimiMirrorDelta {
  /** The new total transcript-line count mirrored into the child session. */
  total: number
  /**
   * The folded text of each transcript line THIS pass newly mirrored, in
   * order — the payload source for `delta` run-progress reports. Empty when
   * the offset already covered the transcript (the settle pass after a live
   * mirror is therefore a no-op).
   */
  texts: string[]
}

/**
 * Mirror one kimi session's transcript into the dsh subagent session: each
 * user prompt becomes a `user/message`, each assistant reply (including
 * folded thinking and tool activity) an `assistant/message`, then the
 * session store's flush barrier carries the appended events to durability
 * (the persistence coordinator already buffers them via `session/event`,
 * so `sessions.flush` writes exactly the pending delta — a direct
 * `sessionPersistence.append` of the FULL event log double-writes and
 * violates its contiguous-batch contract once the coordinator's cursor has
 * moved past 0, e.g. after a host restart).
 *
 * A resumed round (or a live poll) passes the already-mirrored
 * transcript-line count so only the delta is appended — re-mirroring earlier
 * lines would duplicate their messages. Turn numbers come from the transcript
 * lines themselves (the wire's 1-based turn, matching the provider's
 * `turn/start` numbering); step numbers CONTINUE from the assistant messages
 * already in the child session, so a round mirrored across several live polls
 * does not restart step 1 per poll.
 *
 * Usage accounting is exactly-once ACROSS passes: each `usage.record` is
 * tagged with the transcript position it occurred at, and a pass attaches the
 * records in the half-open range `(fromLines, newTotal]` — the records that
 * trail THIS pass's lines — summed onto the delta's final assistant message.
 * (A record flushed only after its line was already mirrored belongs to no
 * later pass and is dropped; kimi flushes content and usage together per
 * request, so this window is a flush race, not the norm.)
 * @param ctx - host context carrying the session persistence service.
 * @param childSession - the dsh subagent session created for this delegation.
 * @param homeDir - the `kimi` harness's scoped home.
 * @param kimiSessionId - the kimi session to mirror; omitted mirrors the most
 *   recent session (a one-shot `kimi -p` run always creates a fresh one).
 * @param fromLines - transcript lines already mirrored into the child session
 *   (0 for the first round); only lines after this offset are appended.
 * @returns the new total and the newly mirrored lines' texts.
 */
export async function mirrorKimiSessionDelta(
  ctx: Context,
  childSession: Session,
  homeDir: string,
  kimiSessionId?: string,
  fromLines = 0,
): Promise<KimiMirrorDelta> {
  let workspaces: string[]
  try {
    workspaces = await readdir(join(homeDir, 'sessions'))
  } catch {
    // No kimi sessions at all; nothing to mirror.
    return { total: 0, texts: [] }
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
  if (transcript === undefined || transcript.lines.length === 0) return { total: 0, texts: [] }

  const newTotal = transcript.lines.length
  const delta = transcript.lines.slice(fromLines)
  if (delta.length === 0) return { total: newTotal, texts: [] }
  // The pass attaches the usage records that trail ITS lines: positions in
  // (fromLines, newTotal]. Each record is one LLM request's accounting (kimi
  // does not accumulate within a turn).
  const deltaUsage = sumUsageRecords(
    transcript.usageRecords.filter(record => record.line > fromLines && record.line <= newTotal),
  )
  // Attach the summed usage to the delta's LAST assistant message (text or
  // think both carry the round's accounting; tool lines do not).
  let lastAssistant = -1
  for (let index = 0; index < delta.length; index += 1) {
    const line = delta[index]
    if (line !== undefined && line.kind !== 'user' && line.kind !== 'tool') lastAssistant = index
  }
  // Continue step numbering from the assistant steps already mirrored, so a
  // round mirrored across several live polls keeps 1, 2, 3… instead of
  // restarting per poll.
  const steps = new Map<number, number>()
  for (const event of childSession.events) {
    if (event.type !== 'assistant/message') continue
    const data = event.data as { turn?: number; step?: number }
    if (typeof data.turn === 'number' && typeof data.step === 'number') {
      steps.set(data.turn, Math.max(steps.get(data.turn) ?? 0, data.step + 1))
    }
  }
  const texts: string[] = []
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
      texts.push(line.text)
    } else {
      const step = steps.get(turn) ?? 1
      steps.set(turn, step + 1)
      childSession.append('assistant/message', {
        turn,
        step,
        message: assistantEvent(lineBlocks(line)),
        ...index === lastAssistant && deltaUsage !== undefined ? { usage: deltaUsage } : {},
      }, { surfaceOp: 'append' })
      texts.push(lineBlocks(line).map(block => block.type === 'text' || block.type === 'reasoning' ? block.text : '').join(''))
    }
  }
  await ctx.get('sessions')?.flush(childSession)
  return { total: newTotal, texts }
}

/**
 * Mirror one kimi session's transcript into the dsh subagent session,
 * returning only the new total transcript-line count. Thin wrapper over
 * {@link mirrorKimiSessionDelta} for callers that do not report progress.
 * @param ctx - host context carrying the session persistence service.
 * @param childSession - the dsh subagent session created for this delegation.
 * @param homeDir - the `kimi` harness's scoped home.
 * @param kimiSessionId - the kimi session to mirror; omitted mirrors the most
 *   recent session.
 * @param fromLines - transcript lines already mirrored into the child session.
 * @returns the new total transcript-line count mirrored into the child session.
 */
export async function mirrorKimiSession(
  ctx: Context,
  childSession: Session,
  homeDir: string,
  kimiSessionId?: string,
  fromLines = 0,
): Promise<number> {
  return (await mirrorKimiSessionDelta(ctx, childSession, homeDir, kimiSessionId, fromLines)).total
}
