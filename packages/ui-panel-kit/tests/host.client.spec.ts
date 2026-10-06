/**
 * Unit tests for browserOnHost: loopback only, and an unreadable location
 * keeps the on-host default.
 */
import { describe, expect, it } from 'vitest'
import { browserOnHost } from '../src/client/host.ts'

describe('browserOnHost', () => {
  it('is true only for loopback hostnames, and for an unreadable location', () => {
    for (const hostname of ['localhost', '127.0.0.1', '[::1]', '::1', 'LOCALHOST']) {
      expect(browserOnHost({ location: { hostname } })).toBe(true)
    }
    expect(browserOnHost({ location: { hostname: 'bridge-spider.trycloudflare.com' } })).toBe(false)
    expect(browserOnHost({ location: { hostname: '192.168.1.20' } })).toBe(false)
    expect(browserOnHost({})).toBe(true)
    expect(browserOnHost({ location: { hostname: '' } })).toBe(true)
  })
})
