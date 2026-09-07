/**
 * The judging half of the orchestrator (I2·T9): the two MECHANICAL verdict
 * sources of the three the flow declares. `script` verdicts come from
 * deterministic probes the dataset ships in its `verify` layer; `llm-draft`
 * verdicts come from a JUDGE CONDITION — the judge is itself a
 * `dataseek.condition/1`, delegated exactly like a player, never a session
 * with tools. `human-final` stays a person's act and is written elsewhere.
 *
 * Frozen decision 9 is the whole design: the judge must not be a contestant,
 * the material is de-fingerprinted before it is shown, and every criterion is
 * sampled at least twice so the report can print an agreement number instead
 * of a single opinion.
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
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import yaml from 'js-yaml'
import type { DatasetsFace, LocalAgentFace, MissionFace } from './faces.ts'
import { validateJson, VERDICT_SCHEMA, VERDICT_SCHEMA_ID } from './schema.ts'

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
 * The `kind: llm-draft` criteria of a `dataseek.rubric/2` document — the ONLY
 * rubric rows an LLM judge ever sees. `objective` rows belong to the probes
 * and `human` rows to the judge bench; showing them here would invite the
 * judge to answer questions its evidence cannot settle.
 * @param rubricText - the rubric YAML as read from the grading layer.
 * @returns the llm-draft criteria in document order (empty when none).
 * @throws Error when the document does not parse as YAML.
 */
export function llmDraftCriteria(rubricText: string): RubricCriterion[] {
  const doc = yaml.load(rubricText) as { items?: unknown } | null
  const items = doc !== null && typeof doc === 'object' && Array.isArray((doc as { items?: unknown }).items)
    ? (doc as { items: unknown[] }).items
    : []
  const out: RubricCriterion[] = []
  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
    const row = raw as Record<string, unknown>
    if (row['kind'] !== 'llm-draft') continue
    const id = asString(row['id'])
    const criterion = asString(row['criterion'])
    if (id === undefined || criterion === undefined) continue
    const evidence = asString(row['evidence'])
    const note = asString(row['note'])
    out.push({
      id,
      criterion,
      kind: 'llm-draft',
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
 * The executable probes among an item's `verify` layer display paths: any
 * `.mjs` or `.sh` file under a `probes/` segment. Both layouts again:
 * `probes/x.mjs` (convention) and `checks/probes/x.mjs` (register).
 * @param verifyPaths - display paths of the item's verify layer.
 * @returns probe display paths, sorted — that order is the execution order.
 */
export function probePaths(verifyPaths: readonly string[]): string[] {
  return verifyPaths
    .filter(path => /(?:^|\/)probes\/[^/]+\.(?:mjs|sh)$/i.test(path))
    .sort((a, b) => (a < b ? -1 : 1))
}

/** Build the judge prompt (the byte source of `promptSha`). */
export function buildJudgePrompt(input: {
  taskId: string
  judgeConditionId: string
  criteria: readonly RubricCriterion[]
  /** De-identified material, in {@link JUDGE_MATERIAL_FILES} order. */
  materials: ReadonlyArray<{ path: string; text: string }>
}): string {
  const lines: string[] = []
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
  for (const material of input.materials) {
    lines.push(`### ${material.path}`)
    lines.push('')
    lines.push(material.path.endsWith('.json') ? '```json' : '```markdown')
    lines.push(material.text.replace(/\s+$/, ''))
    lines.push('```')
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
  return `${lines.join('\n')}\n`
}

/** sha256 hex of a utf8 string. */
function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** A file-name-safe form of a path or condition id. */
function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'x'
}

/** One probe's outcome (the orchestrator ns record). */
export interface ProbeOutcome {
  /** The probe's display path in the verify layer. */
  probe: string
  /** Process exit code; null when the process could not be spawned or was signalled. */
  exitCode: number | null
  /** True when the probe both exited 0 and produced a readable verdict array. */
  ok: boolean
  /** Verdicts the probe wrote (empty when it failed). */
  verdicts: Array<Record<string, unknown>>
  durationMs: number
  /** Why the probe is not `ok` — non-zero exit, unreadable output, or contract violations. */
  error?: string
}

/** Spawn one probe and capture its exit code (never throws). */
function spawnProbe(command: string, args: readonly string[], cwd: string, timeoutMs: number): Promise<{
  code: number | null
  stderr: string
  spawnError?: string
}> {
  return new Promise((resolvePromise) => {
    execFile(command, [...args], { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error === null) return resolvePromise({ code: 0, stderr: String(stderr) })
      const code = typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : null
      resolvePromise({
        code,
        stderr: String(stderr),
        ...(code === null ? { spawnError: error.message } : {}),
      })
    })
  })
}

/** Read + contract-check a probe's or judge's verdict file. */
function readVerdictFile(path: string): { ok: true; verdicts: Array<Record<string, unknown>> } | { ok: false; error: string } {
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
  for (const [index, item] of items.entries()) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      violations.push(`[${index}]: not a JSON object`)
      continue
    }
    const problems = validateJson(VERDICT_SCHEMA, item)
    if (problems.length > 0) {
      violations.push(`[${index}]: ${problems.join('; ')}`)
      continue
    }
    verdicts.push(item as Record<string, unknown>)
  }
  if (verdicts.length === 0) {
    return { ok: false, error: `${basename(path)} carries no valid ${VERDICT_SCHEMA_ID}: ${violations.join(' | ') || 'the array is empty'}` }
  }
  return { ok: true, verdicts }
}

/**
 * Force the two coordinates the ORCHESTRATOR knows and the judge only echoes.
 * A judge that mislabels `task` or `by` would corrupt every downstream join
 * (the report keys rows by task and prints `by` as the verdict's origin);
 * `criterion`, `pass` and `evidence` are the judge's own and are untouched.
 */
function anchorVerdicts(verdicts: readonly Record<string, unknown>[], taskId: string, by: string): Array<Record<string, unknown>> {
  return verdicts.map(verdict => ({ ...verdict, task: taskId, by }))
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
  /** Host-side scratch the verify layer is materialized into (removed afterwards). */
  probeDir: string
  /** The rubric display path in the grading layer, or null when the item ships none. */
  rubricPath: string | null
  timeoutMs: number
}

/** {@link runProbes} result. */
export interface ProbeRunResult {
  outcomes: ProbeOutcome[]
  /** Every verdict the probes produced, anchored to the task and the probe path. */
  verdicts: Array<Record<string, unknown>>
}

/**
 * Materialize the item's `verify` layer into a host-side directory and run
 * every probe under it against the cell, per the protocol §6.7 contract:
 * `<probe> --cell <cellDir> --rubric <rubric> --out <verdicts.json>`; exit 0
 * means JUDGED (including `pass: false`), non-zero means the probe failed.
 *
 * An item with no probes produces nothing at all, honestly: no empty file and
 * no annotation. The probe directory is the caller's to discard
 * ({@link discardProbeDir}) — the verify layer is the answer key and does not
 * outlive its use (architecture §4).
 */
export async function runProbes(input: ProbeRunInput): Promise<ProbeRunResult> {
  const shown = await input.datasets.show(
    { repo: input.repo, layers: ['verify'] },
    input.datasetId,
    input.taskId,
    input.commit,
  )
  const item = shown.items.find(candidate => candidate.id === input.taskId)
  const verifyFiles = item?.layers['verify'] ?? []
  const probes = probePaths(verifyFiles)
  if (probes.length === 0) return { outcomes: [], verdicts: [] }

  mkdirSync(input.probeDir, { recursive: true })
  // The whole verify layer is materialized, not just the probe files: a probe
  // reads the checklist beside it and sources its shared helpers by relative
  // path, exactly as it does in the repository.
  for (const rel of verifyFiles) {
    const file = await input.datasets.read({ repo: input.repo, layers: ['verify'] }, {
      dataset: input.datasetId,
      item: input.taskId,
      layer: 'verify',
      path: rel,
      commit: input.commit,
    })
    mkdirSync(dirname(join(input.probeDir, rel)), { recursive: true })
    writeFileSync(join(input.probeDir, rel), file.content, 'utf8')
  }
  // The rubric rides along as a sibling: the contract hands every probe a
  // --rubric path, and the grading layer must not be reachable from the cell.
  let rubricArg = ''
  if (input.rubricPath !== null) {
    const rubric = await input.datasets.read({ repo: input.repo, layers: ['grading'] }, {
      dataset: input.datasetId,
      item: input.taskId,
      layer: 'grading',
      path: input.rubricPath,
      commit: input.commit,
    })
    rubricArg = join(input.probeDir, '.rubric.yml')
    writeFileSync(rubricArg, rubric.content, 'utf8')
  }

  const outDir = join(input.probeDir, '.out')
  mkdirSync(outDir, { recursive: true })
  const outcomes: ProbeOutcome[] = []
  const verdicts: Array<Record<string, unknown>> = []
  for (const probe of probes) {
    const probeFile = join(input.probeDir, probe)
    const outFile = join(outDir, `${slug(probe)}.json`)
    const args = ['--cell', input.cellDir, ...(rubricArg !== '' ? ['--rubric', rubricArg] : []), '--out', outFile]
    const startedAt = Date.now()
    const spawned = await spawnProbe(
      /\.sh$/i.test(probe) ? '/bin/sh' : process.execPath,
      [probeFile, ...args],
      input.probeDir,
      input.timeoutMs,
    )
    const durationMs = Date.now() - startedAt
    if (spawned.code !== 0) {
      outcomes.push({
        probe,
        exitCode: spawned.code,
        ok: false,
        verdicts: [],
        durationMs,
        error: spawned.spawnError ?? `probe exited ${String(spawned.code)}${spawned.stderr.trim() !== '' ? `: ${spawned.stderr.trim().slice(0, 400)}` : ''}`,
      })
      continue
    }
    const read = readVerdictFile(outFile)
    if (!read.ok) {
      // Exit 0 with unusable output is a CONTRACT violation, not a verdict:
      // the probe claimed it judged and then produced nothing checkable.
      outcomes.push({
        probe,
        exitCode: 0,
        ok: false,
        verdicts: [],
        durationMs,
        error: `${probe} exited 0 but produced no readable verdict: ${read.error}`,
      })
      continue
    }
    const anchored = anchorVerdicts(read.verdicts, input.taskId, probe)
    outcomes.push({ probe, exitCode: 0, ok: true, verdicts: anchored, durationMs })
    verdicts.push(...anchored)
  }
  return { outcomes, verdicts }
}

/** One resolved judge condition (the run loop resolves it once, before executing). */
export interface ResolvedJudge {
  id: string
  sha: string
  harnessName: string
  declaredModel: string | null
  provider: string
}

/** One llm-draft sample's record. */
export interface JudgeSampleRecord {
  sample: number
  judgeCondition: string
  judgeSha: string
  promptSha: string
  verdicts: Array<Record<string, unknown>>
}

/** What {@link runJudgeSamples} needs from its caller. */
export interface JudgeRunInput {
  localAgent: LocalAgentFace
  mission: MissionFace
  missionId: string
  runId: string
  by: string
  now: () => number
  taskId: string
  parentSessionId: string
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
    const prompt = buildJudgePrompt({
      taskId: input.taskId,
      judgeConditionId: judge.id,
      criteria: input.criteria,
      materials: input.materials,
    })
    const promptSha = sha256Text(prompt)
    for (let sample = 1; sample <= input.samples; sample++) {
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
        let outcome: { ok: true; verdicts: Array<Record<string, unknown>> } | { ok: false; error: string }
        try {
          const run = await input.localAgent.start(input.parentSessionId, judge.provider, [{ type: 'text', text: prompt }], {
            label: `${input.runId}/${input.missionId} judge:${judge.id}#${sample}`,
            cwd: sampleDir,
          })
          const result = await run.result
          if (result.stopReason !== 'completed') {
            outcome = { ok: false, error: `judge delegation ended with stopReason ${JSON.stringify(result.stopReason)}${result.diagnostic !== undefined ? `: ${result.diagnostic}` : ''}` }
          } else {
            const read = readVerdictFile(join(sampleDir, 'verdicts.json'))
            outcome = read.ok
              ? { ok: true, verdicts: anchorVerdicts(read.verdicts, input.taskId, judge.id) }
              : { ok: false, error: read.error }
          }
          // The judge's cost belongs to the JUDGE, not to the contestant:
          // `kind: 'judge'` keeps it out of the report's efficiency table,
          // which reads `kind: 'delegation'` and nothing else.
          await input.mission.annotate(input.missionId, 'orchestrator', {
            kind: 'judge',
            judgeCondition: judge.id,
            judgeSha: judge.sha,
            sample,
            attempt,
            childSessionId: run.id,
            promptSha,
            startedAt,
            durationMs: input.now() - startedAt,
            usage: result.usage ?? null,
            model: { declared: judge.declaredModel, observed: result.observedModel ?? null },
          }, { runId: input.runId, by: input.by }).catch(() => {})
        } catch (error) {
          outcome = { ok: false, error: `judge delegation failed: ${error instanceof Error ? error.message : String(error)}` }
          await input.mission.annotate(input.missionId, 'orchestrator', {
            kind: 'judge',
            judgeCondition: judge.id,
            judgeSha: judge.sha,
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
          records.push({ sample, judgeCondition: judge.id, judgeSha: judge.sha, promptSha, verdicts: outcome.verdicts })
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
        input.log(`judge ${judge.id} sample ${sample}: ${outcome.error}${attempt === 1 ? ' — retrying once' : ' — sample dropped'}`)
        if (attempt === 2) failures.push({ judgeCondition: judge.id, sample, error: outcome.error })
      }
    }
  }
  return { records, failures }
}

/** Remove a probe directory, best effort (the verify layer never outlives its use). */
export function discardProbeDir(probeDir: string): void {
  try {
    rmSync(probeDir, { recursive: true, force: true })
  } catch {
    // A probe that left an unremovable file behind is not a run failure.
  }
}
