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
 *                       the profile cannot resolve; a row naming a subpath
 *                       composition entry (`@khorsheed/dsh-worktrees/tool`)
 *                       additionally requires the workspace base package to
 *                       EXPORT that subpath — the 2026-09-28 incident's exact
 *                       signature was a preset naming the entry against an
 *                       installed base that predated it
 *   6. no retired names a retired package (scripts/retired-packages.ts) never
 *                       re-enters a composition: not as a dependency, not as
 *                       a bundles entry, not as a preset row
 *   7. member currency  a caret range on a workspace member must ADMIT the
 *                       workspace version — a range that doesn't installs an
 *                       older member against compositions written for the new
 *                       one (the same skew class as rule 5b). Only caret
 *                       ranges are judged; exotic pins are deliberate.
 *                       web-eval is exempt: the incubating eval pack pins the
 *                       0.1.x member line against its own older deployment
 *                       host and re-bases with the eval line.
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
import { RETIRED_PACKAGES } from './retired-packages.ts'

/** Profiles exempt from rule 7 (member currency), with the reason. */
const RANGE_RULE_EXEMPT_PROFILES: ReadonlySet<string> = new Set([
  // The incubating eval pack pins the 0.1.x member line against its own older
  // deployment host; its ranges re-base when the eval line does.
  'web-eval',
])

const RETIRED = new Map(RETIRED_PACKAGES.map(entry => [entry.name, entry]))

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
  /** The package's own version (rule 7's member-currency check). */
  readonly version: string | undefined
  /** `exports` map keys (`.`, `./tool`, …) — rule 5b's subpath check. */
  readonly exportKeys: readonly string[]
}

/** A profile manifest plus every package name its presets name. */
export interface ProfileShape {
  /** Repository-relative path of the profile's `package.json`. */
  readonly path: string
  readonly dependencies: readonly string[]
  /** `dependencies` verbatim, ranges included — rule 7 reads them. */
  readonly dependencyRanges: Readonly<Record<string, string>>
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
      version?: string
      dependencies?: Record<string, string>
      exports?: Record<string, unknown>
      dsh?: { bundle?: { patch?: string } }
    }
    if (manifest.name === undefined) continue
    index.set(manifest.name, {
      dir: `packages/${entry}`,
      dependencies: Object.keys(manifest.dependencies ?? {}),
      selfMounting: manifest.dsh?.bundle?.patch !== undefined,
      version: manifest.version,
      exportKeys: Object.keys(manifest.exports ?? {}),
    })
  }
  return index
}

/** Every `name:` value a YAML patch/overlay layer declares. A row may name a
 * package's subpath composition entry (`@khorsheed/dsh-worktrees/tool`, the
 * canvas `./agent` pattern) — the full name is returned and rule 5 resolves
 * the BASE package against the profile's dependencies. */
export function parseRowNames(yaml: string): string[] {
  const names: string[] = []
  for (const match of yaml.matchAll(/^\s*name:\s*(['"]?)(@khorsheed\/[a-z0-9-]+(?:\/[a-z0-9-]+)?)\1\s*(?:#.*)?$/gm)) {
    names.push(match[2] as string)
  }
  return names
}

interface ParsedVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly pre?: string
}

function parseVersion(text: string): ParsedVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(text.trim())
  if (match === null) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    ...(match[4] === undefined ? {} : { pre: match[4] }),
  }
}

function sameCore(a: ParsedVersion, b: ParsedVersion): boolean {
  return a.major === b.major && a.minor === b.minor && a.patch === b.patch
}

/** semver's identifier compare for the prerelease tail (numeric < alphanumeric). */
function comparePrerelease(a: string, b: string): number {
  const as = a.split('.')
  const bs = b.split('.')
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i]
    const y = bs[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xNum = /^\d+$/.test(x) ? Number(x) : undefined
    const yNum = /^\d+$/.test(y) ? Number(y) : undefined
    if (xNum !== undefined && yNum !== undefined) {
      if (xNum !== yNum) return xNum - yNum
      continue
    }
    if (xNum !== undefined) return -1
    if (yNum !== undefined) return 1
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (a.pre === b.pre) return 0
  if (a.pre === undefined) return 1 // a stable release outranks its prereleases
  if (b.pre === undefined) return -1
  return comparePrerelease(a.pre, b.pre)
}

/**
 * Does a caret range admit `version`? npm semantics for the only range shape
 * this repo's profiles use: `^` pins the major (on 0.x the minor; on 0.0.x
 * the patch), and a prerelease candidate is admitted only when the floor
 * carries a prerelease of the same core triple. Returns undefined when either
 * side is not a plain caret/version pair — exotic ranges (workspace:, file:,
 * tags) are deliberate and stay unjudged.
 */
export function caretAdmits(range: string, version: string): boolean | undefined {
  const trimmed = range.trim()
  if (!trimmed.startsWith('^')) return undefined
  const floor = parseVersion(trimmed.slice(1))
  const candidate = parseVersion(version)
  if (floor === undefined || candidate === undefined) return undefined
  if (floor.major > 0 ? candidate.major !== floor.major
    : floor.minor > 0 ? candidate.major !== 0 || candidate.minor !== floor.minor
      : !sameCore(candidate, floor)) return false
  if (candidate.pre !== undefined && (floor.pre === undefined || !sameCore(candidate, floor))) return false
  return compareVersions(candidate, floor) >= 0
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
      dependencyRanges: manifest.dependencies ?? {},
      bundles: manifest.dsh?.profile?.bundles ?? [],
      rows: [...new Set(rows)],
    })
  }
  return out
}

/**
 * Rules 5b + 6 for one row name, independent of where the row is declared.
 * 5b: a subpath composition-entry row requires the workspace base package to
 * EXPORT the entry — a preset naming `@khorsheed/dsh-worktrees/tool` against
 * a base version that predates the entry is the 2026-09-28 incident's exact
 * signature (the row fails to import, the preset goes broken, its sessions
 * fail to resume — on a cleanly booting profile). 6: a retired name never
 * re-enters a composition.
 */
function rowHealthFinding(name: string, index: PackageIndex): { kind: string; detail: string } | undefined {
  const retired = RETIRED.get(name)
  if (retired !== undefined) {
    return { kind: 'retired-package', detail: `a preset mounts retired ${name} (${retired.note}); replacement: ${retired.replacement} — repoint the row` }
  }
  const segments = name.split('/')
  if (segments.length === 3 && name.startsWith(COMMUNITY_SCOPE)) {
    const base = segments.slice(0, 2).join('/')
    const entry = index.get(base)
    const subpath = `./${segments[2] as string}`
    if (entry !== undefined && !entry.exportKeys.includes(subpath)) {
      return { kind: 'preset-row-subpath-missing', detail: `a preset mounts ${name}, but ${entry.dir}/package.json does not export ${subpath} — the row cannot import` }
    }
  }
  return undefined
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

  // 5 — preset rows must resolve from this profile's own dependencies. A row
  // naming a subpath composition entry (`@khorsheed/dsh-worktrees/tool`)
  // resolves through the BASE package — that is where the module ships.
  // Rules 5b/6 (subpath exported, not retired) are profile-independent and
  // shared with the package-patch scan via rowHealthFinding.
  for (const name of profile.rows) {
    const base = name.split('/').slice(0, 2).join('/')
    if (!dependencies.has(name) && !dependencies.has(base)) {
      add('preset-row-unresolvable', `a preset mounts ${name}, which is not a dependency of this profile`)
    }
    const health = rowHealthFinding(name, index)
    if (health !== undefined) add(health.kind, health.detail)
  }

  // 6 — retired package names never re-enter a composition.
  for (const name of profile.dependencies) {
    const retired = RETIRED.get(name)
    if (retired !== undefined) add('retired-package', `${name} is retired (${retired.note}); replacement: ${retired.replacement} — remove the dependency`)
  }
  for (const name of profile.bundles) {
    const retired = RETIRED.get(name)
    if (retired !== undefined) add('retired-package', `${name} is retired (${retired.note}); replacement: ${retired.replacement} — remove the bundles entry`)
  }

  // 7 — member currency: a caret range on a workspace member must ADMIT the
  // workspace version, or installing the pack pulls an older member than the
  // compositions are written for (the same skew class as rule 5b).
  if (!RANGE_RULE_EXEMPT_PROFILES.has(profile.path.split('/')[1] ?? '')) {
    for (const [name, range] of Object.entries(profile.dependencyRanges)) {
      if (!name.startsWith(COMMUNITY_SCOPE)) continue
      const entry = index.get(name)
      if (entry?.version === undefined) continue
      if (caretAdmits(range, entry.version) === false) {
        add('dependency-range-stale', `${name} range ${range} does not admit the workspace version ${entry.version} — installing the pack pulls an older member than the compositions expect`)
      }
    }
  }

  return findings
}

/** Walk every profile and flatten the findings. */
export function scanProfiles(repoRoot: string): Finding[] {
  const index = loadPackageIndex(repoRoot)
  return loadProfiles(repoRoot).flatMap(profile => checkProfile(profile, index))
}

/**
 * Walk every workspace package's own bundle patch. A patch's rows — including
 * the preset compositions nested in a declarative preset bundle
 * (`@khorsheed/dsh-presets`, where the incident's row lived) — resolve from
 * the INSTALLING profile, so membership (rule 5) does not apply here; the
 * row-health rules (5b subpath exports, 6 retired names) do.
 */
export function scanPackagePatches(repoRoot: string): Finding[] {
  const index = loadPackageIndex(repoRoot)
  const packagesDir = join(repoRoot, 'packages')
  const findings: Finding[] = []
  if (!existsSync(packagesDir)) return findings
  for (const entry of readdirSync(packagesDir)) {
    const manifestPath = join(packagesDir, entry, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dsh?: { bundle?: { patch?: string } } }
    const patch = manifest.dsh?.bundle?.patch
    if (patch === undefined) continue
    const patchPath = join(packagesDir, entry, patch)
    if (!existsSync(patchPath)) continue
    for (const name of parseRowNames(readFileSync(patchPath, 'utf8'))) {
      const health = rowHealthFinding(name, index)
      if (health !== undefined) findings.push({ path: `packages/${entry}/${patch}`, kind: health.kind, detail: health.detail })
    }
  }
  return findings
}

/** CLI entry: print findings and exit non-zero when any exist. */
export function main(repoRoot: string): number {
  const findings = [...scanProfiles(repoRoot), ...scanPackagePatches(repoRoot)]
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
