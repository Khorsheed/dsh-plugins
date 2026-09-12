import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
// Source-plane integration with the real official registry; no Host source is changed.
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection/src/rpc-host'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth'
import * as mobile from '../src/index.ts'
import { DIRECTORY_PATH, HANDSHAKE_PATH } from '../src/protocol.ts'

describe('mobile plugin on the official Connection registry', () => {
  it('unloads only its route and can reinstall without a duplicate registration', async () => {
    const ctx = new Context()
    const connectionFiber = ctx.plugin(c => { new HostConnectionService(c, [], {} as BrowserAuth) })
    await connectionFiber.await()
    const connection = ctx.get('connection') as HostConnectionService
    const carrier = connection.createSharedFetchHandler('/api')
    connection.fetch.register({ path: '/api/other', methods: ['GET'], requestBody: 'buffered', fetch: async () => new Response('other') })
    const fiber = ctx.plugin(mobile)
    await fiber.await()
    await new Promise(resolve => setTimeout(resolve, 0))
    const answer = await carrier.fetch(new Request(`http://localhost${HANDSHAKE_PATH}`))
    expect(answer.status).toBe(200)
    expect(answer.headers.get('cache-control')).toBe('no-store')
    expect(await answer.json()).toMatchObject({ bridgeVersion: 1, devicePairing: false, pushNotifications: false })
    const invalid = await carrier.fetch(new Request(`http://localhost${DIRECTORY_PATH}?path=relative`))
    expect(invalid.status).toBe(400)
    await fiber.dispose()
    expect((await carrier.fetch(new Request(`http://localhost${DIRECTORY_PATH}`))).status).toBe(404)
    expect((await carrier.fetch(new Request(`http://localhost${HANDSHAKE_PATH}`))).status).toBe(404)
    expect(await (await carrier.fetch(new Request('http://localhost/api/other'))).text()).toBe('other')
    const again = ctx.plugin(mobile)
    await again.await()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect((await carrier.fetch(new Request(`http://localhost${HANDSHAKE_PATH}`))).status).toBe(200)
    await again.dispose()
    await connectionFiber.dispose()
  })
  it('does not require a web carrier or any community plugin to load', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(mobile)
    await fiber.await()
    await fiber.dispose()
  })
})
