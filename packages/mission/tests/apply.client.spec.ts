// @vitest-environment jsdom
/** The browser half's apply: Remote mount, the conversation.view entry (registered exactly while the current session's preset composition grants the mission tool row), the injected face, teardown. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'
import type { MissionsViewInjected } from '../src/client/contract.ts'
import { MISSION_TOOL_ROW_MODULE, type MissionPluginInventorySnapshot } from '../src/client/preset-visibility.ts'

/** Stub Remote namespace: carried result envelopes like production. */
function remoteStub() {
  return {
    queue: vi.fn(async () => ({ ok: true as const, value: { sessionId: 's1', runs: [] } })),
    get: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    retry: vi.fn(async () => ({ ok: true as const, value: { attempt: 2 } })),
    isReleasable: vi.fn(async () => ({ ok: true as const, value: { releasable: false } })),
    exportPlan: vi.fn(async () => ({
      ok: true as const,
      value: { bundleDir: '/out/r-bundle', guardedLayers: [], expectedNs: null, missions: 1, attempts: 1 },
    })),
    exportRun: vi.fn(async () => ({ ok: true as const, value: { bundleDir: '/out/r-bundle', files: 3 } })),
  }
}

/** The composition answer used by the gate tests. */
const DEV: MissionPluginInventorySnapshot = {
  agentPresets: [
    { id: 'dev', rows: [{ moduleName: MISSION_TOOL_ROW_MODULE }] },
    { id: 'standard', rows: [{ moduleName: '@deepseek-ai/dsh-tool-bash' }] },
  ],
}

/** Flush the visibility controller's inventory fetch. */
async function settled(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

/** Real cordis composition with the slot registry, locale runtime, a session list, and stub remotes. */
async function bench(options: {
  mountFails?: boolean
  preset?: string
  composition?: MissionPluginInventorySnapshot
  /** A whole session list, for the parent-chain cases; overrides `preset`. */
  rows?: Record<string, unknown>
} = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const remoteService = {
    $mount: options.mountFails === true
      ? vi.fn(async (): Promise<() => Promise<void>> => { throw new Error('already mounted') })
      : vi.fn(async (): Promise<() => Promise<void>> => async () => {}),
  }
  ctx.provide('remote', remoteService as never)
  const remote = remoteStub()
  ctx.provide('remote.mission', remote as never)
  // No preset on the row = the fail-open default; a named preset reads the composition.
  const byId = options.rows
    ?? (options.preset === undefined ? { s1: {} } : { s1: { projectionValues: { agentPreset: options.preset } } })
  const list = createSnapshotStore({
    ids: Object.keys(byId),
    byId,
    current: 's1' as SessionId,
    phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  })
  ctx.provide('sessions', { list, open: vi.fn() } as never)
  if (options.composition !== undefined) {
    ctx.provide('remote.pluginInventory', {
      list: async () => ({ ok: true as const, value: options.composition }),
    } as never)
  }
  const slots = ctx.get('slots') as SlotRegistry
  // The view ring as ui-conversation declares it in production.
  slots.register({
    name: 'root',
    children: { 'conversation.view': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  return { ctx, slots, remote, remoteService }
}

describe('mission client apply', () => {
  afterEach(() => { document.head.innerHTML = '' })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'remote', 'locale', 'sessions'])
  })

  it('mounts the Remote and registers the missions view entry', async () => {
    const { ctx, slots, remoteService } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()

    expect(remoteService.$mount).toHaveBeenCalledTimes(1)
    const entries = slots.entries('conversation.view')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.options).toMatchObject({ id: 'missions', order: 35 })
    expect(typeof entries[0]!.options.label).toBe('function')
  })

  it('still registers the view when the Remote mount fails (already mounted elsewhere)', async () => {
    const { ctx, slots } = await bench({ mountFails: true })
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(slots.entries('conversation.view')).toHaveLength(1)
  })

  it('leaves the tab registered when the current preset composition names the mission-tool row', async () => {
    const { ctx, slots } = await bench({ preset: 'dev', composition: DEV })
    await ctx.plugin({ inject: [...inject], apply }).await()
    await settled()
    expect(slots.entries('conversation.view')).toHaveLength(1)
  })

  it('drops the tab registration in a session whose preset grants no mission tools', async () => {
    const { ctx, slots } = await bench({ preset: 'standard', composition: DEV })
    await ctx.plugin({ inject: [...inject], apply }).await()
    await settled()
    expect(slots.entries('conversation.view')).toHaveLength(0)
  })

  // I5·T39 · G13: a member sub-session of an evaluation declares no preset of
  // its own, so read alone it took the fail-open arm and showed this tab
  // inside a player's own transcript while the parent session hid it.
  it('decides a member sub-session by its PARENT\'s preset composition', async () => {
    const { ctx, slots } = await bench({
      composition: DEV,
      rows: { s1: { parentSessionId: 'main' } },
    })
    await ctx.plugin({ inject: [...inject], apply }).await()
    await settled()
    expect(slots.entries('conversation.view')).toHaveLength(1)
  })

  it('hides in a member sub-session whose parent grants no mission tools', async () => {
    const { ctx, slots } = await bench({
      composition: DEV,
      rows: { s1: { parentSessionId: 'main' }, main: { projectionValues: { agentPreset: 'standard' } } },
    })
    await ctx.plugin({ inject: [...inject], apply }).await()
    await settled()
    expect(slots.entries('conversation.view')).toHaveLength(0)
  })

  it('keeps the tab when the composition cannot be read (fail-open)', async () => {
    // No `remote.pluginInventory` namespace at all — a pre-0.1.5 host.
    const { ctx, slots } = await bench({ preset: 'standard' })
    await ctx.plugin({ inject: [...inject], apply }).await()
    await settled()
    expect(slots.entries('conversation.view')).toHaveLength(1)
  })

  it('the injected face binds every verb to the Remote namespace with the session id', async () => {
    const { ctx, slots, remote } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('conversation.view')[0]!
    const face = (entry.inject as unknown as (sessionId: string) => MissionsViewInjected)('s1')

    await face.fetchQueue('s1', { all: true })
    expect(remote.queue).toHaveBeenCalledWith('s1', { all: true })

    await face.fetchMission('s1', { missionId: 'm', runId: 'r' })
    expect(remote.get).toHaveBeenCalledWith('s1', { missionId: 'm', runId: 'r' })

    await face.retryMission('s1', {
      missionId: 'm', runId: 'r', reason: 'requested another pass', category: 'operator',
    })
    expect(remote.retry).toHaveBeenCalledWith('s1', {
      missionId: 'm', runId: 'r', reason: 'requested another pass', category: 'operator',
    })

    await face.checkReleasable('s1', { missionId: 'm' })
    expect(remote.isReleasable).toHaveBeenCalledWith('s1', { missionId: 'm' })

    await face.planExport('s1', { runId: 'r', outDir: '/out', layers: ['visible'] })
    expect(remote.exportPlan).toHaveBeenCalledWith('s1', { runId: 'r', outDir: '/out', layers: ['visible'] })

    await face.exportRun('s1', { runId: 'r', outDir: '/out', confirmed: [] })
    expect(remote.exportRun).toHaveBeenCalledWith('s1', { runId: 'r', outDir: '/out', confirmed: [] })
  })

  it('collapses the view entry on teardown', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('conversation.view')).toHaveLength(1)

    await fiber.dispose()

    expect(slots.entries('conversation.view')).toHaveLength(0)
  })
})
