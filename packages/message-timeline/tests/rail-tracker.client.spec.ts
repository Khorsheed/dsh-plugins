// @vitest-environment jsdom
/**
 * The tracker's pure DOM helpers (measurement, active-row resolution, jump)
 * and the tracker's binding/degradation behavior against a fake sessions
 * service.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  activeRowKey, flowLeftX, installRailTracker, jumpRow, measureGeometry,
} from '../src/client/rail-tracker.ts'
import type { TimelineRailState } from '../src/client/slots.ts'

function rect(el: HTMLElement, value: { top: number; left: number; width: number; height: number }): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    ...value, right: value.left + value.width, bottom: value.top + value.height, x: value.left, y: value.top,
    toJSON: () => ({}),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('measureGeometry', () => {
  it('ends the box at the chat input card, ignoring dock cards above it', () => {
    const scrollport = document.createElement('div')
    rect(scrollport, { top: 20, left: 10, width: 400, height: 300 })
    const seat = document.createElement('div')
    seat.setAttribute('data-composer-seat', '')
    rect(seat, { top: 240, left: 0, width: 400, height: 60 })
    // A goal/todo dock card sits above the input inside the seat.
    const dock = document.createElement('div')
    rect(dock, { top: 240, left: 0, width: 400, height: 20 })
    seat.appendChild(dock)
    const input = document.createElement('div')
    input.setAttribute('data-composer-card', '')
    rect(input, { top: 260, left: 0, width: 400, height: 40 })
    seat.appendChild(input)
    scrollport.appendChild(seat)

    // The panel ends 8px above the input card (260), NOT above the dock card
    // (240): dock cards must not push the timeline up off the chat box.
    expect(measureGeometry(scrollport)).toEqual({ left: 16, top: 28, height: 224, width: 400 })
  })

  it('falls back to the composer seat top when the input card marker is absent', () => {
    const scrollport = document.createElement('div')
    rect(scrollport, { top: 20, left: 10, width: 400, height: 300 })
    const seat = document.createElement('div')
    seat.setAttribute('data-composer-seat', '')
    rect(seat, { top: 240, left: 0, width: 400, height: 60 })
    scrollport.appendChild(seat)

    expect(measureGeometry(scrollport)).toEqual({ left: 16, top: 28, height: 204, width: 400 })
  })

  it('falls back to the column bottom when no composer marker exists', () => {
    const scrollport = document.createElement('div')
    rect(scrollport, { top: 20, left: 10, width: 400, height: 300 })

    expect(measureGeometry(scrollport)).toEqual({ left: 16, top: 28, height: 284, width: 400 })
  })

  it('returns null while the scrollport has no laid-out size', () => {
    const scrollport = document.createElement('div')
    rect(scrollport, { top: 0, left: 0, width: 0, height: 0 })
    expect(measureGeometry(scrollport)).toBeNull()
  })

  it('insets the top past the conversation tab strip', () => {
    const tabs = document.createElement('div')
    tabs.setAttribute('role', 'tablist')
    rect(tabs, { top: 0, left: 0, width: 400, height: 40 })
    document.body.appendChild(tabs)
    const scrollport = document.createElement('div')
    rect(scrollport, { top: 48, left: 10, width: 400, height: 300 })

    expect(measureGeometry(scrollport)).toEqual({ left: 16, top: 96, height: 244, width: 400 })
  })

  it('ignores tab strips that are not adjacent to the scrollport top', () => {
    // A zero-height strip (unlaid-out) and a far-away strip both stay out.
    const flat = document.createElement('div')
    flat.setAttribute('role', 'tablist')
    document.body.appendChild(flat)
    const far = document.createElement('div')
    far.setAttribute('role', 'tablist')
    rect(far, { top: 0, left: 0, width: 400, height: 40 })
    document.body.appendChild(far)
    const scrollport = document.createElement('div')
    rect(scrollport, { top: 200, left: 10, width: 400, height: 300 })

    expect(measureGeometry(scrollport)).toEqual({ left: 16, top: 208, height: 284, width: 400 })
  })
})

describe('flowLeftX', () => {
  function flowRow(scrollport: HTMLElement, kind: string, left: number): HTMLElement {
    const el = document.createElement('div')
    el.setAttribute('data-chat-flow-kind', kind)
    rect(el, { top: 40, left, width: 100, height: 20 })
    scrollport.appendChild(el)
    return el
  }

  it('returns the left edge of the first flow row', () => {
    const scrollport = document.createElement('div')
    flowRow(scrollport, 'user', 200)
    flowRow(scrollport, 'assistant', 200)

    expect(flowLeftX(scrollport)).toBe(200)
  })

  it('returns null while no flow row is rendered', () => {
    const scrollport = document.createElement('div')
    expect(flowLeftX(scrollport)).toBeNull()
  })

  it('skips a withdrawn row left at x=0 and uses the real flow instead', () => {
    const scrollport = document.createElement('div')
    const hidden = document.createElement('div')
    hidden.setAttribute('data-chat-flow-kind', 'user')
    rect(hidden, { top: 40, left: 0, width: 0, height: 0 }) // withdrawn, not laid out
    scrollport.appendChild(hidden)
    flowRow(scrollport, 'message-tools-edited', 200) // the real bubble in the column

    expect(flowLeftX(scrollport)).toBe(200)
  })

  it('returns null when every flow row is unlaid-out or off-column', () => {
    const scrollport = document.createElement('div')
    const hidden = document.createElement('div')
    hidden.setAttribute('data-chat-flow-kind', 'user')
    rect(hidden, { top: 40, left: 0, width: 0, height: 0 })
    scrollport.appendChild(hidden)

    expect(flowLeftX(scrollport)).toBeNull()
  })
})

describe('activeRowKey', () => {
  function row(scrollport: HTMLElement, key: string, kind: string, top: number): HTMLElement {
    const el = document.createElement('div')
    el.setAttribute('data-chat-anchor-key', key)
    el.setAttribute('data-chat-flow-kind', kind)
    rect(el, { top, left: 0, width: 100, height: 20 })
    scrollport.appendChild(el)
    return el
  }

  it('returns the first user row whose bottom is inside the viewport', () => {
    const scrollport = document.createElement('div')
    rect(scrollport, { top: 50, left: 0, width: 400, height: 300 })
    row(scrollport, 'u1', 'user', 10)   // already scrolled past (bottom 30 < 50)
    row(scrollport, 'u2', 'user', 60)   // visible
    row(scrollport, 'a1', 'assistant', 100) // not a user row

    expect(activeRowKey(scrollport, true)).toBe('u2')
  })

  it('anchors to the nearest user row above the viewport inside a long answer', () => {
    const scrollport = document.createElement('div')
    rect(scrollport, { top: 50, left: 0, width: 400, height: 300 })
    row(scrollport, 'u1', 'user', -500) // scrolled far past
    row(scrollport, 'u2', 'user', 10)   // just above the viewport (bottom 30 <= 50)
    row(scrollport, 'a1', 'assistant', 60) // the long answer filling the view

    expect(activeRowKey(scrollport, true)).toBe('u2')
  })

  it('skips above-viewport rows that carry no anchor key', () => {
    const scrollport = document.createElement('div')
    rect(scrollport, { top: 50, left: 0, width: 400, height: 300 })
    row(scrollport, 'u1', 'user', 10)
    const keyless = document.createElement('div')
    keyless.setAttribute('data-chat-flow-kind', 'user')
    rect(keyless, { top: 20, left: 0, width: 100, height: 20 })
    scrollport.appendChild(keyless)
    row(scrollport, 'a1', 'assistant', 60)

    expect(activeRowKey(scrollport, true)).toBe('u1')
  })

  it('counts steering rows only when included', () => {
    const scrollport = document.createElement('div')
    rect(scrollport, { top: 0, left: 0, width: 400, height: 300 })
    row(scrollport, 's1', 'steering', 10)

    expect(activeRowKey(scrollport, false)).toBeNull()
    expect(activeRowKey(scrollport, true)).toBe('s1')
  })

  it('recognizes message-tools edited/restored rows as reading-position anchors', () => {
    // The rail renders edited/restored bubbles, so while reading one the lit
    // marker must anchor on it rather than jump to the next user row.
    const scrollport = document.createElement('div')
    rect(scrollport, { top: 0, left: 0, width: 400, height: 300 })
    row(scrollport, 'u1', 'user', -30) // scrolled past (bottom -10 <= 0)
    row(scrollport, 'e1', 'message-tools-edited', 60)
    row(scrollport, 'r1', 'message-tools-restored', 100)

    expect(activeRowKey(scrollport, true)).toBe('e1')
  })

  it('returns null with no visible user row', () => {
    const scrollport = document.createElement('div')
    rect(scrollport, { top: 0, left: 0, width: 400, height: 300 })
    row(scrollport, 'a1', 'assistant', 10)
    expect(activeRowKey(scrollport, true)).toBeNull()
  })

  it('returns null when the visible user row carries no anchor key', () => {
    const scrollport = document.createElement('div')
    rect(scrollport, { top: 0, left: 0, width: 400, height: 300 })
    const unkeyed = document.createElement('div')
    unkeyed.setAttribute('data-chat-flow-kind', 'user')
    rect(unkeyed, { top: 10, left: 0, width: 100, height: 20 })
    scrollport.appendChild(unkeyed)

    expect(activeRowKey(scrollport, true)).toBeNull()
  })
})

describe('jumpRow', () => {
  it('scrolls the target row to the top minus the offset', () => {
    const scrollport = document.createElement('div')
    rect(scrollport, { top: 20, left: 0, width: 400, height: 300 })
    const target = document.createElement('div')
    target.setAttribute('data-chat-anchor-key', 'u1')
    rect(target, { top: 120, left: 0, width: 100, height: 20 })
    scrollport.appendChild(target)
    scrollport.scrollTop = 50

    expect(jumpRow(scrollport, 'u1')).toBe(true)
    expect(scrollport.scrollTop).toBe(120 - 20 + 50 - 16)
  })

  it('clamps negative targets to the top', () => {
    const scrollport = document.createElement('div')
    rect(scrollport, { top: 20, left: 0, width: 400, height: 300 })
    const target = document.createElement('div')
    target.setAttribute('data-chat-anchor-key', 'u1')
    rect(target, { top: 5, left: 0, width: 100, height: 20 })
    scrollport.appendChild(target)
    scrollport.scrollTop = 0

    expect(jumpRow(scrollport, 'u1')).toBe(true)
    expect(scrollport.scrollTop).toBe(0)
  })

  it('reports false when the row is not rendered', () => {
    const scrollport = document.createElement('div')
    rect(scrollport, { top: 0, left: 0, width: 400, height: 300 })
    expect(jumpRow(scrollport, 'missing')).toBe(false)
  })
})

/** The list snapshot shape the tracker reads, across host lines. */
type FakeList = {
  ids: string[]
  byId: Record<string, { id: string; retainedBy?: Record<string, number> }>
  /** 0.1.5 line only: top-level current, no per-row retention. */
  current?: string | undefined
}

/** The 0.1.6-alpha.2 shape: the on-screen session is the row retained by the main view. */
function mainViewList(current: string | undefined): FakeList {
  return current === undefined
    ? { ids: [], byId: {} }
    : { ids: [current], byId: { [current]: { id: current, retainedBy: { mainView: 1 } } } }
}

function fakeSessions(current: string | undefined, opts: { legacy?: boolean } = {}) {
  const list = createSnapshotStore<FakeList>(
    opts.legacy === true && current !== undefined
      ? { ids: [current], byId: { [current]: { id: current } }, current }
      : mainViewList(current),
  )
  const provideInfo = createSnapshotStore({})
  return {
    list,
    currentProvideInfo: provideInfo,
    scope: (_sessionId: string) => ({
      get: (name: string) => (name === 'conversation' ? { loadOlder: vi.fn() } : undefined),
    }),
  }
}

/** Wait one animation frame (the tracker binds one frame out). */
function frame(): Promise<void> {
  return new Promise((resolve) => { requestAnimationFrame(() => { resolve() }) })
}

/** A fake client context carrying the fake sessions service. */
function fakeCtx(current: string | undefined, opts: { legacy?: boolean } = {}): { sessions: ReturnType<typeof fakeSessions> } {
  return { sessions: fakeSessions(current, opts) }
}

describe('installRailTracker', () => {
  it('binds the scrollport and publishes ready geometry for the current session', async () => {
    document.body.innerHTML = '<div data-conversation-scroll=""><div data-chat-flow=""><div data-chat-anchor-key="u1" data-chat-flow-kind="user"></div></div></div>'
    const scrollport = document.querySelector<HTMLElement>('[data-conversation-scroll]')!
    rect(scrollport, { top: 20, left: 10, width: 400, height: 300 })
    const user = scrollport.querySelector<HTMLElement>('[data-chat-anchor-key]')!
    rect(user, { top: 40, left: 200, width: 100, height: 20 })

    const tracker = installRailTracker(fakeCtx('s1') as unknown as Context, true)
    await frame()

    const state = tracker.state.getSnapshot()
    expect(state.sessionId).toBe('s1')
    expect(state.ready).toBe(true)
    expect(state.left).toBe(16)
    expect(state.scrollportWidth).toBe(400)
    expect(state.flowLeft).toBe(200)
    expect(state.activeKey).toBe('u1')
    expect(state.chatView).toBe(true)

    tracker.dispose()
  })

  it('reports chatView false when the rendered view is not chat', async () => {
    // No data-chat-flow marker: the trajectory view (or any other tab) is up.
    document.body.innerHTML = '<div data-conversation-scroll=""></div>'
    rect(document.querySelector<HTMLElement>('[data-conversation-scroll]')!, {
      top: 0, left: 0, width: 400, height: 300,
    })

    const tracker = installRailTracker(fakeCtx('s1') as unknown as Context, true)
    await frame()

    expect(tracker.state.getSnapshot().chatView).toBe(false)
    tracker.dispose()
  })

  it('stays hidden (ready false) when the scrollport probe fails, warning once', async () => {
    document.body.innerHTML = ''
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const tracker = installRailTracker(fakeCtx('s1') as unknown as Context, true)
    await frame()

    // No usable DOM means the state describes no session at all.
    expect(tracker.state.getSnapshot()).toMatchObject({ sessionId: undefined, ready: false })
    expect(warn).toHaveBeenCalledTimes(1)

    tracker.dispose()
  })

  it('jumpTo scrolls through the bound scrollport', async () => {
    document.body.innerHTML = '<div data-conversation-scroll=""><div data-chat-anchor-key="u1" data-chat-flow-kind="user"></div></div>'
    const scrollport = document.querySelector<HTMLElement>('[data-conversation-scroll]')!
    rect(scrollport, { top: 20, left: 0, width: 400, height: 300 })
    const target = scrollport.querySelector<HTMLElement>('[data-chat-anchor-key]')!
    rect(target, { top: 200, left: 0, width: 100, height: 20 })
    scrollport.scrollTop = 0

    const tracker = installRailTracker(fakeCtx('s1') as unknown as Context, true)
    await frame()

    tracker.jumpTo('u1')
    expect(scrollport.scrollTop).toBe(200 - 20 - 16)

    tracker.dispose()
  })

  it('publishes the idle state while no session is current', () => {
    const tracker = installRailTracker(fakeCtx(undefined) as unknown as Context, true)
    expect(tracker.state.getSnapshot()).toEqual({
      sessionId: undefined, ready: false, left: 0, top: 0, height: 0, scrollportWidth: 0, flowLeft: null,
      activeKey: null, chatView: false,
    } satisfies TimelineRailState)
    tracker.dispose()
  })

  it('rebinds when the current session changes', async () => {
    document.body.innerHTML = '<div data-conversation-scroll=""></div>'
    rect(document.querySelector<HTMLElement>('[data-conversation-scroll]')!, {
      top: 0, left: 0, width: 400, height: 300,
    })
    const ctx = fakeCtx('s1')
    const tracker = installRailTracker(ctx as unknown as Context, true)
    await frame()
    expect(tracker.state.getSnapshot().sessionId).toBe('s1')

    ctx.sessions.list.set(mainViewList('s2'))
    await frame()

    expect(tracker.state.getSnapshot().sessionId).toBe('s2')
    tracker.dispose()
  })

  it('binds and rebinds the 0.1.5-shaped list current when no row carries main-view retention', async () => {
    // The 0.1.5 host line publishes `current` with no per-row retainedBy; the
    // fallback keeps the rail tracking there.
    document.body.innerHTML = '<div data-conversation-scroll=""></div>'
    rect(document.querySelector<HTMLElement>('[data-conversation-scroll]')!, {
      top: 0, left: 0, width: 400, height: 300,
    })
    const legacy = fakeCtx('s1', { legacy: true })
    const legacyTracker = installRailTracker(legacy as unknown as Context, true)
    await frame()
    expect(legacyTracker.state.getSnapshot().sessionId).toBe('s1')

    legacy.sessions.list.set({ ids: ['s2'], byId: { s2: { id: 's2' } }, current: 's2' })
    await frame()

    expect(legacyTracker.state.getSnapshot().sessionId).toBe('s2')
    legacyTracker.dispose()
  })

  it('coalesces scroll-driven updates into one frame', async () => {
    document.body.innerHTML = '<div data-conversation-scroll=""></div>'
    rect(document.querySelector<HTMLElement>('[data-conversation-scroll]')!, {
      top: 0, left: 0, width: 400, height: 300,
    })
    const tracker = installRailTracker(fakeCtx('s1') as unknown as Context, true)
    await frame()
    const scrollport = document.querySelector<HTMLElement>('[data-conversation-scroll]')!

    scrollport.dispatchEvent(new Event('scroll'))
    scrollport.dispatchEvent(new Event('scroll'))
    await frame()

    expect(tracker.state.getSnapshot().ready).toBe(true)
    tracker.dispose()
  })

  it('observes the scrollport and the composer seat when ResizeObserver exists', async () => {
    const observe = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      observe = observe
      disconnect = vi.fn()
    })
    document.body.innerHTML = '<div data-conversation-scroll=""><div data-composer-seat=""></div></div>'
    rect(document.querySelector<HTMLElement>('[data-conversation-scroll]')!, {
      top: 0, left: 0, width: 400, height: 300,
    })
    const tracker = installRailTracker(fakeCtx('s1') as unknown as Context, true)
    await frame()

    expect(observe).toHaveBeenCalledTimes(2)
    tracker.dispose()
    vi.unstubAllGlobals()
  })

  it('jumpTo is a no-op while no scrollport is bound', () => {
    const tracker = installRailTracker(fakeCtx(undefined) as unknown as Context, true)
    expect(() => { tracker.jumpTo('k1') }).not.toThrow()
    tracker.dispose()
  })

  it('binds without the currentProvideInfo feed (host 0.1.2-alpha.1 removed it)', async () => {
    document.body.innerHTML = '<div data-conversation-scroll=""><div data-chat-flow=""><div data-chat-anchor-key="u1" data-chat-flow-kind="user"></div></div></div>'
    const scrollport = document.querySelector<HTMLElement>('[data-conversation-scroll]')!
    rect(scrollport, { top: 20, left: 10, width: 400, height: 300 })
    const sessions: Partial<ReturnType<typeof fakeSessions>> = fakeSessions('s1')
    delete sessions.currentProvideInfo

    const tracker = installRailTracker({ sessions } as unknown as Context, true)
    await frame()

    expect(tracker.state.getSnapshot()).toMatchObject({ sessionId: 's1', ready: true, left: 16 })
    tracker.dispose()
  })

  it('re-binds when the host remounts the scrollport under a stable session', async () => {
    document.body.innerHTML = '<div data-conversation-scroll=""></div>'
    const first = document.querySelector<HTMLElement>('[data-conversation-scroll]')!
    rect(first, { top: 20, left: 10, width: 400, height: 300 })
    const tracker = installRailTracker(fakeCtx('s1') as unknown as Context, true)
    await frame()
    expect(tracker.state.getSnapshot().left).toBe(16)

    // The conversation view remounts: the scrollport node is replaced. The
    // body MutationObserver cadence re-resolves it on the next frame.
    first.remove()
    const second = document.createElement('div')
    second.setAttribute('data-conversation-scroll', '')
    document.body.appendChild(second)
    rect(second, { top: 20, left: 40, width: 400, height: 300 })
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    await frame()
    await frame()

    expect(tracker.state.getSnapshot().left).toBe(46)
    tracker.dispose()
  })

  it('re-measures on a window resize (panel folds), and survives dispose', async () => {
    document.body.innerHTML = '<div data-conversation-scroll=""></div>'
    rect(document.querySelector<HTMLElement>('[data-conversation-scroll]')!, {
      top: 0, left: 0, width: 400, height: 300,
    })
    const tracker = installRailTracker(fakeCtx('s1') as unknown as Context, true)
    await frame()
    expect(tracker.state.getSnapshot().ready).toBe(true)

    window.dispatchEvent(new Event('resize'))
    await frame()
    expect(tracker.state.getSnapshot().ready).toBe(true)

    tracker.dispose()
    // No listener is left behind to throw on a later resize.
    window.dispatchEvent(new Event('resize'))
  })

  it('falls back to setTimeout when requestAnimationFrame is absent', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    document.body.innerHTML = '<div data-conversation-scroll=""></div>'
    rect(document.querySelector<HTMLElement>('[data-conversation-scroll]')!, {
      top: 0, left: 0, width: 400, height: 300,
    })
    const tracker = installRailTracker(fakeCtx('s1') as unknown as Context, true)
    await new Promise((resolve) => { setTimeout(resolve, 30) })

    expect(tracker.state.getSnapshot().ready).toBe(true)
    tracker.dispose()
    vi.unstubAllGlobals()
  })

  it('notifies subscribers on publish and skips identical publishes', async () => {
    document.body.innerHTML = '<div data-conversation-scroll=""></div>'
    rect(document.querySelector<HTMLElement>('[data-conversation-scroll]')!, {
      top: 0, left: 0, width: 400, height: 300,
    })
    const tracker = installRailTracker(fakeCtx('s1') as unknown as Context, true)
    const listener = vi.fn()
    tracker.state.subscribe(listener)
    await frame()

    expect(listener).toHaveBeenCalledTimes(1)
    tracker.dispose()
  })

  it('ignores updates after dispose (unbound scrollport)', async () => {
    document.body.innerHTML = '<div data-conversation-scroll=""></div>'
    rect(document.querySelector<HTMLElement>('[data-conversation-scroll]')!, {
      top: 0, left: 0, width: 400, height: 300,
    })
    const tracker = installRailTracker(fakeCtx('s1') as unknown as Context, true)
    await frame()
    const scrollport = document.querySelector<HTMLElement>('[data-conversation-scroll]')!

    scrollport.dispatchEvent(new Event('scroll')) // schedules a pending frame
    tracker.dispose()
    await frame() // the pending update runs against no bound scrollport

    expect(tracker.state.getSnapshot().ready).toBe(true) // state untouched
  })

  it('skips the update while the scrollport has no laid-out size', async () => {
    document.body.innerHTML = '<div data-conversation-scroll=""></div>'
    rect(document.querySelector<HTMLElement>('[data-conversation-scroll]')!, {
      top: 0, left: 0, width: 400, height: 300,
    })
    const tracker = installRailTracker(fakeCtx('s1') as unknown as Context, true)
    await frame()
    const scrollport = document.querySelector<HTMLElement>('[data-conversation-scroll]')!
    vi.restoreAllMocks() // getBoundingClientRect falls back to all-zero boxes

    scrollport.dispatchEvent(new Event('scroll'))
    await frame()

    expect(tracker.state.getSnapshot().ready).toBe(true) // geometry stays put
    tracker.dispose()
  })

  it('skips rebinding the same session while its scrollport is bound', async () => {
    document.body.innerHTML = '<div data-conversation-scroll=""></div>'
    rect(document.querySelector<HTMLElement>('[data-conversation-scroll]')!, {
      top: 0, left: 0, width: 400, height: 300,
    })
    const ctx = fakeCtx('s1')
    const tracker = installRailTracker(ctx as unknown as Context, true)
    await frame()

    ctx.sessions.list.set(mainViewList('s1'))
    await frame()

    expect(tracker.state.getSnapshot().sessionId).toBe('s1')
    tracker.dispose()
  })

  it('does not bind the scrollport after a dispose that lands before the initial bind frame', async () => {
    // The bind schedules one frame out. If dispose() runs before that frame, the
    // pending frame would otherwise still bind the global scrollport — adding a
    // scroll listener and a ResizeObserver to a tracker that is already torn
    // down. The generation token must invalidate it.
    document.body.innerHTML = '<div data-conversation-scroll=""></div>'
    rect(document.querySelector<HTMLElement>('[data-conversation-scroll]')!, {
      top: 0, left: 0, width: 400, height: 300,
    })
    const addSpy = vi.spyOn(HTMLElement.prototype, 'addEventListener')
    const tracker = installRailTracker(fakeCtx('s1') as unknown as Context, true)

    // Dispose before the frame flushes — the dangerous window.
    tracker.dispose()
    await frame()

    // No scroll listener was ever attached (and no geometry ever published).
    expect(addSpy).not.toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true })
    expect(tracker.state.getSnapshot().ready).toBe(false)
  })

  it('binds only the latest session when the session changes before the pending bind frame', async () => {
    // Two bind() calls in the same tick (before the frame out binds) race: the
    // first frame would bind under the stale session. The token must ignore it,
    // so only the last session ever gets a bound scrollport.
    document.body.innerHTML = '<div data-conversation-scroll=""></div>'
    rect(document.querySelector<HTMLElement>('[data-conversation-scroll]')!, {
      top: 0, left: 0, width: 400, height: 300,
    })
    const ctx = fakeCtx(undefined)
    const tracker = installRailTracker(ctx as unknown as Context, true)

    // Two session changes land before either bind frame runs.
    ctx.sessions.list.set(mainViewList('s1'))
    ctx.sessions.list.set(mainViewList('s2'))
    await frame()

    expect(tracker.state.getSnapshot().sessionId).toBe('s2')
    expect(tracker.state.getSnapshot().ready).toBe(true)
    tracker.dispose()
  })

  it('observes only the scrollport when the composer seat is absent', async () => {
    const observe = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      observe = observe
      disconnect = vi.fn()
    })
    document.body.innerHTML = '<div data-conversation-scroll=""></div>'
    rect(document.querySelector<HTMLElement>('[data-conversation-scroll]')!, {
      top: 0, left: 0, width: 400, height: 300,
    })
    const tracker = installRailTracker(fakeCtx('s1') as unknown as Context, true)
    await frame()

    expect(observe).toHaveBeenCalledTimes(1)
    tracker.dispose()
    vi.unstubAllGlobals()
  })

  it('warns only once across rebinds that keep failing the probe', async () => {
    document.body.innerHTML = ''
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = fakeCtx(undefined)
    const tracker = installRailTracker(ctx as unknown as Context, true)

    ctx.sessions.list.set(mainViewList('s1'))
    await frame()
    expect(warn).toHaveBeenCalledTimes(1)

    ctx.sessions.list.set(mainViewList(undefined))
    await frame()
    ctx.sessions.list.set(mainViewList('s1'))
    await frame()

    expect(warn).toHaveBeenCalledTimes(1)
    tracker.dispose()
  })
})
