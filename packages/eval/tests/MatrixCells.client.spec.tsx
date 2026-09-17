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
  EvalCellDetail, EvalCellsResult, EvalExperimentDetail, EvalExperimentsResult, EvalMatrixView,
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
      annotations: { orchestrator: 4 }, childSessionId: 'child-c',
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
  attempts: [
    { attempt: 1, state: 'halted', retry: null, refs: { resource: 'unit-a', fingerprint: null, sessions: [] }, checkpoints: [{ name: 'stage1', at: 6 }], artifacts: [], history: [] },
    {
      attempt: 2, state: 'archived',
      retry: { reason: 'the container died mid-round', category: 'infrastructure', at: 40, by: 'tab:s1' },
      refs: { resource: 'unit-b', fingerprint: 'lab-env:aaaa', sessions: ['child-c'] },
      checkpoints: [{ name: 'stage1', at: 50 }, { name: 'archive', at: 58 }],
      artifacts: [{ path: 'archive/workspace', kind: 'archive', addedAt: 59 }],
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
    openSession: vi.fn(),
  }
}

type Harness = ReturnType<typeof makeHarness>

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
    fetchMatrix: h.fetchMatrix,
    fetchCells: h.fetchCells,
    fetchCell: h.fetchCell,
    retryCell: h.retryCell,
    releaseCheck: h.releaseCheck,
    planExport: h.planExport,
    exportRun: h.exportRun,
    openSession: h.openSession,
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
    await openPage(h, 'page.matrix')
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
    // The row header is the item, and each cell's stage comes from the word table.
    expect(screen.getByText('P0')).toBeTruthy()
    expect(screen.getByText('stage.archived')).toBeTruthy()
    expect(screen.getByText('stage.stage-2')).toBeTruthy()
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
    await openPage(h, 'page.matrix')
    await waitFor(() => {
      expect(h.fetchMatrix).toHaveBeenLastCalledWith('s1', { runId: 'run-1', column: 'model.declared' })
    })
  })

  it('shows the two per-cell warnings and the run-level summary', async () => {
    const h = makeHarness()
    await openPage(h, 'page.matrix')
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
    await openPage(h, 'page.matrix')
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
    await openPage(h, 'page.matrix')
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
    await openPage(h, 'page.matrix')
    await screen.findByText('matrix.task')
    fireEvent.click(screen.getByLabelText(/matrix\.repLabel .*"condition":"codex-a"/))
    await waitFor(() => {
      expect(h.fetchCell).toHaveBeenCalledWith('s1', { runId: 'run-1', missionId: 'p0-codex-a-rep1' })
    })
  })
})

describe('the cells page and its drawer', () => {
  it('lists the run\'s cells and filters by bucket', async () => {
    const h = makeHarness()
    await openPage(h, 'page.cells')
    await waitFor(() => { expect(h.fetchCells).toHaveBeenCalledWith('s1', { runId: 'run-1' }) })
    expect(screen.getByText('cells.matched {"matched":2,"total":2}')).toBeTruthy()
    // The bucket chips carry the word and the run's own count for it.
    fireEvent.click(screen.getByRole('button', { name: /^bucket\.active/ }))
    await waitFor(() => {
      expect(h.fetchCells).toHaveBeenLastCalledWith('s1', { runId: 'run-1', bucket: 'active' })
    })
  })

  it('clicking a row opens the drawer with the unit, checkpoints, annotations and the verify output verbatim', async () => {
    const h = makeHarness()
    await openPage(h, 'page.cells')
    fireEvent.click(await screen.findByText('P0 × codex-a × 1'))
    await waitFor(() => { expect(h.fetchCell).toHaveBeenCalledWith('s1', { runId: 'run-1', missionId: 'p0-codex-a-rep1' }) })

    expect(await screen.findByText('unit-b')).toBeTruthy()
    expect(screen.getByText('deadbeef')).toBeTruthy()
    expect(screen.getByText('stage1 → archive')).toBeTruthy()
    expect(screen.getByText('archive/workspace (archive)')).toBeTruthy()
    // The probe line AND the raw payload — a summary would drop the exit code.
    // ui-spec §五 keeps verify verbatim; only the verdict word is ours.
    expect(screen.getByText('drawer.probeFailed')).toBeTruthy()
    expect(screen.getByText(/probe-skipped/)).toBeTruthy()
    expect(screen.getByText(/not applicable this round/)).toBeTruthy()
    expect(screen.getByText(/"kind": "probes"/)).toBeTruthy()
    // The retry that opened attempt 2 is on the record, in the word table's
    // vocabulary rather than mission's own token.
    expect(screen.getAllByText('retry.cat.infrastructure').length).toBeGreaterThan(0)
    expect(screen.getByText(/the container died mid-round/)).toBeTruthy()
  })

  it('re-runs with a reason and a category, and refuses to send a blank one', async () => {
    const h = makeHarness()
    await openPage(h, 'page.cells')
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
    await openPage(h, 'page.cells')
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
    await openPage(h, 'page.cells')
    fireEvent.click(await screen.findByText('P0 × codex-a × 1'))
    await screen.findByText('unit-b')
    fireEvent.click(screen.getByRole('button', { name: 'drawer.openSession' }))
    expect(h.openSession).toHaveBeenCalledWith('child-c')

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
    await openPage(h, 'page.cells')
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
    await openPage(h, 'page.cells')
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
