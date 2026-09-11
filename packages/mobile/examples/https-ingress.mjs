/** Optional loopback ingress behind an HTTPS tunnel. Host authentication stays upstream. */
import http from 'node:http'
import { pathToFileURL } from 'node:url'

export function createIngress({ origin, targetPort }) {
  const url = new URL(origin)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Expected a clean HTTPS origin')
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) throw new Error('Invalid upstream port')
  const allowed = req => req.headers.host?.toLowerCase() === url.host.toLowerCase()
    && (!req.headers.origin || req.headers.origin === url.origin)
    && req.headers['x-forwarded-proto'] === 'https'
  const forward = req => http.request({
    hostname: '127.0.0.1', port: targetPort, method: req.method,
    path: req.url, headers: req.headers,
  })
  const server = http.createServer((req, res) => {
    if (!allowed(req)) { res.writeHead(403); res.end('Forbidden'); return }
    const upstream = forward(req)
    upstream.on('response', response => {
      const headers = { ...response.headers, 'referrer-policy': 'no-referrer', 'cache-control': 'private, no-store' }
      if (headers['set-cookie']) headers['set-cookie'] = headers['set-cookie'].map(cookie => /;\s*Secure(?:;|$)/i.test(cookie) ? cookie : `${cookie}; Secure`)
      res.writeHead(response.statusCode ?? 502, headers)
      response.on('error', () => { res.destroy() })
      response.pipe(res)
    })
    upstream.on('error', () => {
      if (!res.headersSent) { res.writeHead(502); res.end('Host unavailable') } else res.destroy()
    })
    req.on('aborted', () => { upstream.destroy() })
    res.on('close', () => { upstream.destroy() })
    req.pipe(upstream)
  })
  server.on('upgrade', (req, socket, head) => {
    if (!allowed(req)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    const upstream = forward(req)
    let remote
    socket.on('error', () => { upstream.destroy(); remote?.destroy() })
    socket.on('close', () => { upstream.destroy(); remote?.destroy() })
    upstream.on('error', () => { socket.destroy() })
    // Preserve an upstream auth rejection; never turn a 401 into an upgrade.
    upstream.on('response', response => {
      socket.end(`HTTP/1.1 ${response.statusCode ?? 502} Rejected\r\nConnection: close\r\n\r\n`)
      response.resume()
    })
    upstream.on('upgrade', (response, peer, first) => {
      remote = peer
      const lines = response.rawHeaders.reduce((out, value, index, all) => index % 2 ? out : [...out, `${value}: ${all[index + 1]}`], [])
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join('\r\n')}\r\n\r\n`)
      peer.on('error', () => { socket.destroy() })
      peer.on('close', () => { socket.destroy() })
      if (first.length) socket.write(first)
      if (head.length) peer.write(head)
      socket.pipe(peer).pipe(socket)
    })
    upstream.end()
  })
  const sockets = new Set()
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  return { server, close: async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.INGRESS_PORT ?? 3182)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid ingress port')
  const ingress = createIngress({ origin: process.env.PUBLIC_ORIGIN, targetPort: Number(process.env.HOST_PORT ?? 3181) })
  ingress.server.listen(port, '127.0.0.1', () => { console.log(`HTTPS tunnel ingress ready on loopback port ${port}`) })
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void ingress.close().then(() => process.exit(0)) })
}
