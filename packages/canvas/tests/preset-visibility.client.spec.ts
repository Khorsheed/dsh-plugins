// @vitest-environment jsdom
/**
 * The canvas right-Sidebar tab's preset self-hide spec (proposal
 * 2026-09-17-preset-visibility-rollout, A2): the tab TYPE registers exactly
 * while the CURRENT session can reach the canvas tools — either through a
 * root-mounted `@khorsheed/dsh-canvas/agent` row (the community default:
 * tools in every session) or through the session's preset composition (the
 * writing-mode recipe). Pinned here: the two grant paths, every fail-open
 * (no namespace, pending/failed RPC, no preset, missing/broken group, the
 * no-session home state), the disabled-root-row case (the 3080 shape: root
 * row disabled, preset row granting), and the community-default regression
 * guard (root-mounted row MUST stay visible everywhere — checking only the
 * preset slice would re-run the 2026-09-16 permanent hide).
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  CANVAS_AGENT_ROW_MODULE, CanvasTabVisibility, RegistrationToggle,
  type CanvasPluginInventorySnapshot,
} from '../src/client/preset-visibility.ts'

/** The 3080 shape: the root row DISABLED, the writing preset granting it. */
const PRESET_MOUNTED: CanvasPluginInventorySnapshot = {
  entries: [
    { moduleName: '@khorsheed/dsh-canvas', enabled: true },
    { moduleName: CANVAS_AGENT_ROW_MODULE, enabled: false },
  ],
  agentPresets: [
    { id: 'dsh-writing', rows: [{ moduleName: CANVAS_AGENT_ROW_MODULE, enabled: true }] },
    { id: 'standard', rows: [{ moduleName: '@deepseek-ai/dsh-tool-bash', enabled: true }] },
  ],
}

/** The community default: the agent row mounted at the profile root. */
const ROOT_MOUNTED: CanvasPluginInventorySnapshot = {
  entries: [
    { moduleName: '@khorsheed/dsh-canvas', enabled: true },
    { moduleName: CANVAS_AGENT_ROW_MODULE, enabled: true },
  ],
  agentPresets: [
    { id: 'standard', rows: [{ moduleName: '@deepseek-ai/dsh-tool-bash', enabled: true }] },
  ],
}

interface BenchOptions {
  rows?: Record<string, unknown>
  current?: string
  /** The inventory answer; undefined = a host with NO pluginInventory namespace. */
  composition?: CanvasPluginInventorySnapshot
  compositionFails?: boolean
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
        ? vi.fn(async (): Promise<RemoteResult<CanvasPluginInventorySnapshot>> => ({ ok: false as const }))
        : vi.fn(async (): Promise<RemoteResult<CanvasPluginInventorySnapshot>> => ({ ok: true as const, value: over.composition ?? {} })),
    }
  const visibility = new CanvasTabVisibility(ctx, pluginInventory)
  return { ctx, list, visibility }
}

/** Flush the constructor's inventory fetch. */
async function settled(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('CanvasTabVisibility.show', () => {
  it('preset-mounted: shows in a writing session, hides in a standard one', async () => {
    const { visibility } = bench({
      rows: {
        s1: { projectionValues: { agentPreset: 'dsh-writing' } },
        s2: { projectionValues: { agentPreset: 'standard' } },
      },
      composition: PRESET_MOUNTED,
    })
    await settled()
    expect(visibility.show('s1' as SessionId)).toBe(true)
    expect(visibility.show('s2' as SessionId)).toBe(false)
  })

  it('root-mounted (community default): visible for EVERY session — the regression guard', async () => {
    const { visibility } = bench({
      rows: { s1: { projectionValues: { agentPreset: 'standard' } } },
      composition: ROOT_MOUNTED,
    })
    await settled()
    expect(visibility.show('s1' as SessionId)).toBe(true)
    expect(visibility.show(undefined)).toBe(true)
  })

  it('reads the legacy TOP-LEVEL agentPreset key (the 0.1.1 line)', async () => {
    const { visibility } = bench({
      rows: { s1: { agentPreset: 'standard' } },
      composition: PRESET_MOUNTED,
    })
    await settled()
    expect(visibility.show('s1' as SessionId)).toBe(false)
  })

  it('fails open without a pluginInventory namespace', () => {
    const { visibility } = bench({
      rows: { s1: { projectionValues: { agentPreset: 'standard' } } },
      composition: PRESET_MOUNTED,
    })
    const bare = bench({ rows: { s1: { projectionValues: { agentPreset: 'standard' } } } })
    expect(bare.visibility.show('s1' as SessionId)).toBe(true)
    void visibility
  })

  it('fails open while the inventory RPC is pending or failed', async () => {
    const pending = bench({
      rows: { s1: { projectionValues: { agentPreset: 'standard' } } },
      composition: PRESET_MOUNTED,
    })
    expect(pending.visibility.show('s1' as SessionId)).toBe(true)
    const failed = bench({
      rows: { s1: { projectionValues: { agentPreset: 'standard' } } },
      compositionFails: true,
    })
    await settled()
    expect(failed.visibility.show('s1' as SessionId)).toBe(true)
  })

  it('fails open for sessions with no preset, a missing group, or a broken group', async () => {
    const { visibility } = bench({
      rows: {
        s1: {},
        s2: { projectionValues: { agentPreset: 'ghost' } },
        s3: { projectionValues: { agentPreset: 'broken' } },
      },
      composition: {
        entries: [],
        agentPresets: [{ id: 'broken', broken: 'parse error', rows: [] }],
      },
    })
    await settled()
    expect(visibility.show('s1' as SessionId)).toBe(true)
    expect(visibility.show('s2' as SessionId)).toBe(true)
    expect(visibility.show('s3' as SessionId)).toBe(true)
  })

  it('fails open on the no-session home state when no root row grants', async () => {
    const { visibility } = bench({ composition: PRESET_MOUNTED })
    await settled()
    expect(visibility.show(undefined)).toBe(true)
  })

  it('treats a disabled preset-composition row as NOT granted', async () => {
    const { visibility } = bench({
      rows: { s1: { projectionValues: { agentPreset: 'dsh-writing' } } },
      composition: {
        entries: [],
        agentPresets: [{
          id: 'dsh-writing',
          rows: [{ moduleName: CANVAS_AGENT_ROW_MODULE, enabled: false }],
        }],
      },
    })
    await settled()
    expect(visibility.show('s1' as SessionId)).toBe(false)
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
