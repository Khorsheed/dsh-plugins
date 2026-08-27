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
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
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
 * Fold one non-tool transcript line into message blocks. Thinking maps to
 * the native `reasoning` block so the standard conversation renders it as
 * thinking rather than a `[思考]` text prefix; reply text stays text (content
 * is never filtered — kimi's own injections remain visible). Tool lines are
 * NOT folded here: they become native `tool/call`/`tool/result` event pairs
 * (see the mirror loop), so the standard conversation renders them as tool
 * cards instead of `[工具 X]` text.
 */
function lineBlocks(line: KimiTranscriptLine & { kind: 'assistant' | 'think' }): ContentBlock[] {
  if (line.kind === 'think') {
    return [{ type: 'reasoning', text: line.text }]
  }
  return [{ type: 'text', text: line.text }]
}

/** The run-progress delta text for one transcript line (any kind). */
export function kimiLineProgressText(line: KimiTranscriptLine): string {
  if (line.kind !== 'tool') return line.text
  const call = `[工具 ${line.name}]${line.args !== undefined ? ` ${line.args}` : ''}`
  return `${call}${line.result !== undefined ? ` → ${line.result}` : ''}`
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
 * folded thinking and tool activity) an `assistant/message`, then the events
 * are appended to persistence so the child session is viewable.
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
    // Records may be bare uuids (the convention) or carry the ACP directory
    // prefix (legacy live records): normalize instead of double-prefixing.
    const dirName = kimiSessionId.startsWith('session_') ? kimiSessionId : `session_${kimiSessionId}`
    for (const workspace of workspaces) {
      const dir = join(homeDir, 'sessions', workspace, dirName)
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
  // No early return on an empty delta: a result that merged into an
  // already-mirrored tool line does not change the line count, and the
  // backfill below still owes that call its `tool/result` event.
  // The pass attaches the usage records whose content ITS lines carry. kimi
  // writes a request's `usage.record` BEFORE the content parts it accounts
  // for, so a record sitting exactly on the delta boundary (its content is
  // entirely inside this pass) must attach here — otherwise incremental
  // folds (live mid-run + settle) lose the round's accounting entirely.
  const deltaUsage = sumUsageRecords(
    transcript.usageRecords.filter(record => record.line >= fromLines && record.line <= newTotal),
  )
  // Attach the summed usage to the delta's LAST assistant message (text or
  // think both carry the round's accounting; tool lines do not).
  let lastAssistant = -1
  for (let index = 0; index < delta.length; index += 1) {
    const line = delta[index]
    if (line !== undefined && line.kind !== 'user' && line.kind !== 'tool') lastAssistant = index
  }
  // Continue step numbering from the steps already mirrored (assistant
  // messages AND tool events both consume steps), so a round mirrored across
  // several live polls keeps 1, 2, 3… instead of restarting per poll.
  const steps = new Map<number, number>()
  // The child session's own events are the ledger of mirrored tool calls:
  // callId → its event (for pairing late results) and the already-settled
  // call ids (so a backfill never duplicates a result).
  const openCalls = new Map<string, { turn: number; step: number; seq: number }>()
  const settledCalls = new Set<string>()
  for (const event of childSession.events) {
    const data = event.data as { turn?: number; step?: number }
    if (typeof data.turn === 'number' && typeof data.step === 'number') {
      steps.set(data.turn, Math.max(steps.get(data.turn) ?? 0, data.step + 1))
    }
    if (event.type === 'tool/call') {
      const call = event.data as { turn: number; step: number; callId: string }
      openCalls.set(call.callId, { turn: call.turn, step: call.step, seq: event.seq })
    } else if (event.type === 'tool/result') {
      const message = (event.data as { message?: { content?: readonly { type: string; toolCallId?: string }[] } }).message
      const id = message?.content?.[0]?.toolCallId
      if (id !== undefined) {
        openCalls.delete(id)
        settledCalls.add(id)
      }
    }
  }
  const texts: string[] = []
  // Backfill results that landed after their call was mirrored in an earlier
  // pass: the delta window never revisits those lines, so a result that
  // arrives late (parallel calls settle out of order) pairs here. The result
  // reuses its call's turn/step — no new step is consumed.
  for (let index = 0; index < fromLines && index < transcript.lines.length; index += 1) {
    const line = transcript.lines[index]
    if (line === undefined || line.kind !== 'tool' || line.result === undefined) continue
    const call = openCalls.get(line.id)
    if (call === undefined) continue
    openCalls.delete(line.id)
    settledCalls.add(line.id)
    childSession.append('tool/result', {
      turn: call.turn,
      step: call.step,
      message: createToolResultMessage({
        callId: CallId(line.id),
        content: [{ type: 'text', text: line.result }],
        isError: false,
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    texts.push(kimiLineProgressText(line))
  }
  if (delta.length === 0) {
    // No new lines this pass: only the late-result backfill above could have
    // produced events. Persist those and skip the empty delta loop.
    if (texts.length > 0) {
      await persistIfStandalone(ctx, childSession)
    }
    return { total: newTotal, texts }
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
      texts.push(line.text)
    } else if (line.kind === 'tool') {
      // Native tool card: the call event now, the result event when the wire
      // already carries it (else the backfill above pairs it in a later pass).
      const step = steps.get(turn) ?? 1
      steps.set(turn, step + 1)
      const call = childSession.append('tool/call', {
        turn,
        step,
        callId: CallId(line.id),
        name: line.name,
        arguments: line.args ?? '',
      })
      texts.push(kimiLineProgressText(line))
      if (line.result !== undefined) {
        childSession.append('tool/result', {
          turn,
          step,
          message: createToolResultMessage({
            callId: CallId(line.id),
            content: [{ type: 'text', text: line.result }],
        isError: false,
          }),
        }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
      }
    } else {
      const step = steps.get(turn) ?? 1
      steps.set(turn, step + 1)
      childSession.append('assistant/message', {
        turn,
        step,
        message: assistantEvent(lineBlocks(line)),
        ...index === lastAssistant && deltaUsage !== undefined ? { usage: deltaUsage } : {},
      }, { surfaceOp: 'append' })
      texts.push(kimiLineProgressText(line))
    }
  }
  await persistIfStandalone(ctx, childSession)
  return { total: newTotal, texts }
}

/**
 * Persist the session's events ONLY when the session is standalone (tests,
 * ad-hoc mirrors). A live session's own write-behind pipeline already durably
 * stores every appended event; re-appending the full list here violates the
 * store's contiguous-seq contract ('append seq mismatch'), and the throw used
 * to kill the mirror pass BEFORE the offset advanced — every later pass then
 * re-folded the same lines (duplicated user messages, no usage, no offset on
 * the delegation record).
 */
async function persistIfStandalone(ctx: Context, childSession: Session): Promise<void> {
  const sessions = ctx.get('sessions')
  if (sessions !== undefined && sessions.get(childSession.id) !== undefined) return
  const persistence = ctx.get('sessionPersistence')
  await persistence?.append(childSession.id, childSession.events)
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
