// @vitest-environment jsdom
/**
 * LabView spec under the four-share props form: a real store instance
 * (createLabViewStore().create()) and injected Remote mocks. Asserts the
 * experiment table (drafts and runs in one list, the status word, the factor
 * and progress cells), the row click opening the detail shell, the overview
 * page's fields for a run and for a draft, and the draft's refusal to open
 * the sub-pages that need a run.
 *
 * The plan-review and conditions pages have their own spec
 * (`LabReview.client.spec.tsx`); the shared harness lives there too, so the
 * two files build the same props by the same rule.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { EvalExperimentDetail, EvalExperimentsResult } from '../src/types.ts'
import type { LabViewProps } from '../src/client/contract.ts'
import { LabView } from '../src/client/LabView.tsx'
import { createLabViewStore } from '../src/client/store.ts'

/** Selector hook over the store engine instance (the test-sanctioned engine path). */
function hookOf(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => unknown }) {
  return function useSelector<S>(sel: (s: unknown) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

type Store = ReturnType<typeof createLabViewStore>
type Instance = ReturnType<Store['create']>

interface Harness {
  instance: Instance
  actions: Instance['actions']
  fetchExperiments: ReturnType<typeof vi.fn>
  fetchExperiment: ReturnType<typeof vi.fn>
  fetchPlanReview: ReturnType<typeof vi.fn>
  fetchConditions: ReturnType<typeof vi.fn>
  fetchConditionDiff: ReturnType<typeof vi.fn>
  approvePlan: ReturnType<typeof vi.fn>
  fetchRunOutput: ReturnType<typeof vi.fn>
  fetchDraftOptions: ReturnType<typeof vi.fn>
  draftExperiment: ReturnType<typeof vi.fn>
  fetchJudgeQueue: ReturnType<typeof vi.fn>
}

const LIST: EvalExperimentsResult = {
  repo: '/repo',
  datasets: ['ds'],
  notes: [],
  rows: [
    {
      id: 'run-20260913-aa',
      name: 'harness-comparison',
      planPath: '/repo/datasets/ds/plans/harness-comparison.json',
      runId: 'run-20260913-aa',
      status: 'judging',
      statusDetail: null,
      snapshot: { repo: '/repo', datasetId: 'ds', commit: 'c0ffee1234567890' },
      conditions: ['cond-a', 'cond-b'],
      judges: ['judge-a'],
      items: 2,
      reps: 3,
      factors: ['model.declared'],
      progress: { done: 10, total: 12 },
      startedAt: Date.UTC(2026, 8, 11, 3, 0),
      validation: null,
      unit: { image: 'dataseek/bench:1', network: 'sealed', user: '1000' },
    },
    {
      id: 'plan:/repo/datasets/ds/plans/effort-sweep.json',
      name: 'effort-sweep',
      planPath: '/repo/datasets/ds/plans/effort-sweep.json',
      runId: null,
      status: 'pending-approval',
      statusDetail: null,
      snapshot: { repo: '/repo', datasetId: 'ds', commit: null },
      conditions: ['cond-a', 'cond-c'],
      judges: [],
      items: 4,
      reps: 1,
      factors: ['reasoning.effort'],
      progress: null,
      startedAt: null,
      validation: { ok: true, errors: 0, warnings: 2 },
      unit: null,
    },
  ],
}

const DETAIL: EvalExperimentDetail = {
  row: LIST.rows[0]!,
  meta: {
    planSha: 'd'.repeat(64),
    planPath: '/repo/datasets/ds/plans/harness-comparison.json',
    evalVersion: '0.1.0-rc.1+abc1234',
    datasetId: 'ds',
    commit: 'c0ffee1234567890',
    conditions: [
      { id: 'cond-a', sha: 'a'.repeat(64), harness: 'codex', model: 'gpt-5.6-sol' },
      { id: 'cond-b', sha: 'b'.repeat(64), harness: 'codex', model: 'gpt-5.6-thinking' },
    ],
    judge: { conditions: [{ id: 'judge-a', sha: 'c'.repeat(64) }], samples: 2 },
    order: { seed: 7, sequence: ['1', '2'] },
    concurrency: 1,
    budget: { activeMinutes: 30, turns: 40 },
    expectedNs: ['script', 'llm-draft'],
    startedAt: Date.UTC(2026, 8, 11, 3, 0),
    warnings: [],
  },
  readiness: [{
    condition: 'cond-b',
    role: 'player',
    harness: 'codex',
    provider: 'codex',
    ok: false,
    startedAt: 1,
    durationMs: 30_000,
    childSessionId: null,
    declaredModel: 'gpt-5.6-thinking',
    requestedModel: 'gpt-5.6-thinking',
    observedModel: null,
    scope: 'eval-b',
    reason: 'the scoped home holds no credential',
    infrastructure: null,
    unit: null,
  }],
  buckets: { done: 10, active: 2 },
  states: { archived: 10, 'stage-2': 2 },
  unreleased: ['7'],
  job: { jobId: 'eval-run-3', status: 'completed', detail: 'archived 12 cell(s)', startedAt: 1, finishedAt: 2, lines: 480 },
}

function makeHarness(overrides: { list?: EvalExperimentsResult } = {}): Harness {
  const instance = createLabViewStore().create()
  return {
    instance,
    actions: instance.actions,
    fetchExperiments: vi.fn(async (): Promise<Result<EvalExperimentsResult>> => ({ ok: true, value: overrides.list ?? LIST })),
    fetchExperiment: vi.fn(async (): Promise<Result<EvalExperimentDetail>> => ({ ok: true, value: DETAIL })),
    // The three T36 pages are exercised in LabReview.client.spec.tsx; here
    // they only have to exist, because the tab strip walks past them.
    fetchPlanReview: vi.fn(async () => ({ ok: false, error: { code: 'X', message: 'not in this spec' } })),
    fetchConditions: vi.fn(async () => ({ ok: false, error: { code: 'X', message: 'not in this spec' } })),
    fetchConditionDiff: vi.fn(async () => ({ ok: false, error: { code: 'X', message: 'not in this spec' } })),
    // The 新建实验 form has its own spec (NewExperiment.client.spec.tsx);
    // here the two verbs only have to exist, because the dialog mounts with
    // the view and reads them when it is opened.
    fetchDraftOptions: vi.fn(async () => ({ ok: false, error: { code: 'X', message: 'not in this spec' } })),
    draftExperiment: vi.fn(async () => ({ ok: false, error: { code: 'X', message: 'not in this spec' } })),
    approvePlan: vi.fn(async () => ({ ok: false, error: { code: 'X', message: 'not in this spec' } })),
    fetchRunOutput: vi.fn(async () => ({ ok: false, error: { code: 'X', message: 'not in this spec' } })),
    // The stage bar walks a reader to the stage their status asks for, so the
    // reads of the stages it lands on have to exist here too.
    fetchJudgeQueue: vi.fn(async () => ({ ok: false, error: { code: 'X', message: 'not in this spec' } })),
  }
}

function renderView(h: Harness) {
  const props = {
    sessionId: 's1' as SessionId,
    useSession: undefined,
    useInput: undefined,
    inputActions: undefined,
    useProjection: undefined,
    useSessions: undefined,
    useWorkspaces: undefined,
    useStore: hookOf(h.instance),
    actions: h.actions,
    fetchExperiments: h.fetchExperiments,
    fetchExperiment: h.fetchExperiment,
    fetchPlanReview: h.fetchPlanReview,
    fetchConditions: h.fetchConditions,
    fetchConditionDiff: h.fetchConditionDiff,
    fetchDraftOptions: h.fetchDraftOptions,
    draftExperiment: h.draftExperiment,
    approvePlan: h.approvePlan,
    fetchRunOutput: h.fetchRunOutput,
    fetchJudgeQueue: h.fetchJudgeQueue,
    t: (key: string, params?: Record<string, unknown>) => (
      params === undefined ? key : `${key} ${JSON.stringify(params)}`
    ),
  } as unknown as LabViewProps
  return render(<LabView {...props} />)
}

afterEach(() => { cleanup() })

describe('LabView list', () => {
  it('renders drafts and runs in one table with status, factors, and progress', async () => {
    const h = makeHarness()
    renderView(h)
    expect(await screen.findByText('harness-comparison')).toBeTruthy()
    expect(screen.getByText('effort-sweep')).toBeTruthy()
    // The status word comes from the dictionary, keyed by the derived status.
    expect(screen.getByText('status.judging')).toBeTruthy()
    expect(screen.getByText('status.pending-approval')).toBeTruthy()
    // The snapshot cell abbreviates the commit; a draft with none prints the set alone.
    expect(screen.getByText('ds @ c0ffee1')).toBeTruthy()
    expect(screen.getByText('ds')).toBeTruthy()
    // ui-spec §九: the factor column carries the field's WORD, never the
    // dotted path — the path stays on the cell's title.
    expect(screen.getByText('factor.model.declared')).toBeTruthy()
    expect(screen.getByText('factor.reasoning.effort')).toBeTruthy()
    expect(screen.getByText('10/12')).toBeTruthy()
    // A draft has nothing expanded, so no progress and no start time.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    expect(h.fetchExperiments).toHaveBeenCalledWith('s1', {})
  })

  it('the condition column counts judges separately', async () => {
    const h = makeHarness()
    renderView(h)
    await screen.findByText('harness-comparison')
    expect(screen.getByText('conditions.withJudges {"count":2,"judges":1}')).toBeTruthy()
    expect(screen.getByText('conditions.count {"count":2}')).toBeTruthy()
  })

  it('renders each degraded-source note the host sent', async () => {
    const h = makeHarness({ list: { ...LIST, rows: [], notes: ['no mission service: only drafts are listed'] } })
    renderView(h)
    expect(await screen.findByText('no mission service: only drafts are listed')).toBeTruthy()
    expect(screen.getByText('list.empty')).toBeTruthy()
  })

  it('新建实验 opens the draft form and reads what the repository holds', async () => {
    const h = makeHarness()
    renderView(h)
    await screen.findByText('harness-comparison')
    fireEvent.click(screen.getByRole('button', { name: 'list.new' }))

    // The form's own behaviour is NewExperiment.client.spec.tsx's; what this
    // spec pins is that the list's one action opens it and that the two reads
    // are paid for THEN — walking a repository's item tree is not a read to
    // spend on a person who is only looking at their experiments.
    expect(await screen.findByText('new.title')).toBeTruthy()
    await waitFor(() => { expect(h.fetchDraftOptions).toHaveBeenCalledWith('s1', {}) })
  })

  it('does not read the draft options until the form is opened', async () => {
    const h = makeHarness()
    renderView(h)
    await screen.findByText('harness-comparison')
    expect(h.fetchDraftOptions).not.toHaveBeenCalled()
  })
})

describe('LabView detail', () => {
  it('clicking a run row opens the four-stage shell and fetches the detail', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('harness-comparison'))

    await waitFor(() => { expect(h.fetchExperiment).toHaveBeenCalledWith('s1', { runId: 'run-20260913-aa' }) })
    // Four stages, not seven sub-pages (ui-spec §五 v2).
    for (const page of ['page.design', 'page.runs', 'page.compare', 'page.review']) {
      expect(screen.getByRole('button', { name: page })).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: 'page.design' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('the stage bar says what is true and offers the ONE action that status asks for', async () => {
    const h = makeHarness()
    renderView(h)
    // `judging` — every cell has run, and the final verdict is a person's.
    fireEvent.click(await screen.findByText('harness-comparison'))
    expect(await screen.findByText('cta.judgingHint')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'cta.judging' }))
    expect(screen.getByRole('button', { name: 'page.review' }).getAttribute('aria-pressed')).toBe('true')

    // `pending-approval` — the action IS the human act, pressed where a
    // reader stands rather than hunted for on a sub-page.
    fireEvent.click(screen.getByRole('button', { name: 'detail.back' }))
    fireEvent.click(await screen.findByText('effort-sweep'))
    expect(await screen.findByText('cta.pendingHint')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'cta.pending' }))
    await waitFor(() => {
      expect(h.approvePlan).toHaveBeenCalledWith('s1', { planPath: '/repo/datasets/ds/plans/effort-sweep.json' })
    })
  })

  it('the design stage leads with the scale and the readiness badge, and folds the receipts away', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('harness-comparison'))

    // ① scale and variables: four lines, at the top, where the decision starts.
    expect(await screen.findByText('overview.shapeValue {"items":2,"conditions":2,"reps":3,"cells":12}')).toBeTruthy()
    expect(screen.getByText('overview.snapshot')).toBeTruthy()
    expect(screen.getByText('cond-a, cond-b')).toBeTruthy()
    expect(screen.getByText(/judge-a · overview.judgeSamples/)).toBeTruthy()

    // ② the readiness BADGE, not six paragraphs of probe output: one chip per
    // group that failed, with the count and the way to re-read it.
    //
    // THREE of three, not one of one: the badge counts the subjects the PLAN
    // names (two players and a judge), and the readiness records only cover
    // what the run actually probed — cond-b. A group nothing probed used to
    // be absent from the count rather than a cross in it, so an experiment
    // whose players were never resolved could read 「✓ 环境就绪」
    // (I5·T67 · W12).
    expect(screen.getByText('ready.failedCount {"count":3,"total":3}')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ready.recheck' })).toBeTruthy()

    // ③ everything a reader needs once: folded, and still verbatim inside.
    expect(screen.getByText('design.advanced')).toBeTruthy()
    expect(screen.getByText(/dataseek\/bench:1/)).toBeTruthy()
    expect(screen.getByText('ready.rawFold')).toBeTruthy()
    expect(screen.getAllByText(/the scoped home holds no credential/).length).toBeGreaterThan(0)
    expect(screen.getByText('overview.metaRaw')).toBeTruthy()
  })

  it('a draft opens its design stage from the row alone — no RPC for the run', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('effort-sweep'))

    // The stage bar's sentence IS the «this is a draft» notice v1 printed into
    // the page body, and it comes with the action that changes it.
    expect(await screen.findByText('cta.pendingHint')).toBeTruthy()
    expect(screen.getByText('overview.shapeValue {"items":4,"conditions":2,"reps":1,"cells":8}')).toBeTruthy()
    expect(screen.getByText('overview.environmentHost')).toBeTruthy()
    // validate's verdict off the LIST row, before the review walk lands.
    expect(screen.getByText('overview.validationOk')).toBeTruthy()
    expect(h.fetchExperiment).not.toHaveBeenCalled()
  })

  // Each stage has its own spec — design in LabReview, the grid and the run
  // records in MatrixCells, the results in Report, the bench in Judging. What
  // this one still pins is that a DRAFT cannot open the three stages that need
  // a run: there is nothing to read, and a spinner over nothing would be the
  // lie the placeholders used to prevent.
  it('a draft says so on every stage that needs a run', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('effort-sweep'))
    for (const page of ['runs', 'compare', 'review']) {
      fireEvent.click(screen.getByRole('button', { name: `page.${page}` }))
      // The empty seat says what is missing AND what produces it (§九).
      expect(screen.getAllByText('draft.notStarted').length).toBeGreaterThan(0)
      expect(screen.getAllByText('draft.notStartedHint').length).toBeGreaterThan(0)
    }
  })

  it('回到列表 returns to the table', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('harness-comparison'))
    fireEvent.click(screen.getByRole('button', { name: 'detail.back' }))
    expect(screen.getByText('list.title')).toBeTruthy()
    expect(screen.getByText('effort-sweep')).toBeTruthy()
  })

  it('a detail the host refuses shows the error instead of an empty overview', async () => {
    const h = makeHarness()
    h.fetchExperiment.mockResolvedValue({ ok: false, error: { code: 'REFUSED', message: 'no mission service' } })
    renderView(h)
    fireEvent.click(await screen.findByText('harness-comparison'))
    expect(await screen.findByText('error.serviceMissing')).toBeTruthy()
    expect(screen.getByText('error.serviceMissing.fix')).toBeTruthy()
    expect(screen.getByText('detail.error')).toBeTruthy()
    expect(screen.getByText('no mission service')).toBeTruthy()
  })
})
