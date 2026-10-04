// @vitest-environment jsdom
/**
 * T96 · the review page paints in two steps: the page head and the four fact
 * cards from `proposalHead` (or their outline when it has not answered), with
 * skeleton bars in the same grid where the comparison, the layer list and the
 * name field will land; the full review replaces them. The back button is the
 * host's ghost button led by a chevron, on every state of the page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Proposal, ProposalReview, ReviewHead } from '../src/types.ts'
import { ReviewPage, type ReviewPageProps } from '../src/client/ReviewPage.tsx'

type Result<V> = { ok: true; value: V } | { ok: false; error: { code: string; message: string } }

const TIP = 'a4f9c2e0000000000000000000000000000000ff'

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
  source: { kind: 'public', label: 'GSM8K', path: '/home/user/Downloads/gsm8k' },
  mapping: { outputs: [] },
}

const REVIEW: ProposalReview = {
  proposal: PROPOSAL,
  facts: {
    itemCount: 3,
    sets: [{
      set: 'gsm8k', title: 'GSM8K', itemCount: 3,
      layers: [{ name: 'prompt', modelFacing: true, suggested: true }],
    }],
    validate: { ok: true, errors: [], warnings: 0 },
    version: { number: 4, date: '2026-09-30T08:00:00+08:00', commit: TIP, trackedRef: 'main', commonDir: '/home/user/.dsh/datasets/gsm8k/.git' },
  },
  compare: {
    mode: 'new',
    summary: { split: 1, copy: 0, new: 1, unused: 0, added: 0, modified: 0, deleted: 0, outside: 0 },
    sources: [{ path: 'test.jsonl', disposition: 'split', target: 'datasets/gsm8k/items/', files: 1, counted: 3 }],
    sourceRead: true,
    outputs: [{ path: 'datasets/gsm8k/dataset.json', origin: 'new', files: 1, items: 0, zone: 'descriptor', set: 'gsm8k' }],
    unlayered: [],
  },
  problems: [],
  warnings: [],
  items: [{ set: 'gsm8k', item: 'test-0001' }],
}

const HEAD: ReviewHead = {
  proposal: PROPOSAL,
  mode: 'new',
  itemCount: 3,
  sets: ['gsm8k'],
  version: { number: 4, date: '2026-09-30T08:00:00+08:00', commit: TIP },
}

/** A promise the test settles by hand. */
function deferred<V>(): { promise: Promise<V>; resolve: (value: V) => void } {
  let resolve!: (value: V) => void
  const promise = new Promise<V>((done) => { resolve = done })
  return { promise, resolve }
}

function renderPage(overrides: Partial<ReviewPageProps>) {
  const props: ReviewPageProps = {
    loadKey: 'proposal:p1:0',
    load: async () => ({ ok: true, value: REVIEW }),
    reviewItem: null,
    reviewFiles: null,
    confirm: vi.fn(),
    sendBack: null,
    onBack: vi.fn(),
    onDone: vi.fn(),
    t: ((key: string, params?: Record<string, unknown>) => (params === undefined ? key : `${key} ${JSON.stringify(params)}`)) as ReviewPageProps['t'],
    ...overrides,
  }
  return { props, ...render(<ReviewPage {...props} />) }
}

afterEach(() => { cleanup() })

describe('the review page loads in two steps (T96)', () => {
  it('the head paints the title and the fact cards while the comparison is still skeleton', async () => {
    const full = deferred<Result<ProposalReview>>()
    const { container } = renderPage({
      load: () => full.promise,
      loadHead: async () => ({ ok: true, value: HEAD }),
    })
    // Before anything answers: the outline of the same page, not a single grey line.
    expect(container.querySelector('[data-review-state="loading"]')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('review.loading')
    expect(screen.getByText('review.factSource')).toBeTruthy()
    expect(screen.getByText('review.factVersion')).toBeTruthy()

    // The head answered: title and three of four cards are real; 校验 waits (never computed for this commit).
    expect(await screen.findByText('review.titleNew {"name":"gsm8k"}')).toBeTruthy()
    expect(screen.getByText('GSM8K')).toBeTruthy()
    expect(screen.getByText('review.versionOne {"number":4,"date":"2026-09-30"}')).toBeTruthy()
    expect(container.querySelector('[data-fact="validate"] [data-size="chip"]')).toBeTruthy()
    for (const part of ['compare', 'layers', 'name']) {
      expect(container.querySelector(`[data-skeleton="${part}"]`)).toBeTruthy()
    }

    full.resolve({ ok: true, value: REVIEW })
    await waitFor(() => { expect(container.querySelector('[data-review-state="loaded"]')).toBeTruthy() })
    expect(screen.getByText('review.validateOk')).toBeTruthy()
    expect(container.querySelector('[data-skeleton]')).toBeNull()
  })

  it('a cached head fills the 校验 card at once', async () => {
    const full = deferred<Result<ProposalReview>>()
    renderPage({
      load: () => full.promise,
      loadHead: async () => ({ ok: true, value: { ...HEAD, validate: { ok: false, errors: [{ set: 'gsm8k', message: 'x' }], warnings: 0 } } }),
    })
    expect(await screen.findByText('review.validateFail {"count":1}')).toBeTruthy()
  })

  it('a failed head leaves the outline to the full review', async () => {
    const full = deferred<Result<ProposalReview>>()
    const { container } = renderPage({
      load: () => full.promise,
      loadHead: async () => ({ ok: false, error: { code: 'X', message: 'no head' } }),
    })
    await Promise.resolve()
    expect(container.querySelectorAll('[data-fact="validate"]').length).toBe(0)
    expect(container.querySelectorAll('dl dt').length).toBe(4)
    expect(screen.queryByText('no head')).toBeNull()
    full.resolve({ ok: true, value: REVIEW })
    expect(await screen.findByText('review.titleNew {"name":"gsm8k"}')).toBeTruthy()
  })

  it('without loadHead (a held version) the page still loads through its outline', async () => {
    renderPage({ loadHead: null })
    expect(await screen.findByText('review.titleNew {"name":"gsm8k"}')).toBeTruthy()
  })
})

describe('「返回题集列表」 (T96)', () => {
  it('is the host button with a leading chevron, and goes back from the loading state', () => {
    const onBack = vi.fn()
    const full = deferred<Result<ProposalReview>>()
    renderPage({ load: () => full.promise, onBack })
    const back = screen.getByRole('button', { name: 'review.back' })
    expect(back.querySelector('svg')).toBeTruthy()
    fireEvent.click(back)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('is the same button on the loaded page and on an error', async () => {
    const onBack = vi.fn()
    renderPage({ onBack })
    await screen.findByText('review.titleNew {"name":"gsm8k"}')
    fireEvent.click(screen.getByRole('button', { name: 'review.back' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    cleanup()

    const onBackError = vi.fn()
    renderPage({ onBack: onBackError, load: async () => ({ ok: false, error: { code: 'X', message: 'gone' } }) })
    await screen.findByText('gone')
    const back = screen.getByRole('button', { name: 'review.back' })
    expect(back.querySelector('svg')).toBeTruthy()
    fireEvent.click(back)
    expect(onBackError).toHaveBeenCalledTimes(1)
  })
})
