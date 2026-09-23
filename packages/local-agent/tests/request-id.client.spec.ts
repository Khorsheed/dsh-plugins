// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestId } from '../src/client/request-id.ts'

afterEach(() => vi.unstubAllGlobals())
describe('browser request identity', () => {
  it('works on a LAN HTTP origin without crypto.randomUUID', () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto)
    vi.stubGlobal('crypto', { getRandomValues })
    const first = requestId()
    expect(first).toMatch(/^[a-f0-9]{32}$/)
    expect(requestId()).not.toBe(first)
  })
})
