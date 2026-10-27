/** Tool origin tagging (AGENTS.md § Tool origin tagging; seam S12): this
 * package's `./agent` row registers the game tools itself (there is no
 * companion tool row), so `gameToolDefinitions` bakes the attribution in at
 * construction — every definition it returns carries this package's origin. */
import { describe, expect, it } from 'vitest'
import type { GameService } from '../src/store.ts'
import { gameToolDefinitions } from '../src/tools.ts'

const ORIGIN = Symbol.for('dsh.tool.origin')

describe('tool origin tagging', () => {
  it('tags every game tool with this package as its owner', () => {
    const definitions = gameToolDefinitions({} as GameService)
    expect(definitions.map(definition => definition.name)).toEqual(['game_open', 'game_read', 'game_propose', 'game_publish', 'game_show'])
    for (const definition of definitions) {
      expect((definition as Record<symbol, unknown>)[ORIGIN]).toEqual({ channel: 'plugin', owner: '@khorsheed/dsh-game' })
    }
  })
})
