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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  EvalExperimentDetail, EvalExperimentsResult, EvalHumanFinalResult, EvalJudgeQueueCell, EvalJudgeQueueView,
} from '../src/types.ts'
import type { LabViewProps } from '../src/client/contract.ts'
import { LabView } from '../src/client/LabView.tsx'
import { byItem, landingItem } from '../src/client/JudgingPage.tsx'
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
  originSession: 's1',
  archived: false,
  closure: null,
  lastProgressAt: null,
  stalledMinutes: null,
  unit: null,
}

const LIST: EvalExperimentsResult = { repo: '/repo', datasets: ['harness-comparison'], notes: [], rows: [ROW], session: 's1' }

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
  bundleStale: false,
  lastExportAt: 1_700_000_000_000,
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

function makeHarness(
  queue: EvalJudgeQueueView = QUEUE,
  written: EvalHumanFinalResult = WRITTEN,
  row: Partial<EvalExperimentsResult['rows'][number]> = {},
) {
  const instance = createLabViewStore().create()
  return {
    instance,
    actions: instance.actions,
    fetchExperiments: vi.fn(async (): Promise<Result<EvalExperimentsResult>> => ({
      ok: true, value: { ...LIST, rows: [{ ...ROW, ...row }] },
    })),
    closeRun: vi.fn(async () => ({
      ok: true as const,
      value: { recorded: true, refusal: null, detail: null, closure: null },
    })),
    insertDraft: vi.fn(() => true),
    fetchExperiment: vi.fn(async (): Promise<Result<EvalExperimentDetail>> => ({ ok: true, value: DETAIL })),
    fetchJudgeQueue: vi.fn(async (): Promise<Result<EvalJudgeQueueView>> => ({ ok: true, value: queue })),
    submitHumanFinal: vi.fn(async (): Promise<Result<EvalHumanFinalResult>> => ({ ok: true, value: written })),
    reexportRun: vi.fn(async () => ({
      ok: true as const,
      value: {
        bundleDir: '/out/re-20260917T142530Z/run-1-bundle', files: 9, exportedAt: 1_700_000_999_000,
        summaryPath: '/out/re-20260917T142530Z/run-1-bundle/report/summary.md',
        reportRows: 14, reportError: null, noteRecorded: true,
      },
    })),
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
    fetchJudgeQueue: h.fetchJudgeQueue,
    submitHumanFinal: h.submitHumanFinal,
    reexportRun: h.reexportRun,
    closeRun: h.closeRun,
    insertDraft: h.insertDraft,
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
  fireEvent.click(screen.getByRole('button', { name: 'page.review' }))
  await waitFor(() => { expect(h.fetchJudgeQueue).toHaveBeenCalledWith('s1', { runId: 'run-1' }) })
  return view
}

/** Open one ITEM from the queue — its answers then render side by side. */
function pickItem(task: string, count: number) {
  fireEvent.click(screen.getByText(`judge.itemCount {"task":"${task}","count":${count}}`))
}

/** The evidence box of one criterion in one answer's column. */
function evidenceOf(no: number, criterion: string) {
  return screen.getByLabelText(`judge.column {"no":${no}} judge.evidence ${criterion}`)
}

afterEach(() => { cleanup() })

describe('the blind queue', () => {
  it('queues by ITEM, and the answers to one item come up side by side', async () => {
    const h = makeHarness()
    await openBench(h)
    await screen.findByText('judge.queue')
    // One row per question, carrying how many answers it has and how many of
    // them are graded — the grader picks a question, not a cell.
    expect(screen.getByText('judge.itemCount {"task":"P0","count":2}')).toBeTruthy()
    expect(screen.getByText('judge.graded {"count":1}')).toBeTruthy()

    pickItem('P0', 2)
    // Both answers, at once, each under its own seeded ordinal — the whole of
    // a cell's visible name, and it says nothing about which arm produced it.
    expect(screen.getByText('judge.column {"no":1}')).toBeTruthy()
    expect(screen.getByText('judge.column {"no":2}')).toBeTruthy()
    expect(screen.getByText('judge.sideBySide')).toBeTruthy()
  })

  it('renders no harness, model, condition or mission id anywhere in the DOM', async () => {
    const h = makeHarness()
    const view = await openBench(h)
    await screen.findByText('judge.queue')
    pickItem('P0', 2)
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
    pickItem('P0', 2)
    // Both answers' material is on screen, each under its own column, so the
    // same file name appears once per answer — FOLDED, with the redaction
    // count still on the summary. Thousands of lines of stage json above the
    // criteria pushed the scoring boxes off the screen, which is the one thing
    // side by side exists to prevent (I5·T67 · W9).
    const heads = screen.getAllByText('stage1.md')
    expect(heads).toHaveLength(2)
    for (const head of heads) expect(head.closest('details')).not.toBeNull()
    // The tokens judge.ts leaves behind — the grader sees the redaction, not
    // a silently rewritten document.
    expect(screen.getByText(/我是 <harness>，用 <model> 跑的/)).toBeTruthy()
    expect(screen.getByText('judge.scrubbed {"count":2}')).toBeTruthy()
    // Answer 1's second file and answer 2's only file were both clean.
    expect(screen.getAllByText('judge.scrubbed {"count":0}')).toHaveLength(2)
  })
})

describe('the criteria table', () => {
  it('puts every llm-draft sample beside the input, under its blind panel label', async () => {
    const h = makeHarness()
    await openBench(h)
    await screen.findByText('judge.queue')
    pickItem('P0', 2)
    expect(screen.getByText('判官 A')).toBeTruthy()
    expect(screen.getByText('判官 B')).toBeTruthy()
    expect(screen.getByText('读着顺')).toBeTruthy()
    expect(screen.getByText('太像机器写的')).toBeTruthy()
    // Answer 2's drafts are on screen too, in their own column.
    // 决策 9 disclosure travels to the bench too: a grader reading a
    // self-judged draft should know that is what they are reading.
    expect(screen.getByText('judge.selfJudged')).toBeTruthy()
    // H2 has no draft, and the row says so rather than showing a blank.
    expect(screen.getAllByText('judge.draftsNone').length).toBeGreaterThan(0)
  })

  it('marks polarity and veto, because pass always means the criterion HOLDS', async () => {
    const h = makeHarness()
    await openBench(h)
    await screen.findByText('judge.queue')
    pickItem('P0', 2)
    // Both answers carry the same rubric, so each marker is on screen once
    // per column — the rows are per-answer forms, not one shared form.
    // H2 (negative, veto, weighted) is answer 1's criterion; answer 2's rubric
    // carries H1 alone. Each marker therefore belongs to the column whose
    // rubric declares it — the rows are per-answer forms, not one shared form.
    expect(screen.getAllByText('judge.negative')).toHaveLength(1)
    expect(screen.getAllByText('judge.veto')).toHaveLength(1)
    expect(screen.getAllByText('judge.weight {"weight":2}')).toHaveLength(1)
  })

  it('warns, before the button, which criteria a first verdict would drop from the score', async () => {
    const h = makeHarness()
    await openBench(h)
    await screen.findByText('judge.queue')
    pickItem('P0', 2)
    // The report scores a cell from ONE namespace, so the first human-final
    // verdict takes the llm-draft-only criteria out of that cell's score. The
    // bench cannot change that rule; it can refuse to let it happen quietly.
    // It is per COLUMN: answer 1 has something to lose and answer 2 does not,
    // and side by side that difference has to stay visible.
    expect(screen.getAllByText('judge.scoringMix {"count":1,"criteria":"H1"}')).toHaveLength(1)
  })

  it('shows what a graded cell already carries, and warns that recording appends', async () => {
    const h = makeHarness()
    await openBench(h)
    await screen.findByText('judge.queue')
    pickItem('P0', 2)
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
    pickItem('P0', 2)
    const submit = screen.getByRole('button', { name: 'judge.submitOne {"no":1,"count":0}' })
    expect(submit.hasAttribute('disabled')).toBe(true)
    expect(screen.getAllByText('judge.submitBlocked').length).toBe(2)

    // A verdict with no evidence is still not sendable: the protocol asks for
    // a checkable fact, and the host refuses a blank one anyway.
    fireEvent.click(screen.getAllByRole('button', { name: 'judge.pass' })[0] as HTMLElement)
    expect(screen.getByRole('button', { name: 'judge.submitOne {"no":1,"count":0}' }).hasAttribute('disabled')).toBe(true)

    fireEvent.change(evidenceOf(1, 'H1'), { target: { value: '结论段是给人读的' } })
    expect(screen.getByRole('button', { name: 'judge.submitOne {"no":1,"count":1}' }).hasAttribute('disabled')).toBe(false)
    // …and answer 2's button did not move: each column records on its own.
    expect(screen.getByRole('button', { name: 'judge.submitOne {"no":2,"count":0}' }).hasAttribute('disabled')).toBe(true)
  })

  it('sends only the answered criteria, then re-reads the queue', async () => {
    const h = makeHarness()
    await openBench(h)
    await screen.findByText('judge.queue')
    pickItem('P0', 2)
    // Answer H1 only — H2 is left untouched, and an untouched criterion is
    // not a verdict of "does not hold".
    fireEvent.click(screen.getAllByRole('button', { name: 'judge.fail' })[0] as HTMLElement)
    fireEvent.change(evidenceOf(1, 'H1'), { target: { value: '读着像给模型写的' } })
    fireEvent.click(screen.getByRole('button', { name: 'judge.submitOne {"no":1,"count":1}' }))

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
    pickItem('P0', 2)
    fireEvent.click(screen.getAllByRole('button', { name: 'judge.pass' })[0] as HTMLElement)
    fireEvent.change(evidenceOf(1, 'H1'), { target: { value: '同一句话' } })
    fireEvent.click(screen.getByRole('button', { name: 'judge.submitOne {"no":1,"count":1}' }))
    expect(await screen.findByText('notice.humanFinalDuplicate {"no":1}')).toBeTruthy()
  })

  it('keeps each column\'s half-written answer to itself, and drops them all on the next item', async () => {
    const h = makeHarness()
    await openBench(h)
    await screen.findByText('judge.queue')
    pickItem('P0', 2)
    fireEvent.change(evidenceOf(1, 'H1'), { target: { value: '写到一半' } })

    // Evidence about answer 1 must not be submittable against answer 2 — the
    // whole reason the drafts are keyed by ticket now that both are on screen.
    expect((evidenceOf(2, 'H1') as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: 'judge.submitOne {"no":2,"count":0}' }).hasAttribute('disabled')).toBe(true)

    // Leaving the question drops every column's draft: a grader must not carry
    // evidence to work they are no longer looking at. (One item in this
    // fixture, so «leaving» is picking it again — the store clears on the
    // selection, not on the id changing.)
    pickItem('P0', 2)
    expect((evidenceOf(1, 'H1') as HTMLInputElement).value).toBe('')
  })

  it('surfaces a refusal verbatim instead of pretending the verdict landed', async () => {
    const h = makeHarness()
    h.submitHumanFinal.mockResolvedValueOnce({
      ok: false, error: { code: 'EVAL_READ_REFUSED', message: '判据 H1 缺证据：终评每条都要写清依据' },
    })
    await openBench(h)
    await screen.findByText('judge.queue')
    pickItem('P0', 2)
    fireEvent.click(screen.getAllByRole('button', { name: 'judge.pass' })[0] as HTMLElement)
    fireEvent.change(evidenceOf(1, 'H1'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'judge.submitOne {"no":1,"count":1}' }))
    expect(await screen.findByText('判据 H1 缺证据：终评每条都要写清依据')).toBeTruthy()
  })
})

describe('the agreement fold (T80c P1-6)', () => {
  it('shows the run\'s live numbers, and flags self-judged criteria', async () => {
    const h = makeHarness()
    await openBench(h)
    expect(await screen.findByText('judge.stats')).toBeTruthy()
    expect(screen.getByText('judge.statsLine {"same":"0/1","cross":"1/1","human":"—"}')).toBeTruthy()
    expect(screen.getByText('judge.statsSelfLine {"count":1}')).toBeTruthy()
    expect(screen.getByText('report.judgeSameValue {"criteria":1,"agreement":"0/1","kappa":"0.250"}')).toBeTruthy()
    expect(screen.getByText('report.judgeCrossValue {"criteria":1,"agreement":"1/1","kappa":"—"}')).toBeTruthy()
    expect(screen.getByText('judge.panel {"count":2}')).toBeTruthy()
  })

  it('sits folded at the foot of the page, below the four exits', async () => {
    const h = makeHarness()
    await openBench(h)
    const title = await screen.findByText('judge.stats')
    const fold = title.closest('details') as HTMLDetailsElement
    expect(fold.open).toBe(false)
    const exits = screen.getByRole('button', { name: 'closure.exit.final' })
    expect(exits.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says 数据不足 in words when there is no pair to compare yet', async () => {
    const thin = {
      ...QUEUE,
      judgeCount: 1,
      consistency: {
        ...QUEUE.consistency, llmAgreement: null, crossAgreement: null, humanAgreement: null, selfJudgedCriteria: 0,
      },
    }
    const h = makeHarness(thin)
    await openBench(h)
    expect(await screen.findByText('judge.statsThin {"count":1}')).toBeTruthy()
    expect(screen.queryByText(/judge\.statsSelfLine/)).toBeNull()
  })

  it('opens the queue only once per visit — the fetch effect never cancels itself', async () => {
    const h = makeHarness()
    await openBench(h)
    await screen.findByText('judge.queue')
    // The effect writes `judge` and `judgeLoading`; either in its dependency
    // list would make the answer re-trigger the request whose cleanup then
    // drops it (T47's shape in the datasets tab). One call is the proof.
    pickItem('P0', 2)
    pickItem('P0', 2)
    expect(h.fetchJudgeQueue).toHaveBeenCalledTimes(1)
  })
})

describe('the bundle does not follow the verdicts written here (I5·T39 · G17)', () => {
  it('says nothing while the bundle is newer than every final verdict', async () => {
    const h = makeHarness()
    await openBench(h)
    await screen.findByText('judge.queue')
    expect(screen.queryByText('judge.bundleStale')).toBeNull()
    expect(screen.queryByRole('button', { name: 'judge.reexport' })).toBeNull()
  })

  it('offers the repeat once a final verdict is newer than the bundle', async () => {
    const h = makeHarness({ ...QUEUE, bundleStale: true })
    await openBench(h)

    // The sentence the walkthrough had to derive from manifest.json, on the
    // page that causes it, with the action beside it.
    expect(await screen.findByText('judge.bundleStale')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'judge.reexport' }))
    await waitFor(() => { expect(h.reexportRun).toHaveBeenCalledWith('s1', { runId: 'run-1' }) })
  })
})

describe('the four exits (T72 §5)', () => {
  it('① needs something graded; ③ closes at once; each lands through closeRun', async () => {
    const ungraded = { ...QUEUE, cells: QUEUE.cells.map(cell => ({ ...cell, graded: false })) }
    const h = makeHarness(ungraded)
    await openBench(h)
    const final = await screen.findByRole('button', { name: 'closure.exit.final' })
    expect(final.hasAttribute('disabled')).toBe(true)
    expect(final.getAttribute('title')).toBe('closure.finalNeedsGrade')

    fireEvent.click(screen.getByRole('button', { name: 'closure.exit.unreviewed' }))
    await waitFor(() => {
      expect(h.closeRun).toHaveBeenCalledWith('s1', { runId: 'run-1', exit: 'unreviewed', reason: null })
    })
    expect(await screen.findByText('closure.done.unreviewed')).toBeTruthy()
  })

  it('② and ④ ask for a reason first and refuse a blank one', async () => {
    const h = makeHarness()
    await openBench(h)
    fireEvent.click(await screen.findByRole('button', { name: 'closure.exit.flagged…' }))
    const confirm = screen.getByRole('button', { name: 'closure.confirm.flagged' })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('closure.reasonAsk.flagged'), { target: { value: '判官与受试同源' } })
    fireEvent.click(confirm)
    await waitFor(() => {
      expect(h.closeRun).toHaveBeenCalledWith('s1', { runId: 'run-1', exit: 'flagged', reason: '判官与受试同源' })
    })

    fireEvent.click(screen.getByRole('button', { name: 'closure.exit.void…' }))
    expect(screen.getByRole('button', { name: 'closure.confirm.void' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'closure.cancel' }))
    expect(h.closeRun).toHaveBeenCalledTimes(1)
  })

  it('a refusal is said in the browser\'s words, from the structured code', async () => {
    const h = makeHarness()
    h.closeRun.mockResolvedValue({
      ok: true, value: { recorded: false, refusal: 'already-void', detail: null, closure: null },
    })
    await openBench(h)
    fireEvent.click(await screen.findByRole('button', { name: 'closure.exit.unreviewed' }))
    expect(await screen.findByText('closure.refused.already-void')).toBeTruthy()
  })

  it('once ④ is in force the exits are gone and the reason stands', async () => {
    const h = makeHarness(QUEUE, WRITTEN, {
      status: 'void',
      closure: { exit: 'void', reason: '题面中途被改', at: '2026-09-23T08:00:00.000Z', by: null },
    })
    await openBench(h)
    expect(await screen.findByText('closure.voided {"reason":"题面中途被改"}')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'closure.exit.final' })).toBeNull()
  })

  it('names the cells the judge never reached in a reminder card, and 补判 hands them to the agent', async () => {
    const absent = { ...QUEUE, cells: QUEUE.cells.map(cell => ({ ...cell, judgeAbsent: cell.cellNo === 2 })) }
    const h = makeHarness(absent)
    await openBench(h)
    const title = await screen.findByText('judge.absent {"cells":"2","count":1}')
    const card = title.closest('[role="note"]') as HTMLElement
    expect(within(card).getByText('judge.absentBody')).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'judge.rejudge' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'judge.rejudge' }))
    expect(h.insertDraft).toHaveBeenCalledWith('s1', expect.stringMatching(/^judge\.rejudgeAsk .*"name":"t31-judge-panel"/))
  })
})

describe('landing (T80c P1-6)', () => {
  it('opens on the first item with an ungraded answer — no pick needed to start', async () => {
    const h = makeHarness()
    await openBench(h)
    expect(await screen.findByText('judge.sideBySide')).toBeTruthy()
    expect(screen.queryByText('judge.itemPick')).toBeNull()
    expect(screen.getByRole('button', { name: /judge\.itemCount \{"task":"P0"/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('skips a fully graded item for the next one that still needs a grader', () => {
    const cell = QUEUE.cells[0] as EvalJudgeQueueCell
    const items = byItem([
      { ...cell, cellNo: 1, task: 'P0', graded: true },
      { ...cell, cellNo: 2, task: 'P1', graded: false },
      { ...cell, cellNo: 3, task: 'P2', graded: false },
    ])
    expect(landingItem(items)).toBe('P1')
    expect(landingItem(byItem([{ ...cell, task: 'P0', graded: true }]))).toBe('P0')
    expect(landingItem([])).toBeNull()
  })
})
