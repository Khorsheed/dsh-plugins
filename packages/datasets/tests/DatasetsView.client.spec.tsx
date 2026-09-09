// @vitest-environment jsdom
/**
 * DatasetsView spec under the four-share props form: a real store instance
 * (createDatasetsViewStore().create()) and injected Remote mocks. Asserts the
 * unbound state, the bound tree (dataset → item → layer → file), the bind
 * form's submit, and the selection-driven preview through the official reader.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DatasetBinding, ListDatasetsResult, ListItemsResult, PreviewRepoResult, ReadResult } from '../src/types.ts'
import type { DatasetsViewProps } from '../src/client/contract.ts'
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
}

const BINDING: DatasetBinding = { repoPath: '/repo', layers: ['visible'] }

const DATASETS: ListDatasetsResult = {
  kind: 'datasets',
  datasets: [{
    id: 'alpha', name: 'Alpha', layers: ['visible'], nonModelFacingLayers: [], itemCount: 1,
    warnings: [{ code: 'MODELFACING_UNDECLARED', layer: 'visible', message: 'visible undeclared' }],
  }],
}

const SENSITIVE_DATASETS: ListDatasetsResult = {
  kind: 'datasets',
  datasets: [{
    id: 'alpha', name: 'Alpha', layers: ['visible', 'grading'], nonModelFacingLayers: ['grading'],
    itemCount: 1, warnings: [],
  }],
}

const PREVIEW: PreviewRepoResult = {
  repo: '/repo',
  datasets: [
    { id: 'alpha', name: 'Alpha', layers: ['visible'], nonModelFacingLayers: [], itemCount: 1, warnings: [] },
    { id: 'beta', layers: ['visible', 'grading'], nonModelFacingLayers: ['grading'], itemCount: 3, warnings: [] },
  ],
}

const ITEMS: ListItemsResult = {
  kind: 'items',
  dataset: DATASETS.datasets[0]!,
  datasetLayers: { visible: ['guide.md'] },
  passthrough: ['manifest.yml'],
  items: [{
    id: 'i1',
    metadata: { difficulty: 'hard' },
    layers: { visible: ['task.md'] },
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
    listDatasets: vi.fn(async (_sid: string, dataset?: string): Promise<Result<ListDatasetsResult | ListItemsResult>> => (
      { ok: true, value: dataset === undefined ? DATASETS : ITEMS }
    )),
    readFile: vi.fn(async (): Promise<Result<ReadResult>> => ({ ok: true, value: { content: '# Task\n\nbody\n', commit: 'a4f9c2e0000' } })),
    readPassthroughFile: vi.fn(async (): Promise<Result<ReadResult>> => ({ ok: true, value: { content: '# Passthrough content\n', commit: 'a4f9c2e0000' } })),
    pickDirectory: vi.fn(async () => '/picked-repo'),
    previewRepo: vi.fn(async (): Promise<Result<PreviewRepoResult>> => ({ ok: true, value: PREVIEW })),
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
      current: 's1',
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

afterEach(() => { cleanup() })

describe('DatasetsView', () => {
  it('sensitive layers stay visible to the human with a quiet marker (operator view)', async () => {
    const h = makeHarness()
    h.listDatasets.mockImplementation(async (_sid: string, dataset?: string) => ({
      ok: true as const,
      value: dataset === undefined ? SENSITIVE_DATASETS : {
        kind: 'items' as const,
        dataset: SENSITIVE_DATASETS.datasets[0]!,
        datasetLayers: {},
        passthrough: [],
        items: [{ id: 'i1', layers: { visible: ['task.md'], grading: ['rubric.yml'] } }],
      },
    }))
    renderView(h)
    fireEvent.click(await screen.findByText('alpha'))
    fireEvent.click(await screen.findByText('i1'))
    // The sensitive layer lists with its marker — the operator view never hides it.
    const grading = await screen.findByText(/grading/)
    expect(grading.parentElement?.textContent).toContain('tree.sensitive')
    expect(grading.parentElement?.textContent).not.toContain('tree.agentReadable')
    // …while the whitelisted visible layer carries the readable marker.
    expect(screen.getByText(/tree\.agentReadable/)).toBeTruthy()
  })

  it('unbound: shows the empty binding state and never lists', async () => {
    const h = makeHarness(null)
    renderView(h)
    expect(await screen.findByText('binding.none')).toBeTruthy()
    expect(h.listDatasets).not.toHaveBeenCalled()
    expect(screen.getByText('list.unbound')).toBeTruthy()
  })

  it('bound: lists datasets, expands items, and previews a selected file', async () => {
    const h = makeHarness()
    renderView(h)
    // The binding summary and the dataset row land after the two RPCs.
    expect(await screen.findByText(/binding\.repo/)).toBeTruthy()
    const row = await screen.findByText('alpha')
    expect(h.listDatasets).toHaveBeenCalledWith('s1')
    // The descriptor name renders on its own quiet line, not crammed into the row.
    expect(screen.getByText('Alpha')).toBeTruthy()
    // A mixed-sensitivity dataset's undeclared layer surfaces as a quiet warning line.
    expect(screen.getByText(/tree\.warnModelFacing/)).toBeTruthy()

    fireEvent.click(row)
    expect(await screen.findByText('i1')).toBeTruthy()
    expect(h.listDatasets).toHaveBeenCalledWith('s1', 'alpha')
    // An explorer carries no chips: the item row is the bare id.
    expect(screen.queryByText('difficulty: hard')).toBeNull()

    fireEvent.click(screen.getByText('i1'))
    // item.json is flagged as unprotected at the passthrough zone's footing —
    // and it reads like any other file (marker = warning, not a gate).
    fireEvent.click(await screen.findByText(/item\.json · tree\.unprotected/))
    expect(h.readPassthroughFile).toHaveBeenCalledWith('s1', { dataset: 'alpha', path: 'items/i1/item.json' })
    // The agent-readable marker follows the binding's layers whitelist (the
    // shared layer and the item's own visible layer both carry it).
    expect((await screen.findAllByText(/tree\.agentReadable/)).length).toBeGreaterThan(0)
    // The layer header is one quiet phrase: name, middot, count — never a right-floated count
    // (it appears once per layer group: the shared group and the item's own).
    expect((await screen.findAllByText(/· tree\.fileCount/)).length).toBeGreaterThan(0)
    // Dataset-level (shared) layers group under the quiet label, ahead of the items.
    expect(screen.getByText('tree.shared')).toBeTruthy()
    const file = await screen.findByText('task.md')
    fireEvent.click(file)
    expect(h.readFile).toHaveBeenCalledWith('s1', {
      dataset: 'alpha', item: 'i1', layer: 'visible', path: 'task.md',
    })
    // The markdown content renders through the official MarkdownText pipeline.
    expect(await screen.findByText('Task')).toBeTruthy()
    expect(screen.getByText('@a4f9c2e')).toBeTruthy()
    // The item's metadata surfaces in the preview header as quiet chips,
    // never the raw JSON string.
    expect(await screen.findByText('difficulty: hard')).toBeTruthy()
    expect(screen.queryByText('{\"difficulty\":\"hard\"}')).toBeNull()
    // A shared (dataset-level) file reads WITHOUT an item selector.
    fireEvent.click(screen.getByText('guide.md'))
    expect(h.readFile).toHaveBeenCalledWith('s1', {
      dataset: 'alpha', layer: 'visible', path: 'guide.md',
    })
    // The passthrough zone's files list AND read (the operator view blocks no
    // human) — the unprotected marker is a warning, not a gate.
    fireEvent.click(screen.getByText(/tree\.passthrough/))
    fireEvent.click(await screen.findByText('manifest.yml'))
    expect(h.readPassthroughFile).toHaveBeenCalledWith('s1', { dataset: 'alpha', path: 'manifest.yml' })
    // The preview renders through the same pipeline as layer files (the header
    // names the passthrough selection; content highlighting splits tokens, so
    // assert on the aggregated text instead of one node).
    await waitFor(() => {
      expect(document.querySelector('[class*="preview"]')?.textContent).toContain('Passthrough content')
    })
  })

  it('a failed binding fetch settles the bar instead of loading forever', async () => {
    const h = makeHarness()
    h.fetchBinding.mockResolvedValue({ ok: false, error: { code: 'internal', message: 'resume failed' } })
    renderView(h)
    expect(await screen.findByText('binding.none')).toBeTruthy()
    expect(await screen.findByText(/list\.error/)).toBeTruthy()
  })

  it('bind form: the live preview drives the chips; confirm submits the picked subsets', async () => {
    const h = makeHarness(null)
    renderView(h)
    fireEvent.click(await screen.findByText('binding.bind'))
    fireEvent.change(screen.getByLabelText('binding.form.repo'), { target: { value: '/repo/' } })
    // Live validation verdict (debounced) — and nothing submits on typing.
    expect(await screen.findByText(/binding\.form\.preview\.ok/)).toBeTruthy()
    expect(h.bindSession).not.toHaveBeenCalled()
    // The fold feeds its chips from the preview: nobody types ids or layer names.
    fireEvent.click(screen.getByText('binding.form.restrict'))
    expect(await screen.findByText('beta · 3')).toBeTruthy()
    expect(screen.getByText('grading · binding.form.sensitive')).toBeTruthy()
    // The task-facing shortcut keeps only the model-facing layers.
    fireEvent.click(screen.getByText('binding.form.taskFacingOnly'))
    fireEvent.click(screen.getByText('binding.form.submit'))
    await waitFor(() => {
      // The stored repoPath is the preview's canonical toplevel (trailing slash gone).
      expect(h.bindSession).toHaveBeenCalledWith('s1', { repoPath: '/repo', layers: ['visible'] })
    })
    await waitFor(() => { expect(h.instance.getSnapshot().refreshRev).toBe(1) })
  })

  it('bind form: the fold opens on the modelFacing floor; unchecking everything disables confirm', async () => {
    const h = makeHarness(null)
    renderView(h)
    fireEvent.click(await screen.findByText('binding.bind'))
    fireEvent.change(screen.getByLabelText('binding.form.repo'), { target: { value: '/repo' } })
    expect(await screen.findByText(/binding\.form\.preview\.ok/)).toBeTruthy()
    fireEvent.click(screen.getByText('binding.form.restrict'))
    // The floor: only modelFacing:true layers start checked ('grading' is sensitive).
    expect((await screen.findByText('visible')).className).toContain('_active_')
    expect(screen.getByText('grading · binding.form.sensitive').className).not.toContain('_active_')
    // Unchecking the last picked layer forbids the submit ([] would mean "nothing").
    fireEvent.click(screen.getByText('visible'))
    expect(await screen.findByText('binding.form.keepOne')).toBeTruthy()
    expect((screen.getByText('binding.form.submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('bind form: a bad path shows the preview error inline and blocks confirm', async () => {
    const h = makeHarness(null)
    h.previewRepo.mockResolvedValue({ ok: false, error: { code: 'NOT_A_REPO', message: 'not-a-repo is not a git repository' } })
    renderView(h)
    fireEvent.click(await screen.findByText('binding.bind'))
    fireEvent.change(screen.getByLabelText('binding.form.repo'), { target: { value: 'not-a-repo' } })
    expect(await screen.findByText('not-a-repo is not a git repository')).toBeTruthy()
    expect((screen.getByText('binding.form.submit') as HTMLButtonElement).disabled).toBe(true)
    expect(h.bindSession).not.toHaveBeenCalled()
  })

  it('edit mode backfills the current whitelists into the fold', async () => {
    const h = makeHarness({ repoPath: '/repo', layers: ['visible'] })
    renderView(h)
    fireEvent.click(await screen.findByText('binding.edit'))
    // The fold opens on its own; after the preview the current whitelist holds.
    expect(await screen.findByText('binding.form.titleEdit')).toBeTruthy()
    expect(await screen.findByText(/binding\.form\.preview\.ok/)).toBeTruthy()
    fireEvent.click(screen.getByText('binding.form.submit'))
    await waitFor(() => {
      expect(h.bindSession).toHaveBeenCalledWith('s1', { repoPath: '/repo', layers: ['visible'] })
    })
  })

  it('unbind clears the binding through the Remote', async () => {
    const h = makeHarness()
    renderView(h)
    fireEvent.click(await screen.findByText('binding.unbind'))
    await waitFor(() => {
      expect(h.unbindSession).toHaveBeenCalledWith('s1')
    })
    await waitFor(() => {
      expect(h.instance.getSnapshot().refreshRev).toBe(1)
    })
  })

  it('a JSON file previews through the official JsonTree inside the block chrome', async () => {
    const h = makeHarness()
    h.listDatasets.mockImplementation(async (_sid: string, dataset?: string) => ({
      ok: true as const,
      value: dataset === undefined ? DATASETS : {
        kind: 'items' as const,
        dataset: DATASETS.datasets[0]!,
        datasetLayers: {},
        passthrough: [],
        items: [{ id: 'i1', layers: { visible: ['meta.json'] } }],
      },
    }))
    h.readFile.mockResolvedValue({
      ok: true,
      value: { content: '{\"difficulty\":\"hard\",\"tags\":[\"a\"]}\n', commit: 'a4f9c2e0000' },
    })
    renderView(h)
    fireEvent.click(await screen.findByText('alpha'))
    fireEvent.click(await screen.findByText('i1'))
    fireEvent.click(await screen.findByText('meta.json'))
    // The document view carries the official block chrome's format banner.
    expect(await screen.findByText('json')).toBeTruthy()
    // The JsonTree inspector renders the parsed keys, not the source text.
    expect(await screen.findByText('difficulty:')).toBeTruthy()
    expect(screen.queryByText('\"tags\"')).toBeNull()
  })

  it('the use-workspace shortcut fills the repo field with the session cwd', async () => {
    const h = makeHarness(null)
    renderView(h)
    fireEvent.click(await screen.findByText('binding.bind'))
    fireEvent.click(screen.getByText('binding.form.useWorkspace'))
    expect((screen.getByLabelText('binding.form.repo') as HTMLInputElement).value).toBe('/work')
  })

  it('browse fills the repo field through the native chooser, and hides without the capability', async () => {
    const h = makeHarness(null)
    renderView(h)
    fireEvent.click(await screen.findByText('binding.bind'))
    fireEvent.click(screen.getByText('binding.form.browse'))
    await waitFor(() => {
      expect((screen.getByLabelText('binding.form.repo') as HTMLInputElement).value).toBe('/picked-repo')
    })
    expect(h.pickDirectory).toHaveBeenCalledTimes(1)
  })

  it('the browse button hides when the host cannot show a native chooser', async () => {
    const h = makeHarness(null)
    renderView(h, { canPick: false })
    fireEvent.click(await screen.findByText('binding.bind'))
    expect(screen.queryByText('binding.form.browse')).toBeNull()
    // The workspace shortcut stays — it needs no native capability.
    expect(screen.getByText('binding.form.useWorkspace')).toBeTruthy()
  })

  it('a failed read surfaces the error message', async () => {
    const h = makeHarness()
    h.readFile.mockResolvedValue({ ok: false, error: { code: 'LAYER_NOT_ALLOWED', message: 'denied' } })
    renderView(h)
    fireEvent.click(await screen.findByText('alpha'))
    fireEvent.click(await screen.findByText('i1'))
    fireEvent.click(await screen.findByText('task.md'))
    expect(await screen.findByText(/preview\.error/)).toBeTruthy()
  })
})
