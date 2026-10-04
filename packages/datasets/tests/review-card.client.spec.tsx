// @vitest-environment jsdom
/**
 * T96 · the 「核对并登记」 entry in the organizing Turn's tail: the Turn
 * definition that collects filed proposals from the session's events, what
 * the card reads from each call's block, the one button it offers (only on a
 * filed proposal), and the tab switch it tries — with the words it falls back
 * to when the host's tab strip is not there to click.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReviewCard, ReviewTurnTail, type ReviewCardProps } from '../src/client/ReviewCard.tsx'
import { proposedInTurn, proposedTurnDefinition } from '../src/client/review-turn.ts'
import { createReviewFocus, proposeCardOf, switchToTab, type ProposeToolBlock } from '../src/client/review-card.ts'

const ARGS = JSON.stringify({ path: '/home/user/.dsh/datasets/gsm8k', registryId: 'gsm8k' })

function settled(result: unknown, isError = false): ProposeToolBlock {
  return {
    kind: 'tool-result',
    call: { name: 'datasets_propose_registration', argsRaw: ARGS },
    content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }],
    isError,
  }
}

const FILED = settled({ ok: true, kind: 'new', filed: 'p1', warnings: [{ message: 'w' }], next: '...' })
const DRY = settled({ ok: false, kind: 'update', problems: [{ code: 'X' }, { code: 'Y' }], warnings: [] })

const t = ((key: string, params?: Record<string, unknown>) => (params === undefined ? key : `${key} ${JSON.stringify(params)}`)) as ReviewCardProps['t']

function renderCard(block: ProposeToolBlock, overrides: Partial<ReviewCardProps> = {}) {
  const props: ReviewCardProps = {
    block,
    loadPending: vi.fn(async () => true),
    openReview: vi.fn(),
    t,
    ...overrides,
  }
  return { props, ...render(<ReviewCard {...props} />) }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('proposeCardOf', () => {
  it('reads a filed proposal from the result, the name from the arguments', () => {
    expect(proposeCardOf(FILED)).toEqual({ state: 'filed', proposalId: 'p1', name: 'gsm8k', kind: 'new', problems: 0, warnings: 1 })
  })
  it('a dry run is a check: no proposal id', () => {
    expect(proposeCardOf(DRY)).toMatchObject({ state: 'checked', proposalId: null, kind: 'update', problems: 2 })
  })
  it('running, failed and unknown results never carry a proposal id', () => {
    expect(proposeCardOf({ name: 'datasets_propose_registration', argsRaw: ARGS })).toMatchObject({ state: 'running', name: 'gsm8k', proposalId: null })
    expect(proposeCardOf(settled('{"code":"VALIDATE_FAILED"}', true))).toMatchObject({ state: 'failed', proposalId: null })
    expect(proposeCardOf(settled('not json'))).toMatchObject({ state: 'unreadable', proposalId: null })
    expect(proposeCardOf(settled({ something: 'else' }))).toMatchObject({ state: 'unreadable' })
    expect(proposeCardOf(null)).toMatchObject({ state: 'unreadable', name: null })
  })
})

describe('the card', () => {
  it('a filed proposal shows 「核对并登记」; the click leaves the request and selects the 题集 tab', async () => {
    const focus = createReviewFocus()
    const openReview = vi.fn((id: string) => { focus.request('s1' as never, id) })
    // The host's conversation frame: the tab strip and, beside it, the chat with the card.
    const frame = document.createElement('div')
    frame.innerHTML = '<div data-conversation-tabs=""><button role="tab" aria-selected="true">chat</button><button role="tab" aria-selected="false">open</button></div><div id="chat"></div>'
    document.body.appendChild(frame)
    const datasetsTab = frame.querySelectorAll('[role="tab"]')[1] as HTMLElement
    datasetsTab.addEventListener('click', () => { datasetsTab.setAttribute('aria-selected', 'true') })
    render(<ReviewCard block={FILED} loadPending={async () => true} openReview={openReview} t={t} />, { container: frame.querySelector('#chat') as HTMLElement })

    const button = await screen.findByRole('button', { name: 'card.open' })
    expect(screen.getByText(/card\.filedNote/).textContent).toContain('card.warnings {"count":1}')
    fireEvent.click(button)
    expect(openReview).toHaveBeenCalledWith('p1')
    expect(focus.take('s1' as never)).toBe('p1')
    expect(datasetsTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('status').textContent).toBe('card.opened')
    frame.remove()
  })

  it('no tab strip to click: the request still lands and the card says where to go', () => {
    const openReview = vi.fn()
    renderCard(FILED, { openReview })
    fireEvent.click(screen.getByRole('button', { name: 'card.open' }))
    expect(openReview).toHaveBeenCalledWith('p1')
    expect(screen.getByRole('status').textContent).toBe('card.openedManual')
  })

  it('a click that does not select the tab falls back to the words', async () => {
    vi.useFakeTimers()
    const frame = document.createElement('div')
    frame.innerHTML = '<div data-conversation-tabs=""><button role="tab" aria-selected="false">open</button></div><div id="chat"></div>'
    document.body.appendChild(frame)
    render(<ReviewCard block={FILED} loadPending={async () => true} openReview={vi.fn()} t={t} />, { container: frame.querySelector('#chat') as HTMLElement })
    fireEvent.click(screen.getByRole('button', { name: 'card.open' }))
    expect(screen.getByRole('status').textContent).toBe('card.opened')
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.getByRole('status').textContent).toBe('card.openedManual')
    frame.remove()
  })

  it('a proposal already handled offers 「查看」, not the primary action', async () => {
    renderCard(FILED, { loadPending: async () => false })
    expect(await screen.findByRole('button', { name: 'card.view' })).toBeTruthy()
    expect(screen.getByText('card.handled')).toBeTruthy()
  })

  it('degrades: a dry run, an error or an unknown result shows no button and never throws', () => {
    const { container } = renderCard(DRY)
    expect(container.querySelector('[data-state="checked"]')).toBeTruthy()
    expect(screen.getByText('card.checkProblems {"count":2}')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()
    renderCard(settled('boom', true))
    expect(screen.getByText('card.failed')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()
    renderCard(settled('???'))
    expect(screen.getByText('card.unreadable')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('a pending list that cannot be read keeps the primary action', async () => {
    const loadPending = vi.fn(async () => null)
    renderCard(FILED, { loadPending })
    await waitFor(() => { expect(loadPending).toHaveBeenCalledWith('p1') })
    expect(screen.getByRole('button', { name: 'card.open' })).toBeTruthy()
  })
})

describe('switchToTab', () => {
  it('returns null (never throws) without a strip or a matching tab', () => {
    const lone = document.createElement('div')
    expect(switchToTab(lone, 'open')).toBeNull()
    expect(switchToTab(null, 'open')).toBeNull()
    const frame = document.createElement('div')
    frame.innerHTML = '<div data-conversation-tabs=""><button role="tab">chat</button></div><span></span>'
    expect(switchToTab(frame.querySelector('span'), 'open')).toBeNull()
  })
})

describe('the Turn definition', () => {
  type State = ReturnType<typeof proposedTurnDefinition.start>
  const call = (callId: string, name = 'datasets_propose_registration', seq = 2) =>
    ({ type: 'tool/call', seq, data: { turn: 1, callId, name, arguments: ARGS } })
  const result = (callId: string, payload: unknown, seq: number, extra: Record<string, unknown> = {}) => ({
    type: 'tool/result', seq, surfaceOp: 'append',
    data: { turn: 1, message: { source: { callId }, content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false, ...extra } },
  })
  function run(events: Array<Record<string, unknown>>): State {
    let state: State | undefined
    for (const event of events) {
      const match = proposedTurnDefinition.match(event as never)
      if (match === null) continue
      state = match.role === 'start'
        ? proposedTurnDefinition.start(undefined, { event } as never)
        : proposedTurnDefinition.update({ state: state! }, { event } as never)
    }
    return state!
  }
  const start = { type: 'turn/start', seq: 1, data: { turn: 1 } }
  const owner = (state: State, end?: number) => ({
    turn: {
      data: { get: (key: string) => proposedTurnDefinition.buildLocationData({ state }, 'turn', null)!.key === key ? { filed: state.filed } : undefined },
      end: end === undefined ? null : { seq: end },
    },
    seq: 99,
  })

  it('keeps only filed proposals, paired with their own call', () => {
    const state = run([
      start,
      call('c1'), result('c1', { ok: true, kind: 'new', filed: 'p1', warnings: [] }, 3),
      call('c2', 'datasets_propose_registration', 4), result('c2', { ok: false, problems: [{ code: 'X' }], warnings: [] }, 5),
      call('c3', 'other_tool', 6), result('c3', { filed: 'nope' }, 7),
      { ...result('c4', { filed: 'orphan' }, 8) },
      { ...result('c1', { filed: 'replayed' }, 9), surfaceOp: 'replace' },
    ])
    expect(state.filed.map(block => proposeCardOf(block).proposalId)).toEqual(['p1'])
    expect(state.filed[0]).toMatchObject({ kind: 'tool-result', seq: 3, call: { argsRaw: ARGS } })
  })

  it('an error result files nothing', () => {
    const state = run([start, call('c1'), result('c1', { filed: 'p1' }, 3, { isError: true })])
    expect(state.filed).toEqual([])
  })

  it('reuses the published value while nothing changed; bounds the tail by the Turn end', () => {
    const state = run([start, call('c1'), result('c1', { ok: true, filed: 'p1', warnings: [] }, 3)])
    const first = proposedTurnDefinition.buildLocationData({ state }, 'turn', null)!
    expect(proposedTurnDefinition.buildLocationData({ state }, 'turn', first)).toBe(first)
    expect(proposedTurnDefinition.buildLocationData({ state }, 'session', null)).toBeNull()
    expect(proposedInTurn(owner(state))).toHaveLength(1)
    expect(proposedInTurn(owner(state, 2))).toHaveLength(0)
  })

  it('the tail renders one card per filed proposal, nothing otherwise, never throws on bad data', async () => {
    const state = run([start, call('c1'), result('c1', { ok: true, filed: 'p1', warnings: [] }, 3)])
    const face = { loadPending: vi.fn(async () => true), openReview: vi.fn(), t }
    const { container, rerender } = render(<ReviewTurnTail {...owner(state)} {...face} />)
    expect(container.querySelectorAll('[data-tool="datasets_propose_registration"]')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'card.open' })).toBeTruthy()
    await waitFor(() => { expect(face.loadPending).toHaveBeenCalledWith('p1') })
    const empty = run([start, call('c1')])
    rerender(<ReviewTurnTail {...owner(empty)} {...face} />)
    expect(container.innerHTML).toBe('')
    const broken = { turn: { data: { get: () => { throw new Error('boom') } } } }
    rerender(<ReviewTurnTail {...broken} {...face} />)
    expect(container.innerHTML).toBe('')
    expect(proposedInTurn(null)).toEqual([])
  })
})
