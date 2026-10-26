/**
 * dsh-eval's profile-local preset bundle (T82, host 0.2.0 and later).
 *
 * The `eval` agent preset is frozen decision 12's execution point, so its
 * composition is apparatus. T82 required the evaluation agent to carry no
 * shell; T102 (2026-10-06) folded dataset organizing into this preset and
 * rewrote the decision: the agent carries a shell, the docker socket still
 * belongs to the orchestrator alone, and that is no longer guaranteed by the
 * preset — a guard is decided after observing session logs. T82 moved it from the 0.1.5-era directory form
 * (`presets/eval/{agent.cordis.yml,preset.yml}`, copied into
 * `$DSH_HOME/.agent-presets/eval`) into a declarative bundle row, with the
 * requirement that the content stay byte-for-byte the directory version's.
 * The directory version is gone, so this spec pins the migrated bytes by
 * digest: an edit to the `plugins:` block is an edit to the apparatus and must
 * update the digest here on purpose (and open a new run), never silently.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PROFILE = join(import.meta.dirname, '..', 'profiles', 'eval')
const BUNDLE_DIR = join(PROFILE, 'presets')

/**
 * sha256 of the `plugins:` block. Was `presets/eval/agent.cordis.yml` at
 * 8fe63e72 (the last directory version, ee5e6f48…); T88 (the evaluation-family
 * fold) repointed the two tool rows' `name` from the retired companion packages
 * to `@khorsheed/dsh-datasets/tool` / `@khorsheed/dsh-eval/tool` — row ids,
 * config and the registered tools are unchanged, so only module resolution
 * moved (plus the two comment lines naming the mission row). T100 changed
 * COMMENT LINES ONLY (fbd218b8… before): the skills-section note no longer
 * says eval-planning arrives through `$DSH_HOME/skills` — it registers from
 * the eval-tool row now. The parsed composition is unchanged, which
 * eval-preset-parity.spec.ts states directly (comments dropped).
 *
 * T102 changed the COMPOSITION on purpose (8c11e96a… before): `tool-bash` /
 * `tool-pwsh` rows, `tool-web` with `fetch: true`, `datasets-tool` at the
 * `organize` tier (put_item plus the proposal-only
 * datasets_propose_registration, and the dataset-authoring skill), the merged
 * persona, and the comments that describe them. The 题集整理 row that followed
 * this one is gone, so the block now runs to the end of the file. A new
 * apparatus means a new run: results before and after this digest are not
 * comparable runs of one apparatus.
 *
 * host-021 (2026-10-17): the digest moved when the two dsh-tool-subagent rows
 * dropped `backgroundMode` — host 0.2.1 rejects the key outright (managed
 * activations are the only delegation mode). Same apparatus, new host line.
 * Moved again 2026-10-18: the persona prefix dropped its `{{cwd}}` sentence —
 * 0.2.1 removed that prompt variable (strict references fail the model request).
 * Moved again 2026-10-20, COMMENT LINES ONLY: the pack's directory and mirror
 * repo renamed (profiles/web-eval → profiles/eval, dsh-web-eval → dsh-eval);
 * one provenance comment inside the block carries the path. Same composition.
 * Moved again 2026-10-23, COMMENT LINES ONLY: 82813fc4 retired the mission
 * session tab and rewrote one provenance comment inside the block to say so.
 * Same composition (eval-preset-parity.spec.ts compares comments dropped).
 * Moved again 2026-10-27, COMMENT LINES ONLY: b7b2f877 (the local-agent card
 * settings store) rewrote the three-line `subagent_dsh` note inside the block —
 * the dsh settings toggle is gone and the tool is the package's `./tool` entry,
 * which this preset does not name. Same composition.
 */
const DIRECTORY_COMPOSITION_SHA = '0d19b749045f42930af0a70bf454b2e174c78437ad672f7b569626c2d0eb373f'

/**
 * The preset-eval row's `plugins:` block, de-indented back to the directory
 * file it came from. It ends where the next top-level row (or its leading
 * comment) begins, or at the end of the file — T90 appended
 * `preset-dataset-authoring` after it and T102 removed it again.
 */
function pluginsBlock(patch: string, row = 'preset-eval'): string {
  const lines = patch.split('\n')
  const start = lines.indexOf(`    - id: ${row}`)
  expect(start, `the bundle carries a ${row} row`).toBeGreaterThanOrEqual(0)
  const at = lines.indexOf('        plugins:', start)
  expect(at, `the ${row} row carries a \`plugins:\` key at row-config depth`).toBeGreaterThan(0)
  const next = lines.findIndex((line, index) => index > at && /^ {4}[-#]/.test(line))
  const end = next === -1 ? lines.length : next
  return lines.slice(at + 1, end).map(line => (line === '' ? '' : line.replace(/^ {10}/, ''))).join('\n')
}

describe('eval preset bundle', () => {
  const manifest = JSON.parse(readFileSync(join(BUNDLE_DIR, 'package.json'), 'utf8')) as {
    name: string
    private?: boolean
    files?: string[]
    dsh?: { bundle?: { patch?: string, kind?: string } }
  }
  const patch = readFileSync(join(BUNDLE_DIR, 'cordis.patch.yml'), 'utf8')
  const profile = JSON.parse(readFileSync(join(PROFILE, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
    dsh: { profile: { bundles: string[] } }
  }

  it('is a declarative preset bundle the profile installs from its own directory', () => {
    expect(manifest.dsh?.bundle).toEqual({ patch: './cordis.patch.yml', kind: 'preset-declarations' })
    expect(manifest.private).toBe(true)
    expect(manifest.files).toContain('cordis.patch.yml')
    expect(profile.dependencies[manifest.name]).toBe('file:presets')
    expect(profile.dsh.profile.bundles).toContain(manifest.name)
  })

  it('mounts one top-level row: preset-eval (id eval) — the 题集整理 row folded into it (T102)', () => {
    const topRows = patch.split('\n').filter(line => /^ {4}- id: /.test(line))
    expect(topRows).toEqual(['    - id: preset-eval'])
    expect(patch).toContain("      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: eval\n")
    expect(patch).toContain('        name: 评测模式\n')
    expect(patch).toContain('        description: 评测实例的 Agent：读题库、起草 plan 与 condition、读 bundle 写分析初稿，也把数据整理成题集并提交登记申请；运行与容器归编排器，登记归人。\n')
    expect(patch).toContain('        order: 0\n')
  })

  it('keeps the composition byte-identical to the pinned version', () => {
    const sha = createHash('sha256').update(pluginsBlock(patch)).digest('hex')
    expect(sha).toBe(DIRECTORY_COMPOSITION_SHA)
  })

  it('frozen decision 12 as T102 rewrote it: a shell, but no workflow engine, no ralph, no plan mode', () => {
    const block = pluginsBlock(patch)
    const names = [...block.matchAll(/^\s*name: '([^']+)'/gm)].map(m => m[1])
    expect(names).toContain('@deepseek-ai/dsh-tool-bash')
    expect(names).toContain('@deepseek-ai/dsh-tool-pwsh')
    for (const forbidden of ['@deepseek-ai/dsh-tool-workflow', '@deepseek-ai/dsh-workflow-ptc', '@deepseek-ai/dsh-tool-ralph', '@deepseek-ai/dsh-plan-mode']) {
      expect(names).not.toContain(forbidden)
    }
    // No container tool: `lab` registers none, and no row names it.
    expect(block).not.toMatch(/^\s*name: '[^']*(lab|docker)[^']*'/m)
  })

  it('one evaluation mode with both jobs: the organize tier, the eval tools, both skills\' doors (T102)', () => {
    const block = pluginsBlock(patch)
    expect(block).toMatch(/name: '@khorsheed\/dsh-datasets\/tool'\n {2}config:\n {4}tools: organize\b/)
    expect(block).toMatch(/name: '@khorsheed\/dsh-eval\/tool'\n {2}config:\n {4}tools: all\b/)
    expect(block).toContain("- id: tool-skill\n  name: '@deepseek-ai/dsh-tool-skill'")
    expect(block).toContain('Load the dataset-authoring skill before anything else')
    expect(block).toContain('Execution belongs to the deterministic orchestrator')
    expect(patch).not.toMatch(/^ {8}id: dataset-authoring$/m)
  })

  it('is the deployment default through the profile pin layer', () => {
    const pins = readFileSync(join(PROFILE, 'cordis.patch.yml'), 'utf8')
    expect(pins).toMatch(/^- id: agent-preset-registry\n {2}config:\n {4}default: eval\n/m)
    expect(pins).not.toMatch(/^- id: agent-presets$/m)
  })
})
