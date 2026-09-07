import { existsSync, readFileSync } from 'node:fs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli-core.ts'
import { analyzeBundle, parseMissionId, writeEvalReport } from '../src/report.ts'
import { EvalService } from '../src/service.ts'
import { captureIo, cleanupTmp, tmpTree } from './helpers.ts'

afterEach(cleanupTmp)

// --- fixture builder ---------------------------------------------------------

const sha = (prefix: string): string => prefix.padEnd(64, '0')

const verdict = (task: string, criterion: string, pass: boolean, by = 'probes/probe.mjs'): Record<string, unknown> => ({
  schema: 'dataseek.verdict/1', task, criterion, pass, evidence: `${criterion} ${pass ? '通过' : '未过'}（可查证事实）`, by,
})

const delegation = (stage: string, round: number, durationMs: number, outputTokens: number, observed = 'gpt-x'): Record<string, unknown> => ({
  kind: 'delegation', stage, round, childSessionId: `sess-${round}`, promptSha: sha('ab'), startedAt: 0,
  durationMs, usage: { inputTokens: outputTokens * 3, outputTokens }, model: { declared: 'gpt-x', observed },
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

/** One script-verdict annotation carrying the given docs. */
const scriptNote = (task: string, docs: Array<[string, boolean]>, by = 'cli', createdAt = 0): FixtureAnnotation => ({
  ns: 'script', by, createdAt, payload: docs.map(([criterion, pass]) => verdict(task, criterion, pass)),
})

/** One delegation annotation for a cell. */
const orchestratorNote = (stage: string, round: number, durationMs: number, tokens: number, observed = 'gpt-x', createdAt = 0): FixtureAnnotation => ({
  ns: 'orchestrator', by: 'orchestrator', createdAt,
  payload: [delegation(stage, round, durationMs, tokens, observed)],
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
