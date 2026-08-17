/**
 * Provision the sub-dsh's headless profile inside the harness scoped home.
 * The sub-dsh runs `dsh --profile <name>` with `$DSH_HOME` pointed at the
 * scoped home, so its profile must live under
 * `<scoped home>/profiles/<name>` — a manifest listing the official
 * `@deepseek-ai/dsh-base` layer plus the family headless bundle, an empty
 * user patch layer, and a single symlink resolving
 * `@khorsheed/dsh-local-agent-dsh-headless` from the sub-profile's
 * node_modules. Everything else the boot needs (dsh-base and its whole
 * dependency graph, cordis, the healed `profiles/node_modules` fallback) is
 * resolved from the dsh installation anchor automatically, so provisioning
 * costs no pnpm install.
 * @module @khorsheed/dsh-local-agent-dsh/provision
 */

import { createRequire } from 'node:module'
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Default name of the sub-dsh profile under the scoped home. */
export const DEFAULT_SUB_PROFILE_NAME = 'headless-local-agent-dsh'

/** Config the provisioning step reads. */
export interface DshSubProfileConfig {
  /** Sub-dsh profile name under the scoped home. */
  profileName?: string
  /**
   * Override the headless bundle directory the sub-profile symlinks to.
   * Absent means resolve `@khorsheed/dsh-local-agent-dsh-headless` from this
   * package's own installation.
   */
  headlessBundleDir?: string
}

/** The sub-profile's bundle layer list: official base plus the family headless bundle. */
const SUB_PROFILE_BUNDLES: readonly string[] = [
  '@deepseek-ai/dsh-base',
  '@khorsheed/dsh-local-agent-dsh-headless',
]

/** The sub-profile manifest the boot reads. */
function subProfileManifest(profileName: string): string {
  return JSON.stringify({
    name: `dsh-profile-${profileName}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [...SUB_PROFILE_BUNDLES] } },
  }, undefined, 2) + '\n'
}

/**
 * Resolve the family headless bundle's directory. The bundle is a declared
 * dependency of this package, so it resolves from the same installation; the
 * explicit config override exists for deployments that keep it elsewhere.
 * @param config - provisioning config carrying the optional override.
 * @returns the absolute bundle directory (holding package.json with `dsh.bundle`).
 */
export function resolveHeadlessBundleDir(config: DshSubProfileConfig = {}): string {
  if (config.headlessBundleDir !== undefined) return config.headlessBundleDir
  const require = createRequire(import.meta.url)
  const manifestPath = require.resolve('@khorsheed/dsh-local-agent-dsh-headless/package.json')
  return dirname(manifestPath)
}

/** Ensure `link` is a symlink to `target`, replacing a wrong or dangling link; a real directory throws. */
function ensureSymlink(link: string, target: string): void {
  let stat
  try {
    stat = lstatSync(link)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    symlinkSync(target, link)
    return
  }
  if (stat.isDirectory()) {
    throw new Error(`provision-dsh: ${link} is a real directory, not the expected symlink; remove it manually`)
  }
  if (readlinkSync(link) === target) return
  rmSync(link, { force: true })
  symlinkSync(target, link)
}

/**
 * Provision (idempotently) the sub-dsh headless profile in the harness
 * scoped home: manifest, empty user patch layer, and the bundle symlink.
 * Existing files are left untouched when already correct, so re-running after
 * a restart is a no-op.
 * @param homeDir - the `dsh` harness's scoped home (its `$DSH_HOME` root).
 * @param config - profile naming and bundle-dir overrides.
 * @returns the absolute sub-profile directory.
 */
export function provisionDshSubProfile(homeDir: string, config: DshSubProfileConfig = {}): string {
  const profileName = config.profileName ?? DEFAULT_SUB_PROFILE_NAME
  const profileDir = join(homeDir, 'profiles', profileName)
  mkdirSync(profileDir, { recursive: true })
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) writeFileSync(manifestPath, subProfileManifest(profileName))
  const patchPath = join(profileDir, 'cordis.patch.yml')
  if (!existsSync(patchPath)) writeFileSync(patchPath, '[]\n')
  const bundleLink = join(profileDir, 'node_modules', '@khorsheed', 'dsh-local-agent-dsh-headless')
  mkdirSync(dirname(bundleLink), { recursive: true })
  ensureSymlink(bundleLink, resolveHeadlessBundleDir(config))
  return profileDir
}
