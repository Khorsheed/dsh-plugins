/**
 * Since mission folded into eval (2026-10-24) the eval row itself mounts the
 * mission ledger: one package, one row. The `mission` service name and the
 * data root it defaults to are what the standalone row provided, so eval's
 * per-call probes and lab's probe are unaffected.
 */
import { describe, expect, it } from 'vitest'
import { apply } from '../../src/index.ts'
import * as missionLedger from '../../src/mission/index.ts'

/** A stub Context that records what the eval row mounts. */
function recordingCtx() {
  const plugins: Array<{ plugin: unknown; config: unknown }> = []
  const provided: string[] = []
  const ctx = {
    provide: (name: string) => { provided.push(name) },
    plugin: (plugin: unknown, config?: unknown) => { plugins.push({ plugin, config }) },
    effect: () => {},
    inject: () => {},
    get: () => undefined,
    on: () => () => {},
  }
  return { ctx, plugins, provided }
}

describe('the eval row mounts the mission ledger', () => {
  it('mounts the mission plugin with the default data root', () => {
    const { ctx, plugins } = recordingCtx()
    apply(ctx as never, {})
    const mounted = plugins.find(entry => entry.plugin === missionLedger)
    expect(mounted, 'eval must mount the mission ledger as a child plugin').toBeDefined()
    expect(mounted!.config).toEqual({ dataDir: '' })
    expect(missionLedger.name).toBe('mission')
  })

  it('passes a configured mission data root through', () => {
    const { ctx, plugins } = recordingCtx()
    apply(ctx as never, { mission: { dataDir: '/home/user/ledger' } })
    expect(plugins.find(entry => entry.plugin === missionLedger)!.config).toEqual({ dataDir: '/home/user/ledger' })
  })
})
