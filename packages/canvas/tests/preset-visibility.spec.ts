/**
 * The preset-composition self-hide (M2): the criterion matrix (everything
 * unreadable fails OPEN — a preset-less profile like 3080's web never loses
 * the space; only a preset whose group names every row BUT this package's
 * hides it) and the registration toggle's register/dispose lifecycle.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, vi } from 'vitest'
import {
  CANVAS_ROW_MODULE, CanvasPresetVisibility, RegistrationToggle,
  type CanvasPluginInventorySnapshot,
} from '../src/client/preset-visibility.ts'

const SESSION = 's1' as SessionId

interface Bench {
  readonly visibility: CanvasPresetVisibility
  readonly answer: (snapshot: CanvasPluginInventorySnapshot) => void
  readonly switchSession: (id: string | undefined, preset?: string) => void
}

/** One visibility controller over a fake context (sessions + inventory probe). */
function harness(options: {
  inventory?: CanvasPluginInventorySnapshot | 'absent' | 'fails'
  preset?: string
} = {}): Bench {
  const listeners = new Set<() => void>()
  const state: { current: string | undefined; byId: Record<string, unknown> } = {
    current: SESSION,
    byId: options.preset === undefined ? { [SESSION]: {} } : { [SESSION]: { projectionValues: { agentPreset: options.preset } } },
  }
  const list = {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  let resolveInventory: ((snapshot: CanvasPluginInventorySnapshot) => void) | undefined
  const pluginInventory = options.inventory === 'absent'
    ? undefined
    : {
      list: () => options.inventory === 'fails'
        ? Promise.resolve({ ok: false as const })
        : new Promise<{ ok: true; value: CanvasPluginInventorySnapshot }>(resolve => {
          resolveInventory = value => {
            if (options.inventory !== undefined && options.inventory !== 'fails') {
              resolve({ ok: true, value: options.inventory ?? value })
            } else {
              resolve({ ok: true, value })
            }
          }
        }),
    }
  const ctx = {
    get: (key: string) => key === 'remote.pluginInventory' ? pluginInventory : undefined,
    effect: (fn: () => () => void) => fn(),
    sessions: { list },
  } as unknown as Context
  const visibility = new CanvasPresetVisibility(ctx)
  return {
    visibility,
    answer: snapshot => { resolveInventory?.(snapshot) },
    switchSession: (id, preset) => {
      state.current = id as SessionId | undefined
      if (id !== undefined) {
        state.byId[id] = preset === undefined ? {} : { projectionValues: { agentPreset: preset } }
      }
      for (const listener of listeners) listener()
    },
  }
}

/** A preset group with rows as given. */
function group(id: string, rows: readonly string[], broken?: string): NonNullable<CanvasPluginInventorySnapshot['agentPresets']>[number] {
  return { id, rows: rows.map(moduleName => ({ moduleName })), ...(broken === undefined ? {} : { broken }) }
}

describe('CanvasPresetVisibility', () => {
  it('names this package\'s own row as the criterion', () => {
    expect(CANVAS_ROW_MODULE).toBe('@khorsheed/dsh-canvas')
  })

  it('fails OPEN on every unreadable path', () => {
    // No pluginInventory namespace at all.
    expect(harness({ inventory: 'absent', preset: 'writing' }).visibility.show(SESSION)).toBe(true)
    // The inventory RPC fails.
    expect(harness({ inventory: 'fails', preset: 'writing' }).visibility.show(SESSION)).toBe(true)
    // The session carries no preset (3080's web profile: always visible).
    expect(harness({ inventory: { agentPresets: [group('writing', ['@khorsheed/dsh-eval'])] } }).visibility.show(SESSION)).toBe(true)
    // No session context at all (registration-shape probes keep their entries).
    expect(harness({ inventory: 'absent' }).visibility.show(undefined)).toBe(true)
  })

  it('fails OPEN while the inventory answer is still pending', () => {
    const { visibility } = harness({ preset: 'writing' })
    expect(visibility.show(SESSION)).toBe(true)
  })

  it('fails OPEN on a missing or broken preset group', () => {
    const { visibility, answer } = harness({ preset: 'writing' })
    answer({ agentPresets: [group('other', ['@khorsheed/dsh-eval'])] })
    expect(visibility.show(SESSION)).toBe(true)
    const broken = harness({ preset: 'writing' })
    broken.answer({ agentPresets: [group('writing', ['@khorsheed/dsh-eval'], 'could not load')] })
    expect(broken.visibility.show(SESSION)).toBe(true)
  })

  it('shows when the preset names the canvas row, hides only when it names everything BUT it', async () => {
    const shown = harness({ preset: 'writing' })
    shown.answer({ agentPresets: [group('writing', ['@khorsheed/dsh-eval', CANVAS_ROW_MODULE])] })
    await Promise.resolve()
    expect(shown.visibility.show(SESSION)).toBe(true)

    const hidden = harness({ preset: 'coding' })
    hidden.answer({ agentPresets: [group('coding', ['@khorsheed/dsh-eval', '@khorsheed/dsh-datasets'])] })
    await Promise.resolve()
    expect(hidden.visibility.show(SESSION)).toBe(false)
  })

  it('re-decides on a session switch and notifies subscribers', async () => {
    const { visibility, answer, switchSession } = harness({ preset: 'writing' })
    answer({
      agentPresets: [
        group('writing', [CANVAS_ROW_MODULE]),
        group('coding', ['@khorsheed/dsh-eval']),
      ],
    })
    // The composition lands on the microtask queue (the probe's .then).
    await Promise.resolve()
    const seen: boolean[] = []
    visibility.subscribe(() => { seen.push(visibility.show('s2' as SessionId)) })
    switchSession('s2', 'coding')
    expect(visibility.show('s2' as SessionId)).toBe(false)
    expect(seen).toEqual([false])
    switchSession('s3', 'writing')
    expect(visibility.show('s3' as SessionId)).toBe(true)
  })
})

describe('RegistrationToggle', () => {
  it('registers once while shown, disposes on hide, re-registers on show', () => {
    let shown = true
    const registrations: string[] = []
    const disposals: string[] = []
    const hidden: string[] = []
    const toggle = new RegistrationToggle(
      () => {
        registrations.push('register')
        return () => { disposals.push('dispose') }
      },
      () => shown,
      () => { hidden.push('hide') },
    )
    // Not ready yet: nothing registers through the arm's absence.
    toggle.sync()
    expect(registrations).toEqual([])
    toggle.setReady(true)
    expect(registrations).toEqual(['register'])
    toggle.sync()
    expect(registrations).toEqual(['register'])
    shown = false
    toggle.sync()
    expect(disposals).toEqual(['dispose'])
    expect(hidden).toEqual(['hide'])
    shown = true
    toggle.sync()
    expect(registrations).toEqual(['register', 'register'])
    // The arm's teardown disposes the live registration.
    toggle.setReady(false)
    expect(disposals).toEqual(['dispose', 'dispose'])
  })

  it('never registers while hidden, and the arm flip alone changes nothing', () => {
    let shown = false
    const register = vi.fn(() => () => undefined)
    const toggle = new RegistrationToggle(register, () => shown)
    toggle.setReady(true)
    expect(register).not.toHaveBeenCalled()
    shown = true
    toggle.sync()
    expect(register).toHaveBeenCalledTimes(1)
  })
})
