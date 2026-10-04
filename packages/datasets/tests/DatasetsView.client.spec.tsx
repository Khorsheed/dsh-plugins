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
 * plugin. T90: 「添加题集」 hands the request to a new 题集整理 session (no
 * dataset write from the tab), proposals and held versions surface as
 * 「等你确认登记」 banners, and the review confirms exactly the layer choice
 * it shows — blocked while the host reports a problem.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  DatasetOverview, ImportBindingsResult, ItemBrief, ListDatasetsResult, ListItemsResult,
  Proposal, ProposalReview, ReadResult, RegisterPreview, RegistryEntry, RegistryRow, ValidateResult,
} from '../src/types.ts'
import type { DatasetsViewProps, ItemRunsView } from '../src/client/contract.ts'
import { DatasetsView } from '../src/client/DatasetsView.tsx'
import { setUsage } from '../src/client/RegistryList.tsx'
import { createDatasetsViewStore } from '../src/client/store.ts'
import { createReviewFocus } from '../src/client/review-card.ts'

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
  organizingSetup: Mock
  proposals: Mock
  proposalReview: Mock
  reviewItem: Mock
  reviewFiles: Mock
  confirmProposal: Mock
  returnProposal: Mock
  pendingReview: Mock
  confirmPending: Mock
  startOrganizing: Mock
  draftInSession: Mock
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

const PROPOSAL: Proposal = {
  id: 'p1',
  createdAt: '2026-09-30T08:00:00.000Z',
  updatedAt: '2026-09-30T08:00:00.000Z',
  status: 'pending',
  kind: 'new',
  repo: '/home/user/.dsh/datasets/gsm8k',
  commonDir: '/home/user/.dsh/datasets/gsm8k/.git',
  checkout: '/home/user/.dsh/datasets/gsm8k',
  trackedRef: 'main',
  commit: TIP,
  registryId: 'gsm8k',
  sessionId: 'organizer-1',
  source: { kind: 'public', label: 'GSM8K', path: '/home/user/Downloads/gsm8k', license: 'MIT' },
  mapping: { outputs: [] },
  samples: [{ set: 'gsm8k', item: 'test-0001' }],
  notes: 'Both splits in one set.',
}

const REVIEW: ProposalReview = {
  proposal: PROPOSAL,
  facts: {
    itemCount: 3,
    sets: [{
      set: 'gsm8k', title: 'GSM8K', itemCount: 3,
      layers: [
        { name: 'prompt', modelFacing: true, suggested: true, reason: 'the question' },
        { name: 'grading', modelFacing: false, suggested: false, reason: 'the answer' },
      ],
    }],
    validate: { ok: true, errors: [], warnings: 0 },
    version: { number: 4, date: '2026-09-30T08:00:00+08:00', commit: TIP, trackedRef: 'main', commonDir: '/home/user/.dsh/datasets/gsm8k/.git', checkout: '/home/user/.dsh/datasets/gsm8k' },
  },
  compare: {
    mode: 'new',
    summary: { split: 1, copy: 0, new: 2, unused: 1, added: 0, modified: 0, deleted: 0, outside: 0 },
    sources: [
      { path: 'test.jsonl', disposition: 'split', target: 'datasets/gsm8k/items/', count: 3, files: 1, counted: 3, fields: [{ name: 'question', to: 'prompt/question.md' }, { name: 'answer', to: 'grading/answer.md' }] },
      { path: 'README.md', disposition: 'unused', reason: 'dataset card', files: 1 },
    ],
    sourceRead: true,
    outputs: [
      { path: 'datasets/gsm8k/dataset.json', origin: 'new', files: 1, items: 0, zone: 'descriptor', set: 'gsm8k' },
      { path: 'datasets/gsm8k/items/*/prompt/question.md', origin: 'split', from: 'test.jsonl', field: 'question', files: 3, items: 3, zone: 'layer', set: 'gsm8k', layer: 'prompt' },
      { path: 'datasets/gsm8k/notes.md', origin: 'new', files: 1, items: 0, zone: 'passthrough', set: 'gsm8k' },
    ],
    unlayered: ['datasets/gsm8k/notes.md'],
  },
  problems: [],
  warnings: [],
  items: [{ set: 'gsm8k', item: 'test-0001' }, { set: 'gsm8k', item: 'test-0002' }, { set: 'gsm8k', item: 'test-0003' }],
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
    organizingSetup: vi.fn(async () => ({ ok: true, value: { preset: 'dataset-authoring', datasetsHome: '/home/user/.dsh/datasets' } })),
    proposals: vi.fn(async (): Promise<Result<Proposal[]>> => ({ ok: true, value: [] })),
    proposalReview: vi.fn(async (): Promise<Result<ProposalReview>> => ({ ok: true, value: REVIEW })),
    reviewItem: vi.fn(async (_sid: string, _id: string, set: string, item: string) => ({
      ok: true,
      value: {
        set, item,
        files: [{ path: `datasets/${set}/items/${item}/prompt/question.md`, zone: 'layer', layer: 'prompt', origin: 'split', from: 'test.jsonl', field: 'question', bytes: 9, excerpt: 'What is 2+2?' }],
        source: { file: 'test.jsonl', line: 1, record: '{"question":"What is 2+2?"}' },
      },
    })),
    reviewFiles: vi.fn(async () => ({ ok: true, value: { outputs: [{ path: 'datasets/gsm8k/dataset.json', zone: 'descriptor', origin: 'new' }], sources: [], truncated: false } })),
    confirmProposal: vi.fn(async (_sid: string, _id: string, registryId: string) => ({ ok: true, value: { ...ENTRY, id: registryId } })),
    returnProposal: vi.fn(async () => ({ ok: true, value: { ...PROPOSAL, status: 'returned' } })),
    pendingReview: vi.fn(async () => ({ ok: true, value: null })),
    confirmPending: vi.fn(async () => ({ ok: true, value: ENTRY })),
    startOrganizing: vi.fn(async (): Promise<unknown> => ({ kind: 'drafted', sessionId: 'organizer-2' })),
    draftInSession: vi.fn(async (target: string): Promise<unknown> => ({ kind: 'drafted', sessionId: target })),
    // The default instance carries NO eval plugin: null is «not installed».
    itemRuns: vi.fn(async (): Promise<ItemRunsView | null> => null),
    datasetExperiments: vi.fn(async () => null),
  }
}

function renderView(h: Harness, opts: { canPick?: boolean; extra?: Record<string, unknown> } = {}) {
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
    organizingSetup: h.organizingSetup,
    proposals: h.proposals,
    proposalReview: h.proposalReview,
    reviewItem: h.reviewItem,
    reviewFiles: h.reviewFiles,
    confirmProposal: h.confirmProposal,
    returnProposal: h.returnProposal,
    pendingReview: h.pendingReview,
    confirmPending: h.confirmPending,
    startOrganizing: h.startOrganizing,
    draftInSession: h.draftInSession,
    itemRuns: h.itemRuns,
    datasetExperiments: h.datasetExperiments,
    isLoopback: canPick,
    useHostDescription: ((sel: (d: { canOpenPath: boolean }) => unknown) => sel({ canOpenPath: canPick })) as never,
    pickDirectory: h.pickDirectory,
    t: (key: string, params?: Record<string, unknown>) => (
      params === undefined ? key : `${key} ${JSON.stringify(params)}`
    ),
    ...opts.extra,
  } as unknown as DatasetsViewProps
  return render(<DatasetsView {...props} />)
}

/** The register form now sits under 「添加题集」's 「高级」. */
async function openRegisterForm(): Promise<void> {
  fireEvent.click(await screen.findByText('registry.add'))
  fireEvent.click(await screen.findByText('add.advanced'))
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
    // Decision D: path, branch and checkout ride on the heading's title.
    expect(screen.getByTitle(/registry\.advancedTitle .*"ref":"i1-walk"/)).toBeTruthy()
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
    expect(screen.getByTitle(/\/work\/dataseek-eval\/\.git/)).toBeTruthy()
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
    // T87: ONE register button and ONE import link on screen — the bar's own
    // pair and the 「0 个」 count title step aside while the page is empty.
    expect(screen.getAllByRole('button', { name: /^registry\.(add|emptyAction)$/ })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'registry.import' })).toHaveLength(1)
    expect(screen.queryByText(/^registry\.title/)).toBeNull()
    fireEvent.click(screen.getByText('registry.emptyAction'))
    expect(await screen.findByText('add.title')).toBeTruthy()
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

  it('folds id-less runs of one experiment by name, not by run id', () => {
    // The older ledger re-ran a plan under one name without an experiment id.
    const run = { status: 'done', registry: 'dataseek-eval', datasetId: 'bench', experimentId: null }
    const usage = setUsage([
      { ...run, id: 'run-1', name: 'walk', commit: TIP },
      { ...run, id: 'run-2', name: 'walk', commit: 'b'.repeat(40) },
      { ...run, id: 'run-3', name: 'walk', commit: TIP },
      { ...run, id: 'run-4', name: 'other', commit: TIP },
    ], 'dataseek-eval', 'bench')
    expect(usage.experiments.map(entry => entry.name)).toEqual(['walk', 'other'])
    expect(usage.experiments[0]?.commits).toEqual([TIP, 'b'.repeat(40)])
    expect(usage.versions).toBe(2)
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
    await openRegisterForm()
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
    await openRegisterForm()
    fireEvent.change(screen.getByLabelText('register.path'), { target: { value: '/repo' } })
    expect(await screen.findByText(/register\.preview\.ok/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('register.branch'), { target: { value: 'i1-walk' } })
    await waitFor(() => { expect(h.previewRepo).toHaveBeenCalledWith('s1', '/repo', 'i1-walk') })
  })

  it('a set with no layer picked blocks confirm with a hint', async () => {
    const h = makeHarness()
    renderView(h)
    await openRegisterForm()
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
    await openRegisterForm()
    fireEvent.change(screen.getByLabelText('register.path'), { target: { value: '/repo' } })
    expect(await screen.findByText(/registered already as "dataseek-eval"/)).toBeTruthy()
    expect((screen.getByText('register.submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a refused preview surfaces the host\'s sentence', async () => {
    const h = makeHarness()
    h.previewRepo.mockResolvedValue({ ok: false, error: { code: 'NOT_A_REPO', message: '/nowhere is not a git repository' } })
    renderView(h)
    await openRegisterForm()
    fireEvent.change(screen.getByLabelText('register.path'), { target: { value: '/nowhere' } })
    expect(await screen.findByText(/not a git repository/)).toBeTruthy()
  })

  it('the browse button hides when the host cannot show a native chooser', async () => {
    const h = makeHarness()
    renderView(h, { canPick: false })
    await openRegisterForm()
    expect(screen.queryByText('register.browse')).toBeNull()
    cleanup()

    const picking = makeHarness()
    renderView(picking)
    await openRegisterForm()
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
    expect(screen.getByText(/^detail\.playerShared · /)).toBeTruthy()
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

  it('the item heading is a crumb in the content column; the cards flag the rubric and a missing check script (T83 · phase 4)', async () => {
    const h = makeHarness()
    h.itemBrief.mockResolvedValue({
      ok: true,
      value: { ...BRIEF, judgeability: { ...BRIEF.judgeability, probes: [] } },
    })
    h.itemRuns.mockResolvedValue({ runs: [RUNS.runs[0]!, { ...RUNS.runs[0]!, runId: 'run-2' }, { ...RUNS.runs[0]!, runId: 'run-3', name: 'pilot-b' }], notes: [] })
    await openItem(h)
    const judge = (await screen.findByText('detail.judgeOnly')).closest('section')
    // repo › set › item, read at the tracked ref and the brief's commit.
    const crumb = screen.getByRole('heading', { level: 5 })
    expect(crumb.textContent).toContain('dataseek-eval›bench›R1')
    expect(crumb.textContent).toContain('detail.readAt')
    expect(crumb.textContent).toContain('"commit":"a4f9c2e"')
    // The crumb sits in the scrolling content column, above the two cards.
    expect(crumb.compareDocumentPosition(judge!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The rubric carries its leaf count; no probe anywhere is said, in the card.
    expect(judge?.textContent).toContain('detail.judgeLeaves {"leaves":2}')
    expect(judge?.textContent).toContain('detail.noProbes')
    // The experiments that used it, once each.
    expect(await screen.findByText('detail.usedBy {"names":"pilot-a · pilot-b"}')).toBeTruthy()
  })

  it('one file per row; 用过 and 作答记录 show the newest five and fold the rest (T83 · phase 4 ruling)', async () => {
    const h = makeHarness()
    const base = RUNS.runs[0]!
    h.itemRuns.mockResolvedValue({
      runs: Array.from({ length: 7 }, (_, index) => ({ ...base, runId: `run-${String(index)}`, name: `exp-${String(index)}` })),
      notes: [],
    })
    await openItem(h)
    const player = (await screen.findByText('detail.player')).closest('section') as HTMLElement
    // A row per file, the size as the row's note.
    const rows = player.querySelectorAll('li')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.children).toHaveLength(2)
    const usedBy = await screen.findByText(/^detail\.usedBy /)
    expect(usedBy.textContent).toContain('exp-0 · exp-1 · exp-2 · exp-3 · exp-4"')
    expect(usedBy.textContent).not.toContain('exp-5')
    fireEvent.click(screen.getByRole('button', { name: /detail\.usedByMore \{"count":2\}/ }))
    expect(usedBy.textContent).toContain('exp-6')
    expect(screen.queryByRole('button', { name: /detail\.usedByMore/ })).toBeNull()
    // The answer record: five open, two behind the fold.
    const older = screen.getByText('detail.runsOlder {"count":2}').closest('details') as HTMLDetailsElement
    expect(older.open).toBe(false)
    expect(within(older).getByText('exp-5')).toBeTruthy()
    expect(within(older).queryByText('exp-4')).toBeNull()
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
    expect(await screen.findByText('registry.add')).toBeTruthy()
    expect(screen.getByText('i1-walk@a4f9c2e')).toBeTruthy()
  })
})

describe('the detail page tools', () => {
  it('validate reports what it found, error codes included', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('bench'))
    fireEvent.click(await screen.findByText('detail.validate'))
    await waitFor(() => { expect(h.validateDataset).toHaveBeenCalledWith('s1', 'dataseek-eval', 'bench') })
    expect(await screen.findByText(/detail\.validateFound .*"errors":1/)).toBeTruthy()
    expect(screen.getByTitle('RUBRIC_NO_ITEMS')).toBeTruthy()
  })

})

describe('添加题集 (T90)', () => {
  it('the dialog asks three things and drafts the request into a NEW 题集整理 session', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('registry.add'))
    expect(await screen.findByText('add.title')).toBeTruthy()
    expect(screen.getByText('add.git')).toBeTruthy()
    const go = screen.getByText('add.organize') as HTMLButtonElement
    expect(go.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('add.source', { selector: 'textarea' }), { target: { value: '~/Downloads/gsm8k' } })
    fireEvent.change(screen.getByLabelText('add.name', { selector: 'input' }), { target: { value: 'bad name' } })
    expect(screen.getByText('add.nameBad')).toBeTruthy()
    expect(go.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('add.name', { selector: 'input' }), { target: { value: 'gsm8k' } })
    expect(screen.getByText(/add\.repoAt .*\/home\/user\/\.dsh\/datasets\/gsm8k/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('add.purpose', { selector: 'textarea' }), { target: { value: 'math reasoning' } })
    fireEvent.click(go)
    await waitFor(() => { expect(h.startOrganizing).toHaveBeenCalledTimes(1) })
    const [sid, title, text, preset] = h.startOrganizing.mock.calls[0]!
    expect(sid).toBe('s1')
    expect(title).toBe('organize.sessionTitle {"name":"gsm8k"}')
    expect(preset).toBe('dataset-authoring')
    expect(text).toContain('~/Downloads/gsm8k')
    expect(text).toContain('math reasoning')
    expect(text).toContain('/home/user/.dsh/datasets/gsm8k')
    expect(await screen.findByText('organize.drafted')).toBeTruthy()
    // The tab itself writes nothing.
    expect(h.register).not.toHaveBeenCalled()
  })

  it('nothing landed in a chat box: the request is shown to paste', async () => {
    const h = makeHarness()
    h.startOrganizing.mockResolvedValue({ kind: 'manual', text: 'THE REQUEST' })
    renderView(h)
    fireEvent.click(await screen.findByText('registry.askAgent'))
    expect(await screen.findByText('organize.manual')).toBeTruthy()
    expect(screen.getByText('THE REQUEST')).toBeTruthy()
    expect(h.startOrganizing.mock.calls[0]![2]).toContain('/work/dataseek-eval')
  })

  it('交给 Agent 修改 on a registration names its checkout and branch', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('registry.askAgent'))
    await waitFor(() => { expect(h.startOrganizing).toHaveBeenCalledTimes(1) })
    const text = h.startOrganizing.mock.calls[0]![2] as string
    expect(text).toContain('organize.updateRequest {"name":"dataseek-eval"}')
    expect(text).toContain('/work/dataseek-eval')
    expect(text).toContain('i1-walk')
  })
})

describe('添加题集 picks directories (T95)', () => {
  /** Open the dialog and fill the two required fields. */
  async function openAdd(name = 'gsm8k'): Promise<void> {
    fireEvent.click(await screen.findByText('registry.add'))
    expect(await screen.findByText('add.title')).toBeTruthy()
    if (name !== '') fireEvent.change(screen.getByLabelText('add.name', { selector: 'input' }), { target: { value: name } })
  }
  const sourceBox = (): HTMLTextAreaElement => screen.getByLabelText('add.source', { selector: 'textarea' })

  it('选择目录… writes the pick into 数据在哪, which stays editable', async () => {
    const h = makeHarness()
    h.pickDirectory.mockResolvedValueOnce('/home/user/raw/humaneval/')
    renderView(h)
    await openAdd()
    fireEvent.click(screen.getByText('add.browse'))
    await waitFor(() => { expect(sourceBox().value).toBe('/home/user/raw/humaneval') })
    fireEvent.change(sourceBox(), { target: { value: '/home/user/raw/humaneval/data.jsonl' } })
    expect(sourceBox().value).toBe('/home/user/raw/humaneval/data.jsonl')
    fireEvent.click(screen.getByText('add.organize'))
    await waitFor(() => { expect(h.startOrganizing).toHaveBeenCalledTimes(1) })
    expect(h.startOrganizing.mock.calls[0]![2]).toContain('/home/user/raw/humaneval/data.jsonl')
  })

  it('a cancelled or failing pick leaves both fields as they were', async () => {
    const h = makeHarness()
    renderView(h)
    await openAdd()
    fireEvent.change(sourceBox(), { target: { value: '~/Downloads/gsm8k' } })
    h.pickDirectory.mockResolvedValueOnce(null)
    fireEvent.click(screen.getByText('add.browse'))
    await waitFor(() => { expect(h.pickDirectory).toHaveBeenCalledTimes(1) })
    h.pickDirectory.mockRejectedValueOnce(new Error('directory picker failed'))
    fireEvent.click(screen.getByText('add.repoChange'))
    await waitFor(() => { expect(h.pickDirectory).toHaveBeenCalledTimes(2) })
    await Promise.resolve()
    expect(sourceBox().value).toBe('~/Downloads/gsm8k')
    expect(screen.getByText(/add\.repoAt .*\/home\/user\/\.dsh\/datasets\/gsm8k/)).toBeTruthy()
    expect(screen.queryByText('add.repoReset')).toBeNull()
  })

  it('without a chooser the buttons are hidden and the default location still shows', async () => {
    const h = makeHarness()
    renderView(h, { canPick: false })
    await openAdd()
    expect(screen.queryByText('add.browse')).toBeNull()
    expect(screen.queryByText('add.repoChange')).toBeNull()
    expect(screen.getByText(/add\.repoAt .*\/home\/user\/\.dsh\/datasets\/gsm8k/)).toBeTruthy()
  })

  it('更改… picks the parent; the request carries <parent>/<name>; 恢复默认位置 goes back', async () => {
    const h = makeHarness()
    renderView(h)
    await openAdd('')
    // Before a name: the location reads with a name slot.
    expect(screen.getByText(/add\.repoAt .*\/home\/user\/\.dsh\/datasets\/add\.repoNameSlot/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('add.name', { selector: 'input' }), { target: { value: 'gsm8k' } })
    h.pickDirectory.mockResolvedValueOnce('/home/user/benchmarks/')
    fireEvent.click(screen.getByText('add.repoChange'))
    expect(await screen.findByText(/add\.repoAt .*\/home\/user\/benchmarks\/gsm8k/)).toBeTruthy()
    // Back to the default, and to the picked one again.
    fireEvent.click(screen.getByText('add.repoReset'))
    expect(screen.getByText(/add\.repoAt .*\/home\/user\/\.dsh\/datasets\/gsm8k/)).toBeTruthy()
    expect(screen.queryByText('add.repoReset')).toBeNull()
    h.pickDirectory.mockResolvedValueOnce('/home/user/benchmarks')
    fireEvent.click(screen.getByText('add.repoChange'))
    expect(await screen.findByText('add.repoReset')).toBeTruthy()
    fireEvent.change(sourceBox(), { target: { value: '/home/user/raw/gsm8k' } })
    fireEvent.click(screen.getByText('add.organize'))
    await waitFor(() => { expect(h.startOrganizing).toHaveBeenCalledTimes(1) })
    const text = h.startOrganizing.mock.calls[0]![2] as string
    expect(text).toContain('organize.lineRepo {"value":"/home/user/benchmarks/gsm8k"}')
    expect(text).not.toContain('.dsh/datasets/gsm8k')
  })

  it('a reset location sends the default path', async () => {
    const h = makeHarness()
    renderView(h)
    await openAdd()
    h.pickDirectory.mockResolvedValueOnce('/home/user/benchmarks')
    fireEvent.click(screen.getByText('add.repoChange'))
    fireEvent.click(await screen.findByText('add.repoReset'))
    fireEvent.change(sourceBox(), { target: { value: 'x' } })
    fireEvent.click(screen.getByText('add.organize'))
    await waitFor(() => { expect(h.startOrganizing).toHaveBeenCalledTimes(1) })
    expect(h.startOrganizing.mock.calls[0]![2]).toContain('organize.lineRepo {"value":"/home/user/.dsh/datasets/gsm8k"}')
  })
})

describe('等你确认登记 (T90)', () => {
  it('a 「核对并登记」 request from the tool card opens that review directly, no list or banner (T96)', async () => {
    const h = makeHarness()
    h.proposals.mockResolvedValue({ ok: true, value: [PROPOSAL] })
    const focus = createReviewFocus()
    // Requested before the tab mounted (the card clicked, then the tab switched).
    focus.request('s1' as SessionId, 'p1')
    renderView(h, { extra: { reviewFocus: { take: focus.take, subscribe: focus.subscribe } } })
    expect(await screen.findByText('review.titleNew {"name":"gsm8k"}')).toBeTruthy()
    expect(h.proposalReview).toHaveBeenCalledWith('s1', 'p1')
    expect(screen.queryByText('banner.review')).toBeNull()
    // Taken once: back goes to the list, the request does not reopen it.
    fireEvent.click(screen.getByRole('button', { name: 'review.back' }))
    expect(await screen.findByText('banner.proposal {"name":"gsm8k"}')).toBeTruthy()
    // A request while the tab is already open lands too; another session's does not.
    focus.request('s2' as SessionId, 'p1')
    await Promise.resolve()
    expect(screen.queryByText('review.titleNew {"name":"gsm8k"}')).toBeNull()
    act(() => { focus.request('s1' as SessionId, 'p1') })
    expect(await screen.findByText('review.titleNew {"name":"gsm8k"}')).toBeTruthy()
  })

  it('「返回题集列表」 leaves the review for the list and its banner (T96)', async () => {
    const h = makeHarness()
    h.proposals.mockResolvedValue({ ok: true, value: [PROPOSAL] })
    renderView(h)
    fireEvent.click(await screen.findByText('banner.review'))
    await screen.findByText('review.titleNew {"name":"gsm8k"}')
    fireEvent.click(screen.getByRole('button', { name: 'review.back' }))
    expect(await screen.findByText('banner.proposal {"name":"gsm8k"}')).toBeTruthy()
    expect(screen.queryByText('review.titleNew {"name":"gsm8k"}')).toBeNull()
  })

  it('a pending proposal shows a banner; the review confirms exactly the layer choice it shows', async () => {
    const h = makeHarness()
    h.proposals.mockResolvedValue({ ok: true, value: [PROPOSAL, { ...PROPOSAL, id: 'p0', status: 'returned' }] })
    renderView(h)
    expect(await screen.findByText('banner.proposal {"name":"gsm8k"}')).toBeTruthy()
    expect(screen.getAllByText('banner.review')).toHaveLength(1)
    fireEvent.click(screen.getByText('banner.review'))
    expect(await screen.findByText('review.titleNew {"name":"gsm8k"}')).toBeTruthy()
    expect(h.proposalReview).toHaveBeenCalledWith('s1', 'p1')
    // Facts, comparison, the unlayered flag.
    expect(screen.getByText('GSM8K')).toBeTruthy()
    expect(screen.getByText('review.versionOne {"number":4,"date":"2026-09-30"}')).toBeTruthy()
    expect(screen.getByText('test.jsonl')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
    expect(screen.getByText('dataset card')).toBeTruthy()
    expect(screen.getByText('review.unlayeredCount {"count":1}')).toBeTruthy()
    expect(screen.getAllByText('review.unlayered').length).toBeGreaterThan(0)
    expect(screen.getByText('review.sum.unused {"count":1}')).toBeTruthy()
    // Flip grading to visible, then confirm.
    const grading = screen.getByRole('switch', { name: 'gsm8k/grading · review.layerVisible' })
    expect(grading.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('review.layerSuggest {"word":"review.layerHidden"}')).toBeTruthy()
    fireEvent.click(grading)
    fireEvent.click(screen.getByText('review.confirm'))
    await waitFor(() => {
      expect(h.confirmProposal).toHaveBeenCalledWith('s1', 'p1', 'gsm8k', { gsm8k: { layers: ['prompt', 'grading'] } })
    })
    expect(await screen.findByText('review.done {"name":"gsm8k"}')).toBeTruthy()
  })

  it('a blocking problem disables 确认登记', async () => {
    const h = makeHarness()
    h.proposals.mockResolvedValue({ ok: true, value: [PROPOSAL] })
    h.proposalReview.mockResolvedValue({
      ok: true,
      value: {
        ...REVIEW,
        problems: [
          { code: 'SOURCE_UNLISTED', message: 'extra.csv has no disposition', path: 'extra.csv' },
          { code: 'DISPOSITION_INCOMPLETE', message: 'a.csv is unused but gives no reason', path: 'a.csv', params: { kind: 'noReason', path: 'a.csv' } },
        ],
      },
    })
    renderView(h)
    fireEvent.click(await screen.findByText('banner.review'))
    // No params (an older host): the server's own sentence stays.
    expect(await screen.findByText('extra.csv has no disposition')).toBeTruthy()
    // With params: the reader's language, keyed by code and kind.
    expect(screen.getByText('review.finding.DISPOSITION_INCOMPLETE.noReason {"kind":"noReason","path":"a.csv"}')).toBeTruthy()
    expect((screen.getByText('review.confirm') as HTMLButtonElement).disabled).toBe(true)
  })

  it('hiding every layer of a set is refused', async () => {
    const h = makeHarness()
    h.proposals.mockResolvedValue({ ok: true, value: [PROPOSAL] })
    renderView(h)
    fireEvent.click(await screen.findByText('banner.review'))
    await screen.findByText('review.titleNew {"name":"gsm8k"}')
    fireEvent.click(screen.getByRole('switch', { name: 'gsm8k/prompt · review.layerVisible' }))
    expect(screen.getByText('review.keepOne')).toBeTruthy()
    expect((screen.getByText('review.confirm') as HTMLButtonElement).disabled).toBe(true)
  })

  it('逐条对照 shows the source record beside the files it became', async () => {
    const h = makeHarness()
    h.proposals.mockResolvedValue({ ok: true, value: [PROPOSAL] })
    renderView(h)
    fireEvent.click(await screen.findByText('banner.review'))
    fireEvent.click(await screen.findByText(/review\.itemOne/))
    expect(await screen.findByText('{"question":"What is 2+2?"}')).toBeTruthy()
    expect(h.reviewItem).toHaveBeenCalledWith('s1', 'p1', 'gsm8k', 'test-0001')
    fireEvent.click(screen.getByText('review.itemRandom'))
    await waitFor(() => { expect(h.reviewItem).toHaveBeenCalledTimes(4) })
  })

  it('退回给 Agent marks the proposal returned and writes the note into its organizing session', async () => {
    const h = makeHarness()
    h.proposals.mockResolvedValue({ ok: true, value: [PROPOSAL] })
    renderView(h)
    fireEvent.click(await screen.findByText('banner.review'))
    fireEvent.click(await screen.findByText('review.return'))
    fireEvent.change(screen.getByLabelText('review.returnNote'), { target: { value: 'keep the train split apart' } })
    fireEvent.click(screen.getByText('review.returnSend'))
    await waitFor(() => { expect(h.returnProposal).toHaveBeenCalledWith('s1', 'p1', 'keep the train split apart') })
    await waitFor(() => { expect(h.draftInSession).toHaveBeenCalledTimes(1) })
    expect(h.draftInSession.mock.calls[0]![0]).toBe('organizer-1')
    expect(h.draftInSession.mock.calls[0]![1]).toContain('keep the train split apart')
    expect(await screen.findByText('organize.returned')).toBeTruthy()
  })

  it('a held version: banner, 已登记版本 → 新版本 with every deletion listed, confirm pins the reviewed commit', async () => {
    const pendingCommit = 'b'.repeat(40)
    const row = rowOf()
    const h = makeHarness([{ ...row, latest: { ...row.latest!, version: 3, pending: { commit: pendingCommit, date: '2026-09-30T09:00:00+08:00', version: 5 } } }])
    h.pendingReview.mockResolvedValue({
      ok: true,
      value: {
        ...REVIEW,
        proposal: { ...PROPOSAL, id: 'pending-dataseek-eval', kind: 'update', registryId: 'dataseek-eval' },
        facts: {
          ...REVIEW.facts,
          version: { ...REVIEW.facts.version, number: 5, commit: pendingCommit },
          registered: { number: 3, date: '2026-09-21T10:00:00+08:00', commit: TIP },
        },
        compare: {
          ...REVIEW.compare,
          mode: 'update',
          summary: { split: 0, copy: 0, new: 0, unused: 0, added: 1, modified: 1, deleted: 1, outside: 0 },
          sources: [],
          changes: [
            { status: 'D', path: 'datasets/bench/items/R9/visible/task.md', zone: 'layer', set: 'bench', item: 'R9', layer: 'visible', visible: true },
            { status: 'M', path: 'datasets/bench/items/R1/visible/task.md', zone: 'layer', set: 'bench', item: 'R1', layer: 'visible', visible: true },
            { status: 'A', path: 'datasets/bench/items/R1/grading/answer.md', zone: 'layer', set: 'bench', item: 'R1', layer: 'grading', visible: false },
          ],
        },
      },
    })
    renderView(h)
    expect(await screen.findByText('registry.version {"number":3,"date":"2026-09-21"}')).toBeTruthy()
    expect(screen.getByText('registry.pending')).toBeTruthy()
    fireEvent.click(await screen.findByText('banner.reviewUpdate'))
    expect(await screen.findByText('review.versionStep {"from":3,"to":5,"date":"2026-09-30"}')).toBeTruthy()
    // No agent account for a held version: the page says so itself.
    expect(screen.getByText('review.heldBody')).toBeTruthy()
    expect(screen.getByText('review.deletions {"count":1}')).toBeTruthy()
    expect(screen.getByText('datasets/bench/items/R9/visible/task.md')).toBeTruthy()
    expect(screen.getByText('review.sum.modified {"count":1}')).toBeTruthy()
    // A held version has no proposal to drill into.
    expect(screen.queryByText(/review\.itemOne/)).toBeNull()
    fireEvent.click(screen.getByText('review.confirmUpdate'))
    await waitFor(() => {
      expect(h.confirmPending).toHaveBeenCalledWith('s1', 'dataseek-eval', pendingCommit, { gsm8k: { layers: ['prompt'] } })
    })
  })
})
