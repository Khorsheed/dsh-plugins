import { describe, expect, it, vi } from 'vitest'
import { pollActiveDelegations } from '../src/client/active-delegations.ts'

/** Reader stub returning the gateway the test wires up. */
function readerWith(gateway: unknown): { get: () => unknown } {
  return { get: () => gateway }
}

describe('pollActiveDelegations', () => {
  it('resolves an empty list when the local-agent channel is absent', async () => {
    // The family is not installed: no `remote.localAgentGateway` namespace is
    // mounted, so the reader yields nothing and the dock keeps single-source
    // behavior.
    await expect(pollActiveDelegations({ get: () => undefined })).resolves.toEqual([])
  })

  it('resolves the in-flight child session ids on an ok result', async () => {
    const gateway = { activeDelegations: vi.fn(async () => ({ ok: true, value: ['child-1', 'child-2'] })) }
    await expect(pollActiveDelegations(readerWith(gateway))).resolves.toEqual(['child-1', 'child-2'])
    expect(gateway.activeDelegations).toHaveBeenCalledTimes(1)
  })

  it('resolves an empty list when the result is not ok', async () => {
    const gateway = {
      activeDelegations: vi.fn(async () => ({ ok: false, error: { code: 'internal', message: 'boom', details: {} } })),
    }
    await expect(pollActiveDelegations(readerWith(gateway))).resolves.toEqual([])
  })

  it('resolves an empty list when the call throws', async () => {
    const gateway = { activeDelegations: vi.fn(async () => { throw new Error('carrier offline') }) }
    await expect(pollActiveDelegations(readerWith(gateway))).resolves.toEqual([])
  })

  it('resolves an empty list for a missing value on an ok result', async () => {
    const gateway = { activeDelegations: vi.fn(async () => ({ ok: true })) }
    await expect(pollActiveDelegations(readerWith(gateway))).resolves.toEqual([])
  })
})
