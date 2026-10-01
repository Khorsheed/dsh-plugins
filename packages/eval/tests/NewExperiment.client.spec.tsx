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
 * 5. 选题 (T90): 全部 by default; 随机 N 题 previews eval_plan_draft's own draw
 *    under a seed that is shown and editable; 手选 filters a large set.
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
import { drawItems } from '../src/contract/item-selection.ts'

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

/** A set big enough for the filter box: twelve real items and one placeholder. */
const BIG_IDS = Array.from({ length: 12 }, (_, i) => `I${String(i + 1).padStart(2, '0')}`).sort()
const BIG_OPTIONS: EvalDraftOptionsView = {
  datasets: [{
    id: 'reg/ds',
    commit: COMMIT,
    items: ['P0-placeholder', ...BIG_IDS],
    itemInfo: [
      { id: 'P0-placeholder', title: '链路测试夹具', stages: null, placeholder: true },
      ...BIG_IDS.map((id, i) => ({ id, title: `title ${i + 1}`, stages: 2, placeholder: false })),
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

function makeHarness(opts: { composer?: boolean; options?: EvalDraftOptionsView } = {}) {
  const instance = createLabViewStore().create()
  return {
    instance,
    fetchExperiments: vi.fn(async (): Promise<Result<EvalExperimentsResult>> => ({ ok: true, value: EMPTY_LIST })),
    fetchDraftOptions: vi.fn(async (): Promise<Result<EvalDraftOptionsView>> => ({ ok: true, value: opts.options ?? OPTIONS })),
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
    fireEvent.click(await screen.findByRole('tab', { name: 'new.mode.pick' }))

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
    fireEvent.click(await screen.findByRole('tab', { name: 'new.mode.pick' }))
    fireEvent.click((await screen.findByText('F2-room')).closest('label')!.querySelector('input')!)
    fireEvent.click(organizeButton())

    const text = h.insertDraft.mock.calls[0]?.[1] as string
    expect(text).toContain('organize.settled.question {"question":"协作空间 好不好用"}')
    expect(text).toContain('organize.settled.dataset {"dataset":"reg/ds"}')
    expect(text).toContain(`organize.settled.pick ${JSON.stringify({ items: 'F2-room', arg: '{"mode":"pick","items":["F2-room"]}' })}`)
    expect(text).not.toContain('organize.open.question')
    expect(text).not.toContain('organize.open.dataset')
    expect(text).not.toContain('organize.open.items')
  })

  it('选题 defaults to 全部 over the real items, and says so in the request (T90)', async () => {
    const h = makeHarness({ options: BIG_OPTIONS })
    await openDialog(h)
    fireEvent.change(screen.getByLabelText('new.name'), { target: { value: 'all-of-it' } })
    fireEvent.change(screen.getByLabelText('new.dataset'), { target: { value: 'reg/ds' } })
    const allTab = await screen.findByRole('tab', { name: 'new.mode.all' })
    expect(allTab.getAttribute('aria-selected')).toBe('true')
    // The placeholder is not in the pool unless asked for.
    expect(screen.getByText('new.allHelp {"count":12}')).toBeTruthy()
    fireEvent.click(organizeButton())
    const text = h.insertDraft.mock.calls[0]?.[1] as string
    expect(text).toContain(`organize.settled.all ${JSON.stringify({ count: 12, arg: '{"mode":"all"}' })}`)
    expect(text).not.toContain('organize.open.items')
  })

  it('随机 N 题 previews the very draw eval_plan_draft makes, with a visible, editable seed (T90)', async () => {
    const h = makeHarness({ options: BIG_OPTIONS })
    await openDialog(h)
    fireEvent.change(screen.getByLabelText('new.name'), { target: { value: 'sample' } })
    fireEvent.change(screen.getByLabelText('new.dataset'), { target: { value: 'reg/ds' } })
    fireEvent.click(await screen.findByRole('tab', { name: 'new.mode.random' }))

    const seedBox = screen.getByLabelText('new.seed') as HTMLInputElement
    expect(seedBox.value).toMatch(/^\d+$/) // minted, shown
    fireEvent.change(screen.getByLabelText('new.randomCount'), { target: { value: '3' } })
    fireEvent.change(seedBox, { target: { value: '42' } })

    const expected = drawItems(BIG_IDS, 3, 42)
    const preview = screen.getByLabelText(`new.randomPreview {"commit":"${COMMIT.slice(0, 7)}"}`)
    expect([...preview.querySelectorAll('span')].map(el => el.textContent).filter(text => BIG_IDS.includes(text ?? ''))).toEqual(expected)

    // 换一个种子 mints another one into the box.
    const before = seedBox.value
    let changed = false
    for (let i = 0; i < 5 && !changed; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'new.seedMint' }))
      changed = (screen.getByLabelText('new.seed') as HTMLInputElement).value !== before
    }
    expect(changed).toBe(true)
    fireEvent.change(screen.getByLabelText('new.seed'), { target: { value: '42' } })

    fireEvent.click(organizeButton())
    const text = h.insertDraft.mock.calls[0]?.[1] as string
    expect(text).toContain(`organize.settled.random ${JSON.stringify({
      count: 3, seed: 42, pool: 12, arg: '{"mode":"random","count":3,"seed":42}',
    })}`)
  })

  it('a count outside the pool, or a seed that is not a whole number, is said in place and holds the action (T90)', async () => {
    const h = makeHarness({ options: BIG_OPTIONS })
    await openDialog(h)
    fireEvent.change(screen.getByLabelText('new.name'), { target: { value: 'sample' } })
    fireEvent.change(screen.getByLabelText('new.dataset'), { target: { value: 'reg/ds' } })
    fireEvent.click(await screen.findByRole('tab', { name: 'new.mode.random' }))

    fireEvent.change(screen.getByLabelText('new.randomCount'), { target: { value: '13' } })
    expect(screen.getByRole('alert').textContent).toBe('new.randomBadCount {"pool":12}')
    expect(organizeButton().disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('new.randomCount'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('new.seed'), { target: { value: '-1' } })
    expect(screen.getByRole('alert').textContent).toBe('new.randomBadSeed')
    expect(organizeButton().disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('new.seed'), { target: { value: '7' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(organizeButton().disabled).toBe(false)
  })

  it('手选 filters a large set by ID or title and counts the pick (T90)', async () => {
    const h = makeHarness({ options: BIG_OPTIONS })
    await openDialog(h)
    fireEvent.change(screen.getByLabelText('new.dataset'), { target: { value: 'reg/ds' } })
    fireEvent.click(await screen.findByRole('tab', { name: 'new.mode.pick' }))
    expect(screen.getByText('new.pickEmptyHelp')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('new.pickFilter'), { target: { value: 'title 1' } })
    // "title 1", "title 10", "title 11", "title 12"
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
    fireEvent.click(screen.getByText('I10').closest('label')!.querySelector('input')!)
    expect(screen.getByText('new.pickCount {"count":1,"total":12}')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('new.pickFilter'), { target: { value: 'nothing-like-it' } })
    expect(screen.getByText('new.pickNoMatch')).toBeTruthy()
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
