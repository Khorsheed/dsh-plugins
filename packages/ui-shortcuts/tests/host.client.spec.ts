import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  apply, UI_SHORTCUTS_NAMESPACE,
} from '@khorsheed/dsh-ui-shortcuts'
import type { ShortcutPreference } from '@khorsheed/dsh-ui-shortcuts'

/**
 * In-memory fake of the 0.1.5 settings face: the explicit `register` face the
 * host half's legacy arm probes for, plus describe/get/update for the
 * assertions. The schema is invoked directly (schemastery schemas are
 * callable); a volatile-marked root resolves to a live reference, unwrapped
 * on read — the same plain projection the provider served on 0.1.5.
 */
class MemorySettings {
  private readonly sections = new Map<string, {
    schema: (value: unknown) => unknown
    section: Record<string, unknown>
  }>()

  register(ns: string, schema: unknown): {
    get(): unknown
    update(patch: Record<string, unknown>): Promise<void>
    watch(): () => void
  } {
    if (this.sections.has(ns)) throw new Error(`settings namespace "${ns}" is already registered`)
    this.sections.set(ns, { schema: schema as (value: unknown) => unknown, section: {} })
    return {
      get: () => this.get(ns),
      update: (patch) => this.update(ns, patch),
      watch: () => () => {},
    }
  }

  describe(): { ns: string }[] {
    return [...this.sections.keys()].map(ns => ({ ns }))
  }

  get(ns: string): unknown {
    const entry = this.sections.get(ns)
    if (entry === undefined) return undefined
    const resolved: unknown = entry.schema(entry.section)
    return resolved !== null && typeof resolved === 'object' && typeof (resolved as { get?: unknown }).get === 'function'
      ? (resolved as { get(): unknown }).get()
      : resolved
  }

  async update(ns: string, patch: Record<string, unknown>): Promise<void> {
    const entry = this.sections.get(ns)
    if (entry === undefined) throw new Error(`no settings namespace "${ns}"`)
    // Validation rejects the write exactly where the 0.1.5 provider did.
    entry.schema({ ...entry.section, ...patch })
    entry.section = { ...entry.section, ...patch }
  }

  remove(ns: string): void {
    this.sections.delete(ns)
  }
}

const PREFERENCE: ShortcutPreference = { kind: 'key', modifiers: ['alt'], key: 'p' }
const MOUSE: ShortcutPreference = { kind: 'mouse', modifiers: ['primary'], button: 2 }
const NONE: ShortcutPreference = { kind: 'none' }

describe('ui-shortcuts host', () => {
  it('registers, validates, and disposes the durable shortcut preferences', async () => {
    const ctx = new Context()
    const settings = new MemorySettings()
    ctx.provide('settings', settings as never)
    const ns = UI_SHORTCUTS_NAMESPACE
    const fiber = ctx.plugin({
      apply: (pluginCtx) => {
        apply(pluginCtx)
        // Test-side emulation of the 0.1.5 provider's own fiber-effect: the
        // real service removed the namespace when the registrant fiber
        // disposed; the fake has no fiber of its own, so the removal rides
        // the plugin's.
        pluginCtx.effect(() => () => { settings.remove(ns) })
      },
    })
    await fiber.await()
    expect(settings.get(ns)).toEqual({})
    // Both gesture kinds persist through the same dict.
    await settings.update(ns, { pause: PREFERENCE, toggleSidebar: MOUSE, steerSend: NONE })
    // The dict schema persists exactly the written entries; unwritten action
    // ids fall back to their registered defaults on the browser side.
    expect(settings.get(ns)).toEqual({ pause: PREFERENCE, toggleSidebar: MOUSE, steerSend: NONE })
    await expect(settings.update(ns, { pause: { kind: 'key', modifiers: ['bogus'], key: 'x' } })).rejects.toThrow()
    await expect(settings.update(ns, { pause: { kind: 'bogus' } })).rejects.toThrow()
    // The primary button and the browser-reserved back/forward buttons are not
    // part of the binding vocabulary.
    await expect(settings.update(ns, { pause: { kind: 'mouse', modifiers: [], button: 0 } })).rejects.toThrow()
    await expect(settings.update(ns, { pause: { kind: 'mouse', modifiers: [], button: 3 } })).rejects.toThrow()
    await expect(settings.update(ns, { pause: { kind: 'mouse', modifiers: ['bogus'], button: 1 } })).rejects.toThrow()
    await fiber.dispose()
    expect(settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
