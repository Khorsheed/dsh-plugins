// @vitest-environment jsdom
/** The browser half's apply: Remote mount, the conversation.view entry (registered exactly while the current session's preset composition grants the dataset tool row), the injected face, teardown. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'
import type { DatasetsViewInjected } from '../src/client/contract.ts'
import { DATASETS_TOOL_ROW_MODULE, type DatasetsPluginInventorySnapshot } from '../src/client/preset-visibility.ts'

/** The composition answer used by the gate tests. */
const DEV: DatasetsPluginInventorySnapshot = {
  agentPresets: [
    { id: 'dev', rows: [{ moduleName: DATASETS_TOOL_ROW_MODULE }] },
    { id: 'standard', rows: [{ moduleName: '@deepseek-ai/dsh-tool-bash' }] },
  ],
}

/** Flush the visibility controller's inventory fetch. */
async function settled(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

/** Stub Remote namespace: carried result envelopes like production. */
function remoteStub() {
  return {
    binding: vi.fn(async () => ({ ok: true as const, value: null })),
    bind: vi.fn(async (_sid: string, binding: unknown) => ({ ok: true as const, value: binding })),
    unbind: vi.fn(async () => ({ ok: true as const, value: null })),
    list: vi.fn(async () => ({ ok: true as const, value: { kind: 'datasets' as const, datasets: [] } })),
    show: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    read: vi.fn(async () => ({ ok: true as const, value: { content: 'x', commit: 'abc' } })),
  }
}

/** Real cordis composition with the slot registry, locale runtime, and stub remotes. */
async function bench(options: {
  mountFails?: boolean
  connectionSeat?: 'rc' | 'alpha'
  preset?: string
  composition?: DatasetsPluginInventorySnapshot
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
  ctx.provide('remote.datasets', remote as never)
  const workspaces = { pickDirectory: vi.fn(async () => '/picked') }
  ctx.provide('workspaces', workspaces as never)
  ctx.provide('connection', options.connectionSeat === 'alpha'
    // 0.1.2 folded the host facts into the generation's opening frame
    // (Connection.hostDescription removed, upstream e14d354e83).
    ? {
      isLoopback: true,
      generation: { getSnapshot: () => ({ host: { home: '/h' } }), subscribe: () => () => {} },
    } as never
    : {
      isLoopback: true,
      hostDescription: { getSnapshot: () => ({ canOpenPath: true }), subscribe: () => () => {} },
    } as never)
  // No preset on the row = the fail-open default; a named preset reads the composition.
  const list = createSnapshotStore({
    ids: ['s1'],
    byId: options.preset === undefined ? { s1: {} } : { s1: { projectionValues: { agentPreset: options.preset } } },
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
  return { ctx, slots, remote, remoteService, workspaces }
}

describe('datasets client apply', () => {
  afterEach(() => { document.head.innerHTML = '' })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'remote', 'locale', 'workspaces', 'connection', 'sessions'])
  })

  it('mounts the Remote and registers the datasets view entry', async () => {
    const { ctx, slots, remoteService } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()

    expect(remoteService.$mount).toHaveBeenCalledTimes(1)
    const entries = slots.entries('conversation.view')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.options).toMatchObject({ id: 'datasets', order: 30 })
    expect(typeof entries[0]!.options.label).toBe('function')
  })

  it('still registers the view when the Remote mount fails (already mounted elsewhere)', async () => {
    const { ctx, slots } = await bench({ mountFails: true })
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(slots.entries('conversation.view')).toHaveLength(1)
  })

  it('leaves the tab registered when the current preset composition names the datasets-tool row', async () => {
    const { ctx, slots } = await bench({ preset: 'dev', composition: DEV })
    await ctx.plugin({ inject: [...inject], apply }).await()
    await settled()
    expect(slots.entries('conversation.view')).toHaveLength(1)
  })

  it('drops the tab registration in a session whose preset grants no dataset tools', async () => {
    const { ctx, slots } = await bench({ preset: 'standard', composition: DEV })
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
    const face = (entry.inject as unknown as (sessionId: string) => DatasetsViewInjected)('s1')

    await face.fetchBinding('s1')
    expect(remote.binding).toHaveBeenCalledWith('s1')

    const binding = { repoPath: '/repo', layers: ['visible'] }
    await face.bindSession('s1', binding)
    expect(remote.bind).toHaveBeenCalledWith('s1', binding)

    await face.unbindSession('s1')
    expect(remote.unbind).toHaveBeenCalledWith('s1')

    await face.listDatasets('s1')
    expect(remote.list).toHaveBeenCalledWith('s1', {})
    await face.listDatasets('s1', 'alpha')
    expect(remote.list).toHaveBeenCalledWith('s1', { dataset: 'alpha' })

    const query = { dataset: 'alpha', item: 'i1', layer: 'visible', path: 'task.md' }
    await face.readFile('s1', query)
    expect(remote.read).toHaveBeenCalledWith('s1', query)
  })

  it('the face routes the native directory pick through the workspaces service', async () => {
    const { ctx, slots, workspaces } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('conversation.view')[0]!
    const face = (entry.inject as unknown as (sessionId: string) => DatasetsViewInjected)('s1')
    expect(face.isLoopback).toBe(true)
    expect(face.hooks.hostDescription.getSnapshot()).toEqual({ canOpenPath: true })
    await expect(face.pickDirectory()).resolves.toBe('/picked')
    expect(workspaces.pickDirectory).toHaveBeenCalledTimes(1)
  })

  it('derives the host-facts hook from the connection generation on hosts without hostDescription (0.1.2)', async () => {
    const { ctx, slots } = await bench({ connectionSeat: 'alpha' })
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('conversation.view')[0]!
    const face = (entry.inject as unknown as (sessionId: string) => DatasetsViewInjected)('s1')
    expect(face.hooks.hostDescription.getSnapshot()).toEqual({ home: '/h' })
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
