/**
 * T65/T91 — the scope's own copy of a preset package: the declaration that
 * survives a restart, the byte-for-byte snapshot, and the one composition
 * shape a factor may not have.
 *
 * What is pinned here is why the copy exists at all. On host 0.2.0 a preset
 * is an `@deepseek-ai/dsh-agent-preset` row in a bundle package's patch; the
 * sub-profile lists that package as a bundle and resolves it through a
 * RELATIVE link to `<scope>/preset-packages/<id>`, so the copy is resolved
 * identically on the host and inside an evaluation unit — which mounts the
 * scoped home and nothing else.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync as realpath, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  compositionAbsolutePaths, findPresetPackage, presetTreesEqual, provisionDshScope, readScopeSubProfile,
  readSubProfilePreset, SCOPE_PRESET_PACKAGES_DIR, SCOPE_SUB_PROFILE_FILENAME, snapshotScopePreset,
  writeScopeSubProfile,
} from '../src/provision.ts'

/** The skills-root expression that travels: the package's own dir, through baseUrl. */
const skillsExpr = (pkg: string): string =>
  `!!js "process.getBuiltinModule('node:path').join(process.getBuiltinModule('node:path').dirname(process.getBuiltinModule('node:module').createRequire(baseUrl).resolve('${pkg}/package.json')), 'skills')"`

/** A bundle patch declaring one preset row. */
const presetPatch = (id: string, skillsDir: string): string => `- insert:
    - id: preset-${id}
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: ${id}
        name: ${id}
        plugins:
          - id: skill-filesystem
            name: '@deepseek-ai/dsh-skill-filesystem'
            config:
              includeDefaultRoots: false
              customSkillDirs:
                - ${skillsDir}
`

/** The form pilot D shipped first: one machine's path, baked in. */
const ABSOLUTE = `- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    customSkillDirs:
      - "/opt/dsh-lab/.agent-presets/eval-lean/skills"
`

/** The 0.1.x relocatable form (still has no absolute path). */
const RELOCATABLE = `- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    includeDefaultRoots: false
    customSkillDirs:
      - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"
`

function makeBundleDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bundle-'))
  writeFileSync(join(dir, 'cordis.patch.yml'), '- id: local-agent-dsh-headless-runner\n')
  return dir
}

const pkgName = (id: string): string => `@dataseek-eval/preset-${id}`

/** Write one preset package's source directory. */
function writePresetPackage(dir: string, id: string, options: { patch?: string; body?: string } = {}): void {
  mkdirSync(join(dir, 'skills', 'eval-planning'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: pkgName(id), version: '0.0.0', private: true, dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, undefined, 2) + '\n')
  writeFileSync(join(dir, 'cordis.patch.yml'), options.patch ?? presetPatch(id, skillsExpr(pkgName(id))))
  writeFileSync(join(dir, 'skills', 'eval-planning', 'SKILL.md'), options.body ?? 'Draft the plan. One stage.\n')
}

/**
 * An instance profile directory whose direct dependencies include one
 * preset package per id — installed the way pnpm installs a `file:` dir: a
 * symlink in node_modules to the package's real directory.
 * @returns the profile dir and each package's source dir.
 */
function instanceProfile(ids: string[], options: { patch?: string } = {}): { profileDir: string; source: Record<string, string> } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-instance-'))
  const profileDir = join(root, 'profile')
  const source: Record<string, string> = {}
  const dependencies: Record<string, string> = { '@khorsheed/unrelated': 'file:x' }
  mkdirSync(join(profileDir, 'node_modules', '@dataseek-eval'), { recursive: true })
  for (const id of ids) {
    const dir = join(root, 'src', id)
    writePresetPackage(dir, id, options)
    symlinkSync(dir, join(profileDir, 'node_modules', '@dataseek-eval', `preset-${id}`))
    dependencies[pkgName(id)] = `file:${dir}`
    source[id] = dir
  }
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'dsh-profile-web-eval', dependencies }))
  return { profileDir, source }
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
  it('passes the package-relative expression the official web-app presets use', () => {
    expect(compositionAbsolutePaths(presetPatch('eval-lean', skillsExpr(pkgName('eval-lean'))))).toEqual([])
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

describe('findPresetPackage', () => {
  it('finds the direct dependency whose bundle patch declares the id, through the install symlink', () => {
    const { profileDir, source } = instanceProfile(['eval-lean', 'eval-full'])
    expect(findPresetPackage(profileDir, 'eval-lean')).toEqual({ name: pkgName('eval-lean'), dir: realpath(source['eval-lean']!) })
    expect(findPresetPackage(profileDir, 'eval-full')?.name).toBe(pkgName('eval-full'))
  })

  it('finds nothing for an id no package declares, or a profile with no manifest', () => {
    const { profileDir } = instanceProfile(['eval-lean'])
    expect(findPresetPackage(profileDir, 'eval-full')).toBeUndefined()
    expect(findPresetPackage(scopeHome(), 'eval-lean')).toBeUndefined()
  })
})

describe('snapshotScopePreset', () => {
  it('copies the instance\'s preset package into the scope, byte for byte', () => {
    const { profileDir, source } = instanceProfile(['eval-lean'])
    const home = scopeHome()
    const snapshot = snapshotScopePreset(home, profileDir, 'eval-lean')
    expect(snapshot.copied).toBe(true)
    expect(snapshot.matchesSource).toBe(true)
    expect(snapshot.packageName).toBe(pkgName('eval-lean'))
    expect(snapshot.dir).toBe(join(home, SCOPE_PRESET_PACKAGES_DIR, 'eval-lean'))
    expect(presetTreesEqual(source['eval-lean']!, snapshot.dir)).toBe(true)
    expect(readFileSync(join(snapshot.dir, 'skills/eval-planning/SKILL.md'), 'utf8')).toBe('Draft the plan. One stage.\n')
  })

  it('leaves an existing copy alone, and REPORTS the disagreement rather than healing it', () => {
    // Nothing may move the subject under a run: a scope whose copy drifted
    // from the instance's is a fact the measurement has to see, not a file
    // to quietly overwrite.
    const { profileDir, source } = instanceProfile(['eval-lean'])
    const home = scopeHome()
    snapshotScopePreset(home, profileDir, 'eval-lean')
    writeFileSync(join(source['eval-lean']!, 'skills/eval-planning/SKILL.md'), 'Draft the plan. TWO stages.\n')
    const second = snapshotScopePreset(home, profileDir, 'eval-lean')
    expect(second.copied).toBe(false)
    expect(second.matchesSource).toBe(false)
    expect(readFileSync(join(second.dir, 'skills/eval-planning/SKILL.md'), 'utf8')).toBe('Draft the plan. One stage.\n')
  })

  it('a healing call with no instance profile keeps the copy it has, reporting no match', () => {
    const { profileDir } = instanceProfile(['eval-lean'])
    const home = scopeHome()
    snapshotScopePreset(home, profileDir, 'eval-lean')
    const healed = snapshotScopePreset(home, undefined, 'eval-lean')
    expect(healed).toMatchObject({ copied: false, matchesSource: false, packageName: pkgName('eval-lean') })
  })

  it('re-syncs on refresh — the deliberate provision is where an edited preset is picked up', () => {
    const { profileDir, source } = instanceProfile(['eval-lean'])
    const home = scopeHome()
    snapshotScopePreset(home, profileDir, 'eval-lean')
    writeFileSync(join(source['eval-lean']!, 'skills/eval-planning/SKILL.md'), 'Draft the plan. TWO stages.\n')
    const refreshed = snapshotScopePreset(home, profileDir, 'eval-lean', { refresh: true })
    expect(refreshed.copied).toBe(true)
    expect(refreshed.matchesSource).toBe(true)
    expect(readFileSync(join(refreshed.dir, 'skills/eval-planning/SKILL.md'), 'utf8')).toBe('Draft the plan. TWO stages.\n')
  })

  it('a refresh that changes nothing writes nothing', () => {
    const { profileDir } = instanceProfile(['eval-lean'])
    const home = scopeHome()
    snapshotScopePreset(home, profileDir, 'eval-lean')
    expect(snapshotScopePreset(home, profileDir, 'eval-lean', { refresh: true }).copied).toBe(false)
  })

  it('refuses a preset package whose patch names an absolute path, and names the idiom', () => {
    const { profileDir } = instanceProfile(['eval-lean'], { patch: presetPatch('eval-lean', '"/opt/dsh-lab/presets/eval-lean/skills"') })
    expect(() => snapshotScopePreset(scopeHome(), profileDir, 'eval-lean'))
      .toThrow(/names absolute path\(s\) "\/opt\/dsh-lab.*baseUrl/s)
  })

  it('refuses a preset the instance does not have', () => {
    const { profileDir } = instanceProfile(['eval-lean'])
    expect(() => snapshotScopePreset(scopeHome(), profileDir, 'eval-full'))
      .toThrow(/declares preset "eval-full"/)
  })

  it('refuses to copy a tree containing a symlink — it does not survive the bind mount', () => {
    const { profileDir, source } = instanceProfile(['eval-lean'])
    symlinkSync(join(source['eval-lean']!, 'package.json'), join(source['eval-lean']!, 'alias.json'))
    expect(() => snapshotScopePreset(scopeHome(), profileDir, 'eval-lean')).toThrow(/not a plain tree of files/)
  })
})

describe('provisionDshScope', () => {
  const bundle = (): { headlessBundleDir: string } => ({ headlessBundleDir: makeBundleDir() })

  it('composes the caller\'s preset, persists it, and bundles the scope copy through a relative link', () => {
    const { profileDir } = instanceProfile(['eval-lean'])
    const home = scopeHome()
    const provisioned = provisionDshScope(home, bundle(), { preset: 'eval-lean', instanceProfileDir: profileDir })
    expect(provisioned.preset).toBe('eval-lean')
    expect(provisioned.presetSnapshot).toEqual({ matchesSource: true })
    expect(readScopeSubProfile(home)).toEqual({ preset: 'eval-lean' })
    expect(readSubProfilePreset(home)).toBe('eval-lean')
    const sub = join(home, 'profiles', 'headless-local-agent-dsh')
    const manifest = JSON.parse(readFileSync(join(sub, 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }
    expect(manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', pkgName('eval-lean')])
    expect(readlinkSync(join(sub, 'node_modules', '@dataseek-eval', 'preset-eval-lean'))).toBe('../../../../preset-packages/eval-lean')
    // and the link resolves to the copy
    expect(readFileSync(join(sub, 'node_modules', '@dataseek-eval', 'preset-eval-lean', 'skills/eval-planning/SKILL.md'), 'utf8'))
      .toBe('Draft the plan. One stage.\n')
  })

  it('reproduces the scope\'s preset with no options at all — the restart path', () => {
    // The registry re-provisions a scope the first time anything names it in
    // a fresh host process, and this module regenerates the patch WHOLE. A
    // preset that lived only in the patch would disappear right here.
    const { profileDir } = instanceProfile(['eval-lean'])
    const home = scopeHome()
    provisionDshScope(home, bundle(), { preset: 'eval-lean', instanceProfileDir: profileDir })
    const healed = provisionDshScope(home, bundle())
    expect(healed.preset).toBe('eval-lean')
    expect(readSubProfilePreset(home)).toBe('eval-lean')
  })

  it('the caller\'s preset outranks the scope\'s declaration, which outranks the deployment config', () => {
    const { profileDir } = instanceProfile(['eval-lean', 'eval-full'])
    const home = scopeHome()
    // deployment config alone
    expect(provisionDshScope(home, { ...bundle(), preset: { id: 'deployment-wide' } }, { instanceProfileDir: profileDir }).preset)
      .toBe('deployment-wide')
    // the scope's own declaration beats it
    writeScopeSubProfile(home, { preset: 'eval-lean' })
    expect(provisionDshScope(home, { ...bundle(), preset: { id: 'deployment-wide' } }, { instanceProfileDir: profileDir }).preset)
      .toBe('eval-lean')
    // and an explicit request beats that, and is persisted
    expect(provisionDshScope(home, { ...bundle(), preset: { id: 'deployment-wide' } }, { preset: 'eval-full', instanceProfileDir: profileDir }).preset)
      .toBe('eval-full')
    expect(readScopeSubProfile(home)).toEqual({ preset: 'eval-full' })
  })

  it('a failed request persists nothing — the scope keeps the declaration it had', () => {
    const { profileDir } = instanceProfile(['eval-lean'])
    const home = scopeHome()
    provisionDshScope(home, bundle(), { preset: 'eval-lean', instanceProfileDir: profileDir })
    expect(() => provisionDshScope(home, bundle(), { preset: 'eval-full', instanceProfileDir: profileDir })).toThrow(/eval-full/)
    expect(readScopeSubProfile(home)).toEqual({ preset: 'eval-lean' })
  })

  it('reports a copy that drifted from the instance\'s, rather than measuring past it', () => {
    const { profileDir } = instanceProfile(['eval-lean'])
    const home = scopeHome()
    provisionDshScope(home, bundle(), { preset: 'eval-lean', instanceProfileDir: profileDir })
    writeFileSync(join(home, SCOPE_PRESET_PACKAGES_DIR, 'eval-lean', 'skills/eval-planning/SKILL.md'), 'tampered\n')
    expect(provisionDshScope(home, bundle(), { instanceProfileDir: profileDir }).presetSnapshot).toEqual({ matchesSource: false })
  })

  it('a scope that composes no preset is provisioned exactly as before: no copy, no declaration, no preset layer', () => {
    const home = scopeHome()
    const provisioned = provisionDshScope(home, bundle(), { instanceProfileDir: instanceProfile(['eval-lean']).profileDir })
    expect(provisioned.preset).toBeUndefined()
    expect(provisioned.presetSnapshot).toBeUndefined()
    expect(existsSync(join(home, SCOPE_PRESET_PACKAGES_DIR))).toBe(false)
    expect(existsSync(join(home, SCOPE_SUB_PROFILE_FILENAME))).toBe(false)
    expect(readFileSync(join(home, 'profiles', 'headless-local-agent-dsh', 'cordis.patch.yml'), 'utf8'))
      .toBe('- id: local-agent-dsh-headless-runner\n')
  })
})
