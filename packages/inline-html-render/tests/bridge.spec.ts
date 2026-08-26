// @vitest-environment jsdom
// Bridge: validates every iframe message (source window + whitelist + arg
// shape), replies to calls, and handles the cross-origin height report (`fn:
// 'resize'` with no id) by sizing the frame.

import { afterEach, describe, expect, it } from 'vitest'
import { attachBridge } from '../src/client/bridge.ts'

afterEach(() => {
  document.body.innerHTML = ''
})

function makeFrame(): HTMLIFrameElement {
  const f = document.createElement('iframe')
  f.srcdoc = '<html><body></body></html>'
  return f
}

/**
 * jsdom does not dispatch a parent `message` event for a postMessage sent from
 * an iframe's contentWindow, so tests dispatch a synthetic MessageEvent whose
 * `source` is that window — exactly what the bridge checks (`event.source ===
 * frame.contentWindow`).
 */
function dispatch(f: HTMLIFrameElement, data: unknown): void {
  const event = new MessageEvent('message', { data, source: f.contentWindow })
  window.dispatchEvent(event)
}

describe('attachBridge', () => {
  it('sizes the frame on a resize height report', () => {
    const frame = makeFrame()
    const dispose = attachBridge(frame)
    dispatch(frame, { fn: 'resize', args: [640] })
    expect(frame.style.height).toBe('641px')
    dispose()
  })

  it('ignores a resize with a non-finite height', () => {
    const frame = makeFrame()
    frame.style.height = 'auto'
    const dispose = attachBridge(frame)
    dispatch(frame, { fn: 'resize', args: ['oops'] })
    expect(frame.style.height).toBe('auto')
    dispose()
  })

  it('caps an oversized height report', () => {
    const frame = makeFrame()
    const dispose = attachBridge(frame)
    dispatch(frame, { fn: 'resize', args: [99999999] })
    expect(Number(frame.style.height.replace('px', ''))).toBeLessThanOrEqual(20_000)
    dispose()
  })
})
