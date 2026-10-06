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
  it('mounts exactly the four preset declarations, in PRESET_IDS order', () => {
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
    expect(presetBlock(patch, 'dataset-authoring')).toContain("        name: '题集整理'\n")
    expect(presetBlock(patch, 'dataset-authoring')).toContain('        order: 11\n')
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
    // Since the family fold, each delegation tool is its provider package's
    // `./tool` composition entry with self-defaulting config — the row ids are
    // unchanged and the rows carry NO config block.
    for (const [rowId, entry] of [
      ['tool-subagent-kimi', '@khorsheed/dsh-local-agent-kimi/tool'],
      ['tool-subagent-codex-local', '@khorsheed/dsh-local-agent-codex/tool'],
      ['tool-subagent-claude-code-local', '@khorsheed/dsh-local-agent-claude-code/tool'],
    ] as const) {
      expect(dev).toContain(`          - id: ${rowId}\n            name: '${entry}'\n`)
    }
    // Composition lines only — the block comment names the retired shared
    // package deliberately (provenance note).
    const rows = dev.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n')
    expect(rows).not.toContain('local-agent-tool-subagent')
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
    expect(block).toContain("            name: '@khorsheed/dsh-datasets/tool'\n")
    expect(block).toContain('            tools: authoring')
    expect(block).toContain('          - id: eval-tool\n')
    expect(block).toContain("            name: '@khorsheed/dsh-eval/tool'\n")
    expect(block).toContain('            tools: all')
  })

  it('dsh-writing: writer persona plus the 2026-09-30 minimal-inspired tool diet', () => {
    const block = presetBlock(patch, 'dsh-writing')
    // The writer identity stays — the diet adopts minimal's minimalism, never
    // its software-engineer persona.
    expect(block).toContain('You are a writer')
    expect(block).toContain('A Chinese sentence never takes a half-width comma or period')
    expect(block).not.toContain('coding agent powered by')
    // The writing surface that stays: shell, fs, skills, compaction, ask-user,
    // todo, web, canvas.
    for (const kept of [
      'tool-bash', 'tool-fs', 'skill-filesystem', 'tool-skill',
      'compaction-basic', 'tool-ask-user', 'tool-todo', 'tool-web',
    ]) {
      expect(block).toContain(`- id: ${kept}\n`)
    }
    expect(block).toContain('          - id: canvas-agent\n')
    expect(block).toContain("            name: '@khorsheed/dsh-canvas/agent'\n")
    // The 长篇小说 tools ride the same preset (bundle-writing's 写作 folded in, 2026-10-06).
    expect(block).toContain('          - id: canvas-novel-agent\n')
    expect(block).toContain("            name: '@khorsheed/dsh-canvas-novel/agent'\n")
    // The diet removals (row ids, not prose): the goal rows went 2026-09-29;
    // plan-mode, the delegation/workflow group, fs-search, jobs, present and
    // agent-instructions went 2026-09-30.
    for (const gone of [
      'command-goal', 'tool-goal', 'agent-instructions', 'tool-fs-search',
      'tool-jobs', 'plan-mode', 'delegation', 'tool-subagent-control',
      'tool-subagent', 'tool-subagent-fork', 'tool-subagent-codex',
      'tool-subagent-claude-code', 'workflow-ptc', 'tool-workflow',
      'tool-ralph', 'present',
    ]) {
      expect(block).not.toMatch(new RegExp(`- id: ${gone}\\n`))
    }
    // The canvas contract points at canvas_write + the canvas skill.
    expect(block).toContain('canvas_write')
    expect(block).toContain('Load the canvas skill')
    expect(block).not.toContain('canvas_propose_card')
  })

  // T100: the evaluation line runs on 3080 beside dev and writing, so the
  // evaluation surface must arrive ONLY through the presets that name it. Every
  // piece of it rides a companion tool row: the eval tools, /eval and the
  // eval-planning skill ride `@khorsheed/dsh-eval/tool`; the datasets tools,
  // /datasets and (organize tier) the dataset-authoring skill ride
  // `@khorsheed/dsh-datasets/tool`; the mission tools ride
  // `@khorsheed/dsh-mission/tool`. No row, no tool, no skill, no tab.
  describe('evaluation rows only where they belong (T100)', () => {
    const EVAL_FAMILY_ROWS = ['@khorsheed/dsh-datasets/tool', '@khorsheed/dsh-eval/tool', '@khorsheed/dsh-mission/tool']
    /** A preset's composition lines (comments dropped — provenance notes may name anything). */
    const rows = (id: string): string =>
      presetBlock(patch, id).split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n')

    for (const id of ['dev', 'dsh-writing']) {
      it(`${id} names no datasets / eval / mission row and no evaluation skill`, () => {
        const block = rows(id)
        for (const entry of EVAL_FAMILY_ROWS) expect(block).not.toContain(entry)
        expect(block).not.toMatch(/- id: (datasets|eval|mission)-tool\n/)
        expect(block).not.toContain('eval-planning')
        expect(block).not.toContain('dataset-authoring')
      })
    }

    it('dsh-eval names the datasets and eval rows (eval-planning rides the eval row)', () => {
      const block = rows('dsh-eval')
      expect(block).toContain("            name: '@khorsheed/dsh-datasets/tool'\n")
      expect(block).toContain("            name: '@khorsheed/dsh-eval/tool'\n")
      expect(block).toContain('          - id: skill-filesystem\n')
      expect(block).toContain('          - id: tool-skill\n')
    })

    it('dataset-authoring names the datasets row at the organize tier, and no eval row', () => {
      const block = rows('dataset-authoring')
      expect(block).toMatch(/ {10}- id: datasets-tool\n {12}name: '@khorsheed\/dsh-datasets\/tool'\n {12}config:\n {14}tools: organize/)
      expect(block).not.toContain('@khorsheed/dsh-eval/tool')
      expect(block).not.toContain('@khorsheed/dsh-mission/tool')
      // The skill the organize tier registers is loaded through tool-skill.
      expect(block).toContain('          - id: tool-skill\n')
      expect(block).toContain('Load the dataset-authoring skill')
    })
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
