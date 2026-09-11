/** The core's remaining faces after the tool-row split (M4'③): the service,
 * the slash command, and the Remote data face. The model tools and the
 * `tool:mission` prompt section moved to the companion
 * `@khorsheed/dsh-mission-tool`, so mounting this core must touch NEITHER the
 * tool registry NOR the system-prompt assembly — the ctx below supplies
 * neither, so a stray registration would throw instead of passing silently. */
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
  it('mounts the service, the slash command, and the Remote face without a tool registry', () => {
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
    expect(slash).toBe(1)
    expect(pluginMounts).toBe(1)
  })

  it('injects only the command registry and takes no tool-group config', () => {
    expect(inject).toEqual(['commands'])
    expect(new Config({} as never)).toEqual({ dataDir: '' })
  })
})
