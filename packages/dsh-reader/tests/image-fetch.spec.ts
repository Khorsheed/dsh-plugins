/**
 * The image rescue fetch: policy, transport, and cache.
 *
 * The transport cases run against a REAL fixture server on 127.0.0.1 — the
 * address the policy exists to refuse. The seams make that honest: `resolve`
 * answers the POLICY a public address (so validation passes exactly as it
 * would for a public CDN), while `lookup` dials the loopback fixture — in
 * production the two are the same answer set, and that identity is the pin.
 * The refusal cases assert on the server's hit counter: a refused URL must
 * never become a request.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  fetchImageBytes,
  ImageFetchCache,
  type ImageFetchSeams,
} from '../src/image-fetch.ts'

/** A handful of bytes standing in for a PNG (the content-type governs, not the magic). */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

/** A public address for the policy's resolver — classified public, never dialed. */
const PUBLIC_ANSWER = [{ address: '93.184.216.34', family: 4 }]

let server: Server
let port: number
/** Requests the fixture actually answered, by path — the refusal oracle. */
let hits: Map<string, number>

beforeAll(async () => {
  hits = new Map()
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] as string
    hits.set(path, (hits.get(path) ?? 0) + 1)
    if (path === '/ok.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.byteLength })
      res.end(PNG)
      return
    }
    if (path === '/param.png') {
      res.writeHead(200, { 'content-type': 'Image/PNG; charset=binary' })
      res.end(PNG)
      return
    }
    if (path === '/big.png') {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(Buffer.alloc(64, 1))
      return
    }
    if (path === '/page') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html><body>not an image</body></html>')
      return
    }
    if (path === '/redirect') {
      res.writeHead(302, { location: '/ok.png' })
      res.end()
      return
    }
    if (path === '/escape') {
      // The classic SSRF hop: a public URL redirecting into the loopback the
      // policy just vouched nothing about.
      res.writeHead(302, { location: `http://127.0.0.1:${port}/ok.png` })
      res.end()
      return
    }
    if (path === '/loop') {
      res.writeHead(302, { location: '/loop' })
      res.end()
      return
    }
    if (path === '/slow.png') {
      // Never answered: the timeout is what the reader gets.
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('gone')
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
})

/** The seams that put a fixture URL through the real pipeline. */
function fixtureSeams(over: Partial<ImageFetchSeams> = {}): ImageFetchSeams {
  return {
    resolve: async () => PUBLIC_ANSWER,
    // Node's autoSelectFamily asks with `all: true`; the pin must answer in kind.
    lookup: (_hostname, options, callback) => options.all === true
      ? callback(null, [{ address: '127.0.0.1', family: 4 }])
      : callback(null, '127.0.0.1', 4),
    ...over,
  }
}

/** One fixture URL through the rescue fetch. */
const fixtureUrl = (path: string): string => `http://fixture.invalid:${port}${path}`

describe('fetchImageBytes — the policy gate', () => {
  it('refuses every non-public target before any request is made', async () => {
    const cases = [
      'http://localhost/ok.png',
      'http://internal.localhost/ok.png',
      'http://127.0.0.1/ok.png',
      'http://[::1]/ok.png',
      // IPv4-mapped and NAT64 transition forms classify by their embedded v4.
      'http://[::ffff:127.0.0.1]/ok.png',
      'http://[64:ff9b::a9fe:a9fe]/ok.png',
      // The cloud metadata address.
      'http://169.254.169.254/latest/meta-data',
      // The WHATWG parser normalizes a decimal IPv4 before the gate sees it.
      'http://2130706433/ok.png',
      'http://10.0.0.8/ok.png',
      'http://192.168.1.1/ok.png',
    ]
    for (const url of cases) {
      const outcome = await fetchImageBytes(url)
      expect(outcome.ok, url).toBe(false)
      if (outcome.ok) continue
      expect(outcome.error, url).not.toBe('invalid-url')
    }
  })

  it('refuses non-http schemes and credentialed URLs', async () => {
    for (const url of ['ftp://example.com/x.png', 'file:///etc/passwd', 'http://user:pass@example.com/x.png']) {
      const outcome = await fetchImageBytes(url)
      expect(outcome.ok, url).toBe(false)
    }
    expect((await fetchImageBytes('not a url')).error).toBe('invalid-url')
  })

  it('refuses a hostname whose DNS answer is private, without dialing it', async () => {
    const before = hits.get('/ok.png') ?? 0
    const outcome = await fetchImageBytes(fixtureUrl('/ok.png'), {
      resolve: async () => [{ address: '10.0.0.1', family: 4 }],
      lookup: () => { throw new Error('must not dial') },
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toContain('private')
    expect(hits.get('/ok.png') ?? 0).toBe(before)
  })

  it('refuses a hostname that does not resolve', async () => {
    const outcome = await fetchImageBytes(fixtureUrl('/ok.png'), {
      resolve: async () => { throw new Error('ENOTFOUND') },
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toContain('cannot resolve')
  })
})

describe('fetchImageBytes — the transport', () => {
  it('fetches an image and returns its bytes base64-encoded with the declared type', async () => {
    const outcome = await fetchImageBytes(fixtureUrl('/ok.png'), fixtureSeams())
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.mime).toBe('image/png')
    expect(Buffer.from(outcome.base64, 'base64').equals(PNG)).toBe(true)
  })

  it('accepts a content-type with parameters and any casing', async () => {
    const outcome = await fetchImageBytes(fixtureUrl('/param.png'), fixtureSeams())
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.mime).toBe('image/png')
  })

  it('refuses a non-image response before reading its body', async () => {
    const outcome = await fetchImageBytes(fixtureUrl('/page'), fixtureSeams())
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toContain('not an image')
  })

  it('refuses a body over the byte cap', async () => {
    const outcome = await fetchImageBytes(fixtureUrl('/big.png'), fixtureSeams(), { maxBytes: 16 })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toContain('cap')
  })

  it('answers HTTP 404 as an error, not as a payload', async () => {
    const outcome = await fetchImageBytes(fixtureUrl('/gone'), fixtureSeams())
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toBe('HTTP 404')
  })

  it('follows a same-server redirect, re-validating the hop', async () => {
    const outcome = await fetchImageBytes(fixtureUrl('/redirect'), fixtureSeams())
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.mime).toBe('image/png')
  })

  it('refuses a redirect INTO the private network, mid-flight', async () => {
    const before = hits.get('/ok.png') ?? 0
    const outcome = await fetchImageBytes(fixtureUrl('/escape'), fixtureSeams())
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toContain('loopback')
    // The hop's target was never requested: the gate ran before the dial.
    expect(hits.get('/ok.png') ?? 0).toBe(before)
  })

  it('gives up on a redirect loop instead of following it forever', async () => {
    const outcome = await fetchImageBytes(fixtureUrl('/loop'), fixtureSeams(), { maxRedirects: 2 })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toContain('redirect')
  })

  it('times out instead of hanging the rescue', async () => {
    const outcome = await fetchImageBytes(fixtureUrl('/slow.png'), fixtureSeams(), { timeoutMs: 100 })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toContain('timed out')
  })
})

describe('ImageFetchCache', () => {
  it('round-trips one entry and refreshes its recency on read', () => {
    const cache = new ImageFetchCache(100)
    cache.set('a', 'image/png', 'x'.repeat(40))
    cache.set('b', 'image/png', 'x'.repeat(40))
    // Reading `a` makes `b` the oldest: the next insert evicts b, not a.
    expect(cache.get('a')?.mime).toBe('image/png')
    cache.set('c', 'image/png', 'x'.repeat(40))
    expect(cache.get('a')).toBeDefined()
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBeDefined()
  })

  it('never stores an entry larger than the whole budget', () => {
    const cache = new ImageFetchCache(10)
    cache.set('huge', 'image/png', 'x'.repeat(11))
    expect(cache.get('huge')).toBeUndefined()
  })

  it('replaces an existing URL without double-counting its bytes', () => {
    const cache = new ImageFetchCache(60)
    cache.set('a', 'image/png', 'x'.repeat(30))
    cache.set('a', 'image/png', 'y'.repeat(30))
    cache.set('b', 'image/png', 'z'.repeat(30))
    // Had the replace counted twice (60 bytes for a), inserting b would have
    // pushed the map over its 60-byte budget and evicted a.
    expect(cache.get('a')?.base64).toBe('y'.repeat(30))
    expect(cache.get('b')).toBeDefined()
  })
})
