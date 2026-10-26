/** The auth-status bus is page-global: two bundled copies of the module share it. */
import { describe, expect, it, vi } from 'vitest'

describe('auth-status bus', () => {
  it('a status published through one copy of the module reads through another (each provider bundle inlines its own)', async () => {
    const core = await import('../src/client/auth-status.ts')
    vi.resetModules()
    const provider = await import('../src/client/auth-status.ts')
    expect(provider).not.toBe(core)
    core.resetAuthStatuses()
    core.publishAuthStatus('kimi', 'authenticated')
    expect(provider.readAuthStatus('kimi')).toBe('authenticated')
    core.resetAuthStatuses()
  })
})
