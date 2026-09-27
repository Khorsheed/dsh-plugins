import { awaitObservedModel, DEFAULT_READBACK_WAIT_MS } from './readback.ts'
import { effortEvidence, frozenConfigurationOptions, requireEffortAdmission } from './frozen-configuration.ts'
import type { DelegationProgress } from './faces.ts'
/**
 * The judging half of the orchestrator (I2·T9): the two MECHANICAL verdict
 * sources of the three the flow declares. `script` verdicts come from
 * deterministic probes the dataset ships in its `verify` layer; `llm-draft`
 * verdicts come from a JUDGE CONDITION — the judge is itself a
 * `dataseek.condition/1`, delegated exactly like a player, never a session
 * with tools. `human-final` stays a person's act and is written elsewhere.
 *
 * Decision 9 is the whole design, as relaxed on 2026-09-10: the material is
 * de-fingerprinted before it is shown, every criterion is sampled at least
 * twice so the report can print an agreement number instead of a single
 * opinion, and a PANEL of judges may be named. A judge sharing a model with
 * one of the players is no longer refused — every public leaderboard that
 * evaluates all the models has that overlap by construction — it is RECORDED:
 * the sample carries who judged, and a cell judged by its own model is marked
 * `selfJudged` so the reader discounts it rather than never seeing it.
 *
 * Two layer disciplines hold here and nowhere else in the run loop:
 * - the `grading` layer (rubrics, oracle notes) and the `verify` layer
 *   (probes, checklists) are read through the datasets service face with an
 *   EXPLICIT single-layer scope, and are materialized into host-side judge /
 *   probe directories — never into a player's cell;
 * - the material handed to the judge is a de-identified COPY; the cell's own
 *   stage outputs are never rewritten.
 * @module @khorsheed/dsh-eval
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import yaml from 'js-yaml'
import type { DatasetsFace, LocalAgentFace, MissionFace } from './faces.ts'
import { discardDir, hostProbeExecutor, type ProbeExecution, type ProbeExecutor } from './probe-exec.ts'
import { validateJson, VERDICT_SCHEMA, VERDICT_SCHEMA_ID } from './schema.ts'
import { inStageScope, rubricWeightRows } from './weights.ts'

/** The four material files handed to the judge, in prompt order. */
export const JUDGE_MATERIAL_FILES: readonly string[] = ['stage1.json', 'stage1.md', 'stage2.json', 'stage2.md']

/** Default samples per judge condition when the plan's judge block omits it (decision 9: at least two). */
export const DEFAULT_JUDGE_SAMPLES = 2

/**
 * Harness / CLI / assistant self-name aliases replaced by `<harness>`.
 * Ordered longest-first at rule build time, so `deepseek-harness` is consumed
 * before `deepseek`. The "I am Codex" class the brief names is covered here:
 * the SELF-REPORTED name IS one of these aliases, so no separate sentence
 * pattern is needed (and none is used — a bare `I am <Capitalized>` rule
 * would corrupt material that merely writes in the first person).
 */
export const HARNESS_ALIASES: readonly string[] = [
  'deepseek-harness', 'deepseek harness', 'deepseek', 'dsh',
  'claude code', 'claude-code', 'claude', 'anthropic',
  'openai codex', 'codex', 'openai', 'chatgpt',
  'kimi-cli', 'kimi', 'moonshot',
  'gemini', 'qwen',
]

/** One de-identification rule: a source-text pattern and what replaces it. */
export interface DeidentifyRule {
  /** The literal that was matched (what the replacement table prints). */
  pattern: string
  /** `<harness>` or `<model>`. */
  replacement: string
  /** The compiled matcher (boundary-guarded, case-insensitive, global). */
  regex: RegExp
}

/** One row of the replacement table an annotation records. */
export interface ReplacementCount {
  pattern: string
  replacement: string
  count: number
}

/** A de-identified material file. */
export interface Deidentified {
  text: string
  replacements: ReplacementCount[]
  total: number
}

/** Escape a literal for embedding in a RegExp. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Boundaries that survive punctuation an identifier may contain: `dsh` must
 * match in `dsh-eval` and `(dsh)` but not in `wordsh`. `\b` fails on
 * identifiers ending in a non-word character, so the boundary is spelled out.
 */
function boundedRegExp(literal: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(literal)}(?![A-Za-z0-9])`, 'gi')
}

/**
 * Build the replacement table for one run's judging.
 * @param options.models - model identifiers seen in the run: every condition's
 *   `model.declared` plus whatever the delegations read back as observed.
 * @param options.harnesses - extra harness / CLI names beyond {@link HARNESS_ALIASES}
 *   (a plan's conditions may name a harness this module has never heard of).
 * @returns rules ordered longest-literal-first — the specific identifier is
 *   consumed before the family name it contains.
 */
export function buildDeidentifyRules(options: {
  models?: readonly (string | null | undefined)[]
  harnesses?: readonly string[]
} = {}): DeidentifyRule[] {
  const models = [...new Set((options.models ?? []).filter((m): m is string => typeof m === 'string' && m.trim() !== ''))]
  const harnesses = [...new Set([...(options.harnesses ?? []), ...HARNESS_ALIASES].filter(h => h.trim() !== ''))]
  const rules: DeidentifyRule[] = [
    ...models.map(pattern => ({ pattern, replacement: '<model>', regex: boundedRegExp(pattern) })),
    ...harnesses.map(pattern => ({ pattern, replacement: '<harness>', regex: boundedRegExp(pattern) })),
  ]
  // Longest first: `claude-code` before `claude`, `deepseek-chat` before
  // `deepseek`. Ties break on the literal so the table is deterministic.
  rules.sort((a, b) => b.pattern.length - a.pattern.length || (a.pattern < b.pattern ? -1 : 1))
  return rules
}

/**
 * Apply the replacement table to one material file.
 * @param text - the ORIGINAL bytes as text; never written back.
 * @param rules - from {@link buildDeidentifyRules}.
 * @returns the de-identified text plus the rows that actually fired.
 */
export function deidentify(text: string, rules: readonly DeidentifyRule[]): Deidentified {
  let out = text
  const replacements: ReplacementCount[] = []
  for (const rule of rules) {
    let count = 0
    out = out.replace(rule.regex, () => { count++; return rule.replacement })
    if (count > 0) replacements.push({ pattern: rule.pattern, replacement: rule.replacement, count })
  }
  return { text: out, replacements, total: replacements.reduce((sum, row) => sum + row.count, 0) }
}

/** Merge per-file replacement tables into one cell-level table. */
export function mergeReplacements(tables: readonly (readonly ReplacementCount[])[]): ReplacementCount[] {
  const merged = new Map<string, ReplacementCount>()
  for (const table of tables) {
    for (const row of table) {
      const key = `${row.pattern}\u0000${row.replacement}`
      const existing = merged.get(key)
      if (existing === undefined) merged.set(key, { ...row })
      else existing.count += row.count
    }
  }
  return [...merged.values()].sort((a, b) => b.count - a.count || (a.pattern < b.pattern ? -1 : 1))
}

/** One rubric criterion, as the judge prompt renders it. */
export interface RubricCriterion {
  id: string
  criterion: string
  kind: string
  evidence?: string
  weight?: number
  negative?: boolean
  veto?: boolean
  note?: string
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * The criteria of ONE `kind` in a `dataseek.rubric/2` document, in document
 * order. The protocol splits a rubric three ways and each third has exactly
 * one reader: `objective` belongs to the probes, `llm-draft` to the LLM
 * judge, `human` to the judge bench. One parser serves all three so the three
 * readers can never disagree about what a rubric says.
 * @param rubricText - the rubric YAML as read from the grading layer.
 * @param kind - the third to take.
 * @returns the matching criteria in document order (empty when none).
 * @throws Error when the document does not parse as YAML.
 */
export function rubricCriteria(rubricText: string, kind: string): RubricCriterion[] {
  const doc = yaml.load(rubricText) as { items?: unknown } | null
  const items = doc !== null && typeof doc === 'object' && Array.isArray((doc as { items?: unknown }).items)
    ? (doc as { items: unknown[] }).items
    : []
  const out: RubricCriterion[] = []
  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
    const row = raw as Record<string, unknown>
    if (row['kind'] !== kind) continue
    const id = asString(row['id'])
    const criterion = asString(row['criterion'])
    if (id === undefined || criterion === undefined) continue
    const evidence = asString(row['evidence'])
    const note = asString(row['note'])
    out.push({
      id,
      criterion,
      kind,
      ...(evidence !== undefined ? { evidence } : {}),
      ...(typeof row['weight'] === 'number' ? { weight: row['weight'] } : {}),
      ...(row['negative'] === true ? { negative: true } : {}),
      ...(row['veto'] === true ? { veto: true } : {}),
      ...(note !== undefined ? { note } : {}),
    })
  }
  return out
}

/**
 * The `kind: llm-draft` criteria — the ONLY rubric rows an LLM judge ever
 * sees. `objective` rows belong to the probes and `human` rows to the judge
 * bench; showing them here would invite the judge to answer questions its
 * evidence cannot settle.
 * @param rubricText - the rubric YAML as read from the grading layer.
 * @returns the llm-draft criteria in document order (empty when none).
 * @throws Error when the document does not parse as YAML.
 */
export function llmDraftCriteria(rubricText: string): RubricCriterion[] {
  return rubricCriteria(rubricText, 'llm-draft')
}

/**
 * The llm-draft criteria a run's judge is actually asked — the ones inside the
 * plan's stage scope (T84). A leaf that judges a stage this run never executes
 * is neither scored nor put to the judge: asking it would only collect
 * "material missing → false" verdicts the report then has to drop. The stage
 * rule is the one the full score uses ({@link rubricWeightRows}), so the page's
 * 满分, the report's score and the judge's prompt can never disagree.
 * @param rubricText - the rubric YAML.
 * @param scope.task - the item id (the weight rows need it).
 * @param scope.runIn - the item's `runIn` stages (binds `verify.json` evidence).
 * @param scope.planStages - the plan's `stages`; null/empty keeps every criterion.
 * @returns the in-scope criteria in document order and the ids left out.
 * @throws Error when the document does not parse as YAML.
 */
export function judgedCriteria(rubricText: string, scope: {
  task: string
  runIn?: readonly string[] | null
  planStages?: readonly string[] | null
}): { criteria: RubricCriterion[]; outOfScope: string[] } {
  const all = llmDraftCriteria(rubricText)
  const stagesOf = new Map(rubricWeightRows(rubricText, scope.task, { runIn: scope.runIn ?? null }).map(row => [row.id, row.stages]))
  const criteria: RubricCriterion[] = []
  const outOfScope: string[] = []
  for (const criterion of all) {
    if (inStageScope(stagesOf.get(criterion.id) ?? null, scope.planStages)) criteria.push(criterion)
    else outOfScope.push(criterion.id)
  }
  return { criteria, outOfScope }
}

/**
 * The `kind: human` criteria — the judge bench's own rows, and the ONLY ones
 * a person is asked to answer there (ui-spec §五, protocol §6.8). They are
 * deliberately absent from {@link buildJudgePrompt}'s material: a criterion
 * the dataset marked `human` is one the author decided no model should
 * settle, and a bench that asked about the other two thirds would be
 * re-judging work that already has a mechanical answer.
 * @param rubricText - the rubric YAML as read from the grading layer.
 * @returns the human criteria in document order (empty when none).
 * @throws Error when the document does not parse as YAML.
 */
export function humanCriteria(rubricText: string): RubricCriterion[] {
  return rubricCriteria(rubricText, 'human')
}

/**
 * Pick the rubric among an item's `grading` layer display paths. Both dataset
 * layouts are covered: the convention form (`rubric.yml` at the layer root)
 * and the register form (a re-homed `answers/rubric.yml`). Shortest path wins
 * when several match, so a nested variant never shadows the canonical one.
 * @param gradingPaths - display paths of the item's grading layer.
 * @returns the chosen display path, or null when the item ships no rubric.
 */
export function pickRubricPath(gradingPaths: readonly string[]): string | null {
  const candidates = gradingPaths
    .filter(path => /(?:^|\/)rubric\.ya?ml$/i.test(path))
    .sort((a, b) => a.length - b.length || (a < b ? -1 : 1))
  return candidates[0] ?? null
}

/**
 * The executable probes among ONE verify layer's display paths: any `.mjs` or
 * `.sh` file under a `probes/` segment. Both layouts again: `probes/x.mjs`
 * (convention) and `checks/probes/x.mjs` (register). The same rule reads the
 * item's verify layer and the DATASET-level one — a shared probe is a probe.
 * @param verifyPaths - display paths of one verify layer.
 * @returns probe display paths, sorted — that order is the execution order.
 */
export function probePaths(verifyPaths: readonly string[]): string[] {
  return verifyPaths
    .filter(path => /(?:^|\/)probes\/[^/]+\.(?:mjs|sh)$/i.test(path))
    .sort((a, b) => (a < b ? -1 : 1))
}

/**
 * The exit code that means THIS ROUND CANNOT BE JUDGED: the probe is fine and
 * the criterion is not false — the input it needs is simply not in place
 * (stage three never ran, the harness worktree is not in the cell). It is the
 * third state §6.7 gained, and it is recorded WITHOUT being counted a failure.
 *
 * `3` rather than `2` on purpose: `2` is the conventional "usage error" code
 * (this package's own fixture probe exits 2 on a missing `--cell`), so reading
 * 2 as "not applicable" would silently swallow every mis-invoked probe.
 */
export const PROBE_EXIT_NOT_APPLICABLE = 3

/**
 * The judging directory mirrors the DATASET's own layout, so a relative path
 * that resolves in the repository resolves here too. The dataset-level verify
 * layer is a real directory (`datasets/<id>/verify/`), so it lands at
 * `<judging>/verify/…` for every dataset.
 *
 * An ITEM's layer is where the two dataset layouts differ, and getting it
 * wrong costs exactly one directory level. Under the CONVENTION layout the
 * item's files live in `items/<id>/verify/` and their display paths are
 * relative to it (`probes/x.mjs`). Under the REGISTER layout the descriptor
 * re-homes free files into a layer role, and their display paths are
 * ITEM-relative (`checks/probes/x.mjs`) — the file really is at
 * `items/<id>/checks/probes/x.mjs`. Materializing both as
 * `items/<id>/verify/<display>` puts the register item one level too deep, so
 * its `../../../../verify/helpers/lib` resolves above the judging root and
 * the item can only carry a copy of the shared library. That is what
 * {@link itemLayerPath} exists to prevent.
 */
export const DATASET_VERIFY_ROOT = 'verify'

/**
 * The CONVENTION root of an item's verify layer. Still the answer for a
 * convention item, and the fallback cwd for an item that ships no checklist.
 */
export function itemVerifyRoot(taskId: string): string {
  return `items/${taskId}/${DATASET_VERIFY_ROOT}`
}

/** One `register` entry of a dataset descriptor (item-relative patterns). */
export interface RegisterEntry {
  item: string
  layer: string
  /** Item-relative paths or single-segment globs (`*` never crosses `/`). */
  files: string[]
}

/**
 * The register entries a dataset descriptor declares; empty when it declares
 * none, or when the facade did not report a descriptor at all.
 * @param descriptor - the raw descriptor from `datasets.show`.
 */
export function registerEntriesOf(descriptor: unknown): RegisterEntry[] {
  if (typeof descriptor !== 'object' || descriptor === null) return []
  const raw = (descriptor as Record<string, unknown>)['register']
  if (!Array.isArray(raw)) return []
  const entries: RegisterEntry[] = []
  for (const candidate of raw) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const entry = candidate as Record<string, unknown>
    const files = Array.isArray(entry['files']) ? entry['files'].filter((file): file is string => typeof file === 'string') : []
    if (typeof entry['item'] !== 'string' || typeof entry['layer'] !== 'string' || files.length === 0) continue
    entries.push({ item: entry['item'], layer: entry['layer'], files })
  }
  return entries
}

/**
 * Whether a register pattern matches an item-relative path. Segment-wise, and
 * `*` never crosses a `/` — the authoring protocol's rule, restated here
 * rather than imported: community plugins never import sibling @khorsheed
 * packages, and this is six lines pinned by a test against the same cases.
 * @param pattern - an exact path or a single-level glob.
 * @param path - an item-relative path.
 */
export function registerPatternMatches(pattern: string, path: string): boolean {
  const patternSegments = pattern.split('/')
  const pathSegments = path.split('/')
  if (patternSegments.length !== pathSegments.length) return false
  return patternSegments.every((segment, index) => {
    if (!segment.includes('*')) return segment === pathSegments[index]
    const source = segment.replace(/[.*+?^${}()|[\]\\]/g, match => (match === '*' ? '[^/]*' : `\\${match}`))
    return new RegExp(`^${source}$`).test(pathSegments[index] ?? '')
  })
}

/**
 * Where one of an item's layer files really lives, relative to the item
 * directory — the path the judging directory must reproduce.
 * @param input.display - the display path `datasets.show` reported.
 * @param input.register - the descriptor's register entries.
 * @returns `<display>` for a re-homed file, `<layer>/<display>` otherwise.
 */
export function itemLayerPath(input: {
  taskId: string
  layer: string
  display: string
  register: readonly RegisterEntry[]
}): string {
  const rehomed = input.register.some(entry =>
    entry.item === input.taskId && entry.layer === input.layer
    && entry.files.some(pattern => registerPatternMatches(pattern, input.display)))
  return rehomed ? input.display : `${input.layer}/${input.display}`
}

/**
 * The item's checklist among its verify-layer display paths. Shortest path
 * wins when several match, the same rule {@link pickRubricPath} uses.
 * @param verifyPaths - display paths of the item's verify layer.
 */
export function pickChecklistPath(verifyPaths: readonly string[]): string | null {
  const candidates = verifyPaths
    .filter(path => /(?:^|\/)checklist\.ya?ml$/i.test(path))
    .sort((a, b) => a.length - b.length || (a < b ? -1 : 1))
  return candidates[0] ?? null
}

/**
 * The working directory every probe of one item runs in — where the shared
 * probes expect to find that item's `checklist.yml`, and the item's own
 * probes expect to find whatever sits beside them.
 *
 * It is the checklist's own directory, which is the item's verify root under
 * either layout (`items/<id>/verify` by convention, `items/<id>/checks` when
 * the descriptor re-homed the layer). An item with no checklist falls back to
 * the convention root: nothing reads a checklist that does not exist, and the
 * directory still has to be somewhere.
 */
export function itemProbeCwd(input: {
  taskId: string
  itemVerifyPaths: readonly string[]
  register: readonly RegisterEntry[]
}): string {
  const checklist = pickChecklistPath(input.itemVerifyPaths)
  if (checklist === null) return itemVerifyRoot(input.taskId)
  const real = itemLayerPath({ taskId: input.taskId, layer: 'verify', display: checklist, register: input.register })
  const slash = real.lastIndexOf('/')
  return slash < 0 ? `items/${input.taskId}` : `items/${input.taskId}/${real.slice(0, slash)}`
}

/** One probe to execute: which layer it came from, and what it is called. */
export interface ProbeRef {
  /** `item` — the item's own verify layer; `dataset` — the shared one. */
  origin: 'item' | 'dataset'
  /** The probe's display path within its OWN verify layer. */
  display: string
  /** Its path inside the judging directory, relative to that directory's root. */
  file: string
  /** The `by` the orchestrator backfills (§6.7). */
  by: string
}

/**
 * Every probe one cell runs: the dataset's shared probes FIRST (the veto probe
 * lives there and the dataset asks for it first), then the item's own.
 *
 * A shared probe runs ONCE PER ITEM, with that item's verify root as cwd — it
 * is the same ruler applied to each item, so it must be applied as many times
 * as there are items, and it must be able to read the item's own checklist
 * beside it.
 * @param input.datasetVerifyPaths - absent when the facade does not report the
 *   dataset-level layer at all; then only the item's own probes run.
 */
export function collectProbes(input: {
  taskId: string
  itemVerifyPaths: readonly string[]
  datasetVerifyPaths?: readonly string[]
  /** The descriptor's register entries; absent means the convention layout. */
  register?: readonly RegisterEntry[]
}): ProbeRef[] {
  const register = input.register ?? []
  return [
    // `shared/` is a NAMESPACE, not a directory: it marks the verdict as
    // coming from the dataset's ruler rather than this item's, and keeps the
    // two `by` spaces from ever colliding. It is also the prefix the datasets
    // already use to reference these probes from their checklists.
    ...probePaths(input.datasetVerifyPaths ?? []).map((display): ProbeRef => ({
      origin: 'dataset',
      display,
      file: `${DATASET_VERIFY_ROOT}/${display}`,
      by: `shared/${display}`,
    })),
    ...probePaths(input.itemVerifyPaths).map((display): ProbeRef => ({
      origin: 'item',
      display,
      // The REAL relative path: `items/<id>/verify/probes/x.mjs` by
      // convention, `items/<id>/checks/probes/x.mjs` when re-homed. `by` stays
      // the display path either way — that is the verdict's origin, not a
      // location.
      file: `items/${input.taskId}/${itemLayerPath({ taskId: input.taskId, layer: 'verify', display, register })}`,
      by: display,
    })),
  ]
}

/**
 * One piece of a judge prompt: literal text, or the slot one material file's
 * fenced block fills. The pre-run preview renders the slots as UI labels; the
 * run fills them with {@link fencedMaterial}.
 */
export type JudgePromptSegment = { kind: 'text'; text: string } | { kind: 'material'; path: string }

/**
 * The fence around one material: `max(3, longest backtick run + 1)`
 * backticks, so a ``` inside the material cannot close the block early.
 * Material with no run of 3+ keeps the plain ``` (its promptSha unchanged).
 * @param body - the material text as it goes into the prompt.
 */
export function materialFence(body: string): string {
  let longest = 0
  for (const run of body.matchAll(/`+/g)) longest = Math.max(longest, run[0].length)
  return '`'.repeat(Math.max(3, longest + 1))
}

/** The fenced block one material file becomes in the prompt. */
export function fencedMaterial(path: string, text: string): string {
  const body = text.replace(/\s+$/, '')
  const fence = materialFence(body)
  return [`${fence}${path.endsWith('.json') ? 'json' : 'markdown'}`, body, fence].join('\n')
}

/**
 * The judge prompt as segments, material left as slots — the ONE template:
 * {@link buildJudgePrompt} fills it for the run, the preview shows it with
 * its slots labelled.
 * @param input.materialPaths - material file paths, in {@link JUDGE_MATERIAL_FILES} order.
 */
export function judgePromptSegments(input: {
  taskId: string
  judgeConditionId: string
  criteria: readonly RubricCriterion[]
  materialPaths: readonly string[]
}): JudgePromptSegment[] {
  const segments: JudgePromptSegment[] = []
  let lines: string[] = []
  const flush = (): void => {
    if (lines.length > 0) segments.push({ kind: 'text', text: lines.join('\n') })
    lines = []
  }
  lines.push('# 盲评任务')
  lines.push('')
  lines.push('你是本次评测的判官。下面给出一份评分细则与一份选手产出材料，逐条判定并写出结论。')
  lines.push('')
  lines.push('材料已去指纹：harness 名、CLI 名、模型标识一律替换为 `<harness>` 与 `<model>`。')
  lines.push('不要推测材料出自哪一家——推测既不影响判定，也不得写进 evidence。')
  lines.push('只依据材料里能查证的原文判定；材料没写的一律判 false，不要脑补。')
  lines.push('')
  lines.push(`## 判据（共 ${input.criteria.length} 条）`)
  lines.push('')
  for (const criterion of input.criteria) {
    const marks: string[] = []
    if (criterion.negative === true) marks.push('负分项')
    if (criterion.veto === true) marks.push('一票否决')
    lines.push(`### ${criterion.id}${marks.length > 0 ? `（${marks.join(' · ')}）` : ''}`)
    lines.push(`判据：${criterion.criterion}`)
    if (criterion.evidence !== undefined) lines.push(`证据位置：${criterion.evidence}`)
    if (criterion.note !== undefined) lines.push(`附注：${criterion.note}`)
    lines.push('')
  }
  lines.push('## 材料')
  lines.push('')
  for (const path of input.materialPaths) {
    lines.push(`### ${path}`)
    lines.push('')
    flush()
    segments.push({ kind: 'material', path })
    // The blank line after the block opens the next text segment: segments
    // join with '\n', so '' + '\n' + next reproduces the blank line.
    lines.push('')
  }
  lines.push('## 输出要求')
  lines.push('')
  lines.push('把判定写进当前工作目录下的 `verdicts.json`，内容是一个 JSON 数组，每条判据恰好一条：')
  lines.push('')
  lines.push('```json')
  lines.push('[')
  lines.push('  {')
  lines.push(`    "schema": ${JSON.stringify(VERDICT_SCHEMA_ID)},`)
  lines.push(`    "task": ${JSON.stringify(input.taskId)},`)
  lines.push(`    "criterion": ${JSON.stringify(input.criteria[0]?.id ?? 'A1-1')},`)
  lines.push('    "pass": true,')
  lines.push('    "evidence": "引用材料原文的一句话，说明为什么成立",')
  lines.push(`    "by": ${JSON.stringify(input.judgeConditionId)}`)
  lines.push('  }')
  lines.push(']')
  lines.push('```')
  lines.push('')
  lines.push('- `criterion` 必须原样使用上面判据的 id，不要改写、不要翻译。')
  lines.push('- `evidence` 必须引用材料原文（可截取原句），写可查证的事实，不写主观评价。')
  lines.push('- `pass` 只有 true / false，没有中间档。负分项的 `pass: true` 表示「该错误确实出现了」。')
  lines.push('- 只写 `verdicts.json` 这一个文件；不要修改材料，不要新建其他文件。')
  lines.push('')
  flush()
  return segments
}

/** Build the judge prompt (the byte source of `promptSha`). */
export function buildJudgePrompt(input: {
  taskId: string
  judgeConditionId: string
  criteria: readonly RubricCriterion[]
  /** De-identified material, in {@link JUDGE_MATERIAL_FILES} order. */
  materials: ReadonlyArray<{ path: string; text: string }>
}): string {
  const segments = judgePromptSegments({ ...input, materialPaths: input.materials.map(material => material.path) })
  let next = 0
  return segments.map((segment) => {
    if (segment.kind === 'text') return segment.text
    const material = input.materials[next++] as { path: string; text: string }
    return fencedMaterial(material.path, material.text)
  }).join('\n')
}

/** sha256 hex of a utf8 string. */
function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** A file-name-safe form of a path or condition id. */
function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'x'
}

/**
 * What one probe run amounted to (§6.7's three states, spelled out):
 * - `judged` — exit 0 with a readable `--out`, `pass: false` included;
 * - `probe-failed` — any other non-zero exit, or exit 0 with nothing checkable;
 * - `probe-skipped` — {@link PROBE_EXIT_NOT_APPLICABLE}: not this round's question.
 */
export type ProbeStatus = 'judged' | 'probe-failed' | 'probe-skipped'

/** One probe's outcome (the orchestrator ns record). */
export interface ProbeOutcome {
  /** The probe's `by` — its display path, `shared/`-prefixed for a dataset probe. */
  probe: string
  /** Which verify layer it came from. */
  origin: 'item' | 'dataset'
  /** Process exit code; null when the process could not be spawned or was signalled. */
  exitCode: number | null
  /** Which of the three states this run reached. */
  outcome: ProbeStatus
  /**
   * `outcome === 'judged'`. Kept beside `outcome` because the orchestrator ns
   * record already carried it before the third state existed, and pilot A's
   * archives are read with it.
   */
  ok: boolean
  /** Verdicts the probe wrote (empty unless it judged). */
  verdicts: Array<Record<string, unknown>>
  durationMs: number
  /** Why the probe FAILED — non-zero exit, unreadable output, or contract violations. */
  error?: string
  /** Why this round could not be judged (the probe's first stderr line). */
  reason?: string
  /** Coordinates the probe wrote differently and the orchestrator overwrote. */
  overwritten?: string[]
  /** Rows dropped as off-contract while others in the same file stood. */
  dropped?: string[]
}

/**
 * The two coordinates the ORCHESTRATOR knows and the judging side only echoes.
 * A probe or judge that mislabels `task` or `by` would corrupt every
 * downstream join (the report keys rows by task and prints `by` as the
 * verdict's origin); `criterion`, `pass`, `ratio` and `evidence` are the
 * judging side's own and are never touched.
 */
export interface VerdictAnchor {
  task: string
  by: string
}

/**
 * The two numeric facts about `ratio` that JSON Schema cannot state, checked
 * where the artifact is produced rather than where it is read.
 *
 * `report.ts` re-checks the bounds and falls back to the strict boolean, which
 * is the right thing for data already on disk — but a ratio that silently
 * degrades in the report is a verdict whose author never learned it was
 * wrong. Refusing it here is what puts the reason in front of the probe.
 * @returns the violation, or null when the verdict carries no ratio or a sound one.
 */
function ratioViolation(verdict: Record<string, unknown>): string | null {
  const raw = verdict['ratio']
  if (raw === undefined) return null
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'ratio is not an object'
  const { passed, total } = raw as { passed?: unknown; total?: unknown }
  if (typeof passed !== 'number' || typeof total !== 'number'
    || !Number.isInteger(passed) || !Number.isInteger(total)
    || total <= 0 || passed < 0 || passed > total) {
    return `ratio {passed: ${JSON.stringify(passed)}, total: ${JSON.stringify(total)}} is out of bounds`
      + ' — passed and total must be integers with total > 0 and 0 <= passed <= total'
  }
  // `pass` stays the boolean fact that the criterion FULLY holds (§6.5), so
  // for a proportional criterion it IS `passed === total`. The two disagreeing
  // means one of them is a typo, and there is no way to tell which.
  if (verdict['pass'] !== (passed === total)) {
    return `pass: ${JSON.stringify(verdict['pass'])} contradicts ratio ${passed}/${total}`
      + ' — pass is the boolean fact that the criterion fully holds, i.e. passed === total'
  }
  return null
}

/**
 * Read + contract-check a probe's or judge's verdict file.
 *
 * **Backfill comes BEFORE validation.** §6.7 says `task` and `by` are the
 * orchestrator's and are overwritten whatever the judging side wrote — but
 * both are `required` under `additionalProperties: false`, so validating
 * first would void an otherwise complete answer for omitting two fields the
 * orchestrator was about to supply anyway. Everything the schema is actually
 * protecting (`criterion`, `pass`, `ratio`, `evidence`) is still checked, on
 * the anchored document.
 * @param anchor - the coordinates to force in.
 * @returns the anchored verdicts, which coordinates were overwritten (present
 *   but disagreeing — absence is silent, disagreement is recorded), and the
 *   rows that were dropped. A file whose rows are only PARTLY unusable still
 *   yields the good ones, and the dropped ones still have to say why.
 */
function readVerdictFile(path: string, anchor: VerdictAnchor): {
  ok: true
  verdicts: Array<Record<string, unknown>>
  overwritten: string[]
  dropped: string[]
} | { ok: false; error: string } {
  if (!existsSync(path)) return { ok: false, error: `no ${basename(path)} was written` }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return { ok: false, error: `${basename(path)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  // A single verdict object is accepted as a one-element array: the contract
  // asks for an array of dataseek.verdict/1, and refusing the degenerate form
  // would throw away a judgement that is otherwise complete.
  const items = Array.isArray(parsed) ? parsed : [parsed]
  const verdicts: Array<Record<string, unknown>> = []
  const violations: string[] = []
  const overwritten = new Set<string>()
  for (const [index, item] of items.entries()) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      violations.push(`[${index}]: not a JSON object`)
      continue
    }
    const written = item as Record<string, unknown>
    for (const field of ['task', 'by'] as const) {
      if (written[field] !== undefined && written[field] !== anchor[field]) overwritten.add(field)
    }
    const anchored: Record<string, unknown> = { ...written, task: anchor.task, by: anchor.by }
    const problems = validateJson(VERDICT_SCHEMA, anchored)
    if (problems.length > 0) {
      violations.push(`[${index}]: ${problems.join('; ')}`)
      continue
    }
    const ratio = ratioViolation(anchored)
    if (ratio !== null) {
      violations.push(`[${index}]: ${ratio}`)
      continue
    }
    verdicts.push(anchored)
  }
  if (verdicts.length === 0) {
    return { ok: false, error: `${basename(path)} carries no valid ${VERDICT_SCHEMA_ID}: ${violations.join(' | ') || 'the array is empty'}` }
  }
  return { ok: true, verdicts, overwritten: [...overwritten].sort(), dropped: violations }
}

/** What {@link runProbes} needs from its caller. */
export interface ProbeRunInput {
  datasets: DatasetsFace
  repo: string
  datasetId: string
  taskId: string
  commit: string
  /** The player's cell directory — probes READ it, and are never run inside it. */
  cellDir: string
  /** Host-side scratch the two verify layers are materialized into (removed afterwards). */
  probeDir: string
  /** The rubric display path in the grading layer, or null when the item ships none. */
  rubricPath: string | null
  timeoutMs: number
  /**
   * Where the probes run. Omitted, they run on the host out of `probeDir` —
   * the pre-container behavior, byte for byte. The container path passes the
   * unit executor instead; everything else about §6.7 is identical, which is
   * the point of the seam.
   */
  executor?: ProbeExecutor
}

/** {@link runProbes} result. */
export interface ProbeRunResult {
  outcomes: ProbeOutcome[]
  /** Every verdict the probes produced, anchored to the task and the probe path. */
  verdicts: Array<Record<string, unknown>>
  /** Where the probes ran — recorded so a bundle says which mechanism produced its script verdicts. */
  where: 'host' | 'unit'
}

/**
 * Join a layer-relative path onto the judging directory, refusing anything
 * that would land outside it. The datasets service already rejects unsafe
 * relative paths, so this guards the SEAM rather than the service: probes run
 * as host processes, and the directory they are handed must be the one this
 * module built.
 */
function withinProbeDir(probeDir: string, rel: string): string | null {
  const root = resolve(probeDir)
  const target = resolve(root, rel)
  return target.startsWith(root + sep) ? target : null
}

/**
 * Materialize one verify layer into the judging directory at the paths it
 * really occupies in the repository — `homeOf` maps a display path to that
 * location. Reproducing the layout is the whole point: a probe's relative
 * import of the dataset's shared library has to resolve here exactly as it
 * does in a checkout.
 */
async function materializeVerifyLayer(
  input: ProbeRunInput,
  homeOf: (display: string) => string,
  paths: readonly string[],
  itemId: string | undefined,
): Promise<void> {
  for (const rel of paths) {
    const target = withinProbeDir(input.probeDir, homeOf(rel))
    if (target === null) continue
    const file = await input.datasets.read({ repo: input.repo, layers: ['verify'] }, {
      dataset: input.datasetId,
      ...(itemId !== undefined ? { item: itemId } : {}),
      layer: 'verify',
      path: rel,
      commit: input.commit,
    })
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.content, 'utf8')
  }
}

/** The first line of a probe's stderr — what it said before it gave up. */
function firstLine(stderr: string): string {
  return stderr.trim().split('\n')[0]?.trim().slice(0, 400) ?? ''
}

/**
 * Materialize the verify layers into a host-side directory and run every probe
 * against the cell, per the protocol §6.7 contract:
 * `<probe> --cell <cellDir> --rubric <rubric> --out <verdicts.json>`.
 *
 * BOTH verify layers are materialized, in the dataset's own relative layout:
 * the item's at `items/<id>/verify/` and the dataset-level one at `verify/`.
 * That layout is the whole point — an item probe reaches the dataset's shared
 * library by the same relative path that resolves in the repository, so one
 * ruler serves every item instead of a verbatim copy per item drifting apart.
 * The item's verify root is the cwd for every probe, the shared ones included:
 * a shared probe is the same ruler applied once per item, and it reads that
 * item's checklist beside it.
 *
 * The exit code carries the three states of {@link ProbeStatus}. An item with
 * no probes produces nothing at all, honestly: no empty file and no
 * annotation. The probe directory is the caller's to discard
 * ({@link discardProbeDir}) — the verify layer is the answer key and does not
 * outlive its use (architecture §4).
 */
export async function runProbes(input: ProbeRunInput): Promise<ProbeRunResult> {
  const executor = input.executor ?? hostProbeExecutor({ probeDir: input.probeDir, cellDir: input.cellDir })
  const shown = await input.datasets.show(
    { repo: input.repo, layers: ['verify'] },
    input.datasetId,
    input.taskId,
    input.commit,
  )
  const item = shown.items.find(candidate => candidate.id === input.taskId)
  const itemVerifyPaths = item?.layers['verify'] ?? []
  const datasetVerifyPaths = shown.datasetLayers?.['verify'] ?? []
  const register = registerEntriesOf(shown.descriptor)
  const probes = collectProbes({ taskId: input.taskId, itemVerifyPaths, datasetVerifyPaths, register })
  if (probes.length === 0) return { outcomes: [], verdicts: [], where: executor.where }

  const cwd = itemProbeCwd({ taskId: input.taskId, itemVerifyPaths, register })
  // The cwd exists even when the item ships no verify layer of its own: the
  // dataset's shared probes still have to run somewhere, once for this item.
  mkdirSync(join(input.probeDir, cwd), { recursive: true })
  // Whole layers, not just the probe files: a probe reads the checklist beside
  // it and imports its helpers by relative path, exactly as in the repository.
  // The dataset layer is materialized even when it ships no probes at all —
  // it is the shared library the item's own probes import.
  await materializeVerifyLayer(
    input,
    display => `items/${input.taskId}/${itemLayerPath({ taskId: input.taskId, layer: 'verify', display, register })}`,
    itemVerifyPaths,
    input.taskId,
  )
  await materializeVerifyLayer(input, display => `${DATASET_VERIFY_ROOT}/${display}`, datasetVerifyPaths, undefined)

  // The rubric rides along OUTSIDE the mirrored layout (a dotfile at the
  // judging root): the contract hands every probe a --rubric path, and the
  // grading layer must not be reachable from the cell.
  let rubric: string | null = null
  if (input.rubricPath !== null) {
    const loaded = await input.datasets.read({ repo: input.repo, layers: ['grading'] }, {
      dataset: input.datasetId,
      item: input.taskId,
      layer: 'grading',
      path: input.rubricPath,
      commit: input.commit,
    })
    rubric = '.rubric.yml'
    writeFileSync(join(input.probeDir, rubric), loaded.content, 'utf8')
  }

  // Run every probe, THEN read every verdict file. The two phases exist
  // because a unit executor brings its verdicts back in one collect; on the
  // host the split is invisible (each probe already wrote its own file).
  const executions = probes.map((probe): { probe: ProbeRef; execution: ProbeExecution } => ({
    probe,
    execution: {
      file: probe.file,
      shell: /\.sh$/i.test(probe.display),
      cwd,
      slug: slug(probe.by),
      rubric,
      timeoutMs: input.timeoutMs,
    },
  }))
  const ran: Array<{ probe: ProbeRef; execution: ProbeExecution; result: Awaited<ReturnType<ProbeExecutor['run']>>; durationMs: number }> = []
  for (const entry of executions) {
    const startedAt = Date.now()
    const result = await executor.run(entry.execution)
    ran.push({ ...entry, result, durationMs: Date.now() - startedAt })
  }
  const collected = await executor.collect()

  const outcomes: ProbeOutcome[] = []
  const verdicts: Array<Record<string, unknown>> = []
  for (const entry of ran) {
    const { probe, result } = entry
    const common = { probe: probe.by, origin: probe.origin, exitCode: result.code, verdicts: [], durationMs: entry.durationMs }
    if (result.code === PROBE_EXIT_NOT_APPLICABLE) {
      // Not a failure and not a verdict: the probe is fine, the criterion is
      // untouched, and the input it needs is not in this cell. Counting it as
      // a failure is what buried the real failures in pilot A.
      outcomes.push({
        ...common,
        outcome: 'probe-skipped',
        ok: false,
        reason: firstLine(result.stderr) || 'the probe reported nothing on stderr',
      })
      continue
    }
    if (result.code !== 0) {
      outcomes.push({
        ...common,
        outcome: 'probe-failed',
        ok: false,
        error: result.spawnError ?? `probe exited ${String(result.code)}${result.stderr.trim() !== '' ? `: ${firstLine(result.stderr)}` : ''}`,
      })
      continue
    }
    if (!collected.ok) {
      // The probe judged and the answer never reached the host. That is a
      // failure of the RUN, not of the probe, and it says so.
      outcomes.push({
        ...common,
        outcome: 'probe-failed',
        ok: false,
        error: `${probe.by} exited 0 but its verdicts could not be brought back to the host: ${collected.error}`,
      })
      continue
    }
    const read = readVerdictFile(executor.outFile(entry.execution), { task: input.taskId, by: probe.by })
    if (!read.ok) {
      // Exit 0 with unusable output is a CONTRACT violation, not a verdict:
      // the probe claimed it judged and then produced nothing checkable.
      outcomes.push({
        ...common,
        outcome: 'probe-failed',
        ok: false,
        error: `${probe.by} exited 0 but produced no readable verdict: ${read.error}`,
      })
      continue
    }
    outcomes.push({
      ...common,
      outcome: 'judged',
      ok: true,
      verdicts: read.verdicts,
      ...(read.overwritten.length > 0 ? { overwritten: read.overwritten } : {}),
      ...(read.dropped.length > 0 ? { dropped: read.dropped } : {}),
    })
    verdicts.push(...read.verdicts)
  }
  return { outcomes, verdicts, where: executor.where }
}

/** One resolved judge condition (the run loop resolves it once, before executing). */
export interface ResolvedJudge {
  declaredEffort?: string | null
  id: string
  sha: string
  harnessName: string
  declaredModel: string | null
  provider: string
  /**
   * The judge condition's named harness scope, when it declares one. The
   * judge delegates from the orchestrator rather than from a cell, but it
   * reads its credentials from the same place any other condition of that
   * harness does — the scope it named.
   */
  scope?: string
}

/** One llm-draft sample's record. */
export interface JudgeSampleRecord {
  sample: number
  judgeCondition: string
  judgeSha: string
  /** The judge condition's declared model — `validate` refuses a judge without one. */
  judgeModel: string | null
  /**
   * This judge's model is the model the CELL ran (decision 9 as relaxed): the
   * sample is a self-judgement. Not refused, and not silently averaged in
   * either — the report marks the cell and the reader decides.
   */
  selfJudged: boolean
  promptSha: string
  verdicts: Array<Record<string, unknown>>
}

/** What {@link runJudgeSamples} needs from its caller. */
export interface JudgeRunInput {
  readbackWaitMs?: number
  localAgent: LocalAgentFace
  mission: MissionFace
  missionId: string
  runId: string
  by: string
  now: () => number
  taskId: string
  parentSessionId: string
  /**
   * The CELL's own condition — what makes a judge's verdict a SELF-judgement.
   * A judge whose declared model equals this one is judging its own family's
   * work, which decision 9 now allows and the record marks.
   */
  cell: { condition: string; declaredModel: string | null }
  judges: readonly ResolvedJudge[]
  samples: number
  criteria: readonly RubricCriterion[]
  /** De-identified material, in {@link JUDGE_MATERIAL_FILES} order. */
  materials: ReadonlyArray<{ path: string; text: string }>
  /** `<stateRoot>/judge/<runId>/<missionId>/attempt-<N>` — RETAINED after the run. */
  judgeDirBase: string
  log: (message: string) => void
}

/** {@link runJudgeSamples} result. */
export interface JudgeRunResult {
  records: JudgeSampleRecord[]
  /** Judge delegations that never produced a usable verdicts.json. */
  failures: Array<{ judgeCondition: string; sample: number; error: string }>
}

/**
 * Delegate the blind judging: every judge condition × every sample, each in
 * its own working directory, each a FRESH delegation (a resumed judge would
 * see its previous answer and stop being an independent sample).
 *
 * A sample whose `verdicts.json` cannot be read is retried exactly once — the
 * first failure is recorded in the orchestrator ns BEFORE the retry, so a
 * flaky judge stays visible in the ledger instead of being smoothed away.
 */
export async function runJudgeSamples(input: JudgeRunInput): Promise<JudgeRunResult> {
  const records: JudgeSampleRecord[] = []
  const failures: Array<{ judgeCondition: string; sample: number; error: string }> = []
  for (const judge of input.judges) {
    // Two DIFFERENT condition ids naming the same model: the judge and the
    // player are the same subject wearing two hats. `null` on either side is
    // never a match — an unknown model cannot be shown to be the same one
    // (and `validate` refuses a judge that leaves its model null).
    const selfJudged = judge.declaredModel !== null && judge.declaredModel === input.cell.declaredModel
    if (selfJudged) {
      input.log(`judge ${judge.id}: SELF-JUDGED — its model ${JSON.stringify(judge.declaredModel)} is what condition ${input.cell.condition} ran; the sample is recorded and marked, not dropped`)
    }
    const prompt = buildJudgePrompt({
      taskId: input.taskId,
      judgeConditionId: judge.id,
      criteria: input.criteria,
      materials: input.materials,
    })
    const promptSha = sha256Text(prompt)
    samples: for (let sample = 1; sample <= input.samples; sample++) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const sampleDir = join(input.judgeDirBase, slug(judge.id), attempt === 1 ? `sample-${sample}` : `sample-${sample}-retry`)
        mkdirSync(sampleDir, { recursive: true })
        // The material and the prompt live beside the answer: this directory
        // is the review artifact a human re-reads when a verdict is disputed.
        for (const material of input.materials) {
          writeFileSync(join(sampleDir, material.path), material.text, 'utf8')
        }
        writeFileSync(join(sampleDir, 'prompt.md'), prompt, 'utf8')

        const startedAt = input.now()
        let configurationFailure = false
        let outcome: { ok: true; verdicts: Array<Record<string, unknown>>; overwritten: string[]; dropped: string[] } | { ok: false; error: string }
        try {
          requireEffortAdmission(input.localAgent, judge.provider, judge.declaredEffort)
          let settled: DelegationProgress | undefined
          const run = await input.localAgent.start(input.parentSessionId, judge.provider, [{ type: 'text', text: prompt }], {
            ...frozenConfigurationOptions(judge.sha, judge.declaredEffort),
            onProgress: event => { if (event.kind === 'settled') settled = event },
            label: `${input.runId}/${input.missionId} judge:${judge.id}#${sample}`,
            cwd: sampleDir,
            ...(judge.scope === undefined ? {} : { scope: judge.scope }),
            // The judge condition's declared model is requested, not just
            // compared: a judge that declares one model and silently runs the
            // instance default is the T22-step-5 failure, and it is what
            // forced a judge condition to be re-declared into a collision
            // with a player.
            ...(judge.declaredModel === null || judge.declaredModel === undefined ? {} : { model: judge.declaredModel }),
          })
          const admitted = input.localAgent.runConfiguration?.(run)
          const result = await run.result
          const observedModel = settled?.observedModel ?? result.observedModel ?? await awaitObservedModel(input.localAgent, run.id, undefined, input.readbackWaitMs ?? DEFAULT_READBACK_WAIT_MS)
          const reasoning = effortEvidence(judge.declaredEffort, admitted, settled?.observedEffort ?? result.observedEffort)
          if (reasoning.status === 'mismatch' || (observedModel !== null && judge.declaredModel !== null && observedModel !== judge.declaredModel)) {
            configurationFailure = true
            outcome = { ok: false, error: 'Judge frozen model/effort does not match the admitted or observed configuration; verdicts are excluded' }
          } else if (result.stopReason !== 'completed') {
            outcome = { ok: false, error: `judge delegation ended with stopReason ${JSON.stringify(result.stopReason)}${result.diagnostic !== undefined ? `: ${result.diagnostic}` : ''}` }
          } else {
            const read = readVerdictFile(join(sampleDir, 'verdicts.json'), { task: input.taskId, by: judge.id })
            outcome = read.ok
              ? { ok: true, verdicts: read.verdicts, overwritten: read.overwritten, dropped: read.dropped }
              : { ok: false, error: read.error }
          }
          // The judge's cost belongs to the JUDGE, not to the contestant:
          // `kind: 'judge'` keeps it out of the report's efficiency table,
          // which reads `kind: 'delegation'` and nothing else.
          await input.mission.annotate(input.missionId, 'orchestrator', {
            kind: 'judge',
            judgeCondition: judge.id,
            judgeSha: judge.sha,
            judgeModel: judge.declaredModel,
            selfJudged,
            sample,
            attempt,
            childSessionId: run.id,
            promptSha,
            startedAt,
            durationMs: input.now() - startedAt,
            usage: result.usage ?? null,
            model: { declared: judge.declaredModel, observed: observedModel },
            reasoning,
            ...(admitted === undefined ? {} : { configuration: admitted }),
            // Same discipline as the probes: a coordinate the judge wrote
            // differently is overwritten, and the fact that it was is recorded.
            ...(outcome.ok && outcome.overwritten.length > 0 ? { overwritten: outcome.overwritten } : {}),
            ...(outcome.ok && outcome.dropped.length > 0 ? { dropped: outcome.dropped } : {}),
          }, { runId: input.runId, by: input.by }).catch(() => {})
        } catch (error) {
          outcome = { ok: false, error: `judge delegation failed: ${error instanceof Error ? error.message : String(error)}` }
          await input.mission.annotate(input.missionId, 'orchestrator', {
            kind: 'judge',
            judgeCondition: judge.id,
            judgeSha: judge.sha,
            judgeModel: judge.declaredModel,
            selfJudged,
            sample,
            attempt,
            promptSha,
            startedAt,
            durationMs: input.now() - startedAt,
            usage: null,
            model: { declared: judge.declaredModel, observed: null },
            error: outcome.error,
          }, { runId: input.runId, by: input.by }).catch(() => {})
        }

        if (outcome.ok) {
          records.push({ sample, judgeCondition: judge.id, judgeSha: judge.sha, judgeModel: judge.declaredModel, selfJudged, promptSha, verdicts: outcome.verdicts })
          break
        }
        await input.mission.annotate(input.missionId, 'orchestrator', {
          kind: 'judge-parse-failed',
          judgeCondition: judge.id,
          sample,
          attempt,
          cwd: sampleDir,
          error: outcome.error,
        }, { runId: input.runId, by: input.by }).catch(() => {})
        if (configurationFailure) {
          failures.push({ judgeCondition: judge.id, sample, error: outcome.error })
          input.log(`judge ${judge.id} sample ${sample}: ${outcome.error} — configuration failure, no retry`)
          break samples
        }
        input.log(`judge ${judge.id} sample ${sample}: ${outcome.error}${attempt === 1 ? ' — retrying once' : ' — sample dropped'}`)
        if (attempt === 2) failures.push({ judgeCondition: judge.id, sample, error: outcome.error })
      }
    }
  }
  return { records, failures }
}

/**
 * Remove a probe directory, best effort (the verify layer never outlives its
 * use). The container path discards through the executor instead — it has an
 * in-unit directory to remove as well — and this stays the host path's name
 * for the same act.
 */
export function discardProbeDir(probeDir: string): void {
  discardDir(probeDir)
}
