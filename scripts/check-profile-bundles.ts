#!/usr/bin/env node
/**
 * Profile composition checker.
 *
 * `check-plugin-independence` judges a package in isolation; this checker
 * judges a *composed installation*. The host's plugin reconciler
 * (`deepseek-harness` `apps/cli/src/plugin.ts` `reconcilePlugins`) only ever
 * sees a profile's **direct** `dependencies`: it adds a `dsh.bundle`-declaring
 * direct dependency to `dsh.profile.bundles`, and it never activates a
 * transitive one. A profile whose manifest disagrees with that rule boots with
 * missing rows — or does not boot at all, because the loader throws on a
 * `bundles` entry with no `dsh.bundle` declaration
 * (`packages/boot/app-boot/src/profile.ts` `loadProfile`).
 *
 * Rules (every `profiles/<name>/package.json`):
 *
 *   1. layered          every `dsh.profile.bundles` entry that is not an
 *                       official `@deepseek-ai/*` template bundle must be a
 *                       direct dependency of the profile
 *   2. mountable        every bundles entry resolvable in this repo declares
 *                       `dsh.bundle.patch` — the loader throws otherwise
 *                       (a bundle-less companion row such as `*-tool` is
 *                       mounted by an agent preset, never at the profile root)
 *   3. self-mounted     every direct `@khorsheed/*` dependency that declares
 *                       `dsh.bundle.patch` appears in `dsh.profile.bundles`
 *   4. closure          a direct dependency's own **hard** dependency on a
 *                       self-mounting `@khorsheed/*` bundle forces that bundle
 *                       into the profile's direct dependencies *and* bundles
 *                       (the local-agent providers → core case; optional
 *                       peerDependency integrations are deliberately exempt —
 *                       declare-and-degrade stays optional)
 *   5. resolvable rows  every package named by a profile preset row
 *                       (a preset's `agent.cordis.yml`) is a direct dependency
 *                       of that profile — otherwise the preset names a module
 *                       the profile cannot resolve
 *
 * Run by hand (`pnpm check:profiles`); the vitest spec re-runs it against the
 * real tree so `pnpm test:scripts` keeps the profiles conformant.
 *
 * Exit code 0 = clean; 1 = findings (each printed as `<path>: <kind> — detail`).
 * @module scripts/check-profile-bundles
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export interface Finding {
  readonly path: string
  readonly kind: string
  readonly detail: string
}

/** One in-repo package, as the composition rules need to see it. */
export interface PackageIndexEntry {
  /** Repository-relative package directory. */
  readonly dir: string
  /** Hard `dependencies` names, verbatim. */
  readonly dependencies: readonly string[]
  /** `dsh.bundle.patch` present — installing it makes the host mount a row. */
  readonly selfMounting: boolean
}

/** A profile manifest plus every package name its presets name. */
export interface ProfileShape {
  /** Repository-relative path of the profile's `package.json`. */
  readonly path: string
  readonly dependencies: readonly string[]
  readonly bundles: readonly string[]
  /** `name:` values of rows declared by the profile's presets (and its own patch). */
  readonly rows: readonly string[]
}

/** Repository-relative path → index, keyed by npm name. */
export type PackageIndex = ReadonlyMap<string, PackageIndexEntry>

const COMMUNITY_SCOPE = '@khorsheed/'
const OFFICIAL_TEMPLATE_SCOPE = '@deepseek-ai/'

/** Read every `packages/<dir>/package.json` into the index. */
export function loadPackageIndex(repoRoot: string): PackageIndex {
  const index = new Map<string, PackageIndexEntry>()
  const packagesDir = join(repoRoot, 'packages')
  if (!existsSync(packagesDir)) return index
  for (const entry of readdirSync(packagesDir)) {
    const manifestPath = join(packagesDir, entry, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: string
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    if (manifest.name === undefined) continue
    index.set(manifest.name, {
      dir: `packages/${entry}`,
      dependencies: Object.keys(manifest.dependencies ?? {}),
      selfMounting: manifest.dsh?.bundle?.patch !== undefined,
    })
  }
  return index
}

/** Every `name:` value a YAML patch/overlay layer declares. */
export function parseRowNames(yaml: string): string[] {
  const names: string[] = []
  for (const match of yaml.matchAll(/^\s*name:\s*(['"]?)(@khorsheed\/[a-z0-9-]+)\1\s*(?:#.*)?$/gm)) {
    names.push(match[2] as string)
  }
  return names
}

/** Recursively list `*.yml` files under a directory (missing dir → none). */
function yamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...yamlFiles(path))
    else if (path.endsWith('.yml') || path.endsWith('.yaml')) out.push(path)
  }
  return out
}

/** Read every profile under `profiles/` into the shape the rules consume. */
export function loadProfiles(repoRoot: string): ProfileShape[] {
  const profilesDir = join(repoRoot, 'profiles')
  if (!existsSync(profilesDir)) return []
  const out: ProfileShape[] = []
  for (const entry of readdirSync(profilesDir)) {
    const manifestPath = join(profilesDir, entry, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    const rows: string[] = []
    // Preset rows and the profile's own patch layer both mount rows.
    const layerFiles = [
      ...yamlFiles(join(profilesDir, entry, 'presets')),
      join(profilesDir, entry, 'cordis.patch.yml'),
    ].filter(file => existsSync(file))
    for (const file of layerFiles) {
      rows.push(...parseRowNames(readFileSync(file, 'utf8')))
    }
    out.push({
      path: `profiles/${entry}/package.json`,
      dependencies: Object.keys(manifest.dependencies ?? {}),
      bundles: manifest.dsh?.profile?.bundles ?? [],
      rows: [...new Set(rows)],
    })
  }
  return out
}

/**
 * Apply the composition rules to one profile.
 * @param profile - the profile manifest shape.
 * @param index - in-repo package index (names absent from it are not judged).
 * @returns findings, empty when the profile composes correctly.
 */
export function checkProfile(profile: ProfileShape, index: PackageIndex): Finding[] {
  const findings: Finding[] = []
  const dependencies = new Set(profile.dependencies)
  const bundles = new Set(profile.bundles)
  const add = (kind: string, detail: string): void => {
    findings.push({ path: profile.path, kind, detail })
  }

  // 1 + 2 — every bundles entry must be a direct dependency, and resolvable
  // entries must actually self-mount.
  for (const name of profile.bundles) {
    if (name.startsWith(OFFICIAL_TEMPLATE_SCOPE)) continue // template bundle, not a dependency
    if (!dependencies.has(name)) {
      add('bundle-not-a-dependency', `${name} is in dsh.profile.bundles but not in dependencies — the reconciler will drop it`)
    }
    const entry = index.get(name)
    if (entry !== undefined && !entry.selfMounting) {
      add(
        'bundle-declares-no-patch',
        `${name} is in dsh.profile.bundles but ${entry.dir}/package.json declares no dsh.bundle.patch — loadProfile throws on this entry`,
      )
    }
  }

  // 3 — a self-mounting direct dependency must be mounted.
  for (const name of profile.dependencies) {
    const entry = index.get(name)
    if (entry === undefined || !entry.selfMounting) continue
    if (!bundles.has(name)) {
      add('dependency-not-layered', `${name} self-mounts but is absent from dsh.profile.bundles — its row never activates`)
    }
  }

  // 4 — composition closure over HARD dependencies only (a peerDependency is
  // an optional integration; demanding it would break declare-and-degrade).
  for (const name of profile.dependencies) {
    const entry = index.get(name)
    if (entry === undefined) continue
    for (const needed of entry.dependencies) {
      if (!needed.startsWith(COMMUNITY_SCOPE)) continue
      const neededEntry = index.get(needed)
      if (neededEntry === undefined || !neededEntry.selfMounting) continue
      if (!dependencies.has(needed)) {
        add(
          'closure-missing-dependency',
          `${entry.dir} (${name}) hard-depends on the self-mounting ${needed}; the reconciler never activates a transitive bundle — add ${needed} to dependencies`,
        )
      }
      if (!bundles.has(needed)) {
        add('closure-missing-bundle', `${entry.dir} (${name}) hard-depends on ${needed}; add it to dsh.profile.bundles`)
      }
    }
  }

  // 5 — preset rows must resolve from this profile's own dependencies.
  for (const name of profile.rows) {
    if (!dependencies.has(name)) {
      add('preset-row-unresolvable', `a preset mounts ${name}, which is not a dependency of this profile`)
    }
  }

  return findings
}

/** Walk every profile and flatten the findings. */
export function scanProfiles(repoRoot: string): Finding[] {
  const index = loadPackageIndex(repoRoot)
  return loadProfiles(repoRoot).flatMap(profile => checkProfile(profile, index))
}

/** CLI entry: print findings and exit non-zero when any exist. */
export function main(repoRoot: string): number {
  const findings = scanProfiles(repoRoot)
  if (findings.length === 0) {
    process.stdout.write('check-profile-bundles: profiles compose cleanly\n')
    return 0
  }
  for (const finding of findings) {
    const path = relative(process.cwd(), join(repoRoot, finding.path))
    process.stderr.write(`${path}: ${finding.kind} — ${finding.detail}\n`)
  }
  process.stderr.write(`check-profile-bundles: ${findings.length} finding(s)\n`)
  return 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(fileURLToPath(new URL('..', import.meta.url))))
}
