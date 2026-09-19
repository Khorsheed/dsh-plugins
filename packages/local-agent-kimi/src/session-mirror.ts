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
import { createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEventMap, SessionSeq } from '@deepseek-ai/dsh-session'
import type { LocalAgentToolCalls } from '@khorsheed/dsh-local-agent/types'
import { persistChildSession } from '@khorsheed/dsh-local-agent'
import { readKimiTranscript, sumUsageRecords, type KimiTranscriptLine } from './session-view.ts'

// The host renamed its tool-call id brand between lines (`CallId` on the npm
// rc line, a new name on 0.1.2-alpha). A brand is compile-time-only and the
// runtime value is a plain string, so instead of importing either brand
// factory we extract the field types from the consuming APIs — the same
// source then compiles against both lines.
type ToolCallEventCallId = SessionEventMap['tool/call']['callId']
type ToolResultCallId = Parameters<typeof createToolResultMessage>[0]['callId']

/** One user-role message event. */
function userEvent(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/** One assistant-role message event, attributed to the kimi route. */
export function assistantEvent(blocks: readonly ContentBlock[], model?: string) {
  return createAssistantMessage({
    content: blocks as ContentBlock[],
    source: { provider: 'kimi-cli', model: model ?? 'unobserved' },
  })
}

/**
 * The step the next fold pass would assign in one turn (the max existing
 * step + 1). The token-granularity live
 * driver reserves its stream merge key here LAZILY at the first delta, so
 * tool cards folded before the stream started keep their chronological
 * place below it instead of the stream squatting on step 1.
 * @param childSession - the run's child session.
 * @param turn - the round's turn number.
 * @returns the next free step in the turn.
 */
export function nextKimiSessionStep(childSession: Session, turn: number): number {
  let next = 1
  for (const event of childSession.snapshotEvents()) {
    const data = event.data as { turn?: number; step?: number }
    if (data.turn === turn && typeof data.step === 'number') next = Math.max(next, data.step + 1)
  }
  return next
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
  /**
   * The usage this pass computed for its window. Attached to the window's
   * last folded assistant message when one exists (see `usageAttached`);
   * otherwise returned unattached, so the caller (the token-granularity live
   * driver) can carry it on the stream's final snapshot instead.
   */
  usage?: TokenUsage
  /**
   * True when this pass's usage rode a folded assistant message — the caller
   * must never attach that accounting a second time.
   */
  usageAttached?: boolean
  /**
   * The model identifier the wire named (a `usage.record` or `llm.request`
   * `model` field, last one seen) — the delegation's observed-model source.
   * Absent when the wire carried none.
   */
  model?: string
  /**
   * The ROUND's tool-call accounting, counted from the transcript's own
   * `tool.call` lines (`options.turn` selects the round). Keyed by the name
   * the wire gave the tool, never normalized. Absent when no turn was named
   * or the round called none.
   */
  toolCalls?: LocalAgentToolCalls
}

/**
 * The live stream ledger a fold pass coordinates with.
 * Absent on the exec path, where no streams reserve steps.
 */
export interface KimiMirrorStreams {
  /**
   * Steps in-flight streams reserved for this turn (their snapshot messages
   * append there). Sequential folds must skip them, so a tool card folded
   * mid-stream lands ABOVE the stream's step and the projection renders the
   * round's chronological order.
   */
  reservedSteps(turn: number): readonly number[]
  /** Reserve chronological placement from the ACP tool notification before its file fold. */
  completeTool?(line: KimiTranscriptLine & { kind: 'tool' }): { readonly step: number; readonly opened: boolean } | undefined
  /**
   * Pair one completed think/assistant transcript line with its in-flight
   * stream. Returns the reservation — consuming it — when this line finalizes
   * a stream: the caller folds the line's message at the reserved step,
   * opening the step boundary only when `opened` is false (no snapshot ever
   * landed), and closes it. Undefined folds the line sequentially. A
   * (turn, step) NEVER takes a second step/start.
   */
  completeStream(
    line: KimiTranscriptLine & { kind: 'assistant' | 'think' },
  ): { readonly step: number; readonly opened: boolean } | undefined
}

/** Mirror behavior switches shared by the exec and live paths. */
export interface KimiMirrorOptions {
  /**
   * The round this pass belongs to (the wire's 1-based turn, which matches
   * the provider's own turn numbering). Given, the delta reports that ROUND's
   * tool-call accounting — counted over the transcript lines carrying this
   * turn, not over the mirror window, so a settle pass that a live poll
   * already drained still reports the round's real count. Absent, no
   * accounting is reported.
   */
  turn?: number
  /**
   * The token-granularity live round's stream ledger: folds pair completed
   * think/assistant lines with their streams and skip reserved steps.
   */
  streams?: KimiMirrorStreams
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
 * Every folded step is wrapped in the `step/start`–`step/end` boundary pair
 * the live conversation assembler requires: without a boundary the step never
 * enters the location index, the assistant message resolves to a turn-level
 * location, and the real-time view renders nothing (only a full rebuild,
 * which mints step drafts from the explicit coordinates, recovers it). A
 * think/assistant line that completes an in-flight stream folds at the
 * stream's reserved step instead (see {@link KimiMirrorStreams}), and a
 * sequential fold never takes a step a stream reserved.
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
  options?: KimiMirrorOptions,
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
  const observedModel = options?.turn === undefined || transcript.modelTurn === options.turn ? transcript.model : undefined
  // The ROUND's tool calls, counted over the transcript lines carrying this
  // round's turn — deliberately NOT over the mirror window: a settle pass
  // whose delta a live poll already drained still owes the round its real
  // count, and a resume round must not inherit the earlier rounds' calls.
  const toolCalls = roundToolCalls(transcript.lines, options?.turn)
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
  const openCalls = new Map<string, { turn: number; step: number; seq: SessionSeq }>()
  const settledCalls = new Set<string>()
  for (const event of childSession.snapshotEvents()) {
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
  /**
   * The next sequential fold step in one turn: the running counter, shifted
   * past every step an in-flight stream reserved (a stream's snapshots and
   * its completion fold live at the reserved coordinate — a sequential fold
   * landing there would write a second step/start, which the assembler
   * rejects).
   */
  const nextFoldStep = (turn: number): number => {
    let step = steps.get(turn) ?? 1
    const reserved = options?.streams?.reservedSteps(turn)
    if (reserved !== undefined && reserved.length > 0) {
      const skip = new Set(reserved)
      while (skip.has(step)) step += 1
    }
    steps.set(turn, step + 1)
    return step
  }
  /** Whether this pass attached its window's usage to a folded message. */
  let usageAttached = false
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
    // No second boundary pair here: the call's fold already opened AND closed
    // this (turn, step), and the live assembler throws on a duplicate start
    // match for the same context. The step stays registered in the location
    // index, so the bare result still resolves to the step location — and the
    // tool definition never consults it anyway.
    childSession.append('tool/result', {
      turn: call.turn,
      step: call.step,
      message: createToolResultMessage({
        callId: line.id as ToolResultCallId,
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
      await persistChildSession(ctx, childSession)
    }
    return {
      total: newTotal,
      texts,
      ...deltaUsage !== undefined ? { usage: deltaUsage } : {},
      ...usageAttached ? { usageAttached: true } : {},
      ...observedModel !== undefined ? { model: observedModel } : {},
      ...toolCalls !== undefined ? { toolCalls } : {},
    }
  }
  for (let index = 0; index < delta.length; index += 1) {
    const line = delta[index]
    if (line === undefined) continue
    // The wire's turn number (1-based, matching the provider's turn/start
    // numbering) is the dsh round; no offset is needed because both count the
    // same rounds.
    const turn = line.turn
    if (line.kind === 'user') {
      // The live driver appends the round's user/message at turn start (so the
      // question renders before the streamed think/text instead of after it).
      // Skip the wire's copy of the same prompt — scoped to THIS turn so two
      // rounds with identical prompts still fold independently.
      if (userAlreadyAppended(childSession, turn, line.text)) continue
      steps.set(turn, 1)
      childSession.append('user/message', userEvent(line.text), { surfaceOp: 'append' })
      texts.push(line.text)
    } else if (line.kind === 'tool') {
      // Native tool card: the call event now, the result event when the wire
      // already carries it (else the backfill above pairs it in a later pass).
      const reserved = options?.streams?.completeTool?.(line)
      const step = reserved?.step ?? nextFoldStep(turn)
      steps.set(turn, Math.max(steps.get(turn) ?? 1, step + 1))
      if (reserved?.opened !== true) childSession.append('step/start', { turn, step })
      const call = childSession.append('tool/call', {
        turn,
        step,
        callId: line.id as ToolCallEventCallId,
        name: line.name,
        arguments: line.args ?? '',
      })
      texts.push(kimiLineProgressText(line))
      if (line.result !== undefined) {
        childSession.append('tool/result', {
          turn,
          step,
          message: createToolResultMessage({
            callId: line.id as ToolResultCallId,
            content: [{ type: 'text', text: line.result }],
        isError: false,
          }),
        }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
      }
      childSession.append('step/end', { turn, step })
    } else {
      // A completed think/assistant line pairs with its in-flight stream when
      // one is live (the token granularity's per-kind stream): the fold lands
      // at the stream's reserved step, finalizing the snapshots — the step
      // opens only when no snapshot ever landed (a fast item that stayed
      // under the throttle), and closes here. A (turn, step) never takes a
      // second step/start.
      const completion = options?.streams?.completeStream(line)
      if (completion !== undefined) {
        steps.set(turn, Math.max(steps.get(turn) ?? 1, completion.step + 1))
        if (!completion.opened) childSession.append('step/start', { turn, step: completion.step })
        if (index === lastAssistant && deltaUsage !== undefined) usageAttached = true
        childSession.append('assistant/message', {
          turn,
          step: completion.step,
          message: assistantEvent(lineBlocks(line), line.model),
          stream: [],
          ...index === lastAssistant && deltaUsage !== undefined ? { usage: deltaUsage } : {},
        }, { surfaceOp: 'append' })
        childSession.append('step/end', { turn, step: completion.step })
        texts.push(kimiLineProgressText(line))
        continue
      }
      const step = nextFoldStep(turn)
      childSession.append('step/start', { turn, step })
      if (index === lastAssistant && deltaUsage !== undefined) usageAttached = true
      childSession.append('assistant/message', {
        turn,
        step,
        message: assistantEvent(lineBlocks(line), line.model),
        stream: [],
        ...index === lastAssistant && deltaUsage !== undefined ? { usage: deltaUsage } : {},
      }, { surfaceOp: 'append' })
      childSession.append('step/end', { turn, step })
      texts.push(kimiLineProgressText(line))
    }
  }
  await persistChildSession(ctx, childSession)
  return {
    total: newTotal,
    texts,
    ...deltaUsage !== undefined ? { usage: deltaUsage } : {},
    ...usageAttached ? { usageAttached: true } : {},
    ...observedModel !== undefined ? { model: observedModel } : {},
    ...toolCalls !== undefined ? { toolCalls } : {},
  }
}

/**
 * Count one round's tool calls out of a kimi transcript, keyed by the name the
 * wire gave each tool. No turn named, or no `tool.call` line carrying it,
 * yields undefined — a round reports nothing rather than a zero it did not
 * observe. Reads only the transcript lines the mirror already folded.
 * @param lines - the whole session transcript.
 * @param turn - the round's 1-based turn, when the caller named one.
 * @returns the round's accounting, or undefined.
 */
export function roundToolCalls(
  lines: readonly KimiTranscriptLine[],
  turn: number | undefined,
): LocalAgentToolCalls | undefined {
  if (turn === undefined) return undefined
  const byName: Record<string, number> = {}
  let count = 0
  for (const line of lines) {
    if (line.kind !== 'tool' || line.turn !== turn) continue
    count += 1
    byName[line.name] = (byName[line.name] ?? 0) + 1
  }
  return count === 0 ? undefined : { count, byName }
}

/**
 * Whether the turn already carries a user/message with this exact text (the
 * live driver's round-start append). Scoped to the events at or after this
 * turn's turn/start so identical prompts across rounds stay independent.
 */
function userAlreadyAppended(childSession: Session, turn: number, text: string): boolean {
  let turnStartSeq = -1
  for (const event of childSession.snapshotEvents()) {
    if (event.type === 'turn/start' && (event.data as { turn?: number }).turn === turn) {
      turnStartSeq = event.seq
    }
  }
  if (turnStartSeq < 0) return false
  for (const event of childSession.snapshotEvents()) {
    if (event.seq < turnStartSeq || event.type !== 'user/message') continue
    const data = event.data as { content?: readonly { type: string; text?: string }[] }
    const existing = (data.content ?? []).map(block => block.text ?? '').join('')
    if (existing === text) return true
  }
  return false
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
