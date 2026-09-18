// @vitest-environment jsdom
/**
 * The 题集 tab under the four-share props form: a real store instance
 * (createDatasetsViewStore().create()) and injected Remote mocks.
 *
 * What the assertions are about, page by page: the LIST row carries every cell
 * ui-spec §四 asks for; the DETAIL tree marks each file with its slot AND who
 * sees it, and the slot filter narrows by that marking; «选手将看到» lists the
 * player's bytes and nothing else; «作答记录» is ABSENT — not empty — on an
 * instance with no eval plugin, because an empty section promises a feature
 * that is not installed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  DatasetBinding, DatasetOverview, ItemBrief, ListDatasetsResult, ListItemsResult,
  PreviewRepoResult, ReadResult, SkeletonResult, ValidateResult,
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

interface Harness {
  instance: Instance
  actions: Instance['actions']
  fetchBinding: ReturnType<typeof vi.fn>
  bindSession: ReturnType<typeof vi.fn>
  unbindSession: ReturnType<typeof vi.fn>
  listDatasets: ReturnType<typeof vi.fn>
  readFile: ReturnType<typeof vi.fn>
  readPassthroughFile: ReturnType<typeof vi.fn>
  pickDirectory: ReturnType<typeof vi.fn>
  previewRepo: ReturnType<typeof vi.fn>
  overview: ReturnType<typeof vi.fn>
  itemBrief: ReturnType<typeof vi.fn>
  validateDataset: ReturnType<typeof vi.fn>
  scaffoldDataset: ReturnType<typeof vi.fn>
  scaffoldItem: ReturnType<typeof vi.fn>
  importItem: ReturnType<typeof vi.fn>
  itemRuns: ReturnType<typeof vi.fn>
  datasetExperiments: ReturnType<typeof vi.fn>
}

const BINDING: DatasetBinding = { repoPath: '/repo', layers: ['visible'] }

/** The list page's answer: one dataset shaped like harness-comparison. */
const OVERVIEW: DatasetOverview = {
  repo: '/work/dataseek-eval',
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

const PREVIEW: PreviewRepoResult = {
  repo: '/repo',
  datasets: [
    { id: 'alpha', name: 'Alpha', layers: ['visible'], nonModelFacingLayers: [], itemCount: 1, warnings: [] },
    { id: 'beta', layers: ['visible', 'grading'], nonModelFacingLayers: ['grading'], itemCount: 3, warnings: [] },
  ],
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

function makeHarness(binding: DatasetBinding | null = BINDING): Harness {
  const instance = createDatasetsViewStore().create()
  return {
    instance,
    actions: instance.actions,
    fetchBinding: vi.fn(async (): Promise<Result<DatasetBinding | null>> => ({ ok: true, value: binding })),
    bindSession: vi.fn(async (_sid: string, next: DatasetBinding): Promise<Result<DatasetBinding>> => ({ ok: true, value: next })),
    unbindSession: vi.fn(async (): Promise<Result<DatasetBinding | null>> => ({ ok: true, value: null })),
    listDatasets: vi.fn(async (): Promise<Result<ListDatasetsResult | ListItemsResult>> => ({ ok: true, value: ITEMS })),
    readFile: vi.fn(async (): Promise<Result<ReadResult>> => ({ ok: true, value: { content: '# Task\n\nbody\n', commit: 'a4f9c2e0000' } })),
    readPassthroughFile: vi.fn(async (): Promise<Result<ReadResult>> => ({ ok: true, value: { content: '# Passthrough content\n', commit: 'a4f9c2e0000' } })),
    pickDirectory: vi.fn(async () => '/picked-repo'),
    previewRepo: vi.fn(async (): Promise<Result<PreviewRepoResult>> => ({ ok: true, value: PREVIEW })),
    overview: vi.fn(async (): Promise<Result<DatasetOverview>> => ({ ok: true, value: OVERVIEW })),
    itemBrief: vi.fn(async (): Promise<Result<ItemBrief>> => ({ ok: true, value: BRIEF })),
    validateDataset: vi.fn(async (): Promise<Result<ValidateResult>> => ({ ok: true, value: VALIDATED })),
    scaffoldDataset: vi.fn(async (): Promise<Result<SkeletonResult>> => ({ ok: true, value: SKELETON })),
    scaffoldItem: vi.fn(async (): Promise<Result<SkeletonResult>> => ({ ok: true, value: SKELETON })),
    importItem: vi.fn(async (): Promise<Result<SkeletonResult>> => ({ ok: true, value: SKELETON })),
    // The default instance carries NO eval plugin: null is «not installed».
    itemRuns: vi.fn(async (): Promise<ItemRunsOrNull> => null),
    datasetExperiments: vi.fn(async () => null),
  }
}

/** The answer shape of the degrading eval probe. */
type ItemRunsOrNull = ItemRunsView | null

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
    fetchBinding: h.fetchBinding,
    bindSession: h.bindSession,
    unbindSession: h.unbindSession,
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
    previewRepo: h.previewRepo,
    t: (key: string, params?: Record<string, unknown>) => (
      params === undefined ? key : `${key} ${JSON.stringify(params)}`
    ),
  } as unknown as DatasetsViewProps
  return render(<DatasetsView {...props} />)
}

/** Open the detail page of the only dataset, and its only item. */
async function openItem(h: Harness): Promise<void> {
  renderView(h)
  fireEvent.click(await screen.findByText('bench'))
  fireEvent.click(await screen.findByText('R1'))
}

afterEach(() => { cleanup() })

describe('the list page', () => {
  it('carries every cell the spec asks for, in one RPC', async () => {
    const h = makeHarness()
    renderView(h)
    expect(await screen.findByText('bench')).toBeTruthy()
    expect(h.overview).toHaveBeenCalledWith('s1')
    // The list never fires the per-dataset item read: the rows are one call.
    expect(h.listDatasets).not.toHaveBeenCalled()
    expect(screen.getByText('Bench set')).toBeTruthy()
    // 快照: the repository's own last segment, at the short commit.
    expect(screen.getByText('dataseek-eval @ a4f9c2e')).toBeTruthy()
    expect(screen.getByText(/list\.itemCount .*"count":2/)).toBeTruthy()
    // 槽位 ← 层: the vocabulary is the slot word, the layer is the right side.
    expect(screen.getByText(/list\.slotLayer .*slot\.prompt.*visible/)).toBeTruthy()
    expect(screen.getByText(/list\.slotLayer .*slot\.rubric.*grading/)).toBeTruthy()
    // The passthrough zone reports as a zone, never as a layer named '-'.
    expect(screen.getByText(/list\.slotLayer .*slot\.other.*list\.passthroughLayer/)).toBeTruthy()
    expect(screen.getByText('list.canaryOn')).toBeTruthy()
    expect(screen.getByText(/list\.validateOk/)).toBeTruthy()
  })

  it('drops the 用于的实验 column entirely when no eval plugin answers', async () => {
    const h = makeHarness()
    renderView(h)
    expect(await screen.findByText('bench')).toBeTruthy()
    // Not an empty column of em dashes: the header is absent, because an
    // instance without the orchestrator has no notion of an experiment.
    expect(screen.queryByText('list.colExperiments')).toBeNull()
  })

  it('shows the experiments that used a dataset when one does', async () => {
    const h = makeHarness()
    h.datasetExperiments.mockResolvedValue([
      { id: 'run-1', name: 'pilot-a', status: 'done', datasetId: 'bench' },
      { id: 'run-2', name: 'other-set-run', status: 'done', datasetId: 'elsewhere' },
    ])
    renderView(h)
    expect(await screen.findByText('list.colExperiments')).toBeTruthy()
    expect(await screen.findByText('pilot-a')).toBeTruthy()
    // Filtered by dataset: another set's run never leaks into this row.
    expect(screen.queryByText('other-set-run')).toBeNull()
  })

  it('unbound: offers the import gesture and never lists', async () => {
    const h = makeHarness(null)
    renderView(h)
    expect(await screen.findByText('binding.none')).toBeTruthy()
    expect(h.overview).not.toHaveBeenCalled()
    expect(screen.getByText('list.unbound')).toBeTruthy()
    expect(screen.getByText('binding.bind')).toBeTruthy()
  })

  it('a failed binding fetch settles the bar instead of loading forever', async () => {
    const h = makeHarness()
    h.fetchBinding.mockResolvedValue({ ok: false, error: { code: 'internal', message: 'resume failed' } })
    renderView(h)
    expect(await screen.findByText('binding.none')).toBeTruthy()
    expect(await screen.findByText(/list\.error/)).toBeTruthy()
  })
})

describe('the detail page', () => {
  it('marks every file with its slot AND who sees it', async () => {
    const h = makeHarness()
    await openItem(h)
    expect(h.listDatasets).toHaveBeenCalledWith('s1', 'bench')
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
    expect(h.itemBrief).toHaveBeenCalledWith('s1', 'bench', 'R1')
    expect(screen.getByText(/detail\.playerSummary .*"count":3.*"bytes":300/)).toBeTruthy()
    // The shared stage prompt is marked as dataset-level, so a reader can tell
    // what is this item's and what every item carries.
    expect(screen.getByText('detail.playerShared')).toBeTruthy()
    // The answer key is NOT in the list — that is what this panel is for.
    const panel = screen.getByText('detail.player').closest('section')
    expect(panel?.textContent).toContain('task.md')
    expect(panel?.textContent).not.toContain('rubric')
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
    expect(screen.getByText(/detail\.runsCell .*dsh-exec.*"rep":1.*done/)).toBeTruthy()
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
    expect(h.readFile).toHaveBeenCalledWith('s1', {
      dataset: 'bench', item: 'R1', layer: 'visible', path: 'task.md',
    })
    expect(await screen.findByText('Task')).toBeTruthy()
    expect(screen.getByText('@a4f9c2e')).toBeTruthy()
  })

  it('reads item.json and the passthrough zone through the operator channel', async () => {
    const h = makeHarness()
    await openItem(h)
    fireEvent.click(await screen.findByText('item.json'))
    expect(h.readPassthroughFile).toHaveBeenCalledWith('s1', { dataset: 'bench', path: 'items/R1/item.json' })
    fireEvent.click(screen.getByText(/tree\.passthrough /))
    fireEvent.click(await screen.findByText('manifest.yml'))
    expect(h.readPassthroughFile).toHaveBeenCalledWith('s1', { dataset: 'bench', path: 'manifest.yml' })
  })

  it('going back returns to the list', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('bench'))
    expect(await screen.findByText('detail.itemsLabel')).toBeTruthy()
    fireEvent.click(screen.getByText('detail.back'))
    expect(await screen.findByText('list.colDataset')).toBeTruthy()
  })
})

describe('the write gestures', () => {
  it('the item skeleton writes into the working tree and says the commit is the human’s', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('bench'))
    fireEvent.click(await screen.findByText('detail.newItem'))
    fireEvent.change(screen.getByLabelText('form.itemId'), { target: { value: 'C2' } })
    fireEvent.click(screen.getByText('form.submit'))
    await waitFor(() => {
      expect(h.scaffoldItem).toHaveBeenCalledWith('s1', { dataset: 'bench', item: 'C2' })
    })
    // The result names every path it wrote, and the standing reminder that the
    // tree and validate read HEAD — so nothing looks broken when the new file
    // does not appear in the tree.
    expect(await screen.findByText('datasets/bench/items/C2/visible/task.md')).toBeTruthy()
    expect(screen.getByText('skeleton.commitHint')).toBeTruthy()
  })

  it('the dataset skeleton takes an id and an optional name', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('list.newDataset'))
    // The submit stays disabled until the required id is typed.
    expect((screen.getByText('form.submit') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('form.datasetId'), { target: { value: 'fresh' } })
    fireEvent.click(screen.getByText('form.submit'))
    await waitFor(() => { expect(h.scaffoldDataset).toHaveBeenCalledWith('s1', { id: 'fresh' }) })
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
      expect(h.importItem).toHaveBeenCalledWith('s1', { dataset: 'bench', item: 'IM1', sourceDir: '/tmp/item' })
    })
  })

  it('validate reports what it found, error codes included', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('bench'))
    fireEvent.click(await screen.findByText('detail.validate'))
    await waitFor(() => { expect(h.validateDataset).toHaveBeenCalledWith('s1', 'bench') })
    expect(await screen.findByText(/detail\.validateFound .*"errors":1/)).toBeTruthy()
    expect(screen.getByText(/RUBRIC_NO_ITEMS/)).toBeTruthy()
  })

  it('a refused write surfaces the host’s message instead of a silent no-op', async () => {
    const h = makeHarness()
    h.scaffoldDataset.mockResolvedValue({ ok: false, error: { code: 'SHAPE_INVALID', message: 'dataset "fresh" already exists' } })
    renderView(h)
    fireEvent.click(await screen.findByText('list.newDataset'))
    fireEvent.change(screen.getByLabelText('form.datasetId'), { target: { value: 'fresh' } })
    fireEvent.click(screen.getByText('form.submit'))
    expect(await screen.findByText('dataset "fresh" already exists')).toBeTruthy()
  })
})

describe('the binding bar', () => {
  it('bind form: the live preview drives the chips; confirm submits the picked subsets', async () => {
    const h = makeHarness(null)
    renderView(h)
    fireEvent.click(await screen.findByText('binding.bind'))
    fireEvent.change(screen.getByLabelText('binding.form.repo'), { target: { value: '/repo/' } })
    expect(await screen.findByText(/binding\.form\.preview\.ok/)).toBeTruthy()
    expect(h.bindSession).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('binding.form.restrict'))
    expect(await screen.findByText('beta · 3')).toBeTruthy()
    expect(screen.getByText('grading · binding.form.sensitive')).toBeTruthy()
    fireEvent.click(screen.getByText('binding.form.taskFacingOnly'))
    fireEvent.click(screen.getByText('binding.form.submit'))
    await waitFor(() => {
      // The stored repoPath is the preview's canonical toplevel (trailing slash gone).
      expect(h.bindSession).toHaveBeenCalledWith('s1', { repoPath: '/repo', layers: ['visible'] })
    })
    await waitFor(() => { expect(h.instance.getSnapshot().refreshRev).toBe(1) })
  })

  it('unbind clears the binding through the Remote', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('binding.unbind'))
    await waitFor(() => { expect(h.unbindSession).toHaveBeenCalledWith('s1') })
    await waitFor(() => { expect(h.instance.getSnapshot().refreshRev).toBe(1) })
  })

  it('the browse button hides when the host cannot show a native chooser', async () => {
    const h = makeHarness(null)
    renderView(h, { canPick: false })
    fireEvent.click(await screen.findByText('binding.bind'))
    expect(screen.queryByText('binding.form.browse')).toBeNull()
    // The workspace shortcut stays — it needs no native capability.
    expect(screen.getByText('binding.form.useWorkspace')).toBeTruthy()
  })
})
