/**
 * dsh-web-eval's profile-local preset bundle (T82, host 0.2.0 and later).
 *
 * The `eval` agent preset is frozen decision 12's execution point — the
 * evaluation instance's agent carries no shell and no container controls — so
 * its composition is apparatus. T82 moved it from the 0.1.5-era directory form
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

const PROFILE = join(import.meta.dirname, '..', 'profiles', 'web-eval')
const BUNDLE_DIR = join(PROFILE, 'presets')

/**
 * sha256 of the `plugins:` block. Was `presets/eval/agent.cordis.yml` at
 * 8fe63e72 (the last directory version, ee5e6f48…); T88 (the evaluation-family
 * fold) repointed the two tool rows' `name` from the retired companion packages
 * to `@khorsheed/dsh-datasets/tool` / `@khorsheed/dsh-eval/tool` — row ids,
 * config and the registered tools are unchanged, so only module resolution
 * moved (plus the two comment lines naming the mission row).
 */
const DIRECTORY_COMPOSITION_SHA = 'fbd218b890b65422edf221dc7e084458917b2928783076cd028b024772d9d81b'

/**
 * The preset-eval row's `plugins:` block, de-indented back to the directory
 * file it came from. It ends where the next top-level row (or its leading
 * comment) begins — T90 appended `preset-dataset-authoring` after it, and the
 * blank separator line keeps the bytes identical to the end-of-file slice.
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

describe('web-eval preset bundle', () => {
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

  it('mounts two top-level rows: preset-eval (id eval, the directory version\'s display fields) and preset-dataset-authoring', () => {
    const topRows = patch.split('\n').filter(line => /^ {4}- id: /.test(line))
    expect(topRows).toEqual(['    - id: preset-eval', '    - id: preset-dataset-authoring'])
    expect(patch).toContain("      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: eval\n")
    expect(patch).toContain('        name: 评测模式\n')
    expect(patch).toContain('        description: 评测实例的规划与分析 Agent：读题库、起草 plan 与 condition、读 bundle 写分析初稿；不挂 Bash，不挂容器控制。\n')
    expect(patch).toContain('        order: 0\n')
  })

  it('keeps the composition byte-identical to the pinned version', () => {
    const sha = createHash('sha256').update(pluginsBlock(patch)).digest('hex')
    expect(sha).toBe(DIRECTORY_COMPOSITION_SHA)
  })

  it('carries no row that can run a host command (frozen decision 12)', () => {
    const names = [...pluginsBlock(patch).matchAll(/^\s*name: '([^']+)'/gm)].map(m => m[1])
    for (const forbidden of ['@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-pwsh', '@deepseek-ai/dsh-tool-workflow', '@deepseek-ai/dsh-workflow-ptc', '@deepseek-ai/dsh-tool-ralph', '@deepseek-ai/dsh-plan-mode']) {
      expect(names).not.toContain(forbidden)
    }
    expect(names).toContain('@khorsheed/dsh-datasets/tool')
    expect(names).toContain('@khorsheed/dsh-eval/tool')
  })

  it('gives the 题集整理 session its own preset: the organize tier, a shell, no eval tools (T90, decision B)', () => {
    const block = pluginsBlock(patch, 'preset-dataset-authoring')
    expect(patch).toContain("      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: dataset-authoring\n")
    const names = [...block.matchAll(/^\s*name: '([^']+)'/gm)].map(m => m[1])
    expect(names).toContain('@deepseek-ai/dsh-tool-bash')
    expect(names).toContain('@deepseek-ai/dsh-tool-skill')
    expect(names).not.toContain('@khorsheed/dsh-eval/tool')
    expect(block).toMatch(/name: '@khorsheed\/dsh-datasets\/tool'\n {2}config:\n {4}tools: organize\b/)
  })

  it('is the deployment default through the profile pin layer', () => {
    const pins = readFileSync(join(PROFILE, 'cordis.patch.yml'), 'utf8')
    expect(pins).toMatch(/^- id: agent-preset-registry\n {2}config:\n {4}default: eval\n/m)
    expect(pins).not.toMatch(/^- id: agent-presets$/m)
  })
})
