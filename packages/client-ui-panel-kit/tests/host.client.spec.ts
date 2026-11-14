/**
 * Unit tests for browserOnHost: loopback and the desktop application are local,
 * remote documents are not, and an unreadable location keeps the on-host default.
 */
import { describe, expect, it } from 'vitest'
import { browserOnHost } from '../src/client/host.ts'

describe('browserOnHost', () => {
  it('recognizes the desktop application and loopback as local, and remote documents as remote', () => {
    for (const hostname of ['localhost', '127.0.0.1', '[::1]', '::1', 'LOCALHOST']) {
      expect(browserOnHost({ location: { hostname } })).toBe(true)
    }
    expect(browserOnHost({ location: new URL('dsh-app://app/') })).toBe(true)
    expect(browserOnHost({ location: new URL('dsh-app://shell/update-dialog.html') })).toBe(false)
    expect(browserOnHost({ location: new URL('https://app/') })).toBe(false)
    expect(browserOnHost({ location: { hostname: 'bridge-spider.trycloudflare.com' } })).toBe(false)
    expect(browserOnHost({ location: { hostname: '192.168.1.20' } })).toBe(false)
    expect(browserOnHost({})).toBe(true)
    expect(browserOnHost({ location: { hostname: '' } })).toBe(true)
  })
})
