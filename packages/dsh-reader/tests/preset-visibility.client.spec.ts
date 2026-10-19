// @vitest-environment jsdom
/**
 * The reader tab's preset self-hide (a copy of the canvas criterion): the tab
 * TYPE registers exactly while the current session can reach the reader tools
 * — a root-mounted `@khorsheed/dsh-reader/tool` row (a standalone install) or
 * the session's preset naming it (the learning / writing packs, 2026-10-19).
 * Every unreadable path fails open.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  READER_TOOL_ROW_MODULE, ReaderTabVisibility, RegistrationToggle,
  type ReaderPluginInventorySnapshot,
} from '../src/client/preset-visibility.ts'

/** The mode-pack shape: no root tool row, the learning and writing presets granting it. */
const PACKED: ReaderPluginInventorySnapshot = {
  entries: [{ moduleName: '@khorsheed/dsh-reader', enabled: true }],
  agentPresets: [
    { id: 'dsh-learning', rows: [{ moduleName: READER_TOOL_ROW_MODULE, enabled: true }] },
    { id: 'dsh-writing', rows: [{ moduleName: READER_TOOL_ROW_MODULE, enabled: true }] },
    { id: 'dsh-dev', rows: [{ moduleName: '@deepseek-ai/dsh-tool-bash', enabled: true }] },
  ],
}

/** A standalone install: the package's own patch mounts the tool row at the root. */
const STANDALONE: ReaderPluginInventorySnapshot = {
  entries: [
    { moduleName: '@khorsheed/dsh-reader', enabled: true },
    { moduleName: READER_TOOL_ROW_MODULE, enabled: true },
  ],
  agentPresets: [{ id: 'dsh-dev', rows: [] }],
}

function bench(rows: Record<string, unknown>, composition?: ReaderPluginInventorySnapshot | 'fails') {
  const list = createSnapshotStore({ ids: Object.keys(rows), byId: rows, phase: 'ready', subagentsByParent: {}, jobsBySession: {} })
  const ctx = new Context()
  ctx.provide('sessions', { list } as never)
  const inventory = composition === undefined
    ? undefined
    : {
      list: vi.fn(async (): Promise<RemoteResult<ReaderPluginInventorySnapshot>> =>
        composition === 'fails' ? ({ ok: false } as never) : ({ ok: true as const, value: composition })),
    }
  return new ReaderTabVisibility(ctx, inventory)
}

const settled = () => new Promise(resolve => setTimeout(resolve, 0))

describe('ReaderTabVisibility.show', () => {
  it('mode packs: shows in learning and writing sessions, hides in a dev one', async () => {
    const visibility = bench({
      a: { projectionValues: { agentPreset: 'dsh-learning' } },
      b: { projectionValues: { agentPreset: 'dsh-writing' } },
      c: { projectionValues: { agentPreset: 'dsh-dev' } },
    }, PACKED)
    await settled()
    expect(visibility.show('a' as SessionId)).toBe(true)
    expect(visibility.show('b' as SessionId)).toBe(true)
    expect(visibility.show('c' as SessionId)).toBe(false)
  })

  it('standalone install: the root tool row shows it everywhere', async () => {
    const visibility = bench({ c: { projectionValues: { agentPreset: 'dsh-dev' } } }, STANDALONE)
    await settled()
    expect(visibility.show('c' as SessionId)).toBe(true)
  })

  it('fails open: no namespace, a failed list, no session, no preset, an unknown preset', async () => {
    expect(bench({ c: { projectionValues: { agentPreset: 'dsh-dev' } } }).show('c' as SessionId)).toBe(true)
    const failed = bench({ c: { projectionValues: { agentPreset: 'dsh-dev' } } }, 'fails')
    await settled()
    expect(failed.show('c' as SessionId)).toBe(true)
    const packed = bench({ n: {}, u: { projectionValues: { agentPreset: 'mystery' } } }, PACKED)
    await settled()
    expect(packed.show(undefined)).toBe(true)
    expect(packed.show('n' as SessionId)).toBe(true)
    expect(packed.show('u' as SessionId)).toBe(true)
  })

  it('the toggle registers only while shown', () => {
    let shown = true
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    const toggle = new RegistrationToggle(register, () => shown)
    toggle.setReady(true)
    expect(register).toHaveBeenCalledTimes(1)
    shown = false
    toggle.sync()
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
