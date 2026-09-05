/**
 * Sub-profile provisioning: idempotent manifest + headless patch layer +
 * bundle symlink under the harness scoped home, with no pnpm install.
 */

import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SUB_PROFILE_NAME, provisionDshSubProfile, resolveHeadlessBundleDir } from '../src/provision.ts'

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
})
