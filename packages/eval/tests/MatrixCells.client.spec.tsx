// @vitest-environment jsdom
/**
 * I5·T35b — the matrix page, the cells page and the drawer, under the
 * four-share props form: a real store instance and injected Remote mocks.
 *
 * The assertions are about what a person can DO: read the matrix with one
 * factor on the columns, click a cell into the drawer, and pull the three
 * levers — re-run with a reason, ask the release gate, and walk the export
 * dialog through its plan step. Plus the one that is not eval's at all:
 * opening the player's child session through the host.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  EvalCellArtifactView, EvalCellDetail, EvalCellsResult, EvalExperimentDetail, EvalExperimentsResult, EvalMatrixView,
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
  name: 't29-two-scopes',
  planPath: '/repo/plans/t29-two-scopes.json',
  runId: 'run-1',
  status: 'judging',
  statusDetail: null,
  snapshot: { repo: '/repo', datasetId: 'harness-comparison', commit: 'c0ffee1' },
  conditions: ['codex-a', 'codex-b'],
  judges: [],
  items: 1,
  reps: 1,
  factors: ['scope'],
  progress: { done: 2, total: 2 },
  startedAt: 1,
  validation: null,
  unit: null,
}

const LIST: EvalExperimentsResult = { repo: '/repo', datasets: ['harness-comparison'], notes: [], rows: [ROW] }

const DETAIL: EvalExperimentDetail = {
  row: ROW, meta: null, readiness: [], buckets: { done: 2 }, states: { archived: 2 }, unreleased: [], job: null,
}

/** A matrix with `scope` on the columns and one stuck, hash-mismatched cell. */
const MATRIX: EvalMatrixView = {
  runId: 'run-1',
  factors: ['harness.name', 'scope'],
  factorValues: [
    { factor: 'harness.name', values: [{ key: '"codex"', label: 'codex', conditions: ['codex-a', 'codex-b'] }] },
    { factor: 'scope', values: [{ key: '"a"', label: 'a', conditions: ['codex-a'] }, { key: '"b"', label: 'b', conditions: ['codex-b'] }] },
  ],
  column: 'scope',
  groupBy: [],
  filter: {},
  columns: [
    { key: '"a"', label: 'a', conditions: ['codex-a'] },
    { key: '"b"', label: 'b', conditions: ['codex-b'] },
  ],
  groups: [{
    key: '',
    label: '',
    rows: [{
      task: 'P0',
      cells: [
        {
          task: 'P0', column: '"a"', conditions: ['codex-a'], stage: 'archived', stuck: false,
          hashMismatch: false, hashUnknown: false,
          reps: [{ rep: 1, missionId: 'p0-codex-a-rep1', condition: 'codex-a', dot: 'filled', state: 'archived', bucket: 'done', stuck: false, inStateMs: 10 }],
        },
        {
          task: 'P0', column: '"b"', conditions: ['codex-b'], stage: 'stage-2', stuck: true,
          hashMismatch: true, hashUnknown: false,
          reps: [{ rep: 1, missionId: 'p0-codex-b-rep1', condition: 'codex-b', dot: 'half', state: 'stage-2', bucket: 'active', stuck: true, inStateMs: 9_999_999 }],
        },
      ],
    }],
  }],
  summary: {
    materialization: { status: 'violated', detail: '1 道题出现不同物化哈希：P0' },
    fingerprint: { status: 'unverifiable', detail: '本 run 无环境指纹（宿主路径的 run 不记）' },
    unreleased: 1,
    judgeConsistency: null,
    stuck: 1,
    cells: 2,
  },
  stuckMs: 30 * 60 * 1000,
}

const CELLS: EvalCellsResult = {
  runId: 'run-1',
  state: 'active',
  filter: {},
  total: 2,
  matched: 2,
  buckets: { done: 1, active: 1 },
  rows: [
    {
      missionId: 'p0-codex-a-rep1', task: 'P0', condition: 'codex-a', rep: 1, state: 'archived', bucket: 'done',
      attempt: 2, inStateMs: 120_000, refs: { resource: 'unit-b', fingerprint: null }, checkpoints: ['stage1'],
      annotations: { orchestrator: 4, 'llm-draft': 2 }, childSessionId: 'child-c',
    },
    {
      missionId: 'p0-codex-b-rep1', task: 'P0', condition: 'codex-b', rep: 1, state: 'stage-2', bucket: 'active',
      attempt: 1, inStateMs: 9_999_999, refs: { resource: null, fingerprint: null }, checkpoints: [],
      annotations: {}, childSessionId: null,
    },
  ],
}

const CELL: EvalCellDetail = {
  runId: 'run-1',
  missionId: 'p0-codex-a-rep1',
  title: '整理内容包',
  task: 'P0',
  condition: 'codex-a',
  rep: 1,
  labels: { task: 'P0', condition: 'codex-a', rep: '1' },
  state: 'archived',
  bucket: 'done',
  attempt: 2,
  enteredCurrentAt: 60,
  inStateMs: 120_000,
  refs: { resource: 'unit-b', fingerprint: 'lab-env:aaaa' },
  materializationSha: 'deadbeef',
  childSessionId: 'child-c',
  parentSessionId: 'session-parent-1',
  judgeSessions: [
    {
      judgeCondition: 't31-judge-other', judgeModel: 'other/m1', sample: 1, attempt: 2,
      childSessionId: 'judge-c', at: 70, selfJudged: false, error: null,
    },
    {
      judgeCondition: 't31-judge-twin', judgeModel: null, sample: 2, attempt: 2,
      childSessionId: null, at: 80, selfJudged: true, error: 'judge delegation failed to start',
    },
  ],
  attempts: [
    { attempt: 1, state: 'halted', retry: null, refs: { resource: 'unit-a', fingerprint: null, sessions: [] }, checkpoints: [{ name: 'stage1', at: 6 }], artifacts: [], history: [] },
    {
      attempt: 2, state: 'archived',
      retry: { reason: 'the container died mid-round', category: 'infrastructure', at: 40, by: 'tab:s1' },
      refs: { resource: 'unit-b', fingerprint: 'lab-env:aaaa', sessions: ['child-c'] },
      checkpoints: [{ name: 'stage1', at: 50 }, { name: 'archive', at: 58 }],
      artifacts: [
        { path: 'stage1.md', kind: 'submission', addedAt: 55 },
        { path: 'archive', kind: 'archive', addedAt: 59 },
      ],
      history: [{ from: 'judged', to: 'archived', at: 60 }],
    },
  ],
  annotations: [{ ns: 'script', count: 2, latestAt: 21, latest: '[2]', by: 'eval-orchestrator' }],
  probes: [{
    at: 20,
    where: 'unit',
    raw: '{\n  "kind": "probes",\n  "where": "unit"\n}',
    probes: [{ probe: 'checks/p1.sh', origin: 'dataset', exitCode: 2, outcome: 'probe-skipped', ok: false, verdicts: 0, durationMs: 8, error: null, reason: 'not applicable this round' }],
  }],
  releasable: false,
}

function makeHarness() {
  const instance = createLabViewStore().create()
  return {
    instance,
    actions: instance.actions,
    fetchExperiments: vi.fn(async (): Promise<Result<EvalExperimentsResult>> => ({ ok: true, value: LIST })),
    fetchExperiment: vi.fn(async (): Promise<Result<EvalExperimentDetail>> => ({ ok: true, value: DETAIL })),
    fetchMatrix: vi.fn(async (): Promise<Result<EvalMatrixView>> => ({ ok: true, value: MATRIX })),
    fetchCells: vi.fn(async (): Promise<Result<EvalCellsResult>> => ({ ok: true, value: CELLS })),
    fetchCell: vi.fn(async (): Promise<Result<EvalCellDetail>> => ({ ok: true, value: CELL })),
    retryCell: vi.fn(async (): Promise<Result<{ attempt: number }>> => ({ ok: true, value: { attempt: 3 } })),
    releaseCheck: vi.fn(async (): Promise<Result<{ missionId: string; releasable: boolean }>> => (
      { ok: true, value: { missionId: 'p0-codex-a-rep1', releasable: true } }
    )),
    planExport: vi.fn(async () => ({
      ok: true as const,
      value: { bundleDir: '/out/run-1-bundle', guardedLayers: ['grading'], expectedNs: ['script'], missions: 2, attempts: 3 },
    })),
    exportRun: vi.fn(async () => ({ ok: true as const, value: { bundleDir: '/out/run-1-bundle', files: 9 } })),
    fetchCellArtifact: vi.fn(async (): Promise<Result<EvalCellArtifactView>> => ({
      ok: true,
      value: {
        runId: 'run-1', missionId: 'p0-codex-a-rep1', attempt: 2, path: 'stage1.md',
        kind: 'text', entries: [], truncated: false, bytes: 21,
        text: '# 阶段一\n\n交了这些。\n', note: null,
      },
    })),
    openSession: vi.fn(),
  }
}

type Harness = ReturnType<typeof makeHarness>

/** Everything but the locale seat — shared with the real-dictionary render below. */
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
    value: { repo: '/repo', datasets: ['ds'], rows: [], notes: [] },
  }),
  fetchConditionDiff: async () => ({ ok: false as const, error: { code: 'unused', message: 'not under test' } }),
}

function propsOf(h: Harness) {
  return {
    ...DESIGN_STUBS,
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
    fetchMatrix: h.fetchMatrix,
    fetchCells: h.fetchCells,
    fetchCell: h.fetchCell,
    fetchCellArtifact: h.fetchCellArtifact,
    retryCell: h.retryCell,
    releaseCheck: h.releaseCheck,
    planExport: h.planExport,
    exportRun: h.exportRun,
    openSession: h.openSession,
  }
}

function renderView(h: Harness) {
  const props = {
    ...propsOf(h),
    t: (key: string, params?: Record<string, unknown>) => (
      params === undefined ? key : `${key} ${JSON.stringify(params)}`
    ),
  } as unknown as LabViewProps
  return render(<LabView {...props} />)
}

/** Open the run, then one of its sub-pages. */
async function openPage(h: Harness, tab: string) {
  renderView(h)
  fireEvent.click(await screen.findByText('t29-two-scopes'))
  fireEvent.click(screen.getByRole('button', { name: tab }))
}

/**
 * Open the matrix's arrangement disclosure. It is CLOSED by default (ui-spec
 * §九) — the matrix is what the page is for, and choosing the column is a rare
 * act — so a test that reaches a chip has to open it the way a reader does.
 */
function openArrange() {
  fireEvent.click(screen.getByText('matrix.arrange'))
}

afterEach(() => { cleanup() })

describe('the matrix page', () => {
  it('renders rows as items, the chosen factor as the columns, and the dots per rep', async () => {
    const h = makeHarness()
    await openPage(h, 'page.runs')
    await waitFor(() => { expect(h.fetchMatrix).toHaveBeenCalledWith('s1', { runId: 'run-1' }) })

    expect(screen.getByText('matrix.task')).toBeTruthy()
    // ui-spec §九: the heading is the CONDITION, and the factor value is its
    // subtitle. (`scope` is already the preferred column here, so the page
    // does not have to correct the host's pick — see the test below.)
    expect(screen.getByText('codex-a')).toBeTruthy()
    expect(screen.getByText('codex-b')).toBeTruthy()
    expect(screen.getByText(/factor\.scope\s+a/)).toBeTruthy()
    expect(screen.getByText(/factor\.scope\s+b/)).toBeTruthy()
    // Which factor separates the columns is said once, in words, above the table.
    expect(screen.getByText(/matrix\.columnIs/)).toBeTruthy()
    // The row header is the item, and each seat's stage comes from the word
    // table. The grid and the run-record list are ONE page now (ui-spec §五
    // v2), so each state word is on screen twice — in the seat and in the
    // row — which is the merge working, not a duplicate rendering.
    expect(screen.getByText('P0')).toBeTruthy()
    expect(screen.getAllByText('stage.archived').length).toBe(2)
    expect(screen.getAllByText('stage.stage-2').length).toBe(2)
    // One dot per rep, labelled so a reader (and a screen reader) can tell them apart.
    expect(screen.getByLabelText(/matrix\.repLabel .*"condition":"codex-a".*"stage":"stage\.archived"/)).toBeTruthy()
    expect(screen.getByLabelText(/matrix\.repLabel .*"condition":"codex-b".*"stage":"stage\.stage-2"/)).toBeTruthy()
  })

  it('asks for the DESIGNED factor when the host picked an incidental one', async () => {
    const h = makeHarness()
    // `env.keys` sorts first over these three, so the pivot's own default puts
    // a JSON array on the columns — the I5 walkthrough's heading. The browser
    // half knows `model.declared` is the designed factor and asks for it.
    h.fetchMatrix.mockResolvedValue({
      ok: true,
      value: { ...MATRIX, factors: ['env.keys', 'home.sha', 'model.declared'], column: 'env.keys' },
    })
    await openPage(h, 'page.runs')
    await waitFor(() => {
      expect(h.fetchMatrix).toHaveBeenLastCalledWith('s1', { runId: 'run-1', column: 'model.declared' })
    })
  })

  it('shows the two per-cell warnings and the run-level summary', async () => {
    const h = makeHarness()
    await openPage(h, 'page.runs')
    await screen.findByText('matrix.task')
    // The two warnings are chips now; the sentence rides on the chip's title.
    expect(screen.getByText('matrix.hashMismatchChip')).toBeTruthy()
    expect(screen.getByText('matrix.stuckChip {"minutes":30}')).toBeTruthy()
    // An invariant that did not hold still says why, right under the band.
    expect(screen.getByText('1 道题出现不同物化哈希：P0')).toBeTruthy()
    expect(screen.getByText('本 run 无环境指纹（宿主路径的 run 不记）')).toBeTruthy()
    // Judge consistency is 待报告 until a report exists — never a guess.
    expect(screen.getByText('summary.judgePending')).toBeTruthy()
    expect(screen.getAllByText('invariant.violated').length).toBeGreaterThanOrEqual(1)
  })

  it('re-arranges when the reader moves the column factor', async () => {
    const h = makeHarness()
    await openPage(h, 'page.runs')
    await screen.findByText('matrix.task')
    openArrange()
    // A factor is offered twice — as the column and as a band — so the first
    // chip is the column control.
    const chips = screen.getAllByRole('button', { name: 'factor.harness.name' })
    fireEvent.click(chips[0] as HTMLElement)
    await waitFor(() => {
      expect(h.fetchMatrix).toHaveBeenLastCalledWith('s1', { runId: 'run-1', column: 'harness.name' })
    })
  })

  it('bands the rows by a remaining factor', async () => {
    const h = makeHarness()
    await openPage(h, 'page.runs')
    await screen.findByText('matrix.task')
    openArrange()
    // `harness.name` is not the column here, so it is offered as a band.
    const band = screen.getAllByRole('button', { name: 'factor.harness.name' })
    fireEvent.click(band[band.length - 1] as HTMLElement)
    await waitFor(() => {
      expect(h.fetchMatrix).toHaveBeenLastCalledWith('s1', expect.objectContaining({ groupBy: ['harness.name'] }))
    })
  })

  it('clicking a rep dot opens that cell on the cells page', async () => {
    const h = makeHarness()
    await openPage(h, 'page.runs')
    await screen.findByText('matrix.task')
    fireEvent.click(screen.getByLabelText(/matrix\.repLabel .*"condition":"codex-a"/))
    await waitFor(() => {
      expect(h.fetchCell).toHaveBeenCalledWith('s1', { runId: 'run-1', missionId: 'p0-codex-a-rep1' })
    })
  })
})

describe('the cells page and its drawer', () => {
  it('lists the run\'s records and applies the five filters in the browser', async () => {
    const h = makeHarness()
    await openPage(h, 'page.runs')
    await waitFor(() => { expect(h.fetchCells).toHaveBeenCalledWith('s1', { runId: 'run-1' }) })
    expect(screen.getByText('runs.filtered {"matched":2,"total":2}')).toBeTruthy()
    expect(screen.getByText('P0 × codex-a × 1')).toBeTruthy()
    expect(screen.getByText('P0 × codex-b × 1')).toBeTruthy()

    // ui-spec §五 v2's five, and they narrow rows already in hand: one read
    // per run, so the counts beside the chips count one population and
    // 「失败」 (the `halted` STATE, which mission projects into `done`) can be
    // one of them at all.
    fireEvent.click(screen.getByRole('button', { name: /^runs\.filter\.active/ }))
    await waitFor(() => {
      expect(screen.queryByText('P0 × codex-a × 1')).toBeNull()
    })
    expect(screen.getByText('P0 × codex-b × 1')).toBeTruthy()
    expect(screen.getByText('runs.filtered {"matched":1,"total":2}')).toBeTruthy()
    expect(h.fetchCells).toHaveBeenCalledTimes(1)
  })

  it('says which verdict source each record carries — in the row AND in its grid seat', async () => {
    const h = makeHarness()
    await openPage(h, 'page.runs')
    await waitFor(() => { expect(h.fetchCells).toHaveBeenCalledWith('s1', { runId: 'run-1' }) })

    // 有判定即显示 (ui-spec §五 v2), and the grid reads it off the list's own
    // payload — one read, no projection field, no second scoring rule.
    expect(screen.getAllByText('verdict.llm')).toHaveLength(2)
    // A record with nothing recorded says so rather than showing a blank.
    expect(screen.getByText('verdict.none')).toBeTruthy()
  })

  it('opens ONE record: the verdict, the timeline, the parameters, the attachments — and verify verbatim', async () => {
    const h = makeHarness()
    await openPage(h, 'page.runs')
    fireEvent.click(await screen.findByText('P0 × codex-a × 1'))
    await waitFor(() => { expect(h.fetchCell).toHaveBeenCalledWith('s1', { runId: 'run-1', missionId: 'p0-codex-a-rep1' }) })

    // The head answers «did this work» before any field does (ui-spec §五 v2).
    // 成功 / 异常 is the LEDGER's: `halted` is the state that says it stopped.
    expect(await screen.findByText('record.ok')).toBeTruthy()
    // The verdict SOURCE, in the head and in the parameter table; the number
    // is on the results page and the panel says so.
    expect(screen.getAllByText('verdict.script').length).toBe(2)
    expect(screen.getByText('record.scoreWhere')).toBeTruthy()
    // One layer on this record, so no mixed-source line: the sentence appears
    // only when the merge actually has more than one layer to merge.
    expect(screen.queryByText(/record.scoreMixed/)).toBeNull()

    // The timeline, from the ledger's own transition times.
    expect(screen.getByText('record.timeline')).toBeTruthy()
    expect(screen.getAllByText('stage.judged').length).toBeGreaterThan(0)

    // A key-value table, not a JSON dump.
    expect(screen.getByText('record.param.material')).toBeTruthy()
    expect(screen.getByText('deadbeef')).toBeTruthy()
    expect(screen.getByText('record.param.unit')).toBeTruthy()
    expect(screen.getByText('unit-b')).toBeTruthy()

    // Artifacts named in words, with the path on the hover — and each row is
    // now the control that opens it (I5·T69), so the sentence apologizing for
    // a missing file service is gone.
    expect(screen.getByText('artifact.archive')).toBeTruthy()
    expect(screen.getByText('archive')).toBeTruthy()
    expect(screen.getByText('stage1.md')).toBeTruthy()
    expect(screen.queryByText('record.filePending')).toBeNull()

    // The probe line AND the raw payload — a summary would drop the exit code.
    // ui-spec §五 keeps verify verbatim; only the verdict word is ours.
    expect(screen.getByText('drawer.probeFailed')).toBeTruthy()
    expect(screen.getByText(/probe-skipped/)).toBeTruthy()
    expect(screen.getByText(/not applicable this round/)).toBeTruthy()
    expect(screen.getByText(/"kind": "probes"/)).toBeTruthy()
    // The receipts — attempts, checkpoints, annotation namespaces — are kept
    // and folded, with the retry still in the word table's vocabulary.
    expect(screen.getByText(/drawer\.checkpoints.*stage1 → archive/)).toBeTruthy()
    expect(screen.getAllByText('retry.cat.infrastructure').length).toBeGreaterThan(0)
    expect(screen.getByText(/the container died mid-round/)).toBeTruthy()
  })

  it('opens an attachment in place: the submission is read where it is listed, and a second click closes it', async () => {
    const h = makeHarness()
    await openPage(h, 'page.runs')
    fireEvent.click(await screen.findByText('P0 × codex-a × 1'))
    await screen.findByText('record.attachments')
    // Nothing is expanded on arrival: the panel is a record, not a browser.
    expect(h.fetchCellArtifact).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('stage1.md'))
    await waitFor(() => {
      expect(h.fetchCellArtifact).toHaveBeenCalledWith('s1', {
        // The CURRENT attempt, not attempt 1: a retry opens a fresh directory
        // and the same filename there is a different file.
        runId: 'run-1', missionId: 'p0-codex-a-rep1', attempt: 2, path: 'stage1.md',
      })
    })
    expect(await screen.findByText(/交了这些。/)).toBeTruthy()

    // The same row closes it — one attachment is shown at a time, so 点开 and
    // 收起 are one gesture.
    fireEvent.click(screen.getByText('stage1.md'))
    await waitFor(() => { expect(screen.queryByText(/交了这些。/)).toBeNull() })
  })

  it('a directory artifact lists its entries, and an entry opens through the same door', async () => {
    const h = makeHarness()
    h.fetchCellArtifact.mockResolvedValueOnce({
      ok: true,
      value: {
        runId: 'run-1', missionId: 'p0-codex-a-rep1', attempt: 2, path: 'archive',
        kind: 'directory', entries: ['manifest.json', 'workspace'], truncated: false,
        bytes: null, text: null, note: null,
      },
    })
    await openPage(h, 'page.runs')
    fireEvent.click(await screen.findByText('P0 × codex-a × 1'))
    fireEvent.click(await screen.findByText('archive'))
    expect(await screen.findByText('workspace')).toBeTruthy()

    fireEvent.click(screen.getByText('manifest.json'))
    await waitFor(() => {
      expect(h.fetchCellArtifact).toHaveBeenLastCalledWith('s1', {
        runId: 'run-1', missionId: 'p0-codex-a-rep1', attempt: 2, path: 'archive/manifest.json',
      })
    })
  })

  it('says a refused binary is one, rather than showing an empty pane', async () => {
    const h = makeHarness()
    h.fetchCellArtifact.mockResolvedValueOnce({
      ok: true,
      value: {
        runId: 'run-1', missionId: 'p0-codex-a-rep1', attempt: 2, path: 'stage1.md',
        kind: 'binary', entries: [], truncated: false, bytes: 4096, text: null,
        note: '这一页不内联 .png 产物，只内联文本（md / json / txt / yml / yaml / log / jsonl）',
      },
    })
    await openPage(h, 'page.runs')
    fireEvent.click(await screen.findByText('P0 × codex-a × 1'))
    fireEvent.click(await screen.findByText('stage1.md'))
    expect(await screen.findByText(/不内联 \.png 产物/)).toBeTruthy()
    expect(screen.getByText(/record\.artifactBytes.*4096/)).toBeTruthy()
  })

  it('opens the JUDGE\'s session too — and disables the round that never started one', async () => {
    const h = makeHarness()
    await openPage(h, 'page.runs')
    fireEvent.click(await screen.findByText('P0 × codex-a × 1'))
    expect(await screen.findByText('record.judgeRounds')).toBeTruthy()
    // Un-blinded on purpose: this page already names the comparison group in
    // its own header. The blind panel is the judge bench's.
    expect(screen.getByText('t31-judge-other')).toBeTruthy()

    const buttons = screen.getAllByText('record.openJudgeSession')
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[0] as HTMLElement)
    // WITH the run's parent: the host refuses a subagent session addressed
    // on its own, so a child id alone navigates to a failed history.
    expect(h.openSession).toHaveBeenCalledWith('judge-c', 'session-parent-1')
    // The round that failed before it started has no session, so its button
    // is dead rather than pointing somewhere plausible.
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('judge delegation failed to start')).toBeTruthy()
  })

  it('re-runs with a reason and a category, and refuses to send a blank one', async () => {
    const h = makeHarness()
    await openPage(h, 'page.runs')
    fireEvent.click(await screen.findByText('P0 × codex-a × 1'))
    await screen.findByText('unit-b')

    const retry = screen.getByRole('button', { name: 'action.retry' })
    // A blank reason is not sendable — mission demands one and so does the tab.
    expect(retry.hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByLabelText('retry.reason'), { target: { value: 'the container died mid-round' } })
    fireEvent.change(screen.getByLabelText('retry.category'), { target: { value: 'infrastructure' } })
    fireEvent.click(screen.getByRole('button', { name: 'action.retry' }))

    await waitFor(() => {
      expect(h.retryCell).toHaveBeenCalledWith('s1', {
        runId: 'run-1',
        missionId: 'p0-codex-a-rep1',
        reason: 'the container died mid-round',
        category: 'infrastructure',
      })
    })
    expect(await screen.findByText('notice.retried {"id":"p0-codex-a-rep1","attempt":3}')).toBeTruthy()
  })

  it('asks the release gate and reports its answer', async () => {
    const h = makeHarness()
    await openPage(h, 'page.runs')
    fireEvent.click(await screen.findByText('P0 × codex-a × 1'))
    await screen.findByText('unit-b')
    fireEvent.click(screen.getByRole('button', { name: 'action.release' }))
    await waitFor(() => {
      expect(h.releaseCheck).toHaveBeenCalledWith('s1', { runId: 'run-1', missionId: 'p0-codex-a-rep1' })
    })
    expect(await screen.findByText('notice.releasable {"id":"p0-codex-a-rep1"}')).toBeTruthy()
  })

  it('opens the delegation\'s child session through the host, and disables the button without one', async () => {
    const h = makeHarness()
    await openPage(h, 'page.runs')
    fireEvent.click(await screen.findByText('P0 × codex-a × 1'))
    await screen.findByText('unit-b')
    fireEvent.click(screen.getByRole('button', { name: 'drawer.openSession' }))
    expect(h.openSession).toHaveBeenCalledWith('child-c', 'session-parent-1')

    // The other cell recorded none: the button says so instead of doing nothing.
    h.fetchCell.mockResolvedValue({ ok: true, value: { ...CELL, missionId: 'p0-codex-b-rep1', childSessionId: null } })
    fireEvent.click(screen.getByText('P0 × codex-b × 1'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'drawer.openSession' }).hasAttribute('disabled')).toBe(true)
    })
    expect(screen.getByText('drawer.noSession')).toBeTruthy()
  })
})

describe('the export dialog', () => {
  it('walks plan → per-guarded-layer confirmation → export, and cannot export before the plan', async () => {
    const h = makeHarness()
    await openPage(h, 'page.runs')
    fireEvent.click(await screen.findByText('P0 × codex-a × 1'))
    await screen.findByText('unit-b')
    fireEvent.click(screen.getByRole('button', { name: 'action.export' }))

    const confirm = await screen.findByRole('button', { name: 'export.confirm' })
    // Nothing may be written before mission has said which layers are guarded.
    expect(confirm.hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByLabelText('export.outDir'), { target: { value: '/out' } })
    fireEvent.change(screen.getByLabelText('export.layers'), { target: { value: 'visible, grading' } })
    fireEvent.click(screen.getByRole('button', { name: 'export.plan' }))

    await waitFor(() => {
      expect(h.planExport).toHaveBeenCalledWith('s1', { runId: 'run-1', outDir: '/out', layers: ['visible', 'grading'] })
    })
    expect(await screen.findByText('export.guardedTitle')).toBeTruthy()
    // Still refused: the guarded layer has not been ticked.
    expect(screen.getByRole('button', { name: 'export.confirm' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'export.confirm' }).hasAttribute('disabled')).toBe(false)
    })
    fireEvent.click(screen.getByRole('button', { name: 'export.confirm' }))
    await waitFor(() => {
      expect(h.exportRun).toHaveBeenCalledWith('s1', {
        runId: 'run-1', outDir: '/out', layers: ['visible', 'grading'], confirmed: ['grading'],
      })
    })
  })

  it('editing a field after the check drops the confirmations — they belonged to the layer set they were ticked on', async () => {
    const h = makeHarness()
    await openPage(h, 'page.runs')
    fireEvent.click(await screen.findByText('P0 × codex-a × 1'))
    await screen.findByText('unit-b')
    fireEvent.click(screen.getByRole('button', { name: 'action.export' }))
    fireEvent.change(await screen.findByLabelText('export.outDir'), { target: { value: '/out' } })
    fireEvent.click(screen.getByRole('button', { name: 'export.plan' }))
    fireEvent.click(await screen.findByRole('checkbox'))

    fireEvent.change(screen.getByLabelText('export.layers'), { target: { value: 'visible' } })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'export.confirm' }).hasAttribute('disabled')).toBe(true)
    })
    expect(screen.queryByText('export.guardedTitle')).toBeNull()
  })
})
