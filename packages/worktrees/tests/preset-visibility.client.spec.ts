// @vitest-environment jsdom
/**
 * The worktrees right-Sidebar tab's preset self-hide spec: the tab TYPE
 * registers exactly while the badge's criterion passes for the current
 * session (the guide enumerates registrations, so hidden means NOT
 * registered). Pinned here: the criterion's states per path (granted / not
 * granted / every fail-open — no namespace, pending or failed RPCs, no
 * preset, missing or broken group, the no-session home state), the
 * visiblePresets override, the legacy top-level preset key, and the toggle's
 * register-while-shown / dispose-while-hidden flipping on session switches.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { BadgeConfig, PluginInventorySnapshot } from '../src/types.ts'
import {
  RegistrationToggle, WORKTREES_TOOL_ROW_MODULE, WorktreesTabVisibility,
} from '../src/client/preset-visibility.ts'

const DEV: PluginInventorySnapshot = {
  agentPresets: [
    { id: 'dev', rows: [{ moduleName: WORKTREES_TOOL_ROW_MODULE }] },
    { id: 'standard', rows: [{ moduleName: '@deepseek-ai/dsh-tool-bash' }] },
  ],
}

interface BenchOptions {
  rows?: Record<string, unknown>
  current?: string
  /** The inventory answer; undefined = a host with NO pluginInventory namespace. */
  composition?: PluginInventorySnapshot
  compositionFails?: boolean
  /** The badgeConfig answer; undefined = ok with no visiblePresets. */
  gate?: readonly string[]
  configFails?: boolean
}

function bench(over: BenchOptions = {}) {
  const list = createSnapshotStore({
    ids: Object.keys(over.rows ?? {}),
    byId: over.rows ?? {},
    current: over.current as SessionId | undefined,
    phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
  const ctx = new Context()
  ctx.provide('sessions', { list, open: vi.fn() } as never)
  const pluginInventory = over.composition === undefined && over.compositionFails !== true
    ? undefined
    : {
      list: over.compositionFails === true
        ? vi.fn(async (): Promise<RemoteResult<PluginInventorySnapshot>> => ({ ok: false as const }))
        : vi.fn(async (): Promise<RemoteResult<PluginInventorySnapshot>> => ({ ok: true as const, value: over.composition ?? {} })),
    }
  const fetchBadgeConfig = over.configFails === true
    ? vi.fn(async (): Promise<RemoteResult<BadgeConfig>> => ({ ok: false as const }))
    : vi.fn(async (): Promise<RemoteResult<BadgeConfig>> => ({
      ok: true as const,
      value: { visiblePresets: [...(over.gate ?? [])] } as BadgeConfig,
    }))
  const visibility = new WorktreesTabVisibility(ctx, pluginInventory, fetchBadgeConfig)
  return { ctx, list, visibility }
}

/** Flush the constructor's config and inventory fetches. */
async function settled(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('WorktreesTabVisibility.show', () => {
  it('shows when the session preset composition names the worktrees-tool row', async () => {
    const { visibility } = bench({
      rows: { s1: { projectionValues: { agentPreset: 'dev' } } },
      composition: DEV,
    })
    await settled()
    expect(visibility.show('s1' as SessionId)).toBe(true)
  })

  it('hides when the session preset composition does NOT name the row', async () => {
    const { visibility } = bench({
      rows: { s1: { projectionValues: { agentPreset: 'standard' } } },
      composition: DEV,
    })
    await settled()
    expect(visibility.show('s1' as SessionId)).toBe(false)
  })

  it('reads the legacy TOP-LEVEL agentPreset key (the 0.1.1 line)', async () => {
    const { visibility } = bench({
      rows: { s1: { agentPreset: 'standard' } },
      composition: DEV,
    })
    await settled()
    expect(visibility.show('s1' as SessionId)).toBe(false)
  })

  it('fails open without a pluginInventory namespace', () => {
    const { visibility } = bench({
      rows: { s1: { projectionValues: { agentPreset: 'standard' } } },
    })
    expect(visibility.show('s1' as SessionId)).toBe(true)
  })

  it('fails open while the inventory RPC is pending or failed', async () => {
    const pending = bench({
      rows: { s1: { projectionValues: { agentPreset: 'standard' } } },
      composition: DEV,
    })
    expect(pending.visibility.show('s1' as SessionId)).toBe(true)
    const failed = bench({
      rows: { s1: { projectionValues: { agentPreset: 'standard' } } },
      compositionFails: true,
    })
    await settled()
    expect(failed.visibility.show('s1' as SessionId)).toBe(true)
  })

  it('fails open when the badge-config RPC fails (no override, composition decides)', async () => {
    const { visibility } = bench({
      rows: { s1: { projectionValues: { agentPreset: 'standard' } } },
      composition: DEV,
      configFails: true,
    })
    await settled()
    expect(visibility.show('s1' as SessionId)).toBe(false)
  })

  it('fails open for sessions with no preset, a missing group, or a broken group', async () => {
    const { visibility } = bench({
      rows: {
        s1: {},
        s2: { projectionValues: { agentPreset: 'ghost' } },
        s3: { projectionValues: { agentPreset: 'broken' } },
      },
      composition: {
        agentPresets: [{ id: 'broken', broken: 'parse error', rows: [] }],
      },
    })
    await settled()
    expect(visibility.show('s1' as SessionId)).toBe(true)
    expect(visibility.show('s2' as SessionId)).toBe(true)
    expect(visibility.show('s3' as SessionId)).toBe(true)
  })

  it('fails open on the no-session home state (undefined sessionId)', async () => {
    const { visibility } = bench({ composition: DEV })
    await settled()
    expect(visibility.show(undefined)).toBe(true)
  })

  it('honors the visiblePresets override over the composition data', async () => {
    const { visibility } = bench({
      rows: {
        s1: { projectionValues: { agentPreset: 'standard' } },
        s2: { projectionValues: { agentPreset: 'dev' } },
      },
      composition: DEV,
      gate: ['standard'],
    })
    await settled()
    expect(visibility.show('s1' as SessionId)).toBe(true)
    expect(visibility.show('s2' as SessionId)).toBe(false)
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
