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
    plan: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    conditions: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    conditionDiff: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    approve: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    runOutput: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    matrix: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    cells: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    cell: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    retry: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    releaseCheck: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    exportPlan: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
    exportRun: vi.fn(async () => ({ ok: false as const, error: { code: 'unused', message: 'unused' } })),
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
  /** Publish the 0.1.5-shaped list (top-level `current`, no per-row retention). */
  legacyCurrent?: boolean
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
  ctx.provide('remote.dshEval', remote as never)
  // No preset on the row = the fail-open default; a named preset reads the
  // composition; `rows` supplies a whole list for the parent-chain cases.
  // The on-screen session: 0.1.6-alpha.2 reads the row's main-view retention
  // count; `legacyCurrent` exercises the 0.1.5 `current` fallback instead.
  const byId = options.rows
    ?? (options.preset === undefined ? { s1: {} } : { s1: { projectionValues: { agentPreset: options.preset } } })
  const list = createSnapshotStore(options.legacyCurrent === true
    ? { ids: Object.keys(byId), byId, current: 's1' as SessionId, phase: 'ready', subagentsByParent: {}, jobsBySession: {} }
    : {
        ids: Object.keys(byId),
        byId: Object.fromEntries(Object.entries(byId).map(([id, row]) => [
          id,
          { id, ...(row as Record<string, unknown>), ...(id === 's1' ? { retainedBy: { mainView: 1 } } : {}) },
        ])),
        phase: 'ready', subagentsByParent: {}, jobsBySession: {},
      })
  ctx.provide('sessions', { list } as never)
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

  it('registers the tab on a 0.1.5-shaped list (legacy current fallback)', async () => {
    const { ctx, slots } = await bench({ legacyCurrent: true })
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

  // I5·T39 · G13. A cell of an evaluation delegates into a child session, and
  // a condition that names no agent preset (most of them: `"preset": null`)
  // produces one with no `agentPreset` at all. Read alone that session took
  // the fail-open arm, so every gated tab appeared inside a player's own
  // transcript — including the ones the parent had correctly hidden.
  it('decides a member sub-session by its PARENT\'s preset composition', async () => {
    const { ctx, slots } = await bench({
      composition: PRESETS,
      rows: { s1: { parentSessionId: 'main' }, main: { projectionValues: { agentPreset: 'standard' } } },
    })
    await ctx.plugin({ inject: [...inject], apply }).await()
    await settled()
    expect(slots.entries('conversation.view')).toHaveLength(0)
  })

  it('shows the tab in a member sub-session whose parent grants the row', async () => {
    const { ctx, slots } = await bench({
      composition: PRESETS,
      rows: { s1: { parentSessionId: 'main' }, main: { projectionValues: { agentPreset: 'eval' } } },
    })
    await ctx.plugin({ inject: [...inject], apply }).await()
    await settled()
    expect(slots.entries('conversation.view')).toHaveLength(1)
  })

  it('a session with no preset and no parent still fails open', async () => {
    const { ctx, slots } = await bench({ composition: PRESETS, rows: { s1: {} } })
    await ctx.plugin({ inject: [...inject], apply }).await()
    await settled()
    expect(slots.entries('conversation.view')).toHaveLength(1)
  })

  it('a parent chain that points at itself does not hang the strip', async () => {
    const { ctx, slots } = await bench({
      composition: PRESETS,
      rows: { s1: { parentSessionId: 'loop' }, loop: { parentSessionId: 's1' } },
    })
    await ctx.plugin({ inject: [...inject], apply }).await()
    await settled()
    expect(slots.entries('conversation.view')).toHaveLength(1)
  })

  it('keeps the tab when the composition cannot be read (fail-open)', async () => {
    // No `remote.pluginInventory` namespace at all — a pre-0.1.5 host.
    const { ctx, slots } = await bench({ preset: 'standard' })
    await ctx.plugin({ inject: [...inject], apply }).await()
    await settled()
    expect(slots.entries('conversation.view')).toHaveLength(1)
  })

  it('the injected face binds every session-scoped verb to the Remote namespace with the session id', async () => {
    const { ctx, slots, remote } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('conversation.view')[0]!
    const face = (entry.inject as unknown as (sessionId: string) => LabViewInjected)('s1')

    await face.fetchExperiments('s1' as SessionId, {})
    expect(remote.runs).toHaveBeenCalledWith('s1', {})

    await face.fetchExperiment('s1' as SessionId, { runId: 'run-1' })
    expect(remote.run).toHaveBeenCalledWith('s1', { runId: 'run-1' })

    await face.fetchPlanReview('s1' as SessionId, { planPath: '/repo/plans/p.json' })
    expect(remote.plan).toHaveBeenCalledWith('s1', { planPath: '/repo/plans/p.json' })

    await face.fetchConditions('s1' as SessionId, {})
    expect(remote.conditions).toHaveBeenCalledWith('s1', {})

    await face.fetchConditionDiff('s1' as SessionId, { a: 'x', b: 'y' })
    expect(remote.conditionDiff).toHaveBeenCalledWith('s1', { a: 'x', b: 'y' })

    await face.approvePlan('s1' as SessionId, { planPath: '/repo/plans/p.json' })
    expect(remote.approve).toHaveBeenCalledWith('s1', { planPath: '/repo/plans/p.json' })

    await face.fetchMatrix('s1' as SessionId, { runId: 'run-1' })
    expect(remote.matrix).toHaveBeenCalledWith('s1', { runId: 'run-1' })

    await face.fetchCells('s1' as SessionId, { runId: 'run-1', bucket: 'active' })
    expect(remote.cells).toHaveBeenCalledWith('s1', { runId: 'run-1', bucket: 'active' })

    await face.fetchCell('s1' as SessionId, { runId: 'run-1', missionId: 'c1' })
    expect(remote.cell).toHaveBeenCalledWith('s1', { runId: 'run-1', missionId: 'c1' })

    await face.retryCell('s1' as SessionId, { runId: 'run-1', missionId: 'c1', reason: 'the unit died', category: 'infrastructure' })
    expect(remote.retry).toHaveBeenCalledWith('s1', { runId: 'run-1', missionId: 'c1', reason: 'the unit died', category: 'infrastructure' })

    await face.releaseCheck('s1' as SessionId, { runId: 'run-1', missionId: 'c1' })
    expect(remote.releaseCheck).toHaveBeenCalledWith('s1', { runId: 'run-1', missionId: 'c1' })

    await face.planExport('s1' as SessionId, { runId: 'run-1', outDir: '/out' })
    expect(remote.exportPlan).toHaveBeenCalledWith('s1', { runId: 'run-1', outDir: '/out' })

    await face.exportRun('s1' as SessionId, { runId: 'run-1', outDir: '/out', confirmed: [] })
    expect(remote.exportRun).toHaveBeenCalledWith('s1', { runId: 'run-1', outDir: '/out', confirmed: [] })
  })

  // Every lab verb is checked for its FULL positional list above, not just for
  // its payload: the gateway's client proxy enforces exact arity, so a call
  // that leaves a parameter off throws before it reaches the wire. T35b's
  // eight all take exactly (sessionId, request) and have no optional tail —
  // `runOutput` is the only verb that does, and the test below pins its 0.
  it('every session-scoped verb takes exactly the session and one request object', async () => {
    const { ctx, slots, remote } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('conversation.view')[0]!
    const face = (entry.inject as unknown as (sessionId: string) => LabViewInjected)('s1')

    await face.fetchMatrix('s1' as SessionId, { runId: 'run-1' })
    await face.fetchCell('s1' as SessionId, { runId: 'run-1', missionId: 'c1' })
    for (const spy of [remote.matrix, remote.cell]) {
      expect(spy.mock.calls.every(call => call.length === 2)).toBe(true)
    }
  })

  it('the job-log verb is session-LESS — it is the CI face\'s own runOutput', async () => {
    const { ctx, slots, remote } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('conversation.view')[0]!
    const face = (entry.inject as unknown as (sessionId: string) => LabViewInjected)('s1')

    await face.fetchRunOutput('eval-run-1')
    // The cursor rides along explicitly: the proxy enforces exact arity, and a
    // one-argument call throws before it reaches the wire (measured on the
    // temporary instance, T36).
    expect(remote.runOutput).toHaveBeenCalledWith('eval-run-1', 0)
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
