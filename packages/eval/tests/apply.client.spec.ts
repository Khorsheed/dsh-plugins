// @vitest-environment jsdom
/** The browser half's apply: Remote mount, the conversation.view entry (registered exactly while the current session's preset composition grants the eval tool row), the injected face, teardown. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'
import type { LabViewInjected } from '../src/client/contract.ts'
import { EVAL_TOOL_ROW_MODULE, type EvalPluginInventorySnapshot } from '../src/client/preset-visibility.ts'

/** Stub Remote namespace: carried result envelopes like production. */
function remoteStub() {
  return {
    runs: vi.fn(async () => ({ ok: true as const, value: { repo: null, datasets: [], rows: [], notes: [] } })),
    run: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
  }
}

/** The composition answer used by the gate tests: only `eval` grants the tool row. */
const PRESETS: EvalPluginInventorySnapshot = {
  agentPresets: [
    { id: 'eval', rows: [{ moduleName: EVAL_TOOL_ROW_MODULE }] },
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
  composition?: EvalPluginInventorySnapshot
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
  ctx.provide('remote.dshEval', remote as never)
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
  return { ctx, slots, remote, remoteService }
}

describe('eval client apply', () => {
  afterEach(() => { document.head.innerHTML = '' })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'remote', 'locale', 'sessions'])
  })

  it('mounts the Remote and registers the lab view entry at order 40', async () => {
    const { ctx, slots, remoteService } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()

    expect(remoteService.$mount).toHaveBeenCalledTimes(1)
    const entries = slots.entries('conversation.view')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.options).toMatchObject({ id: 'lab', order: 40 })
    expect(typeof entries[0]!.options.label).toBe('function')
  })

  it('still registers the view when the Remote mount fails (already mounted elsewhere)', async () => {
    const { ctx, slots } = await bench({ mountFails: true })
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(slots.entries('conversation.view')).toHaveLength(1)
  })

  it('leaves the tab registered when the current preset composition names the eval-tool row', async () => {
    const { ctx, slots } = await bench({ preset: 'eval', composition: PRESETS })
    await ctx.plugin({ inject: [...inject], apply }).await()
    await settled()
    expect(slots.entries('conversation.view')).toHaveLength(1)
  })

  it('drops the tab registration in a session whose preset grants no eval tools', async () => {
    const { ctx, slots } = await bench({ preset: 'standard', composition: PRESETS })
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

  it('the injected face binds both read verbs to the Remote namespace with the session id', async () => {
    const { ctx, slots, remote } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('conversation.view')[0]!
    const face = (entry.inject as unknown as (sessionId: string) => LabViewInjected)('s1')

    await face.fetchExperiments('s1' as SessionId, {})
    expect(remote.runs).toHaveBeenCalledWith('s1', {})

    await face.fetchExperiment('s1' as SessionId, { runId: 'run-1' })
    expect(remote.run).toHaveBeenCalledWith('s1', { runId: 'run-1' })
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
