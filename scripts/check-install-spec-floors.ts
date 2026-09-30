#!/usr/bin/env node
/**
 * Install-spec floor checker — keeps the README install specs honest.
 *
 * Why: the profile-pack READMEs (dsh-basic / dsh-dev) tell users to install
 * `@khorsheed/dsh-*@^<floor>` specs whose floor is the first version compatible
 * with the current host line. The floor defeats pnpm 11's default 24-hour
 * `minimumReleaseAge` gate (a floored spec auto-exempts; a bare name silently
 * installs the previous, host-incompatible line). But a floor rots when the
 * package crosses a minor line: `^0.3.3` never floats to `0.4.0`, so the README
 * would keep steering fresh installs onto an abandoned line.
 *
 * This checker fails when the NEWEST install spec a README names for a package
 * (the highest `@^floor` per file) no longer includes the package's current
 * `package.json` version. Lower pins for retired host lines (`宿主 0.1.2 →
 * @^0.2.0`) never float by design and are not judged. Run it in the release
 * wave (the version bumps are what can drift it); `--write` realigns drifts to
 * `^<current version>` in place — ship the README in the same release commit.
 *
 * Usage:
 *   pnpm check:install-specs            # report drift, exit 1 when any
 *   pnpm check:install-specs -- --write # realign drifted floors to ^current
 *
 * The caret comparator is intentionally narrow — it covers exactly what this
 * repo publishes: 0.x versions with an optional `-rc.N` suffix. It mirrors
 * npm's prerelease rule (a stable floor admits no prerelease; an rc floor
 * admits only the same triple's later rcs), nothing more.
 * @module dsh-plugins/scripts
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = join(import.meta.dirname, '..')

export interface Version { major: number, minor: number, patch: number, rc: number | null }

export function parseVersion(text: string): Version {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(text)
  if (!match) throw new Error(`not a 0.x[-rc.N] version: ${text}`)
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), rc: match[4] === undefined ? null : Number(match[4]) }
}

/** Does `^floor` admit `current`? (0.x caret: same major+minor, patch ≥ floor's.) */
export function caretIncludes(floor: Version, current: Version): boolean {
  if (current.major !== floor.major || current.minor !== floor.minor) return false
  if (current.patch > floor.patch) return current.rc === null // a different triple's rc is never admitted
  if (current.patch < floor.patch) return false
  if (floor.rc === null) return current.rc === null
  return current.rc === null || current.rc >= floor.rc
}

export interface InstallSpec { name: string, floor: string }

/** Every `@khorsheed/dsh-*@^<version>` spec named in one document. */
export function findInstallSpecs(text: string): InstallSpec[] {
  return [...text.matchAll(/@(khorsheed)\/(dsh-[a-z0-9-]+)@\^(\d+\.\d+\.\d+(?:-rc\.\d+)?)/g)]
    .map(m => ({ name: `@${m[1]}/${m[2]}`, floor: m[3]! }))
}

/** Current versions of every publishable package, by package name. */
export function workspaceVersions(): Map<string, string> {
  const versions = new Map<string, string>()
  for (const dir of readdirSync(join(root, 'packages'))) {
    try {
      const manifest = JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8')) as { name?: string, version?: string, private?: boolean }
      if (manifest.private === true || typeof manifest.name !== 'string' || typeof manifest.version !== 'string') continue
      versions.set(manifest.name, manifest.version)
    } catch { /* no manifest — not a package dir */ }
  }
  return versions
}

/** Profile-pack READMEs (both languages) are the install-spec surface. */
function readmes(): string[] {
  const files: string[] = []
  for (const profile of readdirSync(join(root, 'profiles'))) {
    for (const name of ['README.md', 'README.en.md']) {
      const path = join(root, 'profiles', profile, name)
      try { readFileSync(path); files.push(path) } catch { /* absent */ }
    }
  }
  return files
}

export interface Drift { file: string, name: string, floor: string, current: string }

/** Later of two versions (an rc sorts before its triple's stable release). */
export function newer(a: Version, b: Version): Version {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] > b[key] ? a : b
  }
  if (a.rc === b.rc) return a
  if (a.rc === null) return a
  if (b.rc === null) return b
  return a.rc > b.rc ? a : b
}

export function scan(write: boolean): Drift[] {
  const versions = workspaceVersions()
  const drifts: Drift[] = []
  for (const file of readmes()) {
    const text = readFileSync(file, 'utf8')
    // Only the NEWEST line's spec must cover the current version. The tables
    // also carry deliberate old-line pins (宿主 0.1.2 → @^0.2.0) that never
    // float by design — so per package, judge only the highest floor named.
    const highest = new Map<string, Version>()
    for (const spec of findInstallSpecs(text)) {
      const floor = parseVersion(spec.floor)
      const known = highest.get(spec.name)
      if (known === undefined || newer(floor, known) === floor) highest.set(spec.name, floor)
    }
    let next = text
    for (const [name, floor] of highest) {
      const current = versions.get(name)
      if (current === undefined) continue // not a workspace package (retired/renamed) — the plugin checker owns that
      if (caretIncludes(floor, parseVersion(current))) continue
      const floorText = `${floor.major}.${floor.minor}.${floor.patch}${floor.rc === null ? '' : `-rc.${floor.rc}`}`
      drifts.push({ file, name, floor: floorText, current })
      if (write) next = next.replaceAll(`${name}@^${floorText}`, `${name}@^${current}`)
    }
    if (write && next !== text) writeFileSync(file, next)
  }
  return drifts
}

export function main(argv = process.argv.slice(2)): void {
  const write = argv.includes('--write')
  const drifts = scan(write)
  for (const d of drifts) {
    console.error(`${write ? 'realigned' : 'STALE'} ${d.name}@^${d.floor} → current ${d.current} (${d.file})`)
  }
  if (drifts.length > 0) {
    console.error(write
      ? `${drifts.length} floor(s) realigned — ship the READMEs in the release commit`
      : `${drifts.length} stale install-spec floor(s) — rerun with --write and ship in the release commit (a floor must include the current version, or the README steers fresh installs onto an abandoned line)`)
    if (!write) process.exit(1)
    return
  }
  console.log('check-install-spec-floors: all README install-spec floors cover their package\'s current version')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
