// @vitest-environment jsdom
/**
 * The 新建实验 dialog (T87) — the list's one action, rendered through the whole
 * LabView so the thing under test is what a person actually does: press
 * 新建实验, type a name (maybe more), press 「让 Agent 组织」, and find the
 * request in the chat box.
 *
 * Four promises are pinned:
 *
 * 1. The name is checked AS TYPED, and the refusal says the rule in place —
 *    the action stays disabled until the name is one eval_plan_draft accepts.
 * 2. Items list ID + title + stage count; placeholder items (the dataset marks
 *    them) are hidden until asked for, and greyed + tagged when shown.
 * 3. 「让 Agent 组织」 writes the request into the chat box through insertDraft,
 *    NEVER sends, focuses the composer, closes the dialog and says so.
 * 4. With no chat box, the request goes to the clipboard, and the notice says so.
 *
 * The request's own wording is organize.spec.ts's.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { EvalDraftOptionsView, EvalExperimentsResult } from '../src/types.ts'
import type { LabViewProps } from '../src/client/contract.ts'
import { LabView } from '../src/client/LabView.tsx'
import { createLabViewStore } from '../src/client/store.ts'

function hookOf(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => unknown }) {
  return function useSelector<S>(sel: (s: unknown) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

const COMMIT = 'c0ffee'.padEnd(40, '0')

const OPTIONS: EvalDraftOptionsView = {
  datasets: [{
    id: 'reg/ds',
    commit: COMMIT,
    items: ['P0-placeholder', 'F2-room'],
    itemInfo: [
      { id: 'P0-placeholder', title: '链路测试夹具', stages: null, placeholder: true },
      { id: 'F2-room', title: '多 agent 协作空间', stages: 4, placeholder: false },
    ],
    stages: ['stage1', 'stage2'],
  }],
  notes: [],
}

const EMPTY_LIST: EvalExperimentsResult = { rows: [], notes: [], session: 's1' }

/** The echo dictionary: a key, then its params as JSON — so a test reads what was said. */
const t = (key: string, params?: Record<string, unknown>) => (
  params === undefined ? key : `${key} ${JSON.stringify(params)}`
)

function makeHarness(opts: { composer?: boolean } = {}) {
  const instance = createLabViewStore().create()
  return {
    instance,
    fetchExperiments: vi.fn(async (): Promise<Result<EvalExperimentsResult>> => ({ ok: true, value: EMPTY_LIST })),
    fetchDraftOptions: vi.fn(async (): Promise<Result<EvalDraftOptionsView>> => ({ ok: true, value: OPTIONS })),
    fetchConditions: vi.fn(async () => ({ ok: true as const, value: { rows: [], notes: [] } })),
    insertDraft: vi.fn((_sid: SessionId, _text: string) => opts.composer ?? true),
    focusComposer: vi.fn(),
  }
}

type Harness = ReturnType<typeof makeHarness>

function renderView(h: Harness) {
  return render(<LabView {...({
    sessionId: 's1' as SessionId,
    useStore: hookOf(h.instance),
    actions: h.instance.actions,
    fetchExperiments: h.fetchExperiments,
    fetchDraftOptions: h.fetchDraftOptions,
    fetchConditions: h.fetchConditions,
    insertDraft: h.insertDraft,
    focusComposer: h.focusComposer,
    t,
  } as unknown as LabViewProps)} />)
}

/** Open the dialog from the toolbar and wait for its one read. */
async function openDialog(h: Harness): Promise<void> {
  renderView(h)
  fireEvent.click(await screen.findByRole('button', { name: 'list.new' }))
  await waitFor(() => { expect(h.fetchDraftOptions).toHaveBeenCalledWith('s1', {}) })
  await screen.findByRole('option', { name: 'reg/ds' })
}

const organizeButton = () => screen.getByRole('button', { name: 'new.organize' }) as HTMLButtonElement

describe('新建实验 dialog (T87)', () => {
  afterEach(() => { cleanup() })

  it('has four fields and no version box; the action waits for a valid name', async () => {
    const h = makeHarness()
    await openDialog(h)
    expect(screen.getByLabelText('new.name')).toBeTruthy()
    expect(screen.getByLabelText('new.question')).toBeTruthy()
    expect(screen.getByLabelText('new.dataset')).toBeTruthy()
    // 题目 only appears once a set is chosen; 题库版本 is gone.
    expect(screen.queryByRole('group', { name: 'new.items' })).toBeNull()
    expect(screen.queryByText(/commit/i)).toBeNull()
    // The help line, not an error, on a fresh dialog.
    expect(screen.getByText('new.nameHelp')).toBeTruthy()
    expect(organizeButton().disabled).toBe(true)
  })

  it('checks the name as typed and says which part of the rule it breaks', async () => {
    const h = makeHarness()
    await openDialog(h)
    const name = screen.getByLabelText('new.name')

    fireEvent.change(name, { target: { value: '侧栏 对比' } })
    expect(screen.getByRole('alert').textContent).toBe(
      `new.nameBadChars ${JSON.stringify({ chars: '「侧」「栏」new.nameSpace「对」「比」' })}`,
    )
    expect(organizeButton().disabled).toBe(true)

    fireEvent.change(name, { target: { value: '-sidebar' } })
    expect(screen.getByRole('alert').textContent).toBe('new.nameBadStart')

    fireEvent.change(name, { target: { value: '' } })
    fireEvent.blur(name)
    fireEvent.change(name, { target: { value: '' } })
    expect(organizeButton().disabled).toBe(true)

    fireEvent.change(name, { target: { value: 'sidebar-vs-inline' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(organizeButton().disabled).toBe(false)
  })

  it('lists items as ID + title + stages, placeholders hidden until asked for', async () => {
    const h = makeHarness()
    await openDialog(h)
    fireEvent.change(screen.getByLabelText('new.dataset'), { target: { value: 'reg/ds' } })

    expect(await screen.findByText('F2-room')).toBeTruthy()
    expect(screen.getByText('多 agent 协作空间')).toBeTruthy()
    expect(screen.getByText('new.itemStages {"count":4}')).toBeTruthy()
    expect(screen.queryByText('P0-placeholder')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'new.placeholdersShow {"count":1}' }))
    const placeholder = screen.getByText('P0-placeholder').closest('label')!
    expect(placeholder.hasAttribute('data-placeholder')).toBe(true)
    expect(placeholder.textContent).toContain('new.placeholderTag')

    // Picked, then hidden again: a choice the person can no longer see is dropped.
    fireEvent.click(placeholder.querySelector('input')!)
    fireEvent.click(screen.getByRole('button', { name: 'new.placeholdersHide' }))
    fireEvent.change(screen.getByLabelText('new.name'), { target: { value: 'x1' } })
    fireEvent.click(organizeButton())
    expect(h.insertDraft.mock.calls[0]?.[1]).not.toContain('P0-placeholder')
  })

  it('「让 Agent 组织」 puts the request in the chat box, never sends, focuses it, closes, and says so', async () => {
    const h = makeHarness()
    await openDialog(h)
    fireEvent.change(screen.getByLabelText('new.name'), { target: { value: 'sidebar-vs-inline' } })
    fireEvent.click(organizeButton())

    expect(h.insertDraft).toHaveBeenCalledTimes(1)
    const [sid, text] = h.insertDraft.mock.calls[0]!
    expect(sid).toBe('s1')
    expect(text).toContain('organize.settled.name {"name":"sidebar-vs-inline"}')
    expect(text).toContain('organize.open.dataset')
    expect(text).toContain('organize.finish')
    expect(h.focusComposer).toHaveBeenCalledWith('s1')
    expect(await screen.findByText('new.handedOff')).toBeTruthy()
    await waitFor(() => { expect(screen.queryByText('new.title')).toBeNull() })
  })

  it('carries the chosen set and items into the request as settled', async () => {
    const h = makeHarness()
    await openDialog(h)
    fireEvent.change(screen.getByLabelText('new.name'), { target: { value: 'room-walk' } })
    fireEvent.change(screen.getByLabelText('new.question'), { target: { value: '协作空间\n好不好用' } })
    fireEvent.change(screen.getByLabelText('new.dataset'), { target: { value: 'reg/ds' } })
    fireEvent.click((await screen.findByText('F2-room')).closest('label')!.querySelector('input')!)
    fireEvent.click(organizeButton())

    const text = h.insertDraft.mock.calls[0]?.[1] as string
    expect(text).toContain('organize.settled.question {"question":"协作空间 好不好用"}')
    expect(text).toContain('organize.settled.dataset {"dataset":"reg/ds"}')
    expect(text).toContain('organize.settled.items {"items":"F2-room"}')
    expect(text).not.toContain('organize.open.question')
    expect(text).not.toContain('organize.open.dataset')
    expect(text).not.toContain('organize.open.items')
  })

  it('without a chat box, copies the request and says so', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const h = makeHarness({ composer: false })
    await openDialog(h)
    fireEvent.change(screen.getByLabelText('new.name'), { target: { value: 'sidebar-vs-inline' } })
    fireEvent.click(organizeButton())

    const text = h.insertDraft.mock.calls[0]?.[1] as string
    await waitFor(() => { expect(writeText).toHaveBeenCalledWith(text) })
    expect(await screen.findByText(/^agent\.copied/)).toBeTruthy()
    expect(h.focusComposer).not.toHaveBeenCalled()
  })

  it('the lab\'s empty state opens the same dialog', async () => {
    const h = makeHarness()
    renderView(h)
    expect(await screen.findByText('list.emptyHint')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'list.emptyAction' }))
    expect(await screen.findByText('new.title')).toBeTruthy()
  })
})
