/** The core's remaining faces after the tool-row split (M4'③), the
 * preset-visibility rollout (A3), and the tab/Remote retirement: the service
 * alone. The model tools, the `tool:mission` prompt section, and the
 * `/mission` slash registration live in the `./tool` composition row
 * `@khorsheed/dsh-mission/tool`, so mounting this core must touch NEITHER
 * the tool registry NOR the system-prompt assembly NOR the command registry
 * NOR the plugin loader — the ctx below supplies none of them, so a stray
 * registration would throw instead of passing silently. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, Config, inject } from '../src/index.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('mission core faces', () => {
  it('mounts the service only, and registers NO slash command (A3: it lives in the companion row)', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-mission-core-'))
    roots.push(root)
    let slash = 0
    let pluginMounts = 0
    let provided: string | undefined
    const ctx = {
      provide: (name: string) => { provided = name },
      plugin: () => { pluginMounts += 1 },
      commands: { register: () => { slash += 1; return () => {} } },
    }
    apply(ctx as never, { dataDir: root })
    expect(provided).toBe('mission')
    expect(slash).toBe(0)
    expect(pluginMounts).toBe(0)
  })

  it('installs the datasets-backed layer probe on the service (the gated export\'s input), looked up per call', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-mission-core-'))
    roots.push(root)
    let service: { exportPlanGated: (r: unknown) => Promise<{ guardedLayers: string[] }>; create: (o: unknown) => Promise<unknown> } | undefined
    let datasets: unknown
    const ctx = {
      provide: (_name: string, value: never) => { service = value },
      get: (name: string) => (name === 'datasets' ? datasets : undefined),
    }
    apply(ctx as never, { dataDir: root })
    await service!.create({ id: 'm' })
    const request = { runId: 'default', outDir: join(root, 'o'), layers: ['answers'], snapshotDir: root, snapshot: { repo: '/r', commit: 'c', dataset: 'd' } }
    expect((await service!.exportPlanGated(request)).guardedLayers).toEqual([])
    datasets = { list: () => Promise.resolve({ dataset: { nonModelFacingLayers: ['answers'] } }) }
    expect((await service!.exportPlanGated(request)).guardedLayers).toEqual(['answers'])
  })

  it('injects nothing and takes no tool-group config', () => {
    // The command registry was the slash face's hard inject; with the
    // registration in the companion row the core mounts unconditionally.
    expect(inject).toEqual([])
    expect(new Config({} as never)).toEqual({ dataDir: '' })
  })
})
