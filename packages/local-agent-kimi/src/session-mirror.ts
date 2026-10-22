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
import type { Session, SessionEventMap } from '@deepseek-ai/dsh-session'
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
type ToolCallBlockId = Extract<ContentBlock, { type: 'tool-call' }>['id']

/**
 * The synthesized result for a call whose result the wire never recorded
 * (a settle-pass fold, or a live reservation kimi never logged). The
 * released-log contract resolves every advertised call before its step
 * closes, so an interrupted call folds with this error result.
 */
export const KIMI_INTERRUPTED_TOOL_RESULT = '（工具调用被中断，未能记录返回结果）'

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
  /**
   * The new mirror offset (transcript lines folded so far). An unresulted
   * tool line HOLDS a mid-round pass: the offset stops before it and the
   * next pass retries from there.
   */
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
 *
 * The durable contract this enforces: the released-log reader admits only
 * dense, strictly sequential steps (one open at a time) — so the fold writes
 * every step as one atomic step/start→…→step/end triple, and a fold landing
 * at a reserved step first finalizes every stream reservation below it.
 */
export interface KimiMirrorStreams {
  /**
   * Steps in-flight streams reserved for this turn (their live updates ride
   * `local-agent/stream` events there). Sequential folds skip them, so a
   * tool card folded mid-stream lands ABOVE the stream's step and the
   * projection renders the round's chronological order.
   */
  reservedSteps(turn: number): readonly number[]
  /**
   * Finalize every in-flight stream reserved below `step`, in ascending
   * order, writing each one's atomic step triple with its accumulated text.
   * Called before any fold writes at `step`. Stream reservations only: an
   * unresulted tool line HOLDS the pass instead, so a tool reservation
   * never sits inside the gap.
   */
  finalizeBefore?(turn: number, step: number): void
  /** Consume the ACP tool notification's chronological reservation for this wire line. */
  completeTool?(line: KimiTranscriptLine & { kind: 'tool' }): { readonly step: number } | undefined
  /**
   * The pairing completeStream WOULD commit for this line, without consuming
   * it. The fold consults it to keep usage off a line that will drop (a
   * sealed pairing) — the usage then rides the pass's last folding assistant
   * message instead.
   */
  peekStream?(line: KimiTranscriptLine & { kind: 'assistant' | 'think' }): { readonly step: number; readonly sealed: boolean } | undefined
  /**
   * Pair one completed think/assistant transcript line with its in-flight
   * stream, consuming the pairing. `sealed: false` folds the line at the
   * reserved step (one atomic triple); `sealed: true` means finalizeBefore
   * already wrote the stream's triple (its line never reached the wire in
   * order) — the caller drops the line rather than duplicate the content.
   * Undefined folds the line sequentially.
   */
  completeStream(
    line: KimiTranscriptLine & { kind: 'assistant' | 'think' },
  ): { readonly step: number; readonly sealed: boolean } | undefined
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
  /**
   * Settle pass: a tool line whose result the wire never recorded folds with
   * a synthesized interrupted result instead of holding the pass (the round
   * is over — the result will never arrive). Mid-round passes hold there.
   */
  settle?: boolean
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
 * Every folded step is one ATOMIC `step/start`–`step/end` triple, written
 * only when its content lands: the released-log reader admits only dense,
 * strictly sequential steps (one open at a time — a second `step/start`
 * while another step is open fails the session's reload validation), and the
 * live conversation assembler needs the boundary to materialize the step at
 * all. A think/assistant line that completes an in-flight stream folds at
 * the stream's reserved step (see {@link KimiMirrorStreams}), after
 * `finalizeBefore` has closed every stream reservation below it; a
 * sequential fold never takes a step a stream reserved.
 *
 * A tool line folds the native lifecycle inside one step: an assistant
 * message advertising the tool-call block, the `tool/call`, and its
 * `tool/result` — the reader resolves every advertised call before the step
 * closes, so a line whose result the wire has not recorded yet HOLDS the
 * pass (the result merges into the call's line in place, so a later pass
 * sees it; the offset stops before the held line). The settle pass folds the
 * remainder with a synthesized interrupted result.
 *
 * Usage accounting is exactly-once ACROSS passes: each `usage.record` is
 * tagged with the transcript position it occurred at, and a pass attaches the
 * records between the old offset and its own consumed end — the records that
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
 * @returns the new mirror offset and the newly mirrored lines' texts. A held
 *   unresulted tool line stops the offset before itself; the next pass
 *   retries from there.
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

  const delta = transcript.lines.slice(fromLines)
  const observedModel = options?.turn === undefined || transcript.modelTurn === options.turn ? transcript.model : undefined
  // The ROUND's tool calls, counted over the transcript lines carrying this
  // round's turn — deliberately NOT over the mirror window: a settle pass
  // whose delta a live poll already drained still owes the round its real
  // count, and a resume round must not inherit the earlier rounds' calls.
  const toolCalls = roundToolCalls(transcript.lines, options?.turn)
  // A tool line whose result the wire has not recorded yet cannot close its
  // step (the released-log contract resolves every advertised call before
  // step/end), so a mid-round pass HOLDS there: the offset stops before the
  // line and the fold retries once the wire records the result (it merges
  // into the call's line in place, same transcript position). The settle
  // pass never holds — a result that will never arrive folds as a
  // synthesized interrupted one.
  const holdIndex = options?.settle === true
    ? -1
    : delta.findIndex(line => line?.kind === 'tool' && line.result === undefined)
  const folded = holdIndex < 0 ? delta : delta.slice(0, holdIndex)
  const consumedTotal = fromLines + folded.length
  // The pass attaches the usage records whose content ITS lines carry. kimi
  // writes a request's `usage.record` BEFORE the content parts it accounts
  // for, so a record sitting exactly on the delta boundary (its content is
  // entirely inside this pass) must attach here — otherwise incremental
  // folds (live mid-run + settle) lose the round's accounting entirely. The
  // window closes at the held line: records past it belong to a later pass.
  const deltaUsage = sumUsageRecords(
    transcript.usageRecords.filter(record => record.line >= fromLines && record.line <= consumedTotal),
  )
  // Attach the summed usage to the delta's LAST assistant message (text or
  // think both carry the round's accounting; tool lines do not). A line whose
  // stream was already sealed by a gap fill DROPS instead of folding, so it
  // cannot carry the usage — the carrier is the last line that folds.
  let lastAssistant = -1
  for (let index = 0; index < folded.length; index += 1) {
    const line = folded[index]
    if (line === undefined || line.kind === 'user' || line.kind === 'tool') continue
    if (options?.streams?.peekStream?.(line)?.sealed === true) continue
    lastAssistant = index
  }
  // Continue step numbering from the steps already mirrored (assistant
  // messages AND tool events both consume steps), so a round mirrored across
  // several live polls keeps 1, 2, 3… instead of restarting per poll.
  const steps = new Map<number, number>()
  for (const event of childSession.snapshotEvents()) {
    const data = event.data as { turn?: number; step?: number }
    if (typeof data.turn === 'number' && typeof data.step === 'number') {
      steps.set(data.turn, Math.max(steps.get(data.turn) ?? 0, data.step + 1))
    }
  }
  /**
   * The next sequential fold step in one turn: the running counter, shifted
   * past every step an in-flight stream reserved (the stream's completion
   * fold lands at its reserved coordinate — a sequential fold taking it
   * would collide with the reservation).
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
  for (let index = 0; index < folded.length; index += 1) {
    const line = folded[index]
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
      // The native tool lifecycle inside one step: an assistant message
      // advertising the tool-call block, the call, then its result — the
      // released-log reader pairs call and result against the advertisement
      // and resolves every advertised call before the step closes.
      const reserved = options?.streams?.completeTool?.(line)
      const step = reserved?.step ?? nextFoldStep(turn)
      // Close every stream reservation below the fold step first: stored
      // steps must land dense and strictly sequential.
      options?.streams?.finalizeBefore?.(turn, step)
      steps.set(turn, Math.max(steps.get(turn) ?? 1, step + 1))
      const args = line.args ?? ''
      childSession.append('step/start', { turn, step })
      childSession.append('assistant/message', {
        turn,
        step,
        message: assistantEvent([{ type: 'tool-call', id: line.id as ToolCallBlockId, name: line.name, arguments: args }], line.model),
        stream: [],
      }, { surfaceOp: 'append' })
      const call = childSession.append('tool/call', {
        turn,
        step,
        callId: line.id as ToolCallEventCallId,
        name: line.name,
        arguments: args,
      })
      childSession.append('tool/result', {
        turn,
        step,
        message: createToolResultMessage({
          callId: line.id as ToolResultCallId,
          content: [{ type: 'text', text: line.result ?? KIMI_INTERRUPTED_TOOL_RESULT }],
          isError: line.result === undefined,
        }),
      }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
      childSession.append('step/end', { turn, step })
      texts.push(kimiLineProgressText(line))
    } else {
      // A completed think/assistant line pairs with its in-flight stream when
      // one is live (the token granularity's per-kind stream): the fold lands
      // at the stream's reserved step as one atomic triple. A sealed pairing
      // drops the line instead — finalizeBefore already wrote the stream's
      // durable triple, so folding the line would duplicate the content.
      const completion = options?.streams?.completeStream(line)
      if (completion?.sealed === true) {
        texts.push(kimiLineProgressText(line))
        continue
      }
      if (completion !== undefined) {
        options?.streams?.finalizeBefore?.(turn, completion.step)
        steps.set(turn, Math.max(steps.get(turn) ?? 1, completion.step + 1))
        childSession.append('step/start', { turn, step: completion.step })
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
      options?.streams?.finalizeBefore?.(turn, step)
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
    total: consumedTotal,
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
