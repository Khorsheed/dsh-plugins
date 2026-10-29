// @vitest-environment jsdom
/**
 * The 剪辑 tab's preset self-hide, the room union (proposal
 * 2026-10-29-room-desk): a room shows the tab while any member's mode grants
 * the video tool row, follows its roster, and a member mode the composition
 * cannot read grants nothing. Ordinary sessions keep their own mode's verdict.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { VIDEO_TOOL_ROW_MODULE, VideoTabVisibility, type VideoPluginInventorySnapshot } from '../src/client/preset-visibility.ts'

const PRESET_MOUNTED: VideoPluginInventorySnapshot = {
  entries: [{ moduleName: '@khorsheed/dsh-video-studio', enabled: true }],
  agentPresets: [
    { id: 'dsh-video', rows: [{ moduleName: VIDEO_TOOL_ROW_MODULE, enabled: true }] },
    { id: 'standard', rows: [{ moduleName: '@deepseek-ai/dsh-tool-bash', enabled: true }] },
    { id: 'dsh-broken', broken: 'missing file', rows: [{ moduleName: VIDEO_TOOL_ROW_MODULE, enabled: true }] },
  ],
}

function bench(rows: Record<string, unknown>) {
  const list = createSnapshotStore({ ids: Object.keys(rows), byId: rows, phase: 'ready', subagentsByParent: {}, jobsBySession: {} })
  const ctx = new Context()
  ctx.provide('sessions', { list } as never)
  const pluginInventory = {
    list: vi.fn(async (): Promise<RemoteResult<VideoPluginInventorySnapshot>> => ({ ok: true as const, value: PRESET_MOUNTED })),
  }
  return { ctx, visibility: new VideoTabVisibility(ctx, pluginInventory) }
}

async function settled(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('VideoTabVisibility in a room', () => {
  it('shows while a member runs the editing mode, and follows the roster', async () => {
    const { ctx, visibility } = bench({
      room: { projectionValues: { agentPreset: 'standard' } },
      plain: { projectionValues: { agentPreset: 'standard' } },
      editor: { projectionValues: { agentPreset: 'dsh-video' } },
    })
    await settled()
    expect(visibility.show('room' as SessionId)).toBe(false)
    expect(visibility.show('editor' as SessionId)).toBe(true)
    let roster: readonly string[] = ['dsh-video']
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
    // An unreadable or broken member mode grants nothing.
    roster = ['dsh-unknown', 'dsh-broken']
    for (const listener of listeners) listener()
    expect(notified).toHaveBeenCalled()
    expect(visibility.show('room' as SessionId)).toBe(false)
  })
})
