// @vitest-environment jsdom
/**
 * The conversation scroll-sync's spec (docs/upstream-seam-registry.md S20 —
 * the DOM-anchor workaround): exact turn anchors, the at-or-after fallback in
 * DOM order, the scrollport scoping, reduced-motion behavior, the bottom
 * scroll (scrollport first, largest turn row as the anchor fallback), and the
 * silent no-op paths (nothing here may throw).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  preferredScrollBehavior, scrollConversationToBottom, scrollConversationToTurn,
} from '../src/client/scroll-sync.ts'

/** Build a fake conversation: a scrollport with turn rows (and one hidden row). */
function conversation(turns: readonly number[], opts: { hidden?: readonly number[]; detached?: boolean } = {}) {
  const port = document.createElement('div')
  port.setAttribute('data-conversation-scroll', '')
  const rows = new Map<number, HTMLElement>()
  for (const turn of turns) {
    const row = document.createElement('div')
    row.setAttribute('data-chat-turn', String(turn))
    if (opts.hidden?.includes(turn)) row.setAttribute('hidden', '')
    port.appendChild(row)
    rows.set(turn, row)
  }
  if (opts.detached !== true) document.body.appendChild(port)
  return { port, rows }
}

const scrollIntoView = vi.fn()
const scrollTo = vi.fn()

beforeEach(() => {
  scrollIntoView.mockClear()
  scrollTo.mockClear()
  // jsdom implements neither primitive.
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true })
  Object.defineProperty(Element.prototype, 'scrollTo', { value: scrollTo, configurable: true })
})

afterEach(() => {
  document.querySelectorAll('[data-conversation-scroll], [data-chat-turn]').forEach(el => el.remove())
  vi.unstubAllGlobals()
})

describe('scrollConversationToTurn', () => {
  it('scrolls the exact turn anchor into view, start-aligned and smooth by default', () => {
    const { rows } = conversation([1, 2, 3])
    expect(scrollConversationToTurn(2)).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.instances[0]).toBe(rows.get(2))
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('lands on the nearest mounted turn at-or-after a paged-out one (DOM order, host semantics)', () => {
    const { rows } = conversation([1, 5, 6])
    expect(scrollConversationToTurn(3)).toBe(true)
    expect(scrollIntoView.mock.instances[0]).toBe(rows.get(5))
  })

  it('skips hidden rows on both the exact and the fallback path', () => {
    const { rows } = conversation([1, 2, 3], { hidden: [2] })
    expect(scrollConversationToTurn(2)).toBe(true)
    expect(scrollIntoView.mock.instances[0]).toBe(rows.get(3))
  })

  it('scopes the query to the conversation scrollport when one is mounted', () => {
    const { rows } = conversation([1, 2])
    // A foreign element with the same attribute outside the scrollport never matches.
    const foreign = document.createElement('div')
    foreign.setAttribute('data-chat-turn', '1')
    document.body.appendChild(foreign)
    scrollConversationToTurn(1)
    expect(scrollIntoView.mock.instances[0]).toBe(rows.get(1))
    foreign.remove()
  })

  it('reads the document when no scrollport exists, and no-ops when nothing is mounted', () => {
    const row = document.createElement('div')
    row.setAttribute('data-chat-turn', '4')
    document.body.appendChild(row)
    expect(scrollConversationToTurn(4)).toBe(true)
    row.remove()
    expect(scrollConversationToTurn(9)).toBe(false)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('honors prefers-reduced-motion with an instant jump', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    conversation([1])
    expect(preferredScrollBehavior()).toBe('auto')
    scrollConversationToTurn(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
  })

  it('never throws on an unreadable DOM', () => {
    const hostile = {
      querySelector: () => { throw new Error('boom') },
      querySelectorAll: () => { throw new Error('boom') },
    } as unknown as ParentNode
    expect(scrollConversationToTurn(1, hostile)).toBe(false)
    expect(scrollConversationToBottom(hostile)).toBe(false)
  })
})

describe('scrollConversationToBottom', () => {
  it('scrolls the scrollport to its floor', () => {
    conversation([1, 2, 3])
    expect(scrollConversationToBottom()).toBe(true)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo.mock.calls[0]?.[0]).toMatchObject({ behavior: 'smooth' })
  })

  it('falls back to the largest mounted turn row when the scrollport cannot scroll', () => {
    const { rows } = conversation([1, 3, 2], { detached: true })
    // Detached: no scrollport is found inside the passed root, so the row path runs.
    expect(scrollConversationToBottom(rows.get(1)!.parentElement as ParentNode)).toBe(true)
    expect(scrollIntoView.mock.instances[0]).toBe(rows.get(3))
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'end' })
  })

  it('no-ops with no conversation mounted', () => {
    expect(scrollConversationToBottom()).toBe(false)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
