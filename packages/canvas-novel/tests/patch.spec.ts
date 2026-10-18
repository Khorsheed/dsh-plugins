/**
 * The shipped cordis.patch.yml's shape: the core row enabled and global
 * (the engine store), and the agent row also ENABLED at the profile root —
 * installing the package alone gives every session the agent surface (the
 * canvas ./agent precedent). The writing mode pack narrows the surface to
 * its own sessions by granting the same entry inside its preset composition
 * instead: under host 0.2.x the preset session's scoped copy shadows this
 * global row, so the two coexist with no double registration.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(join(import.meta.dirname, '..', 'cordis.patch.yml'), 'utf8')

/** Top-level loader rows of the patch (direct items of the `- insert:` list). */
function topLevelRowIds(text: string): string[] {
  return [...text.matchAll(/^    - id: (\S+)\s*$/gm)].map((m) => m[1]!)
}

describe('the shipped cordis.patch.yml (globally-enabled agent surface)', () => {
  it('mounts the core row and the agent row, both enabled, in order', () => {
    expect(topLevelRowIds(patch)).toEqual(['canvas-novel', 'canvas-novel-agent'])
    expect(patch).toContain('    - id: canvas-novel\n      name: "@khorsheed/dsh-canvas-novel"\n')
    expect(patch).toContain('    - id: canvas-novel-agent\n      name: "@khorsheed/dsh-canvas-novel/agent"\n')
    const content = patch.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n')
    expect(content).not.toContain('disabled: true')
  })

  it('quotes every name: value (@ is YAML-reserved)', () => {
    const unquoted = patch
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .filter((line) => /\bname:\s*/.test(line) && !/\bname:\s*['"]/.test(line))
    expect(unquoted).toEqual([])
  })

  it('documents the scoped shadowing (no double registration) and the mode-pack grant path', () => {
    const comments = patch.split('\n').filter((line) => line.trimStart().startsWith('#')).join('\n')
    expect(comments).toContain('@khorsheed/dsh-writing')
    expect(comments).toContain('@khorsheed/dsh-canvas-novel/agent')
    expect(comments).toContain('shadows')
  })
})
