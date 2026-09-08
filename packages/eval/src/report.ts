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
 *   tables — no comparison, no ranking.
 * - Factors are derived, never declared: condition documents recorded in
 *   run.meta are diffed pairwise; exactly one differing field names the
 *   factor, several fields degrade to 多因子 (descriptive only). Documents
 *   not recorded → the pair is marked unknown.
 * - Paired comparison blocks on tasks, resamples reps (never tasks) for the
 *   bootstrap CI, and refuses to rank when n < 3.
 * - Efficiency metrics stay parallel (never summed into one score); tokens
 *   compare only within the same model.
 * - Attempts are infrastructure retries (frozen decision 1): every attempt's
 *   verdicts appear as rows, but aggregation uses the current attempt only.
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

// --- public shapes -----------------------------------------------------------

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
  pass: boolean
  weight?: number
  evidence: string
  by: string
}

/** One of the four architecture-§5 invariants, with the facts behind it. */
export interface InvariantCheck {
  id: 'materialization' | 'fingerprint' | 'subject' | 'procedure'
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
  /** Mean passed-criterion count (and weighted score) per side. */
  aMean: number
  bMean: number
  aWeighted: number | null
  bWeighted: number | null
  /** Per-rep deltas (rep-matched); the resampling unit. */
  deltas: number[]
  /** Rep pairs available for this task. */
  n: number
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
  /** Set only when the rank gate passes: which side the CI favors. */
  rank: 'a' | 'b' | null
  rankReason: string
}

/** Judge (llm-draft) consistency numbers for the whole run. */
export interface JudgeConsistency {
  /** Criteria (per cell) with ≥2 llm-draft samples. */
  multiSampled: number
  llmAgreement: { agreed: number; total: number } | null
  /** Cohen κ over llm-draft samples; NaN when degenerate (constant raters). */
  llmKappa: number | null
  /** llm-draft vs human-final agreement, when human-final verdicts exist. */
  humanAgreement: { agreed: number; total: number } | null
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
  /** Listed price if run.meta/condition recorded one; blank otherwise. */
  price: number | null
}

/** Cells excluded from one condition's efficiency row, grouped by their state. */
export interface ExcludedCells {
  condition: string
  state: string
  count: number
}

/** The analyzed bundle — everything summary rendering and tests consume. */
export interface EvalReport {
  bundleDir: string
  runId: string | null
  expectedNs: string[] | null
  rows: ReportRow[]
  invariants: InvariantCheck[]
  /** True only when all four invariants are established. */
  comparisonAllowed: boolean
  conditions: Array<{ id: string; sha: string | null; model: string | null }>
  factors: FactorPair[]
  comparisons: PairComparison[]
  singleCondition: boolean
  judge: JudgeConsistency
  efficiency: ConditionEfficiency[]
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
  notes: string[]
}

/** Files written by {@link writeEvalReport}. */
export interface ReportWrite {
  bundleDir: string
  outDir: string
  resultsPath: string
  summaryPath: string
  rowCount: number
  report: EvalReport
}

// --- bundle reading ----------------------------------------------------------

const VERDICT_NS = new Set(['script', 'llm-draft', 'human-final'])
/** Verdict sources in authority order for pass counting (人终评最权威). */
const NS_PRIORITY = ['human-final', 'llm-draft', 'script'] as const
/** States meaning the cell finished its stages (halted is NOT completed). */
const COMPLETED_STATES = new Set(['judged', 'archived', 'releasable', 'released'])

interface DelegationRecord {
  stage: string | null
  round: number | null
  durationMs: number | null
  usage: { outputTokens: number | null; inputTokens: number | null; cacheReadTokens: number | null }
  modelDeclared: string | null
  modelObserved: string | null
}

interface CellVerdict {
  ns: string
  criterion: string
  pass: boolean
  doc: Record<string, unknown>
  createdAt: number
  seq: number
  stage: string | null
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
  verdicts: CellVerdict[]
  delegations: DelegationRecord[]
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

/** Extract delegation records from an orchestrator-ns payload (object or array). */
function delegationsOf(payload: unknown): DelegationRecord[] {
  const items = Array.isArray(payload) ? payload : [payload]
  const out: DelegationRecord[] = []
  for (const item of items) {
    if (!isPlainObject(item) || item['kind'] !== 'delegation') continue
    const model = isPlainObject(item['model']) ? item['model'] : undefined
    const usage = isPlainObject(item['usage']) ? item['usage'] : undefined
    out.push({
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
function verdictDocsOf(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (isPlainObject(payload) && Array.isArray(payload['verdicts'])) return payload['verdicts']
  return [payload]
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
  const writers = new Map<string, Set<string>>()
  let anchor: CellAnchor | null = null
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
      anchor ??= anchorOf(annotation['payload'])
      continue
    }
    if (!VERDICT_NS.has(ns)) continue
    for (const doc of verdictDocsOf(annotation['payload'])) {
      if (!isPlainObject(doc) || validateJson(VERDICT_SCHEMA, doc).length > 0) continue
      verdicts.push({
        ns,
        criterion: doc['criterion'] as string,
        pass: doc['pass'] as boolean,
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
    verdicts,
    delegations,
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

// --- rubric weights ----------------------------------------------------------

/** Collect (task, criterion) → weight triples from one parsed rubric document. */
function weightsOfDocument(value: unknown, sink: Map<string, Map<string, number>>, depth: number): void {
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
        if (!sink.has(task)) sink.set(task, new Map())
        sink.get(task)?.set(criterion, weight)
      }
    }
  }
  for (const [, sub] of Object.entries(value)) {
    if (isPlainObject(sub)) weightsOfDocument(sub, sink, depth + 1)
    else if (Array.isArray(sub)) for (const item of sub) weightsOfDocument(item, sink, depth + 1)
  }
}

async function readWeights(bundleDir: string): Promise<{ weights: Map<string, Map<string, number>>; found: boolean }> {
  const weights = new Map<string, Map<string, number>>()
  const datasetDir = join(bundleDir, 'dataset')
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
      if (entry.isDirectory()) await walk(full, depth + 1)
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          if ((await stat(full)).size > 1_000_000) continue
          const parsed = JSON.parse(await readFile(full, 'utf8'))
          weightsOfDocument(parsed, weights, 0)
        } catch {
          /* a dataset layer file that is not a rubric stays ignored */
        }
      }
    }
  }
  await walk(datasetDir, 0)
  return { weights, found: weights.size > 0 }
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

function checkFingerprint(cells: BundleCell[]): InvariantCheck {
  const present = cells.filter(c => c.isCurrent && str(c.refs['fingerprint']) !== null)
    .map(c => ({ cell: c.missionId, fp: c.refs['fingerprint'] as string }))
  if (present.length === 0) {
    return { id: 'fingerprint', title: '环境一致（refs.fingerprint 同 run 相同）', status: 'unverifiable', details: ['本 run 无指纹'] }
  }
  const all = cells.filter(c => c.isCurrent)
  if (present.length < all.length) {
    return {
      id: 'fingerprint',
      title: '环境一致（refs.fingerprint 同 run 相同）',
      status: 'violated',
      details: [`${all.length - present.length}/${all.length} 格未记录指纹，其余 ${present.length} 格已记录——记录不一致`],
    }
  }
  const distinct = [...new Set(present.map(p => p.fp))]
  if (distinct.length > 1) {
    return { id: 'fingerprint', title: '环境一致（refs.fingerprint 同 run 相同）', status: 'violated', details: [`出现 ${distinct.length} 个不同指纹: ${distinct.map(d => `${d.slice(0, 12)}…`).join(' / ')}`] }
  }
  const fingerprint = distinct[0] ?? ''
  return { id: 'fingerprint', title: '环境一致（refs.fingerprint 同 run 相同）', status: 'ok', details: [`${present.length} 格指纹一致: ${fingerprint.slice(0, 12)}…`] }
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
  for (const cell of current) {
    for (const delegation of cell.delegations) {
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
  if (!conditionVerified || !observedSeen) return { id: 'subject', title, status: 'unverifiable', details }
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

/** The cell's authoritative verdicts: best available ns, majority per criterion. */
function primaryPass(cell: BundleCell): Map<string, boolean> | null {
  for (const ns of NS_PRIORITY) {
    const verdicts = cell.verdicts.filter(v => v.ns === ns)
    if (verdicts.length === 0) continue
    const byCriterion = new Map<string, boolean[]>()
    for (const verdict of verdicts) {
      if (!byCriterion.has(verdict.criterion)) byCriterion.set(verdict.criterion, [])
      byCriterion.get(verdict.criterion)?.push(verdict.pass)
    }
    const result = new Map<string, boolean>()
    for (const [criterion, values] of byCriterion) {
      result.set(criterion, values.filter(Boolean).length > values.length / 2)
    }
    return result
  }
  return null
}

function passAndWeight(cell: BundleCell, weights: Map<string, Map<string, number>>): { passed: number; weighted: number | null } {
  const pass = primaryPass(cell)
  if (pass === null) return { passed: 0, weighted: null }
  const taskWeights = cell.task === null ? undefined : weights.get(cell.task)
  let weighted = 0
  let weightedSeen = false
  for (const [criterion, ok] of pass) {
    if (!ok) continue
    const weight = taskWeights?.get(criterion)
    if (weight !== undefined) {
      weighted += weight
      weightedSeen = true
    }
  }
  return { passed: [...pass.values()].filter(Boolean).length, weighted: weightedSeen ? weighted : null }
}

function comparePair(
  a: string,
  b: string,
  factor: FactorPair,
  cells: BundleCell[],
  weights: Map<string, Map<string, number>>,
  runId: string,
): PairComparison {
  const current = cells.filter(c => c.isCurrent)
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
    const aPassed: number[] = []
    const bPassed: number[] = []
    let aWeightedSum = 0
    let bWeightedSum = 0
    let weightedSeen = false
    for (const rep of shared) {
      const pa = passAndWeight(repsA.get(rep) as BundleCell, weights)
      const pb = passAndWeight(repsB.get(rep) as BundleCell, weights)
      deltas.push(pa.passed - pb.passed)
      aPassed.push(pa.passed)
      bPassed.push(pb.passed)
      if (pa.weighted !== null && pb.weighted !== null) {
        aWeightedSum += pa.weighted
        bWeightedSum += pb.weighted
        weightedSeen = true
      }
    }
    perTask.push({
      task,
      aMean: mean(aPassed),
      bMean: mean(bPassed),
      aWeighted: weightedSeen ? aWeightedSum / shared.length : null,
      bWeighted: weightedSeen ? bWeightedSum / shared.length : null,
      deltas,
      n: shared.length,
    })
    bootstrapBlocks.push(deltas)
    allDeltas.push(...deltas)
  }
  const n = perTask.length === 0 ? 0 : Math.min(...perTask.map(t => t.n))
  const seed = fnv1a(`${runId}:${a}:${b}:eval-report-bootstrap`)
  const ci = bootstrapBlocks.length > 0 ? bootstrapMeanCi(bootstrapBlocks, { seed }) : null
  let rank: 'a' | 'b' | null = null
  let rankReason: string
  if (n < 3) {
    rankReason = `不可排名（n=${n} < 3）`
  } else if (ci === null) {
    rankReason = '不可排名（无配对数据）'
  } else if (factor.known && factor.multi !== null) {
    rankReason = `不可排名（多因子: ${factor.multi.join(' / ')}——只做描述统计）`
  } else if (!factor.known) {
    rankReason = '不可排名（因子未知——条件文档未记录，无法证明单因子）'
  } else if (ci.lo > 0) {
    rank = 'a'
    rankReason = `${a} 高于 ${b}（95% CI [${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}] 不含 0）`
  } else if (ci.hi < 0) {
    rank = 'b'
    rankReason = `${b} 高于 ${a}（95% CI [${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}] 不含 0）`
  } else {
    rankReason = `不可排名（95% CI [${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}] 含 0）`
  }
  return { a, b, factor, perTask, n, ci, rank, rankReason }
}

// --- judge consistency -------------------------------------------------------

function judgeConsistencyOf(cells: BundleCell[]): JudgeConsistency {
  const current = cells.filter(c => c.isCurrent)
  const details: string[] = []
  // (cell, criterion) → sample pass values in annotation order.
  const samples = new Map<string, boolean[]>()
  const human = new Map<string, boolean>()
  for (const cell of current) {
    const ordered = [...cell.verdicts].sort((x, y) => x.createdAt - y.createdAt || x.seq - y.seq)
    for (const verdict of ordered) {
      if (verdict.ns === 'human-final') {
        human.set(`${cell.missionId}|${verdict.criterion}`, verdict.pass)
      } else if (verdict.ns === 'llm-draft') {
        const key = `${cell.missionId}|${verdict.criterion}`
        if (!samples.has(key)) samples.set(key, [])
        samples.get(key)?.push(verdict.pass)
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
  let humanAgreement: { agreed: number; total: number } | null = null
  if (human.size > 0 && samples.size > 0) {
    let agreed = 0
    let total = 0
    for (const [key, humanPass] of human) {
      const llmValues = samples.get(key)
      if (llmValues === undefined || llmValues.length === 0) continue
      total++
      if (llmValues.every(v => v === humanPass)) agreed++
    }
    if (total > 0) {
      humanAgreement = { agreed, total }
      details.push(`llm-draft 对 human-final: ${agreed}/${total} 条判据一致（${pct(agreed, total)}）`)
    } else {
      details.push('human-final 存在，但没有任何判据同时有 llm-draft——一致率不可计算')
    }
  } else if (human.size === 0) {
    details.push('无 human-final 记录——终评一致率不可计算')
  }
  return {
    multiSampled: multi.length,
    llmAgreement: multi.length > 0
      ? { agreed: multi.filter(([, values]) => values.every(v => v === values[0])).length, total: multi.length }
      : null,
    llmKappa: kappa,
    humanAgreement,
    details,
  }
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
  const completed = current.filter(c => c.state !== null && COMPLETED_STATES.has(c.state))
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
function excludedCellsOf(cells: BundleCell[]): ExcludedCells[] {
  const counts = new Map<string, ExcludedCells>()
  for (const cell of cells) {
    if (!cell.isCurrent) continue
    if (cell.state !== null && COMPLETED_STATES.has(cell.state)) continue
    const condition = cell.condition ?? '(未知条件)'
    const state = cell.state ?? '(未知状态)'
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
  const { weights, found: weightsAvailable } = await readWeights(bundleDir)

  const rows: ReportRow[] = []
  for (const cell of cells) {
    for (const verdict of cell.verdicts) {
      const weight = cell.task === null ? undefined : weights.get(cell.task)?.get(verdict.criterion)
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
        ...(weight !== undefined ? { weight } : {}),
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
  const comparisonAllowed = invariants.every(i => i.status === 'ok')

  const current = cells.filter(c => c.isCurrent)
  const seenConditions = [...new Set([
    ...conditionEntries.map(e => e.id),
    ...current.map(c => c.condition).filter((c): c is string => c !== null),
  ])].sort()
  const singleCondition = seenConditions.length <= 1

  const factors = factorPairs(conditionEntries)
  const comparisons: PairComparison[] = []
  if (comparisonAllowed && !singleCondition) {
    for (const factor of factors) {
      comparisons.push(comparePair(factor.a, factor.b, factor, cells, weights, runId ?? bundleDir))
    }
  }

  const judge = judgeConsistencyOf(cells)
  const efficiency = efficiencyOf(cells, conditionEntries, meta)
  const efficiencyExcluded = excludedCellsOf(cells)

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

  const notes: string[] = []
  if (manifest === null) notes.push('bundle 缺 manifest.json——nsReport/writtenBy 由注解回算')
  if (!weightsAvailable) notes.push('bundle 的 dataset 层未提供带 weight 的 rubric——加权分留空')
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
    efficiency,
    efficiencyExcluded,
    tasksCompletedBy,
    toolOnlyNs: toolOnlyNsOf(expectedNs, writtenBy),
    nsCounts,
    missions: new Set(cells.map(c => c.missionId)).size,
    attempts: cells.length,
    retries: cells.filter(c => !c.isCurrent).length,
    weightsAvailable,
    notes,
  }
}

// --- output ------------------------------------------------------------------

/**
 * Build the report for a bundle and write `results.jsonl` + `summary.md`.
 * The out directory defaults to `<bundleDir>/report` and is overwritten on
 * re-run: a report is derived state, unlike the append-only bundle itself.
 */
export async function writeEvalReport(bundleDir: string, options: { out?: string } = {}): Promise<ReportWrite> {
  const report = await analyzeBundle(bundleDir)
  const outDir = options.out ?? join(bundleDir, 'report')
  await mkdir(outDir, { recursive: true })
  const resultsPath = join(outDir, 'results.jsonl')
  const summaryPath = join(outDir, 'summary.md')
  const lines = report.rows.map(row => JSON.stringify(row))
  await writeFile(resultsPath, lines.length === 0 ? '' : `${lines.join('\n')}\n`)
  await writeFile(summaryPath, renderSummaryMd(report), 'utf8')
  return { bundleDir, outDir, resultsPath, summaryPath, rowCount: report.rows.length, report }
}
