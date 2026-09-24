/**
 * The ONE in-place write into an existing plan: its numbers (T74).
 *
 * The design page lets a person change how many times each cell runs, the
 * per-cell budget and the judge's sample count before the experiment starts
 * (ui-spec §五, 实验设计 ②). Everything structural — an item, a comparison
 * group, the judge itself — stays with the agent, drafted again through the
 * composer; this module can reach four numbers and nothing else.
 *
 * The write is TEXTUAL. plan.json is kept byte for byte since T73 (an
 * imported plan's hash is how an old run finds it), so re-serializing the
 * document to change one number would rewrite its indentation, its key order
 * and every string's escaping along with it. Instead the value token of each
 * field is located in the file's own text and only those bytes are replaced;
 * the result is then parsed back and compared, canonically, with the document
 * the edit meant to produce. Anything else that differs refuses the write.
 *
 * Whether the experiment has started is not this module's question — the
 * plan does not record a start, the ledger does — so the service asks it
 * first and never calls in here for a started experiment.
 * @module @khorsheed/dsh-eval/plan-numbers
 */
import { readFile, rename, writeFile } from 'node:fs/promises'
import { canonicalJson } from './hash.ts'

/** Thrown when the numbers cannot be written; nothing was written. */
export class EvalPlanEditRefused extends Error {}

/** The four fields the design page may change, by their dotted path in the plan. */
export type PlanNumberField = 'reps' | 'budget.activeMinutes' | 'budget.turns' | 'judge.samples'

/** The values to set; an omitted field is left as it is. */
export interface PlanNumbers {
  reps?: number
  activeMinutes?: number
  turns?: number
  judgeSamples?: number
}

/** One field the edit changed. */
export interface PlanNumberChange {
  field: PlanNumberField
  before: number
  after: number
}

/** What one edit did. */
export interface PlanNumbersReport {
  /** The fields whose value changed, in plan order; empty for a no-op. */
  changes: PlanNumberChange[]
  /** Whether the file was written (a no-op writes nothing). */
  written: boolean
}

const FIELDS: ReadonlyArray<{ field: PlanNumberField; key: keyof PlanNumbers; path: readonly string[]; min: number; integer: boolean }> = [
  { field: 'reps', key: 'reps', path: ['reps'], min: 1, integer: true },
  { field: 'budget.activeMinutes', key: 'activeMinutes', path: ['budget', 'activeMinutes'], min: Number.MIN_VALUE, integer: false },
  { field: 'budget.turns', key: 'turns', path: ['budget', 'turns'], min: 1, integer: true },
  // 0 is legal: a judge declared with no samples is 「本 run 无 LLM 判定」 (§6.4).
  { field: 'judge.samples', key: 'judgeSamples', path: ['judge', 'samples'], min: 0, integer: true },
]

/** Where a value sits in the file's text: `[start, end)`. */
interface Span { start: number; end: number }

/**
 * A minimal JSON scanner that records where the values of the top-level
 * object and its direct child objects sit. It accepts exactly what
 * `JSON.parse` does for well-formed input — the file is parsed first, so it
 * never meets anything else — and it refuses a key written twice, because
 * then "the value of reps" names two places in the text.
 */
function valueSpans(text: string): Map<string, Span> {
  const spans = new Map<string, Span>()
  let i = 0
  const ws = (): void => {
    while (i < text.length && (text[i] === ' ' || text[i] === '\n' || text[i] === '\r' || text[i] === '\t')) i++
  }
  const string = (): string => {
    const start = i
    i++ // the opening quote
    while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1
    i++
    return JSON.parse(text.slice(start, i)) as string
  }
  const value = (path: readonly string[]): void => {
    ws()
    const start = i
    const c = text[i]
    if (c === '{') {
      i++
      ws()
      if (text[i] === '}') { i++ } else {
        for (;;) {
          ws()
          const key = string()
          ws()
          i++ // ':'
          value([...path, key])
          ws()
          if (text[i] === ',') { i++; continue }
          i++ // '}'
          break
        }
      }
    } else if (c === '[') {
      i++
      ws()
      if (text[i] === ']') { i++ } else {
        for (;;) {
          value([...path, '[]'])
          ws()
          if (text[i] === ',') { i++; continue }
          i++ // ']'
          break
        }
      }
    } else if (c === '"') {
      string()
    } else {
      while (i < text.length && !',}] \n\r\t'.includes(text[i] as string)) i++
    }
    if (path.length > 0 && path.length <= 2 && !path.includes('[]')) {
      const key = path.join('.')
      if (spans.has(key)) throw new EvalPlanEditRefused(`plan.json writes "${key}" twice — which one is the value is ambiguous`)
      spans.set(key, { start, end: i })
    }
  }
  value([])
  return spans
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Change some of a plan's four numbers in place, the other bytes untouched,
 * and read the file back before answering.
 * @param planPath - the experiment's plan.json.
 * @param numbers - the values to set.
 * @returns what changed.
 * @throws {@link EvalPlanEditRefused} when a value is not allowed, the plan
 *   does not hold the field, or the read-back is not the intended document.
 */
export async function writePlanNumbers(planPath: string, numbers: PlanNumbers): Promise<PlanNumbersReport> {
  let text: string
  let document: unknown
  try {
    text = await readFile(planPath, 'utf8')
    document = JSON.parse(text) as unknown
  } catch (error) {
    throw new EvalPlanEditRefused(`cannot read the plan: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isPlainObject(document)) throw new EvalPlanEditRefused('the plan is not a JSON object')

  const intended = structuredClone(document)
  const edits: Array<{ span: Span; token: string }> = []
  const changes: PlanNumberChange[] = []
  const spans = valueSpans(text)
  for (const spec of FIELDS) {
    const next = numbers[spec.key]
    if (next === undefined) continue
    if (typeof next !== 'number' || !Number.isFinite(next) || next < spec.min || (spec.integer && !Number.isInteger(next))) {
      throw new EvalPlanEditRefused(
        `${spec.field} must be ${spec.integer ? 'an integer' : 'a number'} ${spec.min === 0 ? '≥ 0' : spec.integer ? '≥ 1' : '> 0'} — got ${String(next)}`,
      )
    }
    const [head, leaf] = spec.path as [string, string | undefined]
    const parent = leaf === undefined ? intended : intended[head]
    const key = leaf ?? head
    if (!isPlainObject(parent) || typeof parent[key] !== 'number') {
      throw new EvalPlanEditRefused(
        spec.field === 'judge.samples'
          ? 'this plan declares no judge, so there is no sample count to change — adding a judge is a structural edit; ask the agent'
          : `this plan has no numeric ${spec.field} to change`,
      )
    }
    const before = parent[key] as number
    if (before === next) continue
    const span = spans.get(spec.path.join('.'))
    if (span === undefined) throw new EvalPlanEditRefused(`cannot locate ${spec.field} in the plan's text`)
    parent[key] = next
    edits.push({ span, token: JSON.stringify(next) })
    changes.push({ field: spec.field, before, after: next })
  }
  if (edits.length === 0) return { changes, written: false }

  let out = text
  for (const edit of [...edits].sort((a, b) => b.span.start - a.span.start)) {
    out = out.slice(0, edit.span.start) + edit.token + out.slice(edit.span.end)
  }
  // Checked before the write as well as after it: a text edit that produced
  // anything but the intended document never reaches the disk.
  if (canonicalJson(JSON.parse(out) as unknown) !== canonicalJson(intended)) {
    throw new EvalPlanEditRefused('the edited text does not read back as the intended plan — nothing was written')
  }
  const temp = `${planPath}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temp, out, 'utf8')
    await rename(temp, planPath)
  } catch (error) {
    throw new EvalPlanEditRefused(`cannot write the plan: ${error instanceof Error ? error.message : String(error)}`)
  }
  const back = await readFile(planPath, 'utf8')
  if (back !== out) throw new EvalPlanEditRefused('the plan read back differently from what was written')
  return { changes, written: true }
}
