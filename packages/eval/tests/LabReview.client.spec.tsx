// @vitest-environment jsdom
/**
 * The two sub-pages T36 builds, rendered through LabView so the store routing
 * and the fetch effects are exercised exactly as production wires them.
 *
 * Plan review: the kv block, validate line by line, and the two human buttons
 * — 批准并启动 reaching the approve verb with the plan path, its refusal shown
 * verbatim, and 退回修改 changing nothing but the page. Conditions: the table
 * with scope / preset / lock / readiness, and the two-condition diff reporting
 * ONLY the differing fields.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  EvalApproveResult, EvalConditionDiffView, EvalConditionEndpointView, EvalConditionProvisionView,
  EvalConditionRow, EvalConditionsView, EvalExperimentsResult,
  EvalPlanReview, EvalRunOutputView,
} from '../src/types.ts'
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

const PLAN_PATH = '/repo/datasets/ds/plans/effort-sweep.json'

const LIST: EvalExperimentsResult = {
  repo: '/repo',
  datasets: ['ds'],
  notes: [],
  rows: [{
    id: `plan:${PLAN_PATH}`,
    name: 'effort-sweep',
    planPath: PLAN_PATH,
    runId: null,
    status: 'pending-approval',
    statusDetail: null,
    snapshot: { repo: '/repo', datasetId: 'ds', commit: null },
    conditions: ['dsh-exec', 'codex-exec'],
    judges: ['judge-a'],
    items: 4,
    reps: 2,
    factors: ['harness.name', 'model.declared'],
    progress: null,
    startedAt: null,
    validation: { ok: true, errors: 0, warnings: 1 },
    unit: null,
  }],
}

const REVIEW: EvalPlanReview = {
  planPath: PLAN_PATH,
  schema: 'dataseek.plan/1',
  ok: true,
  errors: 0,
  warnings: 1,
  digest: {
    dataset: { repo: '/repo', id: 'ds', commit: null },
    items: ['p0-001', 'p0-002', 'f2-001', 'f3-001'],
    conditions: ['dsh-exec', 'codex-exec'],
    judge: { conditions: ['judge-a'], samples: 2 },
    reps: 2,
    stages: ['stage-1', 'stage-2'],
    order: { seed: 7, interleave: true },
    budget: { activeMinutes: 30, turns: 40 },
    expectedNs: ['script', 'llm-draft'],
    retryInfrastructure: 1,
    exports: null,
    unit: null,
    notes: 'first effort sweep',
  },
  checks: [
    { severity: 'warn', code: 'COMMIT_UNRESOLVED', message: 'dataset.commit is null — the snapshot pins it at run start' },
    { severity: 'ok', code: 'CONDITION_READY', message: 'condition dsh-exec is ready — the lock matches its declaration' },
    { severity: 'ok', code: 'CONDITION_READY', message: 'condition codex-exec is ready — the lock matches its declaration' },
  ],
  conditions: [
    { id: 'dsh-exec', role: 'player', sha: 'a'.repeat(64), status: 'ready', lock: { present: true, matches: true, homeSha: 'h'.repeat(64) } },
    { id: 'codex-exec', role: 'player', sha: 'b'.repeat(64), status: 'unready', lock: { present: false, matches: false, homeSha: null } },
    { id: 'judge-a', role: 'judge', sha: 'c'.repeat(64), status: 'ready', lock: { present: true, matches: true, homeSha: null } },
  ],
}

const CONDITIONS: EvalConditionsView = {
  repo: '/repo',
  datasets: ['ds'],
  rows: [
    {
      id: 'dsh-exec',
      dataset: 'ds',
      harness: 'dsh',
      drive: 'exec',
      model: 'deepseek-v4',
      endpoint: 'default',
      scope: null,
      preset: 'bench',
      sha: 'a'.repeat(64),
      lock: { present: true, matches: true, homeSha: 'h'.repeat(64), provisionedAt: 1_760_000_000_000, cliVersion: '0.1.5' },
      status: 'ready',
      unresolved: [],
      errors: [],
      warnings: [],
    },
    {
      id: 'codex-exec',
      dataset: 'ds',
      harness: 'codex',
      drive: 'exec',
      model: 'gpt-5.6-sol',
      endpoint: null,
      scope: 'eval-b',
      preset: null,
      sha: 'b'.repeat(64),
      lock: { present: false, matches: false, homeSha: null, provisionedAt: null, cliVersion: null },
      status: 'unready',
      unresolved: ['home.sha'],
      errors: [],
      warnings: ['no lock beside the declaration'],
    },
    {
      id: 'kimi-exec',
      dataset: 'ds',
      harness: 'kimi',
      drive: 'exec',
      model: 'kimi-k3',
      endpoint: 'default',
      scope: null,
      preset: null,
      sha: 'd'.repeat(64),
      lock: { present: true, matches: false, homeSha: null, provisionedAt: null, cliVersion: null },
      status: 'unready',
      unresolved: [],
      errors: [],
      warnings: [],
    },
  ],
}

const DIFF: EvalConditionDiffView = {
  a: { id: 'dsh-exec', path: '/repo/datasets/ds/conditions/dsh-exec.json', sha: 'a'.repeat(64) },
  b: { id: 'codex-exec', path: '/repo/datasets/ds/conditions/codex-exec.json', sha: 'b'.repeat(64) },
  identical: false,
  notesOnly: false,
  differences: [
    { path: 'harness.name', a: '"dsh"', b: '"codex"' },
    { path: 'model.declared', a: '"deepseek-v4"', b: '"gpt-5.6-sol"' },
    { path: 'scope', a: null, b: '"eval-b"' },
  ],
}

/** `codex-exec` after one provision: the lock written, the condition ready. */
const CODEX_READY: EvalConditionRow = {
  ...(CONDITIONS.rows[1] as EvalConditionRow),
  lock: { present: true, matches: true, homeSha: 'c'.repeat(64), provisionedAt: 1_760_000_100_000, cliVersion: '0.1.5' },
  status: 'ready',
  unresolved: [],
  warnings: [],
}

const PROVISIONED: EvalConditionProvisionView = {
  condition: 'codex-exec',
  dataset: 'ds',
  conditionPath: '/repo/datasets/ds/conditions/codex-exec.json',
  homeDir: '/homes/codex@eval-b',
  credentialState: 'present-unverified',
  written: true,
  homeShaWritten: true,
  sha: 'e'.repeat(64),
  homeSha: 'c'.repeat(64),
  checks: [
    { severity: 'ok', code: 'EFFECTIVE_MATCH', message: 'permissions: declaration and scope agree' },
    { severity: 'warn', code: 'HOME_SHA_WRITTEN', message: 'the declaration was corrected and re-hashed' },
  ],
  row: CODEX_READY,
}

const ENDPOINT_SET: EvalConditionEndpointView = {
  condition: 'codex-exec',
  dataset: 'ds',
  conditionPath: '/repo/datasets/ds/conditions/codex-exec.json',
  before: null,
  after: 'default',
  sha: 'f'.repeat(64),
  written: true,
  lockStale: false,
  row: { ...(CONDITIONS.rows[1] as EvalConditionRow), endpoint: 'default' },
}

const STARTED: EvalApproveResult = {
  started: true,
  checks: REVIEW.checks,
  refusal: null,
  jobId: 'eval-run-9',
  runId: 'run-20260914-zz',
  parentSessionId: 's1',
}

const OUTPUT: EvalRunOutputView = {
  runId: 'run-20260914-zz',
  lines: [
    'readiness codex-exec: NOT READY — the scoped home holds no credential',
    'run refused: 1 condition failed the readiness probe',
  ],
  cursor: 2,
  status: 'failed',
  done: true,
}

interface Harness {
  instance: ReturnType<ReturnType<typeof createLabViewStore>['create']>
  fetchExperiments: ReturnType<typeof vi.fn>
  fetchExperiment: ReturnType<typeof vi.fn>
  fetchPlanReview: ReturnType<typeof vi.fn>
  fetchConditions: ReturnType<typeof vi.fn>
  fetchConditionDiff: ReturnType<typeof vi.fn>
  provisionCondition: ReturnType<typeof vi.fn>
  setConditionEndpoint: ReturnType<typeof vi.fn>
  approvePlan: ReturnType<typeof vi.fn>
  fetchRunOutput: ReturnType<typeof vi.fn>
  fetchDraftOptions: ReturnType<typeof vi.fn>
  draftExperiment: ReturnType<typeof vi.fn>
}

function makeHarness(overrides: Partial<{ review: EvalPlanReview }> = {}): Harness {
  return {
    instance: createLabViewStore().create(),
    fetchExperiments: vi.fn(async (): Promise<Result<EvalExperimentsResult>> => ({ ok: true, value: LIST })),
    fetchExperiment: vi.fn(async () => ({ ok: false as const, error: { code: 'X', message: 'no run' } })),
    fetchPlanReview: vi.fn(async (): Promise<Result<EvalPlanReview>> => ({ ok: true, value: overrides.review ?? REVIEW })),
    fetchConditions: vi.fn(async (): Promise<Result<EvalConditionsView>> => ({ ok: true, value: CONDITIONS })),
    fetchConditionDiff: vi.fn(async (): Promise<Result<EvalConditionDiffView>> => ({ ok: true, value: DIFF })),
    provisionCondition: vi.fn(async (): Promise<Result<EvalConditionProvisionView>> => ({ ok: true, value: PROVISIONED })),
    setConditionEndpoint: vi.fn(async (): Promise<Result<EvalConditionEndpointView>> => ({ ok: true, value: ENDPOINT_SET })),
    // The 新建实验 form has its own spec (NewExperiment.client.spec.tsx);
    // here the two verbs only have to exist, because the dialog mounts with
    // the view and reads them when it is opened.
    fetchDraftOptions: vi.fn(async () => ({ ok: false, error: { code: 'X', message: 'not in this spec' } })),
    draftExperiment: vi.fn(async () => ({ ok: false, error: { code: 'X', message: 'not in this spec' } })),
    approvePlan: vi.fn(async (): Promise<Result<EvalApproveResult>> => ({ ok: true, value: STARTED })),
    fetchRunOutput: vi.fn(async (): Promise<Result<EvalRunOutputView>> => ({ ok: true, value: OUTPUT })),
  }
}

function renderView(h: Harness) {
  const props = {
    sessionId: 's1' as SessionId,
    useStore: hookOf(h.instance),
    actions: h.instance.actions,
    fetchExperiments: h.fetchExperiments,
    fetchExperiment: h.fetchExperiment,
    fetchPlanReview: h.fetchPlanReview,
    fetchConditions: h.fetchConditions,
    fetchConditionDiff: h.fetchConditionDiff,
    provisionCondition: h.provisionCondition,
    setConditionEndpoint: h.setConditionEndpoint,
    fetchDraftOptions: h.fetchDraftOptions,
    draftExperiment: h.draftExperiment,
    approvePlan: h.approvePlan,
    fetchRunOutput: h.fetchRunOutput,
    t: (key: string, params?: Record<string, unknown>) => (
      params === undefined ? key : `${key} ${JSON.stringify(params)}`
    ),
  } as unknown as LabViewProps
  return render(<LabView {...props} />)
}

/** Open the one draft and switch to a sub-page. */
async function openPage(h: Harness, tab: string): Promise<void> {
  fireEvent.click(await screen.findByText('effort-sweep'))
  fireEvent.click(screen.getByRole('button', { name: tab }))
}

/**
 * Click one condition ROW. By role and not by text: once a diff renders, the
 * same id also appears in its header and in both value columns.
 */
function pick(id: string): void {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${id}`) }))
}

afterEach(() => { cleanup() })

describe('the plan-review page', () => {
  it('fetches the review only when its tab is opened, then shows the plan and validate line by line', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('effort-sweep'))
    // The overview costs no review: validate walks the dataset tree.
    expect(h.fetchPlanReview).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'page.plan' }))
    await waitFor(() => { expect(h.fetchPlanReview).toHaveBeenCalledWith('s1', { planPath: PLAN_PATH }) })

    // The kv block: snapshot, shape, factors, judge and samples, order, stages.
    expect(await screen.findByText('overview.shapeValue {"items":4,"conditions":2,"reps":2,"cells":16}')).toBeTruthy()
    // ui-spec §九: the factor cell carries the fields' WORDS, in the spec's
    // own order; the dotted paths stay on the cell's title.
    expect(screen.getByText(/factor\.model\.declared · factor\.harness\.name/)).toBeTruthy()
    expect(screen.getByText(/judge-a · overview.judgeSamples/)).toBeTruthy()
    expect(screen.getByText('review.orderValue {"seed":7}')).toBeTruthy()
    expect(screen.getByText('stage-1, stage-2')).toBeTruthy()
    expect(screen.getByText('review.budgetValue {"minutes":30,"turns":40}')).toBeTruthy()
    expect(screen.getByText('p0-001, p0-002, f2-001, f3-001')).toBeTruthy()
    expect(screen.getByText('first effort sweep')).toBeTruthy()

    // validate, one line per diagnostic, each carrying its severity and code.
    expect(screen.getByText('severity.warn')).toBeTruthy()
    expect(screen.getAllByText('severity.ok')).toHaveLength(2)
    // The diagnostic code is the host's handle on the check, not a word:
    // ui-spec §九 keeps it on the row's title and the sentence on the page.
    expect(screen.getByTitle('COMMIT_UNRESOLVED')).toBeTruthy()
    // The condition list carries the readiness word and the lock state.
    expect(screen.getAllByText('conditions.ready').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('conditions.unready')).toBeTruthy()
    expect(screen.getByText('review.lockNone')).toBeTruthy()
  })

  it('批准并启动 approves the plan, lands on the overview, and shows the job, the run and the log VERBATIM', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.plan')
    fireEvent.click(await screen.findByRole('button', { name: 'review.approve' }))

    await waitFor(() => { expect(h.approvePlan).toHaveBeenCalledWith('s1', { planPath: PLAN_PATH }) })
    // Landed on the overview, and the ids are there before the ledger has the run.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'page.overview' }).getAttribute('aria-pressed')).toBe('true')
    })
    expect(await screen.findByText('review.startedValue {"jobId":"eval-run-9","runId":"run-20260914-zz"}')).toBeTruthy()
    // The readiness refusal exists ONLY in the job log — the run never reached
    // runCreate, so no ledger row for it will ever exist.
    expect(h.fetchRunOutput).toHaveBeenCalledWith('eval-run-9')
    expect(await screen.findByText(/readiness codex-exec: NOT READY — the scoped home holds no credential/)).toBeTruthy()
  })

  it('保留单元 is off by default and carries into the approval when ticked', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.plan')
    const box = await screen.findByRole('checkbox', { name: 'review.keepUnits' })
    // Off unless someone ticks it: left on, every cell's container would
    // survive the run and the matrix would stop at lab's ceiling (T33b).
    expect((box as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByText('review.keepUnitsHint')).toBeNull()

    fireEvent.click(box)
    expect(screen.getByText('review.keepUnitsHint')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'review.approve' }))

    await waitFor(() => {
      expect(h.approvePlan).toHaveBeenCalledWith('s1', { planPath: PLAN_PATH, keepUnits: true })
    })
  })

  it('a job-log read that REJECTS (the proxy, not the envelope) surfaces instead of vanishing', async () => {
    const h = makeHarness()
    h.fetchRunOutput.mockRejectedValue(new Error('client api: dshEval/runOutput expected 2 argument(s), got 1'))
    renderView(h)
    await openPage(h, 'page.plan')
    fireEvent.click(await screen.findByRole('button', { name: 'review.approve' }))

    // An unrecognized cause keeps the caller's own sentence as the headline,
    // and the raw text stays readable under «详情» (ui-spec §九).
    expect(await screen.findByText('review.jobLogError')).toBeTruthy()
    expect(screen.getByText('error.unknownFix')).toBeTruthy()
    expect(screen.getByText(/client api: dshEval\/runOutput/)).toBeTruthy()
  })

  it('a refused approval shows the refusal verbatim and starts nothing', async () => {
    const h = makeHarness()
    h.approvePlan.mockResolvedValue({
      ok: true,
      value: {
        started: false,
        checks: REVIEW.checks,
        refusal: 'validate refuses this plan (1 error(s)) — nothing was started:\n  [CONDITION_MISSING] no conditions/codex-exec.json',
        jobId: null,
        runId: null,
        parentSessionId: null,
      } satisfies EvalApproveResult,
    })
    renderView(h)
    await openPage(h, 'page.plan')
    fireEvent.click(await screen.findByRole('button', { name: 'review.approve' }))

    // The gate's own words are the ONLY record of why (the run never reached
    // `runCreate`), so they are kept verbatim — under «详情», per §九.
    expect(await screen.findByText(/no conditions\/codex-exec.json/)).toBeTruthy()
    expect(screen.getByText('review.refusal')).toBeTruthy()
    expect(screen.getByText('review.refusalLead')).toBeTruthy()
    expect(screen.getByText('review.refusalRaw')).toBeTruthy()
    // Still on the plan page, and nothing claims to have started.
    expect(screen.queryByText('review.started')).toBeNull()
    expect(h.fetchRunOutput).not.toHaveBeenCalled()
  })

  it('a plan validate rejects cannot be approved at all, and the page says how many errors', async () => {
    const h = makeHarness({
      review: {
        ...REVIEW,
        ok: false,
        errors: 2,
        checks: [{ severity: 'error', code: 'PLAN_SCHEMA', message: 'conditions must be an array' }],
      },
    })
    renderView(h)
    await openPage(h, 'page.plan')

    const approve = await screen.findByRole('button', { name: 'review.approve' })
    expect(approve.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('review.approveBlocked {"errors":2}')).toBeTruthy()
    fireEvent.click(approve)
    expect(h.approvePlan).not.toHaveBeenCalled()
  })

  it('退回修改 is a note on the page: the status reads 草稿 and no verb is called', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.plan')
    await screen.findByRole('button', { name: 'review.sendBack' })
    expect(screen.getByText('status.pending-approval')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'review.sendBack' }))

    expect(screen.getByText('review.sentBack')).toBeTruthy()
    expect(screen.getByText('status.draft')).toBeTruthy()
    expect(h.approvePlan).not.toHaveBeenCalled()
  })

  it('a run that records no plan document says so instead of reviewing a file nobody can name', async () => {
    const h = makeHarness()
    h.fetchExperiments.mockResolvedValue({
      ok: true,
      value: { ...LIST, rows: [{ ...LIST.rows[0]!, planPath: null, runId: 'run-1', id: 'run-1', status: 'running' }] },
    })
    renderView(h)
    fireEvent.click(await screen.findByText('effort-sweep'))
    fireEvent.click(screen.getByRole('button', { name: 'page.plan' }))

    expect(screen.getByText('review.noPlan')).toBeTruthy()
    expect(h.fetchPlanReview).not.toHaveBeenCalled()
  })
})

describe('the conditions page', () => {
  it('lists every condition with its scope, preset, lock and readiness', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.conditions')

    await waitFor(() => { expect(h.fetchConditions).toHaveBeenCalledWith('s1', {}) })
    expect(await screen.findByText('dsh-exec')).toBeTruthy()
    expect(screen.getByText('codex-exec')).toBeTruthy()
    expect(screen.getByText('dsh · exec')).toBeTruthy()
    expect(screen.getByText('deepseek-v4')).toBeTruthy()
    // An unnamed scope prints as the default one rather than as a blank cell.
    expect(screen.getAllByText('conditions.scopeDefault')).toHaveLength(2)
    expect(screen.getByText('eval-b')).toBeTruthy()
    expect(screen.getByText('bench')).toBeTruthy()
    expect(screen.getByText('conditions.lockOk')).toBeTruthy()
    expect(screen.getByText(/conditions.lockNone/)).toBeTruthy()
    // A lock present but no longer matching its declaration, and no home hash:
    // both facts are on the one cell, because either one alone misleads.
    expect(screen.getByText('conditions.lockStale · conditions.homeUnhashed')).toBeTruthy()
    expect(screen.getByText('conditions.ready')).toBeTruthy()
    expect(screen.getAllByText('conditions.unready')).toHaveLength(2)
  })

  it('picking two conditions diffs them, and the table carries ONLY the differing fields', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.conditions')
    await screen.findByText('conditions.pickHint')
    pick('dsh-exec')
    expect(screen.getByText('conditions.pickOne')).toBeTruthy()
    pick('codex-exec')

    await waitFor(() => { expect(h.fetchConditionDiff).toHaveBeenCalledWith('s1', { a: 'dsh-exec', b: 'codex-exec' }) })
    expect(await screen.findByText('conditions.diffCount {"count":3}')).toBeTruthy()
    // The three differing fields, each highlighted, and nothing else. The
    // column is the field's NAME; the dotted path is on its title (§九).
    for (const key of ['factor.harness.name', 'factor.model.declared', 'factor.scope']) {
      expect(screen.getByText(key)).toBeTruthy()
    }
    expect(screen.queryByText('factor.permissions')).toBeNull()
    expect(screen.queryByText('factor.reasoning.effort')).toBeNull()
    // Absent-on-one-side is a difference like any other, and reads as one.
    expect(screen.getByText('conditions.diffAbsent')).toBeTruthy()
    expect(screen.getByText('"gpt-5.6-sol"')).toBeTruthy()
  })

  it('picking a third condition drops the older of the two rather than refusing', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.conditions')
    await screen.findByText('conditions.pickHint')
    pick('dsh-exec')
    pick('codex-exec')
    await waitFor(() => { expect(h.fetchConditionDiff).toHaveBeenCalledTimes(1) })

    pick('kimi-exec')

    await waitFor(() => { expect(h.fetchConditionDiff).toHaveBeenLastCalledWith('s1', { a: 'codex-exec', b: 'kimi-exec' }) })
  })

  it('picking a picked condition unpicks it, and the diff goes with it', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.conditions')
    await screen.findByText('conditions.pickHint')
    pick('dsh-exec')
    pick('codex-exec')
    expect(await screen.findByText('conditions.diffCount {"count":3}')).toBeTruthy()

    pick('codex-exec')

    expect(screen.queryByText('conditions.diffCount {"count":3}')).toBeNull()
    expect(screen.getByText('conditions.pickOne')).toBeTruthy()
  })

  it('provisioning one row takes ONE click and the row turns ready (I5·T58 · G7)', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.conditions')
    await screen.findByText('codex-exec')
    expect(screen.getByText(/conditions.lockNone/)).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'conditions.provision' })[1] as HTMLElement)

    await waitFor(() => {
      expect(h.provisionCondition).toHaveBeenCalledWith('s1', { dataset: 'ds', condition: 'codex-exec' })
    })
    // One call, and the row is ready: the page never asks for a second
    // provision and never asks the person to copy a hash anywhere.
    expect(h.provisionCondition).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('conditions.provisionWritten')).toBeTruthy()
    expect(screen.getByText('conditions.provisionWroteBack')).toBeTruthy()
    await waitFor(() => { expect(screen.getAllByText('conditions.ready')).toHaveLength(2) })
    // The check lines are the plan-review page's own shape, verbatim.
    expect(screen.getByText(/the declaration was corrected and re-hashed/)).toBeTruthy()
  })

  it('a refused provision says so and leaves the row where it was', async () => {
    const h = makeHarness()
    h.provisionCondition.mockResolvedValue({
      ok: false,
      error: { code: 'EVAL_PROVISION', message: 'codex@eval-b reports credentialState "absent" — run /codex login' },
    })
    renderView(h)
    await openPage(h, 'page.conditions')
    await screen.findByText('codex-exec')

    fireEvent.click(screen.getAllByRole('button', { name: 'conditions.provision' })[1] as HTMLElement)

    // Three-part seat (ui-spec §九): the page says what happened and what to
    // do, and the host's own sentence is inside the fold — not on the page.
    expect(await screen.findByText('error.unknownFix')).toBeTruthy()
    expect(screen.getByText('conditions.provisionFailed')).toBeTruthy()
    const raw = screen.getByText(/credentialState "absent" — run \/codex login/)
    expect(raw.closest('details')).not.toBeNull()
    expect(screen.getAllByText('conditions.unready')).toHaveLength(2)
  })

  it('the endpoint cell edits in place and writes the field the readiness gate wants (· G6)', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.conditions')
    // `codex-exec` declares no endpoint; the cell says so rather than showing
    // an empty column.
    expect(await screen.findByText('conditions.endpointUnset')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'conditions.endpointUnset' }))
    fireEvent.change(screen.getByLabelText('conditions.col.endpoint'), { target: { value: 'default' } })
    fireEvent.click(screen.getByRole('button', { name: 'conditions.endpointSave' }))

    await waitFor(() => {
      expect(h.setConditionEndpoint).toHaveBeenCalledWith('s1', { dataset: 'ds', condition: 'codex-exec', endpoint: 'default' })
    })
    expect(await screen.findByText(/conditions.endpointWritten/)).toBeTruthy()
    // Editing a row does not also pick it for the diff: the cell's own click
    // stops there.
    expect(h.fetchConditionDiff).not.toHaveBeenCalled()
  })

  it('reopening the endpoint cell shows the declaration, not the text a cancel threw away', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.conditions')
    fireEvent.click(await screen.findByRole('button', { name: 'conditions.endpointUnset' }))
    fireEvent.change(screen.getByLabelText('conditions.col.endpoint'), { target: { value: 'typo-i-changed-my-mind' } })
    fireEvent.click(screen.getByRole('button', { name: 'conditions.endpointCancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'conditions.endpointUnset' }))

    expect((screen.getByLabelText('conditions.col.endpoint') as HTMLInputElement).value).toBe('')
    expect(h.setConditionEndpoint).not.toHaveBeenCalled()
  })

  it('says the lock went stale when the endpoint edit changed the subject', async () => {
    const h = makeHarness()
    h.setConditionEndpoint.mockResolvedValue({ ok: true, value: { ...ENDPOINT_SET, lockStale: true } })
    renderView(h)
    await openPage(h, 'page.conditions')
    fireEvent.click(await screen.findByRole('button', { name: 'conditions.endpointUnset' }))
    fireEvent.change(screen.getByLabelText('conditions.col.endpoint'), { target: { value: 'default' } })
    fireEvent.click(screen.getByRole('button', { name: 'conditions.endpointSave' }))

    expect(await screen.findByText(/conditions.endpointLockStale/)).toBeTruthy()
  })

  it('新建条件 names the task that owns it — choosing a model IS minting a condition', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.conditions')
    fireEvent.click(await screen.findByRole('button', { name: 'conditions.new' }))
    expect(screen.getByText('conditions.newPlaceholder')).toBeTruthy()
  })

  it('a refused listing names the cause and the fix, with the raw text folded away', async () => {
    const h = makeHarness()
    h.fetchConditions.mockResolvedValue({ ok: false, error: { code: 'REFUSED', message: 'no dataset repository for this session' } })
    renderView(h)
    await openPage(h, 'page.conditions')
    // Three parts, not the exception: what happened, how to fix it, and the
    // host's own sentence under «详情».
    expect(await screen.findByText('error.unbound')).toBeTruthy()
    expect(screen.getByText('error.unbound.fix')).toBeTruthy()
    expect(screen.getByText('conditions.error')).toBeTruthy()
    expect(screen.getByText('no dataset repository for this session')).toBeTruthy()
  })
})
