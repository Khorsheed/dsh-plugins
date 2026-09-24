import { describe, expect, it, vi } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { ShortcutRegistryRuntime } from '../src/client/registry.ts'
import type { ShortcutActionContribution } from '../src/client/contract.ts'
import {
  DEFAULT_PREFERENCES, type ShortcutPreference, type ShortcutSettings,
} from '../src/settings.ts'

const PREFERENCE: ShortcutPreference = { kind: 'key', modifiers: ['primary', 'shift'], key: 'e' }
const NONE: ShortcutPreference = { kind: 'none' }

/** A minimal contribution fixture. */
function action(id: string, over: Partial<ShortcutActionContribution> = {}): ShortcutActionContribution {
  return {
    id,
    label: { ns: 'test', key: `${id}.label` },
    description: { ns: 'test', key: `${id}.desc` },
    defaultBinding: DEFAULT_PREFERENCES['pause']!,
    layering: 'global',
    run: vi.fn(),
    ...over,
  }
}

describe('ShortcutRegistryRuntime', () => {
  it('registers actions in order, starts them at their defaults, and the disposer removes them', () => {
    const registry = new ShortcutRegistryRuntime()
    const dispose = registry.registerAction(action('a'))
    registry.registerAction(action('b', { defaultBinding: PREFERENCE }))
    expect(registry.actions.getSnapshot().map(entry => entry.id)).toEqual(['a', 'b'])
    expect(registry.preferenceOf('a')).toEqual(DEFAULT_PREFERENCES.pause)
    expect(registry.preferenceOf('b')).toEqual(PREFERENCE)
    expect(registry.capturing.getSnapshot()).toBeNull()

    dispose()
    expect(registry.actions.getSnapshot().map(entry => entry.id)).toEqual(['b'])
    expect(registry.preferences.getSnapshot()).not.toHaveProperty('a')
  })

  it('rejects a duplicate action id loudly', () => {
    const registry = new ShortcutRegistryRuntime()
    registry.registerAction(action('a'))
    expect(() => registry.registerAction(action('a'))).toThrow(/already registered/)
  })

  it('publishes a rebind live before writing through the host scope', () => {
    const host = stubConfigForm<ShortcutSettings>()
    host.publish({ status: 'ready', revision: 1, writable: true, value: {} })
    const registry = new ShortcutRegistryRuntime(host.scope)
    registry.registerAction(action('pause'))
    const changed: string[] = []
    registry.preferences.subscribe(() => { changed.push(JSON.stringify(registry.preferenceOf('pause'))) })
    registry.setPreference('pause', PREFERENCE)
    expect(changed).toEqual([JSON.stringify(PREFERENCE)])
    expect(host.set).toHaveBeenCalledWith('pause', PREFERENCE)
    // Same-value writes are no-ops (no publish, no host write).
    registry.setPreference('pause', PREFERENCE)
    expect(changed).toHaveLength(1)
    expect(host.set).toHaveBeenCalledTimes(1)
    // Unbinding writes the explicit none marker.
    registry.setPreference('pause', NONE)
    expect(host.set).toHaveBeenCalledWith('pause', NONE)
  })

  it('resets an action to its shipped default', () => {
    const registry = new ShortcutRegistryRuntime()
    registry.registerAction(action('pause'))
    registry.setPreference('pause', PREFERENCE)
    registry.reset('pause')
    expect(registry.preferenceOf('pause')).toEqual(DEFAULT_PREFERENCES.pause)
  })

  it('adopts persisted preferences on registration and on host updates', () => {
    const host = stubConfigForm<ShortcutSettings>()
    host.publish({ status: 'ready', revision: 1, writable: true, value: { pause: PREFERENCE } })
    const registry = new ShortcutRegistryRuntime(host.scope)
    // A persisted value wins over the shipped default at registration time.
    registry.registerAction(action('pause'))
    expect(registry.preferenceOf('pause')).toEqual(PREFERENCE)
    // A later host update re-adopts; an unwritten action keeps its default.
    registry.registerAction(action('steerSend', { defaultBinding: DEFAULT_PREFERENCES['steerSend']! }))
    host.publish({ status: 'ready', revision: 2, writable: true, value: { pause: NONE } })
    expect(registry.preferenceOf('pause')).toEqual(NONE)
    expect(registry.preferenceOf('steerSend')).toEqual(DEFAULT_PREFERENCES.steerSend)
  })
})
