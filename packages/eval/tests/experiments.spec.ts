import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { deriveExperimentStatus, experimentDetail, listExperiments, STALL_THRESHOLD_MS } from '../src/experiments.ts'
import { conditionFactors } from '../src/read.ts'
import type { MissionRunListFace } from '../src/faces.ts'
import type { EvalRunStatus } from '../src/job.ts'
import { canonicalJson, hashConditionDocument } from '../src/hash.ts'
import { createExperiment, type ExperimentRecord } from '../src/experiment-store.ts'
import { EvalService } from '../src/service.ts'
import { cleanupTmp, fakeRegistry, hostsWith, tmpTree, useDshHome, writeJson } from './helpers.ts'
import { createHash } from 'node:crypto'

afterEach(cleanupTmp)

/**
 * I5·T35a — the lab tab's projection. The status rule is a pure function with
 * one test per word plus its named coarse edges; the list and the overview are
 * projections over a fake mission ledger and real experiment directories
 * under the deployment's state root (T73).
 */

const CONDITION_A = {
  schema: 'dataseek.condition/1',
  harness: { name: 'codex', version: '0.144.0', drive: 'exec' },
  model: { declared: 'gpt-5.6-sol', endpoint: 'default' },
  reasoning: { effort: 'default' },
  permissions: 'workspace-write',
  instructions: 'none',
  preset: null,
  skills: { pack: null },
  home: { sha: 'a'.repeat(64) },
  env: { keys: [] },
} as const

const CONDITION_B = { ...CONDITION_A, model: { declared: 'gpt-5.6-thinking', endpoint: 'default' } } as const

const PLAN = {
  schema: 'dataseek.plan/1',
  dataset: { registry: 'reg', set: 'ds', commit: 'c0ffee1234567890c0ffee1234567890c0ffee12', items: ['P0', 'P1'] },
  conditions: ['cond-a', 'cond-b'],
  reps: 3,
  stages: ['stage1'],
  order: { seed: 7, interleave: true },
  budget: { activeMinutes: 30, turns: 40 },
  expectedNs: ['script'],
} as const

/** The sha the run loop records for a plan document. */
function shaOf(document: unknown): string {
  return createHash('sha256').update(canonicalJson(document)).digest('hex')
}

/** A deployment with one experiment, its two conditions in the library, and the set's view. */
async function experimentWithPlan(
  plan: Record<string, unknown> = { ...PLAN },
  options: { locked?: boolean; source?: { from: string; path: string } } = {},
): Promise<{
  stateRoot: string
  record: ExperimentRecord
  planPath: string
  validate: (record: ExperimentRecord) => ReturnType<EvalService['validateExperiment']>
}> {
  const { stateRoot } = useDshHome()
  writeJson(stateRoot, 'conditions/cond-a.json', CONDITION_A)
  writeJson(stateRoot, 'conditions/cond-b.json', CONDITION_B)
  if (options.locked === true) {
    // What `conditions provision` writes: the lock carries the declaration it
    // was taken against, so a later edit to the declaration breaks the match.
    for (const [id, document] of [['cond-a', CONDITION_A], ['cond-b', CONDITION_B]] as const) {
      writeJson(stateRoot, `conditions/${id}.lock.json`, {
        schema: 'dataseek.condition-lock/1',
        sha: hashConditionDocument(document),
        homeSha: 'a'.repeat(64),
        condition: document,
      })
    }
  }
  // The materialized dataset view validate reads the contract files from.
  const view = join(tmpTree(), 'view', 'ds')
  writeJson(view, 'schemas/stage1.json', { type: 'object' })
  writeJson(view, 'items/P0/item.json', { id: 'P0' })
  writeJson(view, 'items/P1/item.json', { id: 'P1' })
  const record = await createExperiment(stateRoot, {
    name: 'harness-comparison',
    dataset: { registry: 'reg', set: 'ds', commit: 'c0ffee1234567890c0ffee1234567890c0ffee12' },
    plan: `${JSON.stringify(plan, null, 2)}\n`,
    ...(options.source === undefined ? {} : { source: options.source }),
  })
  const service = new EvalService(hostsWith(fakeRegistry({ sets: { ds: view }, latest: 'c0ffee1234567890c0ffee1234567890c0ffee12' })))
  return { stateRoot, record, planPath: record.planPath, validate: entry => service.validateExperiment(entry.id) }
}

/** One cell of the fake ledger. */
interface Cell {
  id: string
  task: string
  condition: string
  rep: number
  state: string
  bucket: string
  enteredCurrentAt?: number
  annotations?: Array<{ ns: string; attempt: number; payload: unknown; createdAt: number }>
}

/** A mission face over in-memory runs — the structural face, nothing imported. */
function ledger(runs: Array<{
  id: string
  meta: Record<string, unknown>
  createdAt?: number
  originSession?: string
  cells: Cell[]
  unreleased?: string[]
}>): MissionRunListFace {
  return {
    runList: () => runs.map(run => ({ id: run.id })),
    runStatus: (runId: string) => {
      const run = runs.find(entry => entry.id === runId)
      if (run === undefined) throw new Error(`no run ${runId}`)
      const buckets: Record<string, string[]> = {}
      for (const cell of run.cells) (buckets[cell.bucket] ??= []).push(cell.id)
      return {
        run: {
          id: run.id,
          state: 'active',
          createdAt: run.createdAt ?? 1_700_000_000_000,
          meta: run.meta,
          ...(run.originSession === undefined ? {} : { originSession: run.originSession }),
        },
        rows: run.cells.map(cell => ({
          id: cell.id,
          labels: { task: cell.task, condition: cell.condition, rep: String(cell.rep) },
          state: cell.state,
          bucket: cell.bucket,
          currentAttempt: 1,
          ...(cell.enteredCurrentAt === undefined ? {} : { enteredCurrentAt: cell.enteredCurrentAt }),
        })),
        buckets,
        unreleased: run.unreleased ?? [],
      }
    },
    get: (missionId: string, runId?: string) => {
      const cell = runs.find(entry => entry.id === runId)?.cells.find(entry => entry.id === missionId)
      return { mission: { annotations: cell?.annotations ?? [] } }
    },
  }
}

/** run.meta as the run loop writes it. */
function runMeta(planPath: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    datasetId: 'ds',
    commit: 'c0ffee1234567890',
    planSha: shaOf(PLAN),
    planPath,
    evalVersion: '0.1.0-rc.1+abc1234',
    snapshot: { repo: '/repo', commit: 'c0ffee1234567890', datasetId: 'ds' },
    conditions: [
      { id: 'cond-a', sha: 'a'.repeat(64), condition: CONDITION_A },
      { id: 'cond-b', sha: 'b'.repeat(64), condition: CONDITION_B },
    ],
    order: { seed: 7, sequence: ['1', '2'] },
    concurrency: 1,
    budget: { activeMinutes: 30, turns: 40 },
    judge: { conditions: [{ id: 'judge-a', sha: 'c'.repeat(64), condition: CONDITION_A }], samples: 2 },
    expectedNs: ['script', 'llm-draft'],
    startedAt: 1_757_600_000_000,
    readiness: [{
      kind: 'readiness',
      condition: 'cond-a',
      role: 'player',
      harness: 'codex',
      provider: 'codex',
      ok: true,
      startedAt: 1_757_599_000_000,
      durationMs: 4200,
      childSessionId: 'sess-probe',
      declaredModel: 'gpt-5.6-sol',
      requestedModel: 'gpt-5.6-sol',
      observedModel: 'gpt-5.6-sol',
    }],
    ...overrides,
  }
}

describe('deriveExperimentStatus', () => {
  it('a plan whose validate has not passed (or never ran) is a draft', () => {
    expect(deriveExperimentStatus({ validation: null, run: null, job: null })).toBe('draft')
    expect(deriveExperimentStatus({ validation: { ok: false }, run: null, job: null })).toBe('draft')
  })

  it('a plan that validates and has no run is awaiting approval', () => {
    expect(deriveExperimentStatus({ validation: { ok: true }, run: null, job: null })).toBe('pending-approval')
  })

  it('a live job means running, with or without a run in the ledger', () => {
    expect(deriveExperimentStatus({ validation: { ok: true }, run: null, job: { status: 'running' } })).toBe('running')
    expect(deriveExperimentStatus({
      validation: null,
      run: { cellStates: ['judged', 'judged'], buckets: { done: 2 } },
      job: { status: 'running' },
    })).toBe('running')
  })

  it('a moving cell means running even after the job settled, until the stall threshold passes', () => {
    const now = 1_757_700_000_000
    expect(deriveExperimentStatus({
      validation: null,
      run: { cellStates: ['stage-1', 'archived'], buckets: { active: 1, done: 1 } },
      job: { status: 'completed' },
      lastProgressAt: now - STALL_THRESHOLD_MS,
      now,
    })).toBe('running')
    expect(deriveExperimentStatus({
      validation: null,
      run: { cellStates: ['stage-1', 'archived'], buckets: { active: 1, done: 1 } },
      job: { status: 'completed' },
      lastProgressAt: now - STALL_THRESHOLD_MS - 1,
      now,
    })).toBe('stalled')
  })

  it('a live job is never stalled, however old the last ledger movement', () => {
    const now = 1_757_700_000_000
    expect(deriveExperimentStatus({
      validation: null,
      run: { cellStates: ['stage-1'], buckets: { active: 1 } },
      job: { status: 'running' },
      lastProgressAt: now - 60 * 60_000,
      now,
    })).toBe('running')
  })

  it('judging waits on a human, which is not stalling', () => {
    const now = 1_757_700_000_000
    expect(deriveExperimentStatus({
      validation: null,
      run: { cellStates: ['judged', 'released'], buckets: { done: 2 } },
      job: null,
      lastProgressAt: now - 60 * 60_000,
      now,
    })).toBe('judging')
  })

  it('every cell at judged or beyond, with nothing live, is judging', () => {
    for (const state of ['judged', 'halted', 'archived', 'releasable']) {
      expect(deriveExperimentStatus({
        validation: null,
        run: { cellStates: [state, 'archived'], buckets: { done: 2 } },
        job: { status: 'completed' },
      })).toBe('judging')
    }
  })

  it('every cell released but nobody closed is still judging — it never becomes done on its own', () => {
    expect(deriveExperimentStatus({
      validation: null,
      run: { cellStates: ['released', 'released'], buckets: { done: 2 } },
      job: { status: 'completed' },
    })).toBe('judging')
  })

  it('a closure decides: exits ①②③ are done, exit ④ is void — and it outranks the job', () => {
    const run = { cellStates: ['judged', 'judged'], buckets: { done: 2 } }
    for (const exit of ['final', 'flagged', 'unreviewed'] as const) {
      expect(deriveExperimentStatus({ validation: null, run, job: null, closure: { exit } })).toBe('done')
    }
    expect(deriveExperimentStatus({ validation: null, run, job: null, closure: { exit: 'void' } })).toBe('void')
    expect(deriveExperimentStatus({ validation: null, run, job: { status: 'failed' }, closure: { exit: 'void' } })).toBe('void')
  })

  it('a failed job is refused, and a killed one is cancelled — both outrank the ledger', () => {
    expect(deriveExperimentStatus({ validation: { ok: true }, run: null, job: { status: 'failed' } })).toBe('refused')
    expect(deriveExperimentStatus({
      validation: null,
      run: { cellStates: ['released'], buckets: { done: 1 } },
      job: { status: 'failed' },
    })).toBe('refused')
    // A stale ledger does not turn a killed job into a stall.
    expect(deriveExperimentStatus({
      validation: null,
      run: { cellStates: ['stage-1'], buckets: { active: 1 } },
      job: { status: 'killed' },
      lastProgressAt: 0,
      now: 1_757_700_000_000,
    })).toBe('cancelled')
    expect(deriveExperimentStatus({
      validation: null,
      run: { cellStates: ['stage-1'], buckets: { active: 1 } },
      job: { status: 'killed' },
    })).toBe('cancelled')
  })

  it('the named coarse edges: a stopped-unfinished run and an empty ledger both read as running', () => {
    // A settled job that left cells mid-stage — there is no eighth word.
    expect(deriveExperimentStatus({
      validation: null,
      run: { cellStates: ['stage-1', 'pending'], buckets: { ready: 2 } },
      job: { status: 'completed' },
    })).toBe('running')
    // A run with no cells at all: an empty ledger is not evidence of completion.
    expect(deriveExperimentStatus({
      validation: null,
      run: { cellStates: [], buckets: {} },
      job: { status: 'completed' },
    })).toBe('running')
  })

  it('without a job record a run reads by its cells alone (cancel and refusal are unreachable)', () => {
    expect(deriveExperimentStatus({
      validation: null,
      run: { cellStates: ['archived', 'archived'], buckets: { done: 2 } },
      job: null,
    })).toBe('judging')
  })
})

describe('conditionFactors', () => {
  it('reports the fields a set of declarations disagrees on, sorted', () => {
    expect(conditionFactors([CONDITION_A, CONDITION_B])).toEqual(['model.declared'])
  })

  it('one condition has no factor to report', () => {
    expect(conditionFactors([CONDITION_A])).toEqual([])
  })

  it('notes is never a factor, and an absent field is a difference like any other', () => {
    const withNotes = { ...CONDITION_A, notes: 'reviewed' }
    expect(conditionFactors([CONDITION_A, withNotes])).toEqual([])
    const withScope = { ...CONDITION_A, scope: 'eval-b' }
    expect(conditionFactors([CONDITION_A, withScope])).toEqual(['scope'])
  })
})

describe('listExperiments', () => {
  it('lists an unstarted experiment as a draft row with its pin', async () => {
    const { stateRoot, record, planPath, validate } = await experimentWithPlan()
    const result = await listExperiments({ stateRoot, validate })
    expect(result.rows).toHaveLength(1)
    const row = result.rows[0]!
    expect(row).toMatchObject({
      id: `experiment:${record.id}`,
      experimentId: record.id,
      legacy: false,
      name: 'harness-comparison',
      planPath,
      runId: null,
      conditions: ['cond-a', 'cond-b'],
      items: 2,
      reps: 3,
      factors: ['model.declared'],
      progress: null,
      startedAt: null,
      unit: null,
    })
    expect(row.snapshot).toEqual({ registry: 'reg', datasetId: 'ds', commit: 'c0ffee1234567890c0ffee1234567890c0ffee12' })
    // This plan validates (a missing lock is a warning, not an error), so it
    // is waiting for a human rather than for its author.
    expect(row.status).toBe('pending-approval')
    expect(row.validation?.ok).toBe(true)
    // No mission service mounted: the listing still answers and says why.
    expect(result.notes.some(note => note.includes('no mission service'))).toBe(true)
  })

  it('locked conditions still validate — the row stays 待批准', async () => {
    const { stateRoot, validate } = await experimentWithPlan({ ...PLAN }, { locked: true })
    const result = await listExperiments({ stateRoot, validate })
    expect(result.rows[0]).toMatchObject({ status: 'pending-approval', validation: { ok: true } })
  })

  it('a plan validate rejects is a draft, with its error count on the row', async () => {
    // expectedNs empty: the plan names no verdict source, which is a contract
    // error rather than a warning — nothing could judge this run.
    const { stateRoot, validate } = await experimentWithPlan({ ...PLAN, expectedNs: [] })
    const result = await listExperiments({ stateRoot, validate })
    expect(result.rows[0]).toMatchObject({ status: 'draft' })
    expect(result.rows[0]!.validation?.errors).toBeGreaterThan(0)
  })

  it('an experiment with a run of its own is ONE row — the run, not a duplicate draft', async () => {
    const { stateRoot, record, planPath } = await experimentWithPlan()
    const mission = ledger([{
      id: 'run-20260913-aa',
      meta: runMeta(planPath, { experimentId: record.id }),
      cells: [
        { id: '1', task: 'P0', condition: 'cond-a', rep: 1, state: 'released', bucket: 'done' },
        { id: '2', task: 'P1', condition: 'cond-b', rep: 1, state: 'released', bucket: 'done' },
      ],
    }])
    const result = await listExperiments({ mission, stateRoot })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      id: 'run-20260913-aa',
      experimentId: record.id,
      legacy: false,
      name: 'harness-comparison',
      runId: 'run-20260913-aa',
      status: 'judging',
      items: 2,
      reps: 1,
      conditions: ['cond-a', 'cond-b'],
      judges: ['judge-a'],
      factors: ['model.declared'],
      progress: { done: 2, total: 2 },
      startedAt: 1_757_600_000_000,
    })
    expect(result.rows[0]!.snapshot.registry).toBe('reg')
  })

  it('pairs by experimentId first, even when the plan was edited after the run', async () => {
    const { stateRoot, record } = await experimentWithPlan()
    const mission = ledger([{
      id: 'run-new',
      meta: runMeta('/elsewhere/plan.json', { experimentId: record.id, planSha: 'f'.repeat(64) }),
      cells: [{ id: '1', task: 'P0', condition: 'cond-a', rep: 1, state: 'archived', bucket: 'done' }],
    }])
    const result = await listExperiments({ mission, stateRoot })
    expect(result.rows.map(row => [row.runId, row.experimentId])).toEqual([['run-new', record.id]])
  })

  it('an old run without experimentId pairs by planSha — the reason import keeps the bytes', async () => {
    const { stateRoot, record } = await experimentWithPlan()
    const mission = ledger([{
      id: 'run-old',
      meta: runMeta('/home/user/repo/datasets/ds/plans/harness-comparison.json'),
      cells: [{ id: '1', task: 'P0', condition: 'cond-a', rep: 1, state: 'archived', bucket: 'done' }],
    }])
    const result = await listExperiments({ mission, stateRoot })
    expect(result.rows.map(row => [row.runId, row.experimentId, row.legacy])).toEqual([['run-old', record.id, false]])
  })

  it('falls back to planPath against an imported experiment\'s source path when the sha no longer matches', async () => {
    const { stateRoot, record } = await experimentWithPlan({ ...PLAN }, {
      source: { from: 'reg@main', path: 'datasets/ds/plans/harness-comparison.json' },
    })
    const mission = ledger([{
      id: 'run-edited',
      meta: runMeta('/home/user/repo/datasets/ds/plans/harness-comparison.json', { planSha: 'e'.repeat(64) }),
      cells: [{ id: '1', task: 'P0', condition: 'cond-a', rep: 1, state: 'archived', bucket: 'done' }],
    }])
    const result = await listExperiments({ mission, stateRoot })
    expect(result.rows.map(row => [row.runId, row.experimentId])).toEqual([['run-edited', record.id]])
  })

  it('a run no experiment claims is still listed, flagged legacy (旧运行（未关联实验）)', async () => {
    const { stateRoot, record } = await experimentWithPlan()
    const mission = ledger([{
      id: 'run-orphan',
      meta: runMeta('/home/user/repo/datasets/ds/plans/other.json', { planSha: 'd'.repeat(64) }),
      cells: [{ id: '1', task: 'P0', condition: 'cond-a', rep: 1, state: 'archived', bucket: 'done' }],
    }])
    const result = await listExperiments({ mission, stateRoot })
    const orphan = result.rows.find(row => row.runId === 'run-orphan')
    expect(orphan).toMatchObject({ experimentId: null, legacy: true, name: 'other' })
    // The experiment it did not claim stays a draft of its own.
    expect(result.rows.find(row => row.experimentId === record.id)).toMatchObject({ runId: null })
  })

  it('ignores runs another package wrote (no evalVersion), and skips a broken experiment directory with a note', async () => {
    const { stateRoot, record, planPath } = await experimentWithPlan()
    writeJson(join(stateRoot, 'experiments', 'broken-20260920-0000'), 'meta.json', { experimentId: 'nope' })
    const mission = ledger([
      { id: 'session-s1', meta: { originSession: 's1' }, cells: [] },
      {
        id: 'run-eval',
        meta: runMeta(planPath, { experimentId: record.id }),
        cells: [{ id: '1', task: 'P0', condition: 'cond-a', rep: 1, state: 'archived', bucket: 'done' }],
      },
    ])
    const result = await listExperiments({ mission, stateRoot })
    expect(result.rows.map(row => row.id)).toEqual(['run-eval'])
    expect(result.notes.some(note => note.includes('broken-20260920-0000'))).toBe(true)
  })

  it('a job that failed before runCreate marks its experiment refused and carries the detail', async () => {
    const { stateRoot, planPath } = await experimentWithPlan()
    const jobs: EvalRunStatus[] = [{
      jobId: 'eval-run-1',
      runId: 'run-never-created',
      status: 'failed',
      detail: 'READINESS_FAILED: cond-a could not authenticate',
      startedAt: 1_757_600_000_000,
      finishedAt: 1_757_600_030_000,
      lines: 12,
      plan: planPath,
    }]
    const result = await listExperiments({ mission: ledger([]), stateRoot, jobs })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      runId: null,
      status: 'refused',
      statusDetail: 'READINESS_FAILED: cond-a could not authenticate',
    })
  })

  it('without a state root it lists runs only, as legacy rows, and says so', async () => {
    const mission = ledger([{
      id: 'run-only',
      meta: runMeta('/gone/plan.json'),
      cells: [{ id: '1', task: 'P0', condition: 'cond-a', rep: 1, state: 'stage-1', bucket: 'active' }],
    }])
    // The fixture's ledger last moved in 2025; the clock is pinned to that
    // run's start so the stall rule does not fire on an old fixture.
    const result = await listExperiments({ mission, now: 1_757_600_000_000 })
    expect(result.rows.map(row => [row.status, row.legacy])).toEqual([['running', true]])
    expect(result.notes.some(note => note.includes('no eval state root'))).toBe(true)
  })

  it('a mission face that cannot list runs degrades to drafts with a note', async () => {
    const { stateRoot } = await experimentWithPlan()
    const narrow = { runStatus: () => { throw new Error('unused') }, get: () => ({ mission: { annotations: [] } }) } as unknown as MissionRunListFace
    const result = await listExperiments({ mission: narrow, stateRoot })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]!.runId).toBeNull()
    expect(result.notes.some(note => note.includes('cannot list runs'))).toBe(true)
  })
})

describe('listExperiments — T72 journey fields', () => {
  const NOW = 1_757_700_000_000
  const closure = (exit: string, createdAt: number, reason: string | null = null) => ({
    ns: 'eval-closure', attempt: 1, createdAt,
    payload: { kind: 'closure', exit, reason, at: new Date(createdAt).toISOString(), by: 'tab:s1' },
  })
  const archive = (archived: boolean, createdAt: number) => ({
    ns: 'eval-archive', attempt: 1, createdAt,
    payload: { kind: 'archive', archived, at: new Date(createdAt).toISOString(), by: 'tab:s1' },
  })

  it('a run with no live job and no movement for over ten minutes is stalled, with its age in minutes', async () => {
    const mission = ledger([{
      id: 'run-stuck',
      meta: runMeta('/gone/plan.json', { startedAt: NOW - 40 * 60_000 }),
      createdAt: NOW - 40 * 60_000,
      cells: [
        { id: '1', task: 'P0', condition: 'cond-a', rep: 1, state: 'stage-1', bucket: 'active', enteredCurrentAt: NOW - 25 * 60_000 },
        { id: '2', task: 'P0', condition: 'cond-b', rep: 1, state: 'pending', bucket: 'ready' },
      ],
    }])
    const result = await listExperiments({ mission, now: NOW })
    expect(result.rows[0]).toMatchObject({ status: 'stalled', stalledMinutes: 25, lastProgressAt: NOW - 25 * 60_000 })
  })

  it('progress within ten minutes is not stalled — an annotation counts as movement', async () => {
    const mission = ledger([{
      id: 'run-moving',
      meta: runMeta('/gone/plan.json', { startedAt: NOW - 40 * 60_000 }),
      createdAt: NOW - 40 * 60_000,
      cells: [{
        id: '1', task: 'P0', condition: 'cond-a', rep: 1, state: 'stage-1', bucket: 'active',
        enteredCurrentAt: NOW - 30 * 60_000,
        annotations: [{ ns: 'orchestrator', attempt: 1, payload: { kind: 'delegation' }, createdAt: NOW - 3 * 60_000 }],
      }],
    }])
    const result = await listExperiments({ mission, now: NOW })
    expect(result.rows[0]).toMatchObject({ status: 'running', stalledMinutes: null })
  })

  it('progress counts the cells the status rule counts: a halted cell is done, so 评估中 is always n/n (T80c P1-3)', async () => {
    const mission = ledger([{
      id: 'run-halted',
      meta: runMeta('/gone/plan.json', { startedAt: NOW - 40 * 60_000 }),
      createdAt: NOW - 40 * 60_000,
      // mission files a halted cell under `halted`, not `done` — the old count read 评估中 at 0/1.
      cells: [{ id: '1', task: 'P0', condition: 'cond-a', rep: 1, state: 'halted', bucket: 'halted' }],
    }])
    const result = await listExperiments({ mission, now: NOW })
    expect(result.rows[0]).toMatchObject({ status: 'judging', progress: { done: 1, total: 1 } })
  })

  it('a partly finished run counts only its judged-or-beyond cells, whatever mission\'s buckets say', async () => {
    const mission = ledger([{
      id: 'run-part',
      meta: runMeta('/gone/plan.json', { startedAt: NOW - 5 * 60_000 }),
      createdAt: NOW - 5 * 60_000,
      cells: [
        { id: '1', task: 'P0', condition: 'cond-a', rep: 1, state: 'judged', bucket: 'active' },
        { id: '2', task: 'P0', condition: 'cond-b', rep: 1, state: 'stage-1', bucket: 'active', enteredCurrentAt: NOW - 60_000 },
      ],
    }])
    const result = await listExperiments({ mission, now: NOW })
    expect(result.rows[0]).toMatchObject({ status: 'running', progress: { done: 1, total: 2 } })
  })

  it('a live job of this instance keeps an old run out of 停滞', async () => {
    const mission = ledger([{
      id: 'run-live',
      meta: runMeta('/gone/plan.json', { startedAt: NOW - 40 * 60_000 }),
      createdAt: NOW - 40 * 60_000,
      cells: [{ id: '1', task: 'P0', condition: 'cond-a', rep: 1, state: 'stage-1', bucket: 'active' }],
    }])
    const jobs: EvalRunStatus[] = [{
      jobId: 'eval-run-1', runId: 'run-live', status: 'running', startedAt: NOW - 40 * 60_000, lines: 3,
    }]
    const result = await listExperiments({ mission, jobs, now: NOW })
    expect(result.rows[0]!.status).toBe('running')
  })

  it('a CLI run with no originSession is still listed, with originSession null; the caller session is echoed', async () => {
    const mission = ledger([
      { id: 'run-mine', meta: runMeta('/a/plan-a.json'), originSession: 's1', cells: [] },
      { id: 'run-cli', meta: runMeta('/a/plan-b.json'), cells: [] },
    ])
    const result = await listExperiments({ mission, session: 's1', now: 1_700_000_000_000 })
    expect(result.session).toBe('s1')
    expect(result.rows.map(row => [row.runId, row.originSession])).toEqual(
      expect.arrayContaining([['run-mine', 's1'], ['run-cli', null]]),
    )
  })

  it('the newest closure decides the status and rides on the row', async () => {
    const mission = ledger([{
      id: 'run-closed',
      meta: runMeta('/gone/plan.json'),
      cells: [
        { id: '1', task: 'P0', condition: 'cond-a', rep: 1, state: 'judged', bucket: 'done', annotations: [closure('unreviewed', 100)] },
        { id: '2', task: 'P0', condition: 'cond-b', rep: 1, state: 'judged', bucket: 'done', annotations: [closure('flagged', 200, '判官缺席，只看方向')] },
      ],
    }])
    const result = await listExperiments({ mission, now: NOW })
    expect(result.rows[0]).toMatchObject({ status: 'done', closure: { exit: 'flagged', reason: '判官缺席，只看方向' } })
  })

  it('archive changes grouping only: the status is untouched, and the newest mark wins', async () => {
    const cells = (annotations: Cell['annotations']): Cell[] => [
      { id: '1', task: 'P0', condition: 'cond-a', rep: 1, state: 'judged', bucket: 'done', annotations },
    ]
    const mission = ledger([
      { id: 'run-archived', meta: runMeta('/a/one.json'), cells: cells([archive(true, 100)]) },
      { id: 'run-restored', meta: runMeta('/a/two.json'), cells: cells([archive(true, 100), archive(false, 200)]) },
    ])
    const result = await listExperiments({ mission, now: NOW })
    const byRun = new Map(result.rows.map(row => [row.runId, row]))
    expect(byRun.get('run-archived')).toMatchObject({ archived: true, status: 'judging' })
    expect(byRun.get('run-restored')).toMatchObject({ archived: false, status: 'judging' })
  })

  it('drafts carry the journey fields as empty', async () => {
    const { stateRoot } = await experimentWithPlan()
    const result = await listExperiments({ stateRoot })
    expect(result.rows[0]).toMatchObject({ originSession: null, archived: false, closure: null, lastProgressAt: null, stalledMinutes: null })
  })
})

describe('experimentDetail', () => {
  it('answers the overview: the row, the meta digest, the readiness records, and both histograms', () => {
    const mission = ledger([{
      id: 'run-detail',
      meta: runMeta('/repo/datasets/ds/plans/harness-comparison.json'),
      cells: [
        { id: '1', task: 'P0', condition: 'cond-a', rep: 1, state: 'archived', bucket: 'done' },
        { id: '2', task: 'P0', condition: 'cond-b', rep: 1, state: 'stage-1', bucket: 'active' },
      ],
      unreleased: ['2'],
    }])
    const jobs: EvalRunStatus[] = [{
      jobId: 'eval-run-9', runId: 'run-detail', status: 'running', startedAt: 1, lines: 40,
    }]
    const detail = experimentDetail(mission, 'run-detail', jobs)

    expect(detail.row).toMatchObject({ runId: 'run-detail', status: 'running', progress: { done: 1, total: 2 } })
    expect(detail.meta).toMatchObject({
      evalVersion: '0.1.0-rc.1+abc1234',
      datasetId: 'ds',
      commit: 'c0ffee1234567890',
      order: { seed: 7, sequence: ['1', '2'] },
      concurrency: 1,
      budget: { activeMinutes: 30, turns: 40 },
      expectedNs: ['script', 'llm-draft'],
    })
    expect(detail.meta?.conditions).toEqual([
      { id: 'cond-a', sha: 'a'.repeat(64), harness: 'codex', model: 'gpt-5.6-sol' },
      { id: 'cond-b', sha: 'b'.repeat(64), harness: 'codex', model: 'gpt-5.6-thinking' },
    ])
    expect(detail.meta?.judge).toEqual({ conditions: [{ id: 'judge-a', sha: 'c'.repeat(64) }], samples: 2 })
    expect(detail.readiness).toEqual([{
      condition: 'cond-a',
      role: 'player',
      harness: 'codex',
      provider: 'codex',
      ok: true,
      startedAt: 1_757_599_000_000,
      durationMs: 4200,
      childSessionId: 'sess-probe',
      declaredModel: 'gpt-5.6-sol',
      requestedModel: 'gpt-5.6-sol',
      observedModel: 'gpt-5.6-sol',
      scope: null,
      reason: null,
      infrastructure: null,
      unit: null,
    }])
    expect(detail.buckets).toEqual({ done: 1, active: 1 })
    expect(detail.states).toEqual({ archived: 1, 'stage-1': 1 })
    expect(detail.unreleased).toEqual(['2'])
    expect(detail.job).toMatchObject({ jobId: 'eval-run-9', status: 'running', detail: null, finishedAt: null })
  })

  it('a run without eval meta answers a null digest rather than inventing one', () => {
    const mission = ledger([{ id: 'session-s1', meta: {}, cells: [] }])
    expect(experimentDetail(mission, 'session-s1').meta).toBeNull()
  })
})
