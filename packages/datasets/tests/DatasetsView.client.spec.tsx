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
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { DatasetBinding, ListDatasetsResult, ListItemsResult, ReadResult } from '../src/types.ts'
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
}

const BINDING: DatasetBinding = { repoPath: '/repo', layers: ['visible'] }

const DATASETS: ListDatasetsResult = {
  kind: 'datasets',
  datasets: [{ id: 'alpha', name: 'Alpha', layers: ['visible'], nonModelFacingLayers: [], itemCount: 1 }],
}

const ITEMS: ListItemsResult = {
  kind: 'items',
  dataset: DATASETS.datasets[0]!,
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
  }
}

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
    fetchBinding: h.fetchBinding,
    bindSession: h.bindSession,
    unbindSession: h.unbindSession,
    listDatasets: h.listDatasets,
    readFile: h.readFile,
    t: (key: string, params?: Record<string, unknown>) => (
      params === undefined ? key : `${key} ${JSON.stringify(params)}`
    ),
  } as unknown as DatasetsViewProps
  return render(<DatasetsView {...props} />)
}

afterEach(() => { cleanup() })

describe('DatasetsView', () => {
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

    fireEvent.click(row)
    expect(await screen.findByText('i1')).toBeTruthy()
    expect(h.listDatasets).toHaveBeenCalledWith('s1', 'alpha')
    // An explorer carries no chips: the item row is the bare id.
    expect(screen.queryByText('difficulty: hard')).toBeNull()

    fireEvent.click(screen.getByText('i1'))
    // The layer header is one quiet phrase: name, middot, count — never a right-floated count.
    expect(await screen.findByText(/· tree\.fileCount/)).toBeTruthy()
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
  })

  it('bind form submits the parsed binding and refreshes', async () => {
    const h = makeHarness(null)
    renderView(h)
    fireEvent.click(await screen.findByText('binding.bind'))
    const repo = screen.getByLabelText('binding.form.repo')
    const layers = screen.getByLabelText('binding.form.layers')
    fireEvent.change(repo, { target: { value: '/new-repo' } })
    fireEvent.change(layers, { target: { value: 'visible, shared' } })
    fireEvent.click(screen.getByText('binding.form.submit'))

    await waitFor(() => {
      expect(h.bindSession).toHaveBeenCalledWith('s1', { repoPath: '/new-repo', layers: ['visible', 'shared'] })
    })
    await waitFor(() => {
      expect(h.instance.getSnapshot().refreshRev).toBe(1)
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
