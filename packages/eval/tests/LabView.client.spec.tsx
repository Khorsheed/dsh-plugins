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
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { EvalExperimentDetail, EvalExperimentsResult } from '../src/types.ts'
import type { LabViewProps } from '../src/client/contract.ts'
import { LabView } from '../src/client/LabView.tsx'
import { createLabViewStore } from '../src/client/store.ts'
import { createLabFocus } from '../src/client/draft-card.ts'

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
  archiveRun: ReturnType<typeof vi.fn>
}

const LIST: EvalExperimentsResult = {
  notes: [],
  session: 's1',
  rows: [
    {
      id: 'run-20260913-aa',
      experimentId: 'harness-comparison-20260911-0a0b',
      legacy: false,
      name: 'harness-comparison',
      planPath: '/state/eval/experiments/harness-comparison-20260911-0a0b/plan.json',
      runId: 'run-20260913-aa',
      status: 'judging',
      statusDetail: null,
      snapshot: { registry: 'reg', datasetId: 'ds', commit: 'c0ffee1234567890' },
      conditions: ['cond-a', 'cond-b'],
      judges: ['judge-a'],
      items: 2,
      reps: 3,
      factors: ['model.declared'],
      progress: { done: 10, total: 12 },
      startedAt: Date.UTC(2026, 8, 11, 3, 0),
      validation: null,
      originSession: 's1',
      archived: false,
      closure: null,
      lastProgressAt: null,
      stalledMinutes: null,
      unit: { image: 'dataseek/bench:1', network: 'sealed', user: '1000' },
    },
    {
      id: 'experiment:effort-sweep-20260912-0c0d',
      experimentId: 'effort-sweep-20260912-0c0d',
      legacy: false,
      name: 'effort-sweep',
      planPath: '/state/eval/experiments/effort-sweep-20260912-0c0d/plan.json',
      runId: null,
      status: 'pending-approval',
      statusDetail: null,
      snapshot: { registry: 'reg', datasetId: 'ds', commit: 'beef0001'.padEnd(40, '0') },
      conditions: ['cond-a', 'cond-c'],
      judges: [],
      items: 4,
      reps: 1,
      factors: ['reasoning.effort'],
      progress: null,
      startedAt: null,
      validation: { ok: true, errors: 0, warnings: 2 },
      originSession: 's1',
      archived: false,
      closure: null,
      lastProgressAt: null,
      stalledMinutes: null,
      unit: null,
    },
  ],
}

const DETAIL: EvalExperimentDetail = {
  row: LIST.rows[0]!,
  meta: {
    planSha: 'd'.repeat(64),
    planPath: '/state/eval/experiments/harness-comparison-20260911-0a0b/plan.json',
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
    archiveRun: vi.fn(async () => ({ ok: true, value: { recorded: true, detail: null, archive: null } })),
  }
}

function renderView(h: Harness, extra: Record<string, unknown> = {}) {
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
    archiveRun: h.archiveRun,
    t: (key: string, params?: Record<string, unknown>) => (
      params === undefined ? key : `${key} ${JSON.stringify(params)}`
    ),
    ...extra,
  } as unknown as LabViewProps
  return render(<LabView {...props} />)
}

afterEach(() => { cleanup(); localStorage.clear() })

describe('LabView list', () => {
  it('renders drafts and runs in one table with status, factors, and progress', async () => {
    const h = makeHarness()
    renderView(h)
    expect(await screen.findByText('harness-comparison')).toBeTruthy()
    expect(screen.getByText('effort-sweep')).toBeTruthy()
    // The status word comes from the dictionary, keyed by the derived status.
    expect(screen.getByText('status.judging')).toBeTruthy()
    expect(screen.getByText('status.pending-approval')).toBeTruthy()
    // The snapshot rides on the card's hover as `<registration>/<set> @ short
    // hash` — never a path (T73); the columns moved to the design stage (T80c).
    const card = (name: string) => screen.getByText(name).closest('[role="button"]') as HTMLElement
    expect(card('harness-comparison').getAttribute('title')).toBe('reg/ds @ c0ffee1')
    expect(card('effort-sweep').getAttribute('title')).toBe('reg/ds @ beef000')
    expect(screen.queryByText(/\/state\//)).toBeNull()
    expect(within(card('harness-comparison')).getByText(/10 \/ 12/)).toBeTruthy()
    expect(h.fetchExperiments).toHaveBeenCalledWith('s1', {})
  })

  it('each card carries ONE button, by what its status asks for (T80c P1-1)', async () => {
    const h = makeHarness()
    renderView(h)
    await screen.findByText('harness-comparison')
    const card = (name: string) => screen.getByText(name).closest('[role="button"]') as HTMLElement
    // 评估中 → 去人工评估, and it lands on that stage, not on 实验设计.
    const judging = within(card('harness-comparison')).getByRole('button', { name: 'list.act.review' })
    // 待批准 → 去批准: a door to the checklist, never an approval from the list.
    expect(within(card('effort-sweep')).getByRole('button', { name: 'list.act.approve' })).toBeTruthy()
    fireEvent.click(judging)
    expect((await screen.findByRole('button', { name: 'page.review' })).getAttribute('aria-pressed')).toBe('true')
    expect(h.approvePlan).not.toHaveBeenCalled()
  })

  it('a card without a question says the experiment\'s size on its second line', async () => {
    const h = makeHarness()
    renderView(h)
    await screen.findByText('harness-comparison')
    expect(screen.getAllByText(/^list\.scale /).length).toBeGreaterThanOrEqual(1)
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
    // On the page its action would open, the bar offers no door to itself
    // (T80c P2-11): the sentence becomes that page's own, and no button.
    expect(screen.queryByRole('button', { name: 'cta.judging' })).toBeNull()
    expect(screen.getByText('cta.here.review')).toBeTruthy()
    // The stage tabs carry where the experiment stands (T80c P2-1).
    expect(screen.getByRole('button', { name: 'page.design' }).getAttribute('data-dot')).toBe('done')
    expect(screen.getByRole('button', { name: 'page.review' }).getAttribute('data-dot')).toBe('active')
    expect(screen.getByRole('button', { name: 'page.compare' }).getAttribute('data-dot')).toBe('todo')

    // `pending-approval` — the action IS the human act, pressed where a
    // reader stands rather than hunted for on a sub-page.
    fireEvent.click(screen.getByRole('button', { name: 'detail.back' }))
    fireEvent.click(await screen.findByText('effort-sweep'))
    // v5 · next: the state and its next step, then the one line of why — for
    // a plan nothing has started, that it can still change (T83 · design).
    expect(await screen.findByText('cta.title {"status":"status.pending-approval","next":"cta.pending"}')).toBeTruthy()
    expect(screen.getByText('cta.editableHint')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'cta.pending' }))
    await waitFor(() => {
      expect(h.approvePlan).toHaveBeenCalledWith('s1', { experimentId: 'effort-sweep-20260912-0c0d' })
    })
  })

  it('the design stage leads with the scale and the readiness badge, and folds the receipts away', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('harness-comparison'))

    // ① scale and variables: four lines, at the top, where the decision starts.
    expect(await screen.findByText('overview.shapeValue {"items":2,"conditions":2,"reps":3,"cells":12}')).toBeTruthy()
    // The dataset snapshot is the 用哪些题 block's meta (T80d), not a field of its own.
    expect(screen.getByText('design.items')).toBeTruthy()
    // The groups are the 对比组 table's rows now (T80d), not a comma list.
    expect(screen.getByText('design.compare')).toBeTruthy()
    expect(screen.getByText((_, el) => el?.tagName === 'DD' && /^judge-a · overview.judgeSamples/.test(el.textContent ?? ''))).toBeTruthy()

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

    // ③ everything a reader needs once: one line on the page, and still
    // verbatim in 查看 (T86).
    expect(screen.queryByText('overview.metaRaw')).toBeNull()
    fireEvent.click(within(screen.getByText('design.advanced').parentElement as HTMLElement).getByRole('button', { name: 'inspect.view' }))
    expect(await screen.findByText(/dataseek\/bench:1/)).toBeTruthy()
    expect(screen.getByText('ready.rawFold')).toBeTruthy()
    expect(screen.getAllByText(/the scoped home holds no credential/).length).toBeGreaterThan(0)
    expect(screen.getByText('overview.metaRaw')).toBeTruthy()
    expect(h.fetchExperiment).toHaveBeenCalled()
  })

  it('a draft opens its design stage from the row alone — no RPC for the run', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('effort-sweep'))

    // The stage bar's sentence IS the «this is a draft» notice v1 printed into
    // the page body, and it comes with the action that changes it.
    expect(await screen.findByText('cta.editableHint')).toBeTruthy()
    expect(screen.getByText('overview.shapeValue {"items":4,"conditions":2,"reps":1,"cells":8}')).toBeTruthy()
    // validate's verdict off the LIST row, before the review walk lands.
    expect(screen.getByText('overview.validationOk')).toBeTruthy()
    // The receipts read by id in 查看 — and a draft has no run to read (T86).
    fireEvent.click(within(screen.getByText('design.advanced').parentElement as HTMLElement).getByRole('button', { name: 'inspect.view' }))
    expect(await screen.findByText('overview.environmentHost')).toBeTruthy()
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

describe('the grouped list (T72 §1)', () => {
  const RUN = LIST.rows[0]!
  const row = (over: Partial<typeof RUN>): typeof RUN => ({ ...RUN, ...over })
  const GROUPED: EvalExperimentsResult = {
    ...LIST,
    rows: [
      LIST.rows[1]!,
      row({ id: 'r-judging', runId: 'r-judging', name: 'judging-mine', status: 'judging' }),
      row({ id: 'r-running', runId: 'r-running', name: 'running-mine', status: 'running' }),
      row({ id: 'r-stalled', runId: 'r-stalled', name: 'stalled-mine', status: 'stalled', stalledMinutes: 42 }),
      row({ id: 'r-done', runId: 'r-done', name: 'done-mine', status: 'done' }),
      row({ id: 'r-void', runId: 'r-void', name: 'void-mine', status: 'void' }),
      row({ id: 'r-arch', runId: 'r-arch', name: 'archived-mine', status: 'done', archived: true }),
      row({ id: 'r-other', runId: 'r-other', name: 'other-session', status: 'running', originSession: 's2' }),
      row({ id: 'r-cli', runId: 'r-cli', name: 'from-cli', status: 'done', originSession: null }),
    ],
  }
  const groupOf = (name: string) => screen.getByText(name).closest('[data-group]')?.getAttribute('data-group')

  it('folds a run no experiment claims into 旧运行（未关联实验）, and only that row (T73, T83)', async () => {
    const h = makeHarness({ list: { ...LIST, rows: [
      ...LIST.rows,
      row({
        id: 'r-legacy', runId: 'r-legacy', name: 'old-plan', status: 'done', experimentId: null, legacy: true,
        snapshot: { registry: null, datasetId: 'ds', commit: '0ld0001'.padEnd(40, '0') },
      }),
    ] } })
    renderView(h)
    await screen.findByText('old-plan')
    expect(groupOf('old-plan')).toBe('legacy')
    // One fold title says it once; the rows carry no repeated mark.
    expect(screen.getByText('list.group.legacyCount {"count":1}')).toBeTruthy()
    expect(screen.queryByText('list.legacy')).toBeNull()
    expect(screen.getByText('old-plan').closest('details')?.open).toBe(false)
    // No registration recorded: the set and the hash, and still no path.
    expect(screen.getByText('old-plan').closest('[role="button"]')?.getAttribute('title')).toBe('ds @ 0ld0001')
  })

  it('归档 N 条旧运行 asks first, says it can be undone, then marks each legacy run (T80c P1-2)', async () => {
    const h = makeHarness({ list: { ...LIST, rows: [
      ...LIST.rows,
      row({ id: 'r-l1', runId: 'r-l1', name: 'old-1', status: 'judging', experimentId: null, legacy: true }),
      row({ id: 'r-l2', runId: 'r-l2', name: 'old-2', status: 'stalled', experimentId: null, legacy: true, stalledMinutes: 90 }),
      // An archived legacy run is already archived, so the button leaves it.
      row({ id: 'r-l3', runId: 'r-l3', name: 'old-3', status: 'done', experimentId: null, legacy: true, archived: true }),
    ] } })
    renderView(h)
    await screen.findByText('old-1')
    fireEvent.click(screen.getByRole('button', { name: 'list.archiveLegacy {"count":2}' }))
    // Nothing is written until the confirmation is answered.
    expect(h.archiveRun).not.toHaveBeenCalled()
    expect(screen.getByText('list.archiveLegacyConfirm {"count":2}')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'list.archiveLegacyGo' }))
    await waitFor(() => { expect(h.archiveRun).toHaveBeenCalledTimes(2) })
    expect(h.archiveRun).toHaveBeenCalledWith('s1', { runId: 'r-l1', archived: true })
    expect(h.archiveRun).toHaveBeenCalledWith('s1', { runId: 'r-l2', archived: true })
    expect(await screen.findByText('list.archivedLegacy {"count":2}')).toBeTruthy()
  })

  it('a stalled legacy run cannot be re-run from the list, so its button is its run records', async () => {
    const h = makeHarness({ list: { ...LIST, rows: [
      row({ id: 'r-l2', runId: 'r-l2', name: 'old-2', status: 'stalled', experimentId: null, legacy: true, stalledMinutes: 90 }),
    ] } })
    renderView(h)
    const card = (await screen.findByText('old-2')).closest('[role="button"]') as HTMLElement
    expect(within(card).queryByRole('button', { name: 'cta.stalled' })).toBeNull()
    expect(within(card).getByRole('button', { name: 'list.act.runs' })).toBeTruthy()
  })

  it('groups by what the row asks of the reader, and the archive is its own fold', async () => {
    const h = makeHarness({ list: GROUPED })
    renderView(h)
    await screen.findByText('judging-mine')
    expect(groupOf('effort-sweep')).toBe('attention')
    expect(groupOf('judging-mine')).toBe('attention')
    expect(groupOf('stalled-mine')).toBe('attention')
    expect(groupOf('running-mine')).toBe('running')
    expect(groupOf('done-mine')).toBe('finished')
    expect(groupOf('void-mine')).toBe('finished')
    expect(groupOf('archived-mine')).toBe('archived')
    // Archiving changes the group, never the status word.
    expect(screen.getByText('list.group.archivedCount {"count":1}')).toBeTruthy()
    expect(screen.getAllByText('status.done').length).toBeGreaterThanOrEqual(2)
  })

  it('shows this session by default, counts the rest, and the count switches to 全部', async () => {
    const h = makeHarness({ list: GROUPED })
    renderView(h)
    await screen.findByText('judging-mine')
    // Another session's run AND a CLI run with no session are counted, not dropped.
    expect(screen.queryByText('other-session')).toBeNull()
    expect(screen.queryByText('from-cli')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'list.others {"count":2}' }))
    expect(screen.getByText('other-session')).toBeTruthy()
    expect(screen.getByText('from-cli')).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'list.scopeAll' }).getAttribute('aria-checked')).toBe('true')
    // Remembered per viewer.
    expect(localStorage.getItem('dsh-eval.listScope')).toBe('all')
  })

  it('a stalled row says how long, and 重跑 approves its plan again without opening it', async () => {
    const h = makeHarness({ list: GROUPED })
    h.approvePlan.mockResolvedValue({
      ok: true,
      value: { started: true, checks: [], refusal: null, jobId: 'j', runId: 'r-new', parentSessionId: 's1' },
    })
    renderView(h)
    await screen.findByText('stalled-mine')
    // The reason sits in the progress slot (T80c P2-14), not a line of its own.
    expect(screen.getByText(/list\.stalledMeta \{"duration":"dur\.ms \{\\"m\\":42,\\"s\\":0\}"\}/)).toBeTruthy()
    const rerun = screen.getAllByRole('button', { name: 'cta.stalled' })
    expect(rerun).toHaveLength(1)
    fireEvent.click(rerun[0]!)
    await waitFor(() => {
      expect(h.approvePlan).toHaveBeenCalledWith('s1', { experimentId: RUN.experimentId })
    })
    expect(await screen.findByText('notice.rerun {"name":"stalled-mine","runId":"r-new"}')).toBeTruthy()
    // Still on the list: the row's button is not a click on the row.
    expect(h.fetchExperiment).not.toHaveBeenCalled()
  })

  it('归档 / 取消归档 write the mark and re-read the list', async () => {
    const h = makeHarness({ list: GROUPED })
    renderView(h)
    await screen.findByText('done-mine')
    const calls = h.fetchExperiments.mock.calls.length
    // 归档 is in the card's overflow menu (T80c P1-1), not beside the step.
    const doneRow = screen.getByText('done-mine').closest('[role="button"]') as HTMLElement
    expect(within(doneRow).queryByRole('button', { name: 'list.archive' })).toBeNull()
    fireEvent.click(within(doneRow).getByRole('button', { name: 'list.more' }))
    fireEvent.click(within(doneRow).getByRole('menuitem', { name: 'list.archive' }))
    await waitFor(() => {
      expect(h.archiveRun).toHaveBeenCalledWith('s1', { runId: 'r-done', archived: true })
    })
    await waitFor(() => { expect(h.fetchExperiments.mock.calls.length).toBeGreaterThan(calls) })
    const archivedRow = screen.getByText('archived-mine').closest('[role="button"]') as HTMLElement
    fireEvent.click(within(archivedRow).getByRole('button', { name: 'list.more' }))
    fireEvent.click(within(archivedRow).getByRole('menuitem', { name: 'list.unarchive' }))
    await waitFor(() => {
      expect(h.archiveRun).toHaveBeenCalledWith('s1', { runId: 'r-arch', archived: false })
    })
    // A draft has no run to mark.
    const draftRow = screen.getByText('effort-sweep').closest('[role="button"]') as HTMLElement
    expect(within(draftRow).queryByRole('button', { name: 'list.more' })).toBeNull()
  })

  // T76: the tool-row card's 打开实验 lands here — the host has no tab switch,
  // so the lab view takes the request and marks the row.
  const MARKABLE: EvalExperimentsResult = {
    ...GROUPED,
    rows: GROUPED.rows.map(entry => (entry.id === 'r-other' ? { ...entry, experimentId: 'other-exp-20260901-abcd' } : entry)),
  }
  const markedName = (): string | null => document.querySelector('[data-marked="true"]')?.textContent ?? null

  it('打开实验 taken on mount marks the row, switching to 全部 when the row is another session\'s (T76)', async () => {
    const h = makeHarness({ list: MARKABLE })
    const focus = createLabFocus()
    focus.request('s1' as SessionId, 'other-exp-20260901-abcd')
    renderView(h, { focus })
    await screen.findByText('other-session')
    expect(markedName()).toContain('other-session')
    expect(screen.getByRole('radio', { name: 'list.scopeAll' }).getAttribute('aria-checked')).toBe('true')
    // The switch is the mark's, not the viewer's preference: nothing remembered.
    expect(localStorage.getItem('dsh-eval.listScope')).toBeNull()
    // Taken once: a second view of the same session starts unmarked.
    expect(focus.take('s1' as SessionId)).toBeNull()
  })

  it('a request while the view is open leaves the open experiment for the list, re-reads it and marks the row', async () => {
    const h = makeHarness({ list: MARKABLE })
    const focus = createLabFocus()
    renderView(h, { focus })
    fireEvent.click(await screen.findByText('judging-mine'))
    expect(screen.queryByText('stalled-mine')).toBeNull()
    const reads = h.fetchExperiments.mock.calls.length
    act(() => { focus.request('s1' as SessionId, 'effort-sweep-20260912-0c0d') })
    await screen.findByText('stalled-mine')
    await waitFor(() => { expect(h.fetchExperiments.mock.calls.length).toBeGreaterThan(reads) })
    expect(markedName()).toContain('effort-sweep')
    // Opening any row clears the mark.
    fireEvent.click(screen.getByText('effort-sweep'))
    fireEvent.click(screen.getByRole('button', { name: 'detail.back' }))
    await screen.findByText('stalled-mine')
    expect(markedName()).toBeNull()
  })

  it('a request for another session is not taken here', async () => {
    const h = makeHarness({ list: MARKABLE })
    const focus = createLabFocus()
    focus.request('s9' as SessionId, 'effort-sweep-20260912-0c0d')
    renderView(h, { focus })
    await screen.findByText('judging-mine')
    expect(markedName()).toBeNull()
    expect(focus.take('s9' as SessionId)).toBe('effort-sweep-20260912-0c0d')
  })

  it('an empty session view says what to do next', async () => {
    const h = makeHarness({ list: { ...GROUPED, rows: [GROUPED.rows[7]!] } })
    renderView(h)
    expect(await screen.findByText('list.scopeEmpty')).toBeTruthy()
    expect(screen.getByText('list.scopeEmptyHint')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'list.others {"count":1}' })).toBeTruthy()
  })
})
