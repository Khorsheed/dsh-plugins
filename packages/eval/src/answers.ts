/**
 * `cellAnswers` (I5·T75): one 题's answers, every 组 and every 次 of it, in
 * one read — the answer view's named face (ui-spec §五 作答视图).
 *
 * The view puts a 题's groups side by side with the same parts aligned, and
 * the three doors into it (the run record's 看作答, the 人工评估 queue, the
 * 结果对比 tables) all land on a 题 × 组 × 次. Before this verb the page could
 * read ONE file of ONE cell (`cellArtifact`) and nothing else; a side-by-side
 * of two groups × two stages × their verdicts would have been eight round
 * trips and the verdicts a fourth read. This is the "一格多文件" batch read
 * the brief allows, named, and nothing else widened:
 *
 * - the files are the judged stage files (`JUDGE_MATERIAL_FILES`), read from
 *   the attempt's archive the way the bench reads them, falling back to the
 *   attempt directory for a cell whose archive is missing;
 * - text only, each cut at the cell-artifact cap and said so;
 * - names, never paths (ui-spec §九);
 * - the verdicts are the ledger's three layers as recorded, the judges under
 *   their blind panel label, and the script output is the drawer's own read.
 *
 * NOT blind: this read names the groups, like the record detail it opens
 * from. The blind face is `judgeQueue`'s — scrubbed material, no condition on
 * the wire — and the 人工评估 page keeps reading that one.
 * @module @khorsheed/dsh-eval
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ARTIFACT_MAX_BYTES } from './cell-artifact.ts'
import { attemptDataDir, currentAttemptOf, playerSessionOf, probeRunsOf } from './cell-detail.ts'
import type { DatasetsFace, MissionAttemptFace, MissionReadFace } from './faces.ts'
import {
  benchMetaOf, humanCriteriaOf, judgeLabel, verdictDocsOf, type LedgerAnnotation,
} from './judge-bench.ts'
import { JUDGE_MATERIAL_FILES } from './judge.ts'
import { EvalReadRefused } from './read.ts'
import { validateJson, VERDICT_SCHEMA } from './schema.ts'
import type { EvalAnswerCell, EvalAnswerReport, EvalAnswerSheet, EvalAnswerVerdict } from './types.ts'

/** The three verdict layers, in the report's authority order (lowest first). */
const VERDICT_LAYERS: readonly string[] = ['script', 'llm-draft', 'human-final']

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * One stage file, text only and capped. The archive copy first (it survives
 * the per-cell scratch directory), the attempt directory second.
 * @returns the report, or null when neither place has it.
 */
async function reportOf(attemptDir: string, name: string): Promise<EvalAnswerReport | null> {
  for (const dir of [join(attemptDir, 'archive', 'workspace'), attemptDir]) {
    let buffer: Buffer
    try {
      buffer = await readFile(join(dir, name))
    } catch {
      continue
    }
    const cut = buffer.length > ARTIFACT_MAX_BYTES
    return {
      name,
      text: buffer.subarray(0, ARTIFACT_MAX_BYTES).toString('utf8'),
      truncated: cut,
      bytes: buffer.length,
      note: cut
        ? `${name} ${String(buffer.length)} 字节，超过 ${String(ARTIFACT_MAX_BYTES)} 字节上限，只显示开头部分`
        : null,
    }
  }
  return null
}

/** The verdicts of one attempt, every layer, as recorded (schema-invalid docs dropped). */
function verdictsOf(annotations: readonly LedgerAnnotation[], attempt: number, judgeIds: readonly string[]): EvalAnswerVerdict[] {
  const out: EvalAnswerVerdict[] = []
  for (const annotation of annotations) {
    if (annotation.attempt !== attempt || !VERDICT_LAYERS.includes(annotation.ns)) continue
    const envelope = isPlainObject(annotation.payload) ? annotation.payload : {}
    const judgeCondition = typeof envelope['judgeCondition'] === 'string' ? envelope['judgeCondition'] : null
    const sample = typeof envelope['sample'] === 'number' ? envelope['sample'] : null
    for (const doc of verdictDocsOf(annotation.payload)) {
      if (validateJson(VERDICT_SCHEMA, doc).length > 0) continue
      out.push({
        criterion: doc['criterion'] as string,
        ns: annotation.ns,
        pass: doc['pass'] as boolean,
        evidence: typeof doc['evidence'] === 'string' && doc['evidence'] !== '' ? doc['evidence'] : null,
        // The panel label, as the bench names judges: a judge condition id
        // names a harness as often as not, and the view has a blind switch.
        judge: annotation.ns === 'llm-draft' && judgeCondition !== null ? judgeLabel(judgeIds, judgeCondition) : null,
        sample,
        at: annotation.createdAt,
      })
    }
  }
  return out
}

/** What {@link cellAnswersView} needs from its caller. */
export interface CellAnswersInput {
  mission: MissionReadFace
  datasets?: DatasetsFace
  runId: string
  task: string
}

/**
 * Read one 题's answers.
 * @param input - the ledger face, the datasets face (for the rubric), the run and the 题.
 * @returns every cell of that 题 in the run's seeded order, with its files,
 *   verdicts and script output; the rubric's human criteria once.
 * @throws {@link EvalReadRefused} when the run holds no cell of that 题.
 */
export async function cellAnswersView(input: CellAnswersInput): Promise<EvalAnswerSheet> {
  const { mission, datasets, runId, task } = input
  const status = mission.runStatus(runId)
  const meta = benchMetaOf(status.run.meta)
  const notes: string[] = []
  const cells: EvalAnswerCell[] = []
  let ordinal = 0
  for (const row of status.rows) {
    ordinal += 1
    // The ordinal counts EVERY row, like the bench's cellNo: the blind A/B
    // follows the run's seeded order, not this 题's slice of it.
    if ((row.labels['task'] ?? null) !== task) continue
    let attempts: readonly MissionAttemptFace[] = []
    let annotations: readonly LedgerAnnotation[] = []
    let currentAttempt: number | undefined
    try {
      const record = mission.get(row.id, runId).mission
      attempts = record.attempts ?? []
      annotations = record.annotations
      currentAttempt = record.currentAttempt
    } catch {
      // A record the ledger cannot resolve is a column with nothing in it,
      // not a failed page.
    }
    const current = currentAttemptOf(attempts, currentAttempt, row.currentAttempt)
    const attempt = current?.attempt ?? row.currentAttempt
    const reports: EvalAnswerReport[] = []
    if (mission.dataDir !== undefined) {
      const dir = attemptDataDir(mission.dataDir, runId, row.id, attempt)
      for (const name of JUDGE_MATERIAL_FILES) {
        const report = await reportOf(dir, name)
        if (report !== null) reports.push(report)
      }
    }
    const rep = Number(row.labels['rep'])
    cells.push({
      missionId: row.id,
      condition: row.labels['condition'] ?? null,
      rep: Number.isFinite(rep) ? rep : null,
      cellNo: ordinal,
      attempt,
      state: row.state,
      bucket: row.bucket,
      reports,
      verdicts: verdictsOf(annotations, attempt, meta.judgeIds),
      scripts: probeRunsOf(annotations.filter(annotation => annotation.attempt === attempt)),
      childSessionId: playerSessionOf(current, annotations),
      parentSessionId: status.run.originSession ?? null,
    })
  }
  if (cells.length === 0) {
    throw new EvalReadRefused(`run ${JSON.stringify(runId)} 里没有题目 ${JSON.stringify(task)} 的格子`)
  }
  if (mission.dataDir === undefined) {
    notes.push('账本没有报出数据根目录：提交的报告读不到，只能看判定')
  }
  const rubric = await humanCriteriaOf(datasets, meta, task)
  return { runId, task, cells, criteria: rubric.criteria, criteriaNote: rubric.note, notes }
}
