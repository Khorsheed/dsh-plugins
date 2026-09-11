/**
 * Sub-profile provisioning: idempotent manifest + headless patch layer +
 * bundle symlink under the harness scoped home, with no pnpm install.
 */

import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SUB_PROFILE_NAME, presetRosterLayer, provisionDshSubProfile, readSubProfilePreset, resolveHeadlessBundleDir,
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

  it('writes no preset roster layer when the scope names no preset', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    const profileDir = provisionDshSubProfile(home, { headlessBundleDir: bundleDir })
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toBe('- id: local-agent-dsh-headless-runner\n')
    expect(readSubProfilePreset(home)).toBeUndefined()
  })
})

describe('preset roster layer', () => {
  it('appends an insert operation naming the roster and the default preset', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    const profileDir = provisionDshSubProfile(home, { headlessBundleDir: bundleDir, preset: { id: 'eval-lean' } })
    const patch = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
    // The bundle's own list survives untouched ahead of the appended layer.
    expect(patch.startsWith('- id: local-agent-dsh-headless-runner\n')).toBe(true)
    expect(patch).toContain("      name: '@deepseek-ai/dsh-agent-presets'")
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

  it('carries explicit roots and the derived-root switches when given', () => {
    const layer = presetRosterLayer({
      id: 'eval-lean',
      includeShippedRoot: false,
      includeUserRoot: true,
      roots: [{ path: '~/eval-presets', trust: 'system' }, { path: '/srv/presets' }],
    })
    expect(layer).toContain('        includeShippedRoot: false')
    expect(layer).toContain('        includeUserRoot: true')
    expect(layer).toContain('          - path: "~/eval-presets"')
    expect(layer).toContain('            trust: system')
    expect(layer).toContain('          - path: "/srv/presets"')
  })

  it('refuses a preset id that is not a directory name', () => {
    expect(() => presetRosterLayer({ id: '../escape' })).toThrow(/must match/)
    expect(() => presetRosterLayer({ id: 'Eval Lean' })).toThrow(/must match/)
  })

  it('re-provisioning drops the layer again when the preset is withdrawn', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    provisionDshSubProfile(home, { headlessBundleDir: bundleDir, preset: { id: 'eval-lean' } })
    expect(readSubProfilePreset(home)).toBe('eval-lean')
    provisionDshSubProfile(home, { headlessBundleDir: bundleDir })
    expect(readSubProfilePreset(home)).toBeUndefined()
  })

  it('is idempotent with a preset, and links the roster module beside the bundle', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = makeBundleDir('- id: local-agent-dsh-headless-runner\n')
    const profileDir = provisionDshSubProfile(home, { headlessBundleDir: bundleDir, preset: { id: 'eval-lean' } })
    const first = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
    provisionDshSubProfile(home, { headlessBundleDir: bundleDir, preset: { id: 'eval-lean' } })
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toBe(first)
    // The roster resolves from this package's own installation in the repo,
    // so the link exists here; a deployment where it does not resolve leaves
    // the module to the installation anchor rather than failing provisioning.
    const link = join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-agent-presets')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(existsSync(join(readlinkSync(link), 'package.json'))).toBe(true)
  })
})
