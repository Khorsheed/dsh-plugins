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
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEventMap } from '@deepseek-ai/dsh-session'
import { localAgentStreamRecords, type LocalAgentModelBlock, type LocalAgentToolCalls } from '@khorsheed/dsh-local-agent/types'
import { appendMirrorStep, appendRequestHeaderIfChanged, ownSelfRounds, persistChildSession, type MirrorBlock, type MirrorSource } from '@khorsheed/dsh-local-agent'
import { addTokenUsage, readKimiTranscript, sumUsageRecords, type KimiRetriedAttempt, type KimiStepTiming, type KimiTranscriptLine } from './session-view.ts'

// The tool-call id brand is compile-time only; take the field type from the
// consuming API instead of importing a brand factory.
type ToolCallEventCallId = SessionEventMap['tool/call']['callId']

/** One user-role message event. */
function userEvent(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/** The mirror source for a message the kimi route writes: the observed model, or `unobserved`. */
export function kimiMirrorSource(model?: string): MirrorSource {
  return { provider: 'kimi-cli', model: model ?? 'unobserved' }
}

/**
 * The smallest step of a turn no event holds (callers skip their own
 * reservations on top): the live driver's provisional preview key for a
 * stream or tool notification — never a durable coordinate (see
 * {@link nextWrittenKimiStep}).
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

/** Wire usage records already counted, per child session (see mirrorKimiSessionDelta). */
const countedUsage = new WeakMap<Session, Set<number>>()
const usageSeen = (childSession: Session): Set<number> => {
  let seen = countedUsage.get(childSession)
  if (seen === undefined) countedUsage.set(childSession, seen = new Set())
  return seen
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
 * every step as one atomic step/start→…→step/end triple, numbered in write
 * order ({@link nextWrittenKimiStep}). Live streams are browser previews
 * only: a call's streamed reasoning and text land durably through its wire
 * step's fold, never as a step of their own (the settle writes from live text
 * only what the wire never logged).
 */
export interface KimiMirrorStreams {
  /**
   * A durable write is about to take `step`: every live stream previewed at
   * or below it moves above it, so the browser never shows a later call's
   * stream at a coordinate the log just gave an earlier call.
   */
  vacate?(turn: number, step: number): void
  /**
   * Release the ACP tool notification's chronological reservation for this
   * wire line WITHOUT writing: the line's fold carries the whole native
   * lifecycle inside its step, so the reserved coordinate frees for a later
   * fold. (A reservation kimi never logs to the wire stays reserved and
   * finalizes as the driver's settle-time orphan fold.)
   */
  releaseTool?(line: KimiTranscriptLine & { kind: 'tool' }): void
  /**
   * Consume the round's in-flight content streams of the given kinds: the
   * fold carries their content (from the wire), so their previews end and
   * their reservations free.
   */
  completeStreams(turn: number, kinds: readonly ('think' | 'text')[]): void
  /**
   * Drop what an abandoned model-call attempt previewed (its thought/text
   * streams and the tool calls it began streaming): kimi retried it, so the
   * wire will never log it and nothing of it is written — neither consumed by
   * the retry's fold (which would shift every later stream by one) nor
   * finalized at settle as an interrupted call. Called every pass, before
   * any unit folds, with every retried attempt the wire holds.
   */
  discardAttempt?(attempt: KimiRetriedAttempt): void
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
  /**
   * The live round's own turn: a unit of a LATER turn holds the pass, settle
   * included — that turn is not open in the child log yet (kimi opened a turn
   * of its own after this round's; the next round, or a self-opened round's
   * own execution, opens it). Absent, every unit folds as before.
   */
  throughTurn?: number
}

/** Build one wire step's coarse model stream from the wire's own timing facts. */
export function kimiStreamFromUnit(
  unit: readonly KimiTranscriptLine[],
  stepTimings: ReadonlyMap<string, KimiStepTiming>,
) {
  const head = unit[0]
  if (head === undefined || head.kind === 'user' || head.wireStep === undefined) return []
  const firstChunkAt = stepTimings.get(`${head.turn}:${head.wireStep}`)?.firstChunkAt
  if (firstChunkAt === undefined) return []
  const blocks: LocalAgentModelBlock[] = []
  let cursor = firstChunkAt
  for (const [index, line] of unit.entries()) {
    if (line.at === undefined || line.at < cursor) return []
    const base = { index, startedAt: cursor, endedAt: line.at }
    if (line.kind === 'think') blocks.push({ ...base, kind: 'reasoning', text: line.text })
    else if (line.kind === 'assistant') blocks.push({ ...base, kind: 'text', text: line.text })
    else if (line.kind === 'tool') blocks.push({ ...base, kind: 'tool-call', call: { id: line.id as ToolCallEventCallId, name: line.name, arguments: line.args ?? '' } })
    cursor = line.at
  }
  return localAgentStreamRecords(blocks)
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
 * all. Each fold takes the next step in write order; live streams the fold
 * pairs with only end their previews (see {@link KimiMirrorStreams}) — a
 * call's streamed reasoning never becomes a step of its own. Mid-round, a wire step the wire has not CLOSED yet
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
  // The self-opened rounds this child log holds as rounds of their own: the
  // transcript numbers them exactly as the log does (member-self-started-rounds
  // A③), and every other one keeps the 11-01 fold.
  const ownRounds = ownSelfRounds(childSession.snapshotEvents())
  let transcript: Awaited<ReturnType<typeof readKimiTranscript>> | undefined
  if (kimiSessionId !== undefined) {
    // Records may be bare uuids (the convention) or carry the ACP directory
    // prefix (legacy live records): normalize instead of double-prefixing.
    const dirName = kimiSessionId.startsWith('session_') ? kimiSessionId : `session_${kimiSessionId}`
    for (const workspace of workspaces) {
      const dir = join(homeDir, 'sessions', workspace, dirName)
      try {
        transcript = await readKimiTranscript(dir, { ownRounds })
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
        transcript = await readKimiTranscript(newest.dir, { ownRounds })
      } catch {
        transcript = undefined
      }
    }
  }
  if (transcript === undefined || transcript.lines.length === 0) return { total: 0, texts: [] }
  // Before anything folds: an attempt kimi retried previewed content the wire
  // never logs — the retry's fold must not consume its streams, and the
  // settle must not write them.
  for (const attempt of transcript.retriedAttempts ?? []) options?.streams?.discardAttempt?.(attempt)

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
  const throughTurn = options?.throughTurn
  if (throughTurn !== undefined) {
    holdAt = units.findIndex(unit => (unit[0] as KimiTranscriptLine).turn > throughTurn)
  }
  if (options?.settle !== true) {
    for (let index = 0; index < (holdAt < 0 ? units.length : holdAt); index += 1) {
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
  // A record counts once per child session, ever: the boundary is inclusive, so
  // a pass whose offset cannot advance (a held unit) re-reads the same boundary
  // record on every poll — one 320k-token record was carried ten times onto a
  // cancelled round's step (3.2M). Wire line numbers only grow, so the line
  // identifies the record across passes and rounds.
  // A live pass leaves a record AT its boundary to the wire step it belongs
  // to when that step has not folded yet: kimi writes a step's usage.record
  // after its step.begin and before its content, so a poll landing in between
  // sees the record with nothing of its step. Counted then, it was marked
  // seen as the round's unattached rest and the step's own fold found
  // nothing — a completed round's final reply lost its usage (bb05 turn 15).
  // Untagged records (older wires write them after the content) keep the
  // inclusive boundary; the settle pass, which folds everything, takes all.
  const heldHead = holdAt < 0 ? undefined : (units[holdAt] as KimiTranscriptLine[])[0]
  const heldStep = heldHead !== undefined && heldHead.kind !== 'user' && (heldHead as ContentLine).wireStep !== undefined
    ? `${heldHead.turn}:${(heldHead as ContentLine).wireStep}`
    : undefined
  // A record of a later turn the pass holds (throughTurn) waits for that turn's own fold, settle or not.
  const laterTurn = (step: string): boolean => throughTurn !== undefined && Number(step.split(':')[0]) > throughTurn
  const deferred = (record: { line: number; step?: string }): boolean =>
    record.line === consumedTotal && record.step !== undefined
    && (laterTurn(record.step)
      || (options?.settle !== true && (!transcript.closedSteps.has(record.step) || record.step === heldStep)))
  const inWindow = (record: { line: number; step?: string }): boolean =>
    record.line >= fromLines && record.line <= consumedTotal && !deferred(record)
  const seen = usageSeen(childSession)
  const usageRecords = transcript.usageRecords.filter(record => !seen.has(record.line))
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
        usageRecords.filter(record => record.line >= start && record.line < unitStart),
      ))
    } else {
      unitUsage.push(undefined)
    }
  }
  const unclaimedUsage = sumUsageRecords(
    usageRecords.filter(record =>
      inWindow(record)
      && !claimed.some(span => record.line >= span.from && record.line < span.to)),
  )
  const windowRecords = usageRecords.filter(inWindow)
  const deltaUsage = sumUsageRecords(windowRecords)
  for (const record of windowRecords) seen.add(record.line)
  // Turns the log has already closed take no more writes: the released-log
  // reader admits events only inside the open turn. A backlog the offset never
  // covered (a fold that failed for rounds, then an offset lost on restart)
  // would otherwise land old content inside a finished turn — or, after the
  // next turn opened, corrupt the whole log. Those units are skipped; the
  // offset still moves past them.
  const closedTurns = new Set<number>()
  for (const event of childSession.snapshotEvents()) {
    if (event.type !== 'turn/end') continue
    const closed = (event.data as { turn?: number }).turn
    if (typeof closed === 'number') closedTurns.add(closed)
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
    if (closedTurns.has(turn)) continue
    if (head.kind === 'user') {
      // A kimi-opened round's prompt (a task notification) is not the
      // human's message: nothing to write, its usage rides the next fold.
      if (head.injected === true) {
        carryUsage = usage
        continue
      }
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
    // The wire step is the model call: its reasoning, text and tool calls
    // ride ONE message. The live streams that previewed this call's content
    // end here — the wire carries the same content, with its timing.
    if (kinds.length > 0) options?.streams?.completeStreams(turn, kinds)
    const blocks: MirrorBlock[] = []
    if (reasoning.trim() !== '') blocks.push({ kind: 'think', text: reasoning })
    if (text.trim() !== '') blocks.push({ kind: 'text', text })
    for (const line of toolLines) {
      blocks.push({
        kind: 'tool',
        id: line.id,
        name: line.name,
        ...line.args === undefined ? {} : { args: line.args },
        ...line.result === undefined ? {} : { result: line.result },
        ...line.timing === undefined ? {} : { timing: line.timing },
      })
    }
    for (const line of unit) texts.push(kimiLineProgressText(line))
    if (blocks.length === 0) {
      // Nothing to write (whitespace-only content): its usage rides the next fold.
      carryUsage = usage
      continue
    }
    // A tool reservation only pins chronological order — the fold's step
    // carries the whole lifecycle, so the reserved coordinate frees.
    for (const line of toolLines) options?.streams?.releaseTool?.(line)
    // The durable coordinate is decided now, in write order (see
    // nextWrittenKimiStep); a later call previewed at it moves above it.
    const step = nextWrittenKimiStep(childSession, turn)
    options?.streams?.vacate?.(turn, step)
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
    // One atomic step: the message advertises every call (the wire step's own
    // stream timing rides it), then each call resolves before the step closes.
    appendMirrorStep(childSession, turn, step, {
      blocks,
      stream: kimiStreamFromUnit(unit, transcript.stepTimings),
      ...usage === undefined ? {} : { usage },
    }, kimiMirrorSource(model))
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
