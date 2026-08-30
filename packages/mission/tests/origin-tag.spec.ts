/** Tool origin tagging (AGENTS.md § Tool origin tagging; seam S12): every
 * model-visible tool this package registers carries the `dsh.tool.origin`
 * tag naming this package — the catalog's plugin section depends on it. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

const ORIGIN = Symbol.for('dsh.tool.origin')
let root: string | undefined
afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
})

describe('tool origin tagging', () => {
  it('tags every registered tool as plugin-owned by this package', () => {
    root = mkdtempSync(join(tmpdir(), 'dsh-mission-origin-'))
    const registered: Record<symbol, unknown>[] = []
    const ctx = {
      provide: () => {},
      plugin: () => {},
      commands: { register: () => () => {} },
      systemPrompt: { section: () => {} },
      tools: {
        register: (def: Record<symbol, unknown>) => {
          registered.push(def)
          return () => {}
        },
      },
    }
    apply(ctx as never, { dataDir: root } as never)
    expect(registered.length).toBeGreaterThan(0)
    for (const def of registered) {
      expect(def[ORIGIN]).toEqual({ channel: 'plugin', owner: '@khorsheed/dsh-mission' })
    }
  })
})
