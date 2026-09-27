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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  EvalApproveResult, EvalConditionDiffView, EvalConditionEndpointView, EvalConditionProvisionView,
  EvalConditionRow, EvalConditionsView, EvalExperimentsResult,
  EvalPlanNumbersResult, EvalPlanReview, EvalRunOutputView,
} from '../src/types.ts'
import type { LabViewProps } from '../src/client/contract.ts'
import { LabView } from '../src/client/LabView.tsx'
import { createLabViewStore, START_FOLLOWUP_LIMIT, START_FOLLOWUP_MS } from '../src/client/store.ts'

/** Selector hook over the store engine instance (the test-sanctioned engine path). */
function hookOf(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => unknown }) {
  return function useSelector<S>(sel: (s: unknown) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

const EXPERIMENT_ID = 'effort-sweep-20260914-ab12'
const PLAN_PATH = `/state/eval/experiments/${EXPERIMENT_ID}/plan.json`

const LIST: EvalExperimentsResult = {
  notes: [],
  session: 's1',
  rows: [{
    id: `experiment:${EXPERIMENT_ID}`,
    experimentId: EXPERIMENT_ID,
    legacy: false,
    name: 'effort-sweep',
    planPath: PLAN_PATH,
    runId: null,
    status: 'pending-approval',
    statusDetail: null,
    snapshot: { registry: 'reg', datasetId: 'ds', commit: 'c0ffee'.padEnd(40, '0') },
    conditions: ['dsh-exec', 'codex-exec'],
    judges: ['judge-a'],
    items: 4,
    reps: 2,
    factors: ['harness.name', 'model.declared', 'home.sha'],
    progress: null,
    startedAt: null,
    validation: { ok: true, errors: 0, warnings: 1 },
    originSession: 's1',
    archived: false,
    closure: null,
    lastProgressAt: null,
    stalledMinutes: null,
    unit: null,
    question: null,
  }],
}

const REVIEW: EvalPlanReview = {
  planPath: PLAN_PATH,
  schema: 'dataseek.plan/1',
  ok: true,
  errors: 0,
  warnings: 1,
  digest: {
    dataset: { registry: 'reg', id: 'ds', commit: 'c0ffee'.padEnd(40, '0') },
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
    question: null,
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
  rows: [
    {
      id: 'dsh-exec',
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
  a: { id: 'dsh-exec', path: '/state/eval/conditions/dsh-exec.json', sha: 'a'.repeat(64) },
  b: { id: 'codex-exec', path: '/state/eval/conditions/codex-exec.json', sha: 'b'.repeat(64) },
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
  conditionPath: '/state/eval/conditions/codex-exec.json',
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
  conditionPath: '/state/eval/conditions/codex-exec.json',
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
  insertDraft: ReturnType<typeof vi.fn>
  setPlanNumbers: ReturnType<typeof vi.fn>
}

function makeHarness(overrides: Partial<{ review: EvalPlanReview; composer: boolean }> = {}): Harness {
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
    // 让 agent 处理 fills the composer and never sends; false = no composer here.
    insertDraft: vi.fn(() => overrides.composer ?? true),
    setPlanNumbers: vi.fn(async (): Promise<Result<EvalPlanNumbersResult>> => ({
      ok: true,
      value: {
        experimentId: EXPERIMENT_ID,
        changes: [{ field: 'reps', before: 2, after: 3 }],
        written: true,
        review: { ...(overrides.review ?? REVIEW), digest: { ...(overrides.review ?? REVIEW).digest!, reps: 3 } },
      },
    })),
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
    insertDraft: h.insertDraft,
    setPlanNumbers: h.setPlanNumbers,
    t: (key: string, params?: Record<string, unknown>) => (
      params === undefined ? key : `${key} ${JSON.stringify(params)}`
    ),
  } as unknown as LabViewProps
  return render(<LabView {...props} />)
}

/** Open the one draft and switch to a stage. */
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
  it('reads the review when the design stage opens, then shows the plan and validate line by line', async () => {
    const h = makeHarness()
    renderView(h)
    // The LIST costs no review: validate walks the dataset tree, and a reader
    // looking at their experiments has not asked for one.
    await screen.findByText('effort-sweep')
    expect(h.fetchPlanReview).not.toHaveBeenCalled()

    // Opening an experiment lands on 实验设计, and the review IS that stage
    // (ui-spec §五 v2): the shape, the checks and the readiness are what it
    // shows, and the stage bar cannot offer 批准并启动 before validate speaks.
    fireEvent.click(screen.getByText('effort-sweep'))
    await waitFor(() => { expect(h.fetchPlanReview).toHaveBeenCalledWith('s1', { experimentId: EXPERIMENT_ID }) })

    // The kv block: snapshot, shape, factors, judge and samples, order, stages.
    expect(await screen.findByText('overview.shapeValue {"items":4,"conditions":2,"reps":2,"cells":16}')).toBeTruthy()
    // ui-spec §九 / T80d: the comparison table's foot names the differing
    // fields in WORDS, in the spec's own order, and warns that two of them
    // make the comparison descriptive; the dotted paths stay on its title.
    expect(screen.getByText(/conditions\.differsWarn .*factor\.model\.declared、factor\.harness\.name/)).toBeTruthy()
    // A differing field with no column (the home digest) is named as living in
    // the group name's hover, so three differences over two columns do not
    // read as a column gone missing; the columned ones carry no such hint.
    expect(screen.getByText(/conditions\.differsWarn .*conditions\.factorHover \{\\"field\\":\\"factor\.home\.sha\\"\}/)).toBeTruthy()
    expect(screen.queryByText(/factorHover \{\\"field\\":\\"factor\.(model|harness)/)).toBeNull()
    expect(screen.getByText((_, el) => el?.tagName === 'DD' && /^judge-a · overview.judgeSamples/.test(el.textContent ?? ''))).toBeTruthy()
    // T84 §一: 高级设置 is split up — the stage scope went to 在哪些题上比,
    // 每格预算 and 判官采样 to 规模与花费; what is left (seed, the author's
    // note with its line breaks, the receipts) sits under 原始文件（核对用）.
    expect(screen.getByText('design.raw')).toBeTruthy()
    expect(screen.getByText('design.advanced')).toBeTruthy()
    expect(screen.getByText('review.orderValue {"seed":7}')).toBeTruthy()
    expect(screen.queryByText('stage-1, stage-2')).toBeNull()
    expect(screen.getByText('first effort sweep')).toBeTruthy()

    // validate, one line per diagnostic, each carrying its severity and code.
    // Only the lines that need READING are on the page; a clean check is not
    // news, so the passing ones sit under the fold.
    // T72 §4: the lines that need reading form the readiness checklist —
    // blockers and reminders — each in a human sentence; the passing ones sit
    // under the fold.
    // T84 §三: the dataset's warning goes under the dataset's row (opened,
    // since it has something to act on), not into 提醒 at the bottom.
    expect(screen.queryByText(/^readiness\.reminders /)).toBeNull()
    expect(screen.getByText('basis.row.dataset {"label":"ds @ c0ffee00"}')).toBeTruthy()
    expect(screen.getByText('readiness.COMMIT_UNRESOLVED {"condition":""}')).toBeTruthy()
    expect(screen.getAllByText('severity.ok')).toHaveLength(2)
    expect(screen.getByText('review.checks')).toBeTruthy()
    // The diagnostic code is the host's handle on the check, not a word:
    // ui-spec §九 keeps it on the row's title and the sentence on the page.
    expect(screen.getByTitle(/^COMMIT_UNRESOLVED · /)).toBeTruthy()
    // The readiness BADGE replaces the old per-row word: one chip when every
    // group passed, a cross and a count when they did not (ui-spec §五 v2).
    expect(screen.getByText(/ready\.failedCount/)).toBeTruthy()

  })

  it('批准并启动 approves the plan, stays put, and shows the job, the run and the log VERBATIM', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.design')
    fireEvent.click(await screen.findByRole('button', { name: 'cta.pending' }))

    await waitFor(() => { expect(h.approvePlan).toHaveBeenCalledWith('s1', { experimentId: EXPERIMENT_ID }) })
    // STAYS on 实验设计: a readiness refusal is written only in the job log
    // below, and walking the reader to an empty grid would leave the reason
    // behind. The stage bar turns to 看运行记录 instead, one click away.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'page.design' }).getAttribute('aria-pressed')).toBe('true')
    })
    expect(await screen.findByRole('button', { name: 'cta.running' })).toBeTruthy()
    expect(await screen.findByText('review.startedValue {"jobId":"eval-run-9","runId":"run-20260914-zz"}')).toBeTruthy()
    // The readiness refusal exists ONLY in the job log — the run never reached
    // runCreate, so no ledger row for it will ever exist.
    expect(h.fetchRunOutput).toHaveBeenCalledWith('eval-run-9')
    expect(await screen.findByText(/readiness codex-exec: NOT READY — the scoped home holds no credential/)).toBeTruthy()
  })

  it('保留单元 is off by default and carries into the approval when ticked', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.design')
    const box = await screen.findByRole('checkbox', { name: 'review.keepUnits' })
    // Off unless someone ticks it: left on, every cell's container would
    // survive the run and the matrix would stop at lab's ceiling (T33b).
    expect((box as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByText('review.keepUnitsHint')).toBeNull()

    fireEvent.click(box)
    expect(screen.getByText('review.keepUnitsHint')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'cta.pending' }))

    await waitFor(() => {
      expect(h.approvePlan).toHaveBeenCalledWith('s1', { experimentId: EXPERIMENT_ID, keepUnits: true })
    })
  })

  it('a job-log read that REJECTS (the proxy, not the envelope) surfaces instead of vanishing', async () => {
    const h = makeHarness()
    h.fetchRunOutput.mockRejectedValue(new Error('client api: dshEval/runOutput expected 2 argument(s), got 1'))
    renderView(h)
    await openPage(h, 'page.design')
    fireEvent.click(await screen.findByRole('button', { name: 'cta.pending' }))

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
    await openPage(h, 'page.design')
    fireEvent.click(await screen.findByRole('button', { name: 'cta.pending' }))

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
    await openPage(h, 'page.design')

    // T72 §3: the stage bar offers the FIRST blocker's fix, never 批准并启动.
    expect(await screen.findByText('cta.pendingBlocked {"count":1}')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'cta.pending' })).toBeNull()
    const [barFix] = screen.getAllByRole('button', { name: 'fix.agent' })
    fireEvent.click(barFix!)
    expect(h.insertDraft).toHaveBeenCalledWith(
      's1',
      'readiness.agentAsk {"name":"effort-sweep","k":1,"text":"conditions must be an array"}',
    )
    expect(h.approvePlan).not.toHaveBeenCalled()
  })

  it('退回给 agent… asks what to change, pre-fills the composer, and the note clears once the plan moves', async () => {
    const h = makeHarness({ review: { ...REVIEW, planSha: 'sha-a' } })
    renderView(h)
    await openPage(h, 'page.design')
    // T83 · design: the send-back sits in the stage bar, beside the primary.
    await screen.findByRole('button', { name: 'cta.askAgent' })
    expect(screen.queryByRole('button', { name: 'review.sendBack' })).toBeNull()
    expect(screen.getByText('status.pending-approval')).toBeTruthy()

    // T84 §五: the button opens the panel — nothing is marked yet.
    fireEvent.click(screen.getByRole('button', { name: 'cta.askAgent' }))
    expect(screen.queryByText('review.sentBack')).toBeNull()
    const submit = screen.getByRole('button', { name: 'sendBack.submit' })
    expect((submit as HTMLButtonElement).disabled).toBe(true)
    // The drafting session is this one, so there is no 放到 choice.
    expect(screen.queryByRole('radiogroup', { name: 'sendBack.target' })).toBeNull()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'align the scopes' } })
    fireEvent.click(submit)

    // Pre-filled in THIS session's composer, the experiment named — never sent.
    await waitFor(() => {
      expect(h.insertDraft).toHaveBeenCalledWith('s1', `sendBack.template ${JSON.stringify({ name: 'effort-sweep', id: EXPERIMENT_ID, text: 'align the scopes' })}`)
    })
    expect(screen.getByText('review.sentBack')).toBeTruthy()
    expect(screen.getByText('status.draft')).toBeTruthy()
    expect(h.approvePlan).not.toHaveBeenCalled()

    // The same plan re-read keeps the note; a changed plan clears it (§六.3).
    fireEvent.click(screen.getByRole('button', { name: 'ready.recheck' }))
    await waitFor(() => { expect(h.fetchPlanReview).toHaveBeenCalledTimes(2) })
    expect(screen.getByText('review.sentBack')).toBeTruthy()
    h.fetchPlanReview.mockResolvedValue({ ok: true, value: { ...REVIEW, planSha: 'sha-b' } })
    fireEvent.click(screen.getByRole('button', { name: 'ready.recheck' }))
    await waitFor(() => { expect(screen.queryByText('review.sentBack')).toBeNull() })
    expect(screen.getByText('status.pending-approval')).toBeTruthy()
  })

  it('a run that records no plan document says so instead of reviewing a file nobody can name', async () => {
    const h = makeHarness()
    h.fetchExperiments.mockResolvedValue({
      ok: true,
      value: { ...LIST, rows: [{ ...LIST.rows[0]!, planPath: null, runId: 'run-1', id: 'run-1', status: 'running' }] },
    })
    renderView(h)
    fireEvent.click(await screen.findByText('effort-sweep'))
    fireEvent.click(screen.getByRole('button', { name: 'page.design' }))

    expect(screen.getByText('review.noPlan')).toBeTruthy()
    expect(h.fetchPlanReview).not.toHaveBeenCalled()
  })
})

describe('the readiness badge names every subject, and why each one is not ready', () => {
  it('counts the groups the PLAN names, not only the ones something resolved', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.design')
    await screen.findAllByText('codex-exec')

    // THREE subjects — two players and the judge — because the count walks the
    // plan's own list. It used to walk whatever had been resolved, so a group
    // nothing knew about vanished out of the denominator instead of appearing
    // as a cross in it (I5·T67 · W12).
    expect(await screen.findByText('ready.failedCount {"count":1,"total":3}')).toBeTruthy()
  })

  it('每个红叉自己说为什么 — read from the review\'s structure, not from its English', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.design')
    await screen.findAllByText('codex-exec')

    // codex-exec: no lock beside the declaration, and no scoped home was ever
    // hashed. Both facts are structural fields of the review row, so the words
    // do not depend on parsing a host sentence (W15) — the cross used to carry
    // a name and nothing else, with the reasons loose in validate's English
    // warnings below it.
    // T84 §三: the 依据 column says what was checked, in the order checked.
    expect(screen.getByText('basis.subject.noLockShort · basis.subject.homeMissingShort')).toBeTruthy()
  })

  it('a judge the registry listing does not carry stays out of the compare table, and in the checklist', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.design')
    await screen.findAllByText('codex-exec')

    // The table reads the REGISTRY and the badge reads the REVIEW; a subject
    // the registry does not list used to be filtered away silently, so a
    // one-row table stood for a three-subject experiment (W12). It cannot be
    // picked for a diff and cannot be provisioned — there is no declaration to
    // do either to — so it carries dashes and the one word there is about it.
    const row = screen.getAllByText('judge-a').map(node => node.closest('[data-absent]')).find(Boolean)
    // A JUDGE is not a row of the compare table (T83 · design): it is named
    // in 怎么判, and its readiness is the checklist's line.
    expect(row).toBeUndefined()
    expect(screen.getByText('basis.row.judge {"id":"judge-a"}').closest('table')).not.toBeNull()
  })

  it('a plan whose file is gone gets the three-part seat, not its English sentence', async () => {
    const h = makeHarness({
      review: {
        ...REVIEW,
        ok: false,
        errors: 1,
        checks: [{
          severity: 'error',
          code: 'PLAN_UNREADABLE',
          // A path shaped like the real one, without being one: repo hygiene
          // refuses literal absolute paths anywhere in the tree, and it is
          // right to — this is a fixture, not a machine.
          message: 'cannot read plan file: ~/scratch/ds/plans/t60-g11-host.json',
        }],
      },
    })
    renderView(h)
    await openPage(h, 'page.design')

    // A sentence about the plan, a sentence about what to do, and the host's
    // own text plus the absolute path folded away (§九 · W11).
    expect(await screen.findByText('error.planUnreadable')).toBeTruthy()
    expect(screen.getByText('error.planUnreadable.fix')).toBeTruthy()
    const raw = screen.getByText(/cannot read plan file/)
    expect(raw.closest('details')).not.toBeNull()
    // …and it is NOT also sitting in the check list as a line of its own.
    expect(screen.queryAllByText(/cannot read plan file/)).toHaveLength(1)
  })
})

describe('the planned grid', () => {
  it('draws the experiment BEFORE it runs — items down, comparison groups across, 计划 n 次 in every seat', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.design')
    // Folded under 方案 (T80d): the grid is the plan's receipt, not its headline.
    await screen.findByText(/^design\.gridFold/)

    // 4 items × 2 groups, each seat carrying the reps the plan asks for. v1
    // had nothing here at all: the shape of an experiment was an arithmetic
    // expression until the run made it a picture, which is too late to change
    // it (ui-spec §五 v2).
    expect(screen.getAllByText('design.planned {"reps":2}')).toHaveLength(8)
    // Each item twice: the 用哪些题 table's row and the grid's row head.
    for (const item of ['p0-001', 'p0-002', 'f2-001', 'f3-001']) {
      expect(screen.getAllByText(item)).toHaveLength(2)
    }
    // ui-spec §九: the heading is the group, the comparison VARIABLE's value
    // is the subtitle — not a repeat of the harness the table already spells
    // out one section above.
    expect(screen.getByText(/factor\.model\.declared\s+deepseek-v4/)).toBeTruthy()
    expect(screen.getByText(/factor\.model\.declared\s+gpt-5\.6-sol/)).toBeTruthy()
  })
})

describe('the conditions page', () => {
  it('lists THIS experiment\'s comparison groups with their scope, preset, lock and readiness', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.design')

    await waitFor(() => { expect(h.fetchConditions).toHaveBeenCalledWith('s1', {}) })
    // The group id is on the table row, on the planned grid's column heading
    // — the two halves of section ② (ui-spec §五 v2) — and, since T83 (v5 ·
    // ready), on its own row of the 检查项 table, ready or not.
    expect((await screen.findAllByText('dsh-exec')).length).toBe(3)
    expect(screen.getAllByText('codex-exec').length).toBe(3)
    expect(screen.getByText('dsh · exec')).toBeTruthy()
    expect(screen.getByText('deepseek-v4')).toBeTruthy()
    // `kimi-exec` is declared in the repository and this experiment does not
    // use it: a registry of everything on a page about ONE comparison is the
    // data-dumping v2 removes.
    expect(screen.queryByText('kimi-exec')).toBeNull()
    // An unnamed scope prints as the default one rather than as a blank cell.
    expect(screen.getByText('conditions.scopeDefault')).toBeTruthy()
    expect(screen.getByText('eval-b')).toBeTruthy()
    expect(screen.getByText('bench')).toBeTruthy()
    // A ready row's lock is its chip's hover (T80d): the sentence is spelled
    // out only on the row that needs doing something about.
    expect(screen.getByTitle('conditions.lockOk')).toBeTruthy()
    expect(screen.getAllByText(/conditions.lockNone/).length).toBeGreaterThan(0)
    expect(screen.getByText('conditions.ready')).toBeTruthy()
    expect(screen.getByText('conditions.unready')).toBeTruthy()
  })

  it('a stale lock and an unhashed home are said on the ONE cell — either alone misleads', async () => {
    // kimi-exec carries both, and it takes part in this experiment here.
    const h = makeHarness({
      review: { ...REVIEW, digest: { ...REVIEW.digest!, conditions: ['dsh-exec', 'kimi-exec'] } },
    })
    renderView(h)
    await openPage(h, 'page.design')
    expect(await screen.findByText('conditions.lockStale · conditions.homeUnhashed')).toBeTruthy()
  })

  it('picking two conditions diffs them, and the table carries ONLY the differing fields', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.design')
    await screen.findAllByTitle('conditions.pickHint')
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

  it('picking a third comparison group drops the older of the two rather than refusing', async () => {
    // Three groups in the plan, because the table shows THIS experiment's
    // subjects and a chain of comparisons is what the drop rule is for.
    const h = makeHarness({
      review: { ...REVIEW, digest: { ...REVIEW.digest!, conditions: ['dsh-exec', 'codex-exec', 'kimi-exec'] } },
    })
    renderView(h)
    await openPage(h, 'page.design')
    await screen.findAllByTitle('conditions.pickHint')
    pick('dsh-exec')
    pick('codex-exec')
    await waitFor(() => { expect(h.fetchConditionDiff).toHaveBeenCalledTimes(1) })

    pick('kimi-exec')

    await waitFor(() => { expect(h.fetchConditionDiff).toHaveBeenLastCalledWith('s1', { a: 'codex-exec', b: 'kimi-exec' }) })
  })

  it('picking a picked condition unpicks it, and the diff goes with it', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.design')
    await screen.findAllByTitle('conditions.pickHint')
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
    await openPage(h, 'page.design')
    await screen.findAllByText('codex-exec')
    expect(screen.getByText(/conditions.lockNone/)).toBeTruthy()

    // Only the unready row carries the button (T80d).
    expect(screen.getAllByRole('button', { name: 'conditions.provision' })).toHaveLength(1)
    fireEvent.click(screen.getAllByRole('button', { name: 'conditions.provision' })[0] as HTMLElement)

    await waitFor(() => {
      expect(h.provisionCondition).toHaveBeenCalledWith('s1', { condition: 'codex-exec' })
    })
    // One call, and the row is ready: the page never asks for a second
    // provision and never asks the person to copy a hash anywhere.
    expect(h.provisionCondition).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('conditions.provisionWritten')).toBeTruthy()
    expect(screen.getByText('conditions.provisionWroteBack')).toBeTruthy()
    // Every row ready: the state column has nothing left to say and goes.
    await waitFor(() => { expect(screen.queryByText('conditions.unready')).toBeNull() })
    expect(screen.queryByRole('button', { name: 'conditions.provision' })).toBeNull()
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
    await openPage(h, 'page.design')
    // The id is on the table row, the grid heading AND its readiness cross,
    // so waiting for «exactly one» is waiting for a page that never settles.
    await screen.findAllByText('codex-exec')

    // Only the unready row carries the button (T80d).
    expect(screen.getAllByRole('button', { name: 'conditions.provision' })).toHaveLength(1)
    fireEvent.click(screen.getAllByRole('button', { name: 'conditions.provision' })[0] as HTMLElement)

    // Three-part seat (ui-spec §九): the page says what happened and what to
    // do, and the host's own sentence is inside the fold — not on the page.
    expect(await screen.findByText('error.unknownFix')).toBeTruthy()
    expect(screen.getByText('conditions.provisionFailed')).toBeTruthy()
    const raw = screen.getByText(/credentialState "absent" — run \/codex login/)
    expect(raw.closest('details')).not.toBeNull()
    // The row did not move: it is still the one unready group of the two this
    // experiment runs.
    expect(screen.getAllByText('conditions.unready')).toHaveLength(1)
  })

  it('the endpoint cell edits in place and writes the field the readiness gate wants (· G6)', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.design')
    // `codex-exec` declares no endpoint; the cell says so rather than showing
    // an empty column.
    expect(await screen.findByText('conditions.endpointUnset')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'conditions.endpointUnset' }))
    fireEvent.change(screen.getByLabelText('conditions.col.endpoint'), { target: { value: 'default' } })
    fireEvent.click(screen.getByRole('button', { name: 'conditions.endpointSave' }))

    await waitFor(() => {
      expect(h.setConditionEndpoint).toHaveBeenCalledWith('s1', { condition: 'codex-exec', endpoint: 'default' })
    })
    expect(await screen.findByText(/conditions.endpointWritten/)).toBeTruthy()
    // Editing a row does not also pick it for the diff: the cell's own click
    // stops there.
    expect(h.fetchConditionDiff).not.toHaveBeenCalled()
  })

  it('reopening the endpoint cell shows the declaration, not the text a cancel threw away', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.design')
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
    await openPage(h, 'page.design')
    fireEvent.click(await screen.findByRole('button', { name: 'conditions.endpointUnset' }))
    fireEvent.change(screen.getByLabelText('conditions.col.endpoint'), { target: { value: 'default' } })
    fireEvent.click(screen.getByRole('button', { name: 'conditions.endpointSave' }))

    expect(await screen.findByText(/conditions.endpointLockStale/)).toBeTruthy()
  })

  it('添加对比组 opens the wizard — choosing a model IS minting a comparison group', async () => {
    // A single-group experiment: the one that has nothing to compare, and the
    // one ui-spec §五 v2 puts the invitation on.
    const h = makeHarness({
      review: { ...REVIEW, digest: { ...REVIEW.digest!, conditions: ['dsh-exec'] } },
    })
    renderView(h)
    await openPage(h, 'page.design')
    expect(await screen.findByText('design.single')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'design.addGroup' }))
    // The wizard, not a second form: minting a group and writing the plan that
    // uses it is ONE write, and a form here would be a second way to make it.
    expect(await screen.findByText('new.title')).toBeTruthy()
  })

  it('a refused listing names the cause and the fix, with the raw text folded away', async () => {
    const h = makeHarness()
    h.fetchConditions.mockResolvedValue({ ok: false, error: { code: 'REFUSED', message: 'no eval state root: set DSH_HOME — experiments and the condition library live under $DSH_HOME/state/eval' } })
    renderView(h)
    await openPage(h, 'page.design')
    // Three parts, not the exception: what happened, how to fix it, and the
    // host's own sentence under «详情».
    expect(await screen.findByText('error.noStateRoot')).toBeTruthy()
    expect(screen.getByText('error.noStateRoot.fix')).toBeTruthy()
    expect(screen.getByText('conditions.error')).toBeTruthy()
    expect(screen.getByText('no eval state root: set DSH_HOME — experiments and the condition library live under $DSH_HOME/state/eval')).toBeTruthy()
  })
})

describe('the design page asks its question and edits its numbers in place (T74)', () => {
  const ASKED: EvalPlanReview = {
    ...REVIEW,
    digest: {
      ...REVIEW.digest!,
      question: { question: 'does effort high beat medium?', expectation: 'high wins', answeredWhen: 'a pair ranks' },
    },
  }

  it('⓪ 要回答的问题 shows the three fields verbatim, and a plan with none shows no block', async () => {
    const h = makeHarness({ review: ASKED })
    renderView(h)
    await openPage(h, 'page.design')
    expect(await screen.findByText('design.question')).toBeTruthy()
    expect(screen.getByText('does effort high beat medium?')).toBeTruthy()
    expect(screen.getByText('high wins')).toBeTruthy()
    expect(screen.getByText('a pair ranks')).toBeTruthy()
    cleanup()

    const old = makeHarness()
    renderView(old)
    await openPage(old, 'page.design')
    await screen.findByText('design.numbers.hint')
    expect(screen.queryByText('design.question')).toBeNull()
  })

  it('changing 次数 calls the numbers verb with ONLY that number and shows the receipt', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.design')
    // T83: 次数 is v5's 1 / 3 / 5 seg — one click writes it.
    const reps = await screen.findByRole('radiogroup', { name: 'design.scale.reps' })
    fireEvent.click(within(reps).getByRole('radio', { name: '3' }))
    await waitFor(() => { expect(h.setPlanNumbers).toHaveBeenCalledWith('s1', { experimentId: EXPERIMENT_ID, reps: 3 }) })
    expect(await screen.findByText(/design\.numbers\.written .*design\.numbers\.reps 2 → 3/)).toBeTruthy()
  })

  it('a refusal is said on the page and nothing else moves', async () => {
    const h = makeHarness()
    h.setPlanNumbers.mockResolvedValue({ ok: false, error: { code: 'EVAL_PLAN_FROZEN', message: 'the plan is frozen' } })
    renderView(h)
    await openPage(h, 'page.design')
    const reps = await screen.findByRole('radiogroup', { name: 'design.scale.reps' })
    fireEvent.click(within(reps).getByRole('radio', { name: '5' }))
    expect(await screen.findByText(/the plan is frozen/)).toBeTruthy()
  })

  it('a started experiment shows the numbers read-only, with the reason', async () => {
    const h = makeHarness()
    h.fetchExperiments.mockResolvedValue({
      ok: true,
      value: { ...LIST, rows: [{ ...(LIST.rows[0] as EvalExperimentsResult['rows'][number]), id: 'run-20260914-zz', runId: 'run-20260914-zz', status: 'running' }] },
    })
    renderView(h)
    await openPage(h, 'page.design')
    expect(await screen.findByText('design.numbers.frozen')).toBeTruthy()
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(screen.queryByRole('button', { name: 'design.numbers.save' })).toBeNull()
  })

  it('the list row carries the question on its own line, only when there is one', async () => {
    const h = makeHarness()
    h.fetchExperiments.mockResolvedValue({
      ok: true,
      value: { ...LIST, rows: [{ ...(LIST.rows[0] as EvalExperimentsResult['rows'][number]), question: 'does effort high beat medium?' }] },
    })
    renderView(h)
    const line = await screen.findByText('does effort high beat medium?')
    expect(line.getAttribute('title')).toBe('does effort high beat medium?')
  })
})

describe('用哪些题 and 规模与花费 read the pinned dataset and past answers (T83 · phase 4)', () => {
  const FACTS: EvalPlanReview = {
    ...REVIEW,
    items: {
      items: [
        {
          id: 'p0-001', title: 'count files by extension', level: 'P0', stages: 2, container: true,
          criteria: { total: 13, objective: 8, judge: 4, human: 1 }, probes: 0, fullScore: 100,
          task: '# P0 task\n\ncount the files', taskPath: 'task.md',
        },
        {
          id: 'p0-002', title: null, level: null, stages: 0, container: false,
          criteria: null, probes: 2, fullScore: null, task: null, taskPath: null,
        },
      ],
      notes: ['item p0-002 ships no rubric in its grading layer'],
    },
    estimate: {
      perRep: { activeMs: 270_000, outputTokens: 28_050 },
      // Only p0-001 was answered before: the sum is a floor over it (T83 ruling).
      covered: { activeMs: ['p0-001'], outputTokens: ['p0-001'] },
      items: ['p0-001', 'p0-002'],
      samples: [
        { runId: 'r1', condition: 'dsh-exec', task: 'p0-001', activeMs: 254_000, outputTokens: 25_100 },
        { runId: 'r1', condition: 'codex-exec', task: 'p0-001', activeMs: 274_000, outputTokens: 31_000 },
      ],
    },
  }

  it('each item says what it tests, how it is judged, its full score, and opens its task text', async () => {
    const h = makeHarness({ review: FACTS })
    renderView(h)
    await openPage(h, 'page.design')
    expect(await screen.findByText('count files by extension')).toBeTruthy()
    expect(screen.getByText('design.itemsCol.what')).toBeTruthy()
    expect(screen.getByText('P0 · design.item.stages {"n":2} · design.item.container')).toBeTruthy()
    const how = screen.getByTitle('design.item.kinds {"objective":8,"judge":4,"human":1}')
    expect(how.textContent).toBe('design.item.criteria {"n":13} · design.item.human {"n":1} · design.item.noProbes')
    // Objective criteria and no script to judge them: v5's warning.
    expect(screen.getByText('design.item.noProbes').className).toMatch(/warnInk/)
    expect(screen.getByText(/design\.item\.noRubric/).parentElement?.textContent).toBe('design.item.noRubric · design.item.probes {"n":2}')
    expect(screen.getByText('100')).toBeTruthy()
    expect(screen.getByText(/item p0-002 ships no rubric/)).toBeTruthy()
    // Only the item with a task text offers one.
    const open = screen.getAllByRole('button', { name: 'design.item.task' })
    expect(open).toHaveLength(1)
    fireEvent.click(open[0] as HTMLElement)
    expect(await screen.findByText('count the files')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'design.item.taskClose' }))
    expect(screen.queryByText('count the files')).toBeNull()
  })

  it('the estimate is one rep scaled by 每组次数, with the answers it came from', async () => {
    const both = ['p0-001', 'p0-002']
    const h = makeHarness({
      review: { ...FACTS, estimate: { ...FACTS.estimate, covered: { activeMs: both, outputTokens: both }, items: both } },
    })
    renderView(h)
    await openPage(h, 'page.design')
    // reps 2: 4.5 min × 2 → 9 min; 28 050 × 2 → 56.1k.
    expect(await screen.findByText('design.scale.approxMinutes {"m":9}')).toBeTruthy()
    expect(screen.getByText('design.scale.approx {"value":"56.1k"}')).toBeTruthy()
    const note = screen.getByText(/^design\.scale\.fromDetail/)
    expect(note.textContent).toContain('design.scale.fromMany')
    expect(note.textContent).toMatch(/dur\.ms .*"m\\*":4,\\*"s\\*":14.* \/ dur\.ms .*"s\\*":34/)
    expect(note.textContent).toContain('25.1k / 31k')
    expect(screen.queryByText('design.scale.none')).toBeNull()
  })

  it('a partial coverage is a floor over the answered items and names the rest — never extrapolated', async () => {
    const h = makeHarness({ review: FACTS })
    renderView(h)
    await openPage(h, 'page.design')
    // The same numbers as the full case, but «≥»: p0-002 is not in the sum.
    expect(await screen.findByText('design.scale.atLeastMinutes {"m":9}')).toBeTruthy()
    expect(screen.getByText('design.scale.atLeast {"value":"56.1k"}')).toBeTruthy()
    expect(screen.queryByText(/^design\.scale\.approx/)).toBeNull()
    const note = screen.getByText(/^design\.scale\.partial /)
    expect(note.textContent).toContain('design.scale.coveredItem')
    expect(note.textContent).toMatch(/p0-001.*"n\\*":2/)
    expect(note.textContent).toContain('"missing":"p0-002"')
  })

  it('no past answers is 无估算, and no items face keeps the two columns the digest can fill', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.design')
    expect(await screen.findAllByText('design.scale.none')).toHaveLength(2)
    expect(screen.getByText('design.scale.noneNote')).toBeTruthy()
    expect(screen.queryByText('design.itemsCol.what')).toBeNull()
    expect(screen.getAllByText('p0-001').length).toBeGreaterThan(0)
  })
})

describe('after 批准并启动, the detail waits for the run itself (I5·T39 · G11)', () => {
  afterEach(() => { vi.useRealTimers() })

  it('the run-scoped sub-pages say 正在启动, never 未开始', async () => {
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.design')
    fireEvent.click(await screen.findByRole('button', { name: 'cta.pending' }))
    await waitFor(() => { expect(h.approvePlan).toHaveBeenCalled() })

    fireEvent.click(screen.getByRole('button', { name: 'page.runs' }))
    // An approved run EXISTS — the receipt named it — so the 未开始 sentence
    // the pages used to show was false as well as unhelpful.
    expect(await screen.findByText('draft.starting')).toBeTruthy()
    // The T63 empty seat, with the other sentence: 还没启动 would be false about
    // a run the approval receipt already named.
    expect(screen.queryByText('draft.notStarted')).toBeNull()
  })

  it('re-reads the list on its own until the ledger has the run, then stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.design')
    fireEvent.click(await screen.findByRole('button', { name: 'cta.pending' }))
    await waitFor(() => { expect(h.approvePlan).toHaveBeenCalled() })
    const afterApproval = h.fetchExperiments.mock.calls.length

    // The wait: the row still has no run id, so the page asks again by itself
    // — this is the Refresh press the walkthrough had to make.
    await vi.advanceTimersByTimeAsync(START_FOLLOWUP_MS + 50)
    await waitFor(() => { expect(h.fetchExperiments.mock.calls.length).toBeGreaterThan(afterApproval) })

    // `runCreate` lands: the list now carries the run, and the wait ends.
    h.fetchExperiments.mockResolvedValue({
      ok: true,
      value: { ...LIST, rows: [{ ...(LIST.rows[0] as EvalExperimentsResult['rows'][number]), id: 'run-20260914-zz', runId: 'run-20260914-zz', status: 'running' }] },
    })
    await vi.advanceTimersByTimeAsync(START_FOLLOWUP_MS + 50)
    await waitFor(() => { expect(screen.queryByText('draft.starting')).toBeNull() })
    const settled = h.fetchExperiments.mock.calls.length
    await vi.advanceTimersByTimeAsync(START_FOLLOWUP_MS * 3)
    expect(h.fetchExperiments.mock.calls.length).toBe(settled)
  })

  it('gives up after a bounded wait — a refused run never reaches the ledger', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const h = makeHarness()
    renderView(h)
    await openPage(h, 'page.design')
    fireEvent.click(await screen.findByRole('button', { name: 'cta.pending' }))
    await waitFor(() => { expect(h.approvePlan).toHaveBeenCalled() })

    await vi.advanceTimersByTimeAsync(START_FOLLOWUP_MS * (START_FOLLOWUP_LIMIT + 4))
    const stopped = h.fetchExperiments.mock.calls.length
    await vi.advanceTimersByTimeAsync(START_FOLLOWUP_MS * 5)
    expect(h.fetchExperiments.mock.calls.length).toBe(stopped)
  })
})

describe('the readiness checklist (T72 §4)', () => {
  const CHECKLIST: EvalPlanReview = {
    ...REVIEW,
    ok: false,
    errors: 1,
    checks: [
      { severity: 'error', code: 'LOCK_MISSING', message: 'condition codex-exec has no lock', condition: 'codex-exec' },
      { severity: 'warn', code: 'DATASET_ROOT_UNRESOLVABLE', message: 'dataset root not found' },
      // A warning on a condition that is NOT ready is a blocker: the
      // readiness gate refuses the start over it.
      { severity: 'warn', code: 'HOME_SHA_DECLARED_STALE', message: 'declared sha is stale', condition: 'codex-exec' },
      { severity: 'warn', code: 'SOMETHING_NEW', message: 'a code this build has no sentence for' },
      { severity: 'ok', code: 'CONDITION_READY', message: 'condition dsh-exec is ready' },
    ],
  }

  it('splits the lines into blockers and reminders, numbered across both, one fix each', async () => {
    const h = makeHarness({ review: CHECKLIST })
    renderView(h)
    await openPage(h, 'page.design')

    expect(await screen.findByText('readiness.blockers {"count":2}')).toBeTruthy()
    // The dataset's warning sits under the dataset's row (T84 §三); only the
    // one no row owns stays in 提醒.
    expect(screen.getByText('readiness.reminders {"count":1}')).toBeTruthy()
    expect(screen.getByTitle(/^DATASET_ROOT_UNRESOLVABLE · /).closest('table')).not.toBeNull()
    expect(screen.getByTitle(/^SOMETHING_NEW · /).closest('table')).toBeNull()
    expect(screen.getByText('readiness.LOCK_MISSING {"condition":"codex-exec"}')).toBeTruthy()
    // An unknown code falls back to validate's own words, never a blank line.
    expect(screen.getByText('a code this build has no sentence for')).toBeTruthy()
    // The code → button table: provision / 让 agent 处理 (no binding since T73).
    expect(screen.getAllByRole('button', { name: 'fix.provision {"condition":"codex-exec"}' }).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByRole('button', { name: 'fix.agent' }).length).toBeGreaterThanOrEqual(1)
  })

  it('shows only while the plan is still to start: a stalled row says it is for the re-run, a judging row has none', async () => {
    const withStatus = (status: EvalExperimentsResult['rows'][number]['status']) => async (): Promise<Result<EvalExperimentsResult>> => (
      { ok: true, value: { ...LIST, rows: [{ ...LIST.rows[0]!, status }] } }
    )
    const stalled = makeHarness({ review: CHECKLIST })
    stalled.fetchExperiments = vi.fn(withStatus('stalled'))
    const view = renderView(stalled)
    await openPage(stalled, 'page.design')
    expect(await screen.findByText('readiness.forRerun')).toBeTruthy()
    expect(screen.getByText('readiness.blockers {"count":2}')).toBeTruthy()
    view.unmount()

    const judging = makeHarness({ review: CHECKLIST })
    judging.fetchExperiments = vi.fn(withStatus('judging'))
    renderView(judging)
    await openPage(judging, 'page.design')
    // The review did render (its passing lines are there); only the checklist is not.
    expect(await screen.findByText('review.checks')).toBeTruthy()
    expect(screen.queryByText('readiness.blockers {"count":2}')).toBeNull()
    expect(screen.queryByText('readiness.forRerun')).toBeNull()
  })

  it('provision runs the condition verb, and nothing offers a binding', async () => {
    const h = makeHarness({ review: CHECKLIST })
    renderView(h)
    await openPage(h, 'page.design')

    const [provision] = await screen.findAllByRole('button', { name: 'fix.provision {"condition":"codex-exec"}' })
    fireEvent.click(provision!)
    await waitFor(() => {
      expect(h.provisionCondition).toHaveBeenCalledWith('s1', { condition: 'codex-exec' })
    })
    expect(screen.queryByRole('button', { name: 'fix.bind' })).toBeNull()
  })

  it('让 agent 处理 pre-fills the composer and never sends; without one it copies and says so', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const h = makeHarness({ review: CHECKLIST, composer: false })
    renderView(h)
    await openPage(h, 'page.design')

    const buttons = await screen.findAllByRole('button', { name: 'fix.agent' })
    fireEvent.click(buttons[buttons.length - 1]!)
    const sentence = 'readiness.agentAsk {"name":"effort-sweep","k":4,"text":"a code this build has no sentence for"}'
    expect(h.insertDraft).toHaveBeenCalledWith('s1', sentence)
    await waitFor(() => { expect(writeText).toHaveBeenCalledWith(sentence) })
    expect(await screen.findByText(/^agent\.copied/)).toBeTruthy()
    expect(h.approvePlan).not.toHaveBeenCalled()
  })
})
