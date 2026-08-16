import { describe, expect, it } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { ShortcutBindingsPolicy } from '../src/client/policy.ts'
import {
  DEFAULT_PREFERENCES, type ShortcutPreference, type ShortcutSettings,
} from '../src/settings.ts'

const PREFERENCE: ShortcutPreference = { kind: 'key', modifiers: ['primary', 'shift'], key: 'e' }
const NONE: ShortcutPreference = { kind: 'none' }

describe('ShortcutBindingsPolicy', () => {
  it('defaults to the shipped preferences without a host scope', () => {
    const policy = new ShortcutBindingsPolicy()
    expect(policy.pause.getSnapshot()).toEqual(DEFAULT_PREFERENCES.pause)
    expect(policy.steerSend.getSnapshot()).toEqual(DEFAULT_PREFERENCES.steerSend)
    expect(policy.capturing.getSnapshot()).toBeNull()
  })

  it('publishes a rebind live before writing through the host scope', () => {
    const host = stubSettingsScope<ShortcutSettings>()
    host.publish({
      status: 'ready', revision: 1, writable: true,
      value: { pause: DEFAULT_PREFERENCES.pause, steerSend: DEFAULT_PREFERENCES.steerSend },
    })
    const policy = new ShortcutBindingsPolicy(host.scope)
    const changed: string[] = []
    policy.pause.subscribe(() => { changed.push(`pause=${JSON.stringify(policy.pause.getSnapshot())}`) })
    policy.setPreference('pause', PREFERENCE)
    expect(changed).toEqual([`pause=${JSON.stringify(PREFERENCE)}`])
    expect(host.set).toHaveBeenCalledWith('pause', PREFERENCE)
    // Same-value writes are no-ops (no publish, no host write).
    policy.setPreference('pause', PREFERENCE)
    expect(changed).toHaveLength(1)
    expect(host.set).toHaveBeenCalledTimes(1)
    // Unbinding writes the explicit none marker.
    policy.setPreference('steerSend', NONE)
    expect(host.set).toHaveBeenCalledWith('steerSend', NONE)
  })

  it('resets an action to its shipped default', () => {
    const host = stubSettingsScope<ShortcutSettings>()
    host.publish({
      status: 'ready', revision: 1, writable: true,
      value: { pause: PREFERENCE, steerSend: DEFAULT_PREFERENCES.steerSend },
    })
    const policy = new ShortcutBindingsPolicy(host.scope)
    policy.reset('pause')
    expect(policy.pause.getSnapshot()).toEqual(DEFAULT_PREFERENCES.pause)
    expect(host.set).toHaveBeenCalledWith('pause', DEFAULT_PREFERENCES.pause)
  })

  it('adopts Host-accepted preferences without writing them back', () => {
    const host = stubSettingsScope<ShortcutSettings>()
    const policy = new ShortcutBindingsPolicy(host.scope)
    host.publish({ value: { pause: PREFERENCE, steerSend: NONE }, revision: 1 })
    expect(policy.pause.getSnapshot()).toEqual(PREFERENCE)
    expect(policy.steerSend.getSnapshot()).toEqual(NONE)
    expect(host.set).not.toHaveBeenCalled()
    // A loading scope leaves the defaults untouched.
    const loading = stubSettingsScope<ShortcutSettings>()
    const pending = new ShortcutBindingsPolicy(loading.scope)
    loading.publish({ status: 'ready', value: undefined })
    expect(pending.pause.getSnapshot()).toEqual(DEFAULT_PREFERENCES.pause)
  })
})
