/** Tool origin tagging (AGENTS.md § Tool origin tagging; seam S12): the core's
 * definition factory leaves every tool untagged — the tag names the MOUNTING
 * package, so it belongs to the companion `@khorsheed/dsh-datasets-tool` (that
 * package's spec carries the positive assertion). */
import { describe, expect, it } from 'vitest'
import { datasetToolDefinitions } from '../src/tool.ts'

const ORIGIN = Symbol.for('dsh.tool.origin')

describe('tool origin tagging', () => {
  it('leaves every definition untagged, delegating attribution to the companion row', () => {
    const definitions = datasetToolDefinitions({} as never, { group: 'all' })
    expect(definitions.length).toBeGreaterThan(0)
    for (const definition of definitions) {
      expect((definition as Record<symbol, unknown>)[ORIGIN]).toBeUndefined()
    }
  })
})
