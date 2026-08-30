/** Tool origin tagging (AGENTS.md § Tool origin tagging; seam S12): every
 * model-visible tool this package registers carries the `dsh.tool.origin`
 * tag naming this package — the catalog's plugin section depends on it. */
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

const ORIGIN = Symbol.for('dsh.tool.origin')

describe('tool origin tagging', () => {
  it('tags every registered tool as plugin-owned by this package', () => {
    const registered: Record<symbol, unknown>[] = []
    const ctx = {
      provide: () => {},
      plugin: () => {},
      get: () => undefined,
      commands: { register: () => () => {} },
      tools: {
        register: (def: Record<symbol, unknown>) => {
          registered.push(def)
          return () => {}
        },
      },
    }
    // apply only stores the paths; no service method is called here.
    apply(ctx as never, { repo: '', worktreeRoot: '' })
    expect(registered.length).toBeGreaterThan(0)
    for (const def of registered) {
      expect(def[ORIGIN]).toEqual({ channel: 'plugin', owner: '@khorsheed/dsh-datasets' })
    }
  })
})
