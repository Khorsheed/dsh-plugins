import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  apply, UI_SHORTCUTS_NAMESPACE,
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
const MOUSE: ShortcutPreference = { kind: 'mouse', modifiers: ['primary'], button: 2 }
const NONE: ShortcutPreference = { kind: 'none' }

describe('ui-shortcuts host', () => {
  it('registers, validates, and disposes the durable shortcut preferences', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = UI_SHORTCUTS_NAMESPACE
    expect(ctx.settings.get(ns)).toEqual({})
    // Both gesture kinds persist through the same dict.
    await ctx.settings.update(ns, { pause: PREFERENCE, toggleSidebar: MOUSE, steerSend: NONE })
    // The dict schema persists exactly the written entries; unwritten action
    // ids fall back to their registered defaults on the browser side.
    expect(ctx.settings.get(ns)).toEqual({ pause: PREFERENCE, toggleSidebar: MOUSE, steerSend: NONE })
    await expect(ctx.settings.update(ns, { pause: { kind: 'key', modifiers: ['bogus'], key: 'x' } })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { pause: { kind: 'bogus' } })).rejects.toThrow()
    // The primary button and the browser-reserved back/forward buttons are not
    // part of the binding vocabulary.
    await expect(ctx.settings.update(ns, { pause: { kind: 'mouse', modifiers: [], button: 0 } })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { pause: { kind: 'mouse', modifiers: [], button: 3 } })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { pause: { kind: 'mouse', modifiers: ['bogus'], button: 1 } })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
