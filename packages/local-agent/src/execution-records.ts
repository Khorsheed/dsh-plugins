/**
 * The member execution records (`local-agent/execution`, batch 5 S1): one
 * `start` record when the core admits an execution, one `end` record when it
 * settles, both in the member's child session and paired by `executionId`.
 *
 * Where the start lands:
 * - the child session already exists (a resume, a prepared member): at the
 *   admission point, before the provider starts anything;
 * - a first round, whose child session the provider creates inside its start:
 *   just before the round's first `turn/start`, through {@link openMirrorTurn}
 *   (mirror-step.ts) consulting the per-child hook registered here — or, for
 *   a provider path that opens its turn some other way, as soon as the
 *   provider's start returns, and at the latest just before the end record.
 *
 * The end carries the explicit turn range (every `turn/start` the child log
 * gained after the admission watermark, read when the run settles — rounds of
 * one member are serialized, so nothing else writes turns meanwhile), the
 * outcome, the harness's static `unrecorded` declaration for the way the
 * execution ran, and the CLI's own whole-round total when the provider
 * reported one (`providerReportedUsage`, user decision 2026-11-03 ②: an
 * independent fact, never a copy of the per-call usage).
 *
 * The turn hooks live in a `Symbol.for` registry on `globalThis`, so the
 * provider bundles' copy of mirror-step and the core's copy share them however
 * the package's entries are bundled.
 * @module @khorsheed/dsh-local-agent/execution-records
 */
import { randomUUID } from 'node:crypto'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import type {
  LocalAgentCompactionEvent,
  LocalAgentCompactionUnrecorded,
  LocalAgentExecutionEndEvent,
  LocalAgentExecutionIntent,
  LocalAgentExecutionOperation,
  LocalAgentExecutionOutcome,
  LocalAgentExecutionStartEvent,
  LocalAgentUnrecorded,
  LocalAgentUnrecordedDeclaration,
} from './types.ts'

/** How a prompt round reached its CLI: the one-shot process or the resident one. */
export type MirrorTransport = 'exec' | 'live'

type TurnHook = (session: Session, transport: MirrorTransport) => void

const TURN_HOOKS = Symbol.for('@khorsheed/dsh-local-agent/execution-turn-hooks')

function turnHooks(): Map<string, TurnHook> {
  const holder = globalThis as { [TURN_HOOKS]?: Map<string, TurnHook> }
  holder[TURN_HOOKS] ??= new Map()
  return holder[TURN_HOOKS]
}

/**
 * Run the open execution's hook for this child, if any, before a mirrored
 * round's `turn/start`: it writes a pending start record and notes the
 * transport. A child with no open execution (a test driving a provider
 * directly, a run outside the core) is untouched.
 */
export function beforeMirrorTurn(session: Session, transport: MirrorTransport): void {
  turnHooks().get(String(session.id))?.(session, transport)
}

/** What a provider's settle report observed about the round. */
export interface ExecutionObservation {
  readonly observedModel?: string
  readonly observedEffort?: string
  readonly cliVersion?: string
}

/** What the core knows at the admission point. */
export interface ExecutionAdmission {
  readonly childSessionId: string
  readonly parentSessionId: string
  readonly operation: LocalAgentExecutionOperation
  /** The member's delegation provider (`kimi-cli`, `codex-local`, …), for a compaction fact the core writes itself. */
  readonly provider?: string | undefined
  /** The caller's facts; absent for a provider start nothing staged them for (recorded as `api`, no cause). */
  readonly execution?: LocalAgentExecutionIntent | undefined
  /** The member harness's static declaration. */
  readonly unrecorded?: LocalAgentUnrecordedDeclaration | undefined
}

export interface ExecutionRecorderOptions {
  /** The live child session, when it is live. */
  session(childSessionId: string): Session | undefined
  /** Make the child's latest events durable (fire-and-forget). */
  persist(session: Session): void
  /** How long a settled prompt round's end waits for the provider's settle report. */
  settleWaitMs: number
  onError(error: unknown): void
}

function lastSeq(session: Session): number {
  const last = session.snapshotEvents().at(-1)
  return last === undefined ? -1 : Number(last.seq)
}

/** Everything a compaction the core records on the provider's behalf does not know. */
const UNREPORTED_COMPACTION: readonly LocalAgentCompactionUnrecorded[] = ['usage', 'before-after', 'summary']

/** The compaction outcome an execution outcome means (`uncertain` has none: nothing is known). */
const COMPACTION_OUTCOME: Partial<Record<LocalAgentExecutionOutcome, LocalAgentCompactionEvent['outcome']>> = {
  done: 'completed', failed: 'failed', cancelled: 'cancelled',
}

function hasStart(session: Session, executionId: string): boolean {
  return session.snapshotEvents().some(event => event.type === 'local-agent/execution'
    && (event.data as LocalAgentExecutionStartEvent).phase === 'start'
    && (event.data as LocalAgentExecutionStartEvent).executionId === executionId)
}

/** The outcome a settled run's stop reason means for its execution. */
export function executionOutcome(result: SubagentResult): LocalAgentExecutionOutcome {
  if (result.stopReason === 'completed') return 'done'
  if (result.stopReason === 'aborted') return 'cancelled'
  return 'failed'
}

/** One admitted execution, from admission to its end record. */
export class OpenExecution {
  readonly executionId: string
  readonly start: LocalAgentExecutionStartEvent
  /** The child log's last seq at admission: turns after it are this execution's. */
  private readonly watermark: number
  private transport: MirrorTransport | undefined
  private turns: number[] | undefined
  /** The provider's settle report arrived (with or without a total). */
  reported = false
  private reportedUsage: TokenUsage | undefined
  /** The settle report's observations (model, effort, CLI version), for the execution's settlement. */
  observed: ExecutionObservation | undefined
  private reportWaiters: Array<() => void> = []
  /** Set once the run settled; the end record carries it. */
  private outcome: LocalAgentExecutionOutcome | undefined
  /** Pending while the end waits for an owed settle report. */
  private timer: ReturnType<typeof setTimeout> | undefined
  private ended = false

  constructor(private readonly recorder: ExecutionRecorder, private readonly admission: ExecutionAdmission) {
    this.executionId = admission.execution?.executionId ?? randomUUID()
    this.start = {
      phase: 'start',
      executionId: this.executionId,
      caller: admission.execution?.caller ?? 'api',
      ...admission.execution?.callerRef === undefined ? {} : { callerRef: admission.execution.callerRef },
      operation: admission.operation,
      ...admission.execution?.cause === undefined ? {} : { cause: structuredClone(admission.execution.cause) },
      ...admission.execution?.task === undefined ? {} : { task: structuredClone(admission.execution.task) },
      parentSessionId: admission.parentSessionId,
      admittedAt: Date.now(),
    }
    const session = recorder.lookup(admission.childSessionId)
    this.watermark = session === undefined ? -1 : lastSeq(session)
    if (session !== undefined) this.writeStart(session)
    turnHooks().set(admission.childSessionId, (hooked, transport) => {
      this.transport ??= transport
      this.writeStart(hooked)
    })
  }

  get childSessionId(): string { return this.admission.childSessionId }

  /** Whether the child log gained a turn since admission. */
  openedTurn(): boolean {
    const session = this.recorder.lookup(this.childSessionId)
    return session !== undefined && this.turnsOf(session).length > 0
  }

  /** Write the start record once (idempotent by executionId). */
  private writeStart(session: Session): void {
    try {
      if (!hasStart(session, this.executionId)) session.append('local-agent/execution', this.start)
    } catch (error) { this.recorder.onError(error) }
  }

  private turnsOf(session: Session): number[] {
    return session.snapshotEvents()
      .filter(event => event.type === 'turn/start' && Number(event.seq) > this.watermark)
      .map(event => Number((event.data as { turn?: unknown }).turn))
      .filter(turn => Number.isFinite(turn))
  }

  /** The provider's start returned: a first round's child exists now, so a start that no turn hook wrote lands here. */
  started(): void {
    const session = this.recorder.lookup(this.childSessionId)
    if (session !== undefined) this.writeStart(session)
  }

  /** The provider's settle report for this execution. */
  noteReport(usage: TokenUsage | undefined, observed?: ExecutionObservation): void {
    this.reported = true
    if (usage !== undefined) this.reportedUsage = structuredClone(usage)
    if (observed !== undefined) this.observed = { ...observed }
    for (const wake of this.reportWaiters.splice(0)) wake()
    if (this.timer !== undefined) this.end()
  }

  /**
   * Resolve once the provider's settle report arrived, or after `ms` — at
   * once when none is owed (a compaction, a turnless round, a report that
   * already came). For the settlement's observations.
   */
  reportOrTimeout(ms: number): Promise<void> {
    if (this.reported || this.admission.operation !== 'prompt' || !this.openedTurn()) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      timer.unref?.()
      this.reportWaiters.push(() => { clearTimeout(timer); resolve() })
    })
  }

  /** The execution's turn range: fixed at settle, read live before it. */
  turnRange(): number[] {
    if (this.turns !== undefined) return [...this.turns]
    const session = this.recorder.lookup(this.childSessionId)
    return session === undefined ? [] : this.turnsOf(session)
  }

  /**
   * The run settled (or its start failed): fix the turn range now, then write
   * the end — once the provider's settle report arrived when a prompt round
   * opened a turn and the report is still owed (bounded by `settleWaitMs`).
   */
  settle(outcome: LocalAgentExecutionOutcome): void {
    if (this.outcome !== undefined) return
    this.outcome = outcome
    this.dropHook()
    const session = this.recorder.lookup(this.childSessionId)
    this.turns = session === undefined ? [] : this.turnsOf(session)
    if (this.admission.operation === 'prompt' && this.turns.length > 0 && !this.reported && this.recorder.settleWaitMs > 0) {
      this.timer = setTimeout(() => { this.end() }, this.recorder.settleWaitMs)
      this.timer.unref?.()
      this.recorder.parked.add(this)
      return
    }
    this.end()
  }

  /** Write a parked end now, without waiting for an owed report (plugin dispose). */
  flush(): void { if (this.timer !== undefined) this.end() }

  private end(): void {
    if (this.ended || this.outcome === undefined) return
    this.ended = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.recorder.parked.delete(this)
    this.writeEnd(this.outcome)
  }

  private dropHook(): void {
    // Only this execution's hook: the member's next round may already have
    // registered its own.
    if (this.recorder.hookOwner.get(this.childSessionId) !== this) return
    turnHooks().delete(this.childSessionId)
    this.recorder.hookOwner.delete(this.childSessionId)
  }

  private unrecorded(): LocalAgentUnrecorded[] {
    const declared = this.admission.unrecorded
    if (declared === undefined) return []
    if (this.admission.operation === 'compact') return [...declared.compact ?? []]
    if (this.transport !== undefined) return [...declared[this.transport] ?? []]
    // No turn opened: nothing was mirrored, so nothing is declared missing.
    if (this.turns === undefined || this.turns.length === 0) return []
    // A turn opened without the mirror's turn opener: the transport is
    // unknown, so both paths' declarations stand.
    return [...new Set([...declared.exec ?? [], ...declared.live ?? []])]
  }

  /**
   * A `/compact` execution always leaves one `local-agent/compaction` fact in
   * its range (batch 5 S2): when the provider wrote none after the admission
   * watermark (Claude Code and DSH report no compaction), the core writes one
   * marked {@link UNREPORTED_COMPACTION} — the command ran, nothing more is
   * known. A provider's own event (Kimi, Codex) is left alone, so one
   * execution never carries two. Written before the end record, inside the
   * execution's range; an `uncertain` end writes none.
   */
  private writeCompactionFact(session: Session, outcome: LocalAgentExecutionOutcome): void {
    if (this.admission.operation !== 'compact') return
    const compactionOutcome = COMPACTION_OUTCOME[outcome]
    if (compactionOutcome === undefined) return
    const events = session.snapshotEvents()
    if (events.some(event => event.type === 'local-agent/compaction' && Number(event.seq) > this.watermark)) return
    const fact: LocalAgentCompactionEvent = {
      source: 'manual',
      outcome: compactionOutcome,
      provider: this.admission.provider ?? 'unknown',
      startedAt: this.start.admittedAt,
      endedAt: Date.now(),
      boundarySeq: lastSeq(session),
      unrecorded: [...UNREPORTED_COMPACTION],
    }
    try {
      session.append('local-agent/compaction', fact)
    } catch (error) { this.recorder.onError(error) }
  }

  private writeEnd(outcome: LocalAgentExecutionOutcome): void {
    this.recorder.closed(this)
    const session = this.recorder.lookup(this.childSessionId)
    // A child that never came into existence (the provider failed before
    // creating it) holds no record: the design's "failed before admission
    // into the child" case.
    if (session === undefined) return
    this.writeStart(session)
    this.writeCompactionFact(session, outcome)
    const unrecorded = this.unrecorded()
    const end: LocalAgentExecutionEndEvent = {
      phase: 'end',
      executionId: this.executionId,
      outcome,
      turns: this.turns ?? [],
      endedAt: Date.now(),
      ...unrecorded.length === 0 ? {} : { unrecorded },
      ...this.reportedUsage === undefined ? {} : { providerReportedUsage: this.reportedUsage },
    }
    try {
      session.append('local-agent/execution', end)
    } catch (error) {
      this.recorder.onError(error)
      return
    }
    this.recorder.persist(session)
  }
}

/** The core's bookkeeping of open executions, per member. */
export class ExecutionRecorder {
  /** Open executions per child, oldest first (admitted, end not written). */
  private readonly open = new Map<string, OpenExecution[]>()
  /** Which execution owns a child's turn hook right now. */
  readonly hookOwner = new Map<string, OpenExecution>()
  /** Executions whose end waits for an owed settle report. */
  readonly parked = new Set<OpenExecution>()

  constructor(private readonly options: ExecutionRecorderOptions) {}

  get settleWaitMs(): number { return this.options.settleWaitMs }
  lookup(childSessionId: string): Session | undefined {
    try { return this.options.session(childSessionId) } catch { return undefined }
  }
  persist(session: Session): void { this.options.persist(session) }
  onError(error: unknown): void { this.options.onError(error) }

  /** The admission point: open an execution and write its start where the child exists. */
  admit(admission: ExecutionAdmission): OpenExecution {
    const execution = new OpenExecution(this, admission)
    this.hookOwner.set(admission.childSessionId, execution)
    const list = this.open.get(admission.childSessionId) ?? []
    list.push(execution)
    this.open.set(admission.childSessionId, list)
    return execution
  }

  /**
   * A provider's settle report for a member: it belongs to the oldest open
   * execution of that member that opened a turn and has no report yet
   * (rounds settle in admission order). A report no open execution claims is
   * ignored.
   */
  noteReport(childSessionId: string, usage: TokenUsage | undefined, observed?: ExecutionObservation): void {
    const owner = this.open.get(childSessionId)?.find(execution => !execution.reported && execution.openedTurn())
    owner?.noteReport(usage, observed)
  }

  closed(execution: OpenExecution): void {
    const list = this.open.get(execution.childSessionId)
    if (list === undefined) return
    const next = list.filter(entry => entry !== execution)
    if (next.length === 0) this.open.delete(execution.childSessionId)
    else this.open.set(execution.childSessionId, next)
  }

  /** Write every parked end now (plugin dispose): an owed report is not waited for. */
  flush(): void {
    for (const execution of [...this.parked]) execution.flush()
  }
}
