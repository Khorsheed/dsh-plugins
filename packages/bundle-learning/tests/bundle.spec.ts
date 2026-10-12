/**
 * The bundle's declarative shape (the bundle-writing bundle.spec.ts idiom):
 * ONE preset-declarations row named `@deepseek-ai/dsh-agent-preset` with the
 * loader id `preset-learning`; the grant names library's `./tool` entry; every
 * community name rides in dsh.references; the persona stays light (the
 * mechanics are the library skill's).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LEARNING_PRESET_ID } from '../src/index.ts'

const patch = readFileSync(join(import.meta.dirname, '..', 'cordis.patch.yml'), 'utf8')

/** Top-level loader rows of the patch (direct items of the `- insert:` list). */
function topLevelRowIds(text: string): string[] {
  return [...text.matchAll(/^    - id: (\S+)\s*$/gm)].map((m) => m[1]!)
}

describe('cordis.patch.yml', () => {
  it('mounts exactly one preset declaration (preset-learning), and nothing else', () => {
    expect(topLevelRowIds(patch)).toEqual([`preset-${LEARNING_PRESET_ID}`])
    expect(patch).toContain("      name: '@deepseek-ai/dsh-agent-preset'\n")
    expect(patch).toContain(`        id: ${LEARNING_PRESET_ID}\n`)
    expect(patch).toContain("        name: '学习模式'\n")
    expect(patch).toContain('        order: 12\n')
  })

  it('quotes every name: value (@ is YAML-reserved)', () => {
    const unquoted = patch
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .filter((line) => /\bname:\s*/.test(line) && !/\bname:\s*['"]/.test(line))
    expect(unquoted).toEqual([])
  })

  it('grants the library agent surface through the package subpath entry, tools: all', () => {
    expect(patch).toContain('          - id: library-tool\n')
    expect(patch).toContain("            name: '@khorsheed/dsh-library/tool'\n")
    expect(patch).toContain('              tools: all\n')
    // The inert-without-the-core rule is documented.
    expect(patch).toContain('waiting for library')
  })

  it('keeps the learning tool list strict: persona, ask-user, web, whitelisted skills, a guarded shell, compaction — no fs, todo or delegation', () => {
    for (const kept of ['persona', 'tool-ask-user', 'tool-web', 'tool-skill', 'tool-bash', 'tool-pwsh', 'compaction-basic', 'library-tool']) {
      expect(patch).toContain(`- id: ${kept}\n`)
    }
    // skill-filesystem stays out on purpose: with no default-root provider the
    // registry holds only skills explicitly scoped to this preset (managed
    // delivery), so the skill face is a whitelist rather than every local skill.
    // The shell stays because the delegation path already gave the model a
    // looser one; the session sandbox + ask approval is the tighter boundary.
    for (const gone of [
      'tool-fs', 'skill-filesystem', 'tool-todo',
      'tool-fs-search', 'tool-jobs', 'plan-mode', 'tool-subagent',
      'tool-workflow', 'tool-goal', 'command-goal', 'tool-present', 'agent-instructions',
    ]) {
      expect(patch).not.toMatch(new RegExp(`- id: ${gone}\\n`))
    }
  })

  it('quiets the root sections and tool that do not apply to learning', () => {
    for (const section of ['harness:source', 'app:web-surface', 'ui:deliverable-file-references']) {
      expect(patch).toContain(`- '${section}'\n`)
    }
    expect(patch).toContain('- list_capabilities\n')
  })

  it('the persona names the coach stance, the tools-as-memory rule, the book-wins rule and the assess discipline', () => {
    expect(patch).toContain('You are a close-reading coach.')
    const flat = patch.replace(/\s+/g, ' ')
    expect(flat).toContain('a Socratic follow-up beats a summary')
    expect(flat).toContain('the library_* tools, never in conversation memory')
    expect(flat).toContain('Never invent what a book says')
    expect(patch).toContain('library_assess')
    // Light by contract: the persona does not copy the tool payload mechanics.
    expect(patch).not.toContain('chapterRanges')
    expect(patch).not.toContain('mergeInto')
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
    expect(manifest.dsh.references).toEqual(['@khorsheed/dsh-library'])
  })

  it('declares the preset-declarations kind and no runtime of its own', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as {
      dsh: { bundle: { kind: string }; client?: unknown }
      dependencies?: Record<string, string>
    }
    expect(manifest.dsh.bundle.kind).toBe('preset-declarations')
    expect(manifest.dsh.client).toBeUndefined()
    // No npm edge onto library: the entry resolves from the installing
    // profile's closure — installing this bundle alone must stay inert.
    expect(Object.keys(manifest.dependencies ?? {})).not.toContain('@khorsheed/dsh-library')
  })
})
