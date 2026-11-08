/**
 * A Kimi member's own subagents, mirrored as grandchild sessions
 * (member-cli-subagents design, step M3).
 *
 * When a member's `kimi` calls its `Agent` tool (or `AgentSwarm`, which
 * starts several under one call), Kimi records the subagent beside the
 * member's own wire:
 *
 * - the member's `agents/main/wire.jsonl` gets `subagent.spawned`
 *   (`subagentId`, `parentToolCallId`, `subagentName`, `description`,
 *   `runInBackground`, `taskId`, `swarmIndex`), `subagent.started` and,
 *   once it is done, `subagent.completed` (`usage`: the subagent's running
 *   total, see {@link readKimiSubagents});
 * - `agents/<subagentId>/wire.jsonl` is the subagent's own wire, the same
 *   record types as the member's: one `turn.prompt` (origin
 *   `system_trigger`/`subagent`) per call, so a resumed subagent's wire holds
 *   one turn per call.
 *
 * {@link KimiSubagentMirror} reads the member wire's `subagent.*` lines and
 * folds each subagent's wire with the member's own fold
 * (`readKimiTranscript` with `agent`), writing each wire step as one step
 * of the grandchild session through the core's `openCliSubagent` writer:
 * one subagent = one grandchild session, one call (new or resumed) = one
 * execution = one turn.
 *
 * Closing rules (the design's front/background split):
 * - **Foreground**: `subagent.completed` ends the execution `done`, with
 *   this call's share of Kimi's reported total as `providerReportedUsage`.
 *   A member round that settles before it ends the execution `cancelled`
 *   (the member stopped waiting); a subagent wire whose turn ended
 *   `cancelled`/`error` ends it `cancelled`/`failed`.
 * - **Background** (`runInBackground: true`): the member's round ends first
 *   and the execution stays open (a poll keeps reading it between rounds).
 *   It ends `done` on `subagent.completed`, `uncertain` when the member's
 *   process goes away first. On the exec path the process exits with the
 *   round, so a background subagent still open at settle ends `cancelled`.
 *
 * Only calls spawned after the mirror attached are mirrored (old logs are
 * not backfilled; a mirror built after a restart does not re-read history).
 * Everything here degrades: a missing file, a format this reader does not
 * know, or a writer failure only means the subagent is not mirrored; the
 * member's round is never affected.
 * @module @khorsheed/dsh-local-agent-kimi/subagent-mirror
 */
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  addUsage,
  appendRequestHeaderIfChanged,
  openCliSubagent,
  type CliSubagentExecution,
  type CliSubagentHandle,
  type MirrorBlock,
  type MirrorTransport,
} from '@khorsheed/dsh-local-agent'
import type { LocalAgentExecutionOutcome } from '@khorsheed/dsh-local-agent/types'
import { kimiMirrorSource, kimiStreamFromUnit } from './session-mirror.ts'
import {
  findKimiSessionDir,
  readKimiSubagents,
  readKimiTranscript,
  wirePath,
  type KimiSessionTranscript,
  type KimiSubagentCall,
  type KimiTranscriptLine,
} from './session-view.ts'

/** The delegation provider the grandchild's descriptor names (the member's own). */
const PROVIDER = 'kimi-cli'

/** Subagent-wire turn endings that are not a completion, and the outcome each maps to. */
const ENDED_OUTCOME: Readonly<Record<string, LocalAgentExecutionOutcome>> = {
  cancelled: 'cancelled',
  canceled: 'cancelled',
  interrupted: 'cancelled',
  aborted: 'cancelled',
  error: 'failed',
  failed: 'failed',
}

/** One call being mirrored: its execution in the grandchild and the fold cursor. */
interface Running {
  call: KimiSubagentCall
  readonly handle: CliSubagentHandle
  readonly execution: CliSubagentExecution
  /** Lines of this call's turn already folded. */
  consumed: number
  /** Usage records (transcript line positions) already carried. */
  readonly counted: Set<number>
  ended: boolean
}

/** Options for {@link KimiSubagentMirror}. */
export interface KimiSubagentMirrorOptions {
  readonly ctx: Context
  /** The member's live dsh child session. */
  readonly member: Session
  /** The `kimi` scoped home the member's CLI runs against (`KIMI_CODE_HOME`). */
  readonly homeDir: string
  /** How the member's rounds run: picks the harness's `unrecorded` declaration. */
  readonly transport: MirrorTransport
  /** How often open subagents are re-read (ms); default 2000. */
  readonly pollMs?: number | undefined
}

type ContentLine = KimiTranscriptLine & { kind: 'assistant' | 'think' | 'tool' }

/** Group a turn's lines into fold units: the prompt alone, then one unit per wire step. */
function unitsOf(lines: readonly KimiTranscriptLine[]): KimiTranscriptLine[][] {
  const units: KimiTranscriptLine[][] = []
  for (const line of lines) {
    const last = units.at(-1)
    const head = last?.[0]
    if (last !== undefined && head !== undefined && line.kind !== 'user' && head.kind !== 'user'
      && line.wireStep !== undefined && line.wireStep === (head as ContentLine).wireStep) {
      last.push(line)
      continue
    }
    units.push([line])
  }
  return units
}

async function wireLineCount(path: string): Promise<number> {
  try {
    const text = await readFile(path, 'utf8')
    return text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
  } catch {
    return 0
  }
}

/**
 * One member's Kimi subagents, mirrored into grandchild sessions. One
 * instance lives as long as the member's CLI process can run subagents: per
 * live member (it outlives a round for background subagents), per exec round
 * otherwise.
 */
export class KimiSubagentMirror {
  private readonly runs = new Map<string, Running>()
  private cliSessionId: string | undefined
  private sessionDir: string | undefined
  /** Member-wire lines before this index are history: never mirrored. */
  private baseline = 0
  private queue: Promise<void> = Promise.resolve()
  private pollTimer: NodeJS.Timeout | undefined
  private disposed = false

  constructor(private readonly options: KimiSubagentMirrorOptions) {}

  /**
   * Attach the member's Kimi session. Calls spawned before this moment are
   * history and stay unmirrored: the baseline is the member wire's current
   * line count (0 for a session whose wire does not exist yet), or the given
   * line (a fresh exec run attaches once its session id is known, after it
   * may already have spawned: line 0). Re-attaching the same session is a
   * no-op.
   */
  attach(cliSessionId: string | undefined, options: { readonly baseline?: number } = {}): Promise<void> {
    return this.enqueue(async () => {
      if (cliSessionId === undefined || cliSessionId === this.cliSessionId) return
      this.cliSessionId = cliSessionId
      this.sessionDir = await findKimiSessionDir(this.options.homeDir, cliSessionId).catch(() => undefined)
      this.baseline = options.baseline ?? (this.sessionDir === undefined ? 0 : await wireLineCount(wirePath(this.sessionDir)))
    })
  }

  /** Whether any subagent's execution is still open. */
  get open(): boolean {
    return [...this.runs.values()].some(run => !run.ended)
  }

  /** The grandchild session a background task's subagent (Kimi `taskId`) is mirrored into, when it is. */
  sessionOfTask(taskId: string): string | undefined {
    return [...this.runs.values()].find(run => run.call.taskId === taskId)?.handle.sessionId
  }

  /** Discover new calls, mirror new subagent-wire steps, and close what is done. Serialized. */
  tail(): Promise<void> {
    return this.enqueue(async () => {
      await this.pass()
      this.armPoll()
    })
  }

  /**
   * The member's round settled. A foreground subagent still open ends
   * `cancelled` (the member stopped waiting), or `done` when its wire shows
   * the call's turn completed (the completion line only lags). A background
   * subagent stays open unless `processExited` (the exec path), where it
   * ends `cancelled`.
   */
  settleRound(options: { readonly processExited: boolean }): Promise<void> {
    return this.enqueue(async () => {
      await this.pass()
      await this.closeOpen(run => !run.call.background || options.processExited, (run, transcript) =>
        !run.call.background && transcript?.endedTurns?.get(run.call.ordinal) === 'completed' ? 'done' : 'cancelled')
      this.armPoll()
    })
  }

  /** The member's CLI process is gone: a subagent still open can no longer finish (`uncertain`). */
  lost(): Promise<void> {
    return this.enqueue(async () => {
      await this.pass()
      await this.closeOpen(() => true, () => 'uncertain')
      this.armPoll()
    })
  }

  /** Stop the poll (the owner is going away); open executions stay as written. */
  dispose(): void {
    this.disposed = true
    if (this.pollTimer !== undefined) clearInterval(this.pollTimer)
    this.pollTimer = undefined
  }

  /** Wait for every queued pass (tests, and owners that must not outrun the writer). */
  idle(): Promise<void> {
    return this.enqueue(async () => {})
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.catch(() => {}).then(async () => {
      try {
        await task()
      } catch (error) {
        this.options.ctx.logger?.warn?.(`subagent-kimi: subagent mirror failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
    return this.queue
  }

  private armPoll(): void {
    if (!this.open || this.disposed) {
      if (this.pollTimer !== undefined) clearInterval(this.pollTimer)
      this.pollTimer = undefined
      return
    }
    if (this.pollTimer !== undefined) return
    this.pollTimer = setInterval(() => { void this.tail() }, this.options.pollMs ?? 2_000)
    this.pollTimer.unref?.()
  }

  private async directory(): Promise<string | undefined> {
    if (this.sessionDir !== undefined || this.cliSessionId === undefined) return this.sessionDir
    this.sessionDir = await findKimiSessionDir(this.options.homeDir, this.cliSessionId).catch(() => undefined)
    return this.sessionDir
  }

  /** One discover + fold + close pass. */
  private async pass(): Promise<void> {
    if (this.disposed) return
    const dir = await this.directory()
    if (dir === undefined) return
    const calls = (await readKimiSubagents(dir)).filter(call => call.line >= this.baseline)
    const bySubagent = new Map<string, KimiSubagentCall[]>()
    for (const call of calls) bySubagent.set(call.subagentId, [...bySubagent.get(call.subagentId) ?? [], call])
    for (const [subagentId, own] of bySubagent) {
      let transcript: KimiSessionTranscript | undefined
      // In call order: a resumed call's execution opens only once the one
      // before it closed (the core ends a still-open one as uncertain).
      for (const call of own) {
        let run = this.runs.get(`${subagentId}#${call.ordinal}`)
        if (run?.ended === true) continue
        run ??= await this.admit(call)
        if (run === undefined) break
        run.call = call
        transcript ??= await readKimiTranscript(dir, { agent: subagentId })
        const later = own.some(entry => entry.ordinal > call.ordinal)
        if (call.completed !== undefined) {
          await this.finish(run, transcript, 'done')
        } else {
          const ended = transcript.endedTurns?.get(call.ordinal)
          const outcome = ended === undefined ? undefined : ENDED_OUTCOME[ended]
          if (outcome !== undefined) await this.finish(run, transcript, outcome)
          // Kimi resumes only an idle subagent: a later call means this one is over.
          else if (later) await this.finish(run, transcript, 'uncertain')
          else await this.write(run, transcript, false)
        }
        if (!run.ended) break
      }
    }
  }

  /** Open the grandchild and this call's execution. */
  private async admit(call: KimiSubagentCall): Promise<Running | undefined> {
    const handle = await openCliSubagent(this.options.ctx, this.options.member, {
      provider: PROVIDER,
      key: call.subagentId,
      ...call.name === undefined ? {} : { name: call.name },
      ...call.description === undefined ? {} : { description: call.description },
    })
    const execution = handle.beginExecution({
      callId: call.callId,
      ...call.group === undefined ? {} : { group: call.group },
      ...call.background ? { background: true } : {},
      ...call.resumed ? { resumed: true } : {},
      transport: this.options.transport,
      ...call.spawnedAt === undefined ? {} : { admittedAt: call.spawnedAt },
    })
    const run: Running = { call, handle, execution, consumed: 0, counted: new Set(), ended: execution.ended }
    this.runs.set(`${call.subagentId}#${call.ordinal}`, run)
    if (!run.ended) await handle.persist()
    return run
  }

  /** Close every open call the predicate picks, after a last fold. */
  private async closeOpen(
    pick: (run: Running) => boolean,
    outcomeOf: (run: Running, transcript: KimiSessionTranscript | undefined) => LocalAgentExecutionOutcome,
  ): Promise<void> {
    const dir = await this.directory()
    const transcripts = new Map<string, KimiSessionTranscript | undefined>()
    for (const run of this.runs.values()) {
      if (run.ended || !pick(run)) continue
      const subagentId = run.call.subagentId
      if (!transcripts.has(subagentId)) {
        transcripts.set(subagentId, dir === undefined ? undefined : await readKimiTranscript(dir, { agent: subagentId }).catch(() => undefined))
      }
      const transcript = transcripts.get(subagentId)
      await this.finish(run, transcript, outcomeOf(run, transcript))
    }
  }

  /** Fold what is left and write the end record. */
  private async finish(run: Running, transcript: KimiSessionTranscript | undefined, outcome: LocalAgentExecutionOutcome): Promise<void> {
    if (run.ended) return
    if (transcript !== undefined) await this.write(run, transcript, true, outcome !== 'done')
    run.ended = true
    const completed = run.call.completed
    run.execution.end(outcome, {
      ...outcome === 'done' && completed?.usage !== undefined ? { providerReportedUsage: completed.usage } : {},
      ...outcome === 'done' && completed?.at !== undefined ? { endedAt: completed.at } : {},
      ...outcome === 'failed' ? { errorMessage: 'the kimi subagent failed' } : {},
    })
    await run.handle.persist()
  }

  /**
   * Fold the call's turn into the grandchild. Mid-call (`final` false) a wire
   * step the wire has not closed, or one with a tool still waiting for its
   * result, holds the fold; `final` folds everything, `interrupted` marking
   * the cut-off last step.
   */
  private async write(run: Running, transcript: KimiSessionTranscript, final: boolean, interrupted = false): Promise<void> {
    if (run.ended || run.execution.ended) return
    const turn = run.call.ordinal
    const units = unitsOf(transcript.lines.filter(line => line.turn === turn))
    const session = run.handle.session
    let position = 0
    let carry: TokenUsage | undefined
    let wrote = false
    const pending = units.filter(unit => {
      const start = position
      position += unit.length
      return start >= run.consumed
    })
    for (const [index, unit] of pending.entries()) {
      const head = unit[0] as KimiTranscriptLine
      if (head.kind === 'user') {
        // The call's task: the turn opens with it, as a member round's does.
        run.execution.beginTurn()
        session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: head.text }],
          source: { kind: 'user' },
        }), { surfaceOp: 'append' })
        run.consumed += unit.length
        wrote = true
        continue
      }
      const step = (head as ContentLine).wireStep
      const key = step === undefined ? undefined : `${turn}:${step}`
      if (!final) {
        const open = key !== undefined && !transcript.closedSteps.has(key)
        if (open || unit.some(line => line.kind === 'tool' && line.result === undefined)) break
      }
      const records = key === undefined ? [] : transcript.usageRecords.filter(record => record.step === key && !run.counted.has(record.line))
      for (const record of records) run.counted.add(record.line)
      // Summed with the core's rule (a bucket any record reports stays, zero
      // included), so the per-call sum reads like Kimi's own total.
      let usage = carry
      for (const record of records) usage = addUsage(usage, record.usage)
      carry = undefined
      const blocks: MirrorBlock[] = []
      const reasoning = unit.filter(line => line.kind === 'think').map(line => line.text).join('')
      const text = unit.filter(line => line.kind === 'assistant').map(line => line.text).join('')
      if (reasoning.trim() !== '') blocks.push({ kind: 'think', text: reasoning })
      if (text.trim() !== '') blocks.push({ kind: 'text', text })
      for (const line of unit) {
        if (line.kind !== 'tool') continue
        blocks.push({
          kind: 'tool',
          id: line.id,
          name: line.name,
          ...line.args === undefined ? {} : { args: line.args },
          ...line.result === undefined ? {} : { result: line.result },
          ...line.timing === undefined ? {} : { timing: line.timing },
        })
      }
      run.consumed += unit.length
      if (blocks.length === 0) {
        carry = usage
        continue
      }
      const requestConfig = unit.map(line => line.kind !== 'user' ? line.requestConfig : undefined).find(config => config !== undefined)
      if (requestConfig?.model !== undefined) {
        // The turn opens before its first header, so the header lands inside it.
        run.execution.beginTurn()
        appendRequestHeaderIfChanged(session, {
          provider: PROVIDER,
          model: requestConfig.model,
          ...requestConfig.reasoningEffort === undefined ? {} : { reasoningEffort: requestConfig.reasoningEffort },
          ...requestConfig.maxTokens === undefined ? {} : { maxTokens: requestConfig.maxTokens },
        })
      }
      const model = [...unit].reverse().find(line => line.model !== undefined)?.model
      run.execution.mirror({
        blocks,
        stream: kimiStreamFromUnit(unit, transcript.stepTimings),
        ...usage === undefined ? {} : { usage },
        ...final && interrupted && index === pending.length - 1 ? { interrupted: true } : {},
      }, kimiMirrorSource(model))
      wrote = true
    }
    if (wrote) await run.handle.persist()
  }
}
