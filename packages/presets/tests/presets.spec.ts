import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRESET_IDS } from '../src/index.ts'

const patch = readFileSync(join(import.meta.dirname, '..', 'cordis.patch.yml'), 'utf8')

/** Top-level loader rows of the patch (direct items of the `- insert:` list). */
function topLevelRowIds(text: string): string[] {
  return [...text.matchAll(/^    - id: (\S+)\s*$/gm)].map((m) => m[1]!)
}

/** The lines of one preset row's block, from `    - id: preset-<id>` to the next row. */
function presetBlock(text: string, id: string): string {
  const start = text.indexOf(`    - id: preset-${id}\n`)
  if (start === -1) throw new Error(`no preset row preset-${id}`)
  const rest = text.slice(start + 1)
  const next = rest.search(/^    - id: /m)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('cordis.patch.yml', () => {
  it('mounts exactly the three preset declarations, in PRESET_IDS order', () => {
    expect(topLevelRowIds(patch)).toEqual(PRESET_IDS.map((id) => `preset-${id}`))
    for (const id of PRESET_IDS) {
      const block = presetBlock(patch, id)
      expect(block).toContain("      name: '@deepseek-ai/dsh-agent-preset'\n")
      expect(block).toContain(`        id: ${id}\n`)
    }
  })

  it('quotes every name: value (@ is YAML-reserved)', () => {
    const unquoted = patch
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .filter((line) => /\bname:\s*/.test(line) && !/\bname:\s*['"]/.test(line))
    expect(unquoted).toEqual([])
  })

  it('carries the display fields migrated from the legacy preset.yml files', () => {
    expect(presetBlock(patch, 'dev')).toContain("        name: '开发模式'\n")
    expect(presetBlock(patch, 'dev')).toContain('        order: 10\n')
    expect(presetBlock(patch, 'dsh-eval')).toContain("        name: '评测模式'\n")
    expect(presetBlock(patch, 'dsh-eval')).toContain('        order: 0\n')
    expect(presetBlock(patch, 'dsh-writing')).toContain("        name: '写作模式'\n")
    expect(presetBlock(patch, 'dsh-writing')).not.toContain('        order:')
  })

  it('dev is rebased on the rc.1 standard preset (no 0.1.5 drift)', () => {
    const dev = presetBlock(patch, 'dev')
    // rc.1 standard rows the 0.1.5 copy lacked or pinned differently.
    expect(dev).toContain('          - id: workflow-ptc\n')
    expect(dev).toContain("            name: '@deepseek-ai/dsh-workflow-ptc'\n")
    expect(dev).toContain('          - id: tool-plugin-manager\n')
    expect(dev).toContain("            name: '@deepseek-ai/dsh-plugin-manager/tools'\n")
    expect(dev).toMatch(/ {14}- id: tool-ralph\n {16}name: '@deepseek-ai\/dsh-tool-ralph'\n {16}disabled: true\n/)
    // The renamed-away 0.1.5 package appears in no composition line (the
    // header comment documents the rename deliberately).
    const composition = patch.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n')
    expect(composition).not.toContain('workflow-worker-thread')
  })

  it('dev appends the live community tool rows verbatim', () => {
    const dev = presetBlock(patch, 'dev')
    expect(dev).toContain('          # ── dev mode: community tool rows granted per session')
    for (const [rowId, provider] of [
      ['tool-subagent-kimi', 'kimi-cli'],
      ['tool-subagent-codex-local', 'codex-local'],
      ['tool-subagent-claude-code-local', 'claude-local'],
    ] as const) {
      expect(dev).toContain(`          - id: ${rowId}\n`)
      expect(dev).toContain(`            provider: ${provider}\n`)
    }
    expect(dev).toContain('          - id: worktrees-tool\n')
    expect(dev).toContain("            name: '@khorsheed/dsh-worktrees/tool'\n")
    expect(dev).toContain('          - id: room-tool\n')
    expect(dev).toContain("            name: '@khorsheed/dsh-room/tool'\n")
    expect(dev).toContain('          - id: typesafe-tool\n')
    // The eval companion rows stay OUT of dev (their tabs self-hide by row presence).
    expect(dev).not.toContain('datasets-tool')
    expect(dev).not.toContain('eval-tool')
  })

  it('dsh-eval keeps its 0.1.5 composition (shell-less) with the two companion tool rows', () => {
    const block = presetBlock(patch, 'dsh-eval')
    expect(block).not.toContain('tool-bash')
    expect(block).not.toContain('tool-workflow')
    expect(block).not.toContain('plan-mode')
    expect(block).toContain('          - id: datasets-tool\n')
    expect(block).toContain("            name: '@khorsheed/dsh-datasets-tool'\n")
    expect(block).toContain('            tools: authoring')
    expect(block).toContain('          - id: eval-tool\n')
    expect(block).toContain("            name: '@khorsheed/dsh-eval-tool'\n")
    expect(block).toContain('            tools: all')
  })

  it('dsh-writing keeps its 0.1.5 composition with only the workflow-ptc rename', () => {
    const block = presetBlock(patch, 'dsh-writing')
    expect(block).toContain('          - id: workflow-ptc\n')
    expect(block).toContain("            name: '@deepseek-ai/dsh-workflow-ptc'\n")
    // tool-ralph stays enabled here (the writing preset's own decision; rc.1
    // standard disables it, but this preset was name-checked, not rebased).
    expect(block).toMatch(/ {14}- id: tool-ralph\n {16}name: '@deepseek-ai\/dsh-tool-ralph'\n {16}config:/)
    expect(block).toContain('          - id: canvas-agent\n')
    expect(block).toContain("            name: '@khorsheed/dsh-canvas/agent'\n")
  })

  it('references no community package outside dsh.references', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as {
      dsh: { references: string[] }
    }
    // A row may name a package's subpath composition entry
    // (`@khorsheed/dsh-canvas/agent`, `@khorsheed/dsh-worktrees/tool`): the
    // reference is the BASE package that ships the entry.
    const named = new Set(
      [...patch.matchAll(/^ {12}name: '(@khorsheed\/[a-z0-9-]+(?:\/[a-z0-9-]+)?)'/gm)]
        .map((m) => m[1]!.split('/').slice(0, 2).join('/')),
    )
    expect(named.size).toBeGreaterThan(0)
    for (const name of named) expect(manifest.dsh.references).toContain(name)
  })
})
