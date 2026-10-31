/** Inline-code file paths in a member's text become openers under its working directory. */
import { describe, expect, it, vi } from 'vitest'
import { looksLikeFilePath, memberPath, pathMentions } from '../src/client/path-mentions.ts'

describe('member path mentions', () => {
  it('reads path-shaped tokens with a file extension, never commands, URLs or identifiers', () => {
    expect(looksLikeFilePath('game-2/design/art-direction-comparison.png')).toBe(true)
    expect(looksLikeFilePath('game.json')).toBe(true)
    expect(looksLikeFilePath('npm run build')).toBe(false)
    expect(looksLikeFilePath('https://x.dev/a.png')).toBe(false)
    expect(looksLikeFilePath('window.dshGame')).toBe(false)
    expect(looksLikeFilePath('v1.2')).toBe(false)
  })

  it('resolves under the member\'s own cwd and opens that path', () => {
    expect(memberPath('a/b.png', '/home/user/game/')).toBe('/home/user/game/a/b.png')
    expect(memberPath('/abs/b.png', '/home/user/game')).toBe('/abs/b.png')
    expect(memberPath('a/b.png', undefined)).toBe('a/b.png')
    const open = vi.fn()
    const hit = pathMentions(open, '/home/user/game').resolve('./design/x.md')!
    expect(hit.title).toBe('/home/user/game/design/x.md')
    hit.open()
    expect(open).toHaveBeenCalledWith('/home/user/game/design/x.md')
    expect(pathMentions(open, undefined).resolve('ls -la')).toBeUndefined()
  })
})
