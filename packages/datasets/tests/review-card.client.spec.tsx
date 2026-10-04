// @vitest-environment jsdom
/**
 * T96 · the 「核对并登记」 card on the datasets_propose_registration tool row:
 * what it reads from the call's own block, the one button it offers (only on
 * a filed proposal), and the tab switch it tries — with the words it falls
 * back to when the host's tab strip is not there to click.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReviewCard, type ReviewCardProps } from '../src/client/ReviewCard.tsx'
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
