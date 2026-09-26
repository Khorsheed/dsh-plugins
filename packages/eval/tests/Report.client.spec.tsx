// @vitest-environment jsdom
/**
 * I5·T38 — the report sub-page: the four invariants, the comparison gate, the
 * pair table, the efficiency table, the judge numbers, and the two actions.
 *
 * The assertions are about what a reader is allowed to conclude. A bundle
 * whose invariants did not all hold must show the 比较节未开 line naming which
 * ones — and no deltas anywhere. A paired row judged by its own model must
 * carry the 自评 mark. A condition whose harness never counted tool calls must
 * print a dash, not a zero. And a run nobody exported must show a state with a
 * button, never a blank page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  EvalExperimentDetail, EvalExperimentsResult, EvalFinalizeView, EvalRunReportView, EvalRunUnitsView,
} from '../src/types.ts'
import type { LabViewProps } from '../src/client/contract.ts'
import { LabView } from '../src/client/LabView.tsx'
import { createLabViewStore } from '../src/client/store.ts'

function hookOf(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => unknown }) {
  return function useSelector<S>(sel: (s: unknown) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

const ROW: EvalExperimentsResult['rows'][number] = {
  id: 'run-1',
  name: 't31-judge-panel',
  planPath: '/repo/plans/t31-judge-panel.json',
  runId: 'run-1',
  status: 'done',
  statusDetail: null,
  snapshot: { repo: '/repo', datasetId: 'harness-comparison', commit: 'c0ffee1' },
  conditions: ['cond-a', 'cond-b'],
  judges: ['judge-x'],
  items: 1,
  reps: 2,
  factors: ['model.declared'],
  progress: { done: 4, total: 4 },
  startedAt: 1,
  validation: null,
  originSession: 's1',
  archived: false,
  closure: null,
  lastProgressAt: null,
  stalledMinutes: null,
  unit: null,
}

const LIST: EvalExperimentsResult = { repo: '/repo', datasets: ['harness-comparison'], notes: [], rows: [ROW], session: 's1' }

const DETAIL: EvalExperimentDetail = {
  row: ROW, meta: null, readiness: [], buckets: { done: 4 }, states: { released: 4 }, unreleased: [], job: null,
}

/** A report whose invariants all hold: the comparison section is open. */
const REPORT: EvalRunReportView = {
  runId: 'run-1',
  question: null,
  bundleDir: '/repo/exports/run-1-bundle',
  searched: [],
  refusal: null,
  cliHint: 'dsh-eval report /repo/exports/run-1-bundle',
  exportedAt: 1_700_000_000_000,
  lastHumanFinalAt: null,
  staleAfterFinal: false,
  summaryWritten: true,
  reexportable: true,
  invariants: [
    { id: 'materialization', title: '题面一致', status: 'ok', details: ['4 格同一物化哈希'] },
    { id: 'fingerprint', title: '环境同构', status: 'ok', details: [] },
    { id: 'subject', title: '受试可辨', status: 'ok', details: [] },
    { id: 'procedure', title: '流程同形', status: 'ok', details: [] },
  ],
  comparisonAllowed: true,
  singleCondition: false,
  pairs: [{
    a: 'cond-a',
    b: 'cond-b',
    factor: { factor: 'model.declared', multi: null, known: true, detail: 'deepseek-v4 vs gpt-5.6-sol' },
    rows: [{
      task: 'P0',
      aMean: 3, bMean: 2, delta: 1,
      aWeighted: 6, bWeighted: 4, weightedDelta: 2,
      deltas: [1, 1], n: 2,
      judges: [{ condition: 'judge-x', model: 'gpt-5.6-sol', selfJudged: true }],
    }],
    n: 2,
    ci: { mean: 1, lo: 0.5, hi: 1.5, samples: 2000, seed: 7 },
    ciWithheld: null,
    ciAdvisory: false,
    rank: null,
    rankReason: 'n = 2 < 3，不排名',
    verdict: 'withheld',
    coverage: [],
  }],
  criteria: [{
    task: 'P0',
    conditions: ['cond-a', 'cond-b'],
    rows: [
      {
        id: 'C1', axis: '正确性', kind: 'llm-draft', weight: 25, negative: false, undeclared: false,
        cells: [
          {
            condition: 'cond-a', reps: 1, heldReps: 1, credit: 1, holds: true, proportional: false,
            // The cell T54 exists for: a person re-judged this one criterion,
            // and the judge's original verdict is kept beside it.
            sources: { 'human-final': 1 },
            samples: [{
              missionId: 'p0-cond-a-rep1', rep: 1, ns: 'human-final', pass: true, ratio: null,
              evidence: '人复核：三处引用均可核对', by: 'bench', judge: null,
            }],
            superseded: [{
              missionId: 'p0-cond-a-rep1', rep: 1, ns: 'llm-draft', pass: false, ratio: null,
              evidence: '判官原判：第二处引用查不到', by: 'judge-x',
              judge: { condition: 'judge-x', model: 'gpt-5.6-sol', selfJudged: false, sample: 1 },
            }],
          },
          {
            condition: 'cond-b', reps: 1, heldReps: 0, credit: 0, holds: false, proportional: false,
            sources: { 'llm-draft': 1 },
            samples: [{
              missionId: 'p0-cond-b-rep1', rep: 1, ns: 'llm-draft', pass: false, ratio: null,
              evidence: '缺少可核对的引用', by: 'judge-x',
              judge: { condition: 'judge-x', model: 'gpt-5.6-sol', selfJudged: true, sample: 1 },
            }],
            superseded: [],
          },
        ],
      },
      {
        id: 'D1', axis: '代价', kind: 'llm-draft', weight: -16, negative: true, undeclared: false,
        cells: [
          {
            // The mixed cell: a person re-judged rep 1 and left rep 2 on the
            // judge's word, which is the state T54 created and the label has
            // to be able to say — 「人 1 / 判官 1」, counts and all.
            condition: 'cond-a', reps: 2, heldReps: 0, credit: 0, holds: false, proportional: false,
            sources: { 'human-final': 1, 'llm-draft': 1 },
            samples: [
              {
                missionId: 'p0-cond-a-rep1', rep: 1, ns: 'human-final', pass: false, ratio: null,
                evidence: '人复核 rep 1：没有出现这个缺陷', by: 'bench', judge: null,
              },
              {
                missionId: 'p0-cond-a-rep2', rep: 2, ns: 'llm-draft', pass: false, ratio: null,
                evidence: '判官 rep 2：没有出现这个缺陷', by: 'judge-x',
                judge: { condition: 'judge-x', model: 'gpt-5.6-sol', selfJudged: false, sample: 1 },
              },
            ],
            superseded: [],
          },
          {
            condition: 'cond-b', reps: 2, heldReps: 2, credit: 1, holds: true, proportional: false,
            sources: { 'llm-draft': 2 },
            samples: [{
              missionId: 'p0-cond-b-rep1', rep: 1, ns: 'llm-draft', pass: true, ratio: null,
              evidence: '出现 worth-the-cost 措辞', by: 'judge-x',
              judge: { condition: 'judge-x', model: 'gpt-5.6-sol', selfJudged: false, sample: 1 },
            }],
            superseded: [],
          },
        ],
      },
      {
        id: 'S9', axis: null, kind: null, weight: null, negative: false, undeclared: true,
        cells: [
          {
            condition: 'cond-a', reps: 1, heldReps: 1, credit: 0.75, holds: true, proportional: true,
            sources: { script: 1 },
            samples: [{
              missionId: 'p0-cond-a-rep1', rep: 1, ns: 'script', pass: true, ratio: { passed: 3, total: 4 },
              evidence: '4 条探针过 3', by: 'probes/probe.mjs', judge: null,
            }],
            superseded: [],
          },
          {
            condition: 'cond-b', reps: 0, heldReps: 0, credit: null, holds: null, proportional: false,
            sources: {}, samples: [], superseded: [],
          },
        ],
      },
    ],
    totals: [
      { condition: 'cond-a', scored: 3, weighted: 6, reps: 2 },
      { condition: 'cond-b', scored: 2, weighted: 4, reps: 2 },
    ],
  }],
  efficiency: [
    {
      condition: 'cond-a', model: 'deepseek-v4', activeMs: 1_260_000, rounds: 8,
      outputTokens: 12_345, inputTokens: 98_765, cacheReadTokens: 54_321, toolCalls: 42, price: null,
    },
    {
      condition: 'cond-b', model: 'gpt-5.6-sol', activeMs: 900_000, rounds: 6,
      outputTokens: 9_000, inputTokens: 70_000, cacheReadTokens: null, toolCalls: null, price: null,
    },
  ],
  efficiencyExcluded: [{ condition: 'cond-b', state: 'halted', count: 1 }],
  judge: {
    multiSampled: 6,
    llmAgreement: { agreed: 5, total: 6 },
    llmKappa: 0.64,
    humanAgreement: { agreed: 4, total: 6 },
    crossJudged: 3,
    crossAgreement: { agreed: 2, total: 3 },
    crossKappa: 0.33,
    selfJudgedCriteria: 2,
    details: ['同判官两样本一致 5/6'],
  },
  toolOnlyNs: [],
  counts: { rows: 12, missions: 4, attempts: 5, retries: 1 },
  notes: ['判官本身有误差：1–2 条判据的差距不足以下结论'],
  experimentId: null,
  analysis: [],
}

/** The same run with two invariants unestablished — the comparison is closed. */
const BLOCKED: EvalRunReportView = {
  ...REPORT,
  invariants: [
    { id: 'materialization', title: '题面一致', status: 'ok', details: [] },
    { id: 'fingerprint', title: '环境同构', status: 'violated', details: ['两格指纹不同：lab-env:aaaa / lab-env:bbbb'] },
    { id: 'subject', title: '受试可辨', status: 'ok', details: [] },
    { id: 'procedure', title: '流程同形', status: 'unverifiable', details: ['无委派记录'] },
  ],
  comparisonAllowed: false,
  // The host sends no pairs at all when the gate is shut — this is the shape
  // the page must be able to render. The criteria table rides the SAME gate:
  // a closed comparison must not be reopened one criterion at a time.
  pairs: [],
  criteria: [],
  toolOnlyNs: ['human-final'],
}

/** A run whose bundle nobody has written yet. */
const NOT_EXPORTED: EvalRunReportView = {
  ...REPORT,
  bundleDir: null,
  searched: ['/repo/exports'],
  refusal: 'no export bundle for run-1 yet — export it first (looked for run-1-bundle in: /repo/exports)',
  cliHint: null,
  exportedAt: null,
  summaryWritten: false,
  reexportable: false,
  invariants: [],
  comparisonAllowed: false,
  pairs: [],
  criteria: [],
  efficiency: [],
  efficiencyExcluded: [],
  notes: [],
}

const FINALIZED: EvalFinalizeView = {
  runId: 'run-1',
  released: 3,
  refused: 1,
  skipped: 0,
  skippedByState: {},
  cells: [
    {
      missionId: 'p0-cond-a-rep1', state: 'archived', action: 'released', finalState: 'released', reason: null,
      unit: { id: 'u1', resource: 'dsh-lab-u1', released: true, reason: null },
    },
    { missionId: 'p0-cond-b-rep1', state: 'archived', action: 'refused', finalState: 'archived', reason: 'verdicts/ is empty', unit: null },
  ],
  unitsReleased: 3,
  unitsHeld: [{
    id: 'u2',
    resource: 'dsh-lab-u2',
    missionId: 'p0-cond-b-rep1',
    missionState: 'archived',
    reason: 'the archive gate refused its cell, so nothing authorized the destroy',
  }],
  unitsKnown: true,
  log: ['cell p0-cond-a-rep1: archived → releasable → released'],
}

/**
 * The bundle a walkthrough actually had at step 8: exported when the run
 * ended, and older than the final verdict written afterwards (I5·T39 · G17).
 */
const STALE: EvalRunReportView = {
  ...REPORT,
  exportedAt: 1_700_000_000_000,
  lastHumanFinalAt: 1_700_000_900_000,
  staleAfterFinal: true,
}

/** Two containers still up: one whose cell the gate refused, one already past it. */
const UNITS_HELD: EvalRunUnitsView = {
  runId: 'run-1',
  available: true,
  units: [
    { id: 'u2', resource: 'dsh-lab-u2', running: true, missionId: 'p0-cond-b-rep1', missionState: 'archived' },
    { id: 'u3', resource: 'dsh-lab-u3', running: true, missionId: 'p0-cond-c-rep1', missionState: 'released' },
  ],
  refusal: null,
}

/** A composition with no lab: the count is unknown, and must never render as 0. */
const UNITS_UNAVAILABLE: EvalRunUnitsView = {
  runId: 'run-1',
  available: false,
  units: [],
  refusal: 'no lab service: this composition runs no containers, so there is nothing to hold or reclaim',
}

function makeHarness(report: EvalRunReportView = REPORT, units: EvalRunUnitsView = { runId: 'run-1', available: true, units: [], refusal: null }) {
  const instance = createLabViewStore().create()
  return {
    instance,
    actions: instance.actions,
    fetchExperiments: vi.fn(async (): Promise<Result<EvalExperimentsResult>> => ({ ok: true, value: LIST })),
    fetchExperiment: vi.fn(async (): Promise<Result<EvalExperimentDetail>> => ({ ok: true, value: DETAIL })),
    fetchReport: vi.fn(async (): Promise<Result<EvalRunReportView>> => ({ ok: true, value: report })),
    finalizeRun: vi.fn(async (): Promise<Result<EvalFinalizeView>> => ({ ok: true, value: FINALIZED })),
    fetchRunUnits: vi.fn(async (): Promise<Result<EvalRunUnitsView>> => ({ ok: true, value: units })),
    planExport: vi.fn(async () => ({
      ok: true as const,
      value: { bundleDir: '/out/run-1-bundle', guardedLayers: [], expectedNs: ['script'], missions: 4, attempts: 5 },
    })),
    exportRun: vi.fn(async () => ({
      ok: true as const,
      value: {
        bundleDir: '/out/run-1-bundle', files: 9, exportedAt: 1_700_000_000_000,
        summaryPath: '/out/run-1-bundle/report/summary.md', reportRows: 12, reportError: null, noteRecorded: true,
      },
    })),
    reexportRun: vi.fn(async () => ({
      ok: true as const,
      value: {
        bundleDir: '/out/re-20260917T142530Z/run-1-bundle', files: 9, exportedAt: 1_700_000_999_000,
        summaryPath: '/out/re-20260917T142530Z/run-1-bundle/report/summary.md',
        reportRows: 14, reportError: null, noteRecorded: true,
      },
    })),
    // The 运行记录 stage the report's numbers jump INTO (I5·T69). Two reps of
    // (P0 × cond-a) and one of (P0 × cond-b), so the two cases the jump has
    // to tell apart — «one record» and «those records» — are both reachable.
    // The grid at the top of that stage is not what the jump lands on, and a
    // stub of it would be a second matrix fixture to keep in step with the
    // real one. It reports a failure, which the page renders as its own error
    // row — the record list below it is unaffected, which is the point.
    fetchMatrix: vi.fn(async () => ({
      ok: false as const, error: { code: 'unused', message: 'the grid is not under test here' },
    })),
    fetchCells: vi.fn(async () => ({
      ok: true as const,
      value: {
        runId: 'run-1', state: 'active', filter: {}, total: 20, matched: 3,
        buckets: { ready: 0, scheduled: 0, blocked: 0, active: 0, done: 3 },
        rows: [
          cellRow('p0-cond-a-rep1', 'cond-a', 1),
          cellRow('p0-cond-a-rep2', 'cond-a', 2),
          cellRow('p0-cond-b-rep1', 'cond-b', 1),
        ],
      },
    })),
    fetchCell: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'not under test' } })),
    fetchExperimentArtifact: vi.fn(async (_sid: string, request: { experimentId: string; path: string }) => ({
      ok: true as const,
      value: {
        experimentId: request.experimentId, path: request.path, kind: 'text' as const,
        truncated: false, bytes: 12, text: `# body of ${request.path}`, note: null,
      },
    })),
  }
}

/** One record row of the run the report describes. */
function cellRow(missionId: string, condition: string, rep: number) {
  return {
    missionId, task: 'P0', condition, rep, state: 'archived', bucket: 'done', attempt: 1,
    inStateMs: 0, elapsedMs: 0, refs: { resource: null, fingerprint: null }, checkpoints: [],
    annotations: { script: 1 }, childSessionId: null,
  }
}

type Harness = ReturnType<typeof makeHarness>

/**
 * The design stage is where an experiment OPENS (ui-spec §五 v2), so its two
 * reads fire on the way to whatever this file is actually about. Neither is
 * under test here: the stubs exist so the stage that is passed through has
 * something to render.
 */
const DESIGN_STUBS = {
  fetchPlanReview: async () => ({
    ok: true as const,
    value: {
      planPath: '/repo/plans/p.json', schema: 'dataseek.plan/1', ok: true, errors: 0, warnings: 0,
      digest: null, checks: [], conditions: [],
    },
  }),
  fetchConditions: async () => ({
    ok: true as const,
    value: { repo: '/repo', datasets: ['ds'], rows: [], notes: [], session: 's1' },
  }),
  fetchConditionDiff: async () => ({ ok: false as const, error: { code: 'unused', message: 'not under test' } }),
}

function renderView(h: Harness) {
  const props = {
    ...DESIGN_STUBS,
    sessionId: 's1' as SessionId,
    useStore: hookOf(h.instance),
    actions: h.actions,
    fetchExperiments: h.fetchExperiments,
    fetchExperiment: h.fetchExperiment,
    fetchReport: h.fetchReport,
    finalizeRun: h.finalizeRun,
    fetchRunUnits: h.fetchRunUnits,
    planExport: h.planExport,
    exportRun: h.exportRun,
    reexportRun: h.reexportRun,
    fetchMatrix: h.fetchMatrix,
    fetchCells: h.fetchCells,
    fetchCell: h.fetchCell,
    fetchExperimentArtifact: h.fetchExperimentArtifact,
    openSession: vi.fn(),
    t: (key: string, params?: Record<string, unknown>) => (
      params === undefined ? key : `${key} ${JSON.stringify(params)}`
    ),
  } as unknown as LabViewProps
  return render(<LabView {...props} />)
}

/** Open the run, then its report page. */
async function openReport(h: Harness) {
  renderView(h)
  fireEvent.click(await screen.findByText('t31-judge-panel'))
  fireEvent.click(screen.getByRole('button', { name: 'page.compare' }))
  await waitFor(() => { expect(h.fetchReport).toHaveBeenCalledWith('s1', { runId: 'run-1' }) })
}

afterEach(() => { cleanup() })

describe('the four invariants', () => {
  it('renders one row per invariant with its status word and its facts', async () => {
    const h = makeHarness(BLOCKED)
    await openReport(h)
    await screen.findByText('report.invariants')

    expect(screen.getByText('题面一致')).toBeTruthy()
    expect(screen.getByText('受试可辨')).toBeTruthy()
    // The two that did not hold are named twice on purpose: once in the list
    // of four, once beside the closed comparison section that cites them.
    expect(screen.getAllByText('环境同构').length).toBe(2)
    expect(screen.getAllByText('流程同形').length).toBe(2)
    // Three statuses, each said in its own word — never collapsed to pass/fail.
    expect(screen.getAllByText('invariant.ok')).toHaveLength(2)
    expect(screen.getAllByText('invariant.violated')).toHaveLength(2)
    expect(screen.getAllByText('invariant.unverifiable')).toHaveLength(2)
    // …and each row explains, on hover, WHY it affects the comparison —
    // COPY keyed by the invariant's id, so it exists in both languages (a
    // host-composed Chinese detail string could not).
    expect(screen.getByTitle('invariant.why.materialization')).toBeTruthy()
    expect(screen.getByTitle('invariant.why.fingerprint')).toBeTruthy()
    expect(screen.getByTitle('invariant.why.subject')).toBeTruthy()
    expect(screen.getByTitle('invariant.why.procedure')).toBeTruthy()
    // The details are what make a status a finding rather than an opinion.
    expect(screen.getByText('两格指纹不同：lab-env:aaaa / lab-env:bbbb')).toBeTruthy()
    expect(screen.getByText('无委派记录')).toBeTruthy()
  })

  it('all four ok opens the comparison section', async () => {
    const h = makeHarness()
    await openReport(h)
    // The audit's pair table; a card holding ONE pair does not name it again
    // (T80d — the headline and the two scores already say which two).
    expect(await screen.findAllByText('report.pairTitle {"a":"cond-a","b":"cond-b"}')).toHaveLength(1)
    expect(screen.queryByText(/report\.comparisonClosed/)).toBeNull()
  })
})

describe('the conclusion card answers the plan\'s question (T74)', () => {
  const ASKED: EvalRunReportView = {
    ...REPORT,
    question: { question: 'cond-a 比 cond-b 强吗？', expectation: 'cond-a 更强', answeredWhen: '每题跑满 3 次' },
    pairs: [{ ...REPORT.pairs[0]!, rank: 'a', verdict: 'ranked', rankReason: 'n = 3，cond-a 领先' }],
  }

  it('puts the question above the answer, then the yardstick and the expectation beside the actual direction', async () => {
    const h = makeHarness(ASKED)
    await openReport(h)
    const card = await screen.findByRole('region', { name: 'report.conclusion' })
    const direction = 'report.directionAhead {"ahead":"cond-a","behind":"cond-b"}'
    expect(within(card).getByText('cond-a 比 cond-b 强吗？')).toBeTruthy()
    expect(within(card).getByText(direction)).toBeTruthy()
    expect(within(card).getByText('report.answeredWhen {"text":"每题跑满 3 次"}')).toBeTruthy()
    // The mock t() JSON-encodes its params, so the nested sentence arrives escaped.
    expect(within(card).getByText(`report.expectation ${JSON.stringify({ text: 'cond-a 更强', actual: direction })}`)).toBeTruthy()
    // Each group's score, big, and the gap in words — with no 「但」 after it:
    // a ranked pair has no reasons.
    expect(within(card).getByText('3')).toBeTruthy()
    expect(within(card).getByText('2')).toBeTruthy()
    expect(within(card).getByText('report.deltaAhead {"ahead":"cond-a","behind":"cond-b","d":"1"}')).toBeTruthy()
    expect(within(card).queryByText(/report\.reason\./)).toBeNull()
  })

  it('a tied pair answers 「未分高下」 — the report\'s verdict, never re-decided', async () => {
    const h = makeHarness({ ...ASKED, pairs: [{ ...REPORT.pairs[0]!, verdict: 'tied', rank: null }] })
    await openReport(h)
    const card = await screen.findByRole('region', { name: 'report.conclusion' })
    expect(within(card).getByText('report.directionNone {"a":"cond-a","b":"cond-b"}')).toBeTruthy()
  })

  it('a plan without a question still answers — 「暂时不能下结论」 with the reasons as items (T80d ①)', async () => {
    const h = makeHarness()
    await openReport(h)
    const card = await screen.findByRole('region', { name: 'report.conclusion' })
    expect(within(card).getByText('report.answerClosed')).toBeTruthy()
    expect(within(card).queryByText(/report\.answeredWhen|report\.expectation/)).toBeNull()
    expect(within(card).getByText('report.reason.fewReps {"n":2}')).toBeTruthy()
  })

  it('names each reason in plain words, ✗ for a coverage gap, and offers the fix for it first', async () => {
    const onlyScript: EvalRunReportView = {
      ...REPORT,
      pairs: [{
        ...REPORT.pairs[0]!,
        factor: { factor: null, multi: ['model.declared', 'scope'], known: true, detail: '' },
        ciWithheld: { tasksWithDelta: 1 },
        ci: null,
        coverage: [{ condition: 'cond-b', why: 'script-only' }],
      }],
    }
    const h = makeHarness(onlyScript)
    await openReport(h)
    const card = await screen.findByRole('region', { name: 'report.conclusion' })
    const coverage = within(card).getByText(
      'report.reason.coverage {"detail":"report.coverage.script-only {\\"condition\\":\\"cond-b\\"}"}',
    )
    expect(coverage.closest('li')?.getAttribute('data-level')).toBe('block')
    expect(within(card).getByText('report.reason.fewTasks {"k":1}')).toBeTruthy()
    expect(within(card).getByText('report.reason.multi {"fields":"model.declared、scope"}')).toBeTruthy()
    // The side the gap names is not comparable: its number stays, greyed.
    const greyed = [...card.querySelectorAll('[data-na]')].map(node => node.textContent)
    expect(greyed).toHaveLength(1)
    expect(greyed[0]).toContain('cond-b')
    // The report's own sentence stays one hover away.
    expect(within(card).getByTitle('n = 2 < 3，不排名')).toBeTruthy()
    // At most three next steps, the rejudge first.
    const actions = within(card).getAllByRole('button').filter(button => /report\.next\./.test(button.textContent ?? ''))
    expect(actions.map(button => button.textContent)).toEqual([
      'report.next.rejudge {"condition":"cond-b"}', 'report.next.answers', 'report.next.analysis',
    ])
  })
})

describe('⑤ 分析初稿 (T73)', () => {
  const WITH_ANALYSIS: EvalRunReportView = {
    ...REPORT,
    experimentId: 'pilot-d-20260924-ab12',
    analysis: [
      { path: 'analysis/round-2.md', name: 'round-2.md', modifiedAt: 1_700_000_900_000, bytes: 30 },
      { path: 'analysis/round-1.md', name: 'round-1.md', modifiedAt: 1_700_000_100_000, bytes: 20 },
    ],
  }

  it('is absent when the experiment holds no analysis', async () => {
    const h = makeHarness()
    await openReport(h)
    await screen.findByText('report.audit')
    expect(screen.queryByText(/report\.analysis \{/)).toBeNull()
    expect(h.fetchExperimentArtifact).not.toHaveBeenCalled()
  })

  it('is folded by default, lists files by name only, and opens the newest once unfolded', async () => {
    const h = makeHarness(WITH_ANALYSIS)
    await openReport(h)
    const summary = await screen.findByText('report.analysis {"n":2}')
    // Folded: nothing is read until the reader asks for it.
    expect(h.fetchExperimentArtifact).not.toHaveBeenCalled()
    const block = summary.closest('details') as HTMLDetailsElement
    expect(block.open).toBe(false)
    // Names, never paths.
    expect(screen.getByText(/^round-2\.md · /)).toBeTruthy()
    expect(screen.getByText(/^round-1\.md · /)).toBeTruthy()
    expect(screen.queryByText(/analysis\/round/)).toBeNull()

    block.open = true
    fireEvent(block, new Event('toggle'))
    await waitFor(() => {
      expect(h.fetchExperimentArtifact).toHaveBeenCalledWith('s1', {
        experimentId: 'pilot-d-20260924-ab12', path: 'analysis/round-2.md',
      })
    })
    // Rendered as markdown (T74), not printed: the `#` line is a heading.
    expect(await screen.findByRole('heading', { name: 'body of analysis/round-2.md' })).toBeTruthy()
    expect(screen.queryByText('# body of analysis/round-2.md')).toBeNull()
    // Only the newest is expanded — the older one is read when opened.
    expect(h.fetchExperimentArtifact).toHaveBeenCalledTimes(1)
  })
})

describe('the comparison gate', () => {
  it('shows 比较节未开 naming the invariants that did not pass, and no deltas at all', async () => {
    const h = makeHarness(BLOCKED)
    await openReport(h)

    // ui-spec §九: one human sentence for WHY it is closed, and the invariants
    // that closed it beside it as the same chips the list above uses.
    expect(await screen.findByText('report.comparisonClosed {"count":2}')).toBeTruthy()
    // Not one number from the pair table reaches the page: the host sent none.
    expect(screen.queryByText('report.pairTitle {"a":"cond-a","b":"cond-b"}')).toBeNull()
    expect(screen.queryByText('report.col.delta')).toBeNull()
    expect(screen.queryByText(/report\.ci/)).toBeNull()
    // The facts DO stay — a closed comparison is still a report.
    expect(screen.getByText('report.efficiency')).toBeTruthy()
    expect(screen.getByText('report.judge')).toBeTruthy()
  })

  it('carries the red flag when an expectedNs namespace was written only by tools', async () => {
    const h = makeHarness(BLOCKED)
    await openReport(h)
    expect(await screen.findByText('report.toolOnlyNs {"ns":"human-final"}')).toBeTruthy()
  })
})

describe('the pair table', () => {
  it('shows the item, both sides, the delta, n and the judges — with the self-judged mark', async () => {
    const h = makeHarness()
    await openReport(h)
    await screen.findByText('report.col.task')

    expect(screen.getByText('report.factorSingle {"factor":"model.declared","detail":"deepseek-v4 vs gpt-5.6-sol"}')).toBeTruthy()
    // The item names the pair row and the criteria table's own heading; the
    // judge and its 自评 mark ride both the pair row and the evidence lines.
    expect(screen.getAllByText('P0').length).toBeGreaterThan(0)
    expect(screen.getAllByText('judge-x').length).toBeGreaterThan(0)
    // 决策 9: the judge's model is the b side's own, and the row says so.
    expect(screen.getAllByText('report.selfJudged').length).toBeGreaterThan(0)
    // The weighted columns appear because the rubric carried weights.
    expect(screen.getByText('report.col.weightedDelta')).toBeTruthy()
    // A mean keeps three decimals; an integer stays an integer (summary.md's rule).
    expect(screen.getByText('report.ci {"mean":"1","lo":"0.500","hi":"1.500","samples":2000,"seed":7}')).toBeTruthy()
    // The refusal to rank is the report's own sentence, kept whole — on the
    // card's hover, behind the plain-words reasons (T80d).
    expect(screen.getAllByTitle('n = 2 < 3，不排名').length).toBeGreaterThan(0)
  })
})

describe('the 判据 × 对比组 table (T54 补一)', () => {
  it('names the dimension, the polarity and where each cell SCORED from', async () => {
    const h = makeHarness()
    await openReport(h)
    await screen.findByText('report.col.criterion')

    // Rows sit under their dimension (T80d P2-12) instead of a column of it.
    expect(screen.queryByText('report.col.axis')).toBeNull()
    expect(screen.getByText('正确性').tagName).toBe('TH')
    expect(screen.getByText('代价')).toBeTruthy()
    // A group that never judged a criterion says 未判 in words.
    expect(screen.getAllByText('report.notJudgedChip').length).toBeGreaterThan(0)
    // The three shapes of the source label, on one table: one layer prints
    // the WORD alone, and the 自评 / weight columns stay per row.
    expect(screen.getAllByText('source.human')).toHaveLength(1)
    expect(screen.getAllByText('source.llm').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('source.script')).toHaveLength(1)
    // …and a MIXED cell prints the counts, because that is where the count
    // carries information: one criterion of this cell scores on a person's
    // word and the rest still score on the judge's.
    expect(screen.getByText('source.human 1 / source.llm 1')).toBeTruthy()
    // ✓ / ✗ for the boolean criteria, n/N over several reps, a proportion for
    // the proportionally scored one, and a dash where the arm never judged it.
    expect(screen.getByText('75%')).toBeTruthy()
    expect(screen.getByText('✓ 2/2')).toBeTruthy()
    expect(screen.getByText('report.polarityNegative')).toBeTruthy()
    // The bottom row is the report's own per-item score.
    expect(screen.getByText('report.criteriaTotal')).toBeTruthy()
  })

  it('opens a cell onto the verdicts behind it, with the judge and the replaced judgement', async () => {
    const h = makeHarness()
    await openReport(h)
    await screen.findByText('report.col.criterion')

    // Nothing is on screen until a reader asks: the table is the conclusion,
    // the expansion is the grounds.
    expect(screen.queryByText('人复核：三处引用均可核对')).toBeNull()
    fireEvent.click(screen.getByTitle('report.criteriaExpand {"criterion":"C1","condition":"cond-a"}'))

    expect(await screen.findByText('人复核：三处引用均可核对')).toBeTruthy()
    // The person re-judged this criterion, so the cell is marked — and the
    // judge's original verdict is still there, marked as replaced.
    expect(screen.getByText('report.humanOverride')).toBeTruthy()
    expect(screen.getByText('判官原判：第二处引用查不到')).toBeTruthy()
    expect(screen.getByText('report.supersededBy')).toBeTruthy()
    // Un-blinded here and nowhere earlier: the判官 condition and its model.
    expect(screen.getAllByText('judge-x').length).toBeGreaterThan(0)
    // Clicking again closes it.
    fireEvent.click(screen.getByTitle('report.criteriaExpand {"criterion":"C1","condition":"cond-a"}'))
    expect(screen.queryByText('人复核：三处引用均可核对')).toBeNull()
  })

  it('renders no criteria section at all when the comparison gate is shut', async () => {
    const h = makeHarness(BLOCKED)
    await openReport(h)
    await screen.findByText(/report.comparisonClosed/)
    expect(screen.queryByText('report.col.criterion')).toBeNull()
  })
})

describe('the efficiency table', () => {
  it('keeps the columns parallel and prints a dash where nothing was counted', async () => {
    const h = makeHarness()
    await openReport(h)
    await screen.findByText('report.efficiency')

    expect(screen.getByText('report.col.activeMs')).toBeTruthy()
    // ui-spec §九: durations in words, counts compacted. 1_260_000 ms is
    // 21 minutes exactly, and 12_345 output tokens read as 12.3k. Each number
    // is on screen twice — once in the table and once beside its bar, which
    // is what the bars are FOR (the ratio at a glance, the fact beside it).
    expect(screen.getAllByText('dur.ms {"m":21,"s":0}')).toHaveLength(2)
    expect(screen.getAllByText('dur.ms {"m":15,"s":0}')).toHaveLength(2)
    expect(screen.getAllByText('12.3k')).toHaveLength(2)
    // cond-b reported no tool-call accounting and no cacheRead: two dashes,
    // never two zeros — "nobody counted" is not "it used none".
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    // Two models on the table, so the cross-model caveat is in force.
    expect(screen.getByText('report.tokensCrossModel')).toBeTruthy()
    expect(screen.getByText('report.excluded {"total":1,"detail":"cond-b halted × 1"}')).toBeTruthy()
  })

  it('draws the three metrics as bars, each scaled inside its OWN metric', async () => {
    const h = makeHarness()
    await openReport(h)
    await screen.findByText('report.chart.activeMs')

    // The three ui-spec §五 v2 names, and nothing summed across them: they
    // have no common unit, so one shared scale would be a lie with a picture
    // attached.
    expect(screen.getByText('report.chart.activeMs')).toBeTruthy()
    expect(screen.getByText('report.chart.outputTokens')).toBeTruthy()
    expect(screen.getByText('report.chart.cacheRead')).toBeTruthy()
    // cond-a is the longest of the two, so its bar is the full track and
    // cond-b's is the ratio between them (900_000 / 1_260_000 = 71%).
    const bars = document.querySelectorAll<HTMLElement>('[class*="chartBar"]')
    expect(bars[0]?.style.width).toBe('100%')
    expect(bars[1]?.style.width).toBe('71%')
    // cond-b reported no cacheRead, so the cache-read group carries ONE bar
    // rather than a zero-length one: «nobody counted» is not «it used none»,
    // and a bar is the one shape that cannot say the difference.
    expect(screen.getAllByText('54.3k')).toHaveLength(2)
    expect(bars).toHaveLength(5)
  })
})

describe('the judge numbers', () => {
  it('reports the same judge resampled and the panel separately', async () => {
    const h = makeHarness()
    await openReport(h)
    await screen.findByText('report.judge')

    // ui-spec §九: the WORD a reader acts on, κ beside it. κ 0.64 is 中,
    // κ 0.33 is 低 — and a 低 on the resampled judge earns the one piece of
    // advice this page can give.
    expect(screen.getByText('agreement.medium')).toBeTruthy()
    expect(screen.getByText('agreement.low')).toBeTruthy()
    expect(screen.getByText('report.judgeSampleCount {"criteria":6,"agreement":"5/6"}')).toBeTruthy()
    expect(screen.getByText('report.judgeSampleCount {"criteria":3,"agreement":"2/3"}')).toBeTruthy()
    expect(screen.getByText('4/6')).toBeTruthy()
    // The self-judged count, read off its own row (a bare '2' also appears in
    // the pair table).
    expect(screen.getByText('report.judgeSelf').parentElement?.textContent).toBe('report.judgeSelf2')
    expect(screen.getByText('同判官两样本一致 5/6')).toBeTruthy()
  })
})

describe('a run with no bundle', () => {
  it('shows the state and the export button instead of a blank page', async () => {
    const h = makeHarness(NOT_EXPORTED)
    await openReport(h)

    // ui-spec §九: one sentence, one next step. Where it looked and what the
    // host said about not finding it are kept, folded under «详情».
    expect(await screen.findByText('report.noBundle')).toBeTruthy()
    expect(screen.getByText('report.noBundleHint')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'report.exportNow' })).toBeTruthy()
    expect(screen.getByText('report.searched')).toBeTruthy()
    expect(screen.getByText(NOT_EXPORTED.refusal as string)).toBeTruthy()
    expect(screen.getByText('/repo/exports/run-1-bundle')).toBeTruthy()
    // Nothing is claimed about a bundle that does not exist.
    expect(screen.queryByText('report.invariants')).toBeNull()
    // finalize is not offered over a run whose evidence is not exported.
    expect(screen.getByRole('button', { name: 'report.finalize' }).hasAttribute('disabled')).toBe(true)
  })

  it('takes a directory to look in — a run started with --out is exported, just not where the plan says', async () => {
    const h = makeHarness(NOT_EXPORTED)
    await openReport(h)

    fireEvent.change(await screen.findByLabelText('report.lookInDir'), {
      target: { value: '/scratch/t31-panel/exports' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'report.lookInGo' }))

    await waitFor(() => {
      expect(h.fetchReport).toHaveBeenLastCalledWith('s1', { runId: 'run-1', outDir: '/scratch/t31-panel/exports' })
    })
  })

  it('exporting from the page re-reads the report against the directory just written', async () => {
    const h = makeHarness(NOT_EXPORTED)
    await openReport(h)
    fireEvent.click(await screen.findByRole('button', { name: 'report.exportNow' }))

    fireEvent.change(await screen.findByLabelText('export.outDir'), { target: { value: '/out' } })
    fireEvent.click(screen.getByRole('button', { name: 'export.plan' }))
    await waitFor(() => { expect(h.planExport).toHaveBeenCalled() })
    fireEvent.click(screen.getByRole('button', { name: 'export.confirm' }))

    // The dialog's own directory, not the plan's: it is where the bundle
    // landed, and the report would otherwise keep saying 未导出.
    await waitFor(() => {
      expect(h.fetchReport).toHaveBeenLastCalledWith('s1', { runId: 'run-1', outDir: '/out' })
    })
  })
})

describe('finalize', () => {
  it('asks once, then walks the gate and shows what it said cell by cell', async () => {
    const h = makeHarness()
    await openReport(h)

    fireEvent.click(screen.getByRole('button', { name: 'report.finalize' }))
    // A run-wide write off a reading page asks before it walks.
    expect(screen.getByText('report.finalizeConfirmAsk')).toBeTruthy()
    expect(h.finalizeRun).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'report.finalizeConfirm' }))
    await waitFor(() => { expect(h.finalizeRun).toHaveBeenCalledWith('s1', { runId: 'run-1' }) })

    expect(await screen.findByText('report.finalizeCounts {"released":3,"refused":1,"skipped":0,"skips":"—"}')).toBeTruthy()
    // The gate's refusal verbatim, against the cell it refused.
    expect(screen.getByText('p0-cond-b-rep1')).toBeTruthy()
    expect(screen.getByText(/verdicts\/ is empty/)).toBeTruthy()
    expect(screen.getByText(/archived → releasable → released/)).toBeTruthy()
    // The container half of the walk, on screen rather than in `docker ps`.
    expect(screen.getByText('report.finalizeUnits {"released":3,"held":1}')).toBeTruthy()
    expect(screen.getByText(/nothing authorized the destroy/)).toBeTruthy()
  })

  it('cancelling the confirmation walks nothing', async () => {
    const h = makeHarness()
    await openReport(h)
    fireEvent.click(screen.getByRole('button', { name: 'report.finalize' }))
    fireEvent.click(screen.getByRole('button', { name: 'report.finalizeCancel' }))
    expect(h.finalizeRun).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'report.finalize' })).toBeTruthy()
  })
})

/* ─────────── T57 · G18: the containers this run has not let go ─────────── */

describe('unreclaimed units', () => {
  it('counts them at the top and lists each with the cell state that decides what can end it', async () => {
    const h = makeHarness(REPORT, UNITS_HELD)
    await openReport(h)
    await waitFor(() => { expect(h.fetchRunUnits).toHaveBeenCalledWith('s1', { runId: 'run-1' }) })

    expect(await screen.findByText('report.unitsHeld {"count":2}')).toBeTruthy()
    expect(screen.getByText('dsh-lab-u2')).toBeTruthy()
    expect(screen.getByText('dsh-lab-u3')).toBeTruthy()
    // The field the reader acts on: 已归档 is one 回收 can still take,
    // 已释放 is past every gate. Both through the word table (§九).
    expect(screen.getByText('stage.archived')).toBeTruthy()
    expect(screen.getByText('stage.released')).toBeTruthy()
  })

  it('回收 asks once, then walks the SAME gate finalize walks', async () => {
    const h = makeHarness(REPORT, UNITS_HELD)
    await openReport(h)
    await screen.findByText('report.unitsHeld {"count":2}')

    fireEvent.click(screen.getByRole('button', { name: 'report.reclaim' }))
    expect(screen.getByText('report.reclaimConfirmAsk')).toBeTruthy()
    expect(h.finalizeRun).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'report.reclaimConfirm' }))
    // One verb, not two: reclaiming a container IS its cell passing the gate,
    // so there is no second path that could skip the ledger.
    await waitFor(() => { expect(h.finalizeRun).toHaveBeenCalledWith('s1', { runId: 'run-1' }) })
  })

  it('offers no 回收 when nothing is held', async () => {
    const h = makeHarness()
    await openReport(h)
    expect(await screen.findByText('report.unitsNone')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'report.reclaim' })).toBeNull()
  })

  it('says UNKNOWN, not zero, on a composition with no lab', async () => {
    const h = makeHarness(REPORT, UNITS_UNAVAILABLE)
    await openReport(h)
    // A confident 0 here would read as "nothing is up" about an instance that
    // never looked — the reading this strip exists to prevent.
    expect(await screen.findByText('report.unitsUnknown')).toBeTruthy()
    expect(screen.queryByText('report.unitsNone')).toBeNull()
    expect(screen.queryByRole('button', { name: 'report.reclaim' })).toBeNull()
  })
})

describe('how old the bundle is (I5·T39 · G17 / T60)', () => {
  it('says when the bundle was written and that its report is inside it', async () => {
    const h = makeHarness()
    await openReport(h)
    // One line: when it was written, and that the report went in with it.
    const line = await screen.findByText(/report\.exportedAt /)
    expect(line.textContent).toContain('report.summaryIn')
    expect(screen.queryByText(/report\.staleAfterFinal/)).toBeNull()
  })

  it('a bundle older than the last final verdict says so, with the button beside the sentence', async () => {
    const h = makeHarness(STALE)
    await openReport(h)

    // The sentence names the time a reader would otherwise have to find by
    // opening manifest.json themselves, which is how the gap was found.
    const warning = await screen.findByText(/report\.staleAfterFinal /)
    expect(warning.textContent).toContain('"final"')
    const again = screen.getAllByRole('button', { name: 'report.reexport' })
    expect(again.length).toBeGreaterThan(0)

    fireEvent.click(again[again.length - 1] as HTMLElement)
    await waitFor(() => { expect(h.reexportRun).toHaveBeenCalledWith('s1', { runId: 'run-1' }) })
    // The receipt names the NEW directory; the old bundle is not mentioned as
    // gone, because it is not.
    await screen.findByText(/notice\.reexported .*re-20260917T142530Z/)
  })

  it('a bundle written before the export action wrote reports offers to get one', async () => {
    const h = makeHarness({ ...REPORT, summaryWritten: false })
    await openReport(h)
    expect(await screen.findByText('report.summaryMissing')).toBeTruthy()
  })

  it('offers no one-click repeat for a run with no recorded export', async () => {
    const h = makeHarness({ ...REPORT, reexportable: false })
    await openReport(h)
    const again = await screen.findByRole('button', { name: 'report.reexport' })
    expect((again as HTMLButtonElement).disabled).toBe(true)
    expect(again.getAttribute('title')).toBe('report.reexportNeedsDialog')
  })

  it('the export dialog\'s receipt names the report it wrote, not just the bundle', async () => {
    const h = makeHarness(NOT_EXPORTED)
    await openReport(h)
    fireEvent.click(await screen.findByRole('button', { name: 'report.exportNow' }))
    fireEvent.change(await screen.findByLabelText('export.outDir'), { target: { value: '/out' } })
    fireEvent.click(screen.getByRole('button', { name: 'export.plan' }))
    await waitFor(() => { expect(h.planExport).toHaveBeenCalled() })
    fireEvent.click(screen.getByRole('button', { name: 'export.confirm' }))

    await waitFor(() => { expect(h.exportRun).toHaveBeenCalled() })
    // One action, two products (G15): the receipt says so rather than leaving
    // the reader to run `dsh-eval report` and find out.
    expect(await screen.findByText(/export\.doneWithReport .*summary\.md/)).toBeTruthy()
  })
})

/**
 * I5·T69 — a number in the pair table is the door to the records it was
 * computed from. The mean is over the run's reps, so the jump names the
 * (题目 × 对比组) and lets the record list resolve how many that is: one
 * record opens its detail, several leave the list standing under a chip that
 * says so and can be cleared.
 */
describe('from a report number to the records behind it', () => {
  it('a side with several reps lands on the record list, narrowed and labelled', async () => {
    const h = makeHarness()
    await openReport(h)
    // The cell is addressed by what it promises on hover, not by the digit
    // it prints — a mean of 3 is not a unique string on a report page.
    fireEvent.click(await screen.findByTitle(/report\.openRecords.*"condition":"cond-a"/))

    await waitFor(() => { expect(h.fetchCells).toHaveBeenCalledWith('s1', { runId: 'run-1' }) })
    // The chip says what was narrowed and how much is left; without it the
    // list would be lying about how many records the run has.
    expect(await screen.findByText(/runs\.focus.*"task":"P0".*"condition":"cond-a".*"matched":2/)).toBeTruthy()
    expect(screen.getByText('P0 × cond-a × 1')).toBeTruthy()
    expect(screen.getByText('P0 × cond-a × 2')).toBeTruthy()
    expect(screen.queryByText('P0 × cond-b × 1')).toBeNull()
    // Two records match, so none was opened FOR the reader.
    expect(h.fetchCell).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'runs.focusClear' }))
    expect(await screen.findByText('P0 × cond-b × 1')).toBeTruthy()
  })

  it('a side with exactly one rep opens that record — which is what «跳到那条记录» means when there is one', async () => {
    const h = makeHarness()
    await openReport(h)
    // cond-b's column, and the run holds a single rep of it.
    fireEvent.click(await screen.findByTitle(/report\.openRecords.*"condition":"cond-b"/))
    await waitFor(() => {
      expect(h.fetchCell).toHaveBeenCalledWith('s1', { runId: 'run-1', missionId: 'p0-cond-b-rep1' })
    })
  })

  it('a criteria cell takes the SAME road, and names the record when it knows it', async () => {
    const h = makeHarness()
    await openReport(h)
    await screen.findByText('report.col.criterion')
    // A criteria cell carries the missionId of every verdict behind it, so a
    // cell with ONE record behind it can open that record outright — no third
    // mechanism, just the id the pair table never had.
    fireEvent.click(screen.getByTitle('report.criteriaExpand {"criterion":"C1","condition":"cond-a"}'))
    const jump = await screen.findByRole('button', { name: 'report.criteriaOpenRecord' })
    // The hover names the record, because here the page KNOWS which one.
    expect(jump.getAttribute('title')).toBe('report.openRecord {"record":"p0-cond-a-rep1"}')
    fireEvent.click(jump)

    await waitFor(() => {
      expect(h.fetchCell).toHaveBeenCalledWith('s1', { runId: 'run-1', missionId: 'p0-cond-a-rep1' })
    })
    // It lands on 运行记录 narrowed the same way the pair table narrows it.
    expect(await screen.findByText(/runs\.focus.*"task":"P0".*"condition":"cond-a"/)).toBeTruthy()
  })

  it('a criteria cell spanning several records leaves the choice to the reader', async () => {
    const h = makeHarness()
    await openReport(h)
    await screen.findByText('report.col.criterion')
    // D1 on cond-a was judged over two reps — one re-judged by a person, one
    // still the judge's — so there is no single record to open, and picking
    // one would be picking FOR the reader (T69's own rule).
    fireEvent.click(screen.getByTitle('report.criteriaExpand {"criterion":"D1","condition":"cond-a"}'))
    // Addressed by the button's own label: its hover is the pair table's
    // sentence, deliberately — it is the same jump, named the same way.
    fireEvent.click(await screen.findByRole('button', { name: 'report.criteriaOpenRecords' }))

    expect(await screen.findByText(/runs\.focus.*"task":"P0".*"condition":"cond-a".*"matched":2/)).toBeTruthy()
    expect(h.fetchCell).not.toHaveBeenCalled()
  })
})

describe('the conclusion card (T72 §6)', () => {
  const closed = (exit: 'final' | 'flagged' | 'unreviewed' | 'void', reason: string | null = null): EvalRunReportView => ({
    ...REPORT,
    closure: { exit, reason, at: '2026-09-23T08:00:00.000Z', by: null },
  })

  it('leads the page: each pair\'s reason verbatim, its CI line, and the source line nobody closed', async () => {
    const h = makeHarness()
    await openReport(h)
    const card = await screen.findByRole('region', { name: 'report.conclusion' })
    expect(within(card).getAllByTitle('n = 2 < 3，不排名').length).toBeGreaterThan(0)
    expect(within(card).getByText('report.ci {"mean":"1","lo":"0.500","hi":"1.500","samples":2000,"seed":7}')).toBeTruthy()
    expect(within(card).getByText('report.sourceDraft')).toBeTruthy()
    // The card comes before the criteria table and the efficiency section.
    const criteria = screen.getAllByText('report.col.criterion')[0]!
    expect(card.compareDocumentPosition(criteria) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says 人终评 for exits ① and ②, and ② carries its reason at the top', async () => {
    const h = makeHarness(closed('flagged', 'judge-x 与 cond-a 同源'))
    await openReport(h)
    const card = await screen.findByRole('region', { name: 'report.conclusion' })
    expect(within(card).getByText('report.flagged {"reason":"judge-x 与 cond-a 同源"}')).toBeTruthy()
    expect(within(card).getByText('report.sourceFinal')).toBeTruthy()
  })

  it('exit ③ keeps the judge-only source line', async () => {
    const h = makeHarness(closed('unreviewed'))
    await openReport(h)
    const card = await screen.findByRole('region', { name: 'report.conclusion' })
    expect(within(card).getByText('report.sourceDraft')).toBeTruthy()
  })

  it('exit ④ replaces the whole page with the reason and a way to the run records', async () => {
    const h = makeHarness(closed('void', '题面在运行中途被改过'))
    await openReport(h)
    expect(await screen.findByText('report.void {"reason":"题面在运行中途被改过"}')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'report.conclusion' })).toBeNull()
    expect(screen.queryByText('report.col.criterion')).toBeNull()
    expect(screen.queryByText('report.pairTitle {"a":"cond-a","b":"cond-b"}')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'cta.void' }))
    expect(screen.getByRole('button', { name: 'page.runs' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('the card carries no validity line: the audit fold summary says each check (T83 · result)', async () => {
    const h = makeHarness(BLOCKED)
    await openReport(h)
    const card = await screen.findByRole('region', { name: 'report.conclusion' })
    expect(within(card).queryByRole('button', { name: /report\.validity/ })).toBeNull()
    const audit = document.getElementById('eval-report-audit') as HTMLDetailsElement
    expect(audit.open).toBe(false)
    expect(audit.querySelector('summary [data-bad]')).not.toBeNull()
  })
})
