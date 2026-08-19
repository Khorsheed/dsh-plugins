import { describe, expect, it } from 'vitest'
import { basename, selectTurnFiles } from '../src/client/turn-files.ts'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

describe('selectTurnFiles', () => {
  const owner = {} as TurnTailOwnerProps

  it('claims every turn unconditionally (the async shell decides visibility)', () => {
    expect(selectTurnFiles(owner)).toEqual([])
    // Even a no-data owner claims — the card mounts and its host fetch renders nothing.
    expect(selectTurnFiles(owner)).not.toBeNull()
  })
})

describe('basename', () => {
  it('returns the final path segment', () => {
    expect(basename('a/b/c.ts')).toBe('c.ts')
    expect(basename('a\\b\\c.ts')).toBe('c.ts')
    expect(basename('notes.md')).toBe('notes.md')
  })
})
