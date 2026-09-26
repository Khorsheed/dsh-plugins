// @vitest-environment jsdom
/**
 * The 题集 tab under the four-share props form: a real store instance
 * (createDatasetsViewStore().create()) and injected Remote mocks.
 *
 * What the assertions are about, page by page: the LIST is the deployment's
 * registry under one header, a group row per repository and a row per set —
 * set · trackedRef@short + date · item count · the layer word · the
 * experiment count — and no path is page text (ui-spec §九); the REGISTER form's
 * live preview drives the per-set layer chips and confirm sends exactly what
 * they show; «从旧绑定登记» reports each folded registration and marks a
 * dangling binding in red; the DETAIL tree marks each file with its slot AND
 * who sees it; «作答记录» is ABSENT — not empty — on an instance with no eval
 * plugin; write gestures exist only on a registration with an authoring
 * checkout.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  DatasetOverview, ImportBindingsResult, ItemBrief, ListDatasetsResult, ListItemsResult,
  ReadResult, RegisterPreview, RegistryEntry, RegistryRow, SkeletonResult, ValidateResult,
} from '../src/types.ts'
import type { DatasetsViewProps, ItemRunsView } from '../src/client/contract.ts'
import { DatasetsView } from '../src/client/DatasetsView.tsx'
import { createDatasetsViewStore } from '../src/client/store.ts'

/** Selector hook over the store engine instance (the test-sanctioned engine path). */
function hookOf(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => unknown }) {
  return function useSelector<S>(sel: (s: unknown) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

type Store = ReturnType<typeof createDatasetsViewStore>
type Instance = ReturnType<Store['create']>

type Mock = ReturnType<typeof vi.fn>

interface Harness {
  instance: Instance
  actions: Instance['actions']
  fetchRegistry: Mock
  previewRepo: Mock
  register: Mock
  updateRegistration: Mock
  unregister: Mock
  importBindings: Mock
  listDatasets: Mock
  readFile: Mock
  readPassthroughFile: Mock
  pickDirectory: Mock
  overview: Mock
  itemBrief: Mock
  validateDataset: Mock
  scaffoldDataset: Mock
  scaffoldItem: Mock
  importItem: Mock
  itemRuns: Mock
  datasetExperiments: Mock
}

const TIP = 'a4f9c2e0000000000000000000000000000000ff'

const ENTRY: RegistryEntry = {
  id: 'dataseek-eval',
  commonDir: '/work/dataseek-eval/.git',
  trackedRef: 'i1-walk',
  registeredAt: '2026-09-20T08:00:00.000Z',
  registeredCommit: TIP,
  sets: { bench: { layers: ['visible'] } },
  authoringCheckout: '/work/dataseek-eval',
}

/** One registration with one set, shaped like harness-comparison. */
function rowOf(entry: RegistryEntry = ENTRY): RegistryRow {
  return {
    entry,
    latest: { commit: TIP, date: '2026-09-21T10:00:00+08:00' },
    sets: [{
      ref: `${entry.id}/bench`,
      set: 'bench',
      title: 'Bench set',
      layers: ['visible'],
      declaredLayers: ['visible', 'verify', 'grading'],
      nonModelFacingLayers: ['verify', 'grading'],
    }],
  }
}

/** The list page's answer: one dataset shaped like harness-comparison. */
const OVERVIEW: DatasetOverview = {
  repo: '/work/dataseek-eval/.git',
  commit: 'a4f9c2e00000000',
  datasets: [{
    id: 'bench',
    name: 'Bench set',
    itemCount: 2,
    layers: ['visible', 'verify', 'grading'],
    nonModelFacingLayers: ['verify', 'grading'],
    slotLayers: {
      prompt: ['visible'],
      standards: ['visible'],
      oracle: ['grading'],
      rubric: ['grading'],
      checks: ['verify'],
      other: ['-'],
    },
    canary: true,
    warnings: [],
    validate: { errors: 0, warnings: 3, firstError: null },
  }],
}

const ITEMS: ListItemsResult = {
  kind: 'items',
  dataset: {
    id: 'bench', name: 'Bench set', layers: ['visible', 'verify', 'grading'],
    nonModelFacingLayers: ['verify', 'grading'], itemCount: 2, warnings: [],
  },
  datasetLayers: { visible: ['prompts/stage1.md'] },
  passthrough: ['manifest.yml'],
  items: [{
    id: 'R1',
    metadata: { difficulty: 'hard' },
    layers: {
      visible: ['task.md', 'standards.yml'],
      grading: ['answers/rubric.yml', 'answers/oracle/notes.md'],
      verify: ['checks/probes/link-check.mjs'],
    },
  }],
}

/** The list page's count read: the set-less answer. */
const SUMMARIES: ListDatasetsResult = {
  kind: 'datasets',
  datasets: [{ id: 'bench', name: 'Bench set', layers: ['visible'], nonModelFacingLayers: [], itemCount: 14, warnings: [] }],
}

const BRIEF: ItemBrief = {
  dataset: 'bench',
  item: 'R1',
  commit: 'a4f9c2e00000000',
  player: {
    layers: ['visible'],
    totalBytes: 300,
    files: [
      { path: 'task.md', layer: 'visible', source: 'item', bytes: 100 },
      { path: 'standards.yml', layer: 'visible', source: 'item', bytes: 100 },
      { path: 'prompts/stage1.md', layer: 'visible', source: 'dataset', bytes: 100 },
    ],
  },
  judgeability: {
    rubricPath: 'answers/rubric.yml',
    leaves: 2,
    kinds: { 'objective': 1, 'llm-draft': 1 },
    probes: ['checks/probes/link-check.mjs'],
    sharedProbes: [],
    stageSchemas: ['schemas/stage1.json'],
    notes: [],
  },
}

const RUNS: ItemRunsView = {
  runs: [{
    runId: 'run-1',
    name: 'pilot-a',
    startedAt: 1_757_000_000_000,
    commit: 'bbbbbbb0000',
    cells: [{
      missionId: 'm1', condition: 'dsh-exec', rep: 1, state: 'archived', bucket: 'done',
      verdicts: { 'llm-draft': 2 },
    }],
  }],
  notes: [],
}

const SKELETON: SkeletonResult = {
  written: ['datasets/bench/items/C2/visible/task.md'],
  skipped: [],
  notes: [],
}

const VALIDATED: ValidateResult = {
  datasets: [{
    id: 'bench',
    errors: [{ code: 'RUBRIC_NO_ITEMS', message: 'items/C2/grading/rubric.yml: declares no leaf criteria' }],
    warnings: [],
  }],
}

const PREVIEW: RegisterPreview = {
  commonDir: '/repo/.git',
  suggestedId: 'repo',
  branches: ['main', 'i1-walk'],
  defaultRef: 'main',
  latest: { commit: TIP, date: '2026-09-21T10:00:00+08:00' },
  sets: [
    { ref: 'repo/alpha', set: 'alpha', title: 'Alpha', layers: ['visible'], declaredLayers: ['visible'], nonModelFacingLayers: [] },
    {
      ref: 'repo/beta', set: 'beta', title: 'beta', layers: ['visible'],
      declaredLayers: ['visible', 'grading'], nonModelFacingLayers: ['grading'],
    },
  ],
  checkout: '/repo',
}

const IMPORTED: ImportBindingsResult = {
  imported: [{ id: 'dataseek-eval', commonDir: '/work/dataseek-eval/.git', paths: ['/a', '/b'], sessions: 3, created: true }],
  dangling: [{ repoPath: '/tmp/old-scratch', sessions: 1, reason: 'the path no longer exists' }],
}

function makeHarness(rows: RegistryRow[] = [rowOf()]): Harness {
  const instance = createDatasetsViewStore().create()
  return {
    instance,
    actions: instance.actions,
    fetchRegistry: vi.fn(async (): Promise<Result<RegistryRow[]>> => ({ ok: true, value: rows })),
    previewRepo: vi.fn(async (): Promise<Result<RegisterPreview>> => ({ ok: true, value: PREVIEW })),
    register: vi.fn(async (_sid: string, input: unknown): Promise<Result<unknown>> => ({ ok: true, value: input })),
    updateRegistration: vi.fn(async (_sid: string, input: unknown): Promise<Result<unknown>> => ({ ok: true, value: input })),
    unregister: vi.fn(async (): Promise<Result<boolean>> => ({ ok: true, value: true })),
    importBindings: vi.fn(async (): Promise<Result<ImportBindingsResult>> => ({ ok: true, value: IMPORTED })),
    listDatasets: vi.fn(async (): Promise<Result<ListDatasetsResult | ListItemsResult>> => ({ ok: true, value: ITEMS })),
    readFile: vi.fn(async (): Promise<Result<ReadResult>> => ({ ok: true, value: { content: '# Task\n\nbody\n', commit: 'a4f9c2e0000' } })),
    readPassthroughFile: vi.fn(async (): Promise<Result<ReadResult>> => ({ ok: true, value: { content: '# Passthrough content\n', commit: 'a4f9c2e0000' } })),
    pickDirectory: vi.fn(async () => '/picked-repo'),
    overview: vi.fn(async (): Promise<Result<DatasetOverview>> => ({ ok: true, value: OVERVIEW })),
    itemBrief: vi.fn(async (): Promise<Result<ItemBrief>> => ({ ok: true, value: BRIEF })),
    validateDataset: vi.fn(async (): Promise<Result<ValidateResult>> => ({ ok: true, value: VALIDATED })),
    scaffoldDataset: vi.fn(async (): Promise<Result<SkeletonResult>> => ({ ok: true, value: SKELETON })),
    scaffoldItem: vi.fn(async (): Promise<Result<SkeletonResult>> => ({ ok: true, value: SKELETON })),
    importItem: vi.fn(async (): Promise<Result<SkeletonResult>> => ({ ok: true, value: SKELETON })),
    // The default instance carries NO eval plugin: null is «not installed».
    itemRuns: vi.fn(async (): Promise<ItemRunsView | null> => null),
    datasetExperiments: vi.fn(async () => null),
  }
}

function renderView(h: Harness, opts: { canPick?: boolean } = {}) {
  const canPick = opts.canPick ?? true
  const props = {
    sessionId: 's1' as SessionId,
    useSession: undefined,
    useInput: undefined,
    inputActions: undefined,
    useProjection: undefined,
    useSessions: ((sel: (s: unknown) => unknown) => sel({
      byId: { s1: { cwd: '/work' } },
    })) as never,
    useWorkspaces: undefined,
    useStore: hookOf(h.instance),
    actions: h.actions,
    fetchRegistry: h.fetchRegistry,
    previewRepo: h.previewRepo,
    register: h.register,
    updateRegistration: h.updateRegistration,
    unregister: h.unregister,
    importBindings: h.importBindings,
    listDatasets: h.listDatasets,
    readFile: h.readFile,
    readPassthroughFile: h.readPassthroughFile,
    overview: h.overview,
    itemBrief: h.itemBrief,
    validateDataset: h.validateDataset,
    scaffoldDataset: h.scaffoldDataset,
    scaffoldItem: h.scaffoldItem,
    importItem: h.importItem,
    itemRuns: h.itemRuns,
    datasetExperiments: h.datasetExperiments,
    isLoopback: canPick,
    useHostDescription: ((sel: (d: { canOpenPath: boolean }) => unknown) => sel({ canOpenPath: canPick })) as never,
    pickDirectory: h.pickDirectory,
    t: (key: string, params?: Record<string, unknown>) => (
      params === undefined ? key : `${key} ${JSON.stringify(params)}`
    ),
  } as unknown as DatasetsViewProps
  return render(<DatasetsView {...props} />)
}

/** Open the detail page of the only set, and its only item. */
async function openItem(h: Harness): Promise<void> {
  renderView(h)
  fireEvent.click(await screen.findByText('bench'))
  fireEvent.click(await screen.findByText('R1'))
}

afterEach(() => { cleanup() })

describe('the list page', () => {
  it('one header, a group row per repository, a row per set: set · tip + date · count · layer word', async () => {
    const h = makeHarness()
    h.listDatasets.mockResolvedValue({ ok: true, value: SUMMARIES })
    renderView(h)
    expect(await screen.findByText('bench')).toBeTruthy()
    expect(h.fetchRegistry).toHaveBeenCalledWith('s1')
    for (const column of ['registry.colSet', 'registry.colLatest', 'registry.colItems', 'registry.colVisible']) {
      expect(screen.getByRole('columnheader', { name: column })).toBeTruthy()
    }
    // No eval plugin: the experiments column is absent, header included.
    expect(screen.queryByRole('columnheader', { name: 'registry.colUsed' })).toBeNull()
    // No per-registration overview; the counts are ONE set-less read per registration.
    expect(h.overview).not.toHaveBeenCalled()
    await waitFor(() => { expect(h.listDatasets).toHaveBeenCalledWith('s1', 'dataseek-eval') })
    expect(h.listDatasets).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('14')).toBeTruthy()
    expect(screen.getByText('dataseek-eval')).toBeTruthy()
    expect(screen.getByText('Bench set')).toBeTruthy()
    // «latest» is the tracked branch's tip, named as such.
    expect(screen.getByText('i1-walk@a4f9c2e')).toBeTruthy()
    expect(screen.getByText('2026-09-21')).toBeTruthy()
    // The layer word, not the layer name — which rides on the title.
    expect(screen.getByText('layers.faceOnly')).toBeTruthy()
    expect(screen.getByTitle(/layers\.title .*"layers":"visible"/)).toBeTruthy()
    expect(screen.queryByText(/visible/)).toBeNull()
    // The reference an agent names rides on the set cell's title.
    expect(screen.getByTitle('dataseek-eval/bench')).toBeTruthy()
  })

  it('a failed or not-yet-answered count is a dash, never a zero', async () => {
    const h = makeHarness()
    h.listDatasets.mockResolvedValue({ ok: false, error: { code: 'internal', message: 'unreadable' } })
    renderView(h)
    expect(await screen.findByText('bench')).toBeTruthy()
    await waitFor(() => { expect(h.listDatasets).toHaveBeenCalled() })
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.queryByText('0')).toBeNull()
  })

  it('the counts go out together: every registration\u2019s read is in flight before any answers', async () => {
    const other = { ...ENTRY, id: 'other', commonDir: '/work/other/.git' }
    const h = makeHarness([rowOf(), rowOf(other)])
    const pending: Array<(value: Result<ListDatasetsResult>) => void> = []
    h.listDatasets.mockImplementation(() => new Promise((resolve) => { pending.push(resolve) }))
    renderView(h)
    await waitFor(() => { expect(h.listDatasets).toHaveBeenCalledTimes(2) })
    expect(h.listDatasets.mock.calls.map(call => call[1])).toEqual(['dataseek-eval', 'other'])
    // Neither has answered yet: both cells are still dashes.
    expect(screen.getAllByText('—')).toHaveLength(2)
    pending[1]!({ ok: true, value: SUMMARIES })
    expect(await screen.findByText('14')).toBeTruthy()
    expect(screen.getAllByText('—')).toHaveLength(1)
  })

  it('the read-only layer word carries a 「改」 that opens the registration\u2019s edit form', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('layers.edit'))
    expect(await screen.findByText(/register\.titleEdit .*dataseek-eval/)).toBeTruthy()
    expect(screen.getByTitle(/layers\.editTitle .*dataseek-eval\/bench/)).toBeTruthy()
  })

  it('no path is page text: the repository location rides on a title only', async () => {
    const h = makeHarness()
    const { container } = renderView(h)
    expect(await screen.findByText('bench')).toBeTruthy()
    expect(container.textContent).not.toContain('/work/')
    expect(screen.getByTitle('/work/dataseek-eval/.git')).toBeTruthy()
  })

  it('a registration whose tracked branch is gone keeps its group with the host\'s sentence', async () => {
    const broken: RegistryRow = {
      entry: { ...ENTRY, trackedRef: 'gone' },
      sets: [],
      problem: 'tracked branch "gone" of "dataseek-eval" does not exist',
    }
    const h = makeHarness([broken])
    renderView(h)
    expect(await screen.findByText('registry.problem')).toBeTruthy()
    expect(screen.getByTitle(/tracked branch "gone"/)).toBeTruthy()
    expect(screen.getByText('registry.problemFix')).toBeTruthy()
    expect(screen.queryByText('bench')).toBeNull()
  })

  it('an empty registry is a first screen with the next step on it', async () => {
    const h = makeHarness([])
    renderView(h)
    expect(await screen.findByText('registry.empty')).toBeTruthy()
    fireEvent.click(screen.getByText('registry.emptyAction'))
    expect(await screen.findByText('register.title')).toBeTruthy()
  })

  it('a failed registry fetch settles instead of loading forever', async () => {
    const h = makeHarness()
    h.fetchRegistry.mockResolvedValue({ ok: false, error: { code: 'internal', message: 'registry unreadable' } })
    renderView(h)
    expect(await screen.findByText(/list\.error/)).toBeTruthy()
    expect(screen.getByText(/registry unreadable/)).toBeTruthy()
  })

  it('drops the 用于 cell entirely when no eval plugin answers, and fills it when one does', async () => {
    const without = makeHarness()
    renderView(without)
    expect(await screen.findByText('bench')).toBeTruthy()
    expect(screen.queryByText('list.experimentsNone')).toBeNull()
    cleanup()

    const h = makeHarness()
    const run = { status: 'done', registry: 'dataseek-eval' }
    h.datasetExperiments.mockResolvedValue([
      { ...run, id: 'run-1', experimentId: 'e1', name: 'pilot-a', datasetId: 'bench', commit: TIP },
      // A re-run of the same experiment at another commit: one experiment, two versions.
      { ...run, id: 'run-2', experimentId: 'e1', name: 'pilot-a', datasetId: 'bench', commit: 'b'.repeat(40) },
      { ...run, id: 'run-3', experimentId: 'e2', name: 'pilot-b', datasetId: 'bench', commit: TIP },
      { ...run, id: 'run-4', experimentId: 'e3', name: 'other-set-run', datasetId: 'elsewhere', commit: TIP },
      // Same set id, another registration: not this row's.
      { ...run, id: 'run-5', experimentId: 'e4', name: 'other-repo-run', datasetId: 'bench', registry: 'other', commit: TIP },
    ])
    renderView(h)
    const toggle = await screen.findByText(/registry\.usedCount .*"count":2.*"versions":2/)
    expect(screen.getByRole('columnheader', { name: 'registry.colUsed' })).toBeTruthy()
    // A count, not a list: the names wait behind the click.
    expect(screen.queryByText('pilot-a')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByText('pilot-a')).toBeTruthy()
    expect(screen.getByText('pilot-b')).toBeTruthy()
    expect(screen.getByText(`@${TIP.slice(0, 7)} @bbbbbbb`)).toBeTruthy()
    // Filtered by set AND registration: neither stray run leaks into this row.
    expect(screen.queryByText(/other-set-run|other-repo-run/)).toBeNull()
  })

  it('removal is two clicks and names the registration, not the path', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('registry.remove'))
    expect(h.unregister).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('registry.removeConfirm'))
    await waitFor(() => { expect(h.unregister).toHaveBeenCalledWith('s1', 'dataseek-eval') })
    await waitFor(() => { expect(h.instance.getSnapshot().refreshRev).toBe(1) })
  })
})

describe('the register form', () => {
  it('the live preview drives the per-set chips; confirm sends exactly what they show', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('registry.register'))
    fireEvent.change(screen.getByLabelText('register.path'), { target: { value: '/repo/' } })
    expect(await screen.findByText(/register\.preview\.ok .*"count":2.*"ref":"main"/)).toBeTruthy()
    expect(h.previewRepo).toHaveBeenCalledWith('s1', '/repo', undefined)
    expect(h.register).not.toHaveBeenCalled()
    // A sensitive layer is offered, marked, and not picked by default.
    expect(screen.getByText('grading · register.sensitive')).toBeTruthy()
    fireEvent.click(screen.getByText('grading · register.sensitive'))
    fireEvent.change(screen.getByLabelText('register.id'), { target: { value: 'dataseek' } })
    fireEvent.click(screen.getByText('register.submit'))
    await waitFor(() => {
      expect(h.register).toHaveBeenCalledWith('s1', {
        path: '/repo',
        id: 'dataseek',
        trackedRef: 'main',
        sets: { alpha: { layers: ['visible'] }, beta: { layers: ['grading', 'visible'] } },
        authoringCheckout: '/repo',
      })
    })
    await waitFor(() => { expect(h.instance.getSnapshot().refreshRev).toBe(1) })
  })

  it('the branch dropdown re-previews at the picked branch', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('registry.register'))
    fireEvent.change(screen.getByLabelText('register.path'), { target: { value: '/repo' } })
    expect(await screen.findByText(/register\.preview\.ok/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('register.branch'), { target: { value: 'i1-walk' } })
    await waitFor(() => { expect(h.previewRepo).toHaveBeenCalledWith('s1', '/repo', 'i1-walk') })
  })

  it('a set with no layer picked blocks confirm with a hint', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('registry.register'))
    fireEvent.change(screen.getByLabelText('register.path'), { target: { value: '/repo' } })
    expect(await screen.findByText(/register\.preview\.ok/)).toBeTruthy()
    // alpha's only chip.
    fireEvent.click(screen.getAllByText('visible')[0]!)
    expect(await screen.findByText('register.keepOne')).toBeTruthy()
    expect((screen.getByText('register.submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a repository registered already is said before anything is filled in', async () => {
    const h = makeHarness()
    h.previewRepo.mockResolvedValue({ ok: true, value: { ...PREVIEW, registeredAs: 'dataseek-eval' } })
    renderView(h)
    fireEvent.click(await screen.findByText('registry.register'))
    fireEvent.change(screen.getByLabelText('register.path'), { target: { value: '/repo' } })
    expect(await screen.findByText(/registered already as "dataseek-eval"/)).toBeTruthy()
    expect((screen.getByText('register.submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a refused preview surfaces the host\'s sentence', async () => {
    const h = makeHarness()
    h.previewRepo.mockResolvedValue({ ok: false, error: { code: 'NOT_A_REPO', message: '/nowhere is not a git repository' } })
    renderView(h)
    fireEvent.click(await screen.findByText('registry.register'))
    fireEvent.change(screen.getByLabelText('register.path'), { target: { value: '/nowhere' } })
    expect(await screen.findByText(/not a git repository/)).toBeTruthy()
  })

  it('the browse button hides when the host cannot show a native chooser', async () => {
    const h = makeHarness()
    renderView(h, { canPick: false })
    fireEvent.click(await screen.findByText('registry.register'))
    expect(screen.queryByText('register.browse')).toBeNull()
    cleanup()

    const picking = makeHarness()
    renderView(picking)
    fireEvent.click(await screen.findByText('registry.register'))
    fireEvent.click(screen.getByText('register.browse'))
    await waitFor(() => { expect(picking.previewRepo).toHaveBeenCalledWith('s1', '/picked-repo', undefined) })
  })

  it('edit keeps the id and sends an update', async () => {
    const h = makeHarness()
    h.previewRepo.mockResolvedValue({
      ok: true,
      value: { ...PREVIEW, commonDir: ENTRY.commonDir, registeredAs: 'dataseek-eval', defaultRef: 'i1-walk', sets: [PREVIEW.sets[0]!] },
    })
    renderView(h)
    fireEvent.click(await screen.findByText('registry.edit'))
    expect(await screen.findByText(/register\.titleEdit .*dataseek-eval/)).toBeTruthy()
    expect(await screen.findByText(/register\.preview\.ok/)).toBeTruthy()
    fireEvent.click(screen.getByText('register.save'))
    await waitFor(() => {
      expect(h.updateRegistration).toHaveBeenCalledWith('s1', expect.objectContaining({
        id: 'dataseek-eval', trackedRef: 'i1-walk', sets: { alpha: { layers: ['visible'] } },
      }))
    })
  })
})

describe('the one-click import', () => {
  it('reports each folded registration and marks a dangling binding, by name, not path', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('registry.import'))
    expect(await screen.findByText(/import\.done .*"created":1,"merged":0/)).toBeTruthy()
    expect(screen.getByText(/import\.created .*"id":"dataseek-eval".*"sessions":3.*"paths":2/)).toBeTruthy()
    const dangling = screen.getByText(/import\.dangling .*"name":"old-scratch"/)
    expect(dangling.textContent).toContain('import.why.missing')
    // The path and the host's sentence ride on the title.
    expect(dangling.getAttribute('title')).toContain('/tmp/old-scratch')
    await waitFor(() => { expect(h.instance.getSnapshot().refreshRev).toBe(1) })
  })

  it('nothing to import says so', async () => {
    const h = makeHarness()
    h.importBindings.mockResolvedValue({ ok: true, value: { imported: [], dangling: [] } })
    renderView(h)
    fireEvent.click(await screen.findByText('registry.import'))
    expect(await screen.findByText('import.nothing')).toBeTruthy()
  })
})

describe('the detail page', () => {
  it('marks every file with its slot AND who sees it', async () => {
    const h = makeHarness()
    await openItem(h)
    expect(h.listDatasets).toHaveBeenCalledWith('s1', 'dataseek-eval', 'bench')
    // The register layout's display paths, each carrying the right pair.
    expect(await screen.findByText('task.md')).toBeTruthy()
    const marks = screen.getAllByText(/slot\.\w+ · role\.\w+/).map(node => node.textContent)
    expect(marks).toContain('slot.prompt · role.player')
    expect(marks).toContain('slot.standards · role.player')
    expect(marks).toContain('slot.rubric · role.judge')
    expect(marks).toContain('slot.oracle · role.judge')
    expect(marks).toContain('slot.checks · role.probe')
    // item.json is in no layer: readable by everyone, and it says so.
    expect(marks).toContain('slot.other · role.passthrough')
  })

  it('the slot filter narrows the tree by the marking', async () => {
    const h = makeHarness()
    await openItem(h)
    expect(await screen.findByText('answers/rubric.yml')).toBeTruthy()
    // Scoped to the tree: «选手将看到» lists the player's files too, and it is
    // a projection of the ITEM, not of the filter.
    const tree = (): HTMLElement => screen.getByRole('navigation')
    fireEvent.click(screen.getByText('slot.prompt'))
    // Only the 题干 survives — the grading and verify files are gone, and so
    // are the layer groups that held them.
    await waitFor(() => { expect(tree().textContent).not.toContain('answers/rubric.yml') })
    expect(tree().textContent).toContain('task.md')
    expect(tree().textContent).not.toContain('standards.yml')
    expect(tree().textContent).not.toContain('grading')
    // Back to everything.
    fireEvent.click(screen.getByText('detail.filterAll'))
    await waitFor(() => { expect(tree().textContent).toContain('answers/rubric.yml') })
  })

  it('«选手将看到» lists the player’s bytes and marks the dataset-level ones', async () => {
    const h = makeHarness()
    await openItem(h)
    expect(await screen.findByText('detail.player')).toBeTruthy()
    expect(h.itemBrief).toHaveBeenCalledWith('s1', 'dataseek-eval', 'bench', 'R1')
    expect(screen.getByText(/detail\.playerSummary .*"count":3.*"bytes":300/)).toBeTruthy()
    // The shared stage prompt is marked as dataset-level, so a reader can tell
    // what is this item's and what every item carries.
    expect(screen.getByText('detail.playerShared')).toBeTruthy()
    // The answer key is NOT in the list — that is what this panel is for.
    const panel = screen.getByText('detail.player').closest('section')
    expect(panel?.textContent).toContain('task.md')
    expect(panel?.textContent).not.toContain('rubric')
  })

  it('«只有判官和探针看得到» sits beside «选手将看到» and lists exactly the non-model-facing files', async () => {
    const h = makeHarness()
    await openItem(h)
    expect(await screen.findByText('detail.judgeOnly')).toBeTruthy()
    const player = screen.getByText('detail.player').closest('section')
    const judge = screen.getByText('detail.judgeOnly').closest('section')
    expect(player?.parentElement).toBe(judge?.parentElement)
    expect(judge?.textContent).toContain('grading/answers/rubric.yml')
    expect(judge?.textContent).toContain('grading/answers/oracle/notes.md')
    expect(judge?.textContent).toContain('verify/checks/probes/link-check.mjs')
    expect(judge?.textContent).not.toContain('task.md')
    expect(judge?.textContent).toContain('tree.fileCount {"count":3}')
  })

  it('«可判性» counts the rubric’s leaves per kind, the probes and the schemas', async () => {
    const h = makeHarness()
    await openItem(h)
    expect(await screen.findByText('detail.judge')).toBeTruthy()
    const line = screen.getByText('detail.judge').parentElement?.textContent ?? ''
    expect(line).toContain('"leaves":2')
    expect(line).toContain('"kind":"objective","count":1')
    expect(line).toContain('"kind":"llm-draft","count":1')
    expect(line).toContain('detail.judgeProbes {"count":1}')
    expect(line).toContain('detail.judgeSchemas {"count":1}')
  })

  it('«作答记录» is absent without an eval plugin, and present with one', async () => {
    const withoutEval = makeHarness()
    await openItem(withoutEval)
    expect(await screen.findByText('detail.player')).toBeTruthy()
    // Absent, not an empty section: the orchestrator is not installed.
    expect(screen.queryByText('detail.runs')).toBeNull()
    cleanup()

    const withEval = makeHarness()
    withEval.itemRuns.mockResolvedValue(RUNS)
    await openItem(withEval)
    expect(await screen.findByText('detail.runs')).toBeTruthy()
    expect(screen.getByText('pilot-a')).toBeTruthy()
    // ui-spec §九: the bucket and the stage are the same two chips the
     // 实验室 tab draws, so the row's own sentence is just 条件 × rep.
    expect(screen.getByText(/detail\.runsCell .*dsh-exec.*"rep":1/)).toBeTruthy()
    expect(screen.getByText('bucket.done')).toBeTruthy()
    expect(screen.getByText('llm-draft 2')).toBeTruthy()
  })

  it('an eval that answers nothing keeps the area, carrying its own reason', async () => {
    const h = makeHarness()
    h.itemRuns.mockResolvedValue({ runs: [], notes: ['no mission service: run records live in the mission ledger'] })
    await openItem(h)
    expect(await screen.findByText('detail.runs')).toBeTruthy()
    expect(screen.getByText('detail.runsEmpty')).toBeTruthy()
    expect(screen.getByText(/no mission service/)).toBeTruthy()
  })

  it('previews a selected file through the official reader', async () => {
    const h = makeHarness()
    await openItem(h)
    fireEvent.click(await screen.findByText('task.md'))
    expect(h.readFile).toHaveBeenCalledWith('s1', 'dataseek-eval', {
      dataset: 'bench', item: 'R1', layer: 'visible', path: 'task.md',
    })
    expect(await screen.findByText('Task')).toBeTruthy()
    expect(screen.getByText('@a4f9c2e')).toBeTruthy()
  })

  it('reads item.json and the passthrough zone through the operator channel', async () => {
    const h = makeHarness()
    await openItem(h)
    fireEvent.click(await screen.findByText('item.json'))
    expect(h.readPassthroughFile).toHaveBeenCalledWith('s1', 'dataseek-eval', { dataset: 'bench', path: 'items/R1/item.json' })
    fireEvent.click(screen.getByText(/tree\.passthrough /))
    fireEvent.click(await screen.findByText('manifest.yml'))
    expect(h.readPassthroughFile).toHaveBeenCalledWith('s1', 'dataseek-eval', { dataset: 'bench', path: 'manifest.yml' })
  })

  it('the heading names the reference, the tracked branch\'s tip and the readable layers', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('bench'))
    expect(await screen.findByText('dataseek-eval/bench · i1-walk@a4f9c2e')).toBeTruthy()
    expect(h.overview).toHaveBeenCalledWith('s1', 'dataseek-eval')
  })

  it('the heading\u2019s layer word opens the same edit form', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('bench'))
    expect(await screen.findByText('dataseek-eval/bench · i1-walk@a4f9c2e')).toBeTruthy()
    fireEvent.click(screen.getByText('layers.edit'))
    expect(await screen.findByText(/register\.titleEdit .*dataseek-eval/)).toBeTruthy()
  })

  it('going back returns to the list', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('bench'))
    expect(await screen.findByText('detail.itemsLabel')).toBeTruthy()
    fireEvent.click(screen.getByText('detail.back'))
    expect(await screen.findByText('registry.register')).toBeTruthy()
    expect(screen.getByText('i1-walk@a4f9c2e')).toBeTruthy()
  })
})

describe('the write gestures', () => {
  it('exist only on a registration with an authoring checkout', async () => {
    const h = makeHarness([rowOf({ ...ENTRY, authoringCheckout: null })])
    renderView(h)
    expect(await screen.findByText('registry.noAuthoring')).toBeTruthy()
    expect(screen.queryByText('list.newDataset')).toBeNull()
    fireEvent.click(await screen.findByText('bench'))
    expect(await screen.findByText('detail.validate')).toBeTruthy()
    expect(screen.queryByText('detail.newItem')).toBeNull()
    expect(screen.queryByText('detail.importItem')).toBeNull()
  })

  it('the item skeleton writes into the authoring checkout and says the commit is the human\u2019s', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('bench'))
    fireEvent.click(await screen.findByText('detail.newItem'))
    fireEvent.change(screen.getByLabelText('form.itemId'), { target: { value: 'C2' } })
    fireEvent.click(screen.getByText('form.submit'))
    await waitFor(() => {
      expect(h.scaffoldItem).toHaveBeenCalledWith('s1', 'dataseek-eval', { dataset: 'bench', item: 'C2' })
    })
    expect(await screen.findByText('datasets/bench/items/C2/visible/task.md')).toBeTruthy()
    expect(screen.getByText('skeleton.commitHint')).toBeTruthy()
  })

  it('the dataset skeleton targets the heading\'s registration and takes an id', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('list.newDataset'))
    expect((screen.getByText('form.submit') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('form.datasetId'), { target: { value: 'fresh' } })
    fireEvent.click(screen.getByText('form.submit'))
    await waitFor(() => { expect(h.scaffoldDataset).toHaveBeenCalledWith('s1', 'dataseek-eval', { id: 'fresh' }) })
  })

  it('importing an item asks for the source directory', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('bench'))
    fireEvent.click(await screen.findByText('detail.importItem'))
    fireEvent.change(screen.getByLabelText('form.itemId'), { target: { value: 'IM1' } })
    fireEvent.change(screen.getByLabelText('form.sourceDir'), { target: { value: '/tmp/item' } })
    fireEvent.click(screen.getByText('form.submit'))
    await waitFor(() => {
      expect(h.importItem).toHaveBeenCalledWith('s1', 'dataseek-eval', { dataset: 'bench', item: 'IM1', sourceDir: '/tmp/item' })
    })
  })

  it('validate reports what it found, error codes included', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('bench'))
    fireEvent.click(await screen.findByText('detail.validate'))
    await waitFor(() => { expect(h.validateDataset).toHaveBeenCalledWith('s1', 'dataseek-eval', 'bench') })
    expect(await screen.findByText(/detail\.validateFound .*"errors":1/)).toBeTruthy()
    expect(screen.getByTitle('RUBRIC_NO_ITEMS')).toBeTruthy()
  })

  it('a refused write surfaces the host\u2019s message instead of a silent no-op', async () => {
    const h = makeHarness()
    h.scaffoldDataset.mockResolvedValue({ ok: false, error: { code: 'SHAPE_INVALID', message: 'dataset "fresh" already exists' } })
    renderView(h)
    fireEvent.click(await screen.findByText('list.newDataset'))
    fireEvent.change(screen.getByLabelText('form.datasetId'), { target: { value: 'fresh' } })
    fireEvent.click(screen.getByText('form.submit'))
    expect(await screen.findByText('dataset "fresh" already exists')).toBeTruthy()
  })
})
