/**
 * `eval_experiment_get` (I5·T76 · D3): ONE experiment, read the way the lab
 * tab reads it, in one call.
 *
 * Before this the agent assembled an experiment from three answers — find it
 * in `eval_cells` with no run id, take the status word from
 * `eval_run_status`, then walk `eval_cells` again for the cells — and when it
 * came to cite an answer in its analysis it asked the person for a PATH,
 * because nothing it could read named a cell's files. This projection is the
 * same three reads composed (the list row, the run digest, the cell rows the
 * 运行记录 page reads), plus an ANSWER INDEX: every 题 × 组 × 次 with the names
 * of the files that attempt registered. Names, not paths: the index is what
 * the analysis cites, and a citation that only resolves on this machine is not
 * one (ui-spec §九 — no path reaches a person, and the agent's analysis is
 * read by one).
 *
 * Read-only, and nothing else rides along: no run, no finalize, no provision,
 * and no door to the human-evaluation exit (ui-spec R1). Every field here is
 * one the lab page already shows; the numbers therefore agree with it by
 * construction, not by a second computation.
 * @module @khorsheed/dsh-eval
 */
import { basename, isAbsolute, relative } from 'node:path'
import { attemptDataDir } from './cell-detail.ts'
import type { MissionAttemptFace, MissionReadFace } from './faces.ts'
import type { RunCellsReport, RunStatusReport } from './read.ts'
import type { EvalClosure, EvalExperimentRow, EvalExperimentSnapshot, EvalExperimentStatus } from './types.ts'

/** One file an attempt registered, by the name a citation uses. */
export interface EvalAnswerFile {
  /**
   * The file's name inside its attempt directory (`stage1.md`,
   * `submission/stage2.md`). Never absolute: a ledger entry recorded with an
   * absolute path is reduced to its place under the attempt directory, else to
   * its base name.
   */
  name: string
  /** The ledger's kind for it (`checkpoint` for a checkpoint's own files). */
  kind: string
}

/** One entry of the answer index: a 题 × 组 × 次 and what it handed in. */
export interface EvalAnswerEntry {
  /** `<题> × <组> × #<次>` — the handle an analysis cites. */
  cell: string
  missionId: string
  task: string | null
  condition: string | null
  rep: number | null
  attempt: number
  /** The stage and the bucket, as the 运行记录 page shows them. */
  state: string
  bucket: string
  inStateMs: number | null
  checkpoints: string[]
  annotations: Record<string, number>
  /** The player's child session, when the attempt started one. */
  childSessionId: string | null
  files: EvalAnswerFile[]
}

/** The `eval_experiment_get` answer. */
export interface EvalExperimentGetView {
  /** The lab list's row for this experiment, minus its plan path. */
  experiment: {
    id: string
    experimentId: string | null
    name: string
    legacy: boolean
    status: EvalExperimentStatus
    stalledMinutes: number | null
    closure: EvalClosure | null
    archived: boolean
    snapshot: EvalExperimentSnapshot
    conditions: string[]
    judges: string[]
    items: number
    reps: number
    factors: string[]
    progress: { done: number; total: number } | null
    startedAt: number | null
    validation: { ok: boolean; errors: number; warnings: number } | null
    originSession: string | null
  }
  /** Every run of this experiment the ledger holds, newest first; the one below is the first. */
  runs: string[]
  /** The newest run's digest (`eval_run_status`, minus paths); null for an experiment nobody started. */
  run: {
    runId: string
    state: string
    evalVersion: string | null
    commit: string | null
    startedAt: number | null
    conditions: Array<{ id: string; sha: string | null; harness: string | null; model: string | null }>
    warnings: Array<{ code: string; message: string }>
    /** bucket → how many cells sit in it (the counts beside the page's filters). */
    buckets: Record<string, number>
    total: number
    unreleased: number
  } | null
  /** The answer index, in ledger order; empty for an experiment nobody started. */
  answers: EvalAnswerEntry[]
  /** The analysis files written into the experiment, by name, newest first. */
  analysis: string[]
  /** Honest degrades, one sentence each. */
  notes: string[]
}

/** Whether a string would reach a reader as a path on this machine. */
export function isLocalPath(value: string): boolean {
  return isAbsolute(value) || value === '~' || value.startsWith('~/')
}

/**
 * The citation name of one registered file. A relative ledger path is already
 * one; an absolute path is reduced to its place under the attempt directory
 * when it is there, else to its base name — the index never carries a path.
 */
export function answerFileName(path: string, attemptDir: string | undefined): string {
  if (!isLocalPath(path)) return path
  if (attemptDir !== undefined && isAbsolute(path)) {
    const rel = relative(attemptDir, path)
    if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) return rel
  }
  return basename(path)
}

/** The files one attempt registered, deduplicated, attempt artifacts first. */
function attemptFiles(attempt: MissionAttemptFace | undefined, attemptDir: string | undefined): EvalAnswerFile[] {
  if (attempt === undefined) return []
  const files: EvalAnswerFile[] = []
  const seen = new Set<string>()
  const add = (path: string, kind: string): void => {
    const name = answerFileName(path, attemptDir)
    if (name === '' || seen.has(name)) return
    seen.add(name)
    files.push({ name, kind })
  }
  for (const artifact of attempt.artifacts ?? []) add(artifact.path, artifact.kind)
  for (const checkpoint of attempt.checkpoints ?? []) {
    for (const path of checkpoint.artifacts ?? []) add(path, 'checkpoint')
  }
  return files
}

/** The handle an analysis cites a cell by. */
export function answerHandle(task: string | null, condition: string | null, rep: number | null): string {
  return `${task ?? '?'} × ${condition ?? '?'} × #${rep ?? '?'}`
}

/** Everything the composer reads, already fetched — the service does the fetching. */
export interface ExperimentGetInput {
  /** The lab list's rows for this experiment, newest run first (the list's own order). */
  rows: readonly EvalExperimentRow[]
  /** The newest run's status and cells; absent for an experiment nobody started. */
  status?: RunStatusReport
  cells?: RunCellsReport
  /** The ledger, for each cell's registered files; absent reports none. */
  mission?: MissionReadFace
  analysis: string[]
  notes: string[]
}

/**
 * Compose the answer from reads the lab page already makes.
 * @param input - the rows, the newest run's status and cells, the ledger.
 * @returns the projection; `rows` must hold at least one row.
 */
export function composeExperimentGet(input: ExperimentGetInput): EvalExperimentGetView {
  const newest = input.rows.find(row => row.runId !== null) ?? input.rows[0]
  if (newest === undefined) throw new Error('composeExperimentGet: no row')
  const runs = input.rows.flatMap(row => (row.runId === null ? [] : [row.runId]))
  const { status, cells } = input
  const dataDir = input.mission?.dataDir
  const answers: EvalAnswerEntry[] = (cells?.cells ?? []).map((cell) => {
    let attempts: readonly MissionAttemptFace[] = []
    try {
      attempts = input.mission?.get(cell.missionId, cells?.runId).mission.attempts ?? []
    } catch {
      // A cell the ledger cannot resolve lists no files rather than failing the index.
      attempts = []
    }
    const attempt = attempts.find(entry => entry.attempt === cell.attempt) ?? attempts[attempts.length - 1]
    const attemptDir = dataDir === undefined || cells === undefined
      ? undefined
      : attemptDataDir(dataDir, cells.runId, cell.missionId, attempt?.attempt ?? cell.attempt)
    return {
      cell: answerHandle(cell.task, cell.condition, cell.rep),
      missionId: cell.missionId,
      task: cell.task,
      condition: cell.condition,
      rep: cell.rep,
      attempt: cell.attempt,
      state: cell.state,
      bucket: cell.bucket,
      inStateMs: cell.inStateMs,
      checkpoints: [...cell.checkpoints],
      annotations: { ...cell.annotations },
      childSessionId: cell.childSessionId,
      files: attemptFiles(attempt, attemptDir),
    }
  })
  return {
    experiment: {
      id: newest.id,
      experimentId: newest.experimentId,
      name: newest.name,
      legacy: newest.legacy,
      status: newest.status,
      stalledMinutes: newest.stalledMinutes,
      closure: newest.closure,
      archived: newest.archived,
      snapshot: { ...newest.snapshot },
      conditions: [...newest.conditions],
      judges: [...newest.judges],
      items: newest.items,
      reps: newest.reps,
      factors: [...newest.factors],
      progress: newest.progress === null ? null : { ...newest.progress },
      startedAt: newest.startedAt,
      validation: newest.validation === null ? null : { ...newest.validation },
      originSession: newest.originSession,
    },
    runs,
    run: status === undefined || cells === undefined
      ? null
      : {
        runId: status.runId,
        state: status.state,
        evalVersion: status.meta.evalVersion,
        commit: status.meta.commit,
        startedAt: status.meta.startedAt,
        conditions: status.meta.conditions.map(entry => ({ ...entry })),
        warnings: status.meta.warnings.map(entry => ({ code: entry.code, message: entry.message })),
        buckets: { ...cells.buckets },
        total: cells.total,
        unreleased: status.unreleased.length,
      },
    answers,
    analysis: [...input.analysis],
    notes: [...input.notes],
  }
}
