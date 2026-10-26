#!/usr/bin/env node
/**
 * release-wave — orchestrate one npm publish wave for the whole monorepo.
 *
 * A wave is the unit docs/publishing.md describes: every publishable package
 * whose repo version line moved (plus any debuts) is packed, staged, approved
 * on npmjs.com, verified, and tagged — in repo source-level dependency order,
 * with the local-agent family held to its one-version-line rule. The wave is
 * RE-ENTERABLE: every step but `bump` is read-only or idempotent against npm
 * (a re-staged tarball 409s harmlessly), and `verify` is the single source of
 * truth for what actually shipped.
 *
 * Subcommands (run in this order):
 *   plan [--debut <名,…>] [--defer <名,…>]   compute the wave, write .release-wave.json
 *   bump                                    apply manifest targets to package.json versions
 *   check                                   manifest + npm + family + tag gate (exit 1 on findings)
 *   pack                                    pack-dist every wave package, topo order, into dist-publish/
 *   script                                  write dist-publish/publish.sh (one auth publishes the wave) + scope table
 *   stage                                   npx npm@12 stage publish each tarball (debuts skip: device flow)
 *   verify                                  npm view <name>@<target> for every package, debuts included
 *   tag [--write]                           git tag <dir>-v<target> per verified package (dry-run default)
 *   status                                  release-status + check:install-specs (post-publish hygiene)
 *
 * Membership: a packages/<dir>/package.json that is not private, not retired
 * (scripts/retired-packages.ts), and either self-mounting (dsh.bundle.patch)
 * or a named release-group member (local-agent-dsh-headless is a sub-profile
 * patch — no bundle.patch of its own — yet publishes on the family line).
 *
 * Version decisions: the repo package.json version IS the next release line
 * (version governance happens only at mainline release time). plan compares
 * it against npm: ahead → publish as-is (`none`); equal with content changes
 * since the matching tag → suggest a patch bump (a prerelease line
 * graduates to its release); equal without changes → deferred out of the wave; unpublished →
 * deferred unless --debut names it. The manifest records the decision; edit
 * `.release-wave.json` by hand to override a suggestion, then re-run check.
 *
 * Topo order: pack and stage walk the wave in source-level type-edge order —
 * a package's src/ imports of `@khorsheed/dsh-*` (comments stripped, so the
 * multi-line import block local-agent-dsh → local-agent-dsh-headless/wire
 * counts; 2026-10-18 deploy incident) order the imported member first.
 * Edges to non-wave packages (private ui-content-preview, deferred members)
 * are ignored. A cycle is a hard error.
 *
 * `.release-wave.json` is gitignored working state, not a committed record —
 * the committed record is the git tags plus docs/release-status.md.
 * @module scripts/release-wave
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { familySpecsFor, formatFamilySpecs, loadWorkspaceVersions, type PackageJson } from './pack-dist.ts'
import { RELEASE_GROUPS, main as releaseGroupsMain } from './check-release-groups.ts'
import { RETIRED_PACKAGES } from './retired-packages.ts'

/** Manifest filename at the repo root (gitignored). */
export const MANIFEST_FILE = '.release-wave.json'

export interface WaveMember {
  readonly name: string
  readonly dir: string
  readonly version: string
}

export type Bump = 'none' | 'patch' | 'minor' | 'debut'

export interface WaveEntry {
  readonly name: string
  readonly dir: string
  /** npm's published version, null when the name has never been published. */
  readonly current: string | null
  /** The version this wave publishes. */
  readonly target: string
  readonly bump: Bump
  readonly debut: boolean
}

export interface WaveManifest {
  readonly packages: readonly WaveEntry[]
  /** Retired package names to deprecate in the same run, with the npm message. */
  readonly deprecate?: readonly { readonly name: string, readonly message: string }[]
}

export interface Finding {
  readonly severity: 'error' | 'warn'
  readonly subject: string
  readonly detail: string
}

/** Dirs that publish despite carrying no dsh.bundle.patch of their own. */
const RELEASE_GROUP_DIRS = new Set(RELEASE_GROUPS.flatMap(group => group.dirs))
const RETIRED_NAMES = new Set(RETIRED_PACKAGES.map(entry => entry.name))

/**
 * Every package eligible for a wave: not private, not retired, and either
 * self-mounting or a named release-group member (the family headless bundle).
 */
export function collectWaveMembers(packagesDir: string): WaveMember[] {
  const members: WaveMember[] = []
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifestPath = join(packagesDir, entry.name, 'package.json')
    if (!existsSync(manifestPath)) continue
    const pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageJson & { private?: boolean }
    if (pkg.private === true) continue
    if (RETIRED_NAMES.has(pkg.name)) continue
    if (pkg.dsh?.bundle?.patch === undefined && !RELEASE_GROUP_DIRS.has(entry.name)) continue
    members.push({ name: pkg.name, dir: entry.name, version: pkg.version })
  }
  return members.sort((a, b) => a.dir.localeCompare(b.dir))
}

/* ---------------------------------------------------------------- semver */

/** npm-order semver compare (numeric identifiers numerically, numeric < alphanumeric). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): [number[], string[]] => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v)
    if (m === null) throw new Error(`release-wave: not a semver version: ${v}`)
    return [[Number(m[1]), Number(m[2]), Number(m[3])], m[4] === undefined ? [] : m[4].split('.')]
  }
  const [an, ap] = parse(a)
  const [bn, bp] = parse(b)
  for (let i = 0; i < 3; i += 1) if (an[i] !== bn[i]) return an[i]! < bn[i]! ? -1 : 1
  if (ap.length === 0 && bp.length === 0) return 0
  if (ap.length === 0) return 1 // a stable release outranks its prereleases
  if (bp.length === 0) return -1
  for (let i = 0; i < Math.max(ap.length, bp.length); i += 1) {
    const l = ap[i]
    const r = bp[i]
    if (l === undefined) return -1
    if (r === undefined) return 1
    const ln = /^\d+$/.test(l)
    const rn = /^\d+$/.test(r)
    if (ln && rn) {
      if (Number(l) !== Number(r)) return Number(l) < Number(r) ? -1 : 1
      continue
    }
    if (ln !== rn) return ln ? -1 : 1
    if (l !== r) return l < r ? -1 : 1
  }
  return 0
}

/**
 * The suggested bump target. A prerelease line graduates to its release
 * (`0.2.0-rc.3` → `0.2.0`): community packages publish no prereleases since
 * 2026-10-24 (docs/publishing.md 「版本号规则」); anything else takes a patch
 * or a minor.
 */
export function bumpVersion(version: string, kind: 'patch' | 'minor'): string {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(version)
  if (m === null) throw new Error(`release-wave: cannot bump ${version} (expected x.y.z[-rc.N])`)
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (m[4] !== undefined) return `${major}.${minor}.${patch}`
  return kind === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`
}

/**
 * Tag for one published package: `<dir>-v<target>`. Since 2026-10-26 every
 * directory equals the npm name without `@khorsheed/dsh-`, so dir and package
 * agree. The three renamed packages with release history (message-tools →
 * client-message-tools, session-title-edit → client-session-title-edit,
 * dsh-reader → reader) had their historical tags duplicated under the new
 * directory name, so "changes since the last tag" keeps working.
 */
export function tagFor(dir: string, target: string): string {
  return `${dir}-v${target}`
}

/* ------------------------------------------------------------- topo order */

/** Recursively list src files that can carry an import edge. */
function srcFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...srcFiles(path))
    else if (/\.[cm]?tsx?$/.test(entry)) out.push(path)
  }
  return out
}

/**
 * Source-level type edges among wave members: member → the members its src/
 * IMPORTS. Only import/export-from/dynamic-import specifiers count — a bare
 * string scan turns preset-composition data (a bundle naming its members in a
 * config literal) into fake edges and fake cycles. Comments are stripped first
 * (pack-dist's rule: a mention in a comment is not an edge), and the match
 * runs over the whole file text so multi-line import blocks count — a
 * single-line grep misses the local-agent-dsh → local-agent-dsh-headless/wire
 * edge.
 */
export function srcEdges(packagesDir: string, members: readonly WaveMember[]): Map<string, Set<string>> {
  const byName = new Map(members.map(member => [member.name, member]))
  const edges = new Map<string, Set<string>>(members.map(member => [member.name, new Set()]))
  const specifier = /(?:from|import)\s*[\(\s]\s*['"](@khorsheed\/dsh-[a-z0-9-]+)/g
  for (const member of members) {
    for (const file of srcFiles(join(packagesDir, member.dir, 'src'))) {
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/[^\n]*/g, '$1')
      for (const match of text.matchAll(specifier)) {
        const target = byName.get(match[1]!)
        if (target !== undefined && target.name !== member.name) edges.get(member.name)!.add(target.name)
      }
    }
  }
  return edges
}

/**
 * Kahn's algorithm over the in-wave edges, deterministic (alphabetical by
 * name). Throws naming the cycle members when the edges cannot be ordered.
 */
export function topoOrder(members: readonly WaveMember[], edges: Map<string, Set<string>>): WaveMember[] {
  const byName = new Map(members.map(member => [member.name, member]))
  const indegree = new Map<string, number>(members.map(member => [member.name, 0]))
  const dependents = new Map<string, string[]>(members.map(member => [member.name, []]))
  for (const member of members) {
    for (const dep of edges.get(member.name) ?? []) {
      if (!byName.has(dep)) continue
      indegree.set(member.name, indegree.get(member.name)! + 1)
      dependents.get(dep)!.push(member.name)
    }
  }
  const ready = members.map(member => member.name).filter(name => indegree.get(name) === 0).sort()
  const ordered: WaveMember[] = []
  while (ready.length > 0) {
    const name = ready.shift()!
    ordered.push(byName.get(name)!)
    for (const dependent of dependents.get(name)!.sort()) {
      const left = indegree.get(dependent)! - 1
      indegree.set(dependent, left)
      if (left === 0) ready.push(dependent)
    }
    ready.sort()
  }
  if (ordered.length !== members.length) {
    const cycle = members.map(member => member.name).filter(name => indegree.get(name)! > 0)
    throw new Error(`release-wave: import cycle among wave members: ${cycle.join(' → ')}`)
  }
  return ordered
}

/* ------------------------------------------------------------------ plan */

export interface PlanInputs {
  /** Names (full `@khorsheed/...`) to debut this wave. */
  readonly debut: ReadonlySet<string>
  /** Names to hold out of this wave. */
  readonly defer: ReadonlySet<string>
  /** npm's published version for a name, null when unpublished. */
  readonly publishedVersion: (name: string) => string | null
  /** Whether a package's content moved since `<dir>-v<current>`. */
  readonly contentChanged: (dir: string, current: string) => boolean
}

export interface PlanResult {
  readonly manifest: WaveManifest
  /** Kept out of the manifest; printed as their own section. */
  readonly deferred: ReadonlyArray<{ name: string, dir: string, reason: string }>
  /** Non-fatal things a human should read (e.g. repo version behind npm). */
  readonly warnings: readonly string[]
}

export function planWave(members: readonly WaveMember[], inputs: PlanInputs): PlanResult {
  for (const name of inputs.debut) {
    if (inputs.defer.has(name)) throw new Error(`release-wave: ${name} is both --debut and --defer`)
  }
  const entries: WaveEntry[] = []
  const deferred: { name: string, dir: string, reason: string }[] = []
  const warnings: string[] = []
  for (const member of members) {
    if (inputs.defer.has(member.name)) {
      deferred.push({ name: member.name, dir: member.dir, reason: '--defer' })
      continue
    }
    const current = inputs.publishedVersion(member.name)
    if (current === null) {
      if (inputs.debut.has(member.name)) {
        entries.push({ name: member.name, dir: member.dir, current: null, target: member.version, bump: 'debut', debut: true })
      } else {
        deferred.push({ name: member.name, dir: member.dir, reason: 'unpublished; pass --debut to ship a first release' })
      }
      continue
    }
    if (inputs.debut.has(member.name)) {
      throw new Error(`release-wave: --debut ${member.name} is already published at ${current}`)
    }
    const cmp = compareVersions(member.version, current)
    if (cmp > 0) {
      entries.push({ name: member.name, dir: member.dir, current, target: member.version, bump: 'none', debut: false })
    } else if (cmp === 0 && inputs.contentChanged(member.dir, current)) {
      // Repo line equals npm but the content moved — the wave must bump. The
      // patch is a suggestion; the manifest records the final decision.
      entries.push({ name: member.name, dir: member.dir, current, target: bumpVersion(member.version, 'patch'), bump: 'patch', debut: false })
    } else if (cmp === 0) {
      deferred.push({ name: member.name, dir: member.dir, reason: `already published at ${current}, no content change since ${tagFor(member.dir, current)}` })
    } else {
      warnings.push(`${member.name}: repo version ${member.version} is BEHIND npm's ${current} — investigate before the wave; target suggested as ${bumpVersion(current, 'patch')}`)
      entries.push({ name: member.name, dir: member.dir, current, target: bumpVersion(current, 'patch'), bump: 'patch', debut: false })
    }
  }
  return { manifest: { packages: entries }, deferred, warnings }
}

/* -------------------------------------------------------------- manifest */

export function manifestPath(root: string): string {
  return join(root, MANIFEST_FILE)
}

export function writeManifest(root: string, manifest: WaveManifest): void {
  writeFileSync(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`)
}

export function readManifest(root: string): WaveManifest {
  const path = manifestPath(root)
  if (!existsSync(path)) {
    throw new Error(`release-wave: no ${MANIFEST_FILE} — run \`pnpm release:wave plan\` first`)
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as WaveManifest
  if (!Array.isArray(raw.packages)) throw new Error(`release-wave: malformed ${MANIFEST_FILE} (no packages array)`)
  for (const entry of raw.packages) {
    for (const key of ['name', 'dir', 'target', 'bump'] as const) {
      if (typeof entry[key] !== 'string') throw new Error(`release-wave: malformed ${MANIFEST_FILE} entry: ${JSON.stringify(entry)}`)
    }
  }
  return raw
}

/* ------------------------------------------------------------------ check */

export interface CheckContext {
  readonly root: string
  readonly members: readonly WaveMember[]
  readonly publishedVersion: (name: string) => string | null
  readonly listTags: () => readonly string[]
}

/**
 * The local-agent family rule: in-wave members of a release group must share
 * one target (pack-dist ranges every family edge on the TARGET's version, so
 * a split line publishes ranges nothing satisfies). A partial group may ride
 * the wave only while the line is unmoved (a pure range re-publish) — warned,
 * since the full group is the norm.
 */
export function familyFindings(manifest: WaveManifest, members: readonly WaveMember[]): Finding[] {
  const findings: Finding[] = []
  const byDir = new Map(members.map(member => [member.dir, member]))
  for (const group of RELEASE_GROUPS) {
    const groupMembers = group.dirs.map(dir => byDir.get(dir)).filter(member => member !== undefined)
    if (groupMembers.length === 0) continue
    const groupNames = new Set(groupMembers.map(member => member.name))
    const inWave = manifest.packages.filter(entry => groupNames.has(entry.name))
    if (inWave.length === 0) continue
    const targets = new Set(inWave.map(entry => entry.target))
    if (targets.size > 1) {
      findings.push({
        severity: 'error',
        subject: group.name,
        detail: `family must publish as one version line — wave targets disagree: ${inWave.map(entry => `${entry.dir}@${entry.target}`).join(', ')}`,
      })
      continue
    }
    if (inWave.length < groupMembers.length) {
      const target = [...targets][0]!
      const repoVersions = new Set(groupMembers.map(member => member.version))
      const lineMoved = inWave.some(entry => entry.bump !== 'none') || repoVersions.size > 1 || !repoVersions.has(target)
      if (lineMoved) {
        findings.push({
          severity: 'error',
          subject: group.name,
          detail: `partial family wave (${inWave.length} of ${groupMembers.length}) moves the version line — publish all members together`,
        })
      } else {
        findings.push({
          severity: 'warn',
          subject: group.name,
          detail: `partial family wave (${inWave.length} of ${groupMembers.length}) at unchanged line ${[...targets][0]} — allowed for a pure range re-publish`,
        })
      }
    }
  }
  return findings
}

/** The full pre-publish gate. Every error names its recovery. */
export function checkWave(manifest: WaveManifest, ctx: CheckContext): Finding[] {
  const findings: Finding[] = []
  const byName = new Map(ctx.members.map(member => [member.name, member]))
  const seen = new Set<string>()
  for (const entry of manifest.packages) {
    if (seen.has(entry.name)) findings.push({ severity: 'error', subject: entry.name, detail: 'listed twice in the manifest' })
    seen.add(entry.name)
    const member = byName.get(entry.name)
    if (member === undefined) {
      findings.push({ severity: 'error', subject: entry.name, detail: `no wave member at packages/${entry.dir} — re-run plan` })
      continue
    }
    if (entry.target.includes('-')) {
      findings.push({
        severity: 'error',
        subject: entry.name,
        detail: `target ${entry.target} is a prerelease — community packages publish 0.MINOR.PATCH only (docs/publishing.md 「版本号规则」)`,
      })
    }
    if (member.version !== entry.target) {
      findings.push({
        severity: 'error',
        subject: entry.name,
        detail: `package.json is ${member.version}, manifest target is ${entry.target} — run \`pnpm release:wave bump\` (or re-plan)`,
      })
    }
    const published = ctx.publishedVersion(entry.name)
    if (entry.debut) {
      if (published !== null) {
        findings.push({ severity: 'error', subject: entry.name, detail: `debut but npm already has ${published} — re-plan without --debut` })
      }
    } else if (published === null) {
      findings.push({ severity: 'error', subject: entry.name, detail: `npm has no ${entry.name} — this is a debut; re-plan with --debut` })
    } else if (compareVersions(entry.target, published) <= 0) {
      findings.push({
        severity: 'error',
        subject: entry.name,
        detail: `target ${entry.target} is not above npm's ${published} (npm 403/409s) — bump the version, or defer the package`,
      })
    }
    const tag = tagFor(entry.dir, entry.target)
    if (ctx.listTags().includes(tag)) {
      findings.push({ severity: 'error', subject: entry.name, detail: `git tag ${tag} already exists — was this version already shipped? verify first` })
    }
  }
  findings.push(...familyFindings(manifest, ctx.members))
  return findings
}

/* ------------------------------------------------------------- real I/O */

const root = join(import.meta.dirname, '..')
const packagesDir = join(root, 'packages')

/** npm's published version, or null when the name is unknown to the registry. */
function publishedVersion(name: string): string | null {
  const run = spawnSync('npm', ['view', name, 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  if (run.status !== 0) return null
  return run.stdout.trim() || null
}

/** Content moved since `<dir>-v<current>`? No tag → conservatively changed. */
function contentChanged(dir: string, current: string): boolean {
  const tag = tagFor(dir, current)
  const listed = spawnSync('git', ['tag', '-l', tag], { cwd: root, encoding: 'utf8' })
  if (listed.status !== 0 || listed.stdout.trim() === '') return true
  const diff = spawnSync('git', ['diff', '--quiet', tag, '--', join('packages', dir)], { cwd: root })
  return diff.status !== 0
}

function listTags(): readonly string[] {
  const run = spawnSync('git', ['tag', '-l'], { cwd: root, encoding: 'utf8' })
  return run.status === 0 ? run.stdout.split('\n').map(line => line.trim()).filter(Boolean) : []
}

/** Exact tarball name pnpm pack emits for a dist package. */
function tarballName(name: string, version: string): string {
  return `${name.replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`
}

const startedAt = Date.now()
/** `[release-wave +Ns]` — the phase-timing prefix every step logs through. */
function stamp(): string {
  return `[release-wave +${Math.round((Date.now() - startedAt) / 1000)}s]`
}

/** Resolve a --debut/--defer token against full name, dir, or short name. */
export function resolveName(members: readonly WaveMember[], token: string): string {
  const hit = members.find(member =>
    member.name === token
    || member.dir === token
    || member.name === `@khorsheed/dsh-${token}`)
  if (hit === undefined) {
    throw new Error(`release-wave: unknown package ${JSON.stringify(token)} — name a wave member by name, dir, or short name`)
  }
  return hit.name
}

function parseNameList(argv: readonly string[], flag: string, members: readonly WaveMember[]): Set<string> {
  const idx = argv.indexOf(flag)
  if (idx === -1) return new Set()
  const raw = argv[idx + 1] ?? ''
  return new Set(raw.split(',').map(token => token.trim()).filter(Boolean).map(token => resolveName(members, token)))
}

function orderedWave(manifest: WaveManifest, members: readonly WaveMember[]): WaveMember[] {
  const inWave = new Set(manifest.packages.map(entry => entry.name))
  const waveMembers = members.filter(member => inWave.has(member.name))
  return topoOrder(waveMembers, srcEdges(packagesDir, waveMembers))
}

function fail(message: string, recovery: string): never {
  process.stderr.write(`${stamp()} ✗ ${message}\n${stamp()}   恢复:${recovery}\n`)
  process.exit(1)
}

/* -------------------------------------------------------------- commands */

function cmdPlan(argv: readonly string[]): void {
  const members = collectWaveMembers(packagesDir)
  const inputs: PlanInputs = {
    debut: parseNameList(argv, '--debut', members),
    defer: parseNameList(argv, '--defer', members),
    publishedVersion,
    contentChanged,
  }
  const { manifest, deferred, warnings } = planWave(members, inputs)
  const width = Math.max(...manifest.packages.map(entry => entry.name.length), 7)
  process.stdout.write(`${stamp()} wave plan (${manifest.packages.length} to publish, ${deferred.length} deferred)\n\n`)
  process.stdout.write(`${'package'.padEnd(width)}  current      target       bump\n`)
  for (const entry of manifest.packages) {
    process.stdout.write(`${entry.name.padEnd(width)}  ${(entry.current ?? '—').padEnd(12)} ${entry.target.padEnd(12)} ${entry.bump}\n`)
  }
  if (deferred.length > 0) {
    process.stdout.write(`\ndeferred (${deferred.length}):\n`)
    for (const entry of deferred) process.stdout.write(`  ${entry.name} — ${entry.reason}\n`)
  }
  for (const warning of warnings) process.stderr.write(`${stamp()} ⚠ ${warning}\n`)
  writeManifest(root, manifest)
  process.stdout.write(`\n${stamp()} wrote ${MANIFEST_FILE} — review bump suggestions (edit the manifest to override), then \`pnpm release:wave bump\`\n`)
}

function cmdBump(): void {
  const manifest = readManifest(root)
  let bumped = 0
  for (const entry of manifest.packages) {
    if (entry.bump === 'none' || entry.bump === 'debut') continue
    const path = join(packagesDir, entry.dir, 'package.json')
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as PackageJson
    if (pkg.version === entry.target) continue
    pkg.version = entry.target
    writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`)
    bumped += 1
    process.stdout.write(`${stamp()} bump ${entry.name} ${entry.current ?? '?'} → ${entry.target}\n`)
  }
  process.stdout.write(`${stamp()} ${bumped} package(s) bumped; rebuild + retest before \`pnpm release:wave check\` (版本治理只在 mainline 发版时发生)\n`)
}

function cmdCheck(): void {
  const manifest = readManifest(root)
  const members = collectWaveMembers(packagesDir)
  // The standing release-group gate runs in its hard --release mode first.
  if (releaseGroupsMain(root, ['--release']) !== 0) {
    fail('check:release-groups --release failed', '对齐家族版本线后重跑 `pnpm release:wave check`')
  }
  const findings = checkWave(manifest, { root, members, publishedVersion, listTags })
  for (const finding of findings.filter(f => f.severity === 'warn')) {
    process.stderr.write(`${stamp()} warn: ${finding.subject} — ${finding.detail}\n`)
  }
  const errors = findings.filter(finding => finding.severity === 'error')
  for (const error of errors) process.stderr.write(`${stamp()} ✗ ${error.subject} — ${error.detail}\n`)
  if (errors.length > 0) fail(`${errors.length} finding(s)`, '逐条修复后重跑 check;bump 漂移先 `pnpm release:wave bump`,版本线先改 package.json 再 re-plan')
  process.stdout.write(`${stamp()} check OK (${manifest.packages.length} packages)\n`)
}

function cmdPack(): void {
  const manifest = readManifest(root)
  const members = collectWaveMembers(packagesDir)
  const ordered = orderedWave(manifest, members)
  const outDir = join(root, 'dist-publish')
  // Family edges range on each target's own version — for wave members that is
  // the manifest TARGET (post-bump), so override the workspace index with it.
  const versions = loadWorkspaceVersions(packagesDir)
  for (const entry of manifest.packages) versions.set(entry.name, entry.target)
  for (const member of ordered) {
    const entry = manifest.packages.find(e => e.name === member.name)!
    const pkg = JSON.parse(readFileSync(join(packagesDir, member.dir, 'package.json'), 'utf8')) as PackageJson
    const family = familySpecsFor(pkg, versions)
    const args = ['tsx', 'scripts/pack-dist.ts', '--package', join('packages', member.dir), '--scope', '@khorsheed', '--version', entry.target, '--out', outDir]
    if (family.length > 0) args.push('--family', formatFamilySpecs(family))
    const run = spawnSync('npx', args, { cwd: root, stdio: 'inherit' })
    if (run.status !== 0) {
      fail(`pack ${member.name} failed`, `修复后重跑 \`pnpm release:wave pack\`(可重入,tarball 覆盖);缺 lib/ 先构建该包`)
    }
    process.stdout.write(`${stamp()} pack ${member.name}@${entry.target} ✓\n`)
  }
  process.stdout.write(`${stamp()} ${ordered.length} tarball(s) in dist-publish/\n`)
}

const DEBUT_GUIDANCE = `  新包首发 stage 不收(404 "package must exist"),走 device flow(docs/publishing.md):
  1. npx npm@12 publish dist-publish/<tgz> --access public --json | jq -r '.error.authUrl'
  2. 把链接发给维护者 — 浏览器打开、Touch ID 认证(链接几分钟内有效)
  3. curl -s "<doneUrl>"  →  {"token":"<16 位数字>"}
  4. npx npm@12 publish dist-publish/<tgz> --access public --otp=<token>`

function cmdStage(): void {
  const manifest = readManifest(root)
  const members = collectWaveMembers(packagesDir)
  const ordered = orderedWave(manifest, members)
  const staged: { name: string, id: string }[] = []
  const debuts: WaveEntry[] = []
  for (const member of ordered) {
    const entry = manifest.packages.find(e => e.name === member.name)!
    if (entry.debut) {
      debuts.push(entry)
      continue
    }
    const tgz = join(root, 'dist-publish', tarballName(entry.name, entry.target))
    if (!existsSync(tgz)) fail(`missing ${tgz}`, '先跑 `pnpm release:wave pack`')
    const run = spawnSync('npx', ['npm@12', 'stage', 'publish', tgz], { cwd: root, encoding: 'utf8' })
    process.stdout.write(run.stdout ?? '')
    process.stderr.write(run.stderr ?? '')
    if (run.status !== 0) {
      const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
      if (/409|already staged|previously published/.test(out)) {
        process.stdout.write(`${stamp()} ${entry.name} already staged/published (409) — continuing; verify is the source of truth\n`)
        continue
      }
      fail(`stage ${entry.name} failed`, 'wave 可重入:已 stage 的包重跑会 409(自动跳过);修复后重跑 `pnpm release:wave stage`')
    }
    const id = /staged(?:\s+package)?(?:\s+id)?[:\s]+([0-9a-f-]{8,})/i.exec(run.stdout ?? '')?.[1] ?? '(id 见上方输出)'
    staged.push({ name: `${entry.name}@${entry.target}`, id })
    process.stdout.write(`${stamp()} stage ${entry.name}@${entry.target} ✓\n`)
  }
  if (debuts.length > 0) {
    process.stdout.write(`\n${stamp()} debut packages skip stage (需要维护者浏览器 Touch ID):\n`)
    for (const entry of debuts) process.stdout.write(`  ${entry.name}@${entry.target}\n`)
    process.stdout.write(`${DEBUT_GUIDANCE}\n`)
  }
  if (staged.length > 0) {
    process.stdout.write(`\n${stamp()} 审批清单 — npmjs.com → 头像 → Account → Staged Packages → 逐个 Approve(Touch ID):\n`)
    for (const entry of staged) process.stdout.write(`  ${entry.name}  staged id: ${entry.id}\n`)
  }
  process.stdout.write(`${stamp()} 审批后跑 \`pnpm release:wave verify\` 确认上线\n`)
}

/** Single-quote a string for sh. */
function shQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

/**
 * The one-shot publish script: topo order, debuts and re-publishes together,
 * each `npm publish` skipped when that version is already on npm (re-runnable
 * after an interruption), then the manifest's deprecations. The maintainer
 * runs it in a real terminal; npm's web auth is asked once and reused for the
 * rest of the run.
 */
export function publishScript(ordered: readonly WaveEntry[], deprecate: WaveManifest['deprecate'], repoRoot: string): string {
  const lines = [
    '#!/bin/sh',
    `# release wave — generated by \`pnpm release:wave script\` (${new Date().toISOString().slice(0, 10)}).`,
    '# Run in your own terminal: sh dist-publish/publish.sh',
    '# npm asks for web auth / Touch ID once; versions already on npm are skipped.',
    'set -e',
    `cd ${shQuote(repoRoot)}`,
    '',
    'publish() {',
    '  if [ "$(npm view "$1@$2" version 2>/dev/null)" = "$2" ]; then echo "== $1@$2 already on npm, skip"; return; fi',
    '  echo "== $1@$2"',
    '  npx -y npm@12 publish "./dist-publish/$3" --access public',
    '}',
    '',
    ...ordered.map(e => `publish ${e.name} ${e.target} ${tarballName(e.name, e.target)}${e.debut ? '   # first release' : ''}`),
  ]
  for (const d of deprecate ?? []) {
    lines.push(`echo "== deprecate ${d.name}"`, `npx -y npm@12 deprecate ${d.name} ${shQuote(d.message)}`)
  }
  lines.push('echo "done — tell the agent to run: pnpm release:wave verify"', '')
  return lines.join('\n')
}

function cmdScript(): void {
  const manifest = readManifest(root)
  const members = collectWaveMembers(packagesDir)
  const ordered = orderedWave(manifest, members).map(m => manifest.packages.find(e => e.name === m.name)!)
  for (const entry of ordered) {
    const tgz = join(root, 'dist-publish', tarballName(entry.name, entry.target))
    if (!existsSync(tgz)) fail(`missing ${tgz}`, '先跑 `pnpm release:wave pack`')
  }
  const out = join(root, 'dist-publish', 'publish.sh')
  writeFileSync(out, publishScript(ordered, manifest.deprecate, root), { mode: 0o755 })
  // The scope table the agent shows the maintainer before handing over the script.
  process.stdout.write(`| 包 | 上一版 | 本次 | 说明 |\n| --- | --- | --- | --- |\n`)
  for (const entry of [...ordered].sort((a, b) => a.name.localeCompare(b.name))) {
    process.stdout.write(`| ${entry.name} | ${entry.current ?? '—'} | ${entry.target} | ${entry.debut ? '首发' : '更新'} |\n`)
  }
  for (const d of manifest.deprecate ?? []) process.stdout.write(`| ${d.name} | — | 弃用 | ${d.message} |\n`)
  process.stdout.write(`\n${stamp()} wrote ${relative(root, out)} — 范围和版本号经维护者确认后,请其在本人终端运行 \`sh ${relative(root, out)}\`\n`)
}

/** Per-package npm check. Returns the names that failed. */
function verifyAll(manifest: WaveManifest): string[] {
  const failed: string[] = []
  for (const entry of manifest.packages) {
    const run = spawnSync('npm', ['view', `${entry.name}@${entry.target}`, 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const ok = run.status === 0 && run.stdout.trim() === entry.target
    process.stdout.write(`${stamp()} verify ${entry.name}@${entry.target} ${ok ? '✓' : '✗'}\n`)
    if (!ok) failed.push(entry.name)
  }
  return failed
}

function cmdVerify(): void {
  const manifest = readManifest(root)
  const failed = verifyAll(manifest)
  if (failed.length > 0) {
    fail(`${failed.length} package(s) not live: ${failed.join(', ')}`, '未 stage 的补 `pnpm release:wave stage`;已 stage 的等网页审批;debut 包走 device flow 后重跑 verify')
  }
  process.stdout.write(`${stamp()} all ${manifest.packages.length} package(s) live on npm — 可以 \`pnpm release:wave tag\`\n`)
}

function cmdTag(argv: readonly string[]): void {
  const write = argv.includes('--write')
  const manifest = readManifest(root)
  // Tags are the permanent record — only a verified wave earns them.
  const failed = verifyAll(manifest)
  if (failed.length > 0) {
    fail(`verify failed for: ${failed.join(', ')}`, '先让 verify 全绿(见上),再 tag;tag 是发版记录,不打未上线的版本')
  }
  const existing = new Set(listTags())
  for (const entry of manifest.packages) {
    const tag = tagFor(entry.dir, entry.target)
    if (existing.has(tag)) {
      process.stdout.write(`${stamp()} tag ${tag} 已存在,跳过\n`)
      continue
    }
    if (!write) {
      process.stdout.write(`${stamp()} dry-run: git tag ${tag}\n`)
      continue
    }
    execFileSync('git', ['tag', tag], { cwd: root })
    process.stdout.write(`${stamp()} tag ${tag} ✓\n`)
  }
  if (!write) process.stdout.write(`${stamp()} dry-run — 确认后重跑 \`pnpm release:wave tag -- --write\`\n`)
}

function cmdStatus(): void {
  for (const args of [['release:status'], ['check:install-specs']]) {
    const run = spawnSync('pnpm', args, { cwd: root, stdio: 'inherit' })
    if (run.status !== 0) {
      fail(`pnpm ${args[0]} failed`, args[0] === 'check:install-specs'
        ? '安装规格下限漂移:`pnpm check:install-specs -- --write` 对齐,README 随发布提交一起走'
        : '修复后重跑 `pnpm release:wave status`')
    }
  }
  process.stdout.write(`${stamp()} status OK — docs/release-status.md 已刷新,随发布提交一起提交\n`)
}

/* ------------------------------------------------------------------- CLI */

const USAGE = `usage: pnpm release:wave <command>

  plan [--debut <名,…>] [--defer <名,…>]   算 wave,写 ${MANIFEST_FILE}
  bump                                    把 manifest 的 bump 落到 package.json
  check                                   manifest + npm + 家族 + tag 闸
  pack                                    topo 序 pack-dist 到 dist-publish/
  script                                  写 dist-publish/publish.sh(一次鉴权发完整波)+ 打印范围表
  stage                                   topo 序 npx npm@12 stage publish(debut 跳过)
  verify                                  逐个 npm view <name>@<target>
  tag [--write]                           git tag <dir>-v<target>(默认 dry-run)
  status                                  release-status + check:install-specs`

function main(argv: readonly string[]): void {
  const [command, ...rest] = argv
  switch (command) {
    case 'plan': return cmdPlan(rest)
    case 'bump': return cmdBump()
    case 'check': return cmdCheck()
    case 'pack': return cmdPack()
    case 'script': return cmdScript()
    case 'stage': return cmdStage()
    case 'verify': return cmdVerify()
    case 'tag': return cmdTag(rest)
    case 'status': return cmdStatus()
    default:
      process.stderr.write(`${USAGE}\n`)
      process.exit(command === undefined ? 0 : 1)
  }
}

/* Run only as a CLI, not when imported by the spec. */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
