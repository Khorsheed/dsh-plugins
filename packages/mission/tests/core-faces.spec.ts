/** The core's remaining faces after the tool-row split (M4'③) and the
 * preset-visibility rollout (A3): the service and the Remote data face. The
 * model tools, the `tool:mission` prompt section, and the `/mission` slash
 * registration moved to the companion `@khorsheed/dsh-mission-tool`, so
 * mounting this core must touch NEITHER the tool registry NOR the
 * system-prompt assembly NOR the command registry — the ctx below supplies
 * none of them, so a stray registration would throw instead of passing
 * silently. */
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
  it('mounts the service and the Remote face, and registers NO slash command (A3: it moved to the companion row)', () => {
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
    expect(pluginMounts).toBe(1)
  })

  it('injects nothing and takes no tool-group config', () => {
    // The command registry was the slash face's hard inject; with the
    // registration in the companion row the core mounts unconditionally.
    expect(inject).toEqual([])
    expect(new Config({} as never)).toEqual({ dataDir: '' })
  })
})
