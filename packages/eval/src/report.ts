import { parseEffortEvidence, type EffortEvidence } from './frozen-configuration.ts'
/**
 * The `report` verb: turn a self-contained mission export bundle into
 * `results.jsonl` (one line per verdict) and `summary.md` (the paired
 * comparison). Reads ONLY the bundle — manifest.json, run.json,
 * missions/<id>/attempt-N/{meta,annotations,artifacts} and the included
 * dataset layers; nothing from the mission data root or the dataset repo.
 *
 * Honesty rules this module enforces (web-eval README 冻结决策 9–11,
 * architecture §5):
 *
 * - The four invariants are checked FIRST and printed first. Any one not
 *   established (violated, or absent data) and the report degrades to fact
 *   tables — no comparison, no ranking. A fifth check (判定覆盖一致) is
 *   per PAIR: a pair whose criteria were judged by a judge / human on one
 *   side and only by a script on the other is described, never ranked.
 * - Factors are derived, never declared: condition documents recorded in
 *   run.meta are diffed pairwise; exactly one differing field names the
 *   factor, several fields degrade to 多因子 (descriptive only). Documents
 *   not recorded → the pair is marked unknown.
 * - Paired comparison blocks on tasks, resamples reps (never tasks) for the
 *   bootstrap CI, gives the CI only when at least 3 tasks have a delta, and
 *   refuses to rank when n (the smallest per-task rep count) < 3.
 * - Efficiency metrics stay parallel (never summed into one score); tokens
 *   compare only within the same model.
 * - Attempts are infrastructure retries (frozen decision 1): every attempt's
 *   verdicts appear as rows, but aggregation uses the current attempt only.
 * - The scoring axis is SCORED criteria, not passed ones. `pass` always means
 *   "the criterion holds" (protocol §6.5); on a negative criterion that is a
 *   defect, so it scores 0 and its absence scores 1. Polarity comes from the
 *   rubric — the bundle's derived weights table, or a rubric inside an
 *   included dataset layer — never from the verdict. Without a table the
 *   report says so and counts every criterion as positive.
 * - A criterion scored proportionally carries `ratio: {passed, total}` in its
 *   verdict (§6.5) and contributes that fraction instead of 1/0. The
 *   proportion is read from the FIELD, never parsed out of `evidence`; a
 *   ratio out of bounds is reported and falls back to the boolean.
 *
 * Shapes the orchestrator writes (I2·T8/T8b contract, profiles/web-eval/docs/
 * iterations.md): run.meta = {planSha, planPath, evalVersion, snapshot,
 * conditions: [{id, sha, condition}, …], order, concurrency, startedAt};
 * orchestrator-ns cell anchors = {kind: 'cell', task, condition,
 * conditionSha, rep} (one per cell, written before any work); orchestrator-ns
 * delegation records = {kind: 'delegation', stage, round, childSessionId,
 * promptSha, startedAt, durationMs, usage, model: {declared, observed}}.
 *
 * Cell identity comes from the anchor, never from `labels` — a mission
 * export bundle carries no labels, and the mission id is lossy (the split
 * stays only as the fallback for bundles predating the anchor). Fields this
 * report cannot find are reported as absent — never guessed from other
 * sources.
 * @module @khorsheed/dsh-eval
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { renderSummaryMd } from './report-render.ts'
import { bootstrapMeanCi, cohenKappa, fnv1a, mean, type BootstrapCi } from './stats.ts'
import { jsonEquals, VERDICT_SCHEMA, validateJson } from './schema.ts'
import { inStageScope, readRubricWeightTable, rubricWeightRows, RUBRIC_WEIGHTS_PATH, type RubricWeightRow } from './weights.ts'

// --- public shapes -----------------------------------------------------------

/**
 * Partial credit for a proportional criterion (protocol §6.5). `pass` stays
 * the boolean fact — the criterion FULLY holds — and this refines it.
 */
export interface VerdictRatio {
  passed: number
  total: number
}

/**
 * One round's (or one cell's) tool-call accounting as the bundle recorded it.
 * `count` is the cross-harness comparable; `byName` is each CLI's own tool
 * vocabulary, carried verbatim for a reader and never normalized — comparing
 * two harnesses by name would invent an equivalence they never agreed to.
 */
export interface ToolCallCounts {
  count: number
  byName?: Record<string, number>
}

/**
 * Who produced one llm-draft verdict. Present only on bundles written since
 * decision 9 was relaxed (2026-09-10): before that a judge could not be a
 * player, so "which judge" was answerable from `by` alone and no envelope
 * carried the model. A bundle without it reports no judge rather than a
 * reconstructed one — and, because the key is then absent entirely, a report
 * recomputed over an older bundle is byte-identical to the one before.
 */
export interface VerdictJudge {
  /** The judge condition id (also the verdict's `by`). */
  condition: string
  /** The judge's declared model; null only on a record that predates pinning it. */
  model: string | null
  /**
   * This judge's model is the model the CELL ran — the verdict is a
   * self-judgement. Recorded, not dropped: excluding it would mean a run that
   * evaluates every model has no judge at all.
   */
  selfJudged: boolean
  /** Which sample of that judge this verdict came from. */
  sample: number | null
}

/** One line of results.jsonl — one verdict, carrying its cell coordinates. */
export interface ReportRow {
  task: string | null
  condition: string | null
  conditionSha: string | null
  rep: number | null
  attempt: number
  stage: string | null
  ns: string
  criterion: string
  /** The criterion HOLDS (protocol §6.5) — on a negative criterion that is the defect. */
  pass: boolean
  /** Present only when the verdict declared a usable one (proportional criterion). */
  ratio?: VerdictRatio
  weight?: number
  /** Present only when the rubric's polarity is known for this criterion. */
  negative?: boolean
  /**
   * The CELL's tool calls, summed over its delegation rounds — present only
   * when at least one round reported an accounting. Repeated on every one of
   * the cell's verdict rows, exactly as the cell's other coordinates are; a
   * bundle whose rounds recorded none carries no key at all, so a report
   * recomputed over an older bundle is byte-identical to the one before.
   */
  toolCalls?: ToolCallCounts
  /** llm-draft only, and only on bundles that recorded it — see {@link VerdictJudge}. */
  judge?: VerdictJudge
  /**
   * The CELL's source mix: layer → how many of its criteria SCORED from that
   * layer after the per-criterion merge. `{"human-final": 1, "llm-draft": 3}`
   * is the cell a person re-judged one criterion of — the other three still
   * count, on the judge's word.
   *
   * Repeated on every one of the cell's rows, exactly as `toolCalls` is: it
   * is a fact about the cell, and a row has no mix of its own. This row's own
   * layer is `ns`; whether THIS row scored is `ns === ` the layer that won the
   * criterion, which the criteria table states outright.
   */
  sources?: Record<string, number>
  evidence: string
  by: string
}

/**
 * One validity check, with the facts behind it: the four architecture-§5
 * invariants, which gate the whole comparison section, and the fifth
 * (判定覆盖一致, D7), which degrades a single pair.
 */
export interface InvariantCheck {
  id: 'materialization' | 'fingerprint' | 'subject' | 'procedure' | 'verdict-coverage'
  title: string
  status: 'ok' | 'violated' | 'unverifiable'
  details: string[]
}

/** A condition pair and the factor their diff yields. */
export interface FactorPair {
  a: string
  b: string
  /** Field name when exactly one top-level field differs (harness / model / preset / skills / …). */
  factor: string | null
  /** All differing fields when more than one — 多因子. */
  multi: string[] | null
  /** False when the condition documents are not recorded in the bundle. */
  known: boolean
  detail: string
}

/** One task's paired deltas between two conditions (current attempts). */
export interface PairTaskDelta {
  task: string
  /**
   * Mean SCORED-criterion count (and weighted score) per side. A positive
   * criterion scores when it holds, a negative one when it does NOT — so a
   * defect never reads as one more point.
   */
  aMean: number
  bMean: number
  aWeighted: number | null
  bWeighted: number | null
  /** Per-rep deltas (rep-matched); the resampling unit. */
  deltas: number[]
  /** Rep pairs available for this task. */
  n: number
}

/**
 * One rep pair whose criteria were not judged by the same KIND of source on
 * both sides: a criterion one side has a judge or human verdict for, and the
 * other side has only a script verdict — or nothing — for.
 */
export interface CoverageGap {
  task: string
  rep: number
  /** The side missing the judge / human verdicts. */
  condition: string
  criteria: string[]
  /**
   * 判官缺席: every judge call on that cell failed. 仅脚本: the criteria rest on
   * script verdicts. 无判定: nothing judged them at all.
   */
  why: '判官缺席' | '仅脚本' | '无判定'
  /** The judge failures recorded on that cell, when it was 判官缺席. */
  failures: JudgeFailure[]
}

/** One judge call that produced no usable verdicts (`kind: 'judge-parse-failed'`). */
export interface JudgeFailure {
  judgeCondition: string | null
  sample: number | null
  attempt: number | null
  error: string
}

/** A condition pair's pooled comparison. */
export interface PairComparison {
  a: string
  b: string
  factor: FactorPair
  perTask: PairTaskDelta[]
  /** Smallest per-task rep-pair count — the rank gate. */
  n: number
  ci: BootstrapCi | null
  /**
   * Set when the CI was withheld because fewer than 3 tasks have a delta —
   * the interval's unit is the task, and one or two tasks cannot bound it.
   */
  ciWithheld: { tasksWithDelta: number } | null
  /** A CI was given, but the rank gate (n ≥ 3 per task) was not met. */
  ciAdvisory: boolean
  /** Rep pairs whose verdict sources differ in kind; non-empty degrades the pair. */
  coverageGaps: CoverageGap[]
  /** Set only when the rank gate passes: which side the CI favors. */
  rank: 'a' | 'b' | null
  rankReason: string
}

/** One cell's judges, as the bundle recorded them. */
export interface JudgeAssignmentJudge {
  condition: string
  model: string | null
  selfJudged: boolean
  /** Distinct samples of this judge that landed on the cell. */
  samples: number
  /** Verdict rows those samples produced. */
  verdicts: number
}

/** Which judges judged one cell — the report's answer to "who judged this". */
export interface JudgeAssignment {
  missionId: string
  task: string | null
  condition: string | null
  rep: number | null
  /** Judge-id-sorted; empty cells are not listed. */
  judges: JudgeAssignmentJudge[]
}

/** Judge (llm-draft) consistency numbers for the whole run. */
export interface JudgeConsistency {
  /** Criteria (per cell) with ≥2 llm-draft samples. */
  multiSampled: number
  llmAgreement: { agreed: number; total: number } | null
  /** Cohen κ over one judge's repeated samples; NaN when degenerate (constant raters). */
  llmKappa: number | null
  /** llm-draft vs human-final agreement, when human-final verdicts exist. */
  humanAgreement: { agreed: number; total: number } | null
  /**
   * Criteria judged by two or more DIFFERENT judge conditions — the panel's
   * own number, separate from one judge sampled twice. Zero on a single-judge
   * run and on any bundle that recorded no judge identity.
   */
  crossJudged: number
  /** How many of those every judge on the panel agreed on. */
  crossAgreement: { agreed: number; total: number } | null
  /** Cohen κ across judge pairs; null when no criterion had two judges. */
  crossKappa: number | null
  /** Criteria whose llm-draft verdicts include at least one self-judged sample. */
  selfJudgedCriteria: number
  details: string[]
}

/**
 * Per-condition efficiency numbers — parallel columns, never one score.
 *
 * Every number here is summed over the condition's COMPLETED cells only
 * (COMPLETED_STATES). An unfinished cell contributes real delegation time
 * for a fraction of the work, so pooling it with finished ones produces a
 * number that means nothing: pilot A's two harnesses both read 21.0 min of
 * active time, and the tie was an artifact of one dsh cell that only ever
 * ran stage one. What was excluded is reported beside the table, never
 * folded into it.
 */
export interface ConditionEfficiency {
  condition: string
  /** Model the tokens/time belong to (observed readback preferred). */
  model: string | null
  /** Sum of delegation durationMs over completed cells — active time, not wall clock. */
  activeMs: number | null
  /** Delegation count over completed cells. */
  rounds: number | null
  /** Mean delegation rounds per task (compared only on both-completed tasks). */
  roundsByTask: Record<string, number>
  outputTokens: number | null
  inputTokens: number | null
  cacheReadTokens: number | null
  /**
   * Tool calls summed over the condition's completed cells — null when no
   * round reported an accounting, which the table prints as a dash rather
   * than a zero it never observed.
   */
  toolCalls: number | null
  /** Listed price if run.meta/condition recorded one; blank otherwise. */
  price: number | null
}

/** Cells excluded from one condition's efficiency row, grouped by their state. */
export interface ExcludedCells {
  condition: string
  state: string
  count: number
}

/** Where the report's criterion polarity and weights came from, and how much of it there is. */
export interface RubricPolarity {
  /** True when a table was found — polarity is known for the criteria it lists. */
  available: boolean
  /** The bundle-relative source, or null when nothing carried one. */
  origin: string | null
  /** Criterion rows the table carries. */
  criteria: number
  /** Rows flagged negative — the defect criteria. */
  negative: number
  /** True when at least one row carries a numeric weight (the weighted score's precondition). */
  weighted: boolean
  /**
   * The run's stage scope (T84): the plan's `stages` as run.meta (or the
   * table) recorded them; null when the bundle recorded none — every
   * criterion is then scored.
   */
  planStages?: string[] | null
  /**
   * Criteria outside that scope, per task — dropped from the map, their
   * verdicts (if any) neither scored nor counted. `criteria`/`negative`
   * count the in-scope rows only.
   */
  outOfScope?: number
}

/**
 * One negative criterion that HELD — a defect the run actually observed.
 * This is the list a reader comes for; the scored-criterion count only says
 * how many there were.
 */
export interface NegativeHit {
  task: string | null
  condition: string | null
  rep: number | null
  attempt: number
  criterion: string
  /** The authoritative namespace this cell's verdict came from. */
  ns: string
  /** Rubric weight (negative), or null when the table declares none. */
  weight: number | null
  /** The verdict's proportion, when the criterion is scored proportionally. */
  ratio: VerdictRatio | null
  evidence: string
  by: string
}

/**
 * One rubric criterion as the derived table declares it — the ROW of the
 * criteria table.
 *
 * There is no title, and deliberately: the derived table (`weights.ts`) is
 * built from the grading layer and carries ids, weights, polarity, kind and
 * axis — never the criterion's text, which is the layer's own content and the
 * reason an automatic export leaves that layer behind. `axis` is the nearest
 * honest label a bundle can hand a reader, and it is the DIMENSION the
 * question was asked along.
 */
export interface CriterionFactsRow {
  id: string
  /** The rubric's sub-axis — the dimension this criterion scores under. */
  axis: string | null
  /** `objective` / `llm-draft` / `human`; null when the rubric declares none. */
  kind: string | null
  weight: number | null
  negative: boolean
  /** True when no rubric row declares this criterion — the verdicts alone do. */
  undeclared: boolean
}

/** One sample behind a criteria-table cell: a single verdict, whole. */
export interface CriterionSample {
  missionId: string
  rep: number | null
  /** The layer this sample was written in. */
  ns: string
  /** The criterion HOLDS (protocol §6.5) — on a negative criterion, the defect. */
  pass: boolean
  ratio: VerdictRatio | null
  /** The verdict's own checkable fact, verbatim. */
  evidence: string
  by: string
  /** The judge that wrote it, when the bundle recorded one (the report un-blinds). */
  judge: VerdictJudge | null
}

/** One (criterion × comparison group) cell of a task's criteria table. */
export interface CriterionGroupResult {
  condition: string
  /** Reps of this group that judged the criterion at all. */
  reps: number
  /** Reps where it HELD (the numerator of the `n/N` a multi-rep cell prints). */
  heldReps: number
  /** Mean credit over those reps, polarity NOT applied; null when none judged it. */
  credit: number | null
  /** The criterion holds for the group (majority of reps); null when none judged it. */
  holds: boolean | null
  /** True when any sample declared a `ratio` — the cell prints a proportion. */
  proportional: boolean
  /** Layer → reps that SCORED from it. Mixed keys is the whole point of T54. */
  sources: Record<string, number>
  /** The samples the score was taken from, rep by rep. */
  samples: CriterionSample[]
  /**
   * Samples of LOWER layers the merge passed over — a judge draft a person
   * re-judged. Non-empty with `human-final` among `sources` is 「人已改判」,
   * and the original judgement stays readable beside the new one.
   */
  superseded: CriterionSample[]
}

/**
 * One task's 判据 × 对比组 table: what every criterion concluded in every
 * group, with the evidence and the judge behind each conclusion.
 *
 * The table exists because a per-task total answers «which side won» and
 * nothing else — a reader looking at two scores cannot see WHICH dimension
 * moved, nor on what grounds. Every number here is the same merge the pair
 * table's is built from; `totals` is literally `scoreOf`'s, not a second sum.
 */
export interface TaskCriteriaTable {
  task: string
  /** Rubric order, undeclared criteria appended. */
  criteria: CriterionFactsRow[]
  /** The comparison groups that ran this task, sorted. */
  conditions: string[]
  /** One entry per criterion, in `criteria` order. */
  rows: Array<{ criterion: string; cells: CriterionGroupResult[] }>
  /** The bottom row: the task's own score per group — {@link EvalReport}'s only score. */
  totals: Array<{
    condition: string
    /** Mean scored-criterion count over the group's current cells. */
    scored: number | null
    weighted: number | null
    /** Cells the mean is over — the pair table's `n` when the reps are matched. */
    reps: number
  }>
}

/** The analyzed bundle — everything summary rendering and tests consume. */
export interface EvalReport {
  bundleDir: string
  runId: string | null
  expectedNs: string[] | null
  rows: ReportRow[]
  invariants: InvariantCheck[]
  /**
   * True only when the FIRST FOUR invariants are established. The fifth
   * (verdict-coverage) degrades single pairs and never closes the section.
   */
  comparisonAllowed: boolean
  conditions: Array<{ id: string; sha: string | null; model: string | null }>
  factors: FactorPair[]
  comparisons: PairComparison[]
  singleCondition: boolean
  judge: JudgeConsistency
  efficiency: ConditionEfficiency[]
  /** Per-round token/tool ledger — the source `report/usage.jsonl` is written from. */
  usageRows: UsageRow[]
  /** Which judges judged each cell (empty when the bundle recorded no judge identity). */
  judgeAssignments: JudgeAssignment[]
  /** Cells the efficiency table left out, by condition and state — one line under the table. */
  efficiencyExcluded: ExcludedCells[]
  /** Condition → tasks where ALL its current-attempt cells finished their stages (halted is not finished). */
  tasksCompletedBy: Record<string, string[]>
  /** expectedNs namespaces whose verdicts are ALL tool:-written — top red flag. */
  toolOnlyNs: string[]
  /** Per-ns verdict row counts. */
  nsCounts: Record<string, number>
  missions: number
  attempts: number
  retries: number
  weightsAvailable: boolean
  /** Criterion polarity: whether it is known at all, from where, and how much. */
  polarity: RubricPolarity
  /** Negative criteria that held, over current attempts — the defect list. */
  negativeHits: NegativeHit[]
  /**
   * Per task, the 判据 × 对比组 table: every criterion's conclusion in every
   * group, the layer it scored from, and the evidence behind it. Gated by the
   * same four invariants as {@link EvalReport.comparisons} — a run that may
   * not be compared ships no table — and populated for a SINGLE-group run
   * too, because «判官依据» does not depend on there being a second column.
   */
  criteriaTables: TaskCriteriaTable[]
  notes: string[]
}

/**
 * One line of `report/usage.jsonl` — ONE DELEGATION ROUND, with the cell
 * coordinates that place it. This is the per-round ledger the efficiency
 * table is summed from and the only file an external pricing step needs to
 * read: it never prices anything itself (the unit prices live outside this
 * bundle, applied by a non-model step), it just states what each round spent.
 *
 * Every observation field is OMITTED when the round did not report it — no
 * zero-filling, because "the harness reported nothing" and "the round spent
 * nothing" are different facts and only absence can say the first one.
 */
export interface UsageRow {
  reasoning?: EffortEvidence
  /** The run this bundle belongs to; null when its meta names none. */
  run: string | null
  /** The cell's mission id. */
  cell: string
  /** Attempt number — a retried cell keeps the same mission id. */
  attempt: number
  condition: string | null
  task: string | null
  stage: string | null
  round: number | null
  /**
   * Whether this round is inside the efficiency table's scope: the CURRENT
   * attempt of a cell that finished its stages (T23's rule). Summing the
   * `counted: true` rows of one condition reproduces its table row exactly;
   * the `false` rows are the spend the table deliberately excludes, kept here
   * rather than dropped so an external reader can choose its own scope.
   */
  counted: boolean
  observedModel?: string
  cliVersion?: string
  durationMs?: number
  usage?: { outputTokens?: number; inputTokens?: number; cacheReadTokens?: number }
  toolCalls?: ToolCallCounts
}

/** Files written by {@link writeEvalReport}. */
export interface ReportWrite {
  bundleDir: string
  outDir: string
  resultsPath: string
  summaryPath: string
  /** `report/usage.jsonl` — the per-round token and tool-call ledger. */
  usagePath: string
  rowCount: number
  /** Delegation rounds written to {@link ReportWrite.usagePath}. */
  usageRowCount: number
  report: EvalReport
}

// --- bundle reading ----------------------------------------------------------

const VERDICT_NS = new Set(['script', 'llm-draft', 'human-final'])
/** Verdict sources in authority order for pass counting (人终评最权威). */
const NS_PRIORITY = ['human-final', 'llm-draft', 'script'] as const
/** States meaning the cell finished its stages (halted is NOT completed). */
const COMPLETED_STATES = new Set(['judged', 'archived', 'releasable', 'released'])

interface DelegationRecord {
  reasoning?: EffortEvidence
  stage: string | null
  round: number | null
  durationMs: number | null
  usage: { outputTokens: number | null; inputTokens: number | null; cacheReadTokens: number | null }
  modelDeclared: string | null
  modelObserved: string | null
  /** The CLI build the round ran, when the harness read one back. */
  cliVersion: string | null
  /** The round's tool calls, when the harness counted any; null is "not reported". */
  toolCalls: ToolCallCounts | null
}

interface CellVerdict {
  ns: string
  criterion: string
  pass: boolean
  /** llm-draft only: who judged, when the envelope said so. */
  judge: VerdictJudge | null
  /** A usable `ratio`; null when absent or out of bounds. */
  ratio: VerdictRatio | null
  /** The verdict declared a `ratio` that could not be used — counted, never scored. */
  ratioMalformed: boolean
  doc: Record<string, unknown>
  createdAt: number
  seq: number
  stage: string | null
}

/**
 * A verdict's `ratio`, when it is usable. The schema subset cannot express
 * numeric bounds, so they live here: `total` positive, `passed` inside it,
 * both integers. A ratio that fails is treated as ABSENT — the verdict falls
 * back to its boolean — and reported, because bad data must never quietly
 * become a score.
 */
function ratioOf(doc: Record<string, unknown>): { ratio: VerdictRatio | null; malformed: boolean } {
  const raw = doc['ratio']
  if (raw === undefined) return { ratio: null, malformed: false }
  if (!isPlainObject(raw)) return { ratio: null, malformed: true }
  const passed = num(raw['passed'])
  const total = num(raw['total'])
  if (passed === null || total === null || !Number.isInteger(passed) || !Number.isInteger(total)
    || total <= 0 || passed < 0 || passed > total) {
    return { ratio: null, malformed: true }
  }
  return { ratio: { passed, total }, malformed: false }
}

/**
 * One cell's identity as the orchestrator anchored it (T8b): written once
 * per cell before any work, so even a skipped cell is attributable and a
 * retried cell inherits the anchor of its mission's first attempt.
 */
interface CellAnchor {
  task: string | null
  condition: string
  conditionSha: string | null
  rep: number | null
}

/**
 * What a cell's unit annotation says about its environment. `refs.fingerprint`
 * carries the environment CLASS — the components the plan declared — and this
 * carries the unit's own fingerprint plus the condition-owned components the
 * class left out, so a reader can see WHY two cells that share a class do not
 * share a unit fingerprint instead of having to take it on faith.
 */
interface CellUnit {
  resource: string | null
  unitFingerprint: string | null
  excludedMounts: string[]
  excludedEnvKeys: string[]
}

interface BundleCell {
  missionId: string
  attempt: number
  isCurrent: boolean
  state: string | null
  refs: Record<string, unknown>
  /** The anchor annotation of this cell's mission; null for a bundle without one. */
  anchor: CellAnchor | null
  task: string | null
  condition: string | null
  rep: number | null
  materializationSha: string | null
  /** The `kind: 'unit'` orchestrator annotation, when this cell ran in one. */
  unit: CellUnit | null
  verdicts: CellVerdict[]
  delegations: DelegationRecord[]
  /** Judge calls that produced no usable verdicts, as the orchestrator recorded them. */
  judgeFailures: JudgeFailure[]
  retryReason: string | null
  /** ns → writer origins (the `tool:`/`cli`/… prefix of the annotation's by). */
  writers: Map<string, Set<string>>
}

async function readJsonFile(path: string): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: JSON.parse(await readFile(path, 'utf8')) }
  } catch {
    return { ok: false }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Split a mission id into cell coordinates. The orchestrator names cells
 * `<task>-<conditionId>-rep<N>`; the condition id comes from
 * run.meta.conditions (longest id whose `-<id>` suffix ends the remainder).
 * Without a conditions list the split is ambiguous and stays null — the
 * report never guesses a factor.
 */
export function parseMissionId(
  id: string,
  conditionIds: readonly string[],
): { task: string | null; condition: string | null; rep: number | null } {
  const repMatch = /-rep(\d+)$/i.exec(id)
  const rep = repMatch ? Number(repMatch[1]) : null
  const rest = repMatch ? id.slice(0, repMatch.index) : id
  for (const condition of [...conditionIds].sort((a, b) => b.length - a.length)) {
    if (rest.length > condition.length + 1 && rest.toLowerCase().endsWith(`-${condition.toLowerCase()}`)) {
      return { task: rest.slice(0, rest.length - condition.length - 1), condition, rep }
    }
  }
  return { task: null, condition: null, rep }
}

/**
 * Extract the cell anchor from an orchestrator-ns payload (object or array).
 * `condition` is the one required field — an anchor that cannot name its
 * condition anchors nothing and is ignored.
 */
function anchorOf(payload: unknown): CellAnchor | null {
  const items = Array.isArray(payload) ? payload : [payload]
  for (const item of items) {
    if (!isPlainObject(item) || item['kind'] !== 'cell') continue
    const condition = str(item['condition'])
    if (condition === null) continue
    return { task: str(item['task']), condition, conditionSha: str(item['conditionSha']), rep: num(item['rep']) }
  }
  return null
}

/**
 * Read one recorded tool-call accounting. A payload without a finite `count`
 * is not an accounting — null, never a substituted zero, because "no round
 * reported it" and "the round used no tools" are different facts and only the
 * first one may be blank in the table.
 * @param value - the annotation's `toolCalls` field, whatever it holds.
 * @returns the accounting, or null when none was recorded.
 */
function toolCallsOf(value: unknown): ToolCallCounts | null {
  if (!isPlainObject(value)) return null
  const count = num(value['count'])
  if (count === null) return null
  const byName: Record<string, number> = {}
  if (isPlainObject(value['byName'])) {
    for (const [name, raw] of Object.entries(value['byName'])) {
      const times = num(raw)
      if (times !== null) byName[name] = times
    }
  }
  return { count, ...Object.keys(byName).length === 0 ? {} : { byName } }
}

/** Sum tool-call accountings, keeping the per-name tallies under their own names. */
function sumToolCalls(records: readonly (ToolCallCounts | null)[]): ToolCallCounts | null {
  const reported = records.filter((entry): entry is ToolCallCounts => entry !== null)
  if (reported.length === 0) return null
  let count = 0
  const byName: Record<string, number> = {}
  for (const entry of reported) {
    count += entry.count
    for (const [name, times] of Object.entries(entry.byName ?? {})) {
      byName[name] = (byName[name] ?? 0) + times
    }
  }
  return { count, ...Object.keys(byName).length === 0 ? {} : { byName } }
}

/** Extract delegation records from an orchestrator-ns payload (object or array). */
function delegationsOf(payload: unknown): DelegationRecord[] {
  const items = Array.isArray(payload) ? payload : [payload]
  const out: DelegationRecord[] = []
  for (const item of items) {
    if (!isPlainObject(item) || item['kind'] !== 'delegation') continue
    const model = isPlainObject(item['model']) ? item['model'] : undefined
    const usage = isPlainObject(item['usage']) ? item['usage'] : undefined
    const reasoning = parseEffortEvidence(item['reasoning'])
    out.push({
      ...reasoning === undefined ? {} : { reasoning },
      stage: str(item['stage']),
      round: num(item['round']),
      durationMs: num(item['durationMs']),
      usage: {
        outputTokens: usage === undefined ? null : num(usage['outputTokens']),
        inputTokens: usage === undefined ? null : num(usage['inputTokens']),
        cacheReadTokens: usage === undefined ? null : num(usage['cacheReadTokens']),
      },
      modelDeclared: model === undefined ? null : str(model['declared']),
      modelObserved: model === undefined ? null : str(model['observed']),
      cliVersion: str(item['cliVersion']),
      toolCalls: toolCallsOf(item['toolCalls']),
    })
  }
  return out
}

/**
 * Extract the judge failures from an orchestrator-ns payload (object or
 * array). `runJudgeSamples` records every failed judge call — the first try
 * and its retry alike — as `kind: 'judge-parse-failed'` before moving on, so
 * a cell whose judge never answered says so in the bundle itself.
 */
function judgeFailuresOf(payload: unknown): JudgeFailure[] {
  const items = Array.isArray(payload) ? payload : [payload]
  const out: JudgeFailure[] = []
  for (const item of items) {
    if (!isPlainObject(item) || item['kind'] !== 'judge-parse-failed') continue
    out.push({
      judgeCondition: str(item['judgeCondition']),
      sample: num(item['sample']),
      attempt: num(item['attempt']),
      error: str(item['error']) ?? '（未记录原因）',
    })
  }
  return out
}

/**
 * The verdict documents carried by one annotation payload. Three shapes are
 * accepted, because three writers produce them: a bare verdict (a person
 * annotating one criterion), an ARRAY of verdicts (a probe's script.json), and
 * the orchestrator's llm-draft SAMPLE ENVELOPE — `{sample, judgeCondition,
 * judgeSha, promptSha, verdicts}` — whose provenance fields sit beside the
 * verdicts rather than inside them. Reading only the first two shapes would
 * silently drop every LLM sample the judge wrote.
 */
function verdictDocsOf(payload: unknown): Array<{ doc: unknown; judge: VerdictJudge | null }> {
  if (Array.isArray(payload)) return payload.map(doc => ({ doc, judge: null }))
  if (isPlainObject(payload) && Array.isArray(payload['verdicts'])) {
    const judge = judgeOf(payload)
    return payload['verdicts'].map(doc => ({ doc, judge }))
  }
  return [{ doc: payload, judge: null }]
}

/**
 * The judge identity carried by an llm-draft sample envelope.
 *
 * `judgeModel` and `selfJudged` were added when decision 9 was relaxed, and
 * BOTH are required here: an envelope with only `judgeCondition` came from a
 * run where a judge could not be a player, so "self-judged" was not merely
 * unrecorded but impossible. Returning null for those keeps every older
 * bundle's report byte-identical — the `judge` key is then absent rather than
 * half-filled.
 * @param envelope - the llm-draft annotation payload.
 * @returns who judged, or null when the bundle does not say.
 */
function judgeOf(envelope: Record<string, unknown>): VerdictJudge | null {
  const condition = str(envelope['judgeCondition'])
  if (condition === null) return null
  const model = envelope['judgeModel']
  const selfJudged = envelope['selfJudged']
  if (typeof selfJudged !== 'boolean' || (model !== null && typeof model !== 'string')) return null
  return { condition, model, selfJudged, sample: num(envelope['sample']) }
}

/**
 * The overall materialization hash of one cell: prefer the overall sha the
 * orchestrator recorded inside materialization.json (`sha256` is the field
 * the run loop writes; the other spellings cover hand-made bundles), fall
 * back to hashing the file bytes; a refs key mentioning materialization wins
 * when present.
 *
 * The byte fallback is a LAST resort on purpose: the record also carries
 * `source.worktree`, the per-cell directory, so hashing the bytes gives every
 * cell a different digest and would report 题面一致 as violated on a run
 * whose cells materialized identical content.
 */
async function materializationShaOf(attemptDir: string, refs: Record<string, unknown>): Promise<string | null> {
  for (const [key, value] of Object.entries(refs)) {
    if (/materialization/i.test(key) && typeof value === 'string' && value.length > 0) return value
  }
  const metaLoaded = await readJsonFile(join(attemptDir, 'meta.json'))
  if (metaLoaded.ok && isPlainObject(metaLoaded.value)) {
    const artifacts = metaLoaded.value['artifacts']
    if (Array.isArray(artifacts)) {
      for (const entry of artifacts) {
        if (!isPlainObject(entry)) continue
        const kind = str(entry['kind'])
        const path = str(entry['path'])
        if (kind === 'materialization' || path?.endsWith('materialization.json')) {
          const loaded = await readJsonFile(join(attemptDir, 'artifacts', path ?? 'materialization.json'))
          if (loaded.ok && isPlainObject(loaded.value)) {
            const overall = str(loaded.value['sha256']) ?? str(loaded.value['sha']) ?? str(loaded.value['overallSha']) ?? str(loaded.value['hash'])
            if (overall !== null) return overall
          }
          try {
            const bytes = await readFile(join(attemptDir, 'artifacts', path ?? 'materialization.json'))
            return createHash('sha256').update(bytes).digest('hex')
          } catch {
            return null
          }
        }
      }
    }
  }
  return null
}

/**
 * Read a `kind: 'unit'` orchestrator annotation. Every field is optional: a
 * bundle from before the environment class carries `fingerprint` alone, and
 * then there is nothing to print beside the invariant — which is the honest
 * answer, not a blank row.
 */
function unitOf(payload: unknown): CellUnit | null {
  if (!isPlainObject(payload) || payload['kind'] !== 'unit') return null
  const excluded = isPlainObject(payload['envExcluded']) ? payload['envExcluded'] : {}
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  return {
    resource: str(payload['resource']),
    unitFingerprint: str(payload['unitFingerprint']),
    excludedMounts: list(excluded['mounts']),
    excludedEnvKeys: list(excluded['envKeys']),
  }
}

async function readCell(bundleDir: string, missionId: string, attempt: number, isCurrent: boolean): Promise<BundleCell | null> {
  const attemptDir = join(bundleDir, 'missions', missionId, `attempt-${attempt}`)
  const metaLoaded = await readJsonFile(join(attemptDir, 'meta.json'))
  const annotationsLoaded = await readJsonFile(join(attemptDir, 'annotations.json'))
  const annotations = annotationsLoaded.ok && Array.isArray(annotationsLoaded.value) ? annotationsLoaded.value : []
  if (!metaLoaded.ok && annotations.length === 0) return null

  const meta = metaLoaded.ok && isPlainObject(metaLoaded.value) ? metaLoaded.value : {}
  const refs = isPlainObject(meta['refs']) ? meta['refs'] : {}
  const retry = isPlainObject(meta['retry']) ? meta['retry'] : undefined
  const verdicts: CellVerdict[] = []
  const delegations: DelegationRecord[] = []
  const judgeFailures: JudgeFailure[] = []
  const writers = new Map<string, Set<string>>()
  let anchor: CellAnchor | null = null
  let unit: CellUnit | null = null
  let seq = 0
  for (const annotation of annotations) {
    if (!isPlainObject(annotation)) continue
    const ns = str(annotation['ns'])
    if (ns === null) continue
    const createdAt = num(annotation['createdAt']) ?? 0
    const stage = str(annotation['stage'])
    const by = str(annotation['by'])
    if (by !== null) {
      if (!writers.has(ns)) writers.set(ns, new Set())
      const colon = by.indexOf(':')
      writers.get(ns)?.add(colon < 0 ? by : by.slice(0, colon + 1))
    }
    if (ns === 'orchestrator') {
      delegations.push(...delegationsOf(annotation['payload']))
      judgeFailures.push(...judgeFailuresOf(annotation['payload']))
      anchor ??= anchorOf(annotation['payload'])
      unit ??= unitOf(annotation['payload'])
      continue
    }
    if (!VERDICT_NS.has(ns)) continue
    for (const { doc, judge } of verdictDocsOf(annotation['payload'])) {
      if (!isPlainObject(doc) || validateJson(VERDICT_SCHEMA, doc).length > 0) continue
      const { ratio, malformed } = ratioOf(doc)
      verdicts.push({
        ns,
        criterion: doc['criterion'] as string,
        pass: doc['pass'] as boolean,
        judge,
        ratio,
        ratioMalformed: malformed,
        doc,
        createdAt,
        seq: seq++,
        stage,
      })
    }
  }
  return {
    missionId,
    attempt,
    isCurrent,
    state: str(meta['state']),
    refs,
    anchor,
    task: null,
    condition: null,
    rep: null,
    materializationSha: await materializationShaOf(attemptDir, refs),
    unit,
    verdicts,
    delegations,
    judgeFailures,
    retryReason: retry === undefined ? null : str(retry['reason']),
    writers,
  }
}

async function readCells(bundleDir: string, conditionIds: readonly string[]): Promise<BundleCell[]> {
  const missionsDir = join(bundleDir, 'missions')
  let missionIds: string[] = []
  try {
    missionIds = (await readdir(missionsDir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort()
  } catch {
    return []
  }
  const cells: BundleCell[] = []
  for (const missionId of missionIds) {
    let attempts: number[] = []
    try {
      attempts = (await readdir(join(missionsDir, missionId), { withFileTypes: true }))
        .filter(e => e.isDirectory() && /^attempt-(\d+)$/.test(e.name))
        .map(e => Number(/^(?:attempt-)(\d+)$/.exec(e.name)?.[1]))
        .sort((a, b) => a - b)
    } catch {
      continue
    }
    for (const attempt of attempts) {
      const cell = await readCell(bundleDir, missionId, attempt, attempt === attempts[attempts.length - 1])
      if (cell !== null) cells.push(cell)
    }
  }

  // The anchor is written once per cell (attempt 1); a retried cell's later
  // attempts carry none, so the mission's anchor propagates across its
  // attempts — cell identity belongs to the mission, not to the attempt.
  const anchorByMission = new Map<string, CellAnchor>()
  for (const cell of cells) {
    if (cell.anchor !== null && !anchorByMission.has(cell.missionId)) anchorByMission.set(cell.missionId, cell.anchor)
  }

  // Cell coordinates: the anchor when the run wrote one, else the mission-id
  // split (bundles predating T8b), else the verdict task by majority.
  for (const cell of cells) {
    cell.anchor = anchorByMission.get(cell.missionId) ?? null
    if (cell.anchor !== null) {
      cell.condition = cell.anchor.condition
      cell.rep = cell.anchor.rep
      cell.task = cell.anchor.task
    } else {
      const parsed = parseMissionId(cell.missionId, conditionIds)
      cell.condition = parsed.condition
      cell.rep = parsed.rep
      cell.task = parsed.task
    }
    if (cell.task === null) {
      const counts = new Map<string, number>()
      for (const verdict of cell.verdicts) counts.set(verdict.doc['task'] as string, (counts.get(verdict.doc['task'] as string) ?? 0) + 1)
      const tasks = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      cell.task = tasks[0]?.[0] ?? null
    }
  }
  return cells
}

// --- rubric polarity & weights ----------------------------------------------

/** One criterion's scoring facts as the rubric declares them. */
interface CriterionFacts {
  weight: number | null
  negative: boolean
  /** The rubric's sub-axis — the dimension the criteria table names a row by. */
  axis: string | null
  /** `objective` / `llm-draft` / `human`, when the rubric declares one. */
  kind: string | null
  /** Rubric document order, so the criteria table can print the rubric's own. */
  order: number
  /** The stages the leaf judges (weights.ts `leafStages`); null/absent: every run. */
  stages?: string[] | null
}

/** task → criterion → the rubric's scoring facts. */
type PolarityMap = Map<string, Map<string, CriterionFacts>>

function indexRows(rows: readonly RubricWeightRow[], sink: PolarityMap): void {
  let order = 0
  for (const row of rows) {
    if (!sink.has(row.task)) sink.set(row.task, new Map())
    sink.get(row.task)?.set(row.id, {
      weight: row.weight, negative: row.negative, axis: row.axis, kind: row.kind, order: order++,
      stages: row.stages ?? null,
    })
  }
}

/**
 * Collect rows from one parsed JSON document shaped like a rubric
 * (`{task, criteria: [{criterion, weight}]}` and nestings of it). The
 * tolerant reader that predates the derived table: it only ever knew
 * weights, so polarity there is the weight's sign.
 */
function rowsOfJsonDocument(value: unknown, sink: RubricWeightRow[], depth: number): void {
  if (depth > 4 || !isPlainObject(value)) return
  const criteria = value['criteria']
  if (Array.isArray(criteria) || isPlainObject(criteria)) {
    const task = str(value['task']) ?? str(value['id'])
    const entries = Array.isArray(criteria) ? criteria : Object.entries(criteria).map(([criterion, sub]) => ({ criterion, ...(isPlainObject(sub) ? sub : { weight: sub }) }))
    for (const entry of entries) {
      if (!isPlainObject(entry)) continue
      const criterion = str(entry['criterion']) ?? str(entry['name']) ?? str(entry['id'])
      const weight = num(entry['weight'])
      if (criterion !== null && weight !== null && task !== null) {
        sink.push({
          task,
          id: criterion,
          weight,
          negative: entry['negative'] === true || weight < 0,
          kind: str(entry['kind']),
          axis: str(entry['axis']),
        })
      }
    }
  }
  for (const [, sub] of Object.entries(value)) {
    if (isPlainObject(sub)) rowsOfJsonDocument(sub, sink, depth + 1)
    else if (Array.isArray(sub)) for (const item of sub) rowsOfJsonDocument(item, sink, depth + 1)
  }
}

/** Rubric rows carried by the bundle's own dataset layers (a guarded export). */
async function rowsOfDatasetLayers(bundleDir: string): Promise<RubricWeightRow[]> {
  const rows: RubricWeightRow[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 5) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      const isJson = entry.name.endsWith('.json')
      // A real rubric is YAML: without this, an export that deliberately
      // included the grading layer still produced no weights at all.
      const isRubricYaml = /^rubric\.ya?ml$/i.test(entry.name)
      if (!isJson && !isRubricYaml) continue
      try {
        if ((await stat(full)).size > 1_000_000) continue
        const text = await readFile(full, 'utf8')
        if (isRubricYaml) rows.push(...rubricWeightRows(text))
        else rowsOfJsonDocument(JSON.parse(text), rows, 0)
      } catch {
        /* a dataset layer file that is not a rubric stays ignored */
      }
    }
  }
  await walk(join(bundleDir, 'dataset'), 0)
  return rows
}

/**
 * The bundle's criterion table. The DERIVED table wins — it is written from
 * the grading layer at export time and is the only source that states
 * polarity outright; a rubric inside an included dataset layer is the
 * fallback for a deliberately guarded export. Neither present → polarity
 * unknown, and the report says so rather than assuming everything positive.
 */
async function readPolarity(
  bundleDir: string,
  metaStages: string[] | null = null,
): Promise<{ map: PolarityMap; polarity: RubricPolarity; outOfScope: Set<string> }> {
  const map: PolarityMap = new Map()
  let origin: string | null = null
  const derived = await readRubricWeightTable(bundleDir)
  if (derived !== null) {
    indexRows(derived.criteria, map)
    origin = RUBRIC_WEIGHTS_PATH
  } else {
    const rows = await rowsOfDatasetLayers(bundleDir)
    if (rows.length > 0) {
      indexRows(rows, map)
      origin = 'dataset/'
    }
  }
  // The stage scope (T84): run.meta's `stages` first, the table's own
  // `planStages` second; neither → every criterion is in scope (old bundles).
  const planStagesRaw = metaStages ?? derived?.planStages ?? null
  const planStages = planStagesRaw !== null && planStagesRaw.length > 0 ? planStagesRaw : null
  const outOfScope = new Set<string>()
  if (planStages !== null) {
    for (const [task, byCriterion] of map) {
      for (const [criterion, facts] of [...byCriterion]) {
        if (inStageScope(facts.stages, planStages)) continue
        outOfScope.add(scopeKey(task, criterion))
        byCriterion.delete(criterion)
      }
    }
  }
  let criteria = 0
  let negative = 0
  let weighted = false
  for (const [, byCriterion] of map) {
    for (const [, facts] of byCriterion) {
      criteria += 1
      if (facts.negative) negative += 1
      if (facts.weight !== null) weighted = true
    }
  }
  return {
    map,
    polarity: {
      available: origin !== null, origin, criteria, negative, weighted,
      ...(planStages !== null ? { planStages, outOfScope: outOfScope.size } : {}),
    },
    outOfScope,
  }
}

function scopeKey(task: string, criterion: string): string {
  return `${task}\u0000${criterion}`
}

// --- invariants --------------------------------------------------------------

function checkMaterialization(cells: BundleCell[]): InvariantCheck {
  const groups = new Map<string, { hash: string; cell: string }[]>()
  for (const cell of cells.filter(c => c.isCurrent)) {
    if (cell.materializationSha === null) continue
    const key = cell.task ?? `mission:${cell.missionId}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)?.push({ hash: cell.materializationSha, cell: cell.missionId })
  }
  const details: string[] = []
  let violated = false
  let verifiable = false
  for (const [task, entries] of [...groups.entries()].sort()) {
    const hashes = [...new Set(entries.map(e => e.hash))]
    verifiable = true
    if (hashes.length === 1) {
      details.push(`${task}: ${hashes[0]?.slice(0, 12) ?? '—'}… × ${entries.length} 格一致`)
    } else {
      violated = true
      details.push(`${task}: 出现 ${hashes.length} 个不同物化哈希（${hashes.map(h => `${h.slice(0, 12)}…`).join(' / ')}）`)
    }
  }
  if (!verifiable) {
    return { id: 'materialization', title: '题面一致（materialization 哈希同题相同）', status: 'unverifiable', details: ['bundle 中没有物化哈希记录（无 materialization 工件、refs 亦无）——无法核验'] }
  }
  return {
    id: 'materialization',
    title: '题面一致（materialization 哈希同题相同）',
    status: violated ? 'violated' : 'ok',
    details,
  }
}

/** The environment-class title, restated wherever the invariant is reported. */
const FINGERPRINT_TITLE = '环境一致（refs.fingerprint 同 run 相同）'

/**
 * Per-cell environment detail under the invariant line: the unit each cell
 * actually ran in, and the condition-owned components its class left out.
 *
 * The class exists because four harnesses in one run mount four different
 * credential directories under four different variables, so their UNIT
 * fingerprints can never agree. Printing them next to the class is what keeps
 * that from being a claim the reader has to trust: the classes are equal, the
 * units are not, and here is exactly which components account for the
 * difference (names and in-container targets — never a value).
 */
function fingerprintDetails(cells: BundleCell[]): string[] {
  const rows = cells.filter(cell => cell.isCurrent && cell.unit !== null)
  if (rows.length === 0) return []
  const details = [`每格的单元指纹（含条件自有项，因而各不相同）与被排除的条件项：`]
  for (const cell of rows) {
    const unit = cell.unit as CellUnit
    const excluded = [
      ...unit.excludedMounts.map(target => `挂载 ${target}`),
      ...unit.excludedEnvKeys.map(key => `env ${key}`),
    ]
    details.push(`  ${cell.missionId}: ${unit.unitFingerprint === null ? '（无单元指纹记录）' : `${unit.unitFingerprint.slice(0, 20)}…`}`
      + `${excluded.length > 0 ? ` — 排除 ${excluded.join('、')}` : ' — 无排除项'}`)
  }
  return details
}

function checkFingerprint(cells: BundleCell[]): InvariantCheck {
  const present = cells.filter(c => c.isCurrent && str(c.refs['fingerprint']) !== null)
    .map(c => ({ cell: c.missionId, fp: c.refs['fingerprint'] as string }))
  if (present.length === 0) {
    return { id: 'fingerprint', title: FINGERPRINT_TITLE, status: 'unverifiable', details: ['本 run 无指纹'] }
  }
  const all = cells.filter(c => c.isCurrent)
  if (present.length < all.length) {
    return {
      id: 'fingerprint',
      title: FINGERPRINT_TITLE,
      status: 'violated',
      details: [`${all.length - present.length}/${all.length} 格未记录指纹，其余 ${present.length} 格已记录——记录不一致`, ...fingerprintDetails(cells)],
    }
  }
  const distinct = [...new Set(present.map(p => p.fp))]
  if (distinct.length > 1) {
    return {
      id: 'fingerprint',
      title: FINGERPRINT_TITLE,
      status: 'violated',
      details: [`出现 ${distinct.length} 个不同指纹: ${distinct.map(d => `${d.slice(0, 12)}…`).join(' / ')}`, ...fingerprintDetails(cells)],
    }
  }
  const fingerprint = distinct[0] ?? ''
  return {
    id: 'fingerprint',
    title: FINGERPRINT_TITLE,
    status: 'ok',
    details: [`${present.length} 格指纹一致: ${fingerprint.slice(0, 12)}…`, ...fingerprintDetails(cells)],
  }
}

function conditionEntriesOf(meta: Record<string, unknown>): Array<{ id: string; sha: string | null; doc: Record<string, unknown> | null }> {
  const raw = meta['conditions']
  const out: Array<{ id: string; sha: string | null; doc: Record<string, unknown> | null }> = []
  const push = (id: unknown, sha: unknown, doc: unknown): void => {
    const idStr = str(id)
    if (idStr === null) return
    out.push({ id: idStr, sha: str(sha), doc: isPlainObject(doc) ? doc : null })
  }
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (isPlainObject(entry)) push(entry['id'], entry['sha'], entry['condition'] ?? entry['document'])
      else push(entry, undefined, undefined)
    }
  } else if (isPlainObject(raw)) {
    for (const [id, value] of Object.entries(raw)) {
      if (isPlainObject(value)) push(id, value['sha'], value['condition'] ?? value['document'])
      else push(id, value, undefined)
    }
  }
  return out
}

/**
 * 受试对象一致: every current cell's ANCHOR names a condition the run
 * recorded, with the same hash, and every model read back equals the one
 * declared. The anchor is the only identity source here — `labels` do not
 * exist in a bundle, and the mission-id split is a guess, so a cell without
 * an anchor leaves the invariant unverifiable rather than assumed.
 */
function checkSubject(cells: BundleCell[], conditionEntries: Array<{ id: string; sha: string | null }>): InvariantCheck {
  const title = '受试对象一致（cell 锚点与 run.meta.conditions 一致；model.observed 与 declared 一致）'
  const details: string[] = []
  let violated = false
  let conditionVerified = true
  const shaById = new Map(conditionEntries.map(e => [e.id, e.sha]))
  const current = cells.filter(c => c.isCurrent)

  if (conditionEntries.length === 0) {
    conditionVerified = false
    details.push('run.meta 未记录 conditions（id 与 sha 清单）')
  }
  for (const cell of current) {
    const anchor = cell.anchor
    if (anchor === null) {
      conditionVerified = false
      details.push(`${cell.missionId}: 无 cell 锚点（orchestrator ns 的 {kind:'cell'} 注解）——格子身份不可核验`)
      continue
    }
    if (!shaById.has(anchor.condition)) {
      conditionVerified = false
      violated = true
      details.push(`${cell.missionId}: 锚点条件 ${JSON.stringify(anchor.condition)} 不在 run.meta.conditions 中`)
      continue
    }
    const metaSha = shaById.get(anchor.condition) ?? null
    if (anchor.conditionSha !== null && metaSha !== null && anchor.conditionSha !== metaSha) {
      violated = true
      details.push(`${cell.missionId}: 锚点条件哈希 ${anchor.conditionSha.slice(0, 12)}… ≠ run.meta 的 ${metaSha.slice(0, 12)}…`)
    }
  }

  let observedSeen = false
  let effortUnverified = false
  for (const cell of current) {
    for (const delegation of cell.delegations) {
      if (delegation.reasoning?.status === 'mismatch') {
        violated = true
        details.push(`${cell.missionId}: 推理强度声明、准入配置或回读不一致，该格不参与比较`)
      } else if (delegation.reasoning?.status === 'unverified') {
        effortUnverified = true
        details.push(`${cell.missionId}: 本轮推理强度缺少原生回读证据，未验证`)
      }
      if (delegation.modelObserved === null) continue
      observedSeen = true
      if (delegation.modelDeclared !== null && delegation.modelObserved !== delegation.modelDeclared) {
        violated = true
        details.push(`${cell.missionId}: 回读模型 ${JSON.stringify(delegation.modelObserved)} ≠ 声明 ${JSON.stringify(delegation.modelDeclared)}`)
      }
    }
  }
  if (!observedSeen) details.push('无模型回读记录（delegation 的 model.observed 缺失或为 null）——回读一致性未核验')

  if (violated) return { id: 'subject', title, status: 'violated', details }
  if (!conditionVerified || !observedSeen || effortUnverified) return { id: 'subject', title, status: 'unverifiable', details }
  return { id: 'subject', title, status: 'ok', details: [`${current.length} 格锚点条件均落在 run.meta.conditions 内且哈希一致；模型回读与声明一致`] }
}

/**
 * The subset line of the procedure section. A run that covered part of its
 * plan says so here, in the same place the reader checks whether two
 * conditions ran the same program — an unrecorded subset is how a partial run
 * gets read as a complete one.
 * @param meta - `run.meta`.
 * @returns one detail line, or null when the run predates the field.
 */
function subsetDetail(meta: Record<string, unknown>): string | null {
  const subset = isPlainObject(meta['subset']) ? meta['subset'] : undefined
  if (subset === undefined) return null
  const total = num(subset['totalCells'])
  const selected = num(subset['selectedCells'])
  const only = Array.isArray(subset['only']) ? subset['only'].filter((id): id is string => typeof id === 'string') : null
  const maxCells = num(subset['maxCells'])
  const span = total !== null && selected !== null ? `${selected}/${total} 格` : '格数未记录'
  const knobs: string[] = []
  if (only !== null && only.length > 0) knobs.push(`--only ${only.join('、')}`)
  if (maxCells !== null) knobs.push(`--max-cells ${maxCells}`)
  if (knobs.length === 0) return `子集：全矩阵（${span}，无 --only / --max-cells）`
  return `子集：${knobs.join(' + ')}（${span}）——本 run 只覆盖了 plan 的一部分`
}

function checkProcedure(meta: Record<string, unknown>): InvariantCheck {
  const evalVersion = str(meta['evalVersion'])
  const planSha = str(meta['planSha'])
  const details: string[] = []
  if (planSha !== null) details.push(`planSha ${planSha.slice(0, 12)}… 已记录`)
  else details.push('planSha 未记录')
  if (evalVersion !== null) details.push(`evalVersion ${evalVersion} 已记录`)
  else details.push('evalVersion 未记录（程序版本不可追溯）')
  const subset = subsetDetail(meta)
  // A run written before the field simply says nothing: absence here means
  // "unrecorded", and claiming "full matrix" would be a guess.
  if (subset !== null) details.push(subset)
  // The orchestrator's own capability face is PROVENANCE: it is listed so a
  // reader can reproduce the apparatus, and compared against nothing. The
  // orchestrator answers none of the dataset's questions — making its
  // capabilities a pass/fail input would turn "we upgraded the planning
  // agent" into a violated invariant.
  const orchestrator = isPlainObject(meta['orchestrator']) ? meta['orchestrator'] : undefined
  const capabilities = isPlainObject(orchestrator?.['capabilities']) ? orchestrator['capabilities'] : undefined
  const capabilitySha = capabilities === undefined ? null : str(capabilities['sha'])
  if (capabilitySha !== null) {
    const preset = str(capabilities?.['preset'] ?? null)
    details.push(`编排实例能力 caps:${capabilitySha.slice(0, 12)}…${preset === null ? '' : `（preset ${preset}）`}——取证，不参与比较`)
  }
  const ok = evalVersion !== null && planSha !== null
  return {
    id: 'procedure',
    title: '程序一致（run.meta.evalVersion 与 planSha 存在）',
    status: ok ? 'ok' : 'violated',
    details,
  }
}

// --- factors -----------------------------------------------------------------

/** Diff two condition documents' top-level fields (`notes` excluded). */
function diffConditions(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => k !== 'notes').sort()
  return keys.filter(key => !jsonEquals(a[key] ?? null, b[key] ?? null))
}

function factorPairs(conditionEntries: Array<{ id: string; sha: string | null; doc: Record<string, unknown> | null }>): FactorPair[] {
  const out: FactorPair[] = []
  for (let i = 0; i < conditionEntries.length; i++) {
    for (let j = i + 1; j < conditionEntries.length; j++) {
      const a = conditionEntries[i]
      const b = conditionEntries[j]
      if (a === undefined || b === undefined) continue
      if (a.doc === null || b.doc === null) {
        out.push({
          a: a.id, b: b.id, factor: null, multi: null, known: false,
          detail: '条件文档未随 bundle 记录（run.meta.conditions 只有 id/sha）——无法判定单因子，按未知因子处理',
        })
        continue
      }
      const diff = diffConditions(a.doc, b.doc)
      if (diff.length === 0) {
        out.push({ a: a.id, b: b.id, factor: null, multi: null, known: true, detail: '两份条件文档完全相同（仅 id 不同）——因子无从谈起' })
      } else if (diff.length === 1) {
        const factor = diff[0] ?? ''
        out.push({ a: a.id, b: b.id, factor, multi: null, known: true, detail: `只差一个字段: ${factor}` })
      } else {
        out.push({ a: a.id, b: b.id, factor: null, multi: diff, known: true, detail: `差 ${diff.length} 个字段: ${diff.join(' / ')}——多因子，只做描述统计` })
      }
    }
  }
  return out
}

// --- comparison --------------------------------------------------------------

/**
 * The cell's authoritative verdicts, merged PER CRITERION.
 *
 * The rule the report scores by: each criterion independently takes the most
 * authoritative layer that judged IT (`human-final` > `llm-draft` >
 * `script`). One cell may therefore score from several layers at once — a
 * human who re-judged one criterion of four leaves the other three on the
 * judge's word, and all four still count.
 *
 * The rule it replaces (until 2026-09-18) took the best layer for the CELL
 * and scored from that one alone. One human verdict then silently dropped
 * every criterion the human had not answered: I5·T37 recorded a judge's four
 * criteria, a person re-judged one, and the cell scored 1 instead of 4 with
 * nothing on any page saying where the other three went. A rule whose cost is
 * invisible at the moment it is paid is the wrong rule; a mixed cell is
 * legible as long as the mixture is REPORTED, which is what `sources` is for.
 */
interface PrimaryVerdicts {
  /** criterion → the layer its value was taken from. */
  ns: Map<string, string>
  /** criterion → the criterion HOLDS (majority across that layer's samples). */
  holds: Map<string, boolean>
  /**
   * criterion → credit in [0, 1] BEFORE polarity is applied. A boolean
   * criterion is 1 or 0 by the same majority rule as `holds`; a proportional
   * one (protocol §6.5 `ratio`) is the mean of the proportions its samples
   * actually declared — samples without a usable ratio are not averaged in,
   * because the report averages what it was given, never what it guessed.
   */
  credit: Map<string, number>
  /** criterion → the first verdict document behind it (evidence and `by`). */
  source: Map<string, CellVerdict>
  /** criterion → every verdict of the layer it scored from, in record order. */
  samples: Map<string, CellVerdict[]>
  /**
   * criterion → the verdicts of LOWER layers the merge passed over. Kept, not
   * dropped: «人已改判» is only readable beside the judgement it replaced.
   */
  superseded: Map<string, CellVerdict[]>
  /** layer → how many criteria scored from it — the cell's source mix. */
  sources: Record<string, number>
}

function configurationMismatch(cell: BundleCell): boolean {
  return cell.delegations.some(delegation => delegation.reasoning?.status === 'mismatch')
}

function primaryPass(cell: BundleCell): PrimaryVerdicts | null {
  // The configuration guard comes FIRST, and it is whole-cell on purpose: a
  // round whose reasoning effort was read back as something other than what
  // the condition declared was not run under the condition it is filed as, so
  // none of its verdicts say anything about that condition. Per-criterion
  // merging is about which LAYER answers for a criterion; it never converts a
  // cell the run cannot attribute into a partially usable one.
  if (configurationMismatch(cell)) return null
  const byCriterion = new Map<string, Map<string, CellVerdict[]>>()
  for (const verdict of cell.verdicts) {
    let perNs = byCriterion.get(verdict.criterion)
    if (perNs === undefined) {
      perNs = new Map()
      byCriterion.set(verdict.criterion, perNs)
    }
    const bucket = perNs.get(verdict.ns)
    if (bucket === undefined) perNs.set(verdict.ns, [verdict])
    else bucket.push(verdict)
  }
  const ns = new Map<string, string>()
  const holds = new Map<string, boolean>()
  const credit = new Map<string, number>()
  const source = new Map<string, CellVerdict>()
  const samples = new Map<string, CellVerdict[]>()
  const superseded = new Map<string, CellVerdict[]>()
  const sources: Record<string, number> = {}
  for (const [criterion, perNs] of byCriterion) {
    const layer = NS_PRIORITY.find(candidate => (perNs.get(candidate)?.length ?? 0) > 0)
    if (layer === undefined) continue
    const verdicts = perNs.get(layer) as CellVerdict[]
    const majority = verdicts.filter(v => v.pass).length > verdicts.length / 2
    const fractions = verdicts
      .filter((v): v is CellVerdict & { ratio: VerdictRatio } => v.ratio !== null)
      .map(v => v.ratio.passed / v.ratio.total)
    ns.set(criterion, layer)
    holds.set(criterion, majority)
    credit.set(criterion, fractions.length > 0 ? mean(fractions) : (majority ? 1 : 0))
    source.set(criterion, verdicts[0] as CellVerdict)
    samples.set(criterion, verdicts)
    superseded.set(criterion, NS_PRIORITY
      .slice(NS_PRIORITY.indexOf(layer) + 1)
      .flatMap(lower => perNs.get(lower) ?? []))
    sources[layer] = (sources[layer] ?? 0) + 1
  }
  if (ns.size === 0) return null
  // Authority order, not the order the criteria happened to arrive in: the mix
  // rides every result row, and a file whose key order depends on which
  // criterion came first is a file two runs of the same bundle can disagree on.
  const ordered: Record<string, number> = {}
  for (const layer of NS_PRIORITY) if (sources[layer] !== undefined) ordered[layer] = sources[layer]
  return { ns, holds, credit, source, samples, superseded, sources: ordered }
}

/**
 * One cell's score. `scored` is the report's main axis: a positive criterion
 * scores its credit, a NEGATIVE one scores what is LEFT of it — the defect
 * being present must never read as one more point. `weighted` sums
 * `weight × credit`, so a negative weight subtracts on its own without any
 * second rule, and a proportional criterion earns its fraction of the weight.
 * Polarity absent from the table → positive (and the report prints that it
 * is assuming so).
 *
 * With no `ratio` anywhere, credit is 1 or 0 and this is exactly the boolean
 * arithmetic it generalizes.
 */
function scoreOf(cell: BundleCell, polarity: PolarityMap): { scored: number; weighted: number | null } {
  const primary = primaryPass(cell)
  if (primary === null) return { scored: 0, weighted: null }
  const taskFacts = cell.task === null ? undefined : polarity.get(cell.task)
  let scored = 0
  let weighted = 0
  let weightedSeen = false
  for (const [criterion, credit] of primary.credit) {
    const facts = taskFacts?.get(criterion)
    scored += facts?.negative === true ? 1 - credit : credit
    if (credit > 0 && facts?.weight !== undefined && facts.weight !== null) {
      weighted += facts.weight * credit
      weightedSeen = true
    }
  }
  return { scored, weighted: weightedSeen ? weighted : null }
}

/**
 * Negative criteria that HELD in the run's current attempts — the defect
 * list. A proportional negative criterion counts as a hit as soon as any of
 * it holds (credit > 0): one occurrence of the defect is an observation, and
 * the table prints the proportion beside it.
 */
function negativeHitsOf(cells: readonly BundleCell[], polarity: PolarityMap): NegativeHit[] {
  const hits: NegativeHit[] = []
  for (const cell of cells) {
    if (!cell.isCurrent) continue
    const primary = primaryPass(cell)
    if (primary === null) continue
    const taskFacts = cell.task === null ? undefined : polarity.get(cell.task)
    if (taskFacts === undefined) continue
    for (const [criterion, credit] of primary.credit) {
      const facts = taskFacts.get(criterion)
      if (facts === undefined || !facts.negative || credit <= 0) continue
      const verdict = primary.source.get(criterion)
      const doc = verdict?.doc ?? {}
      hits.push({
        task: cell.task,
        condition: cell.condition,
        rep: cell.rep,
        attempt: cell.attempt,
        criterion,
        // The layer THIS criterion scored from — after the per-criterion
        // merge a cell no longer has one namespace to name.
        ns: primary.ns.get(criterion) ?? '',
        weight: facts.weight,
        ratio: verdict?.ratio ?? null,
        evidence: typeof doc['evidence'] === 'string' ? doc['evidence'] : '',
        by: typeof doc['by'] === 'string' ? doc['by'] : '',
      })
    }
  }
  return hits.sort((a, b) =>
    (a.task ?? '').localeCompare(b.task ?? '') || (a.condition ?? '').localeCompare(b.condition ?? '')
    || (a.rep ?? 0) - (b.rep ?? 0) || a.criterion.localeCompare(b.criterion))
}

// --- the 判据 × 对比组 table --------------------------------------------------

/** One verdict, projected for the criteria table's expansion. */
function sampleOf(cell: BundleCell, verdict: CellVerdict): CriterionSample {
  return {
    missionId: cell.missionId,
    rep: cell.rep,
    ns: verdict.ns,
    pass: verdict.pass,
    ratio: verdict.ratio,
    evidence: typeof verdict.doc['evidence'] === 'string' ? verdict.doc['evidence'] : '',
    by: typeof verdict.doc['by'] === 'string' ? verdict.doc['by'] : '',
    judge: verdict.judge,
  }
}

/**
 * Build one task's criteria table over the run's CURRENT attempts.
 *
 * Reads through {@link primaryPass} and {@link scoreOf} and computes nothing
 * of its own: the per-criterion conclusion is the merge's, and the bottom row
 * is `scoreOf`'s mean over the same cells. A table that re-derived either
 * would be a second opinion a reader could not tell from the first — the same
 * rule that keeps `report-view` a projection.
 *
 * The rep scope is every current cell the group ran for the task, not the
 * rep-matched subset a PAIR is computed over. With the usual full matrix the
 * two are the same set and the bottom row equals the pair table's mean; with a
 * ragged one they are not, and the per-group `reps` count is printed so the
 * difference is visible rather than silent.
 */
function criteriaTableOf(task: string, cells: readonly BundleCell[], polarity: PolarityMap): TaskCriteriaTable {
  // The SAME cell set `comparePair` compares over, including its
  // configuration filter: a round whose reasoning effort was read back as
  // something else did not run under the condition it is filed as, so it is
  // absent here rather than present as a column of blanks with a 0 under it.
  // A zero is a score; «not attributable» is not.
  //
  // Today that filter is belt and braces on both functions — `checkSubject`
  // flags any mismatch, so the gate shuts before either table is built. It is
  // kept in step with `comparePair` on purpose: if the subject check is ever
  // softened, the two tables must not start disagreeing about whether an
  // unattributable cell scores.
  const taskCells = cells.filter(cell => cell.isCurrent && cell.task === task && !configurationMismatch(cell))
  const conditions = [...new Set(taskCells.map(c => c.condition).filter((c): c is string => c !== null))].sort()
  const taskFacts = polarity.get(task)

  // criterion → condition → the reps that judged it, with the layer each
  // scored from. One pass over the cells; `primaryPass` is the only judge of
  // which layer won.
  const seen = new Map<string, Map<string, CriterionGroupResult>>()
  const declaredOrder = new Map<string, number>()
  for (const cell of taskCells) {
    if (cell.condition === null) continue
    const primary = primaryPass(cell)
    if (primary === null) continue
    for (const [criterion, credit] of primary.credit) {
      let perCondition = seen.get(criterion)
      if (perCondition === undefined) {
        perCondition = new Map()
        seen.set(criterion, perCondition)
      }
      let group = perCondition.get(cell.condition)
      if (group === undefined) {
        group = {
          condition: cell.condition,
          reps: 0, heldReps: 0, credit: null, holds: null, proportional: false,
          sources: {}, samples: [], superseded: [],
        }
        perCondition.set(cell.condition, group)
      }
      const layer = primary.ns.get(criterion) as string
      const samples = primary.samples.get(criterion) ?? []
      group.reps += 1
      if (primary.holds.get(criterion) === true) group.heldReps += 1
      group.credit = (group.credit ?? 0) + credit
      group.sources[layer] = (group.sources[layer] ?? 0) + 1
      if (samples.some(sample => sample.ratio !== null)) group.proportional = true
      group.samples.push(...samples.map(sample => sampleOf(cell, sample)))
      group.superseded.push(...(primary.superseded.get(criterion) ?? []).map(sample => sampleOf(cell, sample)))
    }
  }
  // The running sum becomes the mean, and the group's own verdict its majority.
  for (const perCondition of seen.values()) {
    for (const group of perCondition.values()) {
      if (group.reps === 0) continue
      group.credit = (group.credit ?? 0) / group.reps
      group.holds = group.heldReps > group.reps / 2
    }
  }

  for (const [criterion, facts] of taskFacts ?? []) declaredOrder.set(criterion, facts.order)
  const criteria: CriterionFactsRow[] = [...seen.keys()]
    .sort((a, b) => {
      const oa = declaredOrder.get(a)
      const ob = declaredOrder.get(b)
      // Declared criteria in RUBRIC order; ones only the verdicts know about
      // are appended, alphabetically, and marked — inventing a position for
      // them among the rubric's own would misreport the rubric.
      if (oa !== undefined && ob !== undefined) return oa - ob
      if (oa !== undefined) return -1
      if (ob !== undefined) return 1
      return a.localeCompare(b)
    })
    .map((id) => {
      const facts = taskFacts?.get(id)
      return {
        id,
        axis: facts?.axis ?? null,
        kind: facts?.kind ?? null,
        weight: facts?.weight ?? null,
        negative: facts?.negative ?? false,
        undeclared: facts === undefined,
      }
    })

  const totals = conditions.map((condition) => {
    const groupCells = taskCells.filter(cell => cell.condition === condition)
    const scores = groupCells.map(cell => scoreOf(cell, polarity))
    const weights = scores.map(score => score.weighted)
    return {
      condition,
      scored: scores.length === 0 ? null : mean(scores.map(score => score.scored)),
      // A group whose cells do not ALL carry a weighted score has no mean
      // worth printing: averaging over the cells that happen to have one
      // would silently change the denominator.
      weighted: weights.length > 0 && weights.every((w): w is number => w !== null) ? mean(weights) : null,
      reps: groupCells.length,
    }
  })

  return {
    task,
    criteria,
    conditions,
    rows: criteria.map(row => ({
      criterion: row.id,
      cells: conditions.map(condition => seen.get(row.id)?.get(condition) ?? {
        condition,
        reps: 0, heldReps: 0, credit: null, holds: null, proportional: false,
        sources: {}, samples: [], superseded: [],
      }),
    })),
    totals,
  }
}

/** Every task's criteria table, task-sorted. A task with nothing attributable ships none. */
function criteriaTablesOf(cells: readonly BundleCell[], polarity: PolarityMap): TaskCriteriaTable[] {
  const tasks = [...new Set(cells
    .filter(c => c.isCurrent && !configurationMismatch(c))
    .map(c => c.task)
    .filter((t): t is string => t !== null))].sort()
  return tasks.map(task => criteriaTableOf(task, cells, polarity))
}

/** The layers that count as 「已判」: a judge's draft and a human's final are the same KIND of source. */
const JUDGED_NS = new Set(['human-final', 'llm-draft'])

/**
 * 判定覆盖一致 for one pair: over the SAME rep-matched cells `comparePair`
 * compares, every criterion must be judged (judge or human) on both sides or
 * on neither. A criterion one side scored from a judge and the other from a
 * script alone is two different instruments subtracted from each other — the
 * pilot-d `Δ = 4, CI [4, 4]` was exactly that, with nothing on the page
 * saying so.
 *
 * A human re-judging one criterion does NOT trip this: human-final and
 * llm-draft are both 「已判」, so the kinds still match.
 */
function coverageGapsOf(a: string, b: string, cells: readonly BundleCell[]): CoverageGap[] {
  const current = cells.filter(c => c.isCurrent && !configurationMismatch(c))
  const gaps: CoverageGap[] = []
  const tasks = [...new Set(current.map(c => c.task).filter((t): t is string => t !== null))].sort()
  for (const task of tasks) {
    const side = (condition: string): Map<number, BundleCell> => new Map(current
      .filter(cell => cell.task === task && cell.condition === condition)
      .map(cell => [cell.rep ?? -1, cell]))
    const repsA = side(a)
    const repsB = side(b)
    for (const rep of [...repsA.keys()].filter(r => repsB.has(r)).sort((x, y) => x - y)) {
      const cellA = repsA.get(rep) as BundleCell
      const cellB = repsB.get(rep) as BundleCell
      const nsA = primaryPass(cellA)?.ns ?? new Map<string, string>()
      const nsB = primaryPass(cellB)?.ns ?? new Map<string, string>()
      const judged = (ns: Map<string, string>, criterion: string): boolean => JUDGED_NS.has(ns.get(criterion) ?? '')
      const missingOn = new Map<string, string[]>([[a, []], [b, []]])
      for (const criterion of [...new Set([...nsA.keys(), ...nsB.keys()])].sort()) {
        const onA = judged(nsA, criterion)
        const onB = judged(nsB, criterion)
        if (onA && !onB) missingOn.get(b)?.push(criterion)
        if (onB && !onA) missingOn.get(a)?.push(criterion)
      }
      for (const [condition, criteria] of missingOn) {
        if (criteria.length === 0) continue
        const cell = condition === a ? cellA : cellB
        const ns = condition === a ? nsA : nsB
        const judgeAbsent = cell.judgeFailures.length > 0 && !cell.verdicts.some(v => v.ns === 'llm-draft')
        gaps.push({
          task,
          rep,
          condition,
          criteria,
          why: judgeAbsent ? '判官缺席' : criteria.every(c => ns.get(c) === 'script') ? '仅脚本' : '无判定',
          failures: judgeAbsent ? [...cell.judgeFailures] : [],
        })
      }
    }
  }
  return gaps
}

/** 「<题> 的 <判据…> 在 <组> 没有判官 / 人的判定（<why>）」, one clause per task × side. */
function coverageReasonOf(gaps: readonly CoverageGap[]): string {
  const grouped = new Map<string, { task: string; condition: string; criteria: Set<string>; why: Set<string> }>()
  for (const gap of gaps) {
    const key = `${gap.task}\u0000${gap.condition}`
    let entry = grouped.get(key)
    if (entry === undefined) {
      entry = { task: gap.task, condition: gap.condition, criteria: new Set(), why: new Set() }
      grouped.set(key, entry)
    }
    for (const criterion of gap.criteria) entry.criteria.add(criterion)
    entry.why.add(gap.why)
  }
  return [...grouped.values()]
    .map(entry => `${entry.task} 的 ${[...entry.criteria].join('、')} 在 ${entry.condition} 没有判官 / 人的判定（${[...entry.why].join(' / ')}）`)
    .join('；')
}

/** One judge failure, shortened for a detail line — the full text is in the bundle. */
function failureText(failure: JudgeFailure): string {
  return failure.error.length > 160 ? `${failure.error.slice(0, 160)}…` : failure.error
}

/**
 * The fifth validity check. Unlike the other four it does not close the
 * comparison section: coverage is a property of ONE pair, so a gap degrades
 * that pair to description (no CI, no rank) and leaves every other pair — and
 * the criteria tables — as they are. Its status is the conjunction over all
 * pairs, so the check list still shows ⚠ when any one pair was degraded.
 */
function checkVerdictCoverage(factors: readonly FactorPair[], cells: readonly BundleCell[]): InvariantCheck {
  const title = '判定覆盖一致（每条判据在比较的两格里都有判官 / 人的判定，或都没有）'
  if (factors.length === 0) {
    return { id: 'verdict-coverage', title, status: 'ok', details: ['单对比组——没有需要核对的配对'] }
  }
  const details: string[] = []
  let violated = false
  for (const factor of factors) {
    const gaps = coverageGapsOf(factor.a, factor.b, cells)
    if (gaps.length === 0) {
      details.push(`${factor.a} vs ${factor.b}：各配对格逐判据的判定来源同类`)
      continue
    }
    violated = true
    for (const gap of gaps) {
      const absent = gap.why === '判官缺席'
        ? `判官缺席（判官调用 ${gap.failures.length} 次均失败：${[...new Set(gap.failures.map(failureText))].join(' / ')}）`
        : gap.why
      details.push(`${factor.a} vs ${factor.b}：${gap.task} 第 ${gap.rep} 次的 ${gap.criteria.join('、')} 在 ${gap.condition} 没有判官 / 人的判定——${absent}；这一对只做描述，不给区间与名次`)
    }
  }
  return { id: 'verdict-coverage', title, status: violated ? 'violated' : 'ok', details }
}

function comparePair(
  a: string,
  b: string,
  factor: FactorPair,
  cells: BundleCell[],
  polarity: PolarityMap,
  runId: string,
): PairComparison {
  const current = cells.filter(c => c.isCurrent && !configurationMismatch(c))
  const tasks = [...new Set(current.map(c => c.task).filter((t): t is string => t !== null))].sort()
  const perTask: PairTaskDelta[] = []
  const allDeltas: number[] = []
  const bootstrapBlocks: number[][] = []
  for (const task of tasks) {
    const repsA = new Map<number, BundleCell>()
    const repsB = new Map<number, BundleCell>()
    for (const cell of current) {
      if (cell.task !== task) continue
      if (cell.condition === a) repsA.set(cell.rep ?? -1, cell)
      if (cell.condition === b) repsB.set(cell.rep ?? -1, cell)
    }
    const shared = [...repsA.keys()].filter(rep => repsB.has(rep)).sort((x, y) => x - y)
    if (shared.length === 0) continue
    const deltas: number[] = []
    const aScored: number[] = []
    const bScored: number[] = []
    let aWeightedSum = 0
    let bWeightedSum = 0
    let weightedSeen = false
    for (const rep of shared) {
      const pa = scoreOf(repsA.get(rep) as BundleCell, polarity)
      const pb = scoreOf(repsB.get(rep) as BundleCell, polarity)
      deltas.push(pa.scored - pb.scored)
      aScored.push(pa.scored)
      bScored.push(pb.scored)
      if (pa.weighted !== null && pb.weighted !== null) {
        aWeightedSum += pa.weighted
        bWeightedSum += pb.weighted
        weightedSeen = true
      }
    }
    perTask.push({
      task,
      aMean: mean(aScored),
      bMean: mean(bScored),
      aWeighted: weightedSeen ? aWeightedSum / shared.length : null,
      bWeighted: weightedSeen ? bWeightedSum / shared.length : null,
      deltas,
      n: shared.length,
    })
    bootstrapBlocks.push(deltas)
    allDeltas.push(...deltas)
  }
  const n = perTask.length === 0 ? 0 : Math.min(...perTask.map(t => t.n))
  const coverageGaps = coverageGapsOf(a, b, cells)
  // The CI's resampling unit is the rep INSIDE a task, but what it bounds is
  // the mean over tasks: with one or two tasks there is nothing to bound, and
  // [4, 4] off one task reads as a certainty it is not. So the CI gate counts
  // TASKS, and the rank gate (n, reps per task) stays where it was — a CI can
  // be shown without being enough to rank on.
  const tasksWithDelta = bootstrapBlocks.filter(deltas => deltas.length > 0).length
  const seed = fnv1a(`${runId}:${a}:${b}:eval-report-bootstrap`)
  const ci = coverageGaps.length === 0 && tasksWithDelta >= 3 ? bootstrapMeanCi(bootstrapBlocks, { seed }) : null
  const ciWithheld = coverageGaps.length === 0 && tasksWithDelta > 0 && tasksWithDelta < 3 ? { tasksWithDelta } : null
  const ciAdvisory = ci !== null && n < 3
  let rank: 'a' | 'b' | null = null
  let rankReason: string
  if (coverageGaps.length > 0) {
    rankReason = `判定覆盖不一致：${coverageReasonOf(coverageGaps)}`
  } else if (n < 3) {
    rankReason = `不可排名（n=${n} < 3）`
  } else if (factor.known && factor.multi !== null) {
    rankReason = `不可排名（多因子: ${factor.multi.join(' / ')}——只做描述统计）`
  } else if (!factor.known) {
    rankReason = '不可排名（因子未知——条件文档未记录，无法证明单因子）'
  } else if (ciWithheld !== null) {
    rankReason = `不可排名（只有 ${ciWithheld.tasksWithDelta} 道题有差值，给不出区间）`
  } else if (ci === null) {
    rankReason = '不可排名（无配对数据）'
  } else if (ci.lo > 0) {
    rank = 'a'
    rankReason = `${a} 高于 ${b}（95% CI [${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}] 不含 0）`
  } else if (ci.hi < 0) {
    rank = 'b'
    rankReason = `${b} 高于 ${a}（95% CI [${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}] 不含 0）`
  } else {
    rankReason = `不可排名（95% CI [${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}] 含 0）`
  }
  return { a, b, factor, perTask, n, ci, ciWithheld, ciAdvisory, coverageGaps, rank, rankReason }
}

// --- judge consistency -------------------------------------------------------

/**
 * The slice of a cell the consistency numbers are computed over. Narrower
 * than {@link BundleCell} on purpose: the JUDGE BENCH (I5·T37) computes the
 * same numbers off the live mission ledger rather than off an exported
 * bundle, and a second implementation of κ would be a second opinion a reader
 * could not tell from the first. A bundle cell satisfies this structurally.
 */
export interface JudgeConsistencyCell {
  missionId: string
  /** Only the current attempt counts — a superseded attempt is not a second rater. */
  isCurrent: boolean
  verdicts: ReadonlyArray<{
    ns: string
    criterion: string
    pass: boolean
    judge: VerdictJudge | null
    createdAt: number
    seq: number
  }>
}

/**
 * Judge consistency for a set of cells: one judge sampled twice (κ), the
 * panel across judges, and llm-draft against human-final.
 * @param cells - the cells to count over; non-current attempts are ignored.
 * @returns the numbers plus the report's own sentences, verbatim.
 */
export function judgeConsistencyOf(cells: readonly JudgeConsistencyCell[]): JudgeConsistency {
  const current = cells.filter(c => c.isCurrent)
  const details: string[] = []
  // (cell, criterion) → sample pass values in annotation order. With a PANEL
  // the repeated-sample number has to stay per judge: two judges answering
  // once each is a disagreement between raters, not one rater contradicting
  // itself, and averaging them into the same κ would report the panel's
  // spread as the judge's noise. A bundle that records no judge identity
  // falls back to the single bucket it always used — same numbers as before.
  const samples = new Map<string, boolean[]>()
  // (cell, criterion) → judge condition → that judge's sample values.
  const byJudge = new Map<string, Map<string, boolean[]>>()
  const human = new Map<string, boolean>()
  let selfJudgedCriteria = 0
  const selfJudgedSeen = new Set<string>()
  for (const cell of current) {
    const ordered = [...cell.verdicts].sort((x, y) => x.createdAt - y.createdAt || x.seq - y.seq)
    for (const verdict of ordered) {
      if (verdict.ns === 'human-final') {
        human.set(`${cell.missionId}|${verdict.criterion}`, verdict.pass)
      } else if (verdict.ns === 'llm-draft') {
        const cellCriterion = `${cell.missionId}|${verdict.criterion}`
        const judge = verdict.judge?.condition ?? ''
        const key = judge === '' ? cellCriterion : `${cellCriterion}|${judge}`
        if (!samples.has(key)) samples.set(key, [])
        samples.get(key)?.push(verdict.pass)
        if (judge !== '') {
          if (!byJudge.has(cellCriterion)) byJudge.set(cellCriterion, new Map())
          const perJudge = byJudge.get(cellCriterion) as Map<string, boolean[]>
          if (!perJudge.has(judge)) perJudge.set(judge, [])
          perJudge.get(judge)?.push(verdict.pass)
        }
        if (verdict.judge?.selfJudged === true && !selfJudgedSeen.has(cellCriterion)) {
          selfJudgedSeen.add(cellCriterion)
          selfJudgedCriteria += 1
        }
      }
    }
  }
  const multi = [...samples.entries()].filter(([, values]) => values.length >= 2)
  let kappa: number | null = null
  if (multi.length > 0) {
    const pairList: Array<[boolean, boolean]> = []
    const maxSamples = Math.max(...multi.map(([, values]) => values.length))
    for (let i = 0; i < maxSamples; i++) {
      for (let j = i + 1; j < maxSamples; j++) {
        for (const [, values] of multi) {
          const vi = values[i]
          const vj = values[j]
          if (vi !== undefined && vj !== undefined) pairList.push([vi, vj])
        }
      }
    }
    kappa = cohenKappa(pairList)
    const agreement = multi.filter(([, values]) => values.every(v => v === values[0])).length
    details.push(`双采样判据 ${multi.length} 条，完全一致 ${agreement} 条（${pct(agreement, multi.length)}）`)
    details.push(`Cohen κ（样本两两平均，判据为条目）: ${Number.isNaN(kappa) ? '不适用（判定恒定，期望一致率无定义）' : kappa.toFixed(3)}`)
  } else {
    details.push('llm-draft 无多采样判据——一致性不可计算')
  }
  // The human comparison is about the CRITERION, not about the cell: the
  // denominator is the criteria BOTH sides judged, and a criterion only one
  // of them touched is not a disagreement. Since the per-criterion merge
  // (T54) this is also the exact set where the two layers actually compete
  // for the score, so the number says what it looks like it says. Every
  // llm-draft value for the criterion counts, whoever wrote it.
  const llmByCriterion = new Map<string, boolean[]>()
  for (const [key, values] of samples) {
    const cellCriterion = key.split('|').slice(0, 2).join('|')
    llmByCriterion.set(cellCriterion, [...(llmByCriterion.get(cellCriterion) ?? []), ...values])
  }
  let humanAgreement: { agreed: number; total: number } | null = null
  if (human.size > 0 && llmByCriterion.size > 0) {
    let agreed = 0
    let total = 0
    for (const [key, humanPass] of human) {
      const llmValues = llmByCriterion.get(key)
      if (llmValues === undefined || llmValues.length === 0) continue
      total++
      if (llmValues.every(v => v === humanPass)) agreed++
    }
    if (total > 0) {
      humanAgreement = { agreed, total }
      const humanOnly = human.size - total
      details.push(`llm-draft 对 human-final: ${agreed}/${total} 条判据一致（${pct(agreed, total)}）`
        + '——分母只含两者都判过的判据'
        + (humanOnly > 0 ? `；另有 ${humanOnly} 条人评判据判官没判过，不进这个分母（它们按人评计分）` : ''))
    } else {
      details.push('human-final 存在，但没有任何判据同时有 llm-draft——一致率不可计算')
    }
  } else if (human.size === 0) {
    details.push('无 human-final 记录——终评一致率不可计算')
  }

  // The panel's own line (决策 9 放宽后): how often two DIFFERENT judges land
  // on the same answer. Each judge is first reduced to its own majority, so a
  // judge sampled twice counts once here and its internal spread stays in the
  // κ above.
  const crossPairs: Array<[boolean, boolean]> = []
  let crossJudged = 0
  let crossAgreed = 0
  for (const perJudge of byJudge.values()) {
    const verdictsPerJudge = [...perJudge.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([, values]) => values.filter(Boolean).length > values.length / 2)
    if (verdictsPerJudge.length < 2) continue
    crossJudged += 1
    if (verdictsPerJudge.every(value => value === verdictsPerJudge[0])) crossAgreed += 1
    for (let i = 0; i < verdictsPerJudge.length; i++) {
      for (let j = i + 1; j < verdictsPerJudge.length; j++) {
        crossPairs.push([verdictsPerJudge[i] as boolean, verdictsPerJudge[j] as boolean])
      }
    }
  }
  const crossKappa = crossPairs.length > 0 ? cohenKappa(crossPairs) : null
  const panelSize = new Set([...byJudge.values()].flatMap(perJudge => [...perJudge.keys()])).size
  if (panelSize > 1) {
    details.push(`跨判官（判官面板 ${panelSize} 位，每位先按自身多数定调）: ${crossJudged} 条判据被两位以上判官判过，`
      + `全员一致 ${crossAgreed} 条（${pct(crossAgreed, crossJudged)}）`
      + `；Cohen κ ${crossKappa === null || Number.isNaN(crossKappa) ? '不适用（判定恒定，期望一致率无定义）' : crossKappa.toFixed(3)}`)
  }
  if (selfJudgedCriteria > 0) {
    details.push(`自评判据 ${selfJudgedCriteria} 条：判官模型与该格选手模型相同（决策 9 放宽后允许并标注，不排除）`
      + '——这些判据的 llm-draft 值带自评偏好，读数时单独看，别与他评混为一谈')
  }
  return {
    multiSampled: multi.length,
    llmAgreement: multi.length > 0
      ? { agreed: multi.filter(([, values]) => values.every(v => v === values[0])).length, total: multi.length }
      : null,
    llmKappa: kappa,
    humanAgreement,
    crossJudged,
    crossAgreement: crossJudged > 0 ? { agreed: crossAgreed, total: crossJudged } : null,
    crossKappa,
    selfJudgedCriteria,
    details,
  }
}

/**
 * Who judged each cell. Built from the llm-draft envelopes, so a bundle that
 * recorded no judge identity yields an empty list and the report says so
 * rather than printing a table of blanks.
 */
function judgeAssignmentsOf(cells: BundleCell[]): JudgeAssignment[] {
  const assignments: JudgeAssignment[] = []
  for (const cell of cells.filter(c => c.isCurrent)) {
    const perJudge = new Map<string, { judge: VerdictJudge; samples: Set<number>; verdicts: number }>()
    for (const verdict of cell.verdicts) {
      if (verdict.ns !== 'llm-draft' || verdict.judge === null) continue
      const entry = perJudge.get(verdict.judge.condition)
        ?? { judge: verdict.judge, samples: new Set<number>(), verdicts: 0 }
      entry.verdicts += 1
      if (verdict.judge.sample !== null) entry.samples.add(verdict.judge.sample)
      // Self-judgement is a property of the (judge, cell) pair, so any sample
      // carrying it settles the row.
      if (verdict.judge.selfJudged) entry.judge = verdict.judge
      perJudge.set(verdict.judge.condition, entry)
    }
    if (perJudge.size === 0) continue
    assignments.push({
      missionId: cell.missionId,
      task: cell.task,
      condition: cell.condition,
      rep: cell.rep,
      judges: [...perJudge.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([condition, entry]) => ({
          condition,
          model: entry.judge.model,
          selfJudged: entry.judge.selfJudged,
          samples: entry.samples.size,
          verdicts: entry.verdicts,
        })),
    })
  }
  return assignments.sort((a, b) =>
    (a.task ?? '').localeCompare(b.task ?? '') || (a.condition ?? '').localeCompare(b.condition ?? '')
    || (a.rep ?? 0) - (b.rep ?? 0) || a.missionId.localeCompare(b.missionId))
}

function pct(part: number, total: number): string {
  if (total === 0) return '—'
  return `${Math.round((part / total) * 1000) / 10}%`
}

// --- efficiency --------------------------------------------------------------

function efficiencyOf(
  cells: BundleCell[],
  conditionEntries: Array<{ id: string; sha: string | null; doc: Record<string, unknown> | null }>,
  meta: Record<string, unknown>,
): ConditionEfficiency[] {
  const pricing = isPlainObject(meta['pricing']) ? meta['pricing'] : undefined
  const current = cells.filter(c => c.isCurrent)
  // Only cells that finished their stages carry comparable effort. The
  // condition ids still come from ALL current cells, so a condition whose
  // every cell is unfinished appears in the table with blanks rather than
  // vanishing from it.
  const completed = current.filter(c => c.state !== null && COMPLETED_STATES.has(c.state) && !configurationMismatch(c))
  const conditionIds = [...new Set(current.map(c => c.condition).filter((c): c is string => c !== null))].sort()
  const out: ConditionEfficiency[] = []
  for (const condition of conditionIds) {
    const cellsOf = completed.filter(c => c.condition === condition)
    const delegations = cellsOf.flatMap(c => c.delegations)
    const activeMs = delegations.reduce((sum, d) => sum + (d.durationMs ?? 0), 0)
    const roundsByTask: Record<string, number> = {}
    for (const cell of cellsOf) {
      if (cell.task === null) continue
      roundsByTask[cell.task] = (roundsByTask[cell.task] ?? 0) + cell.delegations.length
    }
    // mean rounds per task over that task's reps
    const repsByTask = new Map<string, number>()
    for (const cell of cellsOf) {
      if (cell.task === null) continue
      repsByTask.set(cell.task, (repsByTask.get(cell.task) ?? 0) + 1)
    }
    for (const [task, reps] of repsByTask) {
      const rounds = roundsByTask[task]
      if (reps > 1 && rounds !== undefined) roundsByTask[task] = Math.round((rounds / reps) * 100) / 100
    }
    const outputTokens = delegations.reduce((sum, d) => sum + (d.usage.outputTokens ?? 0), 0)
    const inputTokens = delegations.reduce((sum, d) => sum + (d.usage.inputTokens ?? 0), 0)
    const cacheRead = delegations.reduce((sum, d) => sum + (d.usage.cacheReadTokens ?? 0), 0)
    const anyCacheRead = delegations.some(d => d.usage.cacheReadTokens !== null)
    const observed = delegations.map(d => d.modelObserved).find((m): m is string => m !== null) ?? null
    const declaredFromDoc = conditionEntries.find(e => e.id === condition)?.doc
    const declaredModel = declaredFromDoc && isPlainObject(declaredFromDoc['model']) ? str(declaredFromDoc['model']['declared']) : null
    const declaredFromDelegation = delegations.map(d => d.modelDeclared).find((m): m is string => m !== null) ?? null
    const priceDirect = pricing === undefined ? null : num(pricing[condition])
    const priceModel = pricing === undefined ? null : num(pricing[observed ?? declaredModel ?? ''])
    out.push({
      condition,
      model: observed ?? declaredFromDelegation ?? declaredModel,
      activeMs: delegations.length > 0 ? activeMs : null,
      rounds: delegations.length > 0 ? delegations.length : null,
      roundsByTask,
      outputTokens: delegations.some(d => d.usage.outputTokens !== null) ? outputTokens : null,
      inputTokens: delegations.some(d => d.usage.inputTokens !== null) ? inputTokens : null,
      cacheReadTokens: anyCacheRead ? cacheRead : null,
      toolCalls: sumToolCalls(delegations.map(d => d.toolCalls))?.count ?? null,
      price: priceDirect ?? priceModel,
    })
  }
  return out
}

/**
 * The current-attempt cells the efficiency table left out: not in a completed
 * state, so their delegation time buys an unknown fraction of the work.
 * @param cells - every cell of the bundle.
 * @returns one row per (condition, state), condition-then-state sorted.
 */
/**
 * The per-round ledger `report/usage.jsonl` is written from: one row per
 * delegation round of every cell, in bundle order, each marked with whether
 * the efficiency table counts it (T23's rule — current attempt, finished
 * stages). Nothing is aggregated here and nothing is priced: this is the
 * ledger both the table and any outside pricing step read.
 * @param cells - every cell in the bundle, current and retried alike.
 * @param runId - the run this bundle belongs to, when its meta names one.
 * @returns one row per delegation round.
 */
function usageRowsOf(cells: readonly BundleCell[], runId: string | null): UsageRow[] {
  const out: UsageRow[] = []
  for (const cell of cells) {
    const counted = cell.isCurrent && cell.state !== null && COMPLETED_STATES.has(cell.state) && !configurationMismatch(cell)
    for (const delegation of cell.delegations) {
      const usage: { outputTokens?: number; inputTokens?: number; cacheReadTokens?: number } = {
        ...delegation.usage.outputTokens === null ? {} : { outputTokens: delegation.usage.outputTokens },
        ...delegation.usage.inputTokens === null ? {} : { inputTokens: delegation.usage.inputTokens },
        ...delegation.usage.cacheReadTokens === null ? {} : { cacheReadTokens: delegation.usage.cacheReadTokens },
      }
      out.push({
        run: runId,
        cell: cell.missionId,
        attempt: cell.attempt,
        condition: cell.condition,
        task: cell.task,
        stage: delegation.stage,
        round: delegation.round,
        counted,
        ...delegation.reasoning === undefined ? {} : { reasoning: delegation.reasoning },        ...delegation.modelObserved === null ? {} : { observedModel: delegation.modelObserved },
        ...delegation.cliVersion === null ? {} : { cliVersion: delegation.cliVersion },
        ...delegation.durationMs === null ? {} : { durationMs: delegation.durationMs },
        ...Object.keys(usage).length === 0 ? {} : { usage },
        ...delegation.toolCalls === null ? {} : { toolCalls: delegation.toolCalls },
      })
    }
  }
  return out
}

function excludedCellsOf(cells: BundleCell[]): ExcludedCells[] {
  const counts = new Map<string, ExcludedCells>()
  for (const cell of cells) {
    if (!cell.isCurrent) continue
    if (cell.state !== null && COMPLETED_STATES.has(cell.state) && !configurationMismatch(cell)) continue
    const condition = cell.condition ?? '(未知条件)'
    const state = configurationMismatch(cell) ? 'configuration-mismatch' : cell.state ?? '(未知状态)'
    const key = `${condition}\u0000${state}`
    const existing = counts.get(key)
    if (existing === undefined) counts.set(key, { condition, state, count: 1 })
    else existing.count += 1
  }
  return [...counts.values()].sort((a, b) => (a.condition < b.condition ? -1 : a.condition > b.condition ? 1 : a.state < b.state ? -1 : 1))
}

// --- assembly ----------------------------------------------------------------

/**
 * Per-ns writer origins across the run's current attempts: the manifest's
 * nsReport when it carries writtenBy (exports after the field shipped),
 * otherwise recomputed from the annotations with the same prefix rule
 * (`by` up to and including the first `:`).
 */
function writtenByOf(manifest: Record<string, unknown> | null, cells: BundleCell[]): Record<string, string[]> {
  const union: Record<string, Set<string>> = {}
  const add = (ns: string, origin: string): void => {
    if (union[ns] === undefined) union[ns] = new Set()
    union[ns].add(origin)
  }
  const nsReport = manifest !== null && Array.isArray(manifest['nsReport']) ? manifest['nsReport'] : null
  let manifestCarriedWriters = false
  if (nsReport !== null) {
    for (const entry of nsReport) {
      if (!isPlainObject(entry) || !isPlainObject(entry['writtenBy'])) continue
      for (const [ns, origins] of Object.entries(entry['writtenBy'])) {
        if (!Array.isArray(origins)) continue
        for (const origin of origins) {
          if (typeof origin === 'string' && origin.length > 0) {
            manifestCarriedWriters = true
            add(ns, origin)
          }
        }
      }
    }
  }
  if (!manifestCarriedWriters) {
    for (const cell of cells.filter(c => c.isCurrent)) {
      for (const [ns, origins] of cell.writers) for (const origin of origins) add(ns, origin)
    }
  }
  return Object.fromEntries(Object.entries(union).map(([ns, set]) => [ns, [...set].sort()]))
}

/**
 * expectedNs namespaces whose verdicts were ALL written by `tool:` origins —
 * the report's top red flag (a tool wrote the final word on a source the
 * flow reserves for a different author).
 */
function toolOnlyNsOf(expectedNs: readonly string[] | null, writtenBy: Record<string, string[]>): string[] {
  if (expectedNs === null) return []
  return expectedNs.filter((ns) => {
    const origins = writtenBy[ns]
    return origins !== undefined && origins.length > 0 && origins.every(o => o.startsWith('tool:'))
  })
}

/**
 * Analyze a bundle directory. Throws only when the directory is not a bundle
 * (run.json missing); every data-level gap degrades into the report.
 */
export async function analyzeBundle(bundleDir: string): Promise<EvalReport> {
  const runLoaded = await readJsonFile(join(bundleDir, 'run.json'))
  if (!runLoaded.ok || !isPlainObject(runLoaded.value)) {
    throw new Error(`not a mission export bundle (no readable run.json): ${bundleDir}`)
  }
  const run = runLoaded.value
  const runId = str(run['id'])
  const meta = isPlainObject(run['meta']) ? run['meta'] : {}
  const manifestLoaded = await readJsonFile(join(bundleDir, 'manifest.json'))
  const manifest = manifestLoaded.ok && isPlainObject(manifestLoaded.value) ? manifestLoaded.value : null

  const conditionEntries = conditionEntriesOf(meta)
  const cells = await readCells(bundleDir, conditionEntries.map(e => e.id))
  const expectedNs = Array.isArray(meta['expectedNs'])
    ? meta['expectedNs'].filter((ns): ns is string => typeof ns === 'string' && ns.length > 0)
    : null
  const metaStages = Array.isArray(meta['stages'])
    ? meta['stages'].filter((stage): stage is string => typeof stage === 'string' && stage.length > 0)
    : null
  const { map: polarityMap, polarity, outOfScope } = await readPolarity(bundleDir, metaStages)
  const weightsAvailable = polarity.weighted
  // Out-of-scope criteria are neither scored nor counted (T84): a verdict a
  // probe or judge wrote on one anyway — a stage this run never executed —
  // leaves the cell before any table, score or merge reads it.
  let droppedVerdicts = 0
  if (outOfScope.size > 0) {
    for (const cell of cells) {
      if (cell.task === null) continue
      const task = cell.task
      const kept = cell.verdicts.filter(verdict => !outOfScope.has(scopeKey(task, verdict.criterion)))
      droppedVerdicts += cell.verdicts.length - kept.length
      cell.verdicts = kept
    }
  }

  const rows: ReportRow[] = []
  for (const cell of cells) {
    // One accounting per CELL, repeated on its verdict rows: the rounds are
    // the cell's, and a verdict has no round of its own to attribute to.
    const cellToolCalls = sumToolCalls(cell.delegations.map(d => d.toolCalls))
    // The same merge the score is computed from, read once per cell.
    const cellSources = primaryPass(cell)?.sources ?? null
    for (const verdict of cell.verdicts) {
      const facts = cell.task === null ? undefined : polarityMap.get(cell.task)?.get(verdict.criterion)
      const weight = facts?.weight ?? undefined
      rows.push({
        task: cell.task ?? (typeof verdict.doc['task'] === 'string' ? verdict.doc['task'] : null),
        condition: cell.condition,
        conditionSha: cell.anchor?.conditionSha ?? (cell.condition === null ? null : conditionEntries.find(e => e.id === cell.condition)?.sha ?? null),
        rep: cell.rep,
        attempt: cell.attempt,
        stage: verdict.stage,
        ns: verdict.ns,
        criterion: verdict.criterion,
        pass: verdict.pass,
        ...(verdict.ratio !== null ? { ratio: verdict.ratio } : {}),
        ...(weight !== undefined ? { weight } : {}),
        ...(facts !== undefined ? { negative: facts.negative } : {}),
        ...(cellToolCalls !== null ? { toolCalls: cellToolCalls } : {}),
        ...(verdict.judge !== null ? { judge: verdict.judge } : {}),
        ...(cellSources !== null ? { sources: cellSources } : {}),
        evidence: typeof verdict.doc['evidence'] === 'string' ? verdict.doc['evidence'] : '',
        by: typeof verdict.doc['by'] === 'string' ? verdict.doc['by'] : '',
      })
    }
  }
  rows.sort((a, b) =>
    (a.condition ?? '').localeCompare(b.condition ?? '') || (a.task ?? '').localeCompare(b.task ?? '')
    || (a.rep ?? 0) - (b.rep ?? 0) || a.attempt - b.attempt || a.ns.localeCompare(b.ns) || a.criterion.localeCompare(b.criterion))

  const invariants = [
    checkMaterialization(cells),
    checkFingerprint(cells),
    checkSubject(cells, conditionEntries),
    checkProcedure(meta),
  ]
  // The section gate is the first four only. The fifth check degrades single
  // pairs inside the section (see `comparePair`) and is appended after the
  // gate is decided, so it can never close what the four opened.
  const comparisonAllowed = invariants.every(i => i.status === 'ok')

  const current = cells.filter(c => c.isCurrent)
  const seenConditions = [...new Set([
    ...conditionEntries.map(e => e.id),
    ...current.map(c => c.condition).filter((c): c is string => c !== null),
  ])].sort()
  const singleCondition = seenConditions.length <= 1

  const factors = factorPairs(conditionEntries)
  invariants.push(checkVerdictCoverage(factors, cells))
  const comparisons: PairComparison[] = []
  if (comparisonAllowed && !singleCondition) {
    for (const factor of factors) {
      comparisons.push(comparePair(factor.a, factor.b, factor, cells, polarityMap, runId ?? bundleDir))
    }
  }

  const judge = judgeConsistencyOf(cells)
  const judgeAssignments = judgeAssignmentsOf(cells)
  const efficiency = efficiencyOf(cells, conditionEntries, meta)
  const efficiencyExcluded = excludedCellsOf(cells)
  const usageRows = usageRowsOf(cells, runId)

  const tasksCompletedBy: Record<string, string[]> = {}
  for (const condition of seenConditions) {
    const tasks = [...new Set(current
      .filter(c => c.condition === condition)
      .map(c => c.task)
      .filter((t): t is string => t !== null))]
    tasksCompletedBy[condition] = tasks.filter((task) => {
      const taskCells = current.filter(c => c.condition === condition && c.task === task)
      return taskCells.length > 0 && taskCells.every(c => c.state !== null && COMPLETED_STATES.has(c.state))
    }).sort()
  }

  const nsCounts: Record<string, number> = {}
  for (const row of rows) nsCounts[row.ns] = (nsCounts[row.ns] ?? 0) + 1

  const writtenBy = writtenByOf(manifest, cells)

  const negativeHits = negativeHitsOf(cells, polarityMap)
  // Behind the SAME gate as `comparisons`: a bundle whose invariants did not
  // all hold ships no per-criterion table either, so a closed comparison
  // cannot be reopened one criterion at a time. A single-group run DOES get
  // one — 判官依据 is not a comparison.
  const criteriaTables = comparisonAllowed ? criteriaTablesOf(cells, polarityMap) : []

  const notes: string[] = []
  if (manifest === null) notes.push('bundle 缺 manifest.json——nsReport/writtenBy 由注解回算')
  if (polarity.available) {
    notes.push(`判据极性取自 \`${polarity.origin}\`（${polarity.criteria} 条判据，其中负向 ${polarity.negative} 条）`
      + '——pass 恒为「判据成立」，负向判据成立即缺陷存在，计 0 分')
  } else {
    notes.push(`bundle 未带判据权重表（\`${RUBRIC_WEIGHTS_PATH}\`），dataset 层也无 rubric——`
      + '**极性未知，计数按正向处理**；负向判据数 unknown，加权分留空')
  }
  if (polarity.available && !weightsAvailable) notes.push('权重表有极性但无 weight——加权分留空，只出得分判据数')
  if (polarity.planStages !== null && polarity.planStages !== undefined) {
    if (outOfScope.size > 0) {
      notes.push(`本次只跑 ${polarity.planStages.join('、')}：${outOfScope.size} 条判据属于其他阶段，不计分、不计入满分`
        + (droppedVerdicts > 0 ? `（其上 ${droppedVerdicts} 条判定已剔除）` : ''))
    }
  } else if (polarity.available) {
    notes.push('bundle 未记录本次阶段范围（旧 run）——按全部判据计分')
  }
  const ratioRows = rows.filter(row => row.ratio !== undefined).length
  if (ratioRows > 0) {
    notes.push(`${ratioRows} 条判定带 \`ratio\`（按比例给分，协议 §6.5）——按 passed/total 计分，不按布尔；同判据多样本取所给比例的均值`)
  }
  const malformedRatios = cells.reduce((sum, cell) => sum + cell.verdicts.filter(v => v.ratioMalformed).length, 0)
  if (malformedRatios > 0) {
    notes.push(`⚠️ ${malformedRatios} 条判定的 \`ratio\` 越界或形状不对（total ≤ 0、passed 越界、非整数）——已按缺失处理退回布尔，未计入任何分数`)
  }
  notes.push('行 stage 取自注解记录的 stage 字段；判定契约本身不含 stage，未记录时为 null')

  return {
    bundleDir,
    runId,
    expectedNs,
    rows,
    invariants,
    comparisonAllowed,
    conditions: seenConditions.map(id => ({
      id,
      sha: conditionEntries.find(e => e.id === id)?.sha ?? null,
      model: efficiency.find(e => e.condition === id)?.model ?? null,
    })),
    factors,
    comparisons,
    singleCondition,
    judge,
    judgeAssignments,
    efficiency,
    usageRows,
    efficiencyExcluded,
    tasksCompletedBy,
    toolOnlyNs: toolOnlyNsOf(expectedNs, writtenBy),
    nsCounts,
    missions: new Set(cells.map(c => c.missionId)).size,
    attempts: cells.length,
    retries: cells.filter(c => !c.isCurrent).length,
    weightsAvailable,
    polarity,
    negativeHits,
    criteriaTables,
    notes,
  }
}

// --- output ------------------------------------------------------------------

/**
 * Build the report for a bundle and write `results.jsonl`, `usage.jsonl` and
 * `summary.md`.
 * The out directory defaults to `<bundleDir>/report` and those two files are
 * overwritten on re-run: a report is derived state, unlike the append-only
 * bundle itself. `report/rubric-weights.json` is NOT touched — the export
 * writes it, the report only reads it.
 */
export async function writeEvalReport(bundleDir: string, options: { out?: string } = {}): Promise<ReportWrite> {
  const report = await analyzeBundle(bundleDir)
  const outDir = options.out ?? join(bundleDir, 'report')
  await mkdir(outDir, { recursive: true })
  const resultsPath = join(outDir, 'results.jsonl')
  const summaryPath = join(outDir, 'summary.md')
  const usagePath = join(outDir, 'usage.jsonl')
  const lines = report.rows.map(row => JSON.stringify(row))
  await writeFile(resultsPath, lines.length === 0 ? '' : `${lines.join('\n')}\n`)
  // The per-round ledger is written even when it is empty: an empty file says
  // "no delegation round was recorded", while a missing one cannot be told
  // apart from an export that predates the ledger.
  const usageLines = report.usageRows.map(row => JSON.stringify(row))
  await writeFile(usagePath, usageLines.length === 0 ? '' : `${usageLines.join('\n')}\n`)
  await writeFile(summaryPath, renderSummaryMd(report), 'utf8')
  return {
    bundleDir,
    outDir,
    resultsPath,
    summaryPath,
    usagePath,
    rowCount: report.rows.length,
    usageRowCount: report.usageRows.length,
    report,
  }
}
