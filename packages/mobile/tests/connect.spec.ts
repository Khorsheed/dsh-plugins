import { describe, expect, it, vi } from 'vitest'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { connectInfo, connectResponse } from '../src/connect.ts'

const origin = 'https://phone.example.test'
function fixture(rejection: number | undefined = 401) {
  const issue = vi.fn((base: string) => `${base}/?token=official-launch`)
  const check = vi.fn(() => rejection)
  const connection = { authenticatedUrl: issue, requestRejection: check } as unknown as HostConnectionHandle
  return { issue, check, connection, response: connectResponse(connection, origin) }
}
const post = (originHeader = 'http://localhost:3080', contentType = 'application/json') => new Request('http://dsh.internal/api/mobile/connect', { method: 'POST', headers: { host: 'localhost:3080', origin: originHeader, 'content-type': contentType }, body: '{}' })

describe('official mobile login link', () => {
  it('discloses only deployment metadata on GET; only an explicit POST requests the official launch URL', async () => {
    const f = fixture()
    const info = await f.response(new Request('http://localhost:3080/api/mobile/connect'))
    expect(await info.json()).toEqual({ state: 'ready', origin })
    expect(f.issue).not.toHaveBeenCalled()
    const answer = await f.response(post())
    expect(await answer.json()).toEqual({ origin, loginUrl: `${origin}/?token=official-launch` })
    expect(f.issue).toHaveBeenCalledExactlyOnceWith(origin)
    expect(answer.headers.get('cache-control')).toBe('no-store')
    expect(answer.headers.get('referrer-policy')).toBe('no-referrer')
    expect(f.check).toHaveBeenCalledWith({ headers: { host: 'phone.example.test', origin } })
  })
  it.each(['http://phone.example.test', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://user:password@example.test', 'https://example.test/path', 'https://example.test/?token=secret', 'https://example.test/#fragment', 'bad'])('refuses an unsafe configured destination: %s', configured => {
    const f = fixture()
    expect(connectInfo(f.connection, configured)).toEqual({ state: 'invalid-origin', origin: null })
    expect(f.issue).not.toHaveBeenCalled()
  })
  it('degrades for missing configuration, unsupported carriers and untrusted domains', async () => {
    expect(connectInfo(fixture().connection)).toEqual({ state: 'not-configured', origin: null })
    expect(connectInfo({} as HostConnectionHandle, origin).state).toBe('unsupported')
    const f = fixture(403)
    expect((await f.response(post())).status).toBe(409)
    expect(f.issue).not.toHaveBeenCalled()
  })
  it('rejects cross-origin requests, opaque origins and form posts without minting a URL', async () => {
    const f = fixture()
    for (const req of [post('https://other.example.test'), post('null'), post('', 'application/json'), post('http://localhost:3080', 'text/plain')]) {
      expect((await f.response(req)).status).toBe(403)
    }
    expect(f.issue).not.toHaveBeenCalled()
  })
  it('does not let request payload override the deployment origin, and never echoes provider errors', async () => {
    const f = fixture()
    const request = new Request('http://dsh.internal/api/mobile/connect', { method: 'POST', headers: { host: 'localhost:3080', origin: 'http://localhost:3080', 'content-type': 'application/json' }, body: JSON.stringify({ origin: 'https://attacker.example.test' }) })
    expect((await f.response(request)).status).toBe(200)
    expect(f.issue).toHaveBeenCalledWith(origin)
    f.issue.mockImplementation(() => { throw new Error('secret-login-token') })
    const error = await f.response(post())
    expect(error.status).toBe(503); expect(await error.text()).not.toContain('secret-login-token')
    f.issue.mockReturnValue('https://other.example.test/?token=leaked')
    expect((await f.response(post())).status).toBe(503)
  })
  it('accepts the preserved HTTPS authority behind the official internal Request URL', async () => {
    const f = fixture()
    const req = new Request('http://dsh.internal/api/mobile/connect', { method: 'POST', headers: { host: 'phone.example.test', origin, 'content-type': 'application/json' }, body: '{}' })
    expect((await f.response(req)).status).toBe(200)
    expect(f.issue).toHaveBeenCalledExactlyOnceWith(origin)
  })
})
