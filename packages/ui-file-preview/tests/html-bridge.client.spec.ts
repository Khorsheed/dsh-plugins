// @vitest-environment jsdom
/**
 * The host-side capability bridge: only the controlled iframe's window is
 * honored, unknown functions and malformed args get error replies, and the
 * whitelist (https-only openLink, data:-only download) holds.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachBridge } from '../src/client/html-bridge.ts'

interface FakeWin {
  postMessage: ReturnType<typeof vi.fn>
}

function makeFrame(): { frame: { contentWindow: FakeWin }; win: FakeWin } {
  const win: FakeWin = { postMessage: vi.fn() }
  return { frame: { contentWindow: win }, win }
}

/** Dispatch a message event whose `source` is the fake frame window (jsdom
 * MessageEventInit does not reliably carry `source`, so it is set directly). */
function dispatch(data: unknown, source: FakeWin): void {
  const event = new MessageEvent('message', { data })
  Object.defineProperty(event, 'source', { value: source })
  window.dispatchEvent(event)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('attachBridge', () => {
  it('ignores messages from other windows', () => {
    const { frame } = makeFrame()
    const detach = attachBridge(frame as never)
    dispatch({ id: 'x', fn: 'openLink', args: ['https://example.com'] }, { postMessage: vi.fn() })
    expect(frame.contentWindow.postMessage).not.toHaveBeenCalled()
    detach()
  })

  it('replies with an error for an unknown function', () => {
    const { frame, win } = makeFrame()
    const detach = attachBridge(frame as never)
    dispatch({ id: 'a', fn: 'stealData', args: [] }, win)
    expect(win.postMessage).toHaveBeenCalledWith(
      { id: 'a', ok: false, error: 'unknown bridge function: stealData' },
      '*',
    )
    detach()
  })

  it('opens https links with noopener and refuses other schemes', async () => {
    const { frame, win } = makeFrame()
    const open = vi.fn()
    Object.defineProperty(window, 'open', { value: open, configurable: true })
    const detach = attachBridge(frame as never)
    dispatch({ id: 'b', fn: 'openLink', args: ['https://example.com/page'] }, win)
    // Handlers run through a microtask; await the reply.
    await vi.waitFor(() => {
      expect(open).toHaveBeenCalledWith('https://example.com/page', '_blank', 'noopener,noreferrer')
      expect(win.postMessage).toHaveBeenCalledWith({ id: 'b', ok: true, result: undefined }, '*')
    })
    dispatch({ id: 'c', fn: 'openLink', args: ['javascript:alert(1)'] }, win)
    await vi.waitFor(() => {
      const errorCall = win.postMessage.mock.calls.find((call: unknown[]) => call[0]?.id === 'c')
      expect(errorCall?.[0]?.ok).toBe(false)
      expect(String(errorCall?.[0]?.error)).toContain('https')
    })
    detach()
  })

  it('copies text through the async clipboard and falls back when absent', async () => {
    const { frame, win } = makeFrame()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const detach = attachBridge(frame as never)
    dispatch({ id: 'd', fn: 'copy', args: ['hello'] }, win)
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('hello')
      expect(win.postMessage).toHaveBeenCalledWith({ id: 'd', ok: true, result: undefined }, '*')
    })
    detach()
  })

  it('downloads only data: URLs', async () => {
    const { frame, win } = makeFrame()
    const click = vi.fn()
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'a') return { href: '', download: '', click } as never
      return document.createElement(tag)
    })
    const detach = attachBridge(frame as never)
    dispatch({ id: 'e', fn: 'download', args: ['file.png', 'data:image/png;base64,AAA'] }, win)
    await vi.waitFor(() => {
      expect(click).toHaveBeenCalled()
      expect(win.postMessage).toHaveBeenCalledWith({ id: 'e', ok: true, result: undefined }, '*')
    })
    dispatch({ id: 'f', fn: 'download', args: ['file', 'https://evil.example/x'] }, win)
    await vi.waitFor(() => {
      const errorCall = win.postMessage.mock.calls.find((call: unknown[]) => call[0]?.id === 'f')
      expect(errorCall?.[0]?.ok).toBe(false)
      expect(String(errorCall?.[0]?.error)).toContain('data:')
    })
    detach()
  })
})
