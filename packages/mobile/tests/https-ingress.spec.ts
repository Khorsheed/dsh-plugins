import http from 'node:http'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
// Optional standalone deployment example, intentionally separate from Cordis.
import { createIngress } from '../examples/https-ingress.mjs'
import { validator } from './fixtures/safari-validator.ts'
import { MAX_COMPAT_BYTES } from '../examples/safari-stream-compat.mjs'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
const host = 'preview.example'
const headers = { host, 'x-forwarded-proto': 'https', origin: `https://${host}` }
async function listen(server: http.Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as { port: number }).port
}
async function setup(handler: http.RequestListener, safariStreamCompat = false) {
  const target = http.createServer(handler)
  const targetPort = await listen(target)
  cleanup.push(() => new Promise<void>(resolve => { target.closeAllConnections(); target.close(() => resolve()) }))
  const ingress = createIngress({ origin: `https://${host}`, targetPort, safariStreamCompat })
  const port = await listen(ingress.server)
  cleanup.push(ingress.close)
  return { port, target }
}
function request(port: number, extra: http.RequestOptions = {}) {
  return new Promise<{ code: number; headers: http.IncomingHttpHeaders; body: string; bytes: Buffer }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/', headers, ...extra }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => { chunks.push(chunk) })
      response.on('end', () => { const bytes = Buffer.concat(chunks); resolve({ code: response.statusCode!, headers: response.headers, body: bytes.toString(), bytes }) })
    })
    req.on('error', reject); req.end()
  })
}
describe('optional HTTPS tunnel ingress', () => {
  const safariHeaders = { ...headers, 'user-agent': 'iPhone AppleWebKit/605.1.15 Mobile/15E148' }
  it('compresses both adapted and untouched bundles without changing decoded script bytes', async () => {
    for (const source of [validator, '/* unchanged bundle */']) {
      const body = source + '\n/*' + 'large UI source '.repeat(4000) + '*/'
      const { port } = await setup((_req, res) => { res.writeHead(200, { 'content-type': 'text/javascript', vary: 'Origin', etag: 'old', digest: 'old' }); res.end(body) }, true)
      const result = await request(port, { path: '/plugins/', headers: { ...safariHeaders, 'accept-encoding': 'br, gzip;q=0.8' } })
      expect(result.headers['content-encoding']).toBe('gzip')
      expect(result.bytes.length).toBeLessThan(Buffer.byteLength(body) / 4)
      expect(Number(result.headers['content-length'])).toBe(result.bytes.length)
      expect(gunzipSync(result.bytes).toString()).toBe(body.replace('`function ${name}() { [native code] }`', 'Function.prototype.toString.call(globalThis[name])'))
      expect(result.headers.vary).toBe('Origin, Accept-Encoding')
      expect(result.headers.etag).toBeUndefined()
      expect(result.headers.digest).toBeUndefined()
    }
  })
  it('honors gzip exclusions and preserves identity when gzip is not accepted', async () => {
    const body = '/*' + 'unchanged source '.repeat(200) + '*/'
    const { port } = await setup((_req, res) => { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(body) }, true)
    for (const encoding of ['', 'br', 'gzip;q=0, *;q=1', '*;q=0', 'gzip;q=invalid']) {
      const result = await request(port, { path: '/plugins/', headers: { ...safariHeaders, 'accept-encoding': encoding } })
      expect(result.headers['content-encoding']).toBeUndefined()
      expect(result.body).toBe(body)
    }
  })
  it('adapts authenticated Safari JS and removes stale byte validators and cache conditions', async () => {
    const { port } = await setup((req, res) => {
      expect(req.headers.cookie).toBe('login=fixture')
      expect(req.headers['accept-encoding']).toBe('identity')
      for (const field of ['if-none-match', 'if-modified-since', 'range', 'if-range']) expect(req.headers[field]).toBeUndefined()
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-length': Buffer.byteLength(validator), etag: 'old', 'content-md5': 'old', 'accept-ranges': 'bytes' })
      res.end(validator)
    }, true)
    const result = await request(port, { path: '/plugins/??bundle/client.js&rev=old', headers: { ...safariHeaders, cookie: 'login=fixture', 'accept-encoding': 'gzip', 'if-none-match': 'old', 'if-modified-since': 'yesterday', range: 'bytes=0-10', 'if-range': 'old' } })
    expect(result.body).toContain('Function.prototype.toString.call(globalThis[name])')
    expect(Number(result.headers['content-length'])).toBe(Buffer.byteLength(result.body))
    expect(result.headers.etag).toBeUndefined()
    expect(result.headers['content-md5']).toBeUndefined()
    expect(result.headers['cache-control']).toBe('private, no-store')
    expect(result.headers['x-dsh-mobile-compat']).toContain('patched; count=1')
  })
  it('does not transform auth failures, compressed responses, or non-JS resources', async () => {
    for (const variant of [
      { status: 401, type: 'text/javascript', encoding: 'identity' },
      { status: 200, type: 'text/javascript', encoding: 'gzip' },
      { status: 200, type: 'text/html', encoding: 'identity' },
    ]) {
      const { port } = await setup((_req, res) => { res.writeHead(variant.status, { 'content-type': variant.type, 'content-encoding': variant.encoding }); res.end(validator) }, true)
      const result = await request(port, { path: '/plugins/', headers: safariHeaders })
      expect(result.code).toBe(variant.status)
      expect(result.body).toBe(validator)
      expect(result.headers['x-dsh-mobile-compat']).toBeUndefined()
    }
  })
  it('passes oversized JS through without truncation or a partial patch', async () => {
    const body = validator + ' '.repeat(MAX_COMPAT_BYTES)
    const { port } = await setup((_req, res) => { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(body) }, true)
    const result = await request(port, { path: '/plugins/', headers: safariHeaders })
    expect(result.body).toBe(body)
    expect(result.headers['x-dsh-mobile-compat']).toBeUndefined()
  })
  it('is opt-in and leaves non-WebKit bundles byte-identical', async () => {
    for (const [enabled, ua] of [[false, safariHeaders['user-agent']], [true, 'AppleWebKit/537.36 Chrome/140.0 Safari/537.36']] as const) {
      const { port } = await setup((_req, res) => { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(validator) }, enabled)
      expect((await request(port, { path: '/plugins/', headers: { ...headers, 'user-agent': ua } })).body).toBe(validator)
    }
  })
  it('preserves authority-bound login and adds Secure without changing the cookie value', async () => {
    const { port } = await setup((req, res) => {
      expect(req.headers.host).toBe(host)
      expect(req.url).toBe('/?token=fixture')
      res.writeHead(303, { 'set-cookie': ['login=fixture; HttpOnly; SameSite=Strict'], location: '/' }); res.end()
    })
    const result = await request(port, { path: '/?token=fixture' })
    expect(result.code).toBe(303)
    expect(result.headers['set-cookie']).toEqual(['login=fixture; HttpOnly; SameSite=Strict; Secure'])
    expect(result.headers['referrer-policy']).toBe('no-referrer')
  })
  it('rejects foreign Host/Origin and non-HTTPS ingress before forwarding', async () => {
    let calls = 0
    const { port } = await setup((_req, res) => { calls++; res.end() })
    for (const change of [{ host: 'foreign.example' }, { origin: 'https://foreign.example' }, { 'x-forwarded-proto': 'http' }]) {
      expect((await request(port, { headers: { ...headers, ...change } })).code).toBe(403)
    }
    expect(calls).toBe(0)
  })
  it('preserves upstream authentication rejections for protected HTTP', async () => {
    const { port } = await setup((_req, res) => { res.writeHead(401); res.end('Login required') })
    expect((await request(port, { path: '/api/mobile/handshake' })).code).toBe(401)
  })
  it('does not buffer a streaming response until completion', async () => {
    let finish: () => void = () => {}
    const { port } = await setup((_req, res) => { res.write('first'); finish = () => res.end('second') })
    const chunks: string[] = []
    await new Promise<void>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, headers }, response => {
        response.on('data', chunk => { chunks.push(chunk.toString()); if (chunks.length === 1) finish() })
        response.on('end', resolve)
      })
      req.on('error', reject)
    })
    expect(chunks).toEqual(['first', 'second'])
  })
  it('preserves a refused WebSocket upgrade', async () => {
    const { port, target } = await setup((_req, res) => res.end())
    target.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'))
    const result = await request(port, { path: '/api/remote.mux', headers: { ...headers, connection: 'Upgrade', upgrade: 'websocket' } })
    expect(result.code).toBe(401)
  })
})
