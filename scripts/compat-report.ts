#!/usr/bin/env node
/**
 * compat-report — generated host-compatibility matrix for every package.
 *
 * The per-package `dsh.compat` field in package.json (plus the README
 * Compatibility sections) is the source of truth for host compatibility —
 * this script renders it, so the answer to "which host line is every package
 * adapted to?" is always one command away and never rots in a hand-written
 * tracking doc.
 *
 * Usage:
 *   pnpm compat:report                 # compare against npm's latest @deepseek-ai/dsh
 *   pnpm compat:report --host 0.1.1-rc.1   # compare against an explicit host line
 *   pnpm compat:report --offline      # skip the npm lookup (needs --host)
 *
 * Status per package: `current` (minHost == host line), `behind` (minHost <
 * host line — re-audit per the ops doc), `ahead`, `-` (no dsh.compat).
 * @module scripts/compat-report
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Parse `0.1.0-rc.8`-style versions into comparable tuples. */
function parse(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?(?:\.(\d+))?$/.exec(version)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? Infinity : Number(m[4]), Number(m[5] ?? 0)]
}

function compare(a, b) {
  const pa = parse(a), pb = parse(b)
  if (pa === null || pb === null) return null
  for (let i = 0; i < 5; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

const args = process.argv.slice(2)
let host
const hostIdx = args.indexOf('--host')
if (hostIdx !== -1) host = args[hostIdx + 1]
if (host === undefined && !args.includes('--offline')) {
  host = execFileSync('npm', ['view', '@deepseek-ai/dsh', 'version'], { encoding: 'utf8' }).trim()
}
if (host === undefined) {
  process.stderr.write('compat-report: no --host given and npm lookup unavailable (use --offline with --host)\n')
  process.exit(2)
}

const rows = []
for (const dir of readdirSync('packages', { withFileTypes: true })) {
  if (!dir.isDirectory()) continue
  const manifestPath = join('packages', dir.name, 'package.json')
  if (!existsSync(manifestPath)) continue
  const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const minHost = pkg.dsh?.compat?.minHost
  // minHost is the FLOOR (oldest host the build runs on; it never tracks the
  // host line). verifiedHost is the newest line the package was audited
  // against — the value that answers "behind or current".
  const verified = pkg.dsh?.compat?.verifiedHost ?? minHost
  let status = '-'
  if (verified !== undefined) {
    const cmp = compare(verified, host)
    status = cmp === null ? '?' : cmp === 0 ? 'current' : cmp < 0 ? 'behind' : 'ahead'
  }
  rows.push({ name: pkg.name, version: pkg.version, minHost: minHost ?? '-', verifiedHost: pkg.dsh?.compat?.verifiedHost, status, private: pkg.private === true })
}

const behind = rows.filter(r => r.status === 'behind')
process.stdout.write(`host line: ${host}\n\n`)
const w = [42, 14, 14, 14, 10]
process.stdout.write(`${'package'.padEnd(w[0])}${'version'.padEnd(w[1])}${'minHost'.padEnd(w[2])}${'verifiedHost'.padEnd(w[3])}${'status'.padEnd(w[4])}\n`)
for (const r of rows) {
  const name = r.private ? `${r.name} (private)` : r.name
  process.stdout.write(`${name.padEnd(w[0])}${r.version.padEnd(w[1])}${String(r.minHost).padEnd(w[2])}${String(r.verifiedHost ?? '-').padEnd(w[3])}${r.status.padEnd(w[4])}\n`)
}
process.stdout.write(`\n${rows.length} package(s); ${behind.length} behind the host line${behind.length > 0 ? ` — re-audit: ${behind.map(r => r.name.replace('@khorsheed/dsh-', '')).join(', ')}` : ''}\n`)
process.exit(behind.length > 0 && args.includes('--fail-behind') ? 1 : 0)
