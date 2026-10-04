/**
 * The bundle's declarative shape (the presets.spec.ts idiom): ONE
 * preset-declarations row named `@deepseek-ai/dsh-agent-preset` with the
 * loader id `preset-writing`; the grant names canvas-novel's `./agent` entry;
 * every community name rides in dsh.references; the persona stays light
 * (the workflow is the story skill's).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WRITING_PRESET_ID } from '../src/index.ts'

const patch = readFileSync(join(import.meta.dirname, '..', 'cordis.patch.yml'), 'utf8')

/** Top-level loader rows of the patch (direct items of the `- insert:` list). */
function topLevelRowIds(text: string): string[] {
  return [...text.matchAll(/^    - id: (\S+)\s*$/gm)].map((m) => m[1]!)
}

describe('cordis.patch.yml', () => {
  it('mounts exactly one preset declaration (preset-writing), and nothing else', () => {
    expect(topLevelRowIds(patch)).toEqual([`preset-${WRITING_PRESET_ID}`])
    expect(patch).toContain("      name: '@deepseek-ai/dsh-agent-preset'\n")
    expect(patch).toContain(`        id: ${WRITING_PRESET_ID}\n`)
    expect(patch).toContain("        name: '写作'\n")
  })

  it('quotes every name: value (@ is YAML-reserved)', () => {
    const unquoted = patch
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .filter((line) => /\bname:\s*/.test(line) && !/\bname:\s*['"]/.test(line))
    expect(unquoted).toEqual([])
  })

  it('grants the canvas-novel agent surface through the package subpath entry', () => {
    expect(patch).toContain('          - id: canvas-novel-agent\n')
    expect(patch).toContain("            name: '@khorsheed/dsh-canvas-novel/agent'\n")
    // The double-mount rule is documented (the shipped root row stays disabled).
    expect(patch).toContain('绝不能同时生效')
  })

  it('keeps the writing tool list tight: persona, fs, skills, ask-user, compaction, and nothing coding-shaped', () => {
    for (const kept of ['persona', 'tool-fs', 'skill-filesystem', 'tool-skill', 'tool-ask-user', 'compaction-basic']) {
      expect(patch).toContain(`- id: ${kept}\n`)
    }
    for (const gone of [
      'tool-bash', 'tool-pwsh', 'tool-fs-search', 'tool-jobs', 'plan-mode', 'tool-subagent',
      'tool-workflow', 'tool-goal', 'tool-web', 'tool-todo', 'canvas-agent', 'agent-instructions',
    ]) {
      expect(patch).not.toMatch(new RegExp(`- id: ${gone}\\n`))
    }
  })

  it('the persona names the assets rule and the story skill, and stays single-voice English', () => {
    expect(patch).toContain('You are a collaborative editor for long-form fiction.')
    expect(patch).toContain('story_* tools return')
    expect(patch).toContain('The story skill carries the')
    // Light by contract: the persona does not copy the skill's workflow sections.
    expect(patch).not.toContain('三条铁律')
    expect(patch).not.toContain('意图路由')
  })

  it('references every community package it names, and nothing more', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as {
      dsh: { references: string[] }
    }
    const named = new Set(
      [...patch.matchAll(/^ {12}name: '(@khorsheed\/[a-z0-9-]+(?:\/[a-z0-9-]+)?)'/gm)]
        .map((m) => m[1]!.split('/').slice(0, 2).join('/')),
    )
    expect(named.size).toBeGreaterThan(0)
    for (const name of named) expect(manifest.dsh.references).toContain(name)
    expect(manifest.dsh.references).toEqual(['@khorsheed/dsh-canvas-novel'])
  })

  it('declares the preset-declarations kind and no runtime of its own', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as {
      dsh: { bundle: { kind: string }; client?: unknown }
      dependencies?: Record<string, string>
    }
    expect(manifest.dsh.bundle.kind).toBe('preset-declarations')
    expect(manifest.dsh.client).toBeUndefined()
    // No npm edge onto canvas-novel: the entry resolves from the installing
    // profile's closure — installing this bundle alone must stay inert.
    expect(Object.keys(manifest.dependencies ?? {})).not.toContain('@khorsheed/dsh-canvas-novel')
  })
})
