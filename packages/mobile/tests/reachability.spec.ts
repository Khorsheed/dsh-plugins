import { expect, it, vi } from 'vitest'
import { publicOriginReachable } from '../src/reachability.ts'
it('accepts protected roots, rejects dead tunnels and redirects, and sends no credential', async () => {
  for (const status of [200, 401, 403, 404, 302, 502, 530]) {
    const request = vi.fn(async () => new Response('', { status }))
    expect(await publicOriginReachable('https://phone.example.test', request)).toBe(status === 200 || status === 401)
    expect(request).toHaveBeenCalledWith('https://phone.example.test/', expect.objectContaining({ redirect: 'manual', method: 'GET' }))
    expect(JSON.stringify(request.mock.calls)).not.toContain('token=')
  }
  expect(await publicOriginReachable('https://phone.example.test', vi.fn().mockRejectedValue(new Error('DNS')))).toBe(false)
})
