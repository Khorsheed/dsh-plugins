// @vitest-environment jsdom
/**
 * LabView spec under the four-share props form: a real store instance
 * (createLabViewStore().create()) and injected Remote mocks. Asserts the
 * experiment table (drafts and runs in one list, the status word, the factor
 * and progress cells), the row click opening the detail shell, the overview
 * page's fields for a run and for a draft, and the four placeholder sub-pages.
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
    approvePlan: vi.fn(async () => ({ ok: false, error: { code: 'X', message: 'not in this spec' } })),
    fetchRunOutput: vi.fn(async () => ({ ok: false, error: { code: 'X', message: 'not in this spec' } })),
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
    approvePlan: h.approvePlan,
    fetchRunOutput: h.fetchRunOutput,
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
    expect(screen.getByText('model.declared')).toBeTruthy()
    expect(screen.getByText('reasoning.effort')).toBeTruthy()
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

  it('新建实验 is a placeholder naming the task that owns it', async () => {
    const h = makeHarness()
    renderView(h)
    await screen.findByText('harness-comparison')
    fireEvent.click(screen.getByRole('button', { name: 'list.new' }))
    expect(screen.getByText('placeholder.new')).toBeTruthy()
  })
})

describe('LabView detail', () => {
  it('clicking a run row opens the seven-tab shell and fetches the overview', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('harness-comparison'))

    await waitFor(() => { expect(h.fetchExperiment).toHaveBeenCalledWith('s1', { runId: 'run-20260913-aa' }) })
    for (const page of ['page.overview', 'page.plan', 'page.conditions', 'page.matrix', 'page.cells', 'page.report', 'page.judging']) {
      expect(screen.getByRole('button', { name: page })).toBeTruthy()
    }
    // The overview is the landing page, and it is the pressed one.
    expect(screen.getByRole('button', { name: 'page.overview' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('the overview shows the snapshot, matrix shape, factors, judge, environment, readiness and run.meta', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('harness-comparison'))

    expect(await screen.findByText('overview.shapeValue {"items":2,"conditions":2,"reps":3,"cells":12}')).toBeTruthy()
    expect(screen.getByText('overview.snapshot')).toBeTruthy()
    expect(screen.getByText('cond-a, cond-b')).toBeTruthy()
    expect(screen.getByText(/judge-a · overview.judgeSamples/)).toBeTruthy()
    expect(screen.getByText(/dataseek\/bench:1/)).toBeTruthy()
    // The readiness block is verbatim: the failing probe's reason shows.
    expect(screen.getByText('the scoped home holds no credential')).toBeTruthy()
    expect(screen.getByText('ready.failed')).toBeTruthy()
    // Histograms and the leak warning.
    expect(screen.getByText('done 10 · active 2')).toBeTruthy()
    expect(screen.getByText('archived 10 · stage-2 2')).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.getByText(/eval-run-3 · completed/)).toBeTruthy()
  })

  it('a draft opens its overview from the row alone — no RPC, and it says why the run fields are missing', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('effort-sweep'))

    expect(await screen.findByText('overview.draftNotice')).toBeTruthy()
    expect(screen.getByText('overview.shapeValue {"items":4,"conditions":2,"reps":1,"cells":8}')).toBeTruthy()
    expect(screen.getByText('overview.environmentHost')).toBeTruthy()
    expect(screen.getByText('overview.validationOk')).toBeTruthy()
    expect(h.fetchExperiment).not.toHaveBeenCalled()
  })

  it('the four unbuilt sub-pages carry the placeholder that names their task', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('harness-comparison'))
    for (const [tab, placeholder] of [
      ['page.matrix', 'placeholder.matrix'],
      ['page.cells', 'placeholder.cells'],
      ['page.report', 'placeholder.report'],
      ['page.judging', 'placeholder.judging'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: tab }))
      expect(screen.getByText(placeholder)).toBeTruthy()
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
    expect(await screen.findByText('detail.error: no mission service')).toBeTruthy()
  })
})
