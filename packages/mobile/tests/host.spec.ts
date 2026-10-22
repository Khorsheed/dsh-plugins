import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
// Source-plane integration with the real official registry; no Host source is changed.
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection/src/rpc-host'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth'
import * as mobile from '../src/index.ts'
import { CONNECT_PATH, DIRECTORY_PATH, HANDSHAKE_PATH, TUNNEL_PATH } from '../src/protocol.ts'

describe('mobile plugin on the official Connection registry', () => {
  it('unloads only its route and can reinstall without a duplicate registration', async () => {
    const ctx = new Context()
    const connectionFiber = ctx.plugin(c => { new HostConnectionService(c, [], {} as BrowserAuth) })
    await connectionFiber.await()
    const connection = ctx.get('connection') as HostConnectionService
    const carrier = connection.createSharedFetchHandler('/api')
    // Host 0.2.1 (Remote RBAC): ConnectionFetchHandler.fetch requires the
    // dispatch peer — an owner principal, as the web server's authenticated
    // local transport presents.
    const peer = connection.createPeer({ principal: { kind: 'owner' } })
    connection.fetch.register({ path: '/api/other', methods: ['GET'], requestBody: 'buffered', fetch: async () => new Response('other') })
    const fiber = ctx.plugin(mobile)
    await fiber.await()
    await new Promise(resolve => setTimeout(resolve, 0))
    const answer = await carrier.fetch(new Request(`http://localhost${HANDSHAKE_PATH}`), peer)
    expect(answer.status).toBe(200)
    expect(answer.headers.get('cache-control')).toBe('no-store')
    expect(await answer.json()).toMatchObject({ bridgeVersion: 1, devicePairing: false, pushNotifications: false })
    expect((await carrier.fetch(new Request(`http://localhost${CONNECT_PATH}`), peer)).status).toBe(200)
    const invalid = await carrier.fetch(new Request(`http://localhost${DIRECTORY_PATH}?path=relative`), peer)
    expect(invalid.status).toBe(400)
    await fiber.dispose()
    expect((await carrier.fetch(new Request(`http://localhost${DIRECTORY_PATH}`), peer)).status).toBe(404)
    expect((await carrier.fetch(new Request(`http://localhost${HANDSHAKE_PATH}`), peer)).status).toBe(404)
    expect((await carrier.fetch(new Request(`http://localhost${CONNECT_PATH}`), peer)).status).toBe(404)
    expect(await (await carrier.fetch(new Request('http://localhost/api/other'), peer)).text()).toBe('other')
    const again = ctx.plugin(mobile)
    await again.await()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect((await carrier.fetch(new Request(`http://localhost${HANDSHAKE_PATH}`), peer)).status).toBe(200)
    await again.dispose()
    await connectionFiber.dispose()
  })
  it('does not require a web carrier or any community plugin to load', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(mobile)
    await fiber.await()
    await fiber.dispose()
  })
  it('exposes the tunnel endpoint behind the same registry, guards its actions and drops it on unload', async () => {
    const ctx = new Context()
    const connectionFiber = ctx.plugin(c => { new HostConnectionService(c, [], {} as BrowserAuth) })
    await connectionFiber.await()
    const connection = ctx.get('connection') as HostConnectionService
    const carrier = connection.createSharedFetchHandler('/api')
    const peer = connection.createPeer({ principal: { kind: 'owner' } })
    const fiber = ctx.plugin(mobile)
    await fiber.await()
    await new Promise(resolve => setTimeout(resolve, 0))
    // Bare context: no profile/configEditor/webServer — the supervisor degrades.
    const status = await carrier.fetch(new Request(`http://localhost${TUNNEL_PATH}`), peer)
    expect(status.status).toBe(200)
    expect(await status.json()).toMatchObject({ state: 'unsupported', reason: 'no-profile' })
    const cross = await carrier.fetch(new Request(`http://localhost${TUNNEL_PATH}`, { method: 'POST',
      headers: { host: 'localhost', origin: 'https://other.example.test', 'content-type': 'application/json' }, body: '{"action":"enable"}' }), peer)
    expect(cross.status).toBe(403)
    const enable = await carrier.fetch(new Request(`http://localhost${TUNNEL_PATH}`, { method: 'POST',
      headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json' }, body: '{"action":"enable"}' }), peer)
    expect(enable.status).toBe(200)
    expect(await enable.json()).toMatchObject({ state: 'unsupported' })
    await fiber.dispose()
    expect((await carrier.fetch(new Request(`http://localhost${TUNNEL_PATH}`), peer)).status).toBe(404)
    await connectionFiber.dispose()
  })
})
