import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  apply, DEFAULT_PREFERENCES, UI_SHORTCUTS_NAMESPACE,
} from '@khorsheed/dsh-ui-shortcuts'
import type { ShortcutPreference } from '@khorsheed/dsh-ui-shortcuts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

const PREFERENCE: ShortcutPreference = { kind: 'key', modifiers: ['alt'], key: 'p' }
const NONE: ShortcutPreference = { kind: 'none' }

describe('ui-shortcuts host', () => {
  it('registers, validates, and disposes the durable shortcut preferences', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(UI_SHORTCUTS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({
      pause: DEFAULT_PREFERENCES.pause,
      steerSend: DEFAULT_PREFERENCES.steerSend,
      newSession: DEFAULT_PREFERENCES.newSession,
    })
    await ctx.settings.update(ns, { pause: PREFERENCE, steerSend: NONE })
    // The schema refills untouched actions with their shipped defaults.
    expect(ctx.settings.get(ns)).toEqual({ pause: PREFERENCE, steerSend: NONE, newSession: DEFAULT_PREFERENCES.newSession })
    await expect(ctx.settings.update(ns, { pause: { kind: 'key', modifiers: ['bogus'], key: 'x' } })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { pause: { kind: 'bogus' } })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
