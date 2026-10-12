// @vitest-environment jsdom
/**
 * The visibility criterion's spec: the context-lens surfaces register
 * exactly while the current session reaches this package's row — the
 * profile-root mount (an enabled `entries` row, the bundle patch's shape)
 * grants every session; the preset mount grants that preset's sessions. Every
 * unreadable path fails OPEN: no namespace, a pending/failed RPC, a session
 * with no preset, a missing or broken preset group, and the no-session home
 * state. The toggle registers/disposes with the criterion.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  InspectorTabVisibility, RegistrationToggle, REQUEST_INSPECTOR_ROW_MODULE,
  type InspectorPluginInventorySnapshot,
} from '../src/client/preset-visibility.ts'

const PRESET_MOUNTED: InspectorPluginInventorySnapshot = {
  agentPresets: [
    { id: 'dev', rows: [{ moduleName: REQUEST_INSPECTOR_ROW_MODULE }] },
    { id: 'standard', rows: [{ moduleName: '@deepseek-ai/dsh-tool-bash' }] },
  ],
}

const ROOT_MOUNTED: InspectorPluginInventorySnapshot = {
  entries: [{ moduleName: REQUEST_INSPECTOR_ROW_MODULE, enabled: true }],
  agentPresets: [{ id: 'standard', rows: [] }],
}

interface BenchOptions {
  rows?: Record<string, unknown>
  /** The inventory answer; undefined = a host with NO pluginInventory namespace. */
  composition?: InspectorPluginInventorySnapshot
  compositionFails?: boolean
}

function bench(over: BenchOptions = {}) {
  const list = createSnapshotStore({
    ids: Object.keys(over.rows ?? {}),
    byId: over.rows ?? {},
    phase: 'ready', subagentsByParent: {}, jobsBySession: {},
  })
  const ctx = new Context()
  ctx.provide('sessions', { list } as never)
  const pluginInventory = over.composition === undefined && over.compositionFails !== true
    ? undefined
    : {
      list: over.compositionFails === true
        ? vi.fn(async (): Promise<RemoteResult<InspectorPluginInventorySnapshot>> => ({ ok: false as const }))
        : vi.fn(async (): Promise<RemoteResult<InspectorPluginInventorySnapshot>> => ({
          ok: true as const,
          value: over.composition ?? {},
        })),
    }
  const visibility = new InspectorTabVisibility(ctx, pluginInventory)
  return { ctx, list, visibility }
}

/** Flush the constructor's inventory fetch. */
async function settled(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('InspectorTabVisibility.show', () => {
  it('shows for every session when the profile root mounts the row (the bundle patch shape)', async () => {
    const { visibility } = bench({
      rows: { s1: { projectionValues: { agentPreset: 'standard' } } },
      composition: ROOT_MOUNTED,
    })
    await settled()
    expect(visibility.show('s1' as SessionId)).toBe(true)
  })

  it('shows when the session preset names the row (preset mount)', async () => {
    const { visibility } = bench({
      rows: { s1: { projectionValues: { agentPreset: 'dev' } } },
      composition: PRESET_MOUNTED,
    })
    await settled()
    expect(visibility.show('s1' as SessionId)).toBe(true)
  })

  it('hides when the preset composition exists and names no row of this package', async () => {
    const { visibility } = bench({
      rows: { s1: { projectionValues: { agentPreset: 'standard' } } },
      composition: PRESET_MOUNTED,
    })
    await settled()
    expect(visibility.show('s1' as SessionId)).toBe(false)
  })

  it('reads the legacy top-level preset key too (the 0.1.1 host line)', async () => {
    const { visibility } = bench({
      rows: { s1: { agentPreset: 'dev' } },
      composition: PRESET_MOUNTED,
    })
    await settled()
    expect(visibility.show('s1' as SessionId)).toBe(true)
  })

  it('fails open on every unreadable path', async () => {
    // No namespace at all.
    const none = bench({ rows: { s1: { projectionValues: { agentPreset: 'standard' } } } })
    await settled()
    expect(none.visibility.show('s1' as SessionId)).toBe(true)
    // A failed RPC.
    const failed = bench({
      rows: { s1: { projectionValues: { agentPreset: 'standard' } } },
      compositionFails: true,
    })
    await settled()
    expect(failed.visibility.show('s1' as SessionId)).toBe(true)
    // A session with no preset.
    const noPreset = bench({ rows: { s1: {} }, composition: PRESET_MOUNTED })
    await settled()
    expect(noPreset.visibility.show('s1' as SessionId)).toBe(true)
    // A missing preset group.
    const missing = bench({
      rows: { s1: { projectionValues: { agentPreset: 'unknown-preset' } } },
      composition: PRESET_MOUNTED,
    })
    await settled()
    expect(missing.visibility.show('s1' as SessionId)).toBe(true)
    // A broken preset group.
    const broken = bench({
      rows: { s1: { projectionValues: { agentPreset: 'standard' } } },
      composition: { agentPresets: [{ id: 'standard', broken: 'bad yaml', rows: [] }] },
    })
    await settled()
    expect(broken.visibility.show('s1' as SessionId)).toBe(true)
    // The no-session home state.
    await settled()
    expect(missing.visibility.show(undefined)).toBe(true)
  })
})

describe('RegistrationToggle', () => {
  it('registers exactly while shown, disposes when hidden, and re-registers on flip', () => {
    let shown = true
    let live = 0
    const toggle = new RegistrationToggle(() => {
      live += 1
      return () => { live -= 1 }
    }, () => shown)
    toggle.setReady(true)
    expect(live).toBe(1)
    toggle.sync()
    expect(live).toBe(1)
    shown = false
    toggle.sync()
    expect(live).toBe(0)
    shown = true
    toggle.sync()
    expect(live).toBe(1)
    toggle.setReady(false)
    expect(live).toBe(0)
  })

  it('registers nothing before ready', () => {
    let live = 0
    const toggle = new RegistrationToggle(() => {
      live += 1
      return () => { live -= 1 }
    }, () => true)
    toggle.sync()
    expect(live).toBe(0)
  })
})
