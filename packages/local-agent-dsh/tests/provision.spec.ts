/**
 * Sub-profile provisioning: idempotent manifest + user layer + bundle symlink
 * under the harness scoped home, with no pnpm install.
 */

import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SUB_PROFILE_NAME, provisionDshSubProfile, resolveHeadlessBundleDir } from '../src/provision.ts'

describe('dsh sub-profile provisioning', () => {
  it('writes the manifest, empty user layer, and a symlink resolving the headless bundle', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = mkdtempSync(join(tmpdir(), 'dsh-bundle-'))
    const profileDir = provisionDshSubProfile(home, { headlessBundleDir: bundleDir })
    expect(profileDir).toBe(join(home, 'profiles', DEFAULT_SUB_PROFILE_NAME))
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(manifest.dsh?.profile?.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@khorsheed/dsh-local-agent-dsh-headless',
    ])
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toBe('[]\n')
    const link = join(profileDir, 'node_modules', '@khorsheed', 'dsh-local-agent-dsh-headless')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(bundleDir)
  })

  it('is idempotent: a second run leaves the files untouched', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = mkdtempSync(join(tmpdir(), 'dsh-bundle-'))
    provisionDshSubProfile(home, { headlessBundleDir: bundleDir })
    const firstManifest = readFileSync(join(home, 'profiles', DEFAULT_SUB_PROFILE_NAME, 'package.json'), 'utf8')
    provisionDshSubProfile(home, { headlessBundleDir: bundleDir })
    expect(readFileSync(join(home, 'profiles', DEFAULT_SUB_PROFILE_NAME, 'package.json'), 'utf8')).toBe(firstManifest)
  })

  it('replaces a dangling symlink pointing elsewhere', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-provision-'))
    const bundleDir = mkdtempSync(join(tmpdir(), 'dsh-bundle-'))
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
