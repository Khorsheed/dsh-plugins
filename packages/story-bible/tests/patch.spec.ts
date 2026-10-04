/**
 * The shipped cordis.patch.yml's shape: the core row enabled and global
 * (store + Remote + the two tabs), the agent row present but DISABLED at
 * the profile root — the agent surface is granted by a preset (the
 * bundle-writing recipe), never by installing the package alone.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(join(import.meta.dirname, '..', 'cordis.patch.yml'), 'utf8')

/** Top-level loader rows of the patch (direct items of the `- insert:` list). */
function topLevelRowIds(text: string): string[] {
  return [...text.matchAll(/^    - id: (\S+)\s*$/gm)].map((m) => m[1]!)
}

describe('the shipped cordis.patch.yml (preset-granted agent surface)', () => {
  it('mounts the core row (enabled) and the agent row (disabled at the root), in order', () => {
    expect(topLevelRowIds(patch)).toEqual(['story-bible', 'story-bible-agent'])
    expect(patch).toContain('    - id: story-bible\n      name: "@khorsheed/dsh-story-bible"\n')
    expect(patch).toContain('    - id: story-bible-agent\n      name: "@khorsheed/dsh-story-bible/agent"\n      disabled: true\n')
  })

  it('quotes every name: value (@ is YAML-reserved)', () => {
    const unquoted = patch
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .filter((line) => /\bname:\s*/.test(line) && !/\bname:\s*['"]/.test(line))
    expect(unquoted).toEqual([])
  })

  it('documents the two live-at-once failure (double registration) and the grant paths', () => {
    const comments = patch.split('\n').filter((line) => line.trimStart().startsWith('#')).join('\n')
    expect(comments).toContain('@khorsheed/dsh-bundle-writing')
    expect(comments).toContain('@khorsheed/dsh-story-bible/agent')
    expect(comments).toContain('ONLY when no preset grants')
  })
})
