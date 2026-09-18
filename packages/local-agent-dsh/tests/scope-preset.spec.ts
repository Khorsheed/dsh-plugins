/**
 * T65 — the scope's own copy of a preset: the declaration that survives a
 * restart, the byte-for-byte snapshot, and the one composition shape a
 * factor may not have.
 *
 * What is pinned here is why the copy exists at all. The roster derives a
 * user root of `<$DSH_HOME>/.agent-presets` and the sub-dsh runs with
 * `DSH_HOME` pointed at the scoped home, so a copy THERE is resolved
 * identically on the host and inside an evaluation unit — which mounts the
 * scoped home and nothing else. A roster pointed at the deployment's preset
 * root instead resolves on the host and names a path the unit does not have.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  compositionAbsolutePaths, presetTreesEqual, provisionDshScope, readScopeSubProfile,
  readSubProfilePreset, SCOPE_SUB_PROFILE_FILENAME, snapshotScopePreset, USER_PRESET_DIR,
  writeScopeSubProfile,
} from '../src/provision.ts'

/** The form that travels: the skills root resolves relative to the composition. */
const RELOCATABLE = `- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    includeDefaultRoots: false
    customSkillDirs:
      - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"
`

/** The form pilot D shipped first: one machine's path, baked in. */
const ABSOLUTE = `- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - "/opt/dsh-lab/.agent-presets/eval-lean/skills"
`

function makeBundleDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bundle-'))
  writeFileSync(join(dir, 'cordis.patch.yml'), '- id: local-agent-dsh-headless-runner\n')
  return dir
}

/** A deployment preset root holding one preset. */
function presetRoot(id: string, options: { composition?: string; body?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-presets-'))
  const dir = join(root, id)
  mkdirSync(join(dir, 'skills', 'eval-planning'), { recursive: true })
  writeFileSync(join(dir, 'agent.cordis.yml'), options.composition ?? RELOCATABLE)
  writeFileSync(join(dir, 'preset.yml'), `name: ${id}\n`)
  writeFileSync(join(dir, 'skills', 'eval-planning', 'SKILL.md'), options.body ?? 'Draft the plan. One stage.\n')
  return root
}

const scopeHome = (): string => mkdtempSync(join(tmpdir(), 'dsh-scope-'))

describe('the scope\'s own sub-profile declaration', () => {
  it('round-trips the preset, and is idempotent', () => {
    const home = scopeHome()
    writeScopeSubProfile(home, { preset: 'eval-lean' })
    const first = readFileSync(join(home, SCOPE_SUB_PROFILE_FILENAME), 'utf8')
    writeScopeSubProfile(home, { preset: 'eval-lean' })
    expect(readFileSync(join(home, SCOPE_SUB_PROFILE_FILENAME), 'utf8')).toBe(first)
    expect(readScopeSubProfile(home)).toEqual({ preset: 'eval-lean' })
  })

  it('reads nothing usable from an absent file, junk, or a preset that is not a directory name', () => {
    expect(readScopeSubProfile(scopeHome())).toBeUndefined()
    const home = scopeHome()
    writeFileSync(join(home, SCOPE_SUB_PROFILE_FILENAME), '{not json')
    expect(readScopeSubProfile(home)).toBeUndefined()
    writeFileSync(join(home, SCOPE_SUB_PROFILE_FILENAME), JSON.stringify({ preset: '../escape' }))
    expect(readScopeSubProfile(home)).toBeUndefined()
  })
})

describe('compositionAbsolutePaths', () => {
  it('passes the loader expression the shipped cordis preset uses', () => {
    expect(compositionAbsolutePaths(RELOCATABLE)).toEqual([])
  })

  it('catches a plain absolute string', () => {
    expect(compositionAbsolutePaths(ABSOLUTE)).toEqual(['/opt/dsh-lab/.agent-presets/eval-lean/skills'])
  })

  it('catches an absolute path hidden inside an expression, without evaluating it', () => {
    const hidden = `- id: skill-filesystem
  config:
    customSkillDirs:
      - !!js "process.env.X ?? '/opt/presets/eval-lean/skills'"
`
    expect(compositionAbsolutePaths(hidden)).toEqual(['/opt/presets/eval-lean/skills'])
  })

  it('reports nothing for a composition it cannot parse — the loader decides that, not this reader', () => {
    expect(compositionAbsolutePaths('not: [a, list')).toEqual([])
  })
})

describe('snapshotScopePreset', () => {
  it('copies the deployment\'s preset into the scope, byte for byte', () => {
    const root = presetRoot('eval-lean')
    const home = scopeHome()
    const snapshot = snapshotScopePreset(home, root, 'eval-lean')
    expect(snapshot.copied).toBe(true)
    expect(snapshot.matchesSource).toBe(true)
    expect(snapshot.dir).toBe(join(home, USER_PRESET_DIR, 'eval-lean'))
    expect(presetTreesEqual(join(root, 'eval-lean'), snapshot.dir)).toBe(true)
    expect(readFileSync(join(snapshot.dir, 'skills/eval-planning/SKILL.md'), 'utf8')).toBe('Draft the plan. One stage.\n')
  })

  it('leaves an existing copy alone, and REPORTS the disagreement rather than healing it', () => {
    // Nothing may move the subject under a run: a scope whose copy drifted
    // from the deployment's is a fact the measurement has to see, not a file
    // to quietly overwrite.
    const root = presetRoot('eval-lean')
    const home = scopeHome()
    snapshotScopePreset(home, root, 'eval-lean')
    writeFileSync(join(root, 'eval-lean', 'skills/eval-planning/SKILL.md'), 'Draft the plan. TWO stages.\n')
    const second = snapshotScopePreset(home, root, 'eval-lean')
    expect(second.copied).toBe(false)
    expect(second.matchesSource).toBe(false)
    expect(readFileSync(join(second.dir, 'skills/eval-planning/SKILL.md'), 'utf8')).toBe('Draft the plan. One stage.\n')
  })

  it('re-syncs on refresh — the deliberate provision is where an edited preset is picked up', () => {
    const root = presetRoot('eval-lean')
    const home = scopeHome()
    snapshotScopePreset(home, root, 'eval-lean')
    writeFileSync(join(root, 'eval-lean', 'skills/eval-planning/SKILL.md'), 'Draft the plan. TWO stages.\n')
    const refreshed = snapshotScopePreset(home, root, 'eval-lean', { refresh: true })
    expect(refreshed.copied).toBe(true)
    expect(refreshed.matchesSource).toBe(true)
    expect(readFileSync(join(refreshed.dir, 'skills/eval-planning/SKILL.md'), 'utf8')).toBe('Draft the plan. TWO stages.\n')
  })

  it('a refresh that changes nothing writes nothing', () => {
    const root = presetRoot('eval-lean')
    const home = scopeHome()
    snapshotScopePreset(home, root, 'eval-lean')
    expect(snapshotScopePreset(home, root, 'eval-lean', { refresh: true }).copied).toBe(false)
  })

  it('refuses a preset whose composition names an absolute path, and names the idiom', () => {
    const root = presetRoot('eval-lean', { composition: ABSOLUTE })
    expect(() => snapshotScopePreset(scopeHome(), root, 'eval-lean'))
      .toThrow(/names absolute path\(s\) "\/opt\/dsh-lab.*baseUrl/s)
  })

  it('refuses a preset the deployment does not have', () => {
    expect(() => snapshotScopePreset(scopeHome(), presetRoot('eval-lean'), 'eval-full'))
      .toThrow(/no preset "eval-full"/)
  })

  it('refuses to copy a tree containing a symlink — it does not survive the bind mount', () => {
    const root = presetRoot('eval-lean')
    symlinkSync(join(root, 'eval-lean', 'preset.yml'), join(root, 'eval-lean', 'alias.yml'))
    expect(() => snapshotScopePreset(scopeHome(), root, 'eval-lean')).toThrow(/not a plain tree of files/)
  })
})

describe('provisionDshScope', () => {
  const bundle = (): { headlessBundleDir: string } => ({ headlessBundleDir: makeBundleDir() })

  it('composes the caller\'s preset, persists it, and rosters it with NO roots', () => {
    const root = presetRoot('eval-lean')
    const home = scopeHome()
    const provisioned = provisionDshScope(home, bundle(), { preset: 'eval-lean', presetRoot: root })
    expect(provisioned.preset).toBe('eval-lean')
    expect(provisioned.presetSnapshot).toEqual({ matchesSource: true })
    expect(readScopeSubProfile(home)).toEqual({ preset: 'eval-lean' })
    expect(readSubProfilePreset(home)).toBe('eval-lean')
    // The roster falls back to its own derived user root, which is the scope
    // on the host and the mount point inside a unit — one rule, both paths.
    const patch = readFileSync(join(home, 'profiles', 'headless-local-agent-dsh', 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('default: "eval-lean"')
    expect(patch).not.toContain('roots:')
  })

  it('reproduces the scope\'s preset with no options at all — the restart path', () => {
    // The registry re-provisions a scope the first time anything names it in
    // a fresh host process, and this module regenerates the patch WHOLE. A
    // roster that lived only in the patch would disappear right here.
    const root = presetRoot('eval-lean')
    const home = scopeHome()
    provisionDshScope(home, bundle(), { preset: 'eval-lean', presetRoot: root })
    const healed = provisionDshScope(home, bundle(), { presetRoot: root })
    expect(healed.preset).toBe('eval-lean')
    expect(readSubProfilePreset(home)).toBe('eval-lean')
  })

  it('the caller\'s preset outranks the scope\'s declaration, which outranks the deployment config', () => {
    const root = presetRoot('eval-lean')
    mkdirSync(join(root, 'eval-full', 'skills'), { recursive: true })
    writeFileSync(join(root, 'eval-full', 'agent.cordis.yml'), RELOCATABLE)
    const home = scopeHome()
    // deployment config alone
    expect(provisionDshScope(home, { ...bundle(), preset: { id: 'deployment-wide' } }, { presetRoot: root }).preset)
      .toBe('deployment-wide')
    // the scope's own declaration beats it
    writeScopeSubProfile(home, { preset: 'eval-lean' })
    expect(provisionDshScope(home, { ...bundle(), preset: { id: 'deployment-wide' } }, { presetRoot: root }).preset)
      .toBe('eval-lean')
    // and an explicit request beats that, and is persisted
    expect(provisionDshScope(home, { ...bundle(), preset: { id: 'deployment-wide' } }, { preset: 'eval-full', presetRoot: root }).preset)
      .toBe('eval-full')
    expect(readScopeSubProfile(home)).toEqual({ preset: 'eval-full' })
  })

  it('reports a copy that drifted from the deployment\'s, rather than measuring past it', () => {
    const root = presetRoot('eval-lean')
    const home = scopeHome()
    provisionDshScope(home, bundle(), { preset: 'eval-lean', presetRoot: root })
    writeFileSync(join(home, USER_PRESET_DIR, 'eval-lean', 'preset.yml'), 'name: tampered\n')
    expect(provisionDshScope(home, bundle(), { presetRoot: root }).presetSnapshot).toEqual({ matchesSource: false })
  })

  it('a scope that composes no preset is provisioned exactly as before: no copy, no declaration, no roster', () => {
    const home = scopeHome()
    const provisioned = provisionDshScope(home, bundle(), { presetRoot: presetRoot('eval-lean') })
    expect(provisioned.preset).toBeUndefined()
    expect(provisioned.presetSnapshot).toBeUndefined()
    expect(existsSync(join(home, USER_PRESET_DIR))).toBe(false)
    expect(existsSync(join(home, SCOPE_SUB_PROFILE_FILENAME))).toBe(false)
    expect(readFileSync(join(home, 'profiles', 'headless-local-agent-dsh', 'cordis.patch.yml'), 'utf8'))
      .toBe('- id: local-agent-dsh-headless-runner\n')
  })
})
