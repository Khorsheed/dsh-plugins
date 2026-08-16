/** Package invariant companion: registration only (the install is empty by design). */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../src/invariant.ts'

describe('message-tools invariant companion', () => {
  it('declares the invariants inject and registers the package companion', async () => {
    expect(inject).toEqual(['invariants'])
    expect(name).toBe('client-message-tools-invariant')
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    const ctx = { invariants: { register } } as unknown as Context
    const disposer = await apply(ctx)
    expect(register).toHaveBeenCalledWith('@khorsheed/dsh-client-message-tools', expect.any(Function))
    disposer()
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
