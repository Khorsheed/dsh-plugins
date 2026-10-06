/**
 * The shipped cordis.patch.yml's shape: the core row enabled and global
 * (the engine store), the agent row present but DISABLED at
 * the profile root — the agent surface is granted by a preset (the
 * dsh-presets 写作模式 recipe), never by installing the package alone.
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
    expect(topLevelRowIds(patch)).toEqual(['canvas-novel', 'canvas-novel-agent'])
    expect(patch).toContain('    - id: canvas-novel\n      name: "@khorsheed/dsh-canvas-novel"\n')
    expect(patch).toContain('    - id: canvas-novel-agent\n      name: "@khorsheed/dsh-canvas-novel/agent"\n      disabled: true\n')
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
    expect(comments).toContain('@khorsheed/dsh-presets')
    expect(comments).toContain('@khorsheed/dsh-canvas-novel/agent')
    expect(comments).toContain('ONLY when no preset grants')
  })
})
