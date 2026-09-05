/**
 * Provision the sub-dsh's headless profile inside the harness scoped home.
 * The sub-dsh runs `dsh --profile <name>` with `$DSH_HOME` pointed at the
 * scoped home, so its profile must live under
 * `<scoped home>/profiles/<name>` — a manifest listing the official
 * `@deepseek-ai/dsh-base` layer, the family headless composition as the
 * profile's own patch layer (copied verbatim from the headless bundle's
 * `cordis.patch.yml`), and a single symlink resolving
 * `@khorsheed/dsh-local-agent-dsh-headless` from the sub-profile's
 * node_modules (the loader resolves the patch's insert rows through it).
 * Everything else the boot needs (dsh-base and its whole dependency graph,
 * cordis, the healed `profiles/node_modules` fallback) is resolved from the
 * dsh installation anchor automatically, so provisioning costs no pnpm
 * install.
 *
 * The headless bundle declares no `dsh.bundle` on purpose (the T6/G3
 * incident): a declaration would let the host's `dsh plugin` reconcile mount
 * its sub-dsh-only composition into any profile where the package is a
 * direct dependency — duplicate `code-runtime` at best. The patch therefore
 * reaches the sub-profile through this copy, not through the manifest
 * declaration; being the profile's own layer, it lands after every bundle
 * layer, the same position the headless bundle layer used to occupy.
 * @module @khorsheed/dsh-local-agent-dsh/provision
 */

import { createRequire } from 'node:module'
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Default name of the sub-dsh profile under the scoped home. */
export const DEFAULT_SUB_PROFILE_NAME = 'headless-local-agent-dsh'

/** The user patch layer filename inside a profile directory. */
const PROFILE_PATCH_FILENAME = 'cordis.patch.yml'

/** Filename of the family headless bundle's patch, inside the bundle directory. */
const HEADLESS_PATCH_FILENAME = 'cordis.patch.yml'

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

/** The sub-profile's bundle layer list: the official base layer. The headless
 * composition rides the profile's own patch layer (see the module doc). */
const SUB_PROFILE_BUNDLES: readonly string[] = [
  '@deepseek-ai/dsh-base',
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
 * @returns the absolute bundle directory (holding `cordis.patch.yml`).
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
 * scoped home: manifest, the headless patch as the profile's own patch
 * layer, and the bundle symlink. A file whose content already matches is
 * left untouched, so re-running after a restart is a no-op; a drifted file
 * (an upgraded headless bundle, or a profile provisioned by the pre-T6
 * scheme whose manifest listed the headless bundle as a layer) is rewritten,
 * which heals it before the sub-dsh boots.
 * @param homeDir - the `dsh` harness's scoped home (its `$DSH_HOME` root).
 * @param config - profile naming and bundle-dir overrides.
 * @returns the absolute sub-profile directory.
 */
export function provisionDshSubProfile(homeDir: string, config: DshSubProfileConfig = {}): string {
  const profileName = config.profileName ?? DEFAULT_SUB_PROFILE_NAME
  const bundleDir = resolveHeadlessBundleDir(config)
  const profileDir = join(homeDir, 'profiles', profileName)
  mkdirSync(profileDir, { recursive: true })
  const manifestPath = join(profileDir, 'package.json')
  const manifestContent = subProfileManifest(profileName)
  if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8') !== manifestContent) {
    writeFileSync(manifestPath, manifestContent)
  }
  const patchPath = join(profileDir, PROFILE_PATCH_FILENAME)
  const patchContent = readFileSync(join(bundleDir, HEADLESS_PATCH_FILENAME), 'utf8')
  if (!existsSync(patchPath) || readFileSync(patchPath, 'utf8') !== patchContent) {
    writeFileSync(patchPath, patchContent)
  }
  const bundleLink = join(profileDir, 'node_modules', '@khorsheed', 'dsh-local-agent-dsh-headless')
  mkdirSync(dirname(bundleLink), { recursive: true })
  ensureSymlink(bundleLink, bundleDir)
  return profileDir
}
