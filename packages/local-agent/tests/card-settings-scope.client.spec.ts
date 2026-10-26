/** The cards' settings scope: row form values with the store's overrides on top; writes go to the store. */
import { describe, expect, it, vi } from 'vitest'
import { bindCardSettingsScope } from '../src/client/settings-scope.ts'

describe('bindCardSettingsScope', () => {
  it('reads the row form under the stored overrides and writes only to the store', async () => {
    let stored: Record<string, unknown> = { live: false }
    const gateway = {
      cardSettings: vi.fn(async () => ({ ok: true, value: stored })),
      setCardSettings: vi.fn(async (_name: string, patch: Record<string, unknown>) => {
        stored = { ...stored }
        for (const [key, value] of Object.entries(patch)) {
          if (value === null) delete stored[key]
          else stored[key] = value
        }
        return { ok: true, value: stored }
      }),
    }
    const rowSnapshot = { status: 'ready', value: { live: true, model: 'row' }, base: undefined, user: undefined, revision: 1, writable: false, mode: 'host' }
    const form = { getSnapshot: () => rowSnapshot, subscribe: () => () => {}, set: vi.fn(async () => false), unset: vi.fn(async () => false) }
    const ctx = {
      get: (name: string) => name === 'remote.localAgentGateway' ? gateway : undefined,
      inject: (deps: string[], callback: (ctx: unknown) => void) => {
        if (deps[0] === 'configForms') callback({ get: () => ({ get: () => form }) })
      },
    }
    const scope = bindCardSettingsScope<{ live: boolean; model?: string }>(ctx as never, 'dsh', 'local-agent-dsh')
    const seen = vi.fn()
    scope.subscribe(seen)
    await vi.waitFor(() => expect(scope.getSnapshot().value).toEqual({ live: false, model: 'row' }))
    // Stable identity between reads (useSyncExternalStore).
    expect(scope.getSnapshot()).toBe(scope.getSnapshot())
    expect(scope.getSnapshot().writable).toBe(true)

    expect(await scope.set('live', true)).toBe(true)
    expect(gateway.setCardSettings).toHaveBeenCalledWith('dsh', { live: true })
    expect(form.set).not.toHaveBeenCalled()
    expect(scope.getSnapshot().value).toEqual({ live: true, model: 'row' })

    expect(await scope.unset('live')).toBe(true)
    expect(gateway.setCardSettings).toHaveBeenLastCalledWith('dsh', { live: null })
    expect(scope.getSnapshot().value).toEqual({ live: true, model: 'row' })
    expect(seen).toHaveBeenCalled()
  })
})
