// @vitest-environment jsdom
/**
 * The game tab's preset self-hide: the root-mounted and preset-mounted grant
 * paths, fail-open on no inventory, and the room union (proposal
 * 2026-10-29-room-desk) — a room in another mode shows the game tab while a
 * member runs the game mode, following room's roster.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { GAME_AGENT_ROW_MODULE, GameTabVisibility, type GamePluginInventorySnapshot } from '../src/client/preset-visibility.ts'

const PRESET_MOUNTED: GamePluginInventorySnapshot = {
  entries: [
    { moduleName: '@khorsheed/dsh-game', enabled: true },
    { moduleName: GAME_AGENT_ROW_MODULE, enabled: false },
  ],
  agentPresets: [
    { id: 'gamedev', rows: [{ moduleName: GAME_AGENT_ROW_MODULE, enabled: true }] },
    { id: 'standard', rows: [{ moduleName: '@deepseek-ai/dsh-tool-bash', enabled: true }] },
    { id: 'gamedev-broken', broken: 'x', rows: [{ moduleName: GAME_AGENT_ROW_MODULE, enabled: true }] },
  ],
}

function bench(composition: GamePluginInventorySnapshot | undefined, rows: Record<string, unknown>) {
  const list = createSnapshotStore({
    ids: Object.keys(rows), byId: rows, phase: 'ready', subagentsByParent: {}, jobsBySession: {},
  })
  const ctx = new Context()
  ctx.provide('sessions', { list } as never)
  const pluginInventory = composition === undefined ? undefined : {
    list: vi.fn(async (): Promise<RemoteResult<GamePluginInventorySnapshot>> => ({ ok: true as const, value: composition })),
  }
  return { ctx, visibility: new GameTabVisibility(ctx, pluginInventory) }
}

async function settled(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('GameTabVisibility.show', () => {
  it('preset-mounted: shows in a game session, hides in a standard one; no inventory fails open', async () => {
    const rows = { g: { projectionValues: { agentPreset: 'gamedev' } }, s: { projectionValues: { agentPreset: 'standard' } } }
    const { visibility } = bench(PRESET_MOUNTED, rows)
    await settled()
    expect(visibility.show('g' as SessionId)).toBe(true)
    expect(visibility.show('s' as SessionId)).toBe(false)
    expect(bench(undefined, rows).visibility.show('s' as SessionId)).toBe(true)
  })

  it('a room in another mode shows the game tab while a member runs the game mode, and follows its roster', async () => {
    const { ctx, visibility } = bench(PRESET_MOUNTED, {
      room: { projectionValues: { agentPreset: 'standard' } },
      plain: { projectionValues: { agentPreset: 'standard' } },
    })
    await settled()
    expect(visibility.show('room' as SessionId)).toBe(false)
    let roster: readonly string[] = ['gamedev']
    const listeners = new Set<() => void>()
    ctx.provide('roomModes' as never, {
      presetsOf: (id: string) => id === 'room' ? roster : undefined,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    } as never)
    await settled()
    const notified = vi.fn()
    visibility.subscribe(notified)
    expect(visibility.show('room' as SessionId)).toBe(true)
    // Only rooms: an ordinary session keeps its own mode's verdict.
    expect(visibility.show('plain' as SessionId)).toBe(false)
    // An unknown or broken member mode does not count.
    roster = ['unknown', 'gamedev-broken']
    for (const listener of listeners) listener()
    expect(notified).toHaveBeenCalled()
    expect(visibility.show('room' as SessionId)).toBe(false)
  })
})
