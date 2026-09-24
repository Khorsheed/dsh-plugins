/**
 * The REPORT page's projection (ui-spec §五): the five validity checks, the paired
 * difference table, the efficiency table and the judge numbers, for one run.
 *
 * Nothing is computed here that `analyzeBundle` does not already decide. The
 * report's whole point is that its honesty rules live in ONE place — the four
 * invariants gate the comparison, verdict coverage degrades a pair, the CI needs
 * 3 tasks with a delta, factors are derived from condition diffs and never
 * declared, efficiency stays parallel, ranking needs n ≥ 3 — and a page
 * that recomputed any of it would be a second opinion the reader could not
 * tell from the first. So this module reads a bundle through that one function
 * and reshapes its answer for the wire; `comparisonAllowed` arrives decided,
 * and `pairs` is simply EMPTY when it is false. The page cannot open a section
 * the bundle closed.
 *
 * The other half of the job is FINDING the bundle. A report is a projection of
 * an export, not of the ledger: until a bundle exists there is nothing to
 * report, and saying "no report" when the truth is "not exported yet" would
 * send a reader looking for a broken run. So the search is explicit — the
 * directory the reader just exported into, then the plan's own `exports`, then
 * `<dataset repo>/exports` (decision 11) — and every directory looked in comes
 * back with the refusal, because "I looked here and here" is the sentence that
 * tells a person which of the two situations they are in.
 *
 * Reading only, and deliberately: `dsh-eval report --out` still writes
 * `results.jsonl` / `summary.md` / `usage.jsonl`, and this verb writes nothing
 * at all. A page render must not leave files behind, and the archived artifact
 * of a run is a human's decision about where it goes.
 * @module @khorsheed/dsh-eval
 */
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { MissionReadFace } from './faces.ts'
import { readRunMarks } from './closure.ts'
import { readExportState, type EvalExportNote } from './export-note.ts'
import { EvalReadRefused } from './read.ts'
import { listAnalysisFiles } from './experiment-artifact.ts'
import {
  analyzeBundle,
  type CriterionGroupResult, type CriterionSample, type EvalReport, type JudgeAssignment,
} from './report.ts'
import type {
  EvalFinalizeView, EvalReportCriterionCell, EvalReportCriterionSample, EvalReportEfficiencyRow,
  EvalReportJudgeTag, EvalReportPair, EvalReportPairRow, EvalReportTaskCriteria, EvalRunReportView,
} from './types.ts'
import { expandHome } from './validate.ts'
import type { FinalizeReport } from './finalize.ts'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** mission's own bundle naming: one directory per run under the export dir. */
export function bundleDirOf(outDir: string, runId: string): string {
  return join(outDir, `${runId}-bundle`)
}

/** True when the directory holds a mission export bundle (a readable run.json). */
async function isBundle(dir: string): Promise<boolean> {
  try {
    const info = await stat(join(dir, 'run.json'))
    return info.isFile()
  } catch {
    return false
  }
}

/**
 * When the bundle says it was written — `manifest.json`'s own `exportedAt`,
 * which is the field the walkthrough read to discover that the final verdicts
 * came after it (G17).
 *
 * The MANIFEST and not the note: the note is eval's record of an export it
 * made, and a bundle exported by `dsh-mission export` or copied from another
 * machine has no note at all. A bundle whose manifest cannot be read reports
 * null, and the staleness sentence then stays quiet rather than guessing.
 */
async function bundleExportedAt(bundleDir: string): Promise<number | null> {
  try {
    const manifest = JSON.parse(await readFile(join(bundleDir, 'manifest.json'), 'utf8')) as unknown
    const at = isPlainObject(manifest) ? manifest['exportedAt'] : undefined
    return typeof at === 'number' && Number.isFinite(at) ? at : null
  } catch {
    return null
  }
}

/** Whether the bundle carries the written report `dsh-eval report` produces. */
async function hasSummary(bundleDir: string): Promise<boolean> {
  try {
    return (await stat(join(bundleDir, 'report', 'summary.md'))).isFile()
  } catch {
    return false
  }
}

/**
 * The plan's own `exports`, read from the plan the run recorded. A plan that
 * moved, or one this composition cannot read, contributes no candidate rather
 * than a guessed path — the other two candidates still stand.
 */
async function planExportsDir(planPath: string | null): Promise<string | null> {
  if (planPath === null) return null
  try {
    const plan = JSON.parse(await readFile(planPath, 'utf8')) as unknown
    const exports = isPlainObject(plan) ? stringOrNull(plan['exports']) : null
    return exports === null ? null : expandHome(exports)
  } catch {
    return null
  }
}

/**
 * Every export directory this run's bundle could be under, in the order they
 * are tried: what the caller named, what the plan names, and decision 11's
 * default beside the dataset repository.
 * The run's own export NOTE goes first when it has one: a run started with
 * `--out <dir>` put its bundle somewhere none of the other three candidates
 * name, and until the note existed the only way back to it was a reader typing
 * the path into a box (I5·T53).
 * @param meta - the run's `run.meta` as the ledger holds it.
 * @param outDir - the directory the caller wants tried first (the dialog's).
 * @param noted - the directory the run's newest export note names, if any.
 * @param experimentExports - the owning experiment's `exports/` (T73's default), if the run has one.
 * @returns absolute candidate directories, de-duplicated, first-listed wins.
 */
export async function exportDirCandidates(
  meta: Record<string, unknown>,
  outDir?: string,
  noted?: string,
  experimentExports?: string,
): Promise<string[]> {
  const snapshot = isPlainObject(meta['snapshot']) ? meta['snapshot'] : undefined
  const repo = stringOrNull(snapshot?.['repo'])
  const candidates: Array<string | null> = [
    outDir === undefined || outDir.trim() === '' ? null : expandHome(outDir.trim()),
    noted === undefined || noted.trim() === '' ? null : expandHome(noted.trim()),
    experimentExports ?? null,
    await planExportsDir(stringOrNull(meta['planPath'])),
    repo === null ? null : join(repo, 'exports'),
  ]
  const seen: string[] = []
  for (const candidate of candidates) {
    if (candidate === null) continue
    const absolute = isAbsolute(candidate) ? candidate : resolve(candidate)
    if (!seen.includes(absolute)) seen.push(absolute)
  }
  return seen
}

/** The judges that judged one task's cells on either side of a pair. */
function judgesOf(assignments: readonly JudgeAssignment[], task: string, a: string, b: string): EvalReportJudgeTag[] {
  const tags = new Map<string, EvalReportJudgeTag>()
  for (const assignment of assignments) {
    if (assignment.task !== task) continue
    if (assignment.condition !== a && assignment.condition !== b) continue
    for (const judge of assignment.judges) {
      const seen = tags.get(judge.condition)
      // A judge that self-judged ANY cell of this row is marked for the row:
      // the mark is a warning about the number, and a warning that only shows
      // on some of the cells behind one number warns about nothing.
      if (seen === undefined) tags.set(judge.condition, { condition: judge.condition, model: judge.model, selfJudged: judge.selfJudged })
      else if (judge.selfJudged) seen.selfJudged = true
    }
  }
  return [...tags.values()].sort((x, y) => x.condition.localeCompare(y.condition))
}

/** One pair's rows, each carrying its own judges. */
function pairRowsOf(report: EvalReport, pair: EvalReport['comparisons'][number]): EvalReportPairRow[] {
  return pair.perTask.map((task): EvalReportPairRow => ({
    task: task.task,
    aMean: task.aMean,
    bMean: task.bMean,
    delta: task.aMean - task.bMean,
    aWeighted: task.aWeighted,
    bWeighted: task.bWeighted,
    weightedDelta: task.aWeighted !== null && task.bWeighted !== null ? task.aWeighted - task.bWeighted : null,
    deltas: [...task.deltas],
    n: task.n,
    judges: judgesOf(report.judgeAssignments, task.task, pair.a, pair.b),
  }))
}

/** One condition's efficiency row, column for column. */
function efficiencyOf(report: EvalReport): EvalReportEfficiencyRow[] {
  return report.efficiency.map(row => ({
    condition: row.condition,
    model: row.model,
    activeMs: row.activeMs,
    rounds: row.rounds,
    outputTokens: row.outputTokens,
    inputTokens: row.inputTokens,
    cacheReadTokens: row.cacheReadTokens,
    toolCalls: row.toolCalls,
    price: row.price,
  }))
}

/** One verdict, column for column — the drawer behind a criteria-table cell. */
function criterionSampleOf(sample: CriterionSample): EvalReportCriterionSample {
  return {
    missionId: sample.missionId,
    rep: sample.rep,
    ns: sample.ns,
    pass: sample.pass,
    ratio: sample.ratio === null ? null : { passed: sample.ratio.passed, total: sample.ratio.total },
    evidence: sample.evidence,
    by: sample.by,
    judge: sample.judge === null
      ? null
      : {
        condition: sample.judge.condition,
        model: sample.judge.model,
        selfJudged: sample.judge.selfJudged,
        sample: sample.judge.sample,
      },
  }
}

/** One (criterion × group) cell, with both its scoring samples and the ones it replaced. */
function criterionCellOf(cell: CriterionGroupResult): EvalReportCriterionCell {
  return {
    condition: cell.condition,
    reps: cell.reps,
    heldReps: cell.heldReps,
    credit: cell.credit,
    holds: cell.holds,
    proportional: cell.proportional,
    sources: { ...cell.sources },
    samples: cell.samples.map(criterionSampleOf),
    superseded: cell.superseded.map(criterionSampleOf),
  }
}

/**
 * The 判据 × 对比组 tables for the wire.
 *
 * Projection only, as everywhere on this seam: the per-criterion merge, the
 * majority over reps and the per-task total are all decided in `analyzeBundle`
 * and reshaped here. `criteriaTables` arrives EMPTY when the four invariants
 * did not hold, so this function cannot open a section the bundle closed —
 * exactly the rule `pairs` follows.
 */
function criteriaOf(report: EvalReport): EvalReportTaskCriteria[] {
  return report.criteriaTables.map((table): EvalReportTaskCriteria => ({
    task: table.task,
    conditions: [...table.conditions],
    rows: table.criteria.map((facts) => {
      const row = table.rows.find(candidate => candidate.criterion === facts.id)
      return {
        id: facts.id,
        axis: facts.axis,
        kind: facts.kind,
        weight: facts.weight,
        negative: facts.negative,
        undeclared: facts.undeclared,
        cells: (row?.cells ?? []).map(criterionCellOf),
      }
    }),
    totals: table.totals.map(total => ({ ...total })),
  }))
}

/**
 * Reshape one analyzed bundle for the report page.
 *
 * The ONE rule with teeth: `pairs` is empty unless `comparisonAllowed`. The
 * comparison blocks are the report's only ranked output, and an invariant that
 * did not hold is exactly the case where a reader most wants to see them —
 * which is why they do not cross the wire at all rather than crossing it with
 * a flag the page could forget to check.
 * @param report - the analyzed bundle.
 * @param runId - the run this page is open on (the bundle's id when it has one).
 * @returns the page payload.
 */
export function projectReport(report: EvalReport, runId: string): EvalRunReportView {
  return {
    runId: report.runId ?? runId,
    // Filled by {@link runReportView} when the run belongs to an experiment.
    experimentId: null,
    analysis: [],
    bundleDir: report.bundleDir,
    searched: [],
    refusal: null,
    cliHint: `dsh-eval report ${report.bundleDir}`,
    // Filled by {@link runReportView}, which has the ledger and the manifest.
    // Defaulted here so the pure projection stays callable on its own.
    exportedAt: null,
    lastHumanFinalAt: null,
    staleAfterFinal: false,
    summaryWritten: false,
    reexportable: false,
    closure: null,
    invariants: report.invariants.map(check => ({
      id: check.id,
      title: check.title,
      status: check.status,
      details: [...check.details],
    })),
    comparisonAllowed: report.comparisonAllowed,
    singleCondition: report.singleCondition,
    pairs: report.comparisonAllowed
      ? report.comparisons.map((pair): EvalReportPair => ({
        a: pair.a,
        b: pair.b,
        factor: { factor: pair.factor.factor, multi: pair.factor.multi, known: pair.factor.known, detail: pair.factor.detail },
        rows: pairRowsOf(report, pair),
        n: pair.n,
        ci: pair.ci === null ? null : { mean: pair.ci.mean, lo: pair.ci.lo, hi: pair.ci.hi, samples: pair.ci.samples, seed: pair.ci.seed },
        ciWithheld: pair.ciWithheld === null ? null : { ...pair.ciWithheld },
        ciAdvisory: pair.ciAdvisory,
        rank: pair.rank,
        rankReason: pair.rankReason,
      }))
      : [],
    // Same gate, decided in `analyzeBundle`: a closed comparison ships no
    // per-criterion table either.
    criteria: criteriaOf(report),
    efficiency: efficiencyOf(report),
    efficiencyExcluded: report.efficiencyExcluded.map(entry => ({ ...entry })),
    judge: {
      multiSampled: report.judge.multiSampled,
      llmAgreement: report.judge.llmAgreement === null ? null : { ...report.judge.llmAgreement },
      // κ is NaN when every rater was constant (a degenerate agreement), and
      // NaN does not survive JSON — it would reach the page as null anyway,
      // so it is made null here where the reason can be written down.
      llmKappa: report.judge.llmKappa === null || Number.isNaN(report.judge.llmKappa) ? null : report.judge.llmKappa,
      humanAgreement: report.judge.humanAgreement === null ? null : { ...report.judge.humanAgreement },
      crossJudged: report.judge.crossJudged,
      crossAgreement: report.judge.crossAgreement === null ? null : { ...report.judge.crossAgreement },
      crossKappa: report.judge.crossKappa === null || Number.isNaN(report.judge.crossKappa) ? null : report.judge.crossKappa,
      selfJudgedCriteria: report.judge.selfJudgedCriteria,
      details: [...report.judge.details],
    },
    toolOnlyNs: [...report.toolOnlyNs],
    counts: {
      rows: report.rows.length,
      missions: report.missions,
      attempts: report.attempts,
      retries: report.retries,
    },
    notes: [...report.notes],
  }
}

/** The empty payload a run with no exported bundle answers with. */
function notExported(runId: string, searched: string[]): EvalRunReportView {
  return {
    runId,
    experimentId: null,
    analysis: [],
    bundleDir: null,
    searched,
    refusal: searched.length === 0
      ? 'this run records no plan and no dataset repository, so there is no export directory to look in — export the bundle and name the directory'
      : `no export bundle for ${runId} yet — export it first (looked for ${runId}-bundle in: ${searched.join(', ')})`,
    cliHint: null,
    exportedAt: null,
    lastHumanFinalAt: null,
    staleAfterFinal: false,
    summaryWritten: false,
    reexportable: false,
    closure: null,
    invariants: [],
    comparisonAllowed: false,
    singleCondition: false,
    pairs: [],
    criteria: [],
    efficiency: [],
    efficiencyExcluded: [],
    judge: {
      multiSampled: 0,
      llmAgreement: null,
      llmKappa: null,
      humanAgreement: null,
      crossJudged: 0,
      crossAgreement: null,
      crossKappa: null,
      selfJudgedCriteria: 0,
      details: [],
    },
    toolOnlyNs: [],
    counts: { rows: 0, missions: 0, attempts: 0, retries: 0 },
    notes: [],
  }
}

/**
 * The report page's payload for one run: find its bundle, analyze it, project.
 * @param mission - the mission READ face (the run's meta names its plan and repo).
 * @param runId - the run the page is open on.
 * @param options - the export directory to try first (the dialog's).
 * @returns the page payload, or the "not exported yet" one naming where it looked.
 * @throws {@link EvalReadRefused} when the ledger holds no such run.
 */
export async function runReportView(
  mission: MissionReadFace,
  runId: string,
  options: { outDir?: string; experiment?: { id: string; dir: string } } = {},
): Promise<EvalRunReportView> {
  let meta: Record<string, unknown>
  try {
    meta = mission.runStatus(runId).run.meta
  } catch (error) {
    throw new EvalReadRefused(`cannot read run ${runId}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const state = readExportState(mission, runId)
  const closure = readRunMarks(mission, runId).closure
  const experiment = options.experiment
  const candidates = await exportDirCandidates(
    meta, options.outDir, state.note?.outDir, experiment === undefined ? undefined : join(experiment.dir, 'exports'),
  )
  const owner = {
    experimentId: experiment?.id ?? null,
    analysis: experiment === undefined ? [] : await listAnalysisFiles(experiment.dir),
  }
  const searched: string[] = []
  for (const candidate of candidates) {
    const bundle = bundleDirOf(candidate, runId)
    searched.push(candidate)
    if (!await isBundle(bundle)) continue
    const view = projectReport(await analyzeBundle(bundle), runId)
    return { ...view, ...await exportFreshness(bundle, state), closure, ...owner }
  }
  return {
    ...notExported(runId, searched),
    lastHumanFinalAt: state.lastHumanFinalAt,
    closure,
    ...owner,
  }
}

/**
 * The four fields that say how OLD the bundle on screen is.
 *
 * `staleAfterFinal` is the one with a sentence attached: an export made before
 * the last human-final does not carry it, so the numbers a reader is looking
 * at were computed without the final verdicts. It is deliberately the bundle's
 * own `exportedAt` that is compared — the manifest, not eval's note — because
 * that is the timestamp of the FILES, and the note may describe an export whose
 * directory a person has since moved away.
 *
 * `reexportable` says whether the one-click repeat has something to repeat:
 * the note records the layers and the snapshot reference an export was made
 * with, and without one the only honest offer is the dialog.
 */
async function exportFreshness(
  bundleDir: string,
  state: { note: EvalExportNote | null; lastHumanFinalAt: number | null },
): Promise<Pick<EvalRunReportView, 'exportedAt' | 'lastHumanFinalAt' | 'staleAfterFinal' | 'summaryWritten' | 'reexportable'>> {
  const exportedAt = await bundleExportedAt(bundleDir) ?? (state.note?.bundleDir === bundleDir ? state.note.exportedAt : null)
  return {
    exportedAt,
    lastHumanFinalAt: state.lastHumanFinalAt,
    staleAfterFinal: exportedAt !== null && state.lastHumanFinalAt !== null && exportedAt < state.lastHumanFinalAt,
    summaryWritten: await hasSummary(bundleDir),
    reexportable: state.note !== null,
  }
}

/**
 * Reshape a finalize walk for the wire: the counts, every cell, what happened
 * to the containers, and the log. Optional fields become explicit nulls here,
 * as everywhere on this seam — a reader must be able to tell "no unit" from
 * "a field this projection forgot".
 */
export function projectFinalize(report: FinalizeReport, log: readonly string[]): EvalFinalizeView {
  return {
    runId: report.runId,
    released: report.released,
    refused: report.refused,
    skipped: report.skipped,
    skippedByState: { ...report.skippedByState },
    cells: report.cells.map(cell => ({
      missionId: cell.missionId,
      state: cell.state,
      action: cell.action,
      finalState: cell.finalState,
      reason: cell.reason ?? null,
      unit: cell.unit === undefined
        ? null
        : { id: cell.unit.id, resource: cell.unit.resource, released: cell.unit.released, reason: cell.unit.reason ?? null },
    })),
    unitsReleased: report.unitsReleased,
    unitsHeld: report.unitsHeld.map(held => ({ ...held })),
    unitsKnown: report.unitsKnown,
    log: [...log],
  }
}
