/**
 * I5·T38 — the report page's two Remote verbs: `report` (find the run's
 * exported bundle, analyze it, project) and `finalize` (walk the release
 * gate).
 *
 * The cases worth pinning are the two a reader could be misled by. First,
 * "not exported yet" must not read as "no report": a run whose bundle nobody
 * has written answers with `bundleDir: null` and the directories it looked
 * in, so the page offers a button instead of an empty section. Second, the
 * comparison gate must not be re-decidable on the client: a bundle whose four
 * invariants did not all hold sends NO pairs at all, rather than pairs plus a
 * flag the page could forget to check.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EvalRemoteService } from '../src/remote.ts'
import type { EvalReport } from '../src/report.ts'
import { exportDirCandidates, projectFinalize, projectReport } from '../src/report-view.ts'
import { EvalService } from '../src/service.ts'
import { cleanupTmp, tmpTree, writeJson } from './helpers.ts'

afterEach(cleanupTmp)

const RUN = 'run-20260914-aa'

/** A live agent as far as these verbs care: a session id. */
function agentOf(): Agent {
  return { session: { id: 's1', header: {} } } as unknown as Agent
}

/**
 * The smallest thing `analyzeBundle` accepts: a run.json with eval's meta and
 * one cell carrying one script verdict. Enough to exercise the whole path —
 * the four invariants, the efficiency table and the judge block all have
 * honest answers over it.
 */
function writeBundle(outDir: string, runId: string, meta: Record<string, unknown> = {}): string {
  const bundle = join(outDir, `${runId}-bundle`)
  const attempt = join(bundle, 'missions', 'p0-cond-a-rep1', 'attempt-1')
  mkdirSync(join(attempt, 'artifacts'), { recursive: true })
  writeFileSync(join(bundle, 'run.json'), `${JSON.stringify({
    id: runId,
    createdAt: 0,
    state: 'closed',
    meta: { datasetId: 'ds', evalVersion: '0.1.0-rc.1', expectedNs: ['script'], ...meta },
    stateMachine: { states: [], transitions: [] },
  }, null, 2)}\n`)
  writeFileSync(join(attempt, 'meta.json'), `${JSON.stringify({
    attempt: 1, state: 'released', refs: {}, enteredAt: {}, checkpoints: [], history: [], artifacts: [], attestations: [],
  }, null, 2)}\n`)
  writeFileSync(join(attempt, 'annotations.json'), `${JSON.stringify([{
    missionId: 'p0-cond-a-rep1', attempt: 1, ns: 'script', by: 'cli', createdAt: 0,
    payload: [{ schema: 'dataseek.verdict/1', task: 'P0', criterion: 'c1', pass: true, evidence: 'held', by: 'probes/p.mjs' }],
  }], null, 2)}\n`)
  return bundle
}

/** A mission READ face that answers one run, with the meta a test hands it. */
function missionOf(meta: Record<string, unknown>): { get(name: string): unknown } {
  const mission = {
    dataDir: '/nowhere',
    runStatus: (runId: string) => {
      if (runId !== RUN) throw new Error(`unknown run ${runId}`)
      return { run: { id: runId, state: 'closed', createdAt: 0, meta }, rows: [], buckets: {}, unreleased: [] }
    },
    get: () => { throw new Error('not used') },
  }
  return { get: (name: string) => (name === 'mission' ? mission : undefined) }
}

/** Mount the Remote over a service whose mission face answers `meta`. */
async function bench(meta: Record<string, unknown>) {
  const ctx = new Context()
  const service = new EvalService(missionOf(meta))
  ctx.provide('dshEval', service as never)
  const fiber = ctx.plugin(EvalRemoteService)
  await fiber.await()
  return { fiber, service, remote: ctx.get('dshEvalRemote') as EvalRemoteService }
}

describe('the report verb finds the run\'s bundle', () => {
  it('a run nobody exported answers "export first" and names every directory it looked in', async () => {
    const repo = tmpTree()
    const { fiber, remote } = await bench({ snapshot: { repo, commit: 'c0ffee', datasetId: 'ds' } })

    const view = await remote.report(agentOf(), { runId: RUN })

    expect(view.bundleDir).toBeNull()
    // The state a person can act on: not an error, not an empty page.
    expect(view.refusal).toContain('export it first')
    expect(view.searched).toEqual([join(repo, 'exports')])
    expect(view.invariants).toEqual([])
    expect(view.pairs).toEqual([])
    await fiber.dispose()
  })

  it('reads the bundle under the PLAN\'s own exports directory', async () => {
    const repo = tmpTree()
    const exports = join(tmpTree(), 'elsewhere')
    const plan = writeJson(repo, 'plans/p.json', { schema: 'dataseek.plan/1', exports })
    mkdirSync(exports, { recursive: true })
    writeBundle(exports, RUN)
    const { fiber, remote } = await bench({ planPath: plan, snapshot: { repo, commit: 'c0ffee', datasetId: 'ds' } })

    const view = await remote.report(agentOf(), { runId: RUN })

    expect(view.bundleDir).toBe(join(exports, `${RUN}-bundle`))
    expect(view.runId).toBe(RUN)
    // The four invariants are the report's, verbatim — four rows, always.
    expect(view.invariants.map(check => check.id))
      .toEqual(['materialization', 'fingerprint', 'subject', 'procedure'])
    expect(view.counts.rows).toBe(1)
    expect(view.cliHint).toContain(`${RUN}-bundle`)
    await fiber.dispose()
  })

  it('the directory the caller just exported into wins over the plan\'s', async () => {
    const repo = tmpTree()
    const planExports = join(tmpTree(), 'plan-exports')
    const typed = join(tmpTree(), 'typed-by-hand')
    const plan = writeJson(repo, 'plans/p.json', { schema: 'dataseek.plan/1', exports: planExports })
    mkdirSync(planExports, { recursive: true })
    writeBundle(planExports, RUN)
    writeBundle(typed, RUN)
    const { fiber, remote } = await bench({ planPath: plan, snapshot: { repo, commit: 'c0ffee', datasetId: 'ds' } })

    const view = await remote.report(agentOf(), { runId: RUN, outDir: typed })

    // The dialog takes a free-text path; a bundle written there would read as
    // 未导出 if the plan's own directory came first.
    expect(view.bundleDir).toBe(join(typed, `${RUN}-bundle`))
    await fiber.dispose()
  })

  it('a run whose meta names neither a plan nor a repository says so instead of guessing a path', async () => {
    const { fiber, remote } = await bench({})

    const view = await remote.report(agentOf(), { runId: RUN })

    expect(view.searched).toEqual([])
    expect(view.refusal).toContain('no export directory to look in')
    await fiber.dispose()
  })

  it('an unknown run is a refusal, not an empty report', async () => {
    const { fiber, remote } = await bench({})
    await expect(remote.report(agentOf(), { runId: 'run-nobody' })).rejects.toThrow(/cannot read run run-nobody/)
    await fiber.dispose()
  })
})

describe('the export-directory search order', () => {
  it('is caller, then plan, then <dataset repo>/exports — de-duplicated', async () => {
    const repo = tmpTree()
    const plan = writeJson(repo, 'plans/p.json', { schema: 'dataseek.plan/1', exports: '/plan/exports' })

    const candidates = await exportDirCandidates(
      { planPath: plan, snapshot: { repo } },
      '/typed/here',
    )

    expect(candidates).toEqual(['/typed/here', '/plan/exports', join(repo, 'exports')])
  })

  it('drops a plan it cannot read rather than inventing its exports directory', async () => {
    const repo = tmpTree()
    const candidates = await exportDirCandidates({ planPath: join(repo, 'plans', 'gone.json'), snapshot: { repo } })
    expect(candidates).toEqual([join(repo, 'exports')])
  })
})

describe('the projection', () => {
  /** An analyzed report with one pair, one judge, and a self-judged cell. */
  function reportWith(overrides: Partial<EvalReport>): EvalReport {
    return {
      bundleDir: '/out/run-1-bundle',
      runId: 'run-1',
      expectedNs: ['script'],
      rows: [],
      invariants: [
        { id: 'materialization', title: '题面一致', status: 'ok', details: ['同一哈希'] },
        { id: 'fingerprint', title: '环境同构', status: 'violated', details: ['两种指纹'] },
        { id: 'subject', title: '受试可辨', status: 'ok', details: [] },
        { id: 'procedure', title: '流程同形', status: 'unverifiable', details: ['无记录'] },
      ],
      comparisonAllowed: false,
      conditions: [],
      factors: [],
      comparisons: [{
        a: 'cond-a',
        b: 'cond-b',
        factor: { a: 'cond-a', b: 'cond-b', factor: 'model.declared', multi: null, known: true, detail: '模型不同' },
        perTask: [{ task: 'P0', aMean: 3, bMean: 2, aWeighted: 6, bWeighted: 4, deltas: [1, 1], n: 2 }],
        n: 2,
        ci: null,
        rank: null,
        rankReason: 'n = 2 < 3，不排名',
      }],
      singleCondition: false,
      judge: {
        multiSampled: 2, llmAgreement: { agreed: 1, total: 2 }, llmKappa: Number.NaN,
        humanAgreement: null, crossJudged: 1, crossAgreement: { agreed: 1, total: 1 }, crossKappa: 0.5,
        selfJudgedCriteria: 1, details: ['同判官两样本一致 1/2'],
      },
      efficiency: [],
      usageRows: [],
      judgeAssignments: [
        { missionId: 'm1', task: 'P0', condition: 'cond-a', rep: 1, judges: [{ condition: 'judge-x', model: 'gpt-x', selfJudged: false, samples: 2, verdicts: 2 }] },
        { missionId: 'm2', task: 'P0', condition: 'cond-b', rep: 1, judges: [{ condition: 'judge-x', model: 'gpt-x', selfJudged: true, samples: 2, verdicts: 2 }] },
        { missionId: 'm3', task: 'P1', condition: 'cond-a', rep: 1, judges: [{ condition: 'judge-y', model: 'gpt-y', selfJudged: false, samples: 1, verdicts: 1 }] },
      ],
      efficiencyExcluded: [],
      tasksCompletedBy: {},
      toolOnlyNs: [],
      nsCounts: {},
      missions: 2,
      attempts: 2,
      retries: 0,
      weightsAvailable: true,
      polarity: { available: true, origin: 'report/weights.json', criteria: 3, negative: 1, weighted: true },
      negativeHits: [],
      notes: ['判官本身有误差'],
      ...overrides,
    }
  }

  it('sends NO comparison at all when an invariant did not hold', () => {
    const view = projectReport(reportWith({}), 'run-1')

    // The gate is host-side and final: the page cannot open what the bundle
    // closed, because the numbers never cross the wire.
    expect(view.comparisonAllowed).toBe(false)
    expect(view.pairs).toEqual([])
    // The invariants themselves DO cross — that is how the page says why.
    expect(view.invariants.filter(check => check.status !== 'ok').map(check => check.id))
      .toEqual(['fingerprint', 'procedure'])
    expect(view.invariants[1]?.details).toEqual(['两种指纹'])
  })

  it('carries the pair table with each row\'s own judges, self-judged marked', () => {
    const view = projectReport(reportWith({ comparisonAllowed: true }), 'run-1')

    expect(view.pairs).toHaveLength(1)
    const pair = view.pairs[0]
    expect(pair?.factor).toMatchObject({ factor: 'model.declared', known: true })
    const row = pair?.rows[0]
    expect(row).toMatchObject({ task: 'P0', aMean: 3, bMean: 2, delta: 1, weightedDelta: 2, n: 2 })
    expect(row?.deltas).toEqual([1, 1])
    // One judge, and it judged its own model on the b side: the mark belongs
    // to the ROW, because the row's number is what it could have biased.
    expect(row?.judges).toEqual([{ condition: 'judge-x', model: 'gpt-x', selfJudged: true }])
    expect(pair?.rankReason).toBe('n = 2 < 3，不排名')
  })

  it('a κ that is NaN crosses as null — a degenerate agreement is not a number', () => {
    const view = projectReport(reportWith({}), 'run-1')
    expect(view.judge.llmKappa).toBeNull()
    expect(view.judge.crossKappa).toBe(0.5)
    expect(view.judge.selfJudgedCriteria).toBe(1)
  })
})

describe('the finalize verb', () => {
  it('forwards to the service and answers the counts, the cells and the log verbatim', async () => {
    const { fiber, service, remote } = await bench({})
    const finalize = vi.spyOn(service, 'finalize').mockImplementation(async (runId, options) => {
      options?.log?.('cell p0-cond-a-rep1: archived → releasable → released')
      options?.log?.('cell p0-cond-b-rep1: gate refused at archived — verdicts/ is empty')
      return {
        runId,
        cells: [
          { missionId: 'p0-cond-a-rep1', state: 'archived', action: 'released', finalState: 'released' },
          { missionId: 'p0-cond-b-rep1', state: 'archived', action: 'refused', finalState: 'archived', reason: 'verdicts/ is empty' },
          { missionId: 'p0-cond-c-rep1', state: 'pending', action: 'skipped', finalState: 'pending', category: 'not-started', reason: 'not archived (pending)' },
        ],
        released: 1,
        refused: 1,
        skipped: 1,
        skippedByCategory: { 'already-released': 0, interrupted: 0, 'not-started': 1 },
        skippedByState: { pending: 1 },
      }
    })

    const view = await remote.finalize(agentOf(), { runId: RUN })

    expect(view).toMatchObject({ runId: RUN, released: 1, refused: 1, skipped: 1, skippedByState: { pending: 1 } })
    // The gate's own words, not a count: a refusal a reader cannot read is a
    // refusal they cannot act on.
    expect(view.cells.find(cell => cell.action === 'refused')?.reason).toBe('verdicts/ is empty')
    expect(view.log).toEqual([
      'cell p0-cond-a-rep1: archived → releasable → released',
      'cell p0-cond-b-rep1: gate refused at archived — verdicts/ is empty',
    ])
    // The tab is named as the caller, so the ledger says which one asked.
    expect(finalize.mock.calls[0]?.[1]).toMatchObject({ by: 'tab:s1' })
    await fiber.dispose()
  })

  it('a skipped cell carries null rather than an absent reason key', () => {
    const view = projectFinalize({
      runId: 'run-1',
      cells: [{ missionId: 'm1', state: 'released', action: 'skipped', finalState: 'released', category: 'already-released' }],
      released: 0, refused: 0, skipped: 1,
      skippedByCategory: { 'already-released': 1, interrupted: 0, 'not-started': 0 },
      skippedByState: { released: 1 },
    }, [])

    expect(view.cells[0]).toEqual({
      missionId: 'm1', state: 'released', action: 'skipped', finalState: 'released', reason: null,
    })
  })
})
