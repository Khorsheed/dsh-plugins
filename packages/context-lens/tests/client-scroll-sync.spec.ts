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
  hasCallAnchor, locateCallPaging, preferredScrollBehavior, scrollConversationToBottom, scrollConversationToCall, scrollConversationToTurn,
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
  it('lands inside a display:contents slot anchor, on its first rendering box (443e7c65 turn 18 never moved)', () => {
    const { rows } = conversation([1, 18])
    const anchor = rows.get(18)!
    anchor.style.display = 'contents'
    const ghost = document.createElement('div')
    ghost.style.display = 'contents'
    const body = document.createElement('div')
    ghost.appendChild(body)
    anchor.appendChild(ghost)
    expect(scrollConversationToTurn(18)).toBe(true)
    expect(scrollIntoView.mock.instances[0]).toBe(body)
  })

  it('skips a turn element that renders nothing for the next one of the same turn', () => {
    const { port, rows } = conversation([1, 18])
    rows.get(18)!.style.display = 'none'
    const tail = document.createElement('div')
    tail.setAttribute('data-chat-turn', '18')
    port.appendChild(tail)
    expect(scrollConversationToTurn(18)).toBe(true)
    expect(scrollIntoView.mock.instances[0]).toBe(tail)
  })

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

describe('scrollConversationToMessage', () => {
  it('lands on the human message row of a room round, by the node key suffix', async () => {
    const { scrollConversationToMessage } = await import('../src/client/scroll-sync.ts')
    const { port } = conversation([1])
    const row = document.createElement('div')
    row.setAttribute('data-chat-node-key', '13:input-message15ad6a4d-7fd8-401b-bd33-3c5cff117b79')
    port.appendChild(row)
    expect(scrollConversationToMessage('15ad6a4d-7fd8-401b-bd33-3c5cff117b79')).toBe(true)
    expect(scrollIntoView.mock.instances[0]).toBe(row)
    expect(scrollConversationToMessage('missing')).toBe(false)
  })

  it('a jump the chat view cut short is brought to the top once the scroll is still; the reader\'s own scroll ends the watch', async () => {
    const { scrollConversationToMessage } = await import('../src/client/scroll-sync.ts')
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const run = (count: number): void => { for (let i = 0; i < count; i += 1) frames.shift()?.(0) }
    const { port } = conversation([1])
    Object.defineProperty(port, 'scrollHeight', { value: 10_000, configurable: true })
    Object.defineProperty(port, 'clientHeight', { value: 800, configurable: true })
    const row = document.createElement('div')
    row.setAttribute('data-chat-node-key', 'input-message-abc')
    port.appendChild(row)
    // The host's own scroll write left the row 600px below the top.
    let rowTop = 600
    row.getBoundingClientRect = () => ({ top: rowTop }) as DOMRect
    port.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
    expect(scrollConversationToMessage('abc')).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    run(6)
    // Still and off target: one instant correction.
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
    expect(scrollIntoView.mock.calls[1]![0]).toEqual({ behavior: 'auto', block: 'start' })
    rowTop = 0
    run(10)
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
    // A new jump the reader then scrolls away from is left alone.
    rowTop = 600
    scrollConversationToMessage('abc')
    port.dispatchEvent(new Event('wheel'))
    run(10)
    expect(scrollIntoView).toHaveBeenCalledTimes(3)
  })
})

describe('scrollConversationToCall', () => {
  /** A manual frame clock: `run` fires queued frames one by one. */
  function frameClock() {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    return { run: (count: number): void => { for (let i = 0; i < count; i += 1) frames.shift()?.(0) } }
  }

  it('opens nested folds one layer at a time, outermost first, re-finding the row after each re-render', () => {
    const clock = frameClock()
    const { port, rows } = conversation([5])
    const order: string[] = []
    const portOpened = vi.fn()
    port.addEventListener('beforematch', portOpened)
    const outer = document.createElement('div')
    outer.setAttribute('hidden', 'until-found')
    const inner = document.createElement('div')
    inner.setAttribute('hidden', 'until-found')
    const call = document.createElement('div')
    call.setAttribute('data-chat-call-id', 'call_9')
    inner.appendChild(call)
    outer.appendChild(inner)
    rows.get(5)!.appendChild(outer)
    // Each fold opens only on a later tick (a React re-render); the inner
    // fold's re-render replaces the row element entirely.
    let pending: (() => void) | undefined
    outer.addEventListener('beforematch', () => { order.push('outer'); pending = () => outer.removeAttribute('hidden') })
    inner.addEventListener('beforematch', () => {
      order.push('inner')
      pending = () => {
        inner.removeAttribute('hidden')
        const replaced = document.createElement('div')
        replaced.setAttribute('data-chat-call-id', 'call_9')
        inner.replaceChild(replaced, call)
      }
    })
    expect(scrollConversationToCall('call_9', document, 'auto')).toBe(true)
    expect(portOpened).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['outer'])
    expect(scrollIntoView).not.toHaveBeenCalled()
    pending?.(); pending = undefined
    clock.run(1)
    expect(order).toEqual(['outer', 'inner'])
    pending?.(); pending = undefined
    clock.run(1)
    const landed = port.querySelector('[data-chat-call-id="call_9"]')
    expect(landed).not.toBe(call)
    expect(scrollIntoView.mock.instances[0]).toBe(landed)
  })

  it('gives up after the frame budget when a fold never opens (no landing on a hidden row)', () => {
    const clock = frameClock()
    const { rows } = conversation([5])
    const stuck = document.createElement('div')
    stuck.setAttribute('hidden', 'until-found')
    const call = document.createElement('div')
    call.setAttribute('data-chat-call-id', 'call_stuck')
    stuck.appendChild(call)
    rows.get(5)!.appendChild(stuck)
    expect(scrollConversationToCall('call_stuck', document, 'auto')).toBe(true)
    clock.run(80)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('without a frame clock, opens every layer at once and lands', () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    const { rows } = conversation([5])
    const group = document.createElement('div')
    group.setAttribute('hidden', 'until-found')
    const opened = vi.fn(() => { group.removeAttribute('hidden') })
    group.addEventListener('beforematch', opened)
    const call = document.createElement('div')
    call.setAttribute('data-chat-call-id', 'call_7')
    group.appendChild(call)
    rows.get(5)!.appendChild(group)
    expect(hasCallAnchor('call_7')).toBe(true)
    expect(scrollConversationToCall('call_7', document, 'auto')).toBe(true)
    expect(opened).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.instances[0]).toBe(call)
  })

  it('a call the conversation has not rendered is a silent false', () => {
    conversation([1])
    expect(hasCallAnchor('missing')).toBe(false)
    expect(scrollConversationToCall('missing')).toBe(false)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})

describe('locateCallPaging', () => {
  /** Frames run on a microtask-friendly clock: each tick runs every queued frame once. */
  function ticking() {
    let queue: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queue.push(callback); return queue.length })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    return {
      async tick(times = 1): Promise<void> {
        for (let i = 0; i < times; i += 1) {
          const now = queue
          queue = []
          for (const frame of now) frame(0)
          await Promise.resolve()
          await Promise.resolve()
        }
      },
    }
  }
  const addCall = (row: HTMLElement, id: string): HTMLElement => {
    const call = document.createElement('div')
    call.setAttribute('data-chat-call-id', id)
    row.appendChild(call)
    return call
  }

  it('waits for a just-opened conversation\'s first rows, then pages, and re-pages when the first page request was a no-op', async () => {
    // A member session opened from a room's lens: no rows yet; its first
    // loadThrough resolves while the session's own first page is loading
    // and pages nothing (throwaway instance, loadThrough(1148) on 443e7c65).
    const clock = ticking()
    const port = document.createElement('div')
    port.setAttribute('data-conversation-scroll', '')
    document.body.appendChild(port)
    const pages: number[] = []
    const loadThrough = vi.fn(async (seq: number) => {
      pages.push(seq)
      if (pages.length === 2) {
        const older = document.createElement('div')
        older.setAttribute('data-chat-turn', '71')
        port.prepend(older)
        addCall(older, 'call_71')
      }
    })
    const landed = locateCallPaging({ callId: 'call_71', startSeq: 1148, fallbackTurn: 71, loadThrough, alive: () => true })
    await clock.tick(3)
    expect(loadThrough).not.toHaveBeenCalled()
    const first = document.createElement('div')
    first.setAttribute('data-chat-turn', '74')
    port.appendChild(first)
    await clock.tick(200)
    expect(await landed).toBe(true)
    expect(pages).toEqual([1148, 1148])
    expect(scrollIntoView.mock.instances.at(-1)).toBe(document.querySelector('[data-chat-call-id="call_71"]'))
  })

  it('a call already rendered lands at once, without paging', async () => {
    ticking()
    const { rows } = conversation([71])
    const call = addCall(rows.get(71)!, 'call_now')
    const loadThrough = vi.fn(async () => {})
    expect(await locateCallPaging({ callId: 'call_now', startSeq: 1, fallbackTurn: 71, loadThrough, alive: () => true })).toBe(true)
    expect(loadThrough).not.toHaveBeenCalled()
    expect(scrollIntoView.mock.instances[0]).toBe(call)
  })

  it('after the page budget it settles for the turn; a superseded jump does nothing', async () => {
    const clock = ticking()
    const { rows } = conversation([70, 71])
    const loadThrough = vi.fn(async () => {})
    const settled = locateCallPaging({ callId: 'never', startSeq: 9, fallbackTurn: 71, loadThrough, alive: () => true })
    await clock.tick(400)
    expect(await settled).toBe(false)
    expect(loadThrough).toHaveBeenCalledTimes(3)
    expect(scrollIntoView.mock.instances.at(-1)).toBe(rows.get(71))
    scrollIntoView.mockClear()
    let alive = true
    const gone = locateCallPaging({ callId: 'never', startSeq: 9, fallbackTurn: 71, loadThrough, alive: () => alive })
    alive = false
    await clock.tick(400)
    expect(await gone).toBe(false)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
