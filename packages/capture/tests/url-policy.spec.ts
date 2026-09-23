/**
 * The URL policy matrix: every refusal class the SSRF gate owns, at the pure
 * level. DNS is stubbed through the `lookup` seam — no test here touches a
 * resolver.
 */
import { describe, expect, it } from 'vitest'
import {
  checkNavigationTarget,
  checkResolvedTarget,
  checkUrlSyntax,
  classifyAddress,
  isIpLiteral,
  parseIpv4,
  parseIpv6Groups,
  type CaptureHostLookup,
} from '../src/index.ts'

/** A stub resolver returning the given addresses for any host. */
const resolving = (...addresses: string[]): CaptureHostLookup =>
  async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))

const PUBLIC = '93.184.216.34'

describe('checkUrlSyntax', () => {
  it('accepts http and https URLs', () => {
    for (const raw of ['http://example.com/a?b=c', 'https://example.com/']) {
      const verdict = checkUrlSyntax(raw)
      expect(verdict.ok).toBe(true)
    }
  })

  it('refuses non-web schemes before anything else runs', () => {
    for (const raw of [
      'file:///etc/passwd',
      'data:text/html,<script>alert(1)</script>',
      'javascript:alert(1)',
      'chrome://settings',
      'about:blank',
      'ftp://example.com/file',
      'ws://example.com/socket',
    ]) {
      const verdict = checkUrlSyntax(raw)
      expect(verdict.ok, raw).toBe(false)
      if (!verdict.ok) expect(verdict.code).toBe('capture/invalid-url')
    }
  })

  it('refuses URLs with embedded credentials (login state in the address bar)', () => {
    const verdict = checkUrlSyntax('https://user:pass@example.com/')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.code).toBe('capture/invalid-url')
  })

  it('refuses unparseable input and URLs without a host', () => {
    // Note: `https:///path-only` is not a case here — the WHATWG parser turns
    // it into host `path-only`, and the DNS stage refuses it instead.
    for (const raw of ['not a url', 'http://', 'http://:8080/']) {
      expect(checkUrlSyntax(raw).ok, raw).toBe(false)
    }
  })
})

describe('address classification', () => {
  it('parses canonical IPv4 and rejects malformed forms', () => {
    expect(parseIpv4('127.0.0.1')).toBe(0x7f000001)
    expect(parseIpv4('256.1.1.1')).toBeUndefined()
    expect(parseIpv4('1.2.3')).toBeUndefined()
    expect(parseIpv4('01.2.3.4')).toBeUndefined() // non-canonical octets are not classified as IPv4
  })

  it('expands IPv6 groups, including the compressed form', () => {
    expect(parseIpv6Groups('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
    expect(parseIpv6Groups('2606:4700:4700::1111')).toEqual([0x2606, 0x4700, 0x4700, 0, 0, 0, 0, 0x1111])
    expect(parseIpv6Groups('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1])
    expect(parseIpv6Groups('not-an-ip')).toBeUndefined()
  })

  it('classifies the whole refusal matrix', () => {
    const cases: Array<[string, string]> = [
      ['127.0.0.1', 'loopback'],
      ['127.1.2.3', 'loopback'],
      ['10.0.0.1', 'private'],
      ['172.16.0.1', 'private'],
      ['172.31.255.255', 'private'],
      ['172.15.0.1', 'public'],
      ['172.32.0.1', 'public'],
      ['192.168.1.1', 'private'],
      ['169.254.169.254', 'link-local'], // cloud metadata
      ['169.254.0.1', 'link-local'],
      ['100.64.0.1', 'private'], // CGNAT
      ['0.0.0.0', 'unspecified'],
      ['192.0.0.1', 'reserved'],
      ['192.0.2.1', 'reserved'], // documentation
      ['198.51.100.1', 'reserved'],
      ['203.0.113.1', 'reserved'],
      ['198.18.0.1', 'reserved'], // benchmarking
      ['224.0.0.1', 'multicast'],
      ['255.255.255.255', 'reserved'],
      ['::1', 'loopback'],
      ['::', 'unspecified'],
      ['fe80::1', 'link-local'],
      ['fc00::1', 'private'],
      ['fd12:3456::1', 'private'],
      ['ff02::1', 'multicast'],
      ['2001:db8::1', 'reserved'], // documentation
      ['::ffff:127.0.0.1', 'loopback'], // IPv4-mapped
      ['::ffff:8.8.8.8', 'public'],
      ['64:ff9b::7f00:1', 'loopback'], // NAT64 well-known prefix
      ['64:ff9b::808:808', 'public'],
      ['2002:7f00:1::', 'loopback'], // 6to4
      ['2002:808:808::', 'public'],
      ['8.8.8.8', 'public'],
      ['2606:4700:4700::1111', 'public'],
    ]
    for (const [address, expected] of cases) {
      expect(classifyAddress(address), address).toBe(expected)
    }
  })

  it('recognizes IP literals, bracketed IPv6 included', () => {
    expect(isIpLiteral('127.0.0.1')).toBe(true)
    expect(isIpLiteral('[::1]')).toBe(true)
    expect(isIpLiteral('example.com')).toBe(false)
  })
})

describe('checkResolvedTarget', () => {
  it('refuses localhost by name without consulting DNS', async () => {
    const neverCalled: CaptureHostLookup = async () => {
      throw new Error('DNS must not run for localhost')
    }
    for (const raw of ['http://localhost:3000/', 'https://evil.localhost/']) {
      const verdict = await checkResolvedTarget(new URL(raw), neverCalled)
      expect(verdict.ok, raw).toBe(false)
      if (!verdict.ok) expect(verdict.code).toBe('capture/private-target')
    }
  })

  it('classifies IP literals directly (the parser has already normalized exotic spellings)', async () => {
    const neverCalled: CaptureHostLookup = async () => {
      throw new Error('DNS must not run for literals')
    }
    for (const raw of [
      'http://127.0.0.1/',
      'http://[::1]:8080/',
      'http://169.254.169.254/latest/meta-data',
      'http://2130706433/', // 127.0.0.1 as an integer — the URL parser normalizes it
      'http://0x7f.1/', // hex octets — same
    ]) {
      const verdict = await checkResolvedTarget(new URL(raw), neverCalled)
      expect(verdict.ok, raw).toBe(false)
      if (!verdict.ok) expect(verdict.code, raw).toBe('capture/private-target')
    }
    expect((await checkResolvedTarget(new URL('http://8.8.8.8/'), neverCalled)).ok).toBe(true)
  })

  it('refuses when ANY resolved address is non-public', async () => {
    const mixed = await checkResolvedTarget(new URL('https://example.com/'), resolving(PUBLIC, '10.0.0.9'))
    expect(mixed.ok).toBe(false)
    if (!mixed.ok) expect(mixed.code).toBe('capture/private-target')
    expect((await checkResolvedTarget(new URL('https://example.com/'), resolving(PUBLIC, PUBLIC))).ok).toBe(true)
  })

  it('refuses an unresolvable host (an unvalidated host is never navigated to)', async () => {
    const failing: CaptureHostLookup = async () => {
      throw new Error('ENOTFOUND')
    }
    const verdict = await checkResolvedTarget(new URL('https://no-such-host.invalid/'), failing)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.code).toBe('capture/invalid-url')
    expect((await checkResolvedTarget(new URL('https://empty.invalid/'), resolving())).ok).toBe(false)
  })
})

describe('checkNavigationTarget (the per-hop gate)', () => {
  it('runs syntax before resolution', async () => {
    const neverCalled: CaptureHostLookup = async () => {
      throw new Error('DNS must not run for a syntax refusal')
    }
    const verdict = await checkNavigationTarget('file:///etc/passwd', neverCalled)
    expect(verdict.ok).toBe(false)
  })

  it('passes a public host end to end', async () => {
    const verdict = await checkNavigationTarget('https://example.com/page', resolving(PUBLIC))
    expect(verdict.ok).toBe(true)
  })
})
