/**
 * The JUDGE BENCH's projection and its one write (ui-spec §五, step 8): the
 * blind review queue, the de-fingerprinted material, the rubric's `human`
 * criteria beside every llm-draft sample, and the human-final verdicts a
 * person writes from there.
 *
 * Three rules shape everything in this module.
 *
 * BLIND. A grader must not be able to tell which harness or which model
 * produced the work in front of them, so nothing that names one crosses the
 * wire: not the condition id, not the harness, not the model — and not the
 * mission id either, because the orchestrator names cells
 * `<task>-<conditionId>-rep<N>` and the condition id usually contains the
 * harness name. Each cell therefore travels as an ordinal (`格子 03`) plus an
 * opaque `ticket`, and the ticket is what the write verb takes back. Judge
 * conditions get the same treatment: the panel reads 判官 A / 判官 B, in a
 * stable order, so two samples can be told apart without saying whose they
 * are. The report page is where all of it is unblinded, and that is the only
 * page that should.
 *
 * ONE de-identifier. The material shown here is produced by the SAME
 * {@link deidentify} the run loop hands the LLM judge, over rules built from
 * the same `run.meta` conditions. A bench with its own scrubber would be a
 * second place for the redaction to be wrong, and the two would drift the
 * first time a harness alias was added to one of them.
 *
 * ONE LAYER SCORES A CRITERION — not a cell. The report takes, for EACH
 * criterion independently, the most authoritative layer that judged it
 * (`human-final` > `llm-draft` > `script`), so a human verdict here settles
 * the criteria it answers and leaves the rest on the judge's word. A record
 * can therefore score from both at once, which is the thing the bench owes a
 * grader up front: not a cost any more (until I5·T54 a single human answer
 * dropped every llm-draft-only criterion from the score), but the fact that
 * the record's score stops having one author. `draftOnlyCriteria` is what
 * that sentence is built from.
 *
 * APPEND-ONLY, AND A PERSON'S. `humanFinal` forwards to mission's `annotate`
 * in the `human-final` namespace and does nothing else: no overwrite, no
 * delete, no recount. The annotation's `by` is the calling SESSION
 * (`tab:<sessionId>`) — never a `tool:` origin, which is exactly the writer
 * the report flags red — and there is no model tool anywhere in this family
 * that reaches this verb. R1's 终评是人的 is enforced by there being no other
 * door, not by a policy check.
 * @module @khorsheed/dsh-eval
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { attemptDataDir } from './cell-detail.ts'
import { readExportState } from './export-note.ts'
import type { DatasetsFace, MissionAnnotateFace, MissionReadFace } from './faces.ts'
import {
  buildDeidentifyRules, deidentify, humanCriteria, pickRubricPath,
  JUDGE_MATERIAL_FILES, type DeidentifyRule,
} from './judge.ts'
import { EvalReadRefused } from './read.ts'
import { judgeConsistencyOf, type JudgeConsistencyCell } from './report.ts'
import { validateJson, VERDICT_SCHEMA, VERDICT_SCHEMA_ID } from './schema.ts'
import type {
  EvalJudgeCriterionRow, EvalJudgeDraftSample, EvalJudgeQueueCell, EvalJudgeQueueView,
  EvalJudgeVerdictInput, EvalHumanFinalResult,
} from './types.ts'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * The opaque handle a blind cell travels under. Derived from the run and the
 * mission id so it is stable across reloads (a grader who reloads keeps their
 * place) and reversible only by re-deriving it over the run's own cells —
 * which is what {@link resolveTicket} does. It is NOT a secret: it is a name
 * that carries no fingerprint, which is all blindness needs.
 * @param runId - the run.
 * @param missionId - the cell.
 * @returns a 16-hex-character ticket.
 */
export function cellTicket(runId: string, missionId: string): string {
  return createHash('sha256').update(`${runId}\u0000${missionId}`).digest('hex').slice(0, 16)
}

/**
 * The mission id a ticket names, by re-deriving every candidate's ticket.
 * @param runId - the run the ticket was issued for.
 * @param missionIds - the run's cells.
 * @param ticket - the ticket to resolve.
 * @returns the mission id, or null when nothing in the run matches.
 */
export function resolveTicket(
  runId: string,
  missionIds: readonly string[],
  ticket: string,
): string | null {
  return missionIds.find(missionId => cellTicket(runId, missionId) === ticket) ?? null
}

/** One annotation as the ledger hands it over. */
interface LedgerAnnotation {
  ns: string
  attempt: number
  payload: unknown
  createdAt: number
  by?: string
}

/** The run's meta, as far as this module reads it. */
interface BenchMeta {
  datasetId: string | null
  commit: string | null
  repo: string | null
  /** Every player AND judge condition document, for the de-identification table. */
  rules: DeidentifyRule[]
  /** Judge condition ids, sorted — the index into this list is the blind label. */
  judgeIds: string[]
}

/** Read the run's meta into what the bench needs: the scrub rules and the panel. */
function benchMetaOf(meta: Record<string, unknown>): BenchMeta {
  const models: Array<string | null> = []
  const harnesses: string[] = []
  const entries = Array.isArray(meta['conditions']) ? meta['conditions'] : []
  for (const entry of entries) {
    if (!isPlainObject(entry)) continue
    const document = entry['condition']
    if (!isPlainObject(document)) continue
    const model = isPlainObject(document['model']) ? stringOrNull(document['model']['declared']) : null
    const harness = isPlainObject(document['harness']) ? stringOrNull(document['harness']['name']) : null
    if (model !== null) models.push(model)
    if (harness !== null) harnesses.push(harness)
  }
  const judge = isPlainObject(meta['judge']) ? meta['judge'] : {}
  const judgeEntries = Array.isArray(judge['conditions']) ? judge['conditions'] : []
  const judgeIds = judgeEntries
    .flatMap(entry => (isPlainObject(entry) ? [stringOrNull(entry['id'])] : []))
    .filter((id): id is string => id !== null)
    .sort((a, b) => (a < b ? -1 : 1))
  const snapshot = isPlainObject(meta['snapshot']) ? meta['snapshot'] : {}
  return {
    datasetId: stringOrNull(meta['datasetId']),
    commit: stringOrNull(snapshot['commit']) ?? stringOrNull(meta['commit']),
    repo: stringOrNull(snapshot['repo']),
    // The run-wide table, rebuilt exactly as the run loop built it: every
    // condition's declared model and harness, plus judge.ts's own alias list.
    rules: buildDeidentifyRules({ models, harnesses }),
    judgeIds,
  }
}

/**
 * The blind label of one judge condition: 判官 A, 判官 B, … by the run's
 * sorted judge order. A judge the run.meta never listed (an older run, a
 * judge added mid-flight) falls back to a label derived from its position
 * among the ids actually seen — still no condition id, still stable within
 * one answer.
 */
function judgeLabel(judgeIds: readonly string[], condition: string): string {
  const index = judgeIds.indexOf(condition)
  const slot = index >= 0 ? index : judgeIds.length + [...condition].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 26
  return `判官 ${String.fromCharCode(65 + (slot % 26))}${slot >= 26 ? String(Math.floor(slot / 26) + 1) : ''}`
}

/**
 * The verdict documents inside one annotation payload — the two envelope
 * shapes the ledger carries (a bare array, or `{ verdicts: [...] }`), read
 * the same way {@link analyzeBundle} reads them.
 */
function verdictDocsOf(payload: unknown): Record<string, unknown>[] {
  const raw = Array.isArray(payload)
    ? payload
    : isPlainObject(payload) && Array.isArray(payload['verdicts'])
      ? payload['verdicts']
      : [payload]
  return raw.filter(isPlainObject)
}

/**
 * One cell's de-identified material: the judged stage files, scrubbed with
 * the run's own table. Read from the ARCHIVE — `archive/workspace/` under the
 * attempt's run-data directory, which both the host path (a directory copy)
 * and the container path (lab's export) write — so the bench keeps working
 * after the per-cell scratch directory is gone.
 * @returns one entry per material file that exists, in prompt order.
 */
async function materialsOf(
  dataDir: string | undefined,
  runId: string,
  missionId: string,
  attempt: number,
  rules: readonly DeidentifyRule[],
): Promise<Array<{ path: string; text: string; replacements: number }>> {
  if (dataDir === undefined) return []
  const workspace = join(attemptDataDir(dataDir, runId, missionId, attempt), 'archive', 'workspace')
  const out: Array<{ path: string; text: string; replacements: number }> = []
  for (const rel of JUDGE_MATERIAL_FILES) {
    let text: string
    try {
      text = await readFile(join(workspace, rel), 'utf8')
    } catch {
      // A cell that halted before a stage produced nothing for it. Absence is
      // reported by omission, never as an empty file.
      continue
    }
    const cleaned = deidentify(text, rules)
    out.push({ path: rel, text: cleaned.text, replacements: cleaned.total })
  }
  return out
}

/**
 * The item's `kind: human` rubric criteria, read through the datasets face
 * with an EXPLICIT grading-layer scope (the answer key never reaches a cell,
 * and it does not reach the browser either — only the criterion text a person
 * is being asked to answer).
 * @returns the criteria, or an empty list plus the reason it is empty.
 */
async function humanCriteriaOf(
  datasets: DatasetsFace | undefined,
  meta: BenchMeta,
  taskId: string | null,
): Promise<{ criteria: EvalJudgeCriterionRow[]; note: string | null }> {
  if (datasets === undefined) {
    return { criteria: [], note: '没有挂 datasets 服务：判据表读不出来，只能看已有判定' }
  }
  if (taskId === null || meta.datasetId === null || meta.repo === null) {
    return { criteria: [], note: '这个 run 的快照里没有题库坐标，取不到 rubric' }
  }
  const scope = { repo: meta.repo, layers: ['grading'] as const }
  try {
    const shown = await datasets.show(
      scope, meta.datasetId, taskId, meta.commit ?? undefined,
    )
    const rubricPath = pickRubricPath(shown.items.find(item => item.id === taskId)?.layers['grading'] ?? [])
    if (rubricPath === null) return { criteria: [], note: `题目 ${taskId} 的 grading 层没有 rubric` }
    const rubric = await datasets.read(scope, {
      dataset: meta.datasetId,
      item: taskId,
      layer: 'grading',
      path: rubricPath,
      ...(meta.commit === null ? {} : { commit: meta.commit }),
    })
    const criteria = humanCriteria(rubric.content)
    return {
      criteria: criteria.map(row => ({
        id: row.id,
        criterion: row.criterion,
        evidence: row.evidence ?? null,
        weight: row.weight ?? null,
        negative: row.negative === true,
        veto: row.veto === true,
        note: row.note ?? null,
      })),
      note: criteria.length === 0 ? `rubric ${rubricPath} 没有 kind: human 的判据` : null,
    }
  } catch (error) {
    return { criteria: [], note: `rubric 读不出来：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** What {@link judgeQueueView} needs from its caller. */
export interface JudgeQueueInput {
  mission: MissionReadFace
  datasets?: DatasetsFace
  runId: string
}

/**
 * The judge bench's payload for one run: every cell as a BLIND queue entry,
 * with its de-identified material, the rubric's human criteria, every
 * llm-draft sample already recorded, and whatever human-final it already
 * carries — plus the run's consistency numbers, computed by the report's own
 * function over the LIVE ledger (so a verdict written on this page shows up
 * in the header without waiting for a re-export).
 * @param input - the ledger face, the datasets face, and the run.
 * @returns the queue payload.
 * @throws {@link EvalReadRefused} when the ledger does not hold the run.
 */
export async function judgeQueueView(input: JudgeQueueInput): Promise<EvalJudgeQueueView> {
  const { mission, datasets, runId } = input
  const status = mission.runStatus(runId)
  // Where this run's bundle went and when, plus its newest final verdict —
  // one ledger pass, shared with the report page's own freshness read.
  const exportState = readExportState(mission, runId)
  const meta = benchMetaOf(status.run.meta)
  const notes: string[] = []
  const cells: EvalJudgeQueueCell[] = []
  const consistencyCells: JudgeConsistencyCell[] = []
  // Rubrics are per ITEM, and a run has many cells per item: read each item's
  // grading layer once and share it across that item's cells.
  const rubricCache = new Map<string, { criteria: EvalJudgeCriterionRow[]; note: string | null }>()

  // Queue order is the ledger's own row order, which the orchestrator already
  // shuffled by `order.seed`. Numbering by that order (rather than by task or
  // by condition) is itself part of the blind: consecutive numbers say nothing
  // about which cells share a condition.
  let ordinal = 0
  for (const row of status.rows) {
    ordinal += 1
    const missionId = row.id
    const taskId = row.labels['task'] ?? null
    let annotations: readonly LedgerAnnotation[] = []
    let attempt = row.currentAttempt
    try {
      const record = mission.get(missionId, runId).mission
      annotations = record.annotations
      attempt = record.currentAttempt ?? row.currentAttempt
    } catch {
      // A record the ledger cannot resolve is a queue entry with no material
      // rather than a failed page.
    }

    const drafts: EvalJudgeDraftSample[] = []
    const humanFinal: EvalJudgeQueueCell['humanFinal'] = []
    const verdictsForStats: Array<JudgeConsistencyCell['verdicts'][number]> = []
    let seq = 0
    let judgeFailures = 0
    for (const annotation of annotations) {
      if (annotation.attempt !== attempt) continue
      if (annotation.ns === 'orchestrator') {
        const entries = Array.isArray(annotation.payload) ? annotation.payload : [annotation.payload]
        judgeFailures += entries.filter(entry => isPlainObject(entry) && entry['kind'] === 'judge-parse-failed').length
        continue
      }
      if (annotation.ns !== 'llm-draft' && annotation.ns !== 'human-final') continue
      const envelope = isPlainObject(annotation.payload) ? annotation.payload : {}
      const judgeCondition = stringOrNull(envelope['judgeCondition'])
      const sample = typeof envelope['sample'] === 'number' ? envelope['sample'] : null
      const selfJudged = envelope['selfJudged'] === true
      for (const doc of verdictDocsOf(annotation.payload)) {
        if (validateJson(VERDICT_SCHEMA, doc).length > 0) continue
        const criterion = doc['criterion'] as string
        const pass = doc['pass'] as boolean
        verdictsForStats.push({
          ns: annotation.ns,
          criterion,
          pass,
          judge: judgeCondition === null
            ? null
            : { condition: judgeCondition, model: stringOrNull(envelope['judgeModel']), selfJudged, sample },
          createdAt: annotation.createdAt,
          seq: seq++,
        })
        if (annotation.ns === 'llm-draft') {
          drafts.push({
            // BLIND: the panel is 判官 A / 判官 B, never the condition id —
            // which names a harness as often as not.
            judge: judgeCondition === null ? '判官 ?' : judgeLabel(meta.judgeIds, judgeCondition),
            sample,
            criterion,
            pass,
            evidence: stringOrNull(doc['evidence']),
            selfJudged,
          })
        } else {
          humanFinal.push({
            criterion,
            pass,
            evidence: stringOrNull(doc['evidence']),
            at: annotation.createdAt,
            by: annotation.by ?? null,
          })
        }
      }
    }

    if (taskId !== null && !rubricCache.has(taskId)) {
      rubricCache.set(taskId, await humanCriteriaOf(datasets, meta, taskId))
    }
    const rubric = taskId === null
      ? { criteria: [], note: '这个格子没有记题号，取不到 rubric' }
      : rubricCache.get(taskId) as { criteria: EvalJudgeCriterionRow[]; note: string | null }

    const materials = await materialsOf(mission.dataDir, runId, missionId, attempt, meta.rules)
    cells.push({
      ticket: cellTicket(runId, missionId),
      // The ordinal IS the cell's name here. `task` rides along because the
      // criteria are the item's and a grader has to know which question they
      // are grading — the题目 is not a fingerprint of the subject.
      cellNo: ordinal,
      task: taskId,
      rep: Number.isFinite(Number(row.labels['rep'])) ? Number(row.labels['rep']) : null,
      state: row.state,
      bucket: row.bucket,
      attempt,
      materials,
      criteria: rubric.criteria,
      criteriaNote: rubric.note,
      drafts,
      humanFinal,
      graded: humanFinal.length > 0,
      // The report's 判官缺席 predicate (`coverageGapsOf`), read off the
      // ledger: every judge call failed and no llm-draft landed. Said here
      // by the blind name, never by the condition.
      judgeAbsent: judgeFailures > 0 && !annotations.some(entry => entry.ns === 'llm-draft' && entry.attempt === attempt),
      // The criteria that will KEEP scoring on the judge's word after a
      // human verdict lands here. See the field's own note: the report merges
      // per criterion, so this list is what stays the judge's, not what a
      // human answer would cost.
      draftOnlyCriteria: [...new Set(drafts.map(draft => draft.criterion))]
        .filter(criterion => !humanFinal.some(verdict => verdict.criterion === criterion))
        .sort((a, b) => (a < b ? -1 : 1)),
    })
    consistencyCells.push({ missionId, isCurrent: true, verdicts: verdictsForStats })
  }

  if (mission.dataDir === undefined) {
    notes.push('账本没有报出数据根目录：去指纹产物读不到，只能看判据与已有判定')
  }
  if (meta.rules.length === 0) {
    notes.push('run.meta 里没有条件文档：去指纹表只剩 harness 别名表，模型名可能漏网')
  }

  return {
    runId,
    cells,
    // Live, not from the bundle: a verdict written on this page has to move
    // these numbers immediately, or a grader cannot see the effect of the act
    // they just performed.
    consistency: judgeConsistencyOf(consistencyCells),
    judgeCount: meta.judgeIds.length,
    // The ledger's own two timestamps, not the bundle's: this page must be
    // able to say "what you just wrote is not in the bundle" without reading
    // a directory, and eval's export note carries when the export was made.
    // The report page compares the manifest instead, which is the stricter
    // source and the one the sentence with numbers in it uses.
    bundleStale: exportState.note !== null
      && exportState.lastHumanFinalAt !== null
      && exportState.note.exportedAt < exportState.lastHumanFinalAt,
    lastExportAt: exportState.note?.exportedAt ?? null,
    notes,
  }
}

/** What {@link writeHumanFinal} needs from its caller. */
export interface HumanFinalInput {
  mission: MissionReadFace
  annotate: MissionAnnotateFace
  runId: string
  /** The blind handle the queue issued for the cell being graded. */
  ticket: string
  verdicts: readonly EvalJudgeVerdictInput[]
  /** The calling session, recorded as the annotation's `by`. */
  sessionId: string
}

/**
 * Write one cell's human-final verdicts — the ONE write of the judge bench,
 * and the only door `human-final` has in this family.
 *
 * Append-only by construction: it forwards to mission's `annotate`, which
 * pushes onto the attempt's annotation list and never rewrites one. A second
 * pass over the same cell is a second annotation; the report's authority
 * order (`human-final` > `llm-draft` > `script`) then reads the LAST value
 * for a criterion, so a corrected verdict supersedes without the earlier one
 * disappearing from the ledger.
 * @param input - the ledger faces, the cell's ticket, the verdicts, the session.
 * @returns what was written, and the mission id it landed on.
 * @throws {@link EvalReadRefused} when the ticket names no cell of the run, or
 *   when a verdict does not satisfy `dataseek.verdict/1`.
 */
export async function writeHumanFinal(input: HumanFinalInput): Promise<EvalHumanFinalResult> {
  const { mission, annotate, runId, ticket, verdicts, sessionId } = input
  const status = mission.runStatus(runId)
  const missionId = resolveTicket(runId, status.rows.map(row => row.id), ticket)
  if (missionId === null) {
    throw new EvalReadRefused(`no cell ${JSON.stringify(ticket)} in run ${JSON.stringify(runId)}`)
  }
  if (verdicts.length === 0) {
    throw new EvalReadRefused('human-final needs at least one verdict: an empty submission would record nothing and claim a grading')
  }
  const row = status.rows.find(candidate => candidate.id === missionId)
  const task = row?.labels['task'] ?? null
  if (task === null) {
    throw new EvalReadRefused(`cell ${JSON.stringify(missionId)} carries no task label — a verdict without a task cannot be tabulated`)
  }

  const docs: Array<Record<string, unknown>> = []
  for (const verdict of verdicts) {
    const evidence = verdict.evidence.trim()
    if (evidence === '') {
      // The schema would accept an empty string; the protocol would not —
      // `evidence` is "a checkable fact, not an opinion", and a blank one
      // makes a verdict unauditable the moment the grader forgets why.
      throw new EvalReadRefused(`判据 ${verdict.criterion} 缺证据：终评每条都要写清依据（协议 §6.8：evidence 是可核对的事实）`)
    }
    const doc: Record<string, unknown> = {
      schema: VERDICT_SCHEMA_ID,
      task,
      criterion: verdict.criterion,
      pass: verdict.pass,
      evidence,
      // The protocol's own third word for a verdict's origin: a probe path, a
      // judge condition, or the judge bench. The SESSION is on the annotation
      // record, where every other human gesture in this tab records it.
      by: 'judge-bench',
      ...(verdict.ratio === undefined || verdict.ratio === null ? {} : { ratio: verdict.ratio }),
    }
    const violations = validateJson(VERDICT_SCHEMA, doc)
    if (violations.length > 0) {
      throw new EvalReadRefused(`判据 ${verdict.criterion} 不符合 ${VERDICT_SCHEMA_ID}：${violations.join('; ')}`)
    }
    docs.push(doc)
  }

  // `tab:<sessionId>`, exactly as `retry` and `finalize` record their clicks.
  // NOT a `tool:` origin — that prefix is what the report flags red on this
  // namespace, and it would be the honest thing to write only if a model had
  // written the verdict, which nothing here can arrange.
  const by = `tab:${sessionId}`
  const result = await annotate.annotate(missionId, 'human-final', { verdicts: docs }, { runId, by })
  return {
    runId,
    ticket,
    missionId,
    written: result.added ? docs.length : 0,
    added: result.added,
    by,
    /** mission's annotate is a no-op on an identical (ns + payload) repeat. */
    duplicate: !result.added,
  }
}
