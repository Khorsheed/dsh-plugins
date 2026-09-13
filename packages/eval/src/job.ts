/**
 * The run as a background JOB.
 *
 * `/eval run` used to await the whole run inside the command turn, so the run
 * lived and died with the turn that started it: the initiating surface going
 * away took the run with it (I3·T22 step 5), and a CI runner — which has no
 * browser at all — could not start one. A run is not a reply; it is work that
 * outlives the sentence that asked for it.
 *
 * So the run is registered with the host's job registry (`ctx.jobs`) as an
 * `eval-run` job and the caller gets an id back immediately. Three properties
 * follow, and they are the reason this file exists rather than a bare
 * `void runPlan(...)`:
 *
 * - **It outlives its starter.** The job is registered WITHOUT an owner: an
 *   owned job is cancelled when its owning agent is disposed, which is exactly
 *   the coupling being removed. It ends when it finishes, when `job_kill`
 *   stops it, or when the service is destroyed.
 * - **Its output is readable while it runs.** Every log line the run emits is
 *   retained here and served two ways: the registry's own consuming reader
 *   (`job_output`) and this module's cursor reader ({@link EvalRunJobs.output}),
 *   which is non-consuming so a poller and the model-facing tool never eat
 *   each other's lines.
 * - **It has exactly one cancel path.** `job_kill` → the job's `cancel` → the
 *   run's `AbortSignal` → the same lever the per-cell budget timer pulls. No
 *   second stop verb exists anywhere in this package.
 *
 * @module @khorsheed/dsh-eval
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { defaultStateRoot } from './run.ts'
// Type-only, and the producer contract is the REAL one: the kind merge below
// registers `eval-run` in the registry's own kind map, and `JobStart` /
// `JobHooks` keep this producer honest at compile time.
import type { JobHooks, JobOutcome, JobSnapshot, JobStart } from '@deepseek-ai/dsh-jobs'
import type { RunOptions, RunReport } from './run.ts'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    /** One `/eval run` — the whole plan, from readiness to bundle export. */
    'eval-run': 'eval-run'
  }
}

/** What starting a run answers with, before any cell has run. */
export interface EvalRunHandle {
  /** The registry's job id (`eval-run-N`) — the handle for output and kill. */
  jobId: string
  /** The run id every cell, annotation and bundle carries. Minted up front. */
  runId: string
  /**
   * The session every delegation parents to. The caller's own when it still
   * has a live agent; otherwise a session this run opened for itself (see
   * {@link EvalRunJobs.start}).
   */
  parentSessionId: string
  /** Set when this run opened its own parent session rather than using the caller's. */
  ownParentSession?: boolean
}

/** One cursor read of a run job's output. */
export interface EvalRunOutput {
  runId: string
  /** Lines after the caller's cursor, in emission order. */
  lines: string[]
  /** The cursor to pass next time. */
  cursor: number
  /** The job's lifecycle state (`running` / `stopping` / terminal). */
  status: string
  /** The producer's terminal detail, once it settled. */
  detail?: string
  /** Whether the job has settled (no further lines will appear). */
  done: boolean
}

/** One run job's status, without its output. */
export interface EvalRunStatus {
  jobId: string
  runId: string
  status: string
  detail?: string
  startedAt: number
  finishedAt?: number
  /** Lines emitted so far — the cursor a fresh reader can start from. */
  lines: number
  /**
   * The plan this job was started from, as the caller spelled it. The link
   * back to the experiment: a run refused by the readiness gate never reaches
   * `runCreate`, so the mission ledger holds nothing for it and its plan is
   * the ONLY thing that identifies which experiment was refused. Absent when
   * the caller named no plan (the registry itself never invents one).
   */
  plan?: string
}

/**
 * The job-registry surface this module calls, structurally — the service
 * itself is resolved through the host accessor at call time, so a composition
 * without a job registry is a fallback, never a boot failure. The SPEC type
 * is the registry's own, so the producer contract is checked, not guessed.
 */
export interface JobsFace {
  start(spec: JobStart): string
  get(id: string): JobSnapshot
  kill(id: string, caller?: undefined, reason?: string): 'requested' | 'already-finished'
}

/** One live agent, as far as this module cares: its session, and nothing else. */
export interface ParentAgent {
  session: { id: string }
}

/** The agents-service surface this module needs, structurally (nothing is imported). */
export interface AgentsFace {
  get(sessionId: string): ParentAgent | undefined
  create?(options: {
    sessionId: string
    meta?: { cwd?: string }
  }): Promise<{ agent: ParentAgent; dispose(): Promise<void> }>
  /**
   * Run an operation with one agent as the process-local INITIATOR. A run
   * started from a slash command inherits this boundary from the turn; a run
   * started as a job has no turn, so it establishes the boundary itself —
   * see {@link EvalRunJobs.start}.
   */
  withInitiator?<T>(agent: ParentAgent, operation: () => T): T
}

/** Thrown when a run cannot be started as a job (the caller then decides). */
export class EvalJobsUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EvalJobsUnavailable'
  }
}

/** One registered run: its buffer, its cancel lever, and its identity. */
interface RunRecord {
  jobId: string
  runId: string
  parentSessionId: string
  /** Every line the run emitted, retained for the cursor reader. */
  lines: string[]
  /** How much the REGISTRY's consuming reader (`job_output`) has taken. */
  consumed: number
  controller: AbortController
  /** Set once the job settles, so a late reader still gets the verdict. */
  settled?: { status: string; detail?: string; finishedAt: number }
  /** Disposes the session this run opened for itself, when it opened one. */
  releaseParent?: () => Promise<void>
  /** The plan the run was started from, when the caller named one. */
  plan?: string
}

/** The run id shape mission would have minted, minted here so the caller gets it up front. */
export function evalRunId(now: number): string {
  const stamp = new Date(now).toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return `run-${stamp}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Start, observe and cancel `eval-run` jobs. One instance per service; the
 * records live as long as the service does, so a run's output stays readable
 * after it settles (a run that ended twenty minutes ago is exactly when
 * someone reads its tail).
 */
/**
 * The working directory a run's OWN parent session gets.
 *
 * A delegation needs a host working directory even when the round runs inside
 * a container: the provider resolves `intent.cwd ?? parent.session.cwd`, and
 * the container path passes no per-round cwd on purpose (inside a unit a host
 * path means nothing), so the parent's is the only one left. A session this
 * runner opened for itself had none, and every container condition refused
 * with «the parent session has no working directory to run the CLI in» — a
 * message about the orchestrator's own plumbing, delivered as though the
 * harness were at fault (T29c).
 *
 * The value is the run's cell root, the same directory the run is about to
 * fill: it exists for the run's lifetime, it is where the run's own bytes
 * live, and it puts a session started by CI in the same place a session
 * started by `/eval run --wait` would be working from.
 * @param options - the run options (`stateRoot`, else `$DSH_HOME/state/eval`).
 * @param runId - the run this session belongs to.
 * @returns the directory, or undefined when no state root can be resolved.
 */
export function runWorkDir(options: { stateRoot?: string }, runId: string): string | undefined {
  const stateRoot = options.stateRoot ?? defaultStateRoot()
  return stateRoot === undefined ? undefined : join(stateRoot, 'cells', runId)
}

export class EvalRunJobs {
  private readonly records = new Map<string, RunRecord>()

  /**
   * @param hosts - the host accessor the service already carries; `jobs` and
   *   `agents` are probed through it at call time, never required at mount.
   */
  constructor(private readonly hosts?: { get(name: string): unknown }) {}

  /** Whether this composition mounts a job registry at all. */
  available(): boolean {
    return this.jobs() !== undefined
  }

  /** The job registry, when this composition mounts one. */
  private jobs(): JobsFace | undefined {
    return this.hosts?.get('jobs') as JobsFace | undefined
  }

  /**
   * Register one run as a job and return its handle immediately.
   *
   * The parent session is resolved BEFORE the job starts, because a
   * delegation needs a LIVE AGENT and not merely a session record: the family
   * facade resolves `ctx.agents.get(parentSessionId)` and refuses the round
   * when nothing answers. So: the caller's session when it still has a live
   * agent (the `/eval run` case — the agent outlives the browser tab that
   * dispatched the command), and otherwise a session this run opens for
   * itself and disposes when it settles (the Remote/CI case, where there is
   * no calling session at all).
   * @param execute - runs the plan; called once, inside the job's starter.
   * @param options - the run options, minus the signal and runId this adds.
   * @returns the job id, the run id, and the parent session that was resolved.
   * @throws {@link EvalJobsUnavailable} when no job registry is mounted.
   */
  async start(
    execute: (options: RunOptions) => Promise<RunReport>,
    options: RunOptions & { cwd?: string; label?: string; plan?: string },
  ): Promise<EvalRunHandle> {
    const jobs = this.jobs()
    if (jobs === undefined) {
      throw new EvalJobsUnavailable(
        'no jobs service: this composition mounts no ctx.jobs, so a run cannot be registered as a background job',
      )
    }
    const runId = options.runId ?? evalRunId(Date.now())
    const agents = this.hosts?.get('agents') as AgentsFace | undefined
    // The caller's cwd wins and is taken as given — it is an existing
    // session's workspace, not ours to create. Only the directory this runner
    // CHOOSES is created here: a CLI spawned with a cwd that is not there
    // fails in the shell, before the harness that would have explained it.
    let cwd = options.cwd
    if (cwd === undefined) {
      const derived = runWorkDir(options, runId)
      if (derived !== undefined) {
        mkdirSync(derived, { recursive: true })
        cwd = derived
      }
    }
    const parent = await this.resolveParent(options.parentSessionId, cwd)
    const controller = new AbortController()
    const record: RunRecord = {
      jobId: '',
      runId,
      parentSessionId: parent.parentSessionId,
      lines: [],
      consumed: 0,
      controller,
      ...(parent.release === undefined ? {} : { releaseParent: parent.release }),
      ...(options.plan === undefined ? {} : { plan: options.plan }),
    }
    const runOptions: RunOptions = {
      ...options,
      runId,
      parentSessionId: parent.parentSessionId,
      signal: controller.signal,
      log: (message: string) => {
        record.lines.push(message)
        options.log?.(message)
      },
    }
    const jobId = jobs.start({
      kind: 'eval-run',
      label: options.label ?? `eval run ${runId}`,
      // No owner ON PURPOSE: an owned job dies with its owning agent, which is
      // the coupling this whole change removes.
      run: (): JobHooks => {
        // The run executes INSIDE the parent agent's initiator boundary. A
        // slash-started run inherited that boundary from the turn it ran in;
        // a job has no turn, and the host services behave differently
        // without an initiator — measured on the real instance, where a
        // stage-two resume came back a session-shaped object that was not a
        // Session and the round failed to start. Establishing the boundary
        // here is what `withInitiator` is for (a custom driver wrapping its
        // own foreground lifetime), and it makes the job path the same
        // execution context the turn path always had.
        const start = (): Promise<RunReport> => (
          parent.agent !== undefined && agents?.withInitiator !== undefined
            ? agents.withInitiator(parent.agent, () => execute(runOptions))
            : execute(runOptions)
        )
        const done = start().then(
          async (report): Promise<JobOutcome> => {
            for (const line of this.settleLines(report)) record.lines.push(line)
            await this.releaseParent(record)
            const cancelled = report.meta['cancelled'] === true
            record.settled = {
              status: cancelled ? 'killed' : 'completed',
              detail: this.settleDetail(report),
              finishedAt: Date.now(),
            }
            return {
              status: cancelled ? 'killed' : 'completed',
              detail: this.settleDetail(report),
            }
          },
          async (error: unknown): Promise<JobOutcome> => {
            const detail = error instanceof Error ? error.message : String(error)
            record.lines.push(`run ${runId} refused: ${detail}`)
            const diagnostics = (error as { diagnostics?: Array<{ code: string; message: string }> }).diagnostics
            for (const diagnostic of diagnostics ?? []) {
              record.lines.push(`  [${diagnostic.code}] ${diagnostic.message}`)
            }
            await this.releaseParent(record)
            record.settled = { status: 'failed', detail, finishedAt: Date.now() }
            return { status: 'failed', detail }
          },
        )
        return {
          cancel: (reason?: string) => {
            record.lines.push(`run ${runId}: cancel requested${reason === undefined ? '' : ` (${reason})`}`)
            controller.abort()
          },
          done,
          readOutput: () => {
            const delta = record.lines.slice(record.consumed)
            record.consumed = record.lines.length
            return delta.join('\n')
          },
        }
      },
    })
    record.jobId = String(jobId)
    this.records.set(record.jobId, record)
    return {
      jobId: record.jobId,
      runId,
      parentSessionId: parent.parentSessionId,
      ...(parent.release === undefined ? {} : { ownParentSession: true }),
    }
  }

  /**
   * One run job's status.
   * @param jobId - the id {@link start} returned.
   * @returns the status, or undefined when this service never started it.
   */
  status(jobId: string): EvalRunStatus | undefined {
    const record = this.records.get(jobId)
    if (record === undefined) return undefined
    const snapshot = this.snapshot(jobId)
    return {
      jobId,
      runId: record.runId,
      status: snapshot?.status ?? record.settled?.status ?? 'running',
      ...(snapshot?.detail ?? record.settled?.detail) === undefined
        ? {}
        : { detail: (snapshot?.detail ?? record.settled?.detail) as string },
      startedAt: snapshot?.startedAt ?? 0,
      ...snapshot?.finishedAt === undefined
        ? (record.settled === undefined ? {} : { finishedAt: record.settled.finishedAt })
        : { finishedAt: snapshot.finishedAt },
      lines: record.lines.length,
      ...(record.plan === undefined ? {} : { plan: record.plan }),
    }
  }

  /**
   * Read a run job's output from a cursor. NON-consuming: the registry's own
   * reader (`job_output`) has its own cursor, so a poller and the model-facing
   * tool never take lines from each other.
   * @param jobId - the id {@link start} returned.
   * @param cursor - the cursor from the previous read; 0 (or absent) reads from the top.
   * @returns the lines after the cursor, or undefined for an unknown job.
   */
  output(jobId: string, cursor = 0): EvalRunOutput | undefined {
    const record = this.records.get(jobId)
    if (record === undefined) return undefined
    const from = Number.isInteger(cursor) && cursor > 0 ? Math.min(cursor, record.lines.length) : 0
    const snapshot = this.snapshot(jobId)
    const status = snapshot?.status ?? record.settled?.status ?? 'running'
    return {
      runId: record.runId,
      lines: record.lines.slice(from),
      cursor: record.lines.length,
      status,
      ...(snapshot?.detail ?? record.settled?.detail) === undefined
        ? {}
        : { detail: (snapshot?.detail ?? record.settled?.detail) as string },
      done: status !== 'running' && status !== 'stopping',
    }
  }

  /**
   * Cancel a run job — the ONE cancellation entry, the same one `job_kill`
   * takes. Aborts the run's signal, which cancels every in-flight delegation
   * and leaves the cells the cancel caught mid-stage (`interrupted` to
   * `finalize`).
   * @param jobId - the id {@link start} returned.
   * @returns what the registry did, or `unknown-job`.
   */
  cancel(jobId: string): 'requested' | 'already-finished' | 'unknown-job' {
    const record = this.records.get(jobId)
    if (record === undefined) return 'unknown-job'
    const jobs = this.jobs()
    if (jobs === undefined) {
      // The registry went away under a live run (service teardown). Abort the
      // run directly rather than reporting a cancel that never happened.
      record.controller.abort()
      return 'requested'
    }
    return jobs.kill(record.jobId, undefined, 'eval run cancelled')
  }

  /** Every run this service started, newest last. */
  list(): EvalRunStatus[] {
    return [...this.records.keys()].map(jobId => this.status(jobId)).filter((value): value is EvalRunStatus => value !== undefined)
  }

  /** The registry's snapshot for one job, or undefined when it no longer knows it. */
  private snapshot(jobId: string): JobSnapshot | undefined {
    const jobs = this.jobs()
    if (jobs === undefined) return undefined
    try {
      return jobs.get(jobId)
    } catch {
      return undefined
    }
  }

  /** The closing lines every finished run writes into its own output. */
  private settleLines(report: RunReport): string[] {
    const lines: string[] = []
    if (report.dryRun) {
      // A dry run executes nothing, so it has no cells to report — what it
      // produced is the order it WOULD run, and a CI reader following the log
      // needs that in the log rather than in a return value nobody kept.
      const sequence = (report.meta['order'] as { sequence?: string[] } | undefined)?.sequence ?? []
      lines.push(`dry-run ${report.runId} — ${sequence.length} cell(s), execution order:`)
      for (const [index, missionId] of sequence.entries()) lines.push(`  ${String(index + 1).padStart(3)}. ${missionId}`)
      lines.push('(nothing executed — approve and run without --dry-run)')
      return lines
    }
    if (report.bundleDir !== undefined) lines.push(`bundle: ${report.bundleDir}`)
    if (report.exportError !== undefined) lines.push(`bundle export failed: ${report.exportError}`)
    const states = report.cells.map(cell => `${cell.missionId}=${cell.finalState}`)
    lines.push(`run ${report.runId} finished — ${report.cells.length} cell(s): ${states.join(', ')}`)
    return lines
  }

  /** The one-line terminal detail the registry renders in `job_list`. */
  private settleDetail(report: RunReport): string {
    const archived = report.cells.filter(cell => cell.finalState === 'archived' || cell.finalState === 'released').length
    return `${archived}/${report.cells.length} cell(s) archived · ${report.runId}`
  }

  /** Dispose the session this run opened for itself, once. */
  private async releaseParent(record: RunRecord): Promise<void> {
    const release = record.releaseParent
    if (release === undefined) return
    delete record.releaseParent
    try {
      await release()
    } catch (error) {
      const logger = this.hosts?.get('logger') as { warn?(message: string): void } | undefined
      logger?.warn?.(`eval: releasing the run's own parent session failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Resolve the session every delegation of this run parents to. A live AGENT
   * is the requirement, not a session record — the family facade refuses a
   * round whose parent session has none.
   */
  private async resolveParent(
    parentSessionId: string | undefined,
    cwd: string | undefined,
  ): Promise<{ parentSessionId: string; agent?: ParentAgent; release?: () => Promise<void> }> {
    const agents = this.hosts?.get('agents') as AgentsFace | undefined
    if (parentSessionId !== undefined && parentSessionId !== '') {
      if (agents === undefined) return { parentSessionId }
      const agent = agents.get(parentSessionId)
      if (agent !== undefined) return { parentSessionId, agent }
    }
    if (agents?.create === undefined) {
      throw new EvalJobsUnavailable(
        'no live parent agent: the calling session has none and this composition cannot create one'
        + ' (mount an agent-loop plugin, or start the run from a live session)',
      )
    }
    const handle = await agents.create({ sessionId: randomUUID(), ...(cwd === undefined ? {} : { meta: { cwd } }) })
    return {
      parentSessionId: String(handle.agent.session.id),
      agent: handle.agent,
      release: () => handle.dispose(),
    }
  }
}
