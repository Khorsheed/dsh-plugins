// @vitest-environment jsdom
/**
 * The experiment card on the eval_plan_draft tool row (I5·T76 · D3): what it
 * reads out of the call's own block, what it never shows (a path, an approve
 * button), the live status, and the 打开实验 channel to the lab tab.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { DraftCard, type DraftCardProps } from '../src/client/DraftCard.tsx'
import { createLabFocus, draftCardOf, type DraftToolBlock } from '../src/client/draft-card.ts'

const ARGS = {
  name: 'effort-sweep',
  dataset: 'reg/ds',
  items: ['P0', 'P1'],
  conditions: ['high', 'medium'],
  reps: 3,
  question: 'high 比 medium 强吗？',
}

const RESULT = {
  experimentId: 'effort-sweep-20260924-0c0d',
  dataset: { registry: 'reg', set: 'ds', commit: 'c0ffee1234567890' },
  planPath: '/home/user/.dsh/state/eval/experiments/effort-sweep-20260924-0c0d/plan.json',
  conditionPaths: ['/home/user/.dsh/state/eval/conditions/high.json'],
  conditions: ['high', 'medium'],
  judges: [],
  review: {
    planPath: '/home/user/.dsh/state/eval/experiments/effort-sweep-20260924-0c0d/plan.json',
    schema: 'dataseek.plan/1',
    ok: true,
    errors: 0,
    warnings: 1,
    digest: { items: ['P0', 'P1'], conditions: ['high', 'medium'], reps: 3, question: 'high 比 medium 强吗？' },
    checks: [],
    conditions: [],
  },
}

const settled = (result: unknown, over: Partial<DraftToolBlock> = {}): DraftToolBlock => ({
  kind: 'tool-result',
  call: { name: 'eval_plan_draft', argsRaw: JSON.stringify(ARGS) },
  content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  isError: false,
  ...over,
})

const t = (key: string, params?: Record<string, unknown>) => (
  params === undefined ? key : `${key} ${JSON.stringify(params)}`
)

function renderCard(block: DraftToolBlock, face: Partial<DraftCardProps> = {}) {
  const props: DraftCardProps = {
    block,
    loadStatus: vi.fn(async () => null),
    openExperiment: vi.fn(),
    t: t as DraftCardProps['t'],
    ...face,
  }
  return { props, ...render(<DraftCard {...props} />) }
}

afterEach(() => { cleanup() })

describe('draftCardOf', () => {
  it('reads the settled block: name, question, scale, dataset pin — and no path anywhere', () => {
    const card = draftCardOf(settled(RESULT))
    expect(card).toEqual({
      state: 'ready',
      experimentId: 'effort-sweep-20260924-0c0d',
      name: 'effort-sweep',
      question: 'high 比 medium 强吗？',
      items: 2,
      conditions: 2,
      reps: 3,
      dataset: 'reg/ds @ c0ffee1',
      errors: 0,
    })
    expect(JSON.stringify(card)).not.toMatch(/"\/|"~\//)
  })

  it('the plan as written wins over the arguments (the verb fills defaults)', () => {
    const card = draftCardOf(settled({ ...RESULT, review: { ...RESULT.review, digest: { items: ['P0', 'P1', 'P2'], conditions: ['high', 'medium'], reps: 1 } } }))
    expect(card.items).toBe(3)
    expect(card.reps).toBe(1)
    // A digest without a question (a pre-rev14 plan) keeps the argument's.
    expect(card.question).toBe('high 比 medium 强吗？')
  })

  it('a running call shows what the arguments say and nothing else', () => {
    const card = draftCardOf({ name: 'eval_plan_draft', argsRaw: JSON.stringify(ARGS) })
    expect(card.state).toBe('running')
    expect(card.experimentId).toBeNull()
    expect(card.name).toBe('effort-sweep')
  })

  it('an error result, an unreadable result and garbled arguments degrade, never throw', () => {
    expect(draftCardOf(settled(RESULT, { isError: true })).state).toBe('failed')
    expect(draftCardOf(settled('not an object')).state).toBe('unreadable')
    expect(draftCardOf({ kind: 'tool-result', call: null, content: [], isError: false }).state).toBe('unreadable')
    expect(draftCardOf({ name: 'eval_plan_draft', argsRaw: '{"name": "half' }).name).toBeNull()
  })

  it('names the experiment by its id slug when the arguments carry no name', () => {
    const card = draftCardOf(settled(RESULT, { call: { name: 'eval_plan_draft', argsRaw: '{}' } }))
    expect(card.name).toBe('effort-sweep')
  })
})

describe('DraftCard', () => {
  it('renders the experiment in the lab\'s words, with the live status', async () => {
    const loadStatus = vi.fn(async () => 'pending-approval' as const)
    renderCard(settled(RESULT), { loadStatus })
    expect(screen.getByText('effort-sweep')).toBeTruthy()
    expect(screen.getByText('high 比 medium 强吗？')).toBeTruthy()
    expect(screen.getByText('overview.shapeValue {"items":2,"conditions":2,"reps":3,"cells":12}')).toBeTruthy()
    expect(screen.getByText('reg/ds @ c0ffee1')).toBeTruthy()
    expect(loadStatus).toHaveBeenCalledWith('effort-sweep-20260924-0c0d')
    await screen.findByText('status.pending-approval')
    expect(document.body.textContent).not.toMatch(/\/home\/user|plan\.json/)
  })

  it('stays at 草稿 when the list has no row for it yet', async () => {
    renderCard(settled(RESULT))
    expect(await screen.findByText('status.draft')).toBeTruthy()
  })

  it('has one action, 打开实验 — no approve button (ui-spec R1)', () => {
    const { props } = renderCard(settled(RESULT))
    const buttons = screen.getAllByRole('button')
    expect(buttons.map(button => button.textContent)).toEqual(['card.open'])
    fireEvent.click(buttons[0]!)
    expect(props.openExperiment).toHaveBeenCalledWith('effort-sweep-20260924-0c0d')
    expect(screen.getByText('card.opened')).toBeTruthy()
  })

  it('says what went wrong for a failed call and offers nothing to open', async () => {
    const { props } = renderCard(settled(RESULT, { isError: true }))
    expect(screen.getByText('card.failed')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    await waitFor(() => { expect(props.loadStatus).not.toHaveBeenCalled() })
  })

  it('says how many validation errors the draft has', () => {
    renderCard(settled({ ...RESULT, review: { ...RESULT.review, ok: false, errors: 2 } }))
    expect(screen.getByText('card.errors {"errors":2}')).toBeTruthy()
  })
})

describe('createLabFocus', () => {
  it('holds one request per session until the lab view takes it, and tells subscribers', () => {
    const focus = createLabFocus()
    const listener = vi.fn()
    const off = focus.subscribe(listener)
    focus.request('s1' as SessionId, 'a')
    focus.request('s1' as SessionId, 'b')
    expect(listener).toHaveBeenCalledTimes(2)
    expect(focus.take('s2' as SessionId)).toBeNull()
    expect(focus.take('s1' as SessionId)).toBe('b')
    expect(focus.take('s1' as SessionId)).toBeNull()
    off()
    focus.request('s1' as SessionId, 'c')
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
