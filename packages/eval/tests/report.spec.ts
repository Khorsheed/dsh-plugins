import { existsSync, readFileSync } from 'node:fs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli-core.ts'
import {
  analyzeBundle, parseMissionId, writeEvalReport,
  type EvalReport, type PairTaskDelta, type ReportRow,
} from '../src/report.ts'
import { EvalService } from '../src/service.ts'
import { RUBRIC_WEIGHTS_PATH, RUBRIC_WEIGHTS_SCHEMA } from '../src/weights.ts'
import { captureIo, cleanupTmp, tmpTree } from './helpers.ts'

afterEach(cleanupTmp)

// --- fixture builder ---------------------------------------------------------

const sha = (prefix: string): string => prefix.padEnd(64, '0')

const verdict = (task: string, criterion: string, pass: boolean, by = 'probes/probe.mjs', ratio?: unknown): Record<string, unknown> => ({
  schema: 'dataseek.verdict/1', task, criterion, pass,
  ...(ratio !== undefined ? { ratio } : {}),
  evidence: `${criterion} ${pass ? '通过' : '未过'}（可查证事实）`, by,
})

const delegation = (
  stage: string,
  round: number,
  durationMs: number,
  outputTokens: number,
  observed = 'gpt-x',
  toolCalls?: { count: number; byName?: Record<string, number> },
): Record<string, unknown> => ({
  kind: 'delegation', stage, round, childSessionId: `sess-${round}`, promptSha: sha('ab'), startedAt: 0,
  durationMs, usage: { inputTokens: outputTokens * 3, outputTokens },
  ...(toolCalls === undefined ? {} : { toolCalls }),
  model: { declared: 'gpt-x', observed },
})

interface FixtureAnnotation {
  ns: string
  by: string
  payload: unknown
  createdAt?: number
  stage?: string
}

interface FixtureAttempt {
  attempt: number
  state?: string
  refs?: Record<string, unknown>
  /** Extra artifact bytes written under the attempt's artifacts/ (rel path → text). */
  files?: Record<string, string>
  artifacts?: Array<{ path: string; kind?: string }>
  annotations: FixtureAnnotation[]
  retry?: { reason: string; category: string }
}

interface FixtureMission {
  id: string
  attempts: FixtureAttempt[]
  /**
   * The cell anchor the orchestrator writes before any work (T8b). Omitted,
   * the builder derives it from the mission id against meta.conditions —
   * exactly the naming the run loop uses. `null` builds a bundle WITHOUT an
   * anchor (a run predating T8b).
   */
  anchor?: { task?: string | null; condition?: string; conditionSha?: string | null; rep?: number | null } | null
}

interface FixtureSpec {
  runId: string
  meta: Record<string, unknown>
  missions: FixtureMission[]
  manifest?: Record<string, unknown> | null
  /** rel path under the bundle's dataset/ → JSON content. */
  datasetFiles?: Record<string, unknown>
  /** rel path under the bundle's dataset/ → raw text (a YAML rubric of a guarded export). */
  datasetText?: Record<string, string>
  /** The derived polarity/weight table the export writes into report/. */
  weightsTable?: Record<string, unknown>
}

function attemptFiles(attempt: FixtureAttempt): Record<string, string> {
  const files: Record<string, string> = { ...(attempt.files ?? {}) }
  if (attempt.artifacts?.some(a => a.kind === 'materialization') && files['materialization.json'] === undefined) {
    throw new Error('fixture: materialization artifact needs its bytes in files')
  }
  return files
}

/**
 * The orchestrator's cell anchor (T8b): one orchestrator-ns annotation per
 * cell, written before any work — the report's only identity source.
 */
const cellNote = (anchor: { task: string | null; condition: string; conditionSha: string | null; rep: number | null }): FixtureAnnotation => ({
  ns: 'orchestrator', by: 'orchestrator', createdAt: -1, payload: [{ kind: 'cell', ...anchor }],
})

/** Derive one mission's anchor from its id against the run's condition table. */
function anchorFor(mission: FixtureMission, conditions: Array<{ id: string; sha: string | null }>): FixtureAnnotation | null {
  if (mission.anchor === null) return null
  const parsed = parseMissionId(mission.id, conditions.map(c => c.id))
  const condition = mission.anchor?.condition ?? parsed.condition
  if (condition === null) return null
  return cellNote({
    task: mission.anchor?.task ?? parsed.task,
    condition,
    conditionSha: mission.anchor?.conditionSha ?? conditions.find(c => c.id === condition)?.sha ?? null,
    rep: mission.anchor?.rep ?? parsed.rep,
  })
}

function writeBundle(root: string, spec: FixtureSpec): string {
  const bundle = join(root, `${spec.runId}-bundle`)
  mkdirSync(bundle, { recursive: true })
  const meta = {
    datasetId: 'harness-comparison',
    commit: sha('c0'),
    planSha: sha('p1'),
    evalVersion: '0.1.0-rc.1+1fc4fbc',
    expectedNs: ['script', 'llm-draft', 'human-final'],
    ...spec.meta,
  }
  writeFileSync(join(bundle, 'run.json'), `${JSON.stringify({
    id: spec.runId, createdAt: 0, state: 'closed', meta, stateMachine: { states: [], transitions: [] },
  }, null, 2)}\n`)
  if (spec.manifest !== null) {
    writeFileSync(join(bundle, 'manifest.json'), `${JSON.stringify(spec.manifest ?? {
      runId: spec.runId, exportedAt: 0, layers: [], guardedLayers: [], nsReport: [], contentHashes: {},
    }, null, 2)}\n`)
  }
  for (const [rel, value] of Object.entries(spec.datasetFiles ?? {})) {
    const file = join(bundle, 'dataset', rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
  }
  for (const [rel, text] of Object.entries(spec.datasetText ?? {})) {
    const file = join(bundle, 'dataset', rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
  if (spec.weightsTable !== undefined) {
    const file = join(bundle, RUBRIC_WEIGHTS_PATH)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(spec.weightsTable, null, 2)}\n`)
  }
  const conditionTable = (Array.isArray(meta.conditions) ? meta.conditions : [])
    .filter((entry): entry is { id: string; sha: string | null } => typeof entry === 'object' && entry !== null && typeof (entry as { id?: unknown }).id === 'string')
  for (const mission of spec.missions) {
    // The anchor rides the mission's FIRST attempt, exactly as the run loop
    // writes it (before any work); later attempts inherit it in the report.
    const anchor = anchorFor(mission, conditionTable)
    const firstAttempt = Math.min(...mission.attempts.map(a => a.attempt))
    for (const attempt of mission.attempts) {
      const annotations = anchor !== null && attempt.attempt === firstAttempt
        ? [anchor, ...attempt.annotations]
        : attempt.annotations
      const dir = join(bundle, 'missions', mission.id, `attempt-${attempt.attempt}`)
      mkdirSync(join(dir, 'artifacts'), { recursive: true })
      writeFileSync(join(dir, 'meta.json'), `${JSON.stringify({
        attempt: attempt.attempt,
        state: attempt.state ?? 'released',
        ...(attempt.retry !== undefined ? { retry: attempt.retry } : {}),
        refs: attempt.refs ?? {},
        enteredAt: {}, checkpoints: [], history: [],
        artifacts: attempt.artifacts ?? [], attestations: [],
      }, null, 2)}\n`)
      writeFileSync(join(dir, 'annotations.json'), `${JSON.stringify(annotations.map((annotation, index) => ({
        missionId: mission.id, attempt: attempt.attempt, ns: annotation.ns, payload: annotation.payload,
        createdAt: annotation.createdAt ?? index, by: annotation.by,
        ...(annotation.stage !== undefined ? { stage: annotation.stage } : {}),
      })), null, 2)}\n`)
      for (const [rel, text] of Object.entries(attemptFiles(attempt))) {
        mkdirSync(join(dir, 'artifacts', rel, '..'), { recursive: true })
        writeFileSync(join(dir, 'artifacts', rel), text)
      }
    }
  }
  return bundle
}

/**
 * One script-verdict annotation carrying the given docs. The optional third
 * tuple slot is the verdict's `ratio` (protocol §6.5) — passed through raw so
 * a test can also hand in a malformed one.
 */
const scriptNote = (task: string, docs: Array<[string, boolean, unknown?]>, by = 'cli', createdAt = 0): FixtureAnnotation => ({
  ns: 'script', by, createdAt, payload: docs.map(([criterion, pass, ratio]) => verdict(task, criterion, pass, 'probes/probe.mjs', ratio)),
})

/** One delegation annotation for a cell. */
const orchestratorNote = (
  stage: string,
  round: number,
  durationMs: number,
  tokens: number,
  observed = 'gpt-x',
  createdAt = 0,
  toolCalls?: { count: number; byName?: Record<string, number> },
): FixtureAnnotation => ({
  ns: 'orchestrator', by: 'orchestrator', createdAt,
  payload: [delegation(stage, round, durationMs, tokens, observed, toolCalls)],
})

const matArtifact = (matSha: string): { artifacts: Array<{ path: string; kind: string }>; files: Record<string, string> } => ({
  artifacts: [{ path: 'materialization.json', kind: 'materialization' }],
  files: { 'materialization.json': `${JSON.stringify({ files: [{ path: 'task.md', sha: sha('ee') }], sha: matSha }, null, 2)}\n` },
})

/**
 * The materialization record EXACTLY as the run loop writes it: the overall
 * digest is `sha256`, and `source` carries per-cell facts — the worktree path
 * plus `reused`, which is false for the cell that creates the dataset worktree
 * and true for every cell after it. A reader that hashed the record's bytes
 * instead of reading the digest field therefore sees a different value per
 * cell, which is exactly what the first real two-cell bundle did.
 */
const runLoopMatArtifact = (matSha: string, cellDir: string, reused = false): { artifacts: Array<{ path: string; kind: string }>; files: Record<string, string> } => ({
  artifacts: [{ path: 'materialization.json', kind: 'materialization' }],
  files: {
    'materialization.json': `${JSON.stringify({
      dataset: 'harness-comparison',
      task: 'P0-placeholder',
      commit: sha('c0'),
      layers: ['visible'],
      source: { worktree: cellDir, reused },
      files: [{ path: 'task.md', sha256: sha('ee') }],
      sha256: matSha,
    }, null, 2)}\n`,
  },
})

/** A full-fare condition entry (invariant-3 compatible). */
const conditionEntry = (id: string, doc: Record<string, unknown>, prefix: string): Record<string, unknown> =>
  ({ id, sha: sha(prefix), condition: doc })

const baseConditionDoc = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema: 'dataseek.condition/1',
  harness: { name: 'codex', version: '0.30.0', drive: 'exec' },
  model: { declared: 'gpt-x', endpoint: 'proxy' },
  reasoning: { effort: 'high' },
  permissions: 'danger-full-access',
  instructions: 'none',
  preset: null,
  skills: { pack: null },
  home: { sha: sha('dd') },
  env: { keys: ['OPENAI_BASE_URL'] },
  ...overrides,
})

/** Standard satisfied fingerprint/refs. */
const goodRefs = (fp = sha('f9')): Record<string, unknown> => ({ fingerprint: fp })

// --- parseMissionId ----------------------------------------------------------

describe('parseMissionId', () => {
  it('splits task/condition/rep against the condition list (longest suffix wins)', () => {
    expect(parseMissionId('F2-multi-agent-room-codex-exec-rep2', ['dsh-exec', 'codex-exec']))
      .toEqual({ task: 'F2-multi-agent-room', condition: 'codex-exec', rep: 2 })
    expect(parseMissionId('p0-dsh-exec-rep1', ['dsh-exec']))
      .toEqual({ task: 'p0', condition: 'dsh-exec', rep: 1 })
  })

  it('stays null when the conditions list cannot anchor the split', () => {
    expect(parseMissionId('p0-dsh-exec-rep1', [])).toEqual({ task: null, condition: null, rep: 1 })
    expect(parseMissionId('p0-dsh-exec-rep1', ['codex-exec'])).toEqual({ task: null, condition: null, rep: 1 })
  })
})

// --- S1 · single condition ----------------------------------------------------

function singleConditionBundle(root: string): string {
  return writeBundle(root, {
    runId: 'single',
    meta: {
      conditions: [conditionEntry('dsh-exec', baseConditionDoc({ harness: { name: 'dsh', version: '1.0', drive: 'exec' }, permissions: 'unrestricted' }), 'a1')],
      pricing: { 'dsh-exec': 1.5 },
    },
    missions: [
      {
        id: 'P0-dsh-exec-rep1',
        attempts: [
          {
            attempt: 1, state: 'archived', refs: goodRefs(),
            ...matArtifact(sha('m1')),
            annotations: [scriptNote('P0-placeholder', [['placeholder-check', true]])],
          },
          {
            attempt: 2, state: 'released', refs: goodRefs(), retry: { reason: 'workspace-copy-failed', category: 'infrastructure' },
            ...matArtifact(sha('m1')),
            annotations: [scriptNote('P0-placeholder', [['placeholder-check', true]], 'cli', 1), orchestratorNote('stage1', 1, 60_000, 900)],
          },
        ],
      },
      {
        id: 'P0-dsh-exec-rep2',
        attempts: [{
          attempt: 1, state: 'released', refs: goodRefs(),
          ...matArtifact(sha('m1')),
          annotations: [scriptNote('P0-placeholder', [['placeholder-check', true]]), orchestratorNote('stage1', 1, 30_000, 700)],
        }],
      },
    ],
  })
}

describe('report — S1 single condition', () => {
  it('allows comparison machinery but finds no pair; retries counted separately', async () => {
    const report = await analyzeBundle(singleConditionBundle(tmpTree()))
    expect(report.comparisonAllowed).toBe(true)
    expect(report.singleCondition).toBe(true)
    expect(report.comparisons).toEqual([])
    expect(report.missions).toBe(2)
    expect(report.attempts).toBe(3)
    expect(report.retries).toBe(1)
    expect(report.rows).toHaveLength(3) // attempt-1 + attempt-2 verdicts are all rows
    expect(report.invariants.every(i => i.status === 'ok')).toBe(true)
    expect(report.efficiency[0]?.activeMs).toBe(90_000)
    expect(report.efficiency[0]?.price).toBe(1.5)
  })
})

// --- S2 · two conditions, one factor, full stack --------------------------------

function twoConditionBundle(root: string, opts: { reps?: number; multiFactor?: boolean; manifestWriters?: boolean } = {}): string {
  const reps = opts.reps ?? 3
  const docB = opts.multiFactor === true
    ? baseConditionDoc({ preset: 'eval-pack', model: { declared: 'gpt-y', endpoint: 'proxy' }, skills: { pack: 'web-eval' } })
    : baseConditionDoc({ preset: 'eval-pack' })
  const missions: FixtureMission[] = []
  for (const task of ['F2', 'F3']) {
    const matSha = sha(task === 'F2' ? 'm2' : 'm3')
    for (const [condition, conditionId] of [['a', 'codex-exec'], ['b', 'claude-exec']] as const) {
      for (let rep = 1; rep <= reps; rep++) {
        // A passes both criteria on F2 reps 1-3 (scores 2,2,3 via D1 failing on rep3) and both on F3;
        // B passes only C4. One infra retry on A/F2/rep1.
        const aD1 = task === 'F2' && rep === 3 ? false : true
        const attempt: FixtureAttempt = {
          attempt: 1, state: 'released', refs: goodRefs(),
          ...matArtifact(matSha),
          annotations: [
            {
              ns: 'human-final', by: 'judge-bench', createdAt: 10,
              payload: [verdict(task, 'C4', true, 'bench'), verdict(task, 'D1', condition === 'a' ? aD1 : false, 'bench')],
            },
            orchestratorNote('stage1', 1, condition === 'a' ? 60_000 : 45_000, condition === 'a' ? 1200 : 900),
            ...(condition === 'a' && task === 'F2' && rep === 1 ? [{
              ns: 'orchestrator', by: 'orchestrator', createdAt: 1,
              payload: [delegation('stage2', 2, 20_000, 300)],
            } as FixtureAnnotation] : []),
          ],
        }
        missions.push({
          id: `${task}-${conditionId}-rep${rep}`,
          attempts: condition === 'a' && task === 'F2' && rep === 1
            ? [
                { ...attempt, attempt: 1, state: 'archived', retry: { reason: 'spawn-failed', category: 'infrastructure' }, annotations: [] },
                attempt,
              ]
            : [attempt],
        })
      }
    }
  }
  // Judge double-sample on one cell: sample1 (C4 T, D1 T), sample2 (C4 T, D1 F); human says C4 T, D1 T.
  const judged = missions.find(m => m.id === 'F2-codex-exec-rep1')
  judged?.attempts[1]?.annotations.push(
    {
      ns: 'llm-draft', by: 'judge-runner', createdAt: 5,
      payload: [verdict('F2', 'C4', true, 'judge-cond'), verdict('F2', 'D1', true, 'judge-cond')],
    },
    {
      ns: 'llm-draft', by: 'judge-runner', createdAt: 6,
      payload: [verdict('F2', 'C4', true, 'judge-cond'), verdict('F2', 'D1', false, 'judge-cond')],
    },
  )
  return writeBundle(root, {
    runId: 'pair',
    meta: {
      conditions: [
        conditionEntry('codex-exec', baseConditionDoc(), 'aa'),
        conditionEntry('claude-exec', docB, 'bb'),
      ],
      pricing: { 'codex-exec': 3.5 },
      ...(opts.multiFactor === true ? {} : {}),
    },
    missions,
    manifest: opts.manifestWriters === true
      ? {
          runId: 'pair', exportedAt: 0, layers: [], guardedLayers: [],
          nsReport: missions.map(mission => ({
            missionId: mission.id, attempt: mission.attempts[mission.attempts.length - 1]?.attempt ?? 1,
            present: ['script'], expectedPresent: ['script'], missing: ['llm-draft', 'human-final'], onlyUnlisted: false,
            writtenBy: { script: ['cli'], 'human-final': ['bench'] },
          })),
          contentHashes: {},
        }
      : undefined,
    datasetFiles: { 'visible/rubric.json': { task: 'F2', criteria: [{ criterion: 'C4', weight: 25 }, { criterion: 'D1', weight: 16 }] } },
  })
}

describe('report — S2 two conditions, single factor', () => {
  it('derives the factor from the condition diff and ranks with the bootstrap CI', async () => {
    const report = await analyzeBundle(twoConditionBundle(tmpTree(), { manifestWriters: true }))
    expect(report.comparisonAllowed).toBe(true)
    expect(report.singleCondition).toBe(false)
    expect(report.factors).toHaveLength(1)
    expect(report.factors[0]?.factor).toBe('preset')
    const comparison = report.comparisons[0]
    expect(comparison).toBeDefined()
    expect(comparison?.perTask).toHaveLength(2)
    expect(comparison?.n).toBe(3)
    expect(comparison?.ci).not.toBeNull()
    // A passes 2 criteria per cell vs B's 1 → Δ=+1 per task, CI cannot contain 0.
    expect(comparison?.rank).toBe('a')
    expect(comparison?.rankReason).toContain('不含 0')
    // weighted scores from the rubric (C4=25, D1=16): A mean 25+16·(2/3), B mean 25 on F2
    const f2 = comparison?.perTask.find(t => t.task === 'F2')
    expect(f2?.aWeighted).toBeCloseTo(25 + 16 * (2 / 3), 6)
    expect(f2?.bWeighted).toBeCloseTo(25, 6)
    expect(report.weightsAvailable).toBe(true)
    // rows carry weight when the rubric has it (F2 rows only)
    const weightedRow = report.rows.find(row => row.task === 'F2' && row.criterion === 'C4' && row.pass)
    expect(weightedRow?.weight).toBe(25)
    // efficiency: summed delegations, same model, price from run.meta.pricing
    const a = report.efficiency.find(e => e.condition === 'codex-exec')
    const b = report.efficiency.find(e => e.condition === 'claude-exec')
    expect(a?.rounds).toBe(6 + 1) // 6 cells + the stage2 delegation on rep1
    expect(a?.activeMs).toBe(6 * 60_000 + 20_000)
    expect(a?.outputTokens).toBe(6 * 1200 + 300)
    expect(a?.model).toBe('gpt-x')
    expect(b?.activeMs).toBe(6 * 45_000)
    expect(a?.price).toBe(3.5)
    expect(b?.price).toBeNull()
    // judge consistency on the double-sampled cell
    expect(report.judge.multiSampled).toBe(2)
    expect(report.judge.llmAgreement).toEqual({ agreed: 1, total: 2 })
    expect(report.judge.llmKappa ?? 1).toBeCloseTo(0, 6)
    expect(report.judge.humanAgreement).toEqual({ agreed: 1, total: 2 })
    // tool: red flag must NOT fire (script written by cli, human-final by bench)
    expect(report.toolOnlyNs).toEqual([])
  })

  it('writes results.jsonl + summary.md via the service face, overwriting on re-run', async () => {
    const service = new EvalService()
    const bundle = twoConditionBundle(tmpTree(), { manifestWriters: true })
    const first = await service.report(bundle)
    expect(existsSync(first.resultsPath)).toBe(true)
    expect(existsSync(first.summaryPath)).toBe(true)
    const second = await service.report(bundle)
    expect(second.outDir).toBe(first.outDir)
    const line = (readFileSync(first.resultsPath, 'utf8').split('\n').filter(Boolean)[0] ?? '')
    const parsed = JSON.parse(line) as Record<string, unknown>
    for (const key of ['task', 'condition', 'conditionSha', 'rep', 'attempt', 'stage', 'ns', 'criterion', 'pass', 'evidence', 'by']) {
      expect(Object.hasOwn(parsed, key)).toBe(true)
    }
    const summary = readFileSync(first.summaryPath, 'utf8')
    expect(summary).toContain('## 四条不变量')
    expect(summary).toContain('### codex-exec vs claude-exec')
    expect(summary).toContain('**名次判定: codex-exec 高于 claude-exec')
    expect(summary).toContain('95% CI')
  })
})

// --- S3 · multi-factor ----------------------------------------------------------

describe('report — S3 multi-factor pair refuses ranking', () => {
  it('labels 多因子 and degrades to descriptive statistics', async () => {
    const report = await analyzeBundle(twoConditionBundle(tmpTree(), { multiFactor: true }))
    expect(report.comparisonAllowed).toBe(true)
    const comparison = report.comparisons[0]
    expect(comparison?.factor.multi).toEqual(['model', 'preset', 'skills'])
    expect(comparison?.factor.factor).toBeNull()
    expect(comparison?.n).toBe(3)
    expect(comparison?.rank).toBeNull()
    expect(comparison?.rankReason).toContain('多因子')
    // deltas still reported (facts)
    expect(comparison?.perTask.every(t => t.deltas.length === 3)).toBe(true)
  })
})

// --- S4 · invariant failure ------------------------------------------------------

function brokenMaterializationBundle(root: string): string {
  const missions: FixtureMission[] = []
  for (const [condition, conditionId] of [['a', 'codex-exec'], ['b', 'claude-exec']] as const) {
    missions.push({
      id: `F2-${conditionId}-rep1`,
      attempts: [{
        attempt: 1, state: 'released', refs: goodRefs(),
        ...matArtifact(sha(condition === 'a' ? '31' : '7f')), // same task, DIFFERENT materialization
        annotations: [scriptNote('F2', [['C4', true]])],
      }],
    })
  }
  return writeBundle(root, {
    runId: 'broken',
    meta: {
      conditions: [
        conditionEntry('codex-exec', baseConditionDoc(), 'aa'),
        conditionEntry('claude-exec', baseConditionDoc({ preset: 'eval-pack' }), 'bb'),
      ],
    },
    missions,
  })
}

describe('report — S4 invariant failure', () => {
  it('reports the violation and outputs facts only', async () => {
    const bundle = brokenMaterializationBundle(tmpTree())
    const report = await analyzeBundle(bundle)
    expect(report.comparisonAllowed).toBe(false)
    const materialization = report.invariants.find(i => i.id === 'materialization')
    expect(materialization?.status).toBe('violated')
    expect(materialization?.details.some(d => d.includes('F2'))).toBe(true)
    expect(report.comparisons).toEqual([])
    const { summaryPath } = await writeEvalReport(bundle)
    const summary = readFileSync(summaryPath, 'utf8')
    expect(summary).toContain('❌ 不成立')
    expect(summary).toContain('比较未启用')
    expect(summary).not.toContain('名次判定')
    // the fact table (results.jsonl) is still written
    expect(readFileSync(join(bundle, 'report', 'results.jsonl'), 'utf8')).toContain('C4')
  })
})

// --- S5 · n < 3 -------------------------------------------------------------------

describe('report — S5 insufficient n refuses ranking', () => {
  it('keeps deltas and the CI but prints 不可排名', async () => {
    const report = await analyzeBundle(twoConditionBundle(tmpTree(), { reps: 2 }))
    expect(report.comparisonAllowed).toBe(true)
    const comparison = report.comparisons[0]
    expect(comparison?.n).toBe(2)
    expect(comparison?.rank).toBeNull()
    expect(comparison?.rankReason).toContain('不可排名')
    expect(comparison?.perTask.every(t => t.deltas.length === 2)).toBe(true)
  })
})

// --- the orchestrator's capability line (T32) --------------------------------

describe('report — the orchestrator capability record is listed, never compared', () => {
  it('prints the caps tag under 程序一致 and leaves the verdict on evalVersion/planSha', async () => {
    const bundle = writeBundle(tmpTree(), {
      runId: 'caps',
      meta: {
        conditions: [conditionEntry('dsh-exec', baseConditionDoc(), 'a1')],
        orchestrator: { capabilities: { sha: sha('cafe'), preset: 'eval', skills: 3, tools: 11 } },
      },
      missions: [{
        id: 'P0-dsh-exec-rep1',
        attempts: [{
          attempt: 1, state: 'released', refs: goodRefs(),
          ...matArtifact(sha('m1')),
          annotations: [scriptNote('P0', [['placeholder-check', true]]), orchestratorNote('stage1', 1, 1000, 100)],
        }],
      }],
    })
    const report = await analyzeBundle(bundle)
    const procedure = report.invariants.find(check => check.id === 'procedure')
    expect(procedure?.details.some(line => line.includes(`caps:${sha('cafe').slice(0, 12)}`))).toBe(true)
    expect(procedure?.details.some(line => line.includes('不参与比较'))).toBe(true)
    expect(procedure?.status).toBe('ok')
  })

  it('says nothing for a run that recorded none — absence is not a violation', async () => {
    const bundle = writeBundle(tmpTree(), {
      runId: 'nocaps',
      meta: { conditions: [conditionEntry('dsh-exec', baseConditionDoc(), 'a1')] },
      missions: [{
        id: 'P0-dsh-exec-rep1',
        attempts: [{
          attempt: 1, state: 'released', refs: goodRefs(),
          ...matArtifact(sha('m1')),
          annotations: [scriptNote('P0', [['placeholder-check', true]]), orchestratorNote('stage1', 1, 1000, 100)],
        }],
      }],
    })
    const report = await analyzeBundle(bundle)
    const procedure = report.invariants.find(check => check.id === 'procedure')
    expect(procedure?.details.some(line => line.includes('caps:'))).toBe(false)
    expect(procedure?.status).toBe('ok')
  })
})

// --- S6 · missing human-final ------------------------------------------------------

describe('report — S6 missing human-final is honest', () => {
  it('reports the expected ns as missing and skips终评 agreement', async () => {
    const bundle = writeBundle(tmpTree(), {
      runId: 'nohuman',
      meta: { conditions: [conditionEntry('dsh-exec', baseConditionDoc(), 'a1')] },
      missions: [{
        id: 'P0-dsh-exec-rep1',
        attempts: [{
          attempt: 1, state: 'released', refs: goodRefs(),
          ...matArtifact(sha('m1')),
          annotations: [
            scriptNote('P0', [['placeholder-check', true]]),
            { ns: 'llm-draft', by: 'judge-runner', payload: [verdict('P0', 'placeholder-check', true, 'judge')] },
            orchestratorNote('stage1', 1, 1000, 100),
          ],
        }],
      }],
    })
    const report = await analyzeBundle(bundle)
    expect(report.comparisonAllowed).toBe(true)
    expect(report.judge.humanAgreement).toBeNull()
    expect(report.judge.details.some(d => d.includes('无 human-final'))).toBe(true)
    const { summaryPath } = await writeEvalReport(bundle)
    const summary = readFileSync(summaryPath, 'utf8')
    expect(summary).toContain('缺失的 ns: human-final')
  })
})

// --- S7 · judge double sampling -----------------------------------------------------

describe('report — S7 judge double sampling', () => {
  it('computes per-criterion agreement and the hand-computed κ = 0', async () => {
    const bundle = writeBundle(tmpTree(), {
      runId: 'judge',
      meta: { conditions: [conditionEntry('dsh-exec', baseConditionDoc(), 'a1')] },
      missions: [{
        id: 'P0-dsh-exec-rep1',
        attempts: [{
          attempt: 1, state: 'released', refs: goodRefs(),
          ...matArtifact(sha('m1')),
          annotations: [
            { ns: 'llm-draft', by: 'judge-runner', createdAt: 1, payload: [verdict('P0', 'R1', true, 'judge'), verdict('P0', 'R2', true, 'judge')] },
            { ns: 'llm-draft', by: 'judge-runner', createdAt: 2, payload: [verdict('P0', 'R1', true, 'judge'), verdict('P0', 'R2', false, 'judge')] },
            orchestratorNote('stage1', 1, 1000, 100),
          ],
        }],
      }],
    })
    const report = await analyzeBundle(bundle)
    expect(report.judge.multiSampled).toBe(2)
    expect(report.judge.llmAgreement).toEqual({ agreed: 1, total: 2 })
    expect(report.judge.llmKappa ?? 1).toBeCloseTo(0, 10)
    expect(report.judge.humanAgreement).toBeNull()
  })

  it('unwraps the orchestrator\u2019s sample envelope (T9\u2019s llm-draft annotation shape)', async () => {
    // The orchestrator writes ONE annotation per sample, with the sample's
    // provenance beside its verdicts. Reading only bare arrays would drop
    // every LLM sample the judge produced and leave the consistency column
    // permanently empty.
    const sample = (n: number, r2: boolean): Record<string, unknown> => ({
      sample: n,
      judgeCondition: 'judge-r1',
      judgeSha: sha('7d'),
      promptSha: sha('9e'),
      verdicts: [verdict('P0', 'R1', true, 'judge-r1'), verdict('P0', 'R2', r2, 'judge-r1')],
    })
    const bundle = writeBundle(tmpTree(), {
      runId: 'envelope',
      meta: { conditions: [conditionEntry('dsh-exec', baseConditionDoc(), 'a1')] },
      missions: [{
        id: 'P0-dsh-exec-rep1',
        attempts: [{
          attempt: 1, state: 'released', refs: goodRefs(),
          ...matArtifact(sha('m1')),
          annotations: [
            { ns: 'llm-draft', by: 'eval-orchestrator', createdAt: 1, payload: sample(1, true) },
            { ns: 'llm-draft', by: 'eval-orchestrator', createdAt: 2, payload: sample(2, true) },
            orchestratorNote('stage1', 1, 1000, 100),
          ],
        }],
      }],
    })
    const report = await analyzeBundle(bundle)
    expect(report.judge.multiSampled).toBe(2)
    expect(report.judge.llmAgreement).toEqual({ agreed: 2, total: 2 })
    expect(report.rows.filter(row => row.ns === 'llm-draft')).toHaveLength(4)
    const { summaryPath } = await writeEvalReport(bundle)
    expect(readFileSync(summaryPath, 'utf8')).toContain('双采样判据 2 条，完全一致 2 条')
  })

  it('carries NO judge key for an envelope written before the model was recorded — an older bundle recomputes byte-identically', async () => {
    const bundle = writeBundle(tmpTree(), {
      runId: 'pre-panel',
      meta: { conditions: [conditionEntry('dsh-exec', baseConditionDoc(), 'a1')] },
      missions: [{
        id: 'P0-dsh-exec-rep1',
        attempts: [{
          attempt: 1, state: 'released', refs: goodRefs(),
          ...matArtifact(sha('m1')),
          annotations: [{
            ns: 'llm-draft', by: 'eval-orchestrator', createdAt: 1,
            // The T9 shape: a judge condition, and nothing about its model —
            // because back then a judge could not be a player at all.
            payload: { sample: 1, judgeCondition: 'judge-r1', judgeSha: sha('7d'), promptSha: sha('9e'), verdicts: [verdict('P0', 'R1', true, 'judge-r1')] },
          }],
        }],
      }],
    })
    const report = await analyzeBundle(bundle)
    expect(report.rows[0]).not.toHaveProperty('judge')
    expect(report.judgeAssignments).toEqual([])
    expect(report.judge.crossJudged).toBe(0)
  })
})

// --- T31 · the judge panel (decision 9, relaxed) -----------------------------

describe('report — the judge panel: who judged, and which cells judged themselves', () => {
  /** One sample envelope of the panel shape: judge identity beside the verdicts. */
  const panelSample = (judge: string, model: string, selfJudged: boolean, n: number, pass: boolean): Record<string, unknown> => ({
    sample: n,
    judgeCondition: judge,
    judgeSha: sha('7d'),
    judgeModel: model,
    selfJudged,
    promptSha: sha('9e'),
    verdicts: [verdict('P0', 'R1', pass, judge)],
  })

  /** One cell judged by a two-judge panel; `twinAgrees` decides whether they agree. */
  function panelBundle(twinAgrees: boolean): string {
    return writeBundle(tmpTree(), {
      runId: 'panel',
      meta: { conditions: [conditionEntry('dsh-exec', baseConditionDoc(), 'a1')] },
      missions: [{
        id: 'P0-dsh-exec-rep1',
        attempts: [{
          attempt: 1, state: 'released', refs: goodRefs(),
          ...matArtifact(sha('m1')),
          annotations: [
            { ns: 'llm-draft', by: 'eval-orchestrator', createdAt: 1, payload: panelSample('judge-twin', 'gpt-x', true, 1, true) },
            { ns: 'llm-draft', by: 'eval-orchestrator', createdAt: 2, payload: panelSample('judge-twin', 'gpt-x', true, 2, true) },
            { ns: 'llm-draft', by: 'eval-orchestrator', createdAt: 3, payload: panelSample('judge-other', 'other-model', false, 1, twinAgrees) },
            orchestratorNote('stage1', 1, 1000, 100),
          ],
        }],
      }],
    })
  }

  it('puts the judge on every llm-draft row of results.jsonl', async () => {
    const report = await analyzeBundle(panelBundle(true))
    const rows = report.rows.filter(row => row.ns === 'llm-draft')
    // The rows share a criterion, so the sort is stable and they keep the
    // order the samples landed in.
    expect(rows.map(row => row.judge)).toEqual([
      { condition: 'judge-twin', model: 'gpt-x', selfJudged: true, sample: 1 },
      { condition: 'judge-twin', model: 'gpt-x', selfJudged: true, sample: 2 },
      { condition: 'judge-other', model: 'other-model', selfJudged: false, sample: 1 },
    ])
  })

  it('lists who judged each cell and marks the self-judged one', async () => {
    const report = await analyzeBundle(panelBundle(true))
    expect(report.judgeAssignments).toEqual([{
      missionId: 'P0-dsh-exec-rep1',
      task: 'P0',
      condition: 'dsh-exec',
      rep: 1,
      judges: [
        { condition: 'judge-other', model: 'other-model', selfJudged: false, samples: 1, verdicts: 1 },
        { condition: 'judge-twin', model: 'gpt-x', selfJudged: true, samples: 2, verdicts: 2 },
      ],
    }])
  })

  it('keeps the repeated-sample κ per judge and adds a cross-judge line beside it', async () => {
    const agreeing = await analyzeBundle(panelBundle(true))
    // judge-twin answered twice and agreed with itself: ONE multi-sampled
    // criterion, not one polluted by the other judge's single answer.
    expect(agreeing.judge.multiSampled).toBe(1)
    expect(agreeing.judge.llmAgreement).toEqual({ agreed: 1, total: 1 })
    expect(agreeing.judge.crossJudged).toBe(1)
    expect(agreeing.judge.crossAgreement).toEqual({ agreed: 1, total: 1 })

    const split = await analyzeBundle(panelBundle(false))
    expect(split.judge.multiSampled).toBe(1) // judge-twin still agrees with itself
    expect(split.judge.llmAgreement).toEqual({ agreed: 1, total: 1 })
    expect(split.judge.crossAgreement).toEqual({ agreed: 0, total: 1 }) // the panel does not
    expect(split.judge.selfJudgedCriteria).toBe(1)
  })

  it('prints the panel line, the assignment table and the self-judged caveat in summary.md', async () => {
    const bundle = panelBundle(false)
    const { summaryPath } = await writeEvalReport(bundle)
    const summary = readFileSync(summaryPath, 'utf8')

    expect(summary).toContain('每格由谁判')
    expect(summary).toContain('judge-twin（gpt-x · 2 采样） **自评**')
    expect(summary).toContain('judge-other（other-model · 1 采样）')
    expect(summary).toContain('跨判官（判官面板 2 位')
    expect(summary).toContain('自评判据 1 条')
  })
})

// --- S8 \u00b7 writtenBy tool: red flag ---------------------------------------------------

describe('report — S8 tool-written expected ns raises the red flag', () => {
  it('flags the ns in the report and at the top of the summary (fallback writtenBy)', async () => {
    const bundle = writeBundle(tmpTree(), {
      runId: 'tooly',
      manifest: null, // no manifest → writtenBy recomputed from annotations
      meta: { conditions: [conditionEntry('dsh-exec', baseConditionDoc(), 'a1')] },
      missions: [{
        id: 'P0-dsh-exec-rep1',
        attempts: [{
          attempt: 1, state: 'released', refs: goodRefs(),
          ...matArtifact(sha('m1')),
          annotations: [scriptNote('P0', [['placeholder-check', true]], 'tool:probe-runner')],
        }],
      }],
    })
    const report = await analyzeBundle(bundle)
    expect(report.toolOnlyNs).toEqual(['script'])
    const { summaryPath } = await writeEvalReport(bundle)
    const summary = readFileSync(summaryPath, 'utf8')
    const flagIndex = summary.indexOf('🔴')
    expect(flagIndex).toBeGreaterThanOrEqual(0)
    expect(flagIndex).toBeLessThan(summary.indexOf('## 四条不变量'))
    expect(summary).toContain('`script`')
  })

  it('does not flag when a non-tool origin also wrote the ns', async () => {
    const bundle = writeBundle(tmpTree(), {
      runId: 'mixed',
      manifest: null,
      meta: { conditions: [conditionEntry('dsh-exec', baseConditionDoc(), 'a1')] },
      missions: [
        {
          id: 'P0-dsh-exec-rep1',
          attempts: [{ attempt: 1, state: 'released', refs: goodRefs(), ...matArtifact(sha('m1')), annotations: [scriptNote('P0', [['c1', true]], 'tool:probe-runner')] }],
        },
        {
          id: 'P0-dsh-exec-rep2',
          attempts: [{ attempt: 1, state: 'released', refs: goodRefs(), ...matArtifact(sha('m1')), annotations: [scriptNote('P0', [['c1', true]], 'cli')] }],
        },
      ],
    })
    const report = await analyzeBundle(bundle)
    expect(report.toolOnlyNs).toEqual([])
  })
})

// --- CLI ------------------------------------------------------------------------------

// --- T8b · cell anchors are the identity source -------------------------------

/** One anchored cell whose mission id encodes NOTHING (the split cannot help). */
function anchoredBundle(root: string, overrides: {
  anchor?: FixtureMission['anchor']
  attempts?: FixtureAttempt[]
} = {}): string {
  const base: FixtureAttempt = {
    attempt: 1, state: 'released', refs: goodRefs(),
    ...matArtifact(sha('m1')),
    annotations: [scriptNote('P0-placeholder', [['placeholder-check', true]]), orchestratorNote('stage1', 1, 1000, 100)],
  }
  return writeBundle(root, {
    runId: 'anchored',
    meta: { conditions: [conditionEntry('dsh-exec', baseConditionDoc(), 'a1')] },
    missions: [{
      id: 'cell-0001',
      ...(overrides.anchor !== undefined ? { anchor: overrides.anchor } : { anchor: { task: 'P0-placeholder', condition: 'dsh-exec', rep: 1 } }),
      attempts: overrides.attempts ?? [base],
    }],
  })
}

// --- S9 · negative criteria (T24) ---------------------------------------------

/**
 * The G11 shape, minimally: one positive criterion and one NEGATIVE one.
 * `pass: true` on A-N2 means the DEFECT is present (protocol §6.5) — codex
 * never has it, claude always does. Counting passes would rank claude above
 * codex on exactly that defect; counting SCORED criteria must not.
 */
const NEGATIVE_WEIGHTS_TABLE = {
  schema: RUBRIC_WEIGHTS_SCHEMA,
  dataset: 'harness-comparison',
  commit: sha('c0'),
  tasks: ['F2'],
  criteria: [
    { task: 'F2', id: 'A1-1', weight: 3, negative: false, kind: 'llm-draft', axis: 'A1' },
    { task: 'F2', id: 'A-N2', weight: -2, negative: true, kind: 'objective', axis: 'A3' },
  ],
}

/** The same rubric as YAML, as a deliberately guarded export would carry it. */
const NEGATIVE_RUBRIC_YAML = `schema_version: dataseek.rubric/2
task_id: F2
items:
  - {id: A1-1, axis: A1, weight: 3, kind: llm-draft,
     criterion: 设计中存在一份共享上下文, evidence: "stage1.md"}
  - {id: A-N2, axis: A3, weight: -2, kind: objective, negative: true,
     criterion: "tradeoff 中出现 worth-the-cost", evidence: "stage1.json"}
`

function negativeCriterionBundle(root: string, opts: { table?: boolean; yaml?: boolean } = {}): string {
  const cell = (condition: string, rep: number, defect: boolean): FixtureMission => ({
    id: `F2-${condition}-rep${rep}`,
    attempts: [{
      attempt: 1, state: 'released', refs: goodRefs(),
      ...matArtifact(sha('m2')),
      annotations: [scriptNote('F2', [['A1-1', true], ['A-N2', defect]]), orchestratorNote('stage1', 1, 60_000, 900)],
    }],
  })
  return writeBundle(root, {
    runId: 'polarity',
    meta: {
      expectedNs: ['script'],
      conditions: [
        conditionEntry('codex-exec', baseConditionDoc(), 'aa'),
        conditionEntry('claude-exec', baseConditionDoc({ preset: 'thorough' }), 'bb'),
      ],
    },
    missions: [1, 2, 3].flatMap(rep => [cell('codex-exec', rep, false), cell('claude-exec', rep, true)]),
    ...(opts.table === true ? { weightsTable: NEGATIVE_WEIGHTS_TABLE } : {}),
    ...(opts.yaml === true ? { datasetText: { 'grading/items/F2/rubric.yml': NEGATIVE_RUBRIC_YAML } } : {}),
  })
}

describe('report — S9 negative criteria score as defects (T24)', () => {
  it('scores a held negative criterion as 0 and subtracts its weight', async () => {
    const report = await analyzeBundle(negativeCriterionBundle(tmpTree(), { table: true }))
    expect(report.polarity).toEqual({
      available: true, origin: RUBRIC_WEIGHTS_PATH, criteria: 2, negative: 1, weighted: true,
    })
    expect(report.weightsAvailable).toBe(true)

    const f2 = report.comparisons[0]?.perTask.find(task => task.task === 'F2')
    // codex: A1-1 holds (+1), A-N2 does NOT hold (+1) = 2.
    // claude: A1-1 holds (+1), A-N2 HOLDS — the defect — (0) = 1.
    expect(f2?.aMean).toBe(2)
    expect(f2?.bMean).toBe(1)
    // Weighted sums the weight of every criterion that HOLDS: 3 vs 3 + (-2).
    expect(f2?.aWeighted).toBe(3)
    expect(f2?.bWeighted).toBe(1)
    expect(report.comparisons[0]?.rank).toBe('a')
  })

  it('lists every held negative criterion with its evidence — the defect list', async () => {
    const report = await analyzeBundle(negativeCriterionBundle(tmpTree(), { table: true }))
    expect(report.negativeHits).toHaveLength(3)
    expect(report.negativeHits.every(hit => hit.condition === 'claude-exec' && hit.criterion === 'A-N2')).toBe(true)
    expect(report.negativeHits.map(hit => hit.rep)).toEqual([1, 2, 3])
    expect(report.negativeHits[0]).toMatchObject({ task: 'F2', ns: 'script', weight: -2, attempt: 1 })
    expect(report.negativeHits[0]?.evidence).toContain('A-N2')
    // A negative criterion that did NOT hold is not a hit.
    expect(report.negativeHits.some(hit => hit.condition === 'codex-exec')).toBe(false)
  })

  it('stamps polarity on the result rows', async () => {
    const report = await analyzeBundle(negativeCriterionBundle(tmpTree(), { table: true }))
    expect(report.rows.find(row => row.criterion === 'A-N2')?.negative).toBe(true)
    expect(report.rows.find(row => row.criterion === 'A-N2')?.weight).toBe(-2)
    expect(report.rows.find(row => row.criterion === 'A1-1')?.negative).toBe(false)
  })

  it('reads the polarity out of a rubric the export deliberately included', async () => {
    const report = await analyzeBundle(negativeCriterionBundle(tmpTree(), { yaml: true }))
    expect(report.polarity).toEqual({ available: true, origin: 'dataset/', criteria: 2, negative: 1, weighted: true })
    expect(report.comparisons[0]?.perTask[0]?.aMean).toBe(2)
    expect(report.negativeHits).toHaveLength(3)
  })

  it('degrades to plain counts and SAYS the polarity is unknown when no table travelled', async () => {
    const report = await analyzeBundle(negativeCriterionBundle(tmpTree()))
    expect(report.polarity).toEqual({ available: false, origin: null, criteria: 0, negative: 0, weighted: false })
    expect(report.weightsAvailable).toBe(false)
    expect(report.negativeHits).toEqual([])
    // Every criterion counted as positive — which is exactly the G11 error the
    // table exists to prevent: the cell WITH the defect now scores higher.
    const f2 = report.comparisons[0]?.perTask.find(task => task.task === 'F2')
    expect(f2?.aMean).toBe(1)
    expect(f2?.bMean).toBe(2)
    expect(f2?.aWeighted).toBeNull()
    expect(report.notes.some(note => note.includes('极性未知'))).toBe(true)
    expect(report.rows.every(row => row.negative === undefined)).toBe(true)
  })

  it('renders the defect list and the 得分 columns into summary.md', async () => {
    const bundle = negativeCriterionBundle(tmpTree(), { table: true })
    const written = await writeEvalReport(bundle)
    const summary = readFileSync(written.summaryPath, 'utf8')
    expect(summary).toContain('## 负向判据命中（缺陷清单）')
    expect(summary).toContain('| F2 | claude-exec | 1 | A-N2 | — | -2 | script |')
    expect(summary).toContain('codex-exec 得分')
    expect(summary).toContain('Δ 加权')
    expect(summary).not.toContain('codex-exec 通过')
    // The report never republishes the criterion text it does not have.
    expect(summary).not.toContain('worth-the-cost')
  })

  it('says so in the summary when the polarity is unknown', async () => {
    const written = await writeEvalReport(negativeCriterionBundle(tmpTree()))
    const summary = readFileSync(written.summaryPath, 'utf8')
    expect(summary).toContain('**极性未知**')
    expect(summary).toContain('负向判据数 **unknown**')
  })
})

// --- S10 · proportional criteria (T19b/T24 contract) --------------------------

/**
 * The `ratio` shape: `C1` is scored proportionally (weight 18), `A-N2` stays
 * the boolean negative one (weight -2). codex passes 6 of 9 core standards,
 * claude 3 of 9 — a difference the boolean `pass: false` on both sides cannot
 * express at all.
 */
const RATIO_WEIGHTS_TABLE = {
  schema: RUBRIC_WEIGHTS_SCHEMA,
  dataset: 'harness-comparison',
  commit: sha('c0'),
  tasks: ['F2'],
  criteria: [
    { task: 'F2', id: 'C1', weight: 18, negative: false, kind: 'objective', axis: 'C4' },
    { task: 'F2', id: 'A-N2', weight: -2, negative: true, kind: 'objective', axis: 'A3' },
  ],
}

function ratioBundle(root: string, opts: { malformed?: boolean; negativeRatio?: boolean } = {}): string {
  const cell = (condition: string, rep: number, passed: number): FixtureMission => ({
    id: `F2-${condition}-rep${rep}`,
    attempts: [{
      attempt: 1, state: 'released', refs: goodRefs(),
      ...matArtifact(sha('m3')),
      annotations: [
        scriptNote('F2', [
          ['C1', passed === 9, opts.malformed === true ? { passed: 12, total: 9 } : { passed, total: 9 }],
          // A-N2 holds on claude only; with negativeRatio it holds partially on both.
          ...(opts.negativeRatio === true
            ? [['A-N2', false, { passed: condition === 'codex-exec' ? 1 : 3, total: 4 }] as [string, boolean, unknown]]
            : [['A-N2', condition !== 'codex-exec'] as [string, boolean]]),
        ]),
        orchestratorNote('stage1', 1, 60_000, 900),
      ],
    }],
  })
  return writeBundle(root, {
    runId: 'ratio',
    meta: {
      expectedNs: ['script'],
      conditions: [
        conditionEntry('codex-exec', baseConditionDoc(), 'aa'),
        conditionEntry('claude-exec', baseConditionDoc({ preset: 'thorough' }), 'bb'),
      ],
    },
    missions: [1, 2, 3].flatMap(rep => [cell('codex-exec', rep, 6), cell('claude-exec', rep, 3)]),
    weightsTable: RATIO_WEIGHTS_TABLE,
  })
}

describe('report — S10 proportional criteria score by ratio (T19b/T24)', () => {
  it('scores passed/total instead of the boolean, and weights the same fraction', async () => {
    const report = await analyzeBundle(ratioBundle(tmpTree()))
    const f2 = report.comparisons[0]?.perTask.find(task => task.task === 'F2')
    // codex: C1 = 6/9, A-N2 does not hold (+1)  → 1.667
    // claude: C1 = 3/9, A-N2 HOLDS (0)          → 0.333
    expect(f2?.aMean).toBeCloseTo(6 / 9 + 1, 6)
    expect(f2?.bMean).toBeCloseTo(3 / 9, 6)
    // Weighted: 18 × 6/9 vs 18 × 3/9 + (-2) × 1.
    expect(f2?.aWeighted).toBeCloseTo(12, 6)
    expect(f2?.bWeighted).toBeCloseTo(4, 6)
    expect(report.comparisons[0]?.rank).toBe('a')
  })

  it('earns the fraction even though `pass` is false — pass means FULLY holds', async () => {
    const report = await analyzeBundle(ratioBundle(tmpTree()))
    const row = report.rows.find(r => r.criterion === 'C1' && r.condition === 'codex-exec')
    expect(row?.pass).toBe(false)
    expect(row?.ratio).toEqual({ passed: 6, total: 9 })
    expect(report.notes.some(note => note.includes('`ratio`') && note.includes('按比例给分'))).toBe(true)
  })

  it('scores a proportional NEGATIVE criterion by what is left of it, and prints the proportion', async () => {
    const report = await analyzeBundle(ratioBundle(tmpTree(), { negativeRatio: true }))
    const f2 = report.comparisons[0]?.perTask.find(task => task.task === 'F2')
    // codex: 6/9 + (1 - 1/4); claude: 3/9 + (1 - 3/4).
    expect(f2?.aMean).toBeCloseTo(6 / 9 + 0.75, 6)
    expect(f2?.bMean).toBeCloseTo(3 / 9 + 0.25, 6)
    // Both sides hold PART of the defect, so both appear in the defect list.
    expect(report.negativeHits).toHaveLength(6)
    expect(report.negativeHits.find(hit => hit.condition === 'claude-exec')?.ratio).toEqual({ passed: 3, total: 4 })
    const summary = readFileSync((await writeEvalReport(ratioBundle(tmpTree(), { negativeRatio: true }))).summaryPath, 'utf8')
    expect(summary).toContain('| F2 | claude-exec | 1 | A-N2 | 3/4 | -2 | script |')
  })

  it('falls back to the boolean on an out-of-bounds ratio and says so', async () => {
    const report = await analyzeBundle(ratioBundle(tmpTree(), { malformed: true }))
    // 12/9 is not a proportion; the row keeps no ratio and scores as pass: false.
    expect(report.rows.find(r => r.criterion === 'C1')?.ratio).toBeUndefined()
    const f2 = report.comparisons[0]?.perTask.find(task => task.task === 'F2')
    expect(f2?.aMean).toBe(1) // C1 fails, A-N2 does not hold
    expect(report.notes.some(note => note.includes('越界') && note.includes('退回布尔'))).toBe(true)
  })

  it('never reads the proportion out of the evidence prose', async () => {
    // Same numbers, but stated only in `evidence` — the report must ignore it.
    const root = tmpTree()
    const bundle = writeBundle(root, {
      runId: 'prose',
      meta: { expectedNs: ['script'], conditions: [conditionEntry('codex-exec', baseConditionDoc(), 'aa')] },
      missions: [{
        id: 'F2-codex-exec-rep1',
        attempts: [{
          attempt: 1, state: 'released', refs: goodRefs(),
          ...matArtifact(sha('m3')),
          annotations: [{
            ns: 'script', by: 'cli', createdAt: 0,
            payload: [{
              schema: 'dataseek.verdict/1', task: 'F2', criterion: 'C1', pass: false,
              evidence: '通过 6/9：core 标准 R1 R2 R3 R5 R6 G1 通过', by: 'probes/probe.mjs',
            }],
          }],
        }],
      }],
      weightsTable: RATIO_WEIGHTS_TABLE,
    })
    const report = await analyzeBundle(bundle)
    expect(report.rows[0]?.ratio).toBeUndefined()
    expect(report.rows[0]?.pass).toBe(false)
  })
})

// --- T54 · the per-criterion merge --------------------------------------------

/**
 * The rubric the merge is measured against: three positive criteria and one
 * negative, one of them `kind: human` — the shape that produced I5·T37's
 * report (a judge answered four, a person re-judged one).
 */
const MERGE_WEIGHTS_TABLE = {
  schema: RUBRIC_WEIGHTS_SCHEMA,
  dataset: 'harness-comparison',
  commit: sha('c0'),
  tasks: ['F7'],
  criteria: [
    { task: 'F7', id: 'C1', weight: 10, negative: false, kind: 'human', axis: '正确性' },
    { task: 'F7', id: 'C2', weight: 10, negative: false, kind: 'llm-draft', axis: '正确性' },
    { task: 'F7', id: 'C3', weight: 10, negative: false, kind: 'llm-draft', axis: '完整性' },
    { task: 'F7', id: 'N1', weight: -5, negative: true, kind: 'llm-draft', axis: '代价' },
  ],
}

/**
 * The T37 shape, exactly: the judge answered all four criteria on the `a`
 * side, a person then re-judged **C1 only** and disagreed with the judge about
 * it. Under the old per-cell rule this cell scored 1 (C1, the human's); under
 * the merge it scores 4, and its source mix is `human-final 1 / llm-draft 3`.
 *
 * `humanOnly` adds a criterion the judge never touched — the branch where the
 * consistency denominator must NOT grow. `ratio` makes C2 proportional, to
 * show a merged cell still scores that criterion by its proportion.
 */
function mergeBundle(root: string, opts: { humanOnly?: boolean; ratio?: boolean; pure?: 'human' | 'judge' | 'script' } = {}): string {
  const draft = (condition: string): Array<[string, boolean, unknown?]> => [
    ['C1', condition !== 'codex-exec'],
    ['C2', condition === 'codex-exec', ...(opts.ratio === true ? [{ passed: condition === 'codex-exec' ? 3 : 1, total: 4 }] : [])] as [string, boolean, unknown?],
    ['C3', true],
    ['N1', condition !== 'codex-exec'],
  ]
  const missions: FixtureMission[] = []
  for (const condition of ['codex-exec', 'claude-exec']) {
    for (let rep = 1; rep <= 3; rep++) {
      const annotations: FixtureAnnotation[] = [orchestratorNote('stage1', 1, 60_000, 900)]
      if (opts.pure === 'script') {
        annotations.push(scriptNote('F7', draft(condition), 'cli', 1))
      } else if (opts.pure === 'human') {
        annotations.push({
          ns: 'human-final', by: 'tab:s1', createdAt: 2,
          payload: draft(condition).map(([id, pass, ratio]) => verdict('F7', id, pass, 'judge-bench', ratio)),
        })
      } else {
        annotations.push({
          ns: 'llm-draft', by: 'judge-runner', createdAt: 1,
          payload: draft(condition).map(([id, pass, ratio]) => verdict('F7', id, pass, 'judge-a', ratio)),
        })
        // The person re-judges C1 on the `a` side only, and disagrees.
        if (opts.pure === undefined && condition === 'codex-exec') {
          annotations.push({
            ns: 'human-final', by: 'tab:s1', createdAt: 2,
            payload: [
              verdict('F7', 'C1', true, 'judge-bench'),
              ...(opts.humanOnly === true ? [verdict('F7', 'H9', true, 'judge-bench')] : []),
            ],
          })
        }
      }
      missions.push({
        id: `F7-${condition}-rep${rep}`,
        attempts: [{ attempt: 1, state: 'released', refs: goodRefs(), ...matArtifact(sha('m7')), annotations }],
      })
    }
  }
  return writeBundle(root, {
    runId: 'merge',
    meta: {
      expectedNs: ['llm-draft', 'human-final'],
      conditions: [
        conditionEntry('codex-exec', baseConditionDoc(), 'aa'),
        conditionEntry('claude-exec', baseConditionDoc({ preset: 'thorough' }), 'bb'),
      ],
    },
    missions,
    weightsTable: MERGE_WEIGHTS_TABLE,
  })
}

const f7Of = (report: EvalReport): PairTaskDelta | undefined =>
  report.comparisons[0]?.perTask.find(task => task.task === 'F7')

describe('report — T54 the merge is per CRITERION, not per cell', () => {
  it('counts all four criteria when a person re-judged one of them', async () => {
    const report = await analyzeBundle(mergeBundle(tmpTree()))
    // a: C1 human (holds, +1), C2 judge (holds, +1), C3 judge (holds, +1),
    //    N1 judge (negative, does NOT hold, +1) → 4.
    // The OLD per-cell rule scored this cell 1: human-final held C1 alone and
    // the judge's other three dropped out with nothing saying so (T37).
    expect(f7Of(report)?.aMean).toBe(4)
    // b: C1 judge (holds, +1), C2 judge (fails, 0), C3 (+1), N1 HOLDS (0) → 2.
    expect(f7Of(report)?.bMean).toBe(2)
    // Weighted rides the same merge: 10 + 10 + 10 vs 10 + 10 + (-5).
    expect(f7Of(report)?.aWeighted).toBe(30)
    expect(f7Of(report)?.bWeighted).toBe(15)
  })

  it('records the cell source mix on every one of its result rows', async () => {
    const write = await writeEvalReport(mergeBundle(tmpTree()))
    const rows = readFileSync(write.resultsPath, 'utf8').trim().split('\n').map(line => JSON.parse(line) as ReportRow)
    // Every row carries its OWN layer and its CELL's mix — the mix is repeated
    // per row exactly as toolCalls is, because a row has no mix of its own.
    const a = rows.filter(row => row.condition === 'codex-exec' && row.rep === 1)
    expect(a).toHaveLength(5) // 4 judge rows + 1 human row
    expect(new Set(a.map(row => row.ns))).toEqual(new Set(['llm-draft', 'human-final']))
    for (const row of a) expect(row.sources).toEqual({ 'human-final': 1, 'llm-draft': 3 })
    const b = rows.filter(row => row.condition === 'claude-exec' && row.rep === 1)
    for (const row of b) expect(row.sources).toEqual({ 'llm-draft': 4 })
  })

  it('keeps the three pure states exactly as they scored before the merge', async () => {
    // Nothing to merge: one layer judged everything, so the merged result IS
    // the old single-namespace result. Same numbers for all three.
    for (const pure of ['human', 'judge', 'script'] as const) {
      const report = await analyzeBundle(mergeBundle(tmpTree(), { pure }))
      // a: C1 fails, C2 holds, C3 holds, N1 does not hold → 3.
      expect(f7Of(report)?.aMean).toBe(3)
      expect(f7Of(report)?.bMean).toBe(2)
      const ns = pure === 'judge' ? 'llm-draft' : pure === 'human' ? 'human-final' : 'script'
      const table = report.criteriaTables.find(t => t.task === 'F7')
      for (const row of table?.rows ?? []) {
        for (const cell of row.cells) expect(cell.sources).toEqual({ [ns]: 3 })
      }
    }
  })

  it('still scores a proportional criterion by its ratio inside a merged cell', async () => {
    const report = await analyzeBundle(mergeBundle(tmpTree(), { ratio: true }))
    // C1 is the human's 1; C2 keeps the judge's 3/4; C3 1; N1 1.
    expect(f7Of(report)?.aMean).toBeCloseTo(1 + 3 / 4 + 1 + 1, 6)
    expect(f7Of(report)?.bMean).toBeCloseTo(1 + 1 / 4 + 1 + 0, 6)
    const c2 = report.criteriaTables.find(t => t.task === 'F7')?.rows.find(row => row.criterion === 'C2')
    const cell = c2?.cells.find(entry => entry.condition === 'codex-exec')
    expect(cell?.proportional).toBe(true)
    expect(cell?.credit).toBeCloseTo(3 / 4, 6)
    expect(cell?.sources).toEqual({ 'llm-draft': 3 })
  })

  it('counts only criteria BOTH sides judged in the human-agreement denominator', async () => {
    const report = await analyzeBundle(mergeBundle(tmpTree(), { humanOnly: true }))
    // The person answered C1 (the judge did too) and H9 (the judge did not).
    // Three cells × C1 is the whole denominator; H9 never enters it.
    expect(report.judge.humanAgreement).toEqual({ agreed: 0, total: 3 })
    const line = report.judge.details.find(detail => detail.includes('llm-draft 对 human-final'))
    expect(line).toContain('分母只含两者都判过的判据')
    expect(line).toContain('另有 3 条人评判据判官没判过')
  })

  it('shuts the criteria table behind the same gate as the comparison', async () => {
    // An invariant that does not hold closes both: a reader must not be able
    // to reopen a refused comparison one criterion at a time.
    const report = await analyzeBundle(brokenMaterializationBundle(tmpTree()))
    expect(report.comparisonAllowed).toBe(false)
    expect(report.criteriaTables).toEqual([])
  })
})

describe('report — T54 补一 the criteria × group table', () => {
  it('names the layer each criterion scored from, and keeps the judgement a person replaced', async () => {
    const report = await analyzeBundle(mergeBundle(tmpTree()))
    const table = report.criteriaTables.find(entry => entry.task === 'F7')
    expect(table?.conditions).toEqual(['claude-exec', 'codex-exec'])
    // Rubric order, not alphabetical, and the rubric's own axis rides along.
    expect(table?.criteria.map(row => row.id)).toEqual(['C1', 'C2', 'C3', 'N1'])
    expect(table?.criteria.find(row => row.id === 'N1')).toMatchObject({ negative: true, weight: -5, axis: '代价' })

    const c1 = table?.rows.find(row => row.criterion === 'C1')?.cells.find(cell => cell.condition === 'codex-exec')
    expect(c1?.sources).toEqual({ 'human-final': 3 })
    expect(c1?.holds).toBe(true)
    expect(c1?.samples.map(sample => sample.ns)).toEqual(['human-final', 'human-final', 'human-final'])
    // The judge's original verdict is kept, not dropped — «人已改判» is only
    // readable beside the judgement it replaced.
    expect(c1?.superseded).toHaveLength(3)
    expect(c1?.superseded[0]).toMatchObject({ ns: 'llm-draft', pass: false })

    const c2 = table?.rows.find(row => row.criterion === 'C2')?.cells.find(cell => cell.condition === 'codex-exec')
    expect(c2?.sources).toEqual({ 'llm-draft': 3 })
    expect(c2?.superseded).toEqual([])
    // Evidence and `by` ride the sample: the whole point of the expansion.
    expect(c2?.samples[0]?.evidence).toContain('可查证事实')
    expect(c2?.samples[0]?.by).toBe('judge-a')
  })

  it('prints the same per-item total the pair table does', async () => {
    const report = await analyzeBundle(mergeBundle(tmpTree()))
    const table = report.criteriaTables.find(entry => entry.task === 'F7')
    const pair = f7Of(report)
    expect(table?.totals.find(total => total.condition === 'codex-exec')?.scored).toBe(pair?.aMean)
    expect(table?.totals.find(total => total.condition === 'claude-exec')?.scored).toBe(pair?.bMean)
    expect(table?.totals.find(total => total.condition === 'codex-exec')?.weighted).toBe(pair?.aWeighted)
    expect(table?.totals.every(total => total.reps === 3)).toBe(true)
  })

  it('marks a criterion the rubric never declared instead of inventing a weight', async () => {
    const report = await analyzeBundle(mergeBundle(tmpTree(), { humanOnly: true }))
    const table = report.criteriaTables.find(entry => entry.task === 'F7')
    // Declared criteria keep rubric order; H9 is appended and flagged.
    expect(table?.criteria.map(row => row.id)).toEqual(['C1', 'C2', 'C3', 'N1', 'H9'])
    expect(table?.criteria.find(row => row.id === 'H9')).toMatchObject({ undeclared: true, weight: null, negative: false })
  })

  it('writes the table and the folded evidence into summary.md', async () => {
    const summary = readFileSync((await writeEvalReport(mergeBundle(tmpTree()))).summaryPath, 'utf8')
    expect(summary).toContain('## 判据 × 对比组（每条判据的得分与判官依据）')
    expect(summary).toContain('| 判据 | 维度 | weight | 极性 | claude-exec | codex-exec |')
    // The mixed cell says «人» where it scored on the human's word — one layer
    // in the cell, so the word alone — and «判官» on the three it did not.
    expect(summary).toMatch(/\| C1 \| 正确性 \| 10 \| 正向 \|.*<sub>判官<\/sub> \|.*<sub>人<\/sub> \|/)
    expect(summary).toContain('| **本题总分** | | | | **2**（加权 15） <sub>3 rep</sub> | **4**（加权 30） <sub>3 rep</sub> |')
    expect(summary).toContain('<details><summary>判官依据（逐条判定的原文）</summary>')
    expect(summary).toContain('（已被人工终评改判，原判保留）')
    // The scoring paragraph now states the merge rule itself.
    expect(summary).toContain('得分判据数**逐判据**取最权威可用的判定源')
  })

  it('gives a single-group run the table too — the grounds do not need a second column', async () => {
    const report = await analyzeBundle(singleConditionBundle(tmpTree()))
    expect(report.singleCondition).toBe(true)
    expect(report.criteriaTables.length).toBeGreaterThan(0)
    expect(report.criteriaTables[0]?.conditions).toHaveLength(1)
  })
})

describe('report — T8b cell anchors', () => {
  it('reads the cell identity from the anchor when the mission id encodes nothing', async () => {
    const report = await analyzeBundle(anchoredBundle(tmpTree()))
    const row = report.rows[0]
    expect(row?.task).toBe('P0-placeholder')
    expect(row?.condition).toBe('dsh-exec')
    expect(row?.rep).toBe(1)
    expect(row?.conditionSha).toBe(sha('a1'))
    expect(report.invariants.find(i => i.id === 'subject')?.status).toBe('ok')
    expect(report.comparisonAllowed).toBe(true)
  })

  it('propagates the mission anchor across a retried cell (the anchor rides attempt 1 only)', async () => {
    const withRetry = anchoredBundle(tmpTree(), {
      attempts: [
        {
          attempt: 1, state: 'archived', refs: goodRefs(), retry: { reason: 'spawn-failed', category: 'infrastructure' },
          ...matArtifact(sha('m1')), annotations: [],
        },
        {
          attempt: 2, state: 'released', refs: goodRefs(),
          ...matArtifact(sha('m1')),
          annotations: [scriptNote('P0-placeholder', [['placeholder-check', true]]), orchestratorNote('stage1', 1, 1000, 100)],
        },
      ],
    })
    const report = await analyzeBundle(withRetry)
    expect(report.retries).toBe(1)
    expect(report.rows.every(r => r.condition === 'dsh-exec' && r.task === 'P0-placeholder' && r.rep === 1)).toBe(true)
    expect(report.invariants.find(i => i.id === 'subject')?.status).toBe('ok')
  })

  it('leaves 受试对象一致 unverifiable without an anchor — the mission-id split is not accepted as identity', async () => {
    const bundle = writeBundle(tmpTree(), {
      runId: 'noanchor',
      meta: { conditions: [conditionEntry('dsh-exec', baseConditionDoc(), 'a1')] },
      missions: [{
        id: 'P0-dsh-exec-rep1', // the split WOULD resolve this — the invariant still refuses
        anchor: null,
        attempts: [{
          attempt: 1, state: 'released', refs: goodRefs(),
          ...matArtifact(sha('m1')),
          annotations: [scriptNote('P0', [['placeholder-check', true]]), orchestratorNote('stage1', 1, 1000, 100)],
        }],
      }],
    })
    const report = await analyzeBundle(bundle)
    const subject = report.invariants.find(i => i.id === 'subject')
    expect(subject?.status).toBe('unverifiable')
    expect(subject?.details.some(d => d.includes('无 cell 锚点'))).toBe(true)
    expect(report.comparisonAllowed).toBe(false)
    // the coordinates still come from the split, so the fact table stays usable
    expect(report.rows[0]?.condition).toBe('dsh-exec')
  })

  it('violates 受试对象一致 when the anchor hash disagrees with run.meta', async () => {
    const report = await analyzeBundle(anchoredBundle(tmpTree(), {
      anchor: { task: 'P0-placeholder', condition: 'dsh-exec', conditionSha: sha('ff'), rep: 1 },
    }))
    const subject = report.invariants.find(i => i.id === 'subject')
    expect(subject?.status).toBe('violated')
    expect(subject?.details.some(d => d.includes('≠ run.meta'))).toBe(true)
    expect(report.comparisonAllowed).toBe(false)
  })

  it('violates 受试对象一致 when the anchor names a condition the run never recorded', async () => {
    const report = await analyzeBundle(anchoredBundle(tmpTree(), {
      anchor: { task: 'P0-placeholder', condition: 'ghost-exec', rep: 1 },
    }))
    const subject = report.invariants.find(i => i.id === 'subject')
    expect(subject?.status).toBe('violated')
    expect(subject?.details.some(d => d.includes('不在 run.meta.conditions 中'))).toBe(true)
  })
})

describe('report — materialization record as the run loop writes it', () => {
  it('reads the overall sha256 field, not the record bytes (which carry per-cell source facts)', async () => {
    const bundle = writeBundle(tmpTree(), {
      runId: 'runloop-mat',
      meta: { conditions: [conditionEntry('dsh-exec', baseConditionDoc(), 'a1')] },
      missions: ['rep1', 'rep2'].map(rep => ({
        id: `P0-placeholder-dsh-exec-${rep}`,
        anchor: { task: 'P0-placeholder', condition: 'dsh-exec', rep: rep === 'rep1' ? 1 : 2 },
        attempts: [{
          attempt: 1, state: 'archived', refs: {},
          // Same content, same digest — but per-cell `source` facts, as the
          // real bundle has: the second cell reused the dataset worktree.
          ...runLoopMatArtifact(sha('m9'), '/state/eval/cells/run-x/shared-worktree', rep === 'rep2'),
          annotations: [orchestratorNote('stage1', 1, 1000, 100)],
        }],
      })),
    })
    const report = await analyzeBundle(bundle)
    const materialization = report.invariants.find(i => i.id === 'materialization')
    expect(materialization?.status).toBe('ok')
    expect(materialization?.details[0]).toContain('2 格一致')
  })
})

describe('dsh-eval report (CLI)', () => {
  it('writes the report and prints a JSON summary; usage errors exit 2', async () => {
    const { io, stdout, stderr } = captureIo()
    const bundle = twoConditionBundle(tmpTree(), { manifestWriters: true })
    const code = await runCli(['report', bundle], io)
    expect(code).toBe(0)
    const printed = JSON.parse(stdout()) as { outDir: string; rows: number; comparisonAllowed: boolean; invariants: Record<string, string> }
    expect(printed.rows).toBeGreaterThan(0)
    expect(printed.comparisonAllowed).toBe(true)
    expect(printed.invariants['materialization']).toBe('ok')
    expect(stderr()).toContain('report →')
    expect(existsSync(join(printed.outDir, 'summary.md'))).toBe(true)

    expect(await runCli(['report'], io)).toBe(2)
    expect(await runCli(['report', bundle, '--out'], io)).toBe(2)
    expect(await runCli(['report', join(bundle, 'missing')], io)).toBe(1)
  })

  it('--out redirects the output directory', async () => {
    const { io, stdout } = captureIo()
    const bundle = singleConditionBundle(tmpTree())
    const out = join(bundle, '..', 'custom-out')
    const code = await runCli(['report', bundle, '--out', out], io)
    expect(code).toBe(0)
    expect(JSON.parse(stdout()).outDir).toBe(out)
    expect(existsSync(join(out, 'results.jsonl'))).toBe(true)
    expect(existsSync(join(bundle, 'report'))).toBe(false)
  })
})

// --- G15 · the efficiency table counts completed cells only ---------------------

/**
 * The pilot-a-round1 shape that made G15 visible: one condition finished all
 * its cells, the other has a cell parked in `stage-2` after only stage one
 * ran. Pooling that cell's delegation time with the finished ones is what
 * made both harnesses read 21.0 min of active time.
 */
function partialRunBundle(root: string): string {
  return writeBundle(root, {
    runId: 'partial',
    meta: {
      conditions: [
        conditionEntry('codex-exec', baseConditionDoc(), 'aa'),
        conditionEntry('dsh-exec', baseConditionDoc({ harness: { name: 'dsh', version: '1.0', drive: 'exec' } }), 'bb'),
      ],
      subset: { only: null, maxCells: null, totalCells: 4, selectedCells: 4 },
    },
    missions: [
      {
        id: 'F2-codex-exec-rep1',
        attempts: [{
          attempt: 1, state: 'released', refs: goodRefs(), ...matArtifact(sha('m1')),
          annotations: [scriptNote('F2', [['c1', true]]), orchestratorNote('stage1', 1, 60_000, 100)],
        }],
      },
      {
        id: 'F2-codex-exec-rep2',
        attempts: [{
          attempt: 1, state: 'released', refs: goodRefs(), ...matArtifact(sha('m1')),
          annotations: [scriptNote('F2', [['c1', true]]), orchestratorNote('stage1', 1, 60_000, 100)],
        }],
      },
      {
        id: 'F2-dsh-exec-rep1',
        attempts: [{
          attempt: 1, state: 'released', refs: goodRefs(), ...matArtifact(sha('m1')),
          annotations: [scriptNote('F2', [['c1', true]]), orchestratorNote('stage1', 1, 60_000, 100)],
        }],
      },
      {
        // Stage one ran, stage two never did: the cell is parked mid-flight.
        id: 'F2-dsh-exec-rep2',
        attempts: [{
          attempt: 1, state: 'stage-2', refs: goodRefs(), ...matArtifact(sha('m1')),
          annotations: [orchestratorNote('stage1', 1, 60_000, 100)],
        }],
      },
    ],
  })
}

describe('report — efficiency counts completed cells only (G15)', () => {
  it('drops the unfinished cell from the sums and lists it beside the table', async () => {
    const report = await analyzeBundle(partialRunBundle(tmpTree()))

    const codex = report.efficiency.find(e => e.condition === 'codex-exec')
    const dsh = report.efficiency.find(e => e.condition === 'dsh-exec')
    // Two completed cells each ran 60s; the third dsh cell is unfinished, so
    // dsh must NOT read the same 120s as codex — that tie was the artifact.
    expect(codex?.activeMs).toBe(120_000)
    expect(codex?.rounds).toBe(2)
    expect(dsh?.activeMs).toBe(60_000)
    expect(dsh?.rounds).toBe(1)

    expect(report.efficiencyExcluded).toEqual([{ condition: 'dsh-exec', state: 'stage-2', count: 1 }])

    // results.jsonl is untouched: the unfinished cell's verdicts (it has
    // none here) and every other row still go through the same path.
    expect(report.rows).toHaveLength(3)
    expect(report.missions).toBe(4)
  })

  it('keeps a condition with no completed cell in the table, blank rather than absent', async () => {
    const root = tmpTree()
    const bundle = writeBundle(root, {
      runId: 'none-complete',
      meta: { conditions: [conditionEntry('dsh-exec', baseConditionDoc({ harness: { name: 'dsh', version: '1.0', drive: 'exec' } }), 'bb')] },
      missions: [{
        id: 'F2-dsh-exec-rep1',
        attempts: [{
          attempt: 1, state: 'stage-1', refs: goodRefs(), ...matArtifact(sha('m1')),
          annotations: [orchestratorNote('stage1', 1, 45_000, 100)],
        }],
      }],
    })
    const report = await analyzeBundle(bundle)
    expect(report.efficiency.map(e => e.condition)).toEqual(['dsh-exec'])
    expect(report.efficiency[0]?.activeMs).toBeNull()
    expect(report.efficiency[0]?.rounds).toBeNull()
    expect(report.efficiencyExcluded).toEqual([{ condition: 'dsh-exec', state: 'stage-1', count: 1 }])
  })

  it('summary.md says which cells the table left out, and prints the run subset', async () => {
    const root = tmpTree()
    const written = await writeEvalReport(partialRunBundle(root))
    const summary = readFileSync(written.summaryPath, 'utf8')
    expect(summary).toContain('只统计**已完成**的格子')
    expect(summary).toContain('未计入上表的未完成格子（1 格）: dsh-exec stage-2 × 1')
    expect(summary).toContain('子集：全矩阵（4/4 格，无 --only / --max-cells）')
  })

  it('prints the subset knobs when a run covered part of its plan', async () => {
    const root = tmpTree()
    const bundle = writeBundle(root, {
      runId: 'subset',
      meta: {
        conditions: [conditionEntry('dsh-exec', baseConditionDoc({ harness: { name: 'dsh', version: '1.0', drive: 'exec' } }), 'bb')],
        subset: { only: ['f2-dsh-exec-rep1'], maxCells: 1, totalCells: 12, selectedCells: 1 },
      },
      missions: [{
        id: 'F2-dsh-exec-rep1',
        attempts: [{
          attempt: 1, state: 'released', refs: goodRefs(), ...matArtifact(sha('m1')),
          annotations: [scriptNote('F2', [['c1', true]]), orchestratorNote('stage1', 1, 60_000, 100)],
        }],
      }],
    })
    const summary = readFileSync((await writeEvalReport(bundle)).summaryPath, 'utf8')
    expect(summary).toContain('子集：--only f2-dsh-exec-rep1 + --max-cells 1（1/12 格）——本 run 只覆盖了 plan 的一部分')
  })

  it('says nothing about a subset for a bundle that predates the field', async () => {
    const summary = readFileSync((await writeEvalReport(singleConditionBundle(tmpTree()))).summaryPath, 'utf8')
    expect(summary).not.toContain('子集：')
  })
})

// --- T30c · tool calls in the efficiency table and the per-round ledger ---------

/**
 * A bundle where one condition's rounds carry tool-call accountings and the
 * other's carry none — the two cases the table must render differently: a
 * number, and a dash that is not a zero.
 */
function toolCallBundle(root: string): string {
  return writeBundle(root, {
    runId: 'toolcalls',
    meta: {
      conditions: [
        conditionEntry('codex-exec', baseConditionDoc(), 'aa'),
        conditionEntry('dsh-exec', baseConditionDoc({ harness: { name: 'dsh', version: '1.0', drive: 'exec' } }), 'bb'),
      ],
    },
    missions: [
      {
        id: 'F2-codex-exec-rep1',
        attempts: [{
          attempt: 1, state: 'released', refs: goodRefs(), ...matArtifact(sha('m1')),
          annotations: [
            scriptNote('F2', [['c1', true]]),
            orchestratorNote('stage1', 1, 60_000, 100, 'gpt-x', 0, { count: 3, byName: { command_execution: 2, web_search_call: 1 } }),
            orchestratorNote('stage2', 2, 30_000, 50, 'gpt-x', 1, { count: 1, byName: { command_execution: 1 } }),
          ],
        }],
      },
      {
        // The unfinished cell's rounds are real spend the table excludes; the
        // ledger still carries them, marked `counted: false`.
        id: 'F2-codex-exec-rep2',
        attempts: [{
          attempt: 1, state: 'stage-2', refs: goodRefs(), ...matArtifact(sha('m1')),
          annotations: [orchestratorNote('stage1', 1, 10_000, 10, 'gpt-x', 0, { count: 9, byName: { command_execution: 9 } })],
        }],
      },
      {
        // No harness accounting at all — the column must stay blank for it.
        id: 'F2-dsh-exec-rep1',
        attempts: [{
          attempt: 1, state: 'released', refs: goodRefs(), ...matArtifact(sha('m1')),
          annotations: [scriptNote('F2', [['c1', true]]), orchestratorNote('stage1', 1, 60_000, 100)],
        }],
      },
    ],
  })
}

describe('report — tool calls (T30c)', () => {
  it('sums the completed cells\u2019 tool calls, and leaves an unreported condition null', async () => {
    const report = await analyzeBundle(toolCallBundle(tmpTree()))
    const codex = report.efficiency.find(e => e.condition === 'codex-exec')
    const dsh = report.efficiency.find(e => e.condition === 'dsh-exec')
    // 3 + 1 from the completed cell; the unfinished cell's 9 stay out (T23).
    expect(codex?.toolCalls).toBe(4)
    // Null, never 0: no round of this condition reported an accounting.
    expect(dsh?.toolCalls).toBeNull()
  })

  it('the table prints a dash for the unreported condition, not a zero', async () => {
    const { summaryPath } = await writeEvalReport(toolCallBundle(tmpTree()))
    const summary = readFileSync(summaryPath, 'utf8')
    const header = summary.split('\n').find(line => line.includes('| 条件 | 模型 |'))
    expect(header).toContain('工具调用')
    // The efficiency rows are the ones under the header, in its column order.
    const lines = summary.split('\n')
    const headerIndex = lines.findIndex(line => line.includes('| 条件 | 模型 |'))
    const columns = lines[headerIndex]!.split('|').map(cell => cell.trim())
    const toolColumn = columns.indexOf('工具调用')
    const rowOf = (condition: string): string[] | undefined =>
      lines.slice(headerIndex).find(line => line.startsWith(`| ${condition} `))?.split('|').map(cell => cell.trim())
    expect(rowOf('codex-exec')?.[toolColumn]).toBe('4')
    expect(rowOf('dsh-exec')?.[toolColumn]).toBe('—')
    expect(summary).toContain('未报工具调用计数的条件: dsh-exec')
  })

  it('carries the cell\u2019s tool calls onto every one of its verdict rows', async () => {
    const report = await analyzeBundle(toolCallBundle(tmpTree()))
    const codexRows = report.rows.filter(row => row.condition === 'codex-exec')
    expect(codexRows.length).toBeGreaterThan(0)
    for (const row of codexRows) {
      expect(row.toolCalls).toEqual({ count: 4, byName: { command_execution: 3, web_search_call: 1 } })
    }
    // A cell whose rounds reported none carries NO key — which is what keeps a
    // report recomputed over an older bundle byte-identical.
    for (const row of report.rows.filter(r => r.condition === 'dsh-exec')) {
      expect('toolCalls' in row).toBe(false)
    }
  })

  it('writes one usage.jsonl line per delegation round, unaggregated', async () => {
    const bundle = toolCallBundle(tmpTree())
    const write = await writeEvalReport(bundle)
    const text = readFileSync(write.usagePath, 'utf8')
    const rows = text.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    // 2 rounds (completed codex cell) + 1 (unfinished codex cell) + 1 (dsh).
    expect(rows).toHaveLength(4)
    expect(write.usageRowCount).toBe(4)
    expect(rows[0]).toMatchObject({
      run: 'toolcalls',
      cell: 'F2-codex-exec-rep1',
      attempt: 1,
      condition: 'codex-exec',
      task: 'F2',
      stage: 'stage1',
      round: 1,
      counted: true,
      observedModel: 'gpt-x',
      durationMs: 60_000,
      usage: { outputTokens: 100, inputTokens: 300 },
      toolCalls: { count: 3, byName: { command_execution: 2, web_search_call: 1 } },
    })
    // The unfinished cell's round is kept and marked out of the table's scope.
    const excluded = rows.find(row => row['cell'] === 'F2-codex-exec-rep2')
    expect(excluded).toMatchObject({ counted: false, toolCalls: { count: 9 } })
    // Unreported facts are absent, never zero-filled.
    const dshRow = rows.find(row => row['condition'] === 'dsh-exec')
    expect('toolCalls' in dshRow!).toBe(false)
    expect('cliVersion' in dshRow!).toBe(false)
  })

  it('the ledger\u2019s counted rows reproduce the efficiency table exactly', async () => {
    const bundle = toolCallBundle(tmpTree())
    const write = await writeEvalReport(bundle)
    const rows = readFileSync(write.usagePath, 'utf8').trim().split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>)
      .filter(row => row['counted'] === true)
    for (const efficiency of write.report.efficiency) {
      const mine = rows.filter(row => row['condition'] === efficiency.condition)
      const sum = (pick: (row: Record<string, unknown>) => number | undefined): number =>
        mine.reduce((total, row) => total + (pick(row) ?? 0), 0)
      expect(mine).toHaveLength(efficiency.rounds ?? 0)
      expect(sum(row => row['durationMs'] as number | undefined)).toBe(efficiency.activeMs ?? 0)
      expect(sum(row => (row['usage'] as { outputTokens?: number } | undefined)?.outputTokens)).toBe(efficiency.outputTokens ?? 0)
      expect(sum(row => (row['toolCalls'] as { count?: number } | undefined)?.count)).toBe(efficiency.toolCalls ?? 0)
    }
  })

  it('a bundle whose rounds recorded no accounting still gets the ledger file', async () => {
    const write = await writeEvalReport(partialRunBundle(tmpTree()))
    const rows = readFileSync(write.usagePath, 'utf8').trim().split('\n').filter(line => line !== '')
    // Every round is a line, none of them carrying a toolCalls key.
    expect(rows).toHaveLength(4)
    for (const line of rows) expect(line).not.toContain('toolCalls')
  })
})
