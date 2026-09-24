// @vitest-environment jsdom
/**
 * The 新建实验 form (I5·T34) — ui-spec §五's one list action, rendered through
 * the whole LabView so the thing under test is what a person actually does:
 * press 新建实验, fill it in, save, and land on the plan-review page.
 *
 * Three promises are pinned:
 *
 * 1. The pickers are filled from what the REPOSITORY holds — the sets, their
 *    items, their stage schemas, and the condition registry — never from a
 *    free-text field that lets a person invent an item id.
 * 2. 保存草稿并 validate lands on 计划审阅. 启动不在这张表单上: the form has no
 *    approve verb at all, and the button that starts a run is on the page it
 *    hands the reader to.
 * 3. 新建条件 sends a COPY: an id, the condition it was copied from, and only
 *    the fields that were typed into.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  EvalConditionsView, EvalDraftOptionsView, EvalDraftResult, EvalExperimentsResult, EvalPlanReview,
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

const EXPERIMENT_ID = 'i5-walk-20260924-9f3e'
const PLAN_PATH = `/state/eval/experiments/${EXPERIMENT_ID}/plan.json`
const COMMIT = 'c0ffee'.padEnd(40, '0')

const OPTIONS: EvalDraftOptionsView = {
  datasets: [{ id: 'reg/ds', commit: COMMIT, items: ['P0', 'P1'], stages: ['stage1', 'stage2'] }],
  notes: [],
}

const CONDITIONS: EvalConditionsView = {
  rows: [
    {
      id: 'dsh-exec', harness: 'dsh', drive: 'exec', model: 'deepseek-v4-flash',
      scope: null, preset: null, sha: 'a'.repeat(64),
      lock: { present: true, matches: true, homeSha: 'b'.repeat(64), cliVersion: '0.1.5', provisionedAt: null },
      status: 'ready', unresolved: [], problems: [],
    },
  ],
  notes: [],
} as unknown as EvalConditionsView

const REVIEW: EvalPlanReview = {
  planPath: PLAN_PATH,
  schema: 'dataseek.plan/1',
  ok: true,
  errors: 0,
  warnings: 1,
  digest: null,
  checks: [{ severity: 'ok', code: 'CONDITION_READY', message: 'dsh-exec resolved' }],
  conditions: [],
}

const DRAFTED: EvalDraftResult = {
  experimentId: EXPERIMENT_ID,
  dataset: { registry: 'reg', set: 'ds', commit: COMMIT },
  planPath: PLAN_PATH,
  conditionPaths: [],
  conditions: ['dsh-exec'],
  judges: [],
  review: REVIEW,
}

/** The list BEFORE the draft, and the list after — the row appears on refresh. */
const EMPTY_LIST: EvalExperimentsResult = { rows: [], notes: [], session: 's1' }
const WITH_DRAFT: EvalExperimentsResult = {
  ...EMPTY_LIST,
  rows: [{
    id: `experiment:${EXPERIMENT_ID}`,
    experimentId: EXPERIMENT_ID,
    legacy: false,
    name: 'i5-walk',
    planPath: PLAN_PATH,
    runId: null,
    status: 'pending-approval',
    statusDetail: null,
    snapshot: { registry: 'reg', datasetId: 'ds', commit: COMMIT },
    conditions: ['dsh-exec'],
    judges: [],
    items: 1,
    reps: 1,
    factors: [],
    progress: null,
    startedAt: null,
    validation: { ok: true, errors: 0, warnings: 1 },
    originSession: 's1',
    archived: false,
    closure: null,
    lastProgressAt: null,
    stalledMinutes: null,
    unit: null,
  }],
}

function makeHarness(draft?: () => Promise<Result<EvalDraftResult>>) {
  const instance = createLabViewStore().create()
  // The list answers EMPTY first and carries the new row from the second call
  // on — which is the real sequence: the file lands, the list is asked again,
  // and only then does the row exist client-side.
  let listCalls = 0
  return {
    instance,
    fetchExperiments: vi.fn(async (): Promise<Result<EvalExperimentsResult>> => {
      listCalls += 1
      return { ok: true, value: listCalls === 1 ? EMPTY_LIST : WITH_DRAFT }
    }),
    fetchExperiment: vi.fn(async () => ({ ok: false as const, error: { code: 'X', message: 'no run' } })),
    fetchPlanReview: vi.fn(async (): Promise<Result<EvalPlanReview>> => ({ ok: true, value: REVIEW })),
    fetchConditions: vi.fn(async (): Promise<Result<EvalConditionsView>> => ({ ok: true, value: CONDITIONS })),
    fetchConditionDiff: vi.fn(async () => ({ ok: false as const, error: { code: 'X', message: 'no diff' } })),
    fetchDraftOptions: vi.fn(async (): Promise<Result<EvalDraftOptionsView>> => ({ ok: true, value: OPTIONS })),
    draftExperiment: vi.fn(draft ?? (async (): Promise<Result<EvalDraftResult>> => ({ ok: true, value: DRAFTED }))),
    approvePlan: vi.fn(async () => ({ ok: false as const, error: { code: 'X', message: 'not in this spec' } })),
    fetchRunOutput: vi.fn(async () => ({ ok: false as const, error: { code: 'X', message: 'not in this spec' } })),
  }
}

type Harness = ReturnType<typeof makeHarness>

function renderView(h: Harness) {
  return render(<LabView {...({
    sessionId: 's1' as SessionId,
    useStore: hookOf(h.instance),
    actions: h.instance.actions,
    fetchExperiments: h.fetchExperiments,
    fetchExperiment: h.fetchExperiment,
    fetchPlanReview: h.fetchPlanReview,
    fetchConditions: h.fetchConditions,
    fetchConditionDiff: h.fetchConditionDiff,
    fetchDraftOptions: h.fetchDraftOptions,
    draftExperiment: h.draftExperiment,
    approvePlan: h.approvePlan,
    fetchRunOutput: h.fetchRunOutput,
    t: (key: string, params?: Record<string, unknown>) => (
      params === undefined ? key : `${key} ${JSON.stringify(params)}`
    ),
  } as unknown as LabViewProps)} />)
}

/** Open the form and wait for its pickers to be filled. */
async function openForm(h: Harness): Promise<void> {
  renderView(h)
  await screen.findByRole('button', { name: 'list.new' })
  fireEvent.click(screen.getByRole('button', { name: 'list.new' }))
  await waitFor(() => { expect(h.fetchDraftOptions).toHaveBeenCalled() })
  await screen.findByText('P0')
}

/** The four steps are the wizard's whole shape; this is step ①'s own gate. */

/** Fill the minimum a draft needs: a name, a set, an item, a condition, a stage. */
/** Walk the wizard's four steps, answering each with the least it accepts. */
function fillMinimum(): void {
  // ① dataset and items
  fireEvent.change(screen.getByLabelText('new.name'), { target: { value: 'i5-walk' } })
  fireEvent.change(screen.getByLabelText('new.dataset'), { target: { value: 'reg/ds' } })
  fireEvent.click(screen.getByText('P0').previousSibling as Element)
  next()
  // ② comparison groups
  fireEvent.click(screen.getByText('dsh-exec · dsh / deepseek-v4-flash').previousSibling as Element)
  next()
  // ③ judges, reps and stages
  fireEvent.click(screen.getByText('stage1').previousSibling as Element)
  next()
  // ④ environment and confirm — every field has a default (ui-spec §五 v2)
}

/** Press 下一步. */
function next(): void {
  fireEvent.click(screen.getByRole('button', { name: 'new.next' }))
}

afterEach(() => { cleanup() })

describe('the 新建实验 form', () => {
  it('asks four steps in order, and each one is filled from what the repository holds', async () => {
    const h = makeHarness()
    await openForm(h)

    // ① The items are the SET's — a person cannot invent an item id here,
    // which is the whole reason these are pickers rather than text fields.
    expect(screen.getByText('new.step {"step":1}')).toBeTruthy()
    expect(screen.getByText('P1')).toBeTruthy()
    // …and the step will not be left until it has what it needs.
    expect(screen.getByRole('button', { name: 'new.next' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('new.name'), { target: { value: 'i5-walk' } })
    fireEvent.change(screen.getByLabelText('new.dataset'), { target: { value: 'reg/ds' } })
    fireEvent.click(screen.getByText('P0').previousSibling as Element)
    next()

    // ② the comparison groups, from the registry.
    expect(screen.getByText('new.step {"step":2}')).toBeTruthy()
    expect(screen.getByText('dsh-exec · dsh / deepseek-v4-flash')).toBeTruthy()
    expect(h.fetchConditions).toHaveBeenCalledWith('s1', {})
    fireEvent.click(screen.getByText('dsh-exec · dsh / deepseek-v4-flash').previousSibling as Element)
    next()

    // ③ judges, reps, stages and the per-cell budget.
    expect(screen.getByText('new.step {"step":3}')).toBeTruthy()
    expect(screen.getByText('stage2')).toBeTruthy()

    // Back never discards: the answers live above the steps.
    fireEvent.click(screen.getByRole('button', { name: 'new.back' }))
    expect(screen.getByText('new.step {"step":2}')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'new.back' }))
    expect((screen.getByLabelText('new.name') as HTMLInputElement).value).toBe('i5-walk')
  })

  it('sends ui-spec §五\'s fields and lands on the plan-review page', async () => {
    const h = makeHarness()
    await openForm(h)
    fillMinimum()

    fireEvent.click(screen.getByRole('button', { name: 'new.save' }))

    await waitFor(() => { expect(h.draftExperiment).toHaveBeenCalled() })
    expect(h.draftExperiment.mock.calls[0]?.[1]).toMatchObject({
      name: 'i5-walk', dataset: 'reg/ds', items: ['P0'], stages: ['stage1'], conditions: ['dsh-exec'],
    })
    // Step 2 hands the reader to step 3: 实验设计, where 批准并启动 is — and the
    // wizard itself has no approve verb at all.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'page.design' }).getAttribute('aria-pressed')).toBe('true')
    })
    expect(h.approvePlan).not.toHaveBeenCalled()
    // The notice names the EXPERIMENT by the row's own name.
    // The NAME, not the path: ui-spec §九 keeps absolute paths off page text,
    // and the plan file is named under «详情» on the page this lands on.
    expect(screen.getByText('notice.drafted {"name":"i5-walk"}')).toBeTruthy()
  })

  it('reports a draft validate rejected rather than hiding it — it is still a draft', async () => {
    const h = makeHarness(async () => ({
      ok: true,
      value: { ...DRAFTED, review: { ...REVIEW, ok: false, errors: 2 } },
    }))
    await openForm(h)
    fillMinimum()

    fireEvent.click(screen.getByRole('button', { name: 'new.save' }))

    await waitFor(() => { expect(screen.getByText(/notice\.draftedWithErrors/)).toBeTruthy() })
  })

  it('shows a refusal in the dialog and writes nothing', async () => {
    const h = makeHarness(async () => ({ ok: false, error: { code: 'X', message: 'plan "i5-walk" already exists' } }))
    await openForm(h)
    fillMinimum()

    fireEvent.click(screen.getByRole('button', { name: 'new.save' }))

    expect(await screen.findByText(/already exists/)).toBeTruthy()
    // Still on the last step with the wizard open, so the person can walk back
    // and change the name rather than losing everything they typed.
    expect(screen.getByText('new.step {"step":4}')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'new.back' }))
    fireEvent.click(screen.getByRole('button', { name: 'new.back' }))
    fireEvent.click(screen.getByRole('button', { name: 'new.back' }))
    expect((screen.getByLabelText('new.name') as HTMLInputElement).value).toBe('i5-walk')
  })

  it('新建条件 sends a COPY: the source, and only the fields typed into', async () => {
    const h = makeHarness()
    await openForm(h)
    // Minting lives on step ②, so the walk stops there, mints, and goes on.
    fireEvent.change(screen.getByLabelText('new.name'), { target: { value: 'i5-walk' } })
    fireEvent.change(screen.getByLabelText('new.dataset'), { target: { value: 'reg/ds' } })
    fireEvent.click(screen.getByText('P0').previousSibling as Element)
    next()
    fireEvent.click(screen.getByText('dsh-exec · dsh / deepseek-v4-flash').previousSibling as Element)
    fireEvent.click(screen.getByRole('button', { name: 'new.mintOpen' }))
    fireEvent.change(screen.getByLabelText('new.mintId'), { target: { value: 'dsh-exec-pro' } })
    fireEvent.change(screen.getByLabelText('new.mintFrom'), { target: { value: 'dsh-exec' } })
    fireEvent.change(screen.getByLabelText('new.mint.model'), { target: { value: 'deepseek-v4-pro' } })

    // One field changed is a single-factor pair, and the form says so before
    // the person saves.
    expect(screen.getByText(/new\.mintOneFactor/)).toBeTruthy()
    next()
    fireEvent.click(screen.getByText('stage1').previousSibling as Element)
    next()
    fireEvent.click(screen.getByRole('button', { name: 'new.save' }))

    await waitFor(() => { expect(h.draftExperiment).toHaveBeenCalled() })
    expect(h.draftExperiment.mock.calls[0]?.[1]).toMatchObject({
      newConditions: [{ id: 'dsh-exec-pro', from: 'dsh-exec', model: 'deepseek-v4-pro' }],
    })
    // The five boxes left empty are "leave it as the copy has it", never
    // "set it to empty".
    const mint = (h.draftExperiment.mock.calls[0]?.[1] as { newConditions: Array<Record<string, unknown>> }).newConditions[0]
    expect(Object.keys(mint as object).sort()).toEqual(['from', 'id', 'model'])
  })

  it('will not save until a name, a set, an item, a stage and a comparison group are all chosen', async () => {
    const h = makeHarness()
    await openForm(h)
    // The wizard gates step by step, so «cannot save yet» is «cannot get to
    // the last step yet»: 保存草稿并 validate does not exist until then.
    expect(screen.queryByRole('button', { name: 'new.save' })).toBeNull()
    expect(screen.getByRole('button', { name: 'new.next' }).hasAttribute('disabled')).toBe(true)
    fillMinimum()
    expect(screen.getByRole('button', { name: 'new.save' }).hasAttribute('disabled')).toBe(false)
  })
})
