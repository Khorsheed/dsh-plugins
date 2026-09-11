// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { hasNativeAction, reportChrome, requestNativeAction } from '../src/client/native.ts'

afterEach(() => { delete window.__DSH_MOBILE_SHELL__; delete window.webkit })
it('degrades in browsers, older shells and unknown bridge versions', () => {
  const postMessage = vi.fn()
  window.webkit = { messageHandlers: { dshMobile: { postMessage } } }
  for (const marker of [undefined, { bridgeVersion: 1 }, { bridgeVersion: 2, capabilities: ['scan', 'settings'] }]) {
    window.__DSH_MOBILE_SHELL__ = marker
    expect(hasNativeAction('scan')).toBe(false)
    requestNativeAction('scan'); reportChrome(true)
  }
  expect(postMessage).not.toHaveBeenCalled()
})
it('reports mounted chrome separately from plugin readiness and restores native fallback on teardown', () => {
  const postMessage = vi.fn()
  window.__DSH_MOBILE_SHELL__ = { bridgeVersion: 1, capabilities: ['settings'] }
  window.webkit = { messageHandlers: { dshMobile: { postMessage } } }
  reportChrome(true); requestNativeAction('settings'); reportChrome(false)
  expect(postMessage.mock.calls.map(([value]) => value)).toEqual([
    { type: 'chrome', bridgeVersion: 1, visible: true }, { type: 'settings', bridgeVersion: 1 }, { type: 'chrome', bridgeVersion: 1, visible: false },
  ])
  expect(hasNativeAction('scan')).toBe(false)
})
