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
import type { ContentBlock, ReasoningEffortId, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEventMap } from '@deepseek-ai/dsh-session'
import type { LocalAgentToolCalls } from '@khorsheed/dsh-local-agent/types'
import { persistChildSession } from '@khorsheed/dsh-local-agent'
import { addTokenUsage, readKimiTranscript, sumUsageRecords, type KimiTranscriptLine } from './session-view.ts'

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
 * The step the next fold pass would assign in one turn: the smallest step
 * nothing holds (never written, never reserved at call time — callers skip
 * their own reservations on top). Filling the smallest free step keeps the
 * stored log dense: the released-log reader admits only dense, strictly
 * sequential steps, and a reservation released mid-round (its content rode an
 * earlier fold) leaves a gap only the next first-free write fills.
 * @param childSession - the run's child session.
 * @param turn - the round's turn number.
 * @returns the smallest free step in the turn.
 */
export function nextKimiSessionStep(childSession: Session, turn: number): number {
  const taken = new Set<number>()
  for (const event of childSession.snapshotEvents()) {
    const data = event.data as { turn?: number; step?: number }
    if (data.turn === turn && typeof data.step === 'number') taken.add(data.step)
  }
  let next = 1
  while (taken.has(next)) next += 1
  return next
}

/**
 * The step a durable write takes: one past the highest step this turn has
 * opened in the log. The released-log reader admits steps only in order —
 * one past the last, never below it — so the coordinate is decided when the
 * step is written, never reserved ahead (a reservation filled later lands
 * below a higher step already written: a gap, then a step out of order).
 * Stream and tool reservations only key the live preview.
 */
export function nextWrittenKimiStep(childSession: Session, turn: number): number {
  let last = 0
  for (const event of childSession.snapshotEvents()) {
    if (event.type !== 'step/start') continue
    const data = event.data as { turn?: number; step?: number }
    if (data.turn === turn && typeof data.step === 'number' && data.step > last) last = data.step
  }
  return last + 1
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
   * tool line (or a wire step the wire has not closed yet) HOLDS a mid-round
   * pass: the offset stops before it and the next pass retries from there.
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
   * The usage this pass computed for its window. Attached per wire step: the
   * records whose line position falls inside a folded unit's span ride THAT
   * unit's message (one usage.record per LLM request, matching the host
   * session's own shape); anything no fold carried comes back as
   * `usageUnattached` for the caller to carry.
   */
  usage?: TokenUsage
  /**
   * True when this pass's usage rode folded assistant messages — the caller
   * must never attach that accounting a second time.
   */
  usageAttached?: boolean
  /**
   * The window's accounting that NO fold carried (a pass with only held or
   * fully-sealed folds): the token-granularity live driver sums it into the
   * round's uncarried remainder, which the settle's final snapshot carries.
   */
  usageUnattached?: TokenUsage
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
  /**
   * Release the ACP tool notification's chronological reservation for this
   * wire line WITHOUT writing: the line's fold carries the whole native
   * lifecycle inside its step, so the reserved coordinate frees for a later
   * fold. (A reservation kimi never logs to the wire stays reserved and
   * finalizes as the driver's settle-time orphan fold.)
   */
  releaseTool?(line: KimiTranscriptLine & { kind: 'tool' }): void
  /**
   * Consume the round's in-flight content streams of the given kinds, pairing
   * them with one fold: `step` is the fold coordinate (the earliest consumed
   * reservation still needing one — absent when every consumed kind was
   * already sealed, so the fold goes sequential), and `sealed` lists the
   * kinds already durable (a gap fill wrote their triples — the fold must
   * EXCLUDE their content). Reservations whose content rides this fold are
   * released, so a later sequential fold may take their steps. Undefined when
   * no stream pairs — the fold goes sequential.
   */
  completeStreams(
    turn: number,
    kinds: readonly ('think' | 'text')[],
  ): { readonly step?: number; readonly sealed: readonly ('think' | 'text')[] } | undefined
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
 * Mirror one kimi session's transcript into a dsh subagent session: each
 * user prompt becomes a `user/message`, and each WIRE STEP (one LLM request:
 * its thinking, reply text and tool calls share the wire's own step number)
 * folds into one dsh step whose `assistant/message` carries the reasoning,
 * text and tool-call blocks together — the host session's own shape, so the
 * standard surfaces (conversation, Context Lens) read one request per LLM
 * call. Then the events are appended to persistence so the child session is
 * viewable.
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
 * all. A fold paired with in-flight streams lands at the earliest consumed
 * reservation (see {@link KimiMirrorStreams}), after `finalizeBefore` has
 * closed every stream reservation below it; a sequential fold never takes a
 * step a stream reserved. Mid-round, a wire step the wire has not CLOSED yet
 * (no `step.end`) holds the pass — its parts may still arrive — and so does
 * an unresulted tool call (the reader resolves every advertised call before
 * the step closes; the result merges into the call's line in place, so the
 * next pass sees it). The settle pass folds the remainder with a synthesized
 * interrupted result. Lines the wire never step-tagged (older kimi) fold one
 * by one, immediately, as before.
 *
 * Usage accounting is exactly-once ACROSS passes: each `usage.record` is
 * tagged with the transcript position it occurred at, a pass owns the records
 * between the old offset and its own consumed end, and inside the window each
 * record rides the unit whose line span encloses it — one record per wire
 * step, landing on its own step's message. (A record raced PAST its content
 * encloses into the next unit instead: attribution off by one in a flush
 * race, totals still exact.)
 * @param ctx - host context carrying the session persistence service.
 * @param childSession - the dsh subagent session created for this delegation.
 * @param homeDir - the `kimi` harness's scoped home.
 * @param kimiSessionId - the kimi session to mirror; omitted mirrors the most
 *   recent session (a one-shot `kimi -p` run always creates a fresh one).
 * @param fromLines - transcript lines already mirrored into the child session
 *   (0 for the first round); only lines after this offset are appended.
 * @returns the new mirror offset and the newly mirrored lines' texts. A held
 *   unit (open wire step or unresulted tool) stops the offset before itself;
 *   the next pass retries from there.
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
  // Fold units: contiguous think/assistant/tool lines sharing one wire step
  // fold as ONE dsh step — one LLM request's full shape (reasoning, reply
  // text and the tool lifecycle in a single step), the host session's own
  // shape. Lines the wire did not step-tag (older kimi) fold one by one.
  type ContentLine = KimiTranscriptLine & { kind: 'assistant' | 'think' | 'tool' }
  const units: KimiTranscriptLine[][] = []
  for (const line of delta) {
    if (line === undefined) continue
    const last = units.at(-1)
    const head = last?.[0]
    if (
      last !== undefined && head !== undefined
      && line.kind !== 'user' && head.kind !== 'user'
      && line.wireStep !== undefined && line.wireStep === (head as ContentLine).wireStep
      && line.turn === head.turn
    ) {
      last.push(line)
      continue
    }
    units.push([line])
  }
  // Mid-round, a unit that may still grow HOLDS the pass: a wire-step group
  // whose step the wire has not closed yet, or a unit whose tool call lacks
  // its result (the released-log contract resolves every advertised call
  // before its step closes; the result merges into the call's line in place,
  // so the next pass sees it). The offset stops before the first such unit
  // and the fold retries once the wire completes it. The settle pass never
  // holds — a result that will never arrive folds as a synthesized
  // interrupted one.
  let holdAt = -1
  if (options?.settle !== true) {
    for (let index = 0; index < units.length; index += 1) {
      const unit = units[index] as KimiTranscriptLine[]
      const head = unit[0] as KimiTranscriptLine
      const openGroup = head.kind !== 'user'
        && (head as ContentLine).wireStep !== undefined
        && !transcript.closedSteps.has(`${head.turn}:${(head as ContentLine).wireStep}`)
      if (openGroup || unit.some(line => line.kind === 'tool' && line.result === undefined)) {
        holdAt = index
        break
      }
    }
  }
  const foldedUnits = holdAt < 0 ? units : units.slice(0, holdAt)
  const consumedTotal = fromLines + foldedUnits.reduce((n, unit) => n + unit.length, 0)
  // Usage is exactly-once across passes: a pass owns the records at positions
  // [fromLines, consumedTotal] (the boundary included — a record flushed right
  // after its content otherwise falls out of every span). kimi's norm is one
  // usage.record per wire step, right BEFORE the step's content, so a
  // step-tagged unit claims its own line span's records; records no tagged
  // unit claims (untagged spans on older wires, or the boundary) sum onto the
  // pass's last folded content unit — the pre-tagging shape.
  const unitUsage: (TokenUsage | undefined)[] = []
  const claimed: { from: number; to: number }[] = []
  let unitStart = fromLines
  for (const unit of foldedUnits) {
    const start = unitStart
    unitStart += unit.length
    const head = unit[0] as KimiTranscriptLine
    if (head.kind !== 'user' && (head as ContentLine).wireStep !== undefined) {
      claimed.push({ from: start, to: unitStart })
      unitUsage.push(sumUsageRecords(
        transcript.usageRecords.filter(record => record.line >= start && record.line < unitStart),
      ))
    } else {
      unitUsage.push(undefined)
    }
  }
  const unclaimedUsage = sumUsageRecords(
    transcript.usageRecords.filter(record =>
      record.line >= fromLines && record.line <= consumedTotal
      && !claimed.some(span => record.line >= span.from && record.line < span.to)),
  )
  const deltaUsage = sumUsageRecords(
    transcript.usageRecords.filter(record => record.line >= fromLines && record.line <= consumedTotal),
  )
  // The steps a fold may NOT take: every step already written (the session's
  // own event ledger), consulted per turn. A round mirrored across several
  // live polls keeps its earlier writes, so later polls never reuse them.
  const takenSteps = new Map<number, Set<number>>()
  for (const event of childSession.snapshotEvents()) {
    const data = event.data as { turn?: number; step?: number }
    if (typeof data.turn === 'number' && typeof data.step === 'number') {
      const taken = takenSteps.get(data.turn) ?? new Set<number>()
      taken.add(data.step)
      takenSteps.set(data.turn, taken)
    }
  }
  /**
   * The fold's coordinate: the smallest step of the turn that nothing holds
   * — neither written nor currently reserved. Filling the smallest free step
   * keeps the stored log dense even when a stream reservation below was
   * released mid-round (its content rode an earlier fold's step).
   */
  const nextFoldStep = (turn: number): number => {
    const taken = new Set(takenSteps.get(turn))
    for (const reserved of options?.streams?.reservedSteps(turn) ?? []) taken.add(reserved)
    let step = 1
    while (taken.has(step)) step += 1
    return step
  }
  /** Record a fold's coordinate chosen by a stream pairing. */
  const markTaken = (turn: number, step: number): void => {
    const written = takenSteps.get(turn) ?? new Set<number>()
    written.add(step)
    takenSteps.set(turn, written)
  }
  /** The window's accounting that no fold carried (dropped units' sums). */
  let carryUsage: TokenUsage | undefined
  // The pass's last content unit carries the records no tagged unit claimed.
  let lastContentUnit = -1
  for (let index = foldedUnits.length - 1; index >= 0; index -= 1) {
    if ((foldedUnits[index] as KimiTranscriptLine[])[0]?.kind !== 'user') {
      lastContentUnit = index
      break
    }
  }
  const texts: string[] = []
  for (let unitIndex = 0; unitIndex < foldedUnits.length; unitIndex += 1) {
    const unit = foldedUnits[unitIndex] as KimiTranscriptLine[]
    const head = unit[0] as KimiTranscriptLine
    // The unit's own records plus whatever a dropped unit handed forward.
    let usage = addTokenUsage(carryUsage, unitUsage[unitIndex])
    carryUsage = undefined
    if (unitIndex === lastContentUnit) usage = addTokenUsage(usage, unclaimedUsage)
    // The wire's turn number (1-based, matching the provider's turn/start
    // numbering) is the dsh round; no offset is needed because both count the
    // same rounds.
    const turn = head.turn
    if (head.kind === 'user') {
      // The live driver appends the round's user/message at turn start (so the
      // question renders before the streamed think/text instead of after it).
      // Skip the wire's copy of the same prompt — scoped to THIS turn so two
      // rounds with identical prompts still fold independently.
      if (userAlreadyAppended(childSession, turn, head.text)) continue
      childSession.append('user/message', userEvent(head.text), { surfaceOp: 'append' })
      texts.push(head.text)
      carryUsage = usage
      continue
    }
    const toolLines = unit.filter((line): line is KimiTranscriptLine & { kind: 'tool' } => line.kind === 'tool')
    const reasoning = unit.filter(line => line.kind === 'think').map(line => line.text).join('')
    const text = unit.filter(line => line.kind === 'assistant').map(line => line.text).join('')
    const kinds: ('think' | 'text')[] = [
      ...reasoning.trim() === '' ? [] : ['think' as const],
      ...text.trim() === '' ? [] : ['text' as const],
    ]
    // Pair the fold with the round's in-flight streams, consuming the kinds
    // present: the fold lands at the earliest consumed reservation, and a
    // kind already gap-sealed keeps its durable triple — its content stays
    // out of this message.
    const pairing = kinds.length === 0 ? undefined : options?.streams?.completeStreams(turn, kinds)
    const sealed = new Set(pairing?.sealed ?? [])
    const blocks: ContentBlock[] = []
    if (reasoning.trim() !== '' && !sealed.has('think')) blocks.push({ type: 'reasoning', text: reasoning })
    if (text.trim() !== '' && !sealed.has('text')) blocks.push({ type: 'text', text })
    for (const line of toolLines) {
      blocks.push({ type: 'tool-call', id: line.id as ToolCallBlockId, name: line.name, arguments: line.args ?? '' })
    }
    for (const line of unit) texts.push(kimiLineProgressText(line))
    if (blocks.length === 0) {
      // Every content kind already durable via a gap fill and no tool
      // lifecycle to fold: the unit drops; its usage rides the next fold.
      carryUsage = usage
      continue
    }
    // A tool reservation only pins chronological order — the fold's step
    // carries the whole lifecycle, so the reserved coordinate frees.
    for (const line of toolLines) options?.streams?.releaseTool?.(line)
    let step = pairing?.step ?? nextFoldStep(turn)
    // Close every stream reservation below the fold step first: stored steps
    // must land dense and strictly sequential.
    options?.streams?.finalizeBefore?.(turn, step)
    // Finalization may have WRITTEN a reservation below the provisional
    // coordinate — or RELEASED an empty one without a write. Either way the
    // fold must take the smallest step still free afterwards: writing above
    // a released-but-never-written reservation strands a permanent gap the
    // released-log reader rejects as corruption.
    let sequential = nextKimiSessionStep(childSession, turn)
    const reservedAfter = options?.streams?.reservedSteps(turn) ?? []
    while (reservedAfter.includes(sequential)) sequential += 1
    step = Math.min(step, sequential)
    markTaken(turn, step)
    // The durable coordinate is decided now, in write order (see nextWrittenKimiStep).
    step = nextWrittenKimiStep(childSession, turn)
    // The wire's own request config rides a request/header ahead of the fold
    // (the host session's own shape) — Context Lens reads the child log's
    // config from it instead of showing 未记录. Only a change is logged.
    const requestConfig = unit.map(line => line.kind !== 'user' ? line.requestConfig : undefined).find(config => config !== undefined)
    if (requestConfig?.model !== undefined) {
      appendRequestHeaderIfChanged(childSession, {
        provider: 'kimi-cli',
        model: requestConfig.model,
        ...requestConfig.reasoningEffort === undefined ? {} : { reasoningEffort: requestConfig.reasoningEffort },
        ...requestConfig.maxTokens === undefined ? {} : { maxTokens: requestConfig.maxTokens },
      })
    }
    const model = [...unit].reverse().find(line => line.model !== undefined)?.model
    childSession.append('step/start', { turn, step })
    childSession.append('assistant/message', {
      turn,
      step,
      message: assistantEvent(blocks, model),
      stream: [],
      ...usage === undefined ? {} : { usage },
    }, { surfaceOp: 'append' })
    // The native tool lifecycle inside the same step: the message advertises
    // every call, then each call resolves before the step closes.
    for (const line of toolLines) {
      const call = childSession.append('tool/call', {
        turn,
        step,
        callId: line.id as ToolCallEventCallId,
        name: line.name,
        arguments: line.args ?? '',
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
    }
    childSession.append('step/end', { turn, step })
  }
  await persistChildSession(ctx, childSession)
  // The window's accounting that folded nowhere: dropped units' carry plus the
  // unclaimed sum when no content unit folded at all.
  const remainder = addTokenUsage(carryUsage, lastContentUnit === -1 ? unclaimedUsage : undefined)
  return {
    total: consumedTotal,
    texts,
    ...deltaUsage !== undefined ? { usage: deltaUsage } : {},
    ...deltaUsage !== undefined && remainder === undefined ? { usageAttached: true } : {},
    ...remainder !== undefined ? { usageUnattached: remainder } : {},
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
 * Write the fold's request/header when the wire's declared config differs from
 * the child log's last one (the host logs changed snapshots, not per-call
 * duplicates): first write is `initial`, a differing one `change`, an
 * identical one skipped.
 */
function appendRequestHeaderIfChanged(
  childSession: Session,
  config: { provider: string; model: string; reasoningEffort?: ReasoningEffortId; maxTokens?: number },
): void {
  const serialized = JSON.stringify(config)
  let last: string | undefined
  for (const event of childSession.snapshotEvents()) {
    if (event.type === 'request/header') {
      last = JSON.stringify((event.data as { header?: { config?: unknown } }).header?.config)
    }
  }
  if (last === serialized) return
  childSession.append('request/header', {
    header: { config },
    reason: last === undefined ? 'initial' : 'change',
  })
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
