// @vitest-environment jsdom
/**
 * I5·T37 — the judge bench sub-page: the blind queue, the de-fingerprinted
 * artifacts, the criteria table with every llm-draft sample beside the input,
 * and the one human write.
 *
 * The assertions are about what a grader is allowed to SEE and what the page
 * is allowed to SEND. The rendered DOM is searched for every harness and
 * model name the run used — the same check the host-side spec makes against
 * the payload, made again here because a page can compose a fingerprint the
 * payload never carried (a title built from a ticket, a debug attribute). And
 * the write is checked for the two things the ledger depends on: only
 * answered criteria travel, and the queue is re-read afterwards, because the
 * cell has just moved groups and the agreement numbers have just changed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  EvalExperimentDetail, EvalExperimentsResult, EvalHumanFinalResult, EvalJudgeQueueView,
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
  status: 'judging',
  statusDetail: null,
  snapshot: { repo: '/repo', datasetId: 'harness-comparison', commit: 'c0ffee1' },
  conditions: ['codex-exec', 'dsh-exec'],
  judges: ['judge-alpha'],
  items: 1,
  reps: 1,
  factors: ['model.declared'],
  progress: { done: 2, total: 2 },
  startedAt: 1,
  validation: null,
  unit: null,
}

const LIST: EvalExperimentsResult = { repo: '/repo', datasets: ['harness-comparison'], notes: [], rows: [ROW] }

const DETAIL: EvalExperimentDetail = {
  row: ROW, meta: null, readiness: [], buckets: { done: 2 }, states: { archived: 2 }, unreleased: [], job: null,
}

/**
 * The queue as the host sends it: two cells, one already graded. Nothing in
 * this payload names a condition, a harness or a model — that is the host's
 * contract, and this fixture is written to honour it so the DOM assertions
 * below test the PAGE rather than the fixture.
 */
const QUEUE: EvalJudgeQueueView = {
  runId: 'run-1',
  judgeCount: 2,
  notes: [],
  consistency: {
    multiSampled: 1,
    llmAgreement: { agreed: 0, total: 1 },
    llmKappa: 0.25,
    humanAgreement: null,
    crossJudged: 1,
    crossAgreement: { agreed: 1, total: 1 },
    crossKappa: null,
    selfJudgedCriteria: 1,
    details: [],
  },
  cells: [
    {
      ticket: 'aaaa0000bbbb1111',
      cellNo: 1,
      task: 'P0',
      rep: 1,
      state: 'archived',
      bucket: 'done',
      attempt: 1,
      materials: [
        { path: 'stage1.md', text: '# 方案\n\n我是 <harness>，用 <model> 跑的。', replacements: 2 },
        { path: 'stage2.md', text: '# 报告\n\n结论段在这里。', replacements: 0 },
      ],
      criteria: [
        {
          id: 'H1', criterion: '报告读起来像给同事看的', evidence: '通读 stage2.md 的结论段',
          weight: 2, negative: false, veto: false, note: null,
        },
        {
          id: 'H2', criterion: '把协议知识推给用户', evidence: null,
          weight: null, negative: true, veto: true, note: '成立即缺陷存在',
        },
      ],
      criteriaNote: null,
      drafts: [
        { judge: '判官 A', sample: 1, criterion: 'H1', pass: true, evidence: '读着顺', selfJudged: true },
        { judge: '判官 B', sample: 1, criterion: 'H1', pass: false, evidence: '太像机器写的', selfJudged: false },
      ],
      humanFinal: [],
      graded: false,
      draftOnlyCriteria: ['H1'],
    },
    {
      ticket: 'cccc2222dddd3333',
      cellNo: 2,
      task: 'P0',
      rep: 1,
      state: 'archived',
      bucket: 'done',
      attempt: 1,
      materials: [{ path: 'stage1.md', text: '# 方案二', replacements: 0 }],
      criteria: [{ id: 'H1', criterion: '报告读起来像给同事看的', evidence: null, weight: null, negative: false, veto: false, note: null }],
      criteriaNote: null,
      drafts: [],
      humanFinal: [{ criterion: 'H1', pass: true, evidence: '之前已经判过', at: 99, by: 'tab:s1' }],
      graded: true,
      draftOnlyCriteria: [],
    },
  ],
}

const WRITTEN: EvalHumanFinalResult = {
  runId: 'run-1',
  ticket: 'aaaa0000bbbb1111',
  missionId: 'p0-codex-exec-rep1',
  written: 1,
  added: true,
  by: 'tab:s1',
  duplicate: false,
}

function makeHarness(queue: EvalJudgeQueueView = QUEUE, written: EvalHumanFinalResult = WRITTEN) {
  const instance = createLabViewStore().create()
  return {
    instance,
    actions: instance.actions,
    fetchExperiments: vi.fn(async (): Promise<Result<EvalExperimentsResult>> => ({ ok: true, value: LIST })),
    fetchExperiment: vi.fn(async (): Promise<Result<EvalExperimentDetail>> => ({ ok: true, value: DETAIL })),
    fetchJudgeQueue: vi.fn(async (): Promise<Result<EvalJudgeQueueView>> => ({ ok: true, value: queue })),
    submitHumanFinal: vi.fn(async (): Promise<Result<EvalHumanFinalResult>> => ({ ok: true, value: written })),
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
    fetchJudgeQueue: h.fetchJudgeQueue,
    submitHumanFinal: h.submitHumanFinal,
    openSession: vi.fn(),
    t: (key: string, params?: Record<string, unknown>) => (
      params === undefined ? key : `${key} ${JSON.stringify(params)}`
    ),
  } as unknown as LabViewProps
  return render(<LabView {...props} />)
}

/** Open the run, then its judging page. */
async function openBench(h: Harness) {
  const view = renderView(h)
  fireEvent.click(await screen.findByText('t31-judge-panel'))
  fireEvent.click(screen.getByRole('button', { name: 'page.judging' }))
  await waitFor(() => { expect(h.fetchJudgeQueue).toHaveBeenCalledWith('s1', { runId: 'run-1' }) })
  return view
}

/** Open cell N from the queue. */
function pickCell(no: number) {
  fireEvent.click(screen.getByText(`judge.cell {"no":${no}}`))
}

afterEach(() => { cleanup() })

describe('the blind queue', () => {
  it('groups cells by whether they carry a verdict, and names them by ordinal', async () => {
    const h = makeHarness()
    await openBench(h)
    await screen.findByText('judge.queue')
    expect(screen.getByText('judge.ungraded {"count":1}')).toBeTruthy()
    expect(screen.getByText('judge.graded {"count":1}')).toBeTruthy()
    // The cell's whole visible name is its number.
    expect(screen.getByText('judge.cell {"no":1}')).toBeTruthy()
    expect(screen.getByText('judge.cell {"no":2}')).toBeTruthy()
  })

  it('renders no harness, model, condition or mission id anywhere in the DOM', async () => {
    const h = makeHarness()
    const view = await openBench(h)
    await screen.findByText('judge.queue')
    pickCell(1)
    const html = view.container.innerHTML
    // The run really used these; the bench is where they must not appear.
    // The report page is where the same run is read with its labels on.
    for (const fingerprint of ['codex', 'dsh-exec', 'gpt-5.6-sol', 'deepseek-v4', 'judge-alpha', 'p0-codex-exec-rep1']) {
      expect(html).not.toContain(fingerprint)
    }
    // And the page SAYS it is blind, so a grader knows the omission is on
    // purpose rather than a page that failed to load.
    expect(screen.getByText('judge.blindNotice')).toBeTruthy()
  })

  it('shows the scrubbed artifacts verbatim, with how many fingerprints were removed', async () => {
    const h = makeHarness()
    await openBench(h)
    await screen.findByText('judge.queue')
    pickCell(1)
    expect(screen.getByText('stage1.md')).toBeTruthy()
    // The tokens judge.ts leaves behind — the grader sees the redaction, not
    // a silently rewritten document.
    expect(screen.getByText(/我是 <harness>，用 <model> 跑的/)).toBeTruthy()
    expect(screen.getByText('judge.scrubbed {"count":2}')).toBeTruthy()
    expect(screen.getByText('judge.scrubbed {"count":0}')).toBeTruthy()
  })
})

describe('the criteria table', () => {
  it('puts every llm-draft sample beside the input, under its blind panel label', async () => {
    const h = makeHarness()
    await openBench(h)
    await screen.findByText('judge.queue')
    pickCell(1)
    expect(screen.getByText('判官 A')).toBeTruthy()
    expect(screen.getByText('判官 B')).toBeTruthy()
    expect(screen.getByText('读着顺')).toBeTruthy()
    expect(screen.getByText('太像机器写的')).toBeTruthy()
    // 决策 9 disclosure travels to the bench too: a grader reading a
    // self-judged draft should know that is what they are reading.
    expect(screen.getByText('judge.selfJudged')).toBeTruthy()
    // H2 has no draft, and the row says so rather than showing a blank.
    expect(screen.getByText('judge.draftsNone')).toBeTruthy()
  })

  it('marks polarity and veto, because pass always means the criterion HOLDS', async () => {
    const h = makeHarness()
    await openBench(h)
    await screen.findByText('judge.queue')
    pickCell(1)
    expect(screen.getByText('judge.negative')).toBeTruthy()
    expect(screen.getByText('judge.veto')).toBeTruthy()
    expect(screen.getByText('judge.weight {"weight":2}')).toBeTruthy()
  })

  it('warns, before the button, which criteria a first verdict would drop from the score', async () => {
    const h = makeHarness()
    await openBench(h)
    await screen.findByText('judge.queue')
    pickCell(1)
    // The report scores a cell from ONE namespace, so the first human-final
    // verdict takes the llm-draft-only criteria out of this cell's score. The
    // bench cannot change that rule; it can refuse to let it happen quietly.
    expect(screen.getByText('judge.scoringWarning {"count":1,"criteria":"H1"}')).toBeTruthy()
    // A cell with nothing to lose says nothing.
    pickCell(2)
    expect(screen.queryByText(/judge\.scoringWarning/)).toBeNull()
  })

  it('shows what a graded cell already carries, and warns that recording appends', async () => {
    const h = makeHarness()
    await openBench(h)
    await screen.findByText('judge.queue')
    pickCell(2)
    expect(screen.getByText('judge.regrade')).toBeTruthy()
    expect(screen.getByText('judge.humanFinal')).toBeTruthy()
    expect(screen.getByText('之前已经判过')).toBeTruthy()
  })
})

describe('the human-final write', () => {
  it('refuses to send until a criterion is answered WITH evidence', async () => {
    const h = makeHarness()
    await openBench(h)
    await screen.findByText('judge.queue')
    pickCell(1)
    const submit = screen.getByRole('button', { name: 'judge.submit {"count":0}' })
    expect(submit.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('judge.submitBlocked')).toBeTruthy()

    // A verdict with no evidence is still not sendable: the protocol asks for
    // a checkable fact, and the host refuses a blank one anyway.
    fireEvent.click(screen.getAllByRole('button', { name: 'judge.pass' })[0] as HTMLElement)
    expect(screen.getByRole('button', { name: 'judge.submit {"count":0}' }).hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByLabelText('judge.evidence H1'), { target: { value: '结论段是给人读的' } })
    expect(screen.getByRole('button', { name: 'judge.submit {"count":1}' }).hasAttribute('disabled')).toBe(false)
  })

  it('sends only the answered criteria, then re-reads the queue', async () => {
    const h = makeHarness()
    await openBench(h)
    await screen.findByText('judge.queue')
    pickCell(1)
    // Answer H1 only — H2 is left untouched, and an untouched criterion is
    // not a verdict of "does not hold".
    fireEvent.click(screen.getAllByRole('button', { name: 'judge.fail' })[0] as HTMLElement)
    fireEvent.change(screen.getByLabelText('judge.evidence H1'), { target: { value: '读着像给模型写的' } })
    fireEvent.click(screen.getByRole('button', { name: 'judge.submit {"count":1}' }))

    await waitFor(() => {
      expect(h.submitHumanFinal).toHaveBeenCalledWith('s1', {
        runId: 'run-1',
        ticket: 'aaaa0000bbbb1111',
        verdicts: [{ criterion: 'H1', pass: false, evidence: '读着像给模型写的' }],
      })
    })
    // The cell has just changed group and the header's numbers have just
    // moved: a bench that did not re-read would show a grader stale facts
    // about their own act.
    await waitFor(() => { expect(h.fetchJudgeQueue).toHaveBeenCalledTimes(2) })
    expect(screen.getByText('notice.humanFinal {"no":1,"count":1,"by":"tab:s1"}')).toBeTruthy()
  })

  it('says nothing was written when the ledger reports an identical repeat', async () => {
    const h = makeHarness(QUEUE, { ...WRITTEN, added: false, duplicate: true, written: 0 })
    await openBench(h)
    await screen.findByText('judge.queue')
    pickCell(1)
    fireEvent.click(screen.getAllByRole('button', { name: 'judge.pass' })[0] as HTMLElement)
    fireEvent.change(screen.getByLabelText('judge.evidence H1'), { target: { value: '同一句话' } })
    fireEvent.click(screen.getByRole('button', { name: 'judge.submit {"count":1}' }))
    expect(await screen.findByText('notice.humanFinalDuplicate {"no":1}')).toBeTruthy()
  })

  it('drops a half-written answer when the grader moves to another cell', async () => {
    const h = makeHarness()
    await openBench(h)
    await screen.findByText('judge.queue')
    pickCell(1)
    fireEvent.change(screen.getByLabelText('judge.evidence H1'), { target: { value: '写到一半' } })
    // Evidence about cell 1 must not be submittable against cell 2.
    pickCell(2)
    expect((screen.getByLabelText('judge.evidence H1') as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: 'judge.submit {"count":0}' }).hasAttribute('disabled')).toBe(true)
  })

  it('surfaces a refusal verbatim instead of pretending the verdict landed', async () => {
    const h = makeHarness()
    h.submitHumanFinal.mockResolvedValueOnce({
      ok: false, error: { code: 'EVAL_READ_REFUSED', message: '判据 H1 缺证据：终评每条都要写清依据' },
    })
    await openBench(h)
    await screen.findByText('judge.queue')
    pickCell(1)
    fireEvent.click(screen.getAllByRole('button', { name: 'judge.pass' })[0] as HTMLElement)
    fireEvent.change(screen.getByLabelText('judge.evidence H1'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'judge.submit {"count":1}' }))
    expect(await screen.findByText('判据 H1 缺证据：终评每条都要写清依据')).toBeTruthy()
  })
})

describe('the agreement header', () => {
  it('shows the run\'s live numbers, and flags self-judged criteria', async () => {
    const h = makeHarness()
    await openBench(h)
    expect(await screen.findByText('judge.stats')).toBeTruthy()
    expect(screen.getByText('report.judgeSameValue {"criteria":1,"agreement":"0/1","kappa":"0.250"}')).toBeTruthy()
    expect(screen.getByText('report.judgeCrossValue {"criteria":1,"agreement":"1/1","kappa":"—"}')).toBeTruthy()
    expect(screen.getByText('judge.panel {"count":2}')).toBeTruthy()
  })

  it('opens the queue only once per visit — the fetch effect never cancels itself', async () => {
    const h = makeHarness()
    await openBench(h)
    await screen.findByText('judge.queue')
    // The effect writes `judge` and `judgeLoading`; either in its dependency
    // list would make the answer re-trigger the request whose cleanup then
    // drops it (T47's shape in the datasets tab). One call is the proof.
    pickCell(1)
    pickCell(2)
    expect(h.fetchJudgeQueue).toHaveBeenCalledTimes(1)
  })
})
