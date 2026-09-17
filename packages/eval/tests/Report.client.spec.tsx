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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  unit: null,
}

const LIST: EvalExperimentsResult = { repo: '/repo', datasets: ['harness-comparison'], notes: [], rows: [ROW] }

const DETAIL: EvalExperimentDetail = {
  row: ROW, meta: null, readiness: [], buckets: { done: 4 }, states: { released: 4 }, unreleased: [], job: null,
}

/** A report whose invariants all hold: the comparison section is open. */
const REPORT: EvalRunReportView = {
  runId: 'run-1',
  bundleDir: '/repo/exports/run-1-bundle',
  searched: [],
  refusal: null,
  cliHint: 'dsh-eval report /repo/exports/run-1-bundle',
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
    rank: null,
    rankReason: 'n = 2 < 3，不排名',
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
  // the page must be able to render.
  pairs: [],
  toolOnlyNs: ['human-final'],
}

/** A run whose bundle nobody has written yet. */
const NOT_EXPORTED: EvalRunReportView = {
  ...REPORT,
  bundleDir: null,
  searched: ['/repo/exports'],
  refusal: 'no export bundle for run-1 yet — export it first (looked for run-1-bundle in: /repo/exports)',
  cliHint: null,
  invariants: [],
  comparisonAllowed: false,
  pairs: [],
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
    exportRun: vi.fn(async () => ({ ok: true as const, value: { bundleDir: '/out/run-1-bundle', files: 9 } })),
  }
}

type Harness = ReturnType<typeof makeHarness>

function renderView(h: Harness) {
  const props = {
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
  fireEvent.click(screen.getByRole('button', { name: 'page.report' }))
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
    // The details are what make a status a finding rather than an opinion.
    expect(screen.getByText('两格指纹不同：lab-env:aaaa / lab-env:bbbb')).toBeTruthy()
    expect(screen.getByText('无委派记录')).toBeTruthy()
  })

  it('all four ok opens the comparison section', async () => {
    const h = makeHarness()
    await openReport(h)
    expect(await screen.findByText('report.pairTitle {"a":"cond-a","b":"cond-b"}')).toBeTruthy()
    expect(screen.queryByText(/report\.comparisonClosed/)).toBeNull()
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
    expect(screen.getByText('P0')).toBeTruthy()
    expect(screen.getByText('judge-x')).toBeTruthy()
    // 决策 9: the judge's model is the b side's own, and the row says so.
    expect(screen.getByText('report.selfJudged')).toBeTruthy()
    // The weighted columns appear because the rubric carried weights.
    expect(screen.getByText('report.col.weightedDelta')).toBeTruthy()
    // A mean keeps three decimals; an integer stays an integer (summary.md's rule).
    expect(screen.getByText('report.ci {"mean":"1","lo":"0.500","hi":"1.500","samples":2000,"seed":7}')).toBeTruthy()
    // The refusal to rank is the report's own sentence, kept whole.
    expect(screen.getByText(/n = 2 < 3，不排名/)).toBeTruthy()
  })
})

describe('the efficiency table', () => {
  it('keeps the columns parallel and prints a dash where nothing was counted', async () => {
    const h = makeHarness()
    await openReport(h)
    await screen.findByText('report.efficiency')

    expect(screen.getByText('report.col.activeMs')).toBeTruthy()
    expect(screen.getByText('21.0 min')).toBeTruthy()
    expect(screen.getByText('15.0 min')).toBeTruthy()
    expect(screen.getByText('12,345')).toBeTruthy()
    // cond-b reported no tool-call accounting and no cacheRead: two dashes,
    // never two zeros — "nobody counted" is not "it used none".
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    // Two models on the table, so the cross-model caveat is in force.
    expect(screen.getByText('report.tokensCrossModel')).toBeTruthy()
    expect(screen.getByText('report.excluded {"total":1,"detail":"cond-b halted × 1"}')).toBeTruthy()
  })
})

describe('the judge numbers', () => {
  it('reports the same judge resampled and the panel separately', async () => {
    const h = makeHarness()
    await openReport(h)
    await screen.findByText('report.judge')

    expect(screen.getByText('report.judgeSameValue {"criteria":6,"agreement":"5/6","kappa":"0.640"}')).toBeTruthy()
    expect(screen.getByText('report.judgeCrossValue {"criteria":3,"agreement":"2/3","kappa":"0.330"}')).toBeTruthy()
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
