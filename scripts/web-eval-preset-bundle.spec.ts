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

/** sha256 of `presets/eval/agent.cordis.yml` at 8fe63e72 (the last directory version). */
const DIRECTORY_COMPOSITION_SHA = 'ee5e6f48a183215fd89a95a8d102d5da943d07fc6294668786191de907a6aa72'

/** The `plugins:` block, de-indented back to the directory file it came from. */
function pluginsBlock(patch: string): string {
  const lines = patch.split('\n')
  const at = lines.indexOf('        plugins:')
  expect(at, 'the preset-eval row carries a `plugins:` key at row-config depth').toBeGreaterThan(0)
  return lines.slice(at + 1).map(line => (line === '' ? '' : line.replace(/^ {10}/, ''))).join('\n')
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

  it('mounts exactly one top-level row: preset-eval, id eval, with the directory version\'s display fields', () => {
    const topRows = patch.split('\n').filter(line => /^ {4}- id: /.test(line))
    expect(topRows).toEqual(['    - id: preset-eval'])
    expect(patch).toContain("      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: eval\n")
    expect(patch).toContain('        name: 评测模式\n')
    expect(patch).toContain('        description: 评测实例的规划与分析 Agent：读题库、起草 plan 与 condition、读 bundle 写分析初稿；不挂 Bash，不挂容器控制。\n')
    expect(patch).toContain('        order: 0\n')
  })

  it('keeps the composition byte-identical to the last directory version', () => {
    const sha = createHash('sha256').update(pluginsBlock(patch)).digest('hex')
    expect(sha).toBe(DIRECTORY_COMPOSITION_SHA)
  })

  it('carries no row that can run a host command (frozen decision 12)', () => {
    const names = [...pluginsBlock(patch).matchAll(/^\s*name: '([^']+)'/gm)].map(m => m[1])
    for (const forbidden of ['@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-pwsh', '@deepseek-ai/dsh-tool-workflow', '@deepseek-ai/dsh-workflow-ptc', '@deepseek-ai/dsh-tool-ralph', '@deepseek-ai/dsh-plan-mode']) {
      expect(names).not.toContain(forbidden)
    }
    expect(names).toContain('@khorsheed/dsh-datasets-tool')
    expect(names).toContain('@khorsheed/dsh-eval-tool')
  })

  it('is the deployment default through the profile pin layer', () => {
    const pins = readFileSync(join(PROFILE, 'cordis.patch.yml'), 'utf8')
    expect(pins).toMatch(/^- id: agent-preset-registry\n {2}config:\n {4}default: eval\n/m)
    expect(pins).not.toMatch(/^- id: agent-presets$/m)
  })
})
