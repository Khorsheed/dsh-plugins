/**
 * Sub-profile provisioning: idempotent manifest + headless patch layer +
 * bundle symlink under the harness scoped home, with no pnpm install.
 */

import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SUB_PROFILE_NAME, permissionBoundaryLayer, presetRegistryLayer, provisionDshSubProfile,
  readSubProfilePermissions, readSubProfilePreset, resolveHeadlessBundleDir, unitSubProfileName,
} from '../src/provision.ts'

/** A stand-in headless bundle directory carrying a patch to provision. */
function makeBundleDir(patch: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bundle-'))
  writeFileSync(join(dir, 'cordis.patch.yml'), patch)
  return dir
}

describe('dsh sub-profile provisioning', () => {
  it('writes the manifest, the headless patch as the user layer, and a symlink resolving the headless bundle', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    const profileDir = provisionDshSubProfile(home, { headlessBundleDir: bundleDir })
    expect(profileDir).toBe(join(home, 'profiles', DEFAULT_SUB_PROFILE_NAME))
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(manifest.dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base'])
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toBe('- id: local-agent-dsh-headless-runner\n')
    const link = join(profileDir, 'node_modules', '@khorsheed', 'dsh-local-agent-dsh-headless')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(bundleDir)
  })

  it('is idempotent: a second run leaves the files untouched', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    provisionDshSubProfile(home, { headlessBundleDir: bundleDir })
    const profileDir = join(home, 'profiles', DEFAULT_SUB_PROFILE_NAME)
    const firstManifest = readFileSync(join(profileDir, 'package.json'), 'utf8')
    const firstPatch = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
    provisionDshSubProfile(home, { headlessBundleDir: bundleDir })
    expect(readFileSync(join(profileDir, 'package.json'), 'utf8')).toBe(firstManifest)
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toBe(firstPatch)
  })

  it('re-provisions an upgraded bundle: changed patch content and a stale manifest are rewritten', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    provisionDshSubProfile(home, { headlessBundleDir: bundleDir })
    // An upgrade ships a new patch, and the profile predates the T6 scheme
    // (manifest still lists the headless bundle as a layer, patch layer empty).
    writeFileSync(join(bundleDir, 'cordis.patch.yml'), '- id: local-agent-dsh-headless-runner\n  disabled: true\n')
    provisionDshSubProfile(home, { headlessBundleDir: bundleDir })
    const profileDir = join(home, 'profiles', DEFAULT_SUB_PROFILE_NAME)
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8'))
      .toBe('- id: local-agent-dsh-headless-runner\n  disabled: true\n')
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(manifest.dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base'])
  })

  it('replaces a dangling symlink pointing elsewhere', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    const staleDir = mkdtempSync(join(tmpdir(), 'dsh-stale-'))
    const link = join(home, 'profiles', DEFAULT_SUB_PROFILE_NAME, 'node_modules', '@khorsheed', 'dsh-local-agent-dsh-headless')
    // Pre-create a wrong symlink (a drift from a moved bundle dir).
    const { mkdirSync, symlinkSync } = require('node:fs') as typeof import('node:fs')
    mkdirSync(join(home, 'profiles', DEFAULT_SUB_PROFILE_NAME, 'node_modules', '@khorsheed'), { recursive: true })
    symlinkSync(staleDir, link)
    provisionDshSubProfile(home, { headlessBundleDir: bundleDir })
    expect(readlinkSync(link)).toBe(bundleDir)
  })

  it('resolves the headless bundle from the package installation', () => {
    const dir = resolveHeadlessBundleDir()
    expect(existsSync(join(dir, 'package.json'))).toBe(true)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string }
    expect(manifest.name).toBe('@khorsheed/dsh-local-agent-dsh-headless')
  })

  it('writes no preset layer when the scope names no preset', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    const profileDir = provisionDshSubProfile(home, { headlessBundleDir: bundleDir })
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toBe('- id: local-agent-dsh-headless-runner\n')
    expect(readSubProfilePreset(home)).toBeUndefined()
  })
})

describe('preset registry layer', () => {
  it('appends an insert operation naming the 0.2.0 registry and the default preset', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    const profileDir = provisionDshSubProfile(home, { headlessBundleDir: bundleDir, preset: { id: 'eval-lean' } })
    const patch = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
    // The bundle's own list survives untouched ahead of the appended layer.
    expect(patch.startsWith('- id: local-agent-dsh-headless-runner\n')).toBe(true)
    expect(patch).toContain("      name: '@deepseek-ai/dsh-agent-preset-registry'")
    // The 0.1.x roster module is gone from 0.2.0; nothing may name it.
    expect(patch).not.toContain('dsh-agent-presets')
    expect(patch).toContain('        default: "eval-lean"')
    expect(readSubProfilePreset(home)).toBe('eval-lean')
  })

  it('two scopes differing only in preset produce two different patches', () => {
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    const a = mkdtempSync(join(tmpdir(), 'dsh-scope-a-'))
    const b = mkdtempSync(join(tmpdir(), 'dsh-scope-b-'))
    provisionDshSubProfile(a, { headlessBundleDir: bundleDir, preset: { id: 'eval-lean' } })
    provisionDshSubProfile(b, { headlessBundleDir: bundleDir, preset: { id: 'eval-full' } })
    const patchA = readFileSync(join(a, 'profiles', DEFAULT_SUB_PROFILE_NAME, 'cordis.patch.yml'), 'utf8')
    const patchB = readFileSync(join(b, 'profiles', DEFAULT_SUB_PROFILE_NAME, 'cordis.patch.yml'), 'utf8')
    expect(patchA).not.toBe(patchB)
    expect(readSubProfilePreset(a)).toBe('eval-lean')
    expect(readSubProfilePreset(b)).toBe('eval-full')
  })

  it('lists the declaring package as a bundle and links it RELATIVELY to the scope copy', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    const profileDir = provisionDshSubProfile(home, {
      headlessBundleDir: bundleDir,
      preset: { id: 'eval-lean', package: '@dataseek-eval/preset-eval-lean' },
    })
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(manifest.dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base', '@dataseek-eval/preset-eval-lean'])
    const link = join(profileDir, 'node_modules', '@dataseek-eval', 'preset-eval-lean')
    // Relative: the scope is bind-mounted at a different absolute path in a unit.
    expect(readlinkSync(link)).toBe('../../../../preset-packages/eval-lean')
  })

  it('refuses a package name that is not an npm name', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    expect(() => provisionDshSubProfile(home, { headlessBundleDir: bundleDir, preset: { id: 'eval-lean', package: '../escape' } }))
      .toThrow(/not an npm package name/)
  })

  it('refuses a preset id that is not a directory name', () => {
    expect(() => presetRegistryLayer({ id: '../escape' })).toThrow(/must match/)
    expect(() => presetRegistryLayer({ id: 'Eval Lean' })).toThrow(/must match/)
  })

  it('re-provisioning drops the layer again when the preset is withdrawn', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    provisionDshSubProfile(home, { headlessBundleDir: bundleDir, preset: { id: 'eval-lean' } })
    expect(readSubProfilePreset(home)).toBe('eval-lean')
    provisionDshSubProfile(home, { headlessBundleDir: bundleDir })
    expect(readSubProfilePreset(home)).toBeUndefined()
  })

  it('is idempotent with a preset, and links NO copy of the registry module', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    const profileDir = provisionDshSubProfile(home, { headlessBundleDir: bundleDir, preset: { id: 'eval-lean' } })
    const first = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
    provisionDshSubProfile(home, { headlessBundleDir: bundleDir, preset: { id: 'eval-lean' } })
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toBe(first)
    // The registry is an OFFICIAL package: it resolves from the dsh
    // installation anchor beside @deepseek-ai/dsh-base. A linked second copy
    // would drag in a second @deepseek-ai/cordis, and cordis keys services by
    // instance identity — the symptom would be silently missing services.
    expect(existsSync(join(profileDir, 'node_modules', '@deepseek-ai'))).toBe(false)
    // The headless bundle IS linked: it is a @khorsheed package the dsh
    // installation does not carry.
    expect(lstatSync(join(profileDir, 'node_modules', '@khorsheed', 'dsh-local-agent-dsh-headless')).isSymbolicLink()).toBe(true)
  })
})

describe('permission boundary layer', () => {
  it('writes no layer at all when the deployment pins no boundary', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    const profileDir = provisionDshSubProfile(home, { headlessBundleDir: bundleDir })
    // Byte for byte the bundle's own patch: dsh-base's workspace-write + ask
    // survive untouched, which is the pre-T59 behavior every host scope keeps.
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toBe('- id: local-agent-dsh-headless-runner\n')
    expect(permissionBoundaryLayer(undefined)).toBe('')
    expect(readSubProfilePermissions(home)).toBeUndefined()
  })

  it('pins both rows — sandbox mode and the approval policy its preset pairs with', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    const profileDir = provisionDshSubProfile(home, {
      headlessBundleDir: bundleDir,
      permissions: 'danger-full-access',
    })
    const patch = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
    expect(patch.startsWith('- id: local-agent-dsh-headless-runner\n')).toBe(true)
    expect(patch).toContain("  name: '@deepseek-ai/dsh-sandbox-policy'")
    expect(patch).toContain('    mode: danger-full-access')
    expect(patch).toContain("  name: '@deepseek-ai/dsh-user-approval'")
    // Escalating past a denied call needs an approval channel a headless
    // sub-dsh does not have; the pair moves together or the boundary is a
    // sandbox nobody can run inside and nobody can be asked about.
    expect(patch).toContain('    policy: never')
    expect(readSubProfilePermissions(home)).toBe('danger-full-access')
  })

  it('a confining preset keeps ask — the pairing comes from dsh-base own table', () => {
    for (const mode of ['read-only', 'workspace-write'] as const) {
      const layer = permissionBoundaryLayer(mode)
      expect(layer).toContain(`    mode: ${mode}`)
      expect(layer).toContain('    policy: ask')
    }
  })

  it('re-states workspaceRoot, because a patch config REPLACES rather than merges', () => {
    expect(permissionBoundaryLayer('workspace-write')).toContain('    workspaceRoot: !!js process.cwd()')
  })

  it('refuses a mode outside dsh own three-word vocabulary', () => {
    expect(() => permissionBoundaryLayer('unrestricted' as never)).toThrow(/must be one of/)
  })

  it('stacks after the preset layer, and both layers survive together', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    const profileDir = provisionDshSubProfile(home, {
      headlessBundleDir: bundleDir,
      preset: { id: 'eval-lean' },
      permissions: 'danger-full-access',
    })
    const patch = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
    expect(patch.indexOf("'@deepseek-ai/dsh-agent-preset-registry'")).toBeLessThan(patch.indexOf("'@deepseek-ai/dsh-sandbox-policy'"))
    expect(readSubProfilePreset(home)).toBe('eval-lean')
    expect(readSubProfilePermissions(home)).toBe('danger-full-access')
  })

  it('is idempotent, and re-provisioning drops the layer again when the pin is withdrawn', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    provisionDshSubProfile(home, { headlessBundleDir: bundleDir, permissions: 'danger-full-access' })
    const patchPath = join(home, 'profiles', DEFAULT_SUB_PROFILE_NAME, 'cordis.patch.yml')
    const first = readFileSync(patchPath, 'utf8')
    provisionDshSubProfile(home, { headlessBundleDir: bundleDir, permissions: 'danger-full-access' })
    expect(readFileSync(patchPath, 'utf8')).toBe(first)
    provisionDshSubProfile(home, { headlessBundleDir: bundleDir })
    expect(readSubProfilePermissions(home)).toBeUndefined()
  })

  it('reads back nothing from a sub-profile that was never provisioned', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    expect(readSubProfilePermissions(home)).toBeUndefined()
  })
})

describe('evaluation-unit twin profile', () => {
  it('writes no twin, and container rounds share the one profile, when unitHeadlessBundleDir is absent', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    provisionDshSubProfile(home, { headlessBundleDir: bundleDir })
    expect(existsSync(join(home, 'profiles', `${DEFAULT_SUB_PROFILE_NAME}-unit`))).toBe(false)
    expect(unitSubProfileName({})).toBe(DEFAULT_SUB_PROFILE_NAME)
  })

  it('writes a -unit twin linking the image headless, identical otherwise', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    // A path this machine cannot read (the image's install).
    const unitDir = join(mkdtempSync(join(tmpdir(), 'dsh-unit-')), 'absent', 'dsh-local-agent-dsh-headless')
    const config = {
      headlessBundleDir: bundleDir,
      unitHeadlessBundleDir: unitDir,
      preset: { id: 'eval-lean', package: '@dataseek-eval/preset-eval-lean' },
      permissions: 'danger-full-access' as const,
    }
    // The unit's bundle dir does not exist on the host; the twin's patch is
    // the HOST bundle's (the same file the image ships) — only the link moves.
    const hostDir = provisionDshSubProfile(home, config)
    expect(unitSubProfileName(config)).toBe(`${DEFAULT_SUB_PROFILE_NAME}-unit`)
    const twin = join(home, 'profiles', unitSubProfileName(config))
    expect(readlinkSync(join(twin, 'node_modules', '@khorsheed', 'dsh-local-agent-dsh-headless'))).toBe(unitDir)
    // The host profile COPIES its bundle (host 0.2.0 linked-root routing).
    const hostBundle = join(hostDir, 'node_modules', '@khorsheed', 'dsh-local-agent-dsh-headless')
    expect(lstatSync(hostBundle).isDirectory()).toBe(true)
    expect(readFileSync(join(hostBundle, 'cordis.patch.yml'), 'utf8')).toBe('- id: local-agent-dsh-headless-runner\n')
    expect(readFileSync(join(twin, 'cordis.patch.yml'), 'utf8')).toBe(readFileSync(join(hostDir, 'cordis.patch.yml'), 'utf8'))
    expect(readSubProfilePreset(home, unitSubProfileName(config))).toBe('eval-lean')
    expect(readlinkSync(join(twin, 'node_modules', '@dataseek-eval', 'preset-eval-lean'))).toBe('../../../../preset-packages/eval-lean')
  })
  it('takes the twin patch from the unit bundle when this machine mirrors it', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    const unitDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n  # image line\n')
    provisionDshSubProfile(home, { headlessBundleDir: bundleDir, unitHeadlessBundleDir: unitDir })
    expect(readFileSync(join(home, 'profiles', `${DEFAULT_SUB_PROFILE_NAME}-unit`, 'cordis.patch.yml'), 'utf8'))
      .toBe('- id: local-agent-dsh-headless-runner\n  # image line\n')
  })
})

describe('host profile headless bundle copy (host 0.2.0 linked-root routing)', () => {
  const twinOf = (): string => join(mkdtempSync(join(tmpdir(), 'dsh-unit-')), 'absent')

  it('refreshes the copy when the installed bundle changes, and drops files it no longer ships', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    mkdirSync(join(bundleDir, 'lib'))
    writeFileSync(join(bundleDir, 'lib', 'index.js'), 'v1')
    writeFileSync(join(bundleDir, 'lib', 'old.js'), 'gone soon')
    const config = { headlessBundleDir: bundleDir, unitHeadlessBundleDir: twinOf() }
    const profileDir = provisionDshSubProfile(home, config)
    const copy = join(profileDir, 'node_modules', '@khorsheed', 'dsh-local-agent-dsh-headless')
    expect(readFileSync(join(copy, 'lib', 'index.js'), 'utf8')).toBe('v1')
    writeFileSync(join(bundleDir, 'lib', 'index.js'), 'v2')
    rmSync(join(bundleDir, 'lib', 'old.js'))
    provisionDshSubProfile(home, config)
    expect(readFileSync(join(copy, 'lib', 'index.js'), 'utf8')).toBe('v2')
    expect(existsSync(join(copy, 'lib', 'old.js'))).toBe(false)
  })

  it('replaces a symlink left by the earlier link scheme, without touching its target', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    const staleDir = makeBundleDir('- id: stale\n')
    const link = join(home, 'profiles', DEFAULT_SUB_PROFILE_NAME, 'node_modules', '@khorsheed', 'dsh-local-agent-dsh-headless')
    mkdirSync(join(link, '..'), { recursive: true })
    symlinkSync(staleDir, link)
    provisionDshSubProfile(home, { headlessBundleDir: bundleDir, unitHeadlessBundleDir: twinOf() })
    expect(lstatSync(link).isDirectory()).toBe(true)
    expect(readFileSync(join(link, 'cordis.patch.yml'), 'utf8')).toBe('- id: local-agent-dsh-headless-runner\n')
    expect(readFileSync(join(staleDir, 'cordis.patch.yml'), 'utf8')).toBe('- id: stale\n')
  })

  it('refuses a bundle that is not a plain tree of files', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    symlinkSync(tmpdir(), join(bundleDir, 'escape'))
    expect(() => provisionDshSubProfile(home, { headlessBundleDir: bundleDir, unitHeadlessBundleDir: twinOf() }))
      .toThrow(/not a plain tree of files/)
  })

  it('copies the installation-resolved bundle when nothing is pinned', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const profileDir = provisionDshSubProfile(home)
    const copy = join(profileDir, 'node_modules', '@khorsheed', 'dsh-local-agent-dsh-headless')
    expect(lstatSync(copy).isDirectory()).toBe(true)
    expect((JSON.parse(readFileSync(join(copy, 'package.json'), 'utf8')) as { name?: string }).name)
      .toBe('@khorsheed/dsh-local-agent-dsh-headless')
  })
})
