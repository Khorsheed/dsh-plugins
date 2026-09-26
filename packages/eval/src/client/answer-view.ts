/**
 * The answer view as data (I5·T75, ui-spec §五 作答视图): the one model both
 * of its faces fill — the named sheet (`cellAnswers`, opened from 运行记录 and
 * 结果对比) and the blind queue (`judgeQueue`, the 人工评估 page) — and the
 * rule that hangs a verdict on a paragraph.
 *
 * A verdict hangs on a paragraph ONLY when its evidence quotes that paragraph.
 * The verdict carries no field that says where in the report it looked
 * (`dataseek.verdict/1` has `evidence`, a sentence), and the judge prompt asks
 * that sentence to quote the material verbatim; so a quoted span found inside
 * one paragraph's text is the one link the data supports. Anything weaker —
 * word overlap, the criterion's own wording — would be the page guessing, and
 * a guessed anchor reads exactly like a real one. A verdict whose evidence
 * quotes nothing, or quotes the structured json rather than the prose, hangs
 * nowhere and is read in 判定证据.
 * @module @khorsheed/dsh-eval/client
 */
import type {
  EvalAnswerSheet, EvalAnswerVerdict, EvalCellProbeRun, EvalJudgeQueueCell,
} from '../types.ts'

/** One submitted file, as the view renders it. */
export interface AnswerFile {
  name: string
  text: string
  truncated: boolean
  bytes: number | null
  /** How many fingerprints the scrubber replaced; null on the named face (nothing was scrubbed). */
  replacements: number | null
}

/** Where a verdict's verdict source chip points: the most authoritative layer present. */
export type AnswerSource = 'human' | 'judge' | 'script' | 'none'

/** One column: one 组 × 次, named or blind. */
export interface AnswerColumnModel {
  /** Mission id (named face) or ticket (blind face) — React's key, never shown. */
  key: string
  /** The group's name; null on the blind face, where the wire never carried it. */
  condition: string | null
  rep: number | null
  /** The run's seeded position — what the blind letter follows. */
  cellNo: number
  /** `A`, `B`, … within its row, by seeded order. */
  letter: string
  /** The entry that opened the view named this column. */
  located: boolean
  source: AnswerSource
  files: AnswerFile[]
  verdicts: EvalAnswerVerdict[]
  scripts: EvalCellProbeRun[]
  childSessionId: string | null
  parentSessionId: string | null
  /** The queue cell behind a blind column — what the scoring form writes against. */
  queueCell: EvalJudgeQueueCell | null
}

/** One row of the view: the groups of one 次, side by side. */
export interface AnswerRow {
  rep: number | null
  columns: AnswerColumnModel[]
}

/** The blind letter of the `index`-th column: A…Z, then AA, AB… */
export function letterOf(index: number): string {
  const head = Math.floor(index / 26)
  return (head > 0 ? letterOf(head - 1) : '') + String.fromCharCode(65 + (index % 26))
}

/** The verdict-source chip of one column: human-final over llm-draft over script. */
export function sourceOf(verdicts: readonly EvalAnswerVerdict[]): AnswerSource {
  if (verdicts.some(verdict => verdict.ns === 'human-final')) return 'human'
  if (verdicts.some(verdict => verdict.ns === 'llm-draft')) return 'judge'
  if (verdicts.some(verdict => verdict.ns === 'script')) return 'script'
  return 'none'
}

/**
 * Group columns into one row per 次, reps ascending, each row in seeded
 * order with its letters. The letters restart per row: a letter is a name
 * WITHIN one side-by-side reading, and carrying it across reps would let a
 * reader line up «A» on rep 1 with «A» on rep 2 — the pairing the blind hides.
 */
function rowsOf(columns: Array<Omit<AnswerColumnModel, 'letter'>>): AnswerRow[] {
  const byRep = new Map<number | null, Array<Omit<AnswerColumnModel, 'letter'>>>()
  for (const column of columns) {
    const list = byRep.get(column.rep) ?? []
    list.push(column)
    byRep.set(column.rep, list)
  }
  return [...byRep.entries()]
    .sort(([a], [b]) => (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER))
    .map(([rep, list]) => ({
      rep,
      columns: [...list]
        .sort((a, b) => a.cellNo - b.cellNo)
        .map((column, index) => ({ ...column, letter: letterOf(index) })),
    }))
}

/** Which cell the entry named: a group (and a rep, when the entry had one). */
export interface AnswerFocus {
  condition: string | null
  rep: number | null
}

/**
 * The named face's rows.
 * @param sheet - the `cellAnswers` payload (one 题, every group and rep).
 * @param focus - the cell the entry named; its group is marked, and a named
 *   rep narrows the view to that rep's row.
 */
export function rowsOfSheet(sheet: EvalAnswerSheet, focus: AnswerFocus): AnswerRow[] {
  const cells = focus.rep === null ? sheet.cells : sheet.cells.filter(cell => cell.rep === focus.rep)
  return rowsOf(cells.map(cell => ({
    key: cell.missionId,
    condition: cell.condition,
    rep: cell.rep,
    cellNo: cell.cellNo,
    located: focus.condition !== null && cell.condition === focus.condition,
    source: sourceOf(cell.verdicts),
    files: cell.reports.map(report => ({
      name: report.name,
      text: report.text,
      truncated: report.truncated,
      bytes: report.bytes,
      replacements: null,
    })),
    verdicts: cell.verdicts,
    scripts: cell.scripts,
    childSessionId: cell.childSessionId,
    parentSessionId: cell.parentSessionId,
    queueCell: null,
  })))
}

/**
 * The blind face's rows: the queue cells of one item. Nothing here names a
 * group — the payload never carried one.
 */
export function rowsOfQueue(cells: readonly EvalJudgeQueueCell[]): AnswerRow[] {
  return rowsOf(cells.map((cell) => {
    const verdicts: EvalAnswerVerdict[] = [
      ...cell.drafts.map(draft => ({
        criterion: draft.criterion,
        ns: 'llm-draft',
        pass: draft.pass,
        evidence: draft.evidence,
        judge: draft.judge,
        sample: draft.sample,
        at: 0,
      })),
      ...cell.humanFinal.map(verdict => ({
        criterion: verdict.criterion,
        ns: 'human-final',
        pass: verdict.pass,
        evidence: verdict.evidence,
        judge: null,
        sample: null,
        at: verdict.at,
      })),
    ]
    return {
      key: cell.ticket,
      condition: null,
      rep: cell.rep,
      cellNo: cell.cellNo,
      located: false,
      source: sourceOf(verdicts),
      files: cell.materials.map(material => ({
        name: material.path,
        text: material.text,
        truncated: false,
        bytes: null,
        replacements: material.replacements,
      })),
      verdicts,
      scripts: [],
      childSessionId: null,
      parentSessionId: null,
      queueCell: cell,
    }
  }))
}

/** One stage of a column: `stage1.md` and `stage1.json` together. */
export interface AnswerStage {
  /** `stage1` — the files' shared stem; the key the rows align on. */
  stem: string
  /** The stage's number when the stem carries one. */
  no: number | null
  markdown: AnswerFile | null
  others: AnswerFile[]
}

/**
 * A column's files grouped by stage, in stage order. The stems are the
 * union over EVERY column of a row, so a group that skipped a stage still
 * gets that stage's slot and the next stage stays level across the row.
 */
export function stagesOf(files: readonly AnswerFile[], stems: readonly string[]): AnswerStage[] {
  return stems.map((stem) => {
    const mine = files.filter(file => stemOf(file.name) === stem)
    const markdown = mine.find(file => file.name.endsWith('.md')) ?? null
    const match = /(\d+)$/.exec(stem)
    return {
      stem,
      no: match === null ? null : Number(match[1]),
      markdown,
      others: mine.filter(file => file !== markdown),
    }
  })
}

/** A file's stage stem: its name without the extension. */
export function stemOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/** Every stem any column of a row has, sorted (stage1 before stage2). */
export function stemsOfRow(row: AnswerRow): string[] {
  const stems = new Set(row.columns.flatMap(column => column.files.map(file => stemOf(file.name))))
  return [...stems].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

/**
 * Split markdown into top-level blocks at blank lines — the paragraphs a
 * verdict can hang under. A fenced code block is one block whatever blank
 * lines it holds.
 */
export function blocksOf(markdown: string): string[] {
  const blocks: string[] = []
  let current: string[] = []
  let fence: string | null = null
  const flush = (): void => {
    if (current.some(line => line.trim() !== '')) blocks.push(current.join('\n'))
    current = []
  }
  for (const line of markdown.split('\n')) {
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1] ?? null
    if (fence === null && marker !== null) {
      fence = marker
    } else if (fence !== null && marker !== null && marker.startsWith(fence.slice(0, 3))) {
      fence = null
      current.push(line)
      continue
    }
    if (fence === null && line.trim() === '') {
      flush()
      continue
    }
    current.push(line)
  }
  flush()
  return blocks
}

/** The shortest quoted span that counts: shorter ones match by accident. */
export const MIN_QUOTE = 6

/** Plain text for matching: markdown emphasis and code marks and all whitespace dropped. */
export function plainOf(text: string): string {
  return text.replace(/[*_`#>|]/g, '').replace(/\s+/g, '')
}

/**
 * The spans a verdict's evidence quotes: 「…」, “…”, "…", '…', `…`, of at
 * least {@link MIN_QUOTE} characters once flattened by {@link plainOf}.
 */
export function quotesOf(evidence: string | null): string[] {
  if (evidence === null) return []
  const pattern = /「([^」]+)」|“([^”]+)”|"([^"]+)"|'([^']+)'|`([^`]+)`|‘([^’]+)’/g
  const out: string[] = []
  for (const match of evidence.matchAll(pattern)) {
    const span = match.slice(1).find(part => part !== undefined) ?? ''
    const plain = plainOf(span)
    if ([...plain].length >= MIN_QUOTE) out.push(plain)
  }
  return out
}

/** Where one verdict hung: which file, which block (0-based). */
export interface HungAt {
  file: string
  block: number
}

/**
 * Hang each verdict on the first markdown block whose text contains one of
 * its quoted spans. A verdict hangs at most once.
 * @param files - the column's files; only markdown is searched.
 * @param verdicts - the column's verdicts.
 * @returns per verdict (by index), where it hung, or nothing.
 */
export function hangVerdicts(files: readonly AnswerFile[], verdicts: readonly EvalAnswerVerdict[]): Map<number, HungAt> {
  const docs = files
    .filter(file => file.name.endsWith('.md'))
    .map(file => ({ name: file.name, blocks: blocksOf(file.text).map(plainOf) }))
  const out = new Map<number, HungAt>()
  verdicts.forEach((verdict, index) => {
    const quotes = quotesOf(verdict.evidence)
    if (quotes.length === 0) return
    for (const doc of docs) {
      const block = doc.blocks.findIndex(text => quotes.some(quote => text.includes(quote)))
      if (block >= 0) {
        out.set(index, { file: doc.name, block })
        return
      }
    }
  })
  return out
}

/**
 * The criteria the evidence view lists, in order: the rubric's human rows
 * first (its own order), then every other criterion a verdict names, sorted.
 */
export function criteriaOrder(rubric: ReadonlyArray<{ id: string }>, rows: readonly AnswerRow[]): string[] {
  const ids = rubric.map(row => row.id)
  const seen = new Set(ids)
  const rest = new Set<string>()
  for (const row of rows) {
    for (const column of row.columns) {
      for (const verdict of column.verdicts) {
        if (!seen.has(verdict.criterion)) rest.add(verdict.criterion)
      }
    }
  }
  return [...ids, ...[...rest].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))]
}
