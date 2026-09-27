#!/usr/bin/env node
/**
 * Release-group checker.
 *
 * The repo publishes independent semver lines, with two exceptions that are
 * about *resolvability* rather than process taste:
 *
 *   1. **equal-version groups** — the local-agent family is a coordinated
 *      release closure: several hard dependency edges run provider → core and
 *      provider → the shared tool (the core never depends back on its
 *      providers). A provider at one rc and the core at another is a
 *      compatibility matrix nobody tests, and `pack-dist` rewrites each family
 *      edge on its TARGET package's version — at release time the seven must
 *      therefore share one version and be published in dependency order
 *      (core → tool → providers).
 *
 *   2. **companion pairs** — a `-tool` companion is preset-composed and holds a
 *      one-way edge to its core. The pair may evolve independently (worktrees
 *      0.2.0 legitimately ships with worktrees-tool 0.1.0), but the range
 *      `pack-dist` emits for that edge MUST resolve the core. Ranging a
 *      companion edge on the *packer's* version instead of the target's is the
 *      bug this freezes: `datasets-tool@0.1.0` declared
 *      `@khorsheed/dsh-datasets@^0.1.0` while the core is `0.1.0-rc.1`, and
 *      `worktrees-tool@0.1.0` declared `^0.1.0` while its core is `0.2.0`.
 *
 * The check runs `pack-dist`'s own scope rewrite rather than re-deriving the
 * range, so it fails if that rewrite regresses. Run by hand
 * (`pnpm check:release-groups`); the spec re-runs it against the real tree.
 *
 * Exit code 0 = clean; 1 = findings.
 * @module scripts/check-release-groups
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  familyMemberMap,
  familySpecsFor,
  loadWorkspaceVersions,
  rescopePackageJson,
  type PackageJson,
} from './pack-dist.ts'

export interface Finding {
  readonly path: string
  readonly kind: string
  readonly detail: string
  /**
   * `error` fails the check (default); `warn` reports without failing.
   *
   * The family version line is a *release-time* invariant: `docs/publishing.md`
   * forbids a worktree from moving a version ("worktree 不动版本号"), so the
   * line cannot be enforced as a normal gate error without making an ordinary
   * branch uncommittable. It is a warning in the gate and an error under
   * `--release`, which is the pre-publish step. The companion-edge rules are
   * always errors: they are about what a packed artifact resolves, not about
   * when the version moves.
   */
  readonly severity?: 'error' | 'warn'
}

/** Packages that must move as one release line. */
export interface ReleaseGroup {
  readonly name: string
  readonly dirs: readonly string[]
}

/**
 * The local-agent family: core, the shared delegation tool, the sub-dsh
 * headless bundle, and the four harness providers. `pack-dist` ranges each
 * family edge on that edge's target version, so a release must ship the seven
 * at one version or the published set cannot satisfy its own ranges.
 */
export const RELEASE_GROUPS: readonly ReleaseGroup[] = [
  {
    name: 'local-agent',
    dirs: [
      'local-agent',
      'local-agent-tool-subagent',
      'local-agent-dsh-headless',
      'local-agent-kimi',
      'local-agent-codex',
      'local-agent-claude-code',
      'local-agent-dsh',
    ],
  },
]

/** core/companion pairs whose emitted edge must resolve the core. */
export const COMPANION_PAIRS: ReadonlyArray<{ core: string; companion: string }> = [
  { core: 'datasets', companion: 'datasets-tool' },
  { core: 'eval', companion: 'eval-tool' },
  { core: 'mission', companion: 'mission-tool' },
  { core: 'room', companion: 'room-tool' },
  // worktrees-tool folded back into the worktrees package at 0.3.0 (the ./tool
  // composition entry) — there is no longer a separate companion package.
]

interface Loaded {
  readonly name: string
  readonly version: string
  readonly json: PackageJson
}

function readPackage(packagesRoot: string, dir: string): Loaded | undefined {
  const path = join(packagesRoot, dir, 'package.json')
  if (!existsSync(path)) return undefined
  const json = JSON.parse(readFileSync(path, 'utf8')) as PackageJson
  return { name: json.name, version: json.version, json }
}

/**
 * Semver prerelease precedence, as npm implements it: dot-separated
 * identifiers, numeric ones compared numerically (rc.10 > rc.6 — a locale
 * string compare gets this backwards), numeric below alphanumeric, and a
 * shorter identifier list below a longer one when all preceding parts match.
 */
function comparePrerelease(a: string, b: string): number {
  const left = a.split('.')
  const right = b.split('.')
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const l = left[i]
    const r = right[i]
    if (l === undefined) return -1
    if (r === undefined) return 1
    const lNumeric = /^\d+$/.test(l)
    const rNumeric = /^\d+$/.test(r)
    if (lNumeric && rNumeric) {
      const diff = Number(l) - Number(r)
      if (diff !== 0) return diff < 0 ? -1 : 1
      continue
    }
    if (lNumeric !== rNumeric) return lNumeric ? -1 : 1
    if (l !== r) return l < r ? -1 : 1
  }
  return 0
}

/** Semver satisfaction for the caret ranges this repo emits. */
export function satisfiesCaret(version: string, range: string): boolean {
  const caret = /^\^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(range)
  const target = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(version)
  if (caret === null || target === null) return false
  const lower = [Number(caret[1]), Number(caret[2]), Number(caret[3])]
  const actual = [Number(target[1]), Number(target[2]), Number(target[3])]
  const upper = lower[0]! > 0
    ? [lower[0]! + 1, 0, 0]
    : lower[1]! > 0
      ? [0, lower[1]! + 1, 0]
      : [0, 0, lower[2]! + 1]
  const prerelease = target[4]
  if (prerelease !== undefined) {
    // npm admits a prerelease only when the range carries one for the same tuple.
    if (caret[4] === undefined) return false
    if (actual.join('.') !== lower.join('.')) return false
    return comparePrerelease(prerelease, caret[4]!) >= 0
  }
  const compare = (a: readonly number[], b: readonly number[]): number =>
    (a[0]! - b[0]!) || (a[1]! - b[1]!) || (a[2]! - b[2]!)
  return compare(actual, lower) >= 0 && compare(actual, upper) < 0
}

/**
 * Apply every release-group rule to the real tree.
 * @param repoRoot - the repository root (where `packages/` lives).
 * @param options - `release` makes the family version line a hard error.
 * @returns findings, empty when the rules hold.
 */
export function checkReleaseGroups(repoRoot: string, options: { release?: boolean } = {}): Finding[] {
  const packagesRoot = join(repoRoot, 'packages')
  const versions = loadWorkspaceVersions(packagesRoot)
  const findings: Finding[] = []
  const add = (dir: string, kind: string, detail: string, severity?: 'warn'): void => {
    findings.push({ path: `packages/${dir}/package.json`, kind, detail, ...(severity === undefined ? {} : { severity }) })
  }
  // A version line that is merely out of step today is a warning; at release
  // time it is the thing that must not ship.
  const lineSeverity = options.release === true ? undefined : ('warn' as const)

  // 1. equal-version groups.
  for (const group of RELEASE_GROUPS) {
    const loaded = group.dirs.map(dir => ({ dir, pkg: readPackage(packagesRoot, dir) }))
    const missing = loaded.filter(entry => entry.pkg === undefined).map(entry => entry.dir)
    if (missing.length > 0) {
      findings.push({
        path: 'scripts/check-release-groups.ts',
        kind: 'release group',
        detail: `${group.name} names package(s) that do not exist: ${missing.join(', ')}`,
      })
      continue
    }
    const distinct = new Set(loaded.map(entry => entry.pkg!.version))
    if (distinct.size > 1) {
      const detail = loaded.map(entry => `${entry.dir}@${entry.pkg!.version}`).join(', ')
      for (const entry of loaded) {
        add(entry.dir, 'release group', `${group.name} must publish as one version line — currently ${detail}`, lineSeverity)
      }
    }
  }

  // 2. companion pairs: one-way edge, and the emitted range must resolve.
  for (const { core, companion } of COMPANION_PAIRS) {
    const corePkg = readPackage(packagesRoot, core)
    const toolPkg = readPackage(packagesRoot, companion)
    if (corePkg === undefined || toolPkg === undefined) {
      findings.push({
        path: 'scripts/check-release-groups.ts',
        kind: 'companion pair',
        detail: `${core}/${companion} names a package that does not exist`,
      })
      continue
    }
    const edgeSections = ['dependencies', 'peerDependencies', 'devDependencies'] as const
    const hasEdge = (pkg: Loaded, name: string): boolean =>
      edgeSections.some(section => pkg.json[section]?.[name] !== undefined)

    if (!hasEdge(toolPkg, corePkg.name)) {
      add(companion, 'companion pair', `${companion} has no manifest edge to its core ${corePkg.name}`)
    }
    if (hasEdge(corePkg, toolPkg.name)) {
      add(core, 'companion pair', `${core} declares an edge to its own companion ${toolPkg.name} — the pair is one-way`)
    }

    // What pack-dist would actually publish for that edge, and does it resolve?
    const family = familyMemberMap('@khorsheed', familySpecsFor(toolPkg.json, versions))
    const staged = rescopePackageJson(toolPkg.json, toolPkg.name, toolPkg.version, family)
    const emitted = staged.peerDependencies?.[corePkg.name] ?? staged.dependencies?.[corePkg.name]
    if (emitted === undefined) {
      add(companion, 'companion pair', `the packed ${companion} would declare no edge to ${corePkg.name}`)
      continue
    }
    if (!satisfiesCaret(corePkg.version, emitted)) {
      add(
        companion,
        'companion pair',
        `pack-dist would emit ${corePkg.name}@${emitted}, which does not resolve the core's ${corePkg.version}`,
      )
    }
  }

  return findings
}

/** CLI entry: print findings and exit non-zero when any error exists. */
export function main(repoRoot: string, argv: readonly string[] = []): number {
  const release = argv.includes('--release')
  const findings = checkReleaseGroups(repoRoot, { release })
  const errors = findings.filter(finding => finding.severity !== 'warn')
  const warnings = findings.filter(finding => finding.severity === 'warn')
  for (const warning of warnings) {
    process.stderr.write(`warn: ${warning.path}: ${warning.kind} — ${warning.detail}\n`)
  }
  if (errors.length === 0) {
    const suffix = warnings.length === 0 ? '' : ` (${warnings.length} warning(s); '--release' makes them fatal)`
    process.stdout.write(`check-release-groups: release groups are consistent${suffix}\n`)
    return 0
  }
  for (const error of errors) process.stderr.write(`${error.path}: ${error.kind} — ${error.detail}\n`)
  process.stderr.write(`check-release-groups: ${errors.length} finding(s)\n`)
  return 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(fileURLToPath(new URL('..', import.meta.url)), process.argv.slice(2)))
}
