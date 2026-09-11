import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
// Optional standalone deployment example, intentionally separate from Cordis.
import { createIngress } from '../examples/https-ingress.mjs'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
const host = 'preview.example'
const headers = { host, 'x-forwarded-proto': 'https', origin: `https://${host}` }
async function listen(server: http.Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as { port: number }).port
}
async function setup(handler: http.RequestListener) {
  const target = http.createServer(handler)
  const targetPort = await listen(target)
  cleanup.push(() => new Promise<void>(resolve => { target.closeAllConnections(); target.close(() => resolve()) }))
  const ingress = createIngress({ origin: `https://${host}`, targetPort })
  const port = await listen(ingress.server)
  cleanup.push(ingress.close)
  return { port, target }
}
function request(port: number, extra: http.RequestOptions = {}) {
  return new Promise<{ code: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/', headers, ...extra }, response => {
      let body = ''
      response.on('data', chunk => { body += chunk })
      response.on('end', () => resolve({ code: response.statusCode!, headers: response.headers, body }))
    })
    req.on('error', reject); req.end()
  })
}
describe('optional HTTPS tunnel ingress', () => {
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
