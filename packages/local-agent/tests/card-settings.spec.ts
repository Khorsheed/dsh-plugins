/** The settings cards' own store and the faces layered over it. */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { readCardSettings, writeCardSettings } from '../src/card-settings.ts'
import { settingsFace } from '../src/settings-face.ts'

describe('card settings store', () => {
  it('writes overrides, removes one with null, and reads a missing file as empty', () => {
    const home = mkdtempSync(join(tmpdir(), 'card-settings-'))
    expect(readCardSettings(home)).toEqual({})
    expect(writeCardSettings(home, { live: false, model: 'm', recentModels: ['a'] })).toEqual({ live: false, model: 'm', recentModels: ['a'] })
    expect(writeCardSettings(home, { model: null })).toEqual({ live: false, recentModels: ['a'] })
    expect(readCardSettings(home)).toEqual({ live: false, recentModels: ['a'] })
    expect(() => writeCardSettings(home, { bad: { nested: 1 } as never })).toThrow(/must be a string/)
  })
})

describe('settings face over the card store', () => {
  it('stored overrides win over the row config, and a store write notifies the watcher', () => {
    let stored: Record<string, unknown> = {}
    const listeners = new Set<() => void>()
    const ctx = {
      get: (name: string) => name === 'localAgent'
        ? { cardSettings: () => stored, onCardSettings: (_name: string, listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } }
        : undefined,
      on: () => () => {},
    }
    const face = settingsFace<{ live: boolean; model?: string }>(ctx as never, {
      namespace: 'local-agent-x', legacySchema: undefined, legacyBase: {}, read: () => ({ live: true, model: 'row' }), harness: 'x',
    })
    expect(face.get()).toEqual({ live: true, model: 'row' })
    const seen = vi.fn()
    face.watch(seen)
    stored = { live: false }
    for (const listener of listeners) listener()
    expect(seen).toHaveBeenCalledWith({ live: false, model: 'row' })
    expect(face.get()).toEqual({ live: false, model: 'row' })
  })
})
