#!/usr/bin/env node
/**
 * deploy-3080 — the self-serve flow for shipping a plugin to prod (3080).
 *
 * Any agent can run this; no approval needed — the flow IS the guardrail
 * (docs/ops.md). It executes the six-step acceptance gate end to end:
 *
 *   1. build + test the named package(s)     (GEN_TYPERT_ONLY scoped, so a
 *      neighbor's broken WIP cannot block you)
 *   2. pack-dist to dist-publish/ + copy to the profile tarball dir
 *      (~/.dsh-official/tarballs — deliberately OUTSIDE the workspace, see
 *      docs/ops.md step 3)
 *   3. refresh the profile manifest (dep → file:<tgz>, version bumps handled)
 *      + family overrides, then a clean profile install
 *   4. record the green-build credential for the harness checkout
 *   5. preflight (FAIL aborts before anything restarts — never bypassed)
 *   6. schedule-exit → watchdog respawn → wait for canary PASS + port 200
 *
 * Usage:
 *   pnpm deploy:3080 --package packages/<dir> [--package packages/<dir2> ...]
 *   pnpm deploy:3080 --package packages/<dir> --no-restart   # pack+refresh only
 *
 * Options:
 *   --version X     override the tarball version (default: package.json)
 *   --initiator ID  restart attribution (default: $USER)
 *   --no-restart    stop after the profile refresh
 * @module scripts/deploy-3080
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const HOME = homedir()
const DSH_HOME = process.env.DSH_HOME ?? join(HOME, '.dsh-official')
const HARNESS = process.env.DSH_HARNESS ?? join(HOME, 'code/deepseek-harness')
const PROFILE = join(DSH_HOME, 'profiles', 'web')
const TARBALLS = join(DSH_HOME, 'tarballs')
const GUARD = ['node', [join('packages', 'ankh-guard', 'lib', 'cli.js')]]
const PORT = '3080'

function usage(message) {
  process.stderr.write(`deploy-3080: ${message}\n`)
  process.exit(2)
}

const args = process.argv.slice(2)
const packages = []
let versionOverride
let initiator = process.env.USER ?? 'unknown'
let noRestart = false
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--package') packages.push(args[++i])
  else if (a.startsWith('--package=')) packages.push(a.slice('--package='.length))
  else if (a === '--version') versionOverride = args[++i]
  else if (a === '--initiator') initiator = args[++i]
  else if (a === '--no-restart') noRestart = true
  else usage(`unknown argument ${a}`)
}
if (packages.length === 0) usage('--package <dir> is required (repeatable)')
if (versionOverride !== undefined && packages.length > 1) usage('--version only makes sense with a single package')

function run(cmd, argv, options = {}) {
  execFileSync(cmd, argv, { stdio: 'inherit', ...options })
}

function runGuard(verbArgs) {
  run(GUARD[0], [...GUARD[1], ...verbArgs], { env: { ...process.env, DSH_HOME } })
}

// Multi-agent deploy lock: two concurrent deploys would race the profile and
// the restart. A live pidfile holder wins; stale locks are reclaimed.
const lockPath = join(DSH_HOME, 'state', 'deploy-3080.pid')
mkdirSync(join(DSH_HOME, 'state'), { recursive: true })
if (existsSync(lockPath)) {
  const holder = Number(readFileSync(lockPath, 'utf8'))
  if (Number.isInteger(holder) && holder > 0) {
    try {
      process.kill(holder, 0)
      usage(`another deploy is running (pid ${holder}) — wait for it or remove ${lockPath} if stale`)
    } catch { /* stale — reclaim */ }
  }
}
writeFileSync(lockPath, String(process.pid))

const startedAt = Date.now()
try {
  const metas = packages.map((dir) => {
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) usage(`no package.json at ${dir}`)
    const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return { dir, pkg, name: pkg.name, version: versionOverride ?? pkg.version }
  })

  // 1. build + test (typert generation scoped to these packages so a broken
  // neighbor cannot fail this deploy).
  const env = { ...process.env, GEN_TYPERT_ONLY: metas.map(m => m.name).join(',') }
  for (const m of metas) {
    // The build runs the working tree — warn when it differs from HEAD, so the
    // operator consciously ships uncommitted code (rollback knows only git).
    const dirty = execFileSync('git', ['status', '--porcelain', '--', m.dir], { encoding: 'utf8' }).trim()
    if (dirty !== '') {
      process.stdout.write(`\nWARNING: ${m.dir} has uncommitted changes — prod will run code git cannot roll back to:\n${dirty.split('\n').slice(0, 10).join('\n')}\n`)
    }
    process.stdout.write(`\n=== build ${m.name} ===\n`)
    run('pnpm', ['--filter', m.name, 'build'], { env })
    process.stdout.write(`\n=== test ${m.name} ===\n`)
    run('pnpm', ['--filter', m.name, 'test'], { env })
  }

  // 2. pack-dist + copy to the profile tarball dir (outside the workspace).
  // The profile copy's FILENAME carries a build timestamp, so every deploy
  // gets a fresh file: specifier — the profile picks it up without anyone
  // bumping the package version just to bust pnpm's tarball cache. The
  // canonical name-version.tgz stays in dist-publish/ for npm publishing;
  // versions only move at release time (docs/publishing.md).
  mkdirSync(TARBALLS, { recursive: true })
  const outDir = resolve('dist-publish')
  const buildStamp = new Date().toISOString().replace(/[-:T]/g, '').slice(2, 12) // yymmddhhmm
  for (const m of metas) {
    const family = [...new Set([
      ...Object.keys(m.pkg.dependencies ?? {}),
      ...Object.keys(m.pkg.peerDependencies ?? {}),
    ].filter(d => d.startsWith('@khorsheed/')))]
    const packArgs = ['scripts/pack-dist.ts', '--package', m.dir, '--scope', '@khorsheed', '--version', m.version, '--out', outDir]
    if (family.length > 0) packArgs.push('--family', family.join(','))
    run('npx', ['tsx', ...packArgs])
    const canonical = `${m.name.replace('@khorsheed/', 'khorsheed-')}-${m.version}.tgz`
    m.tgzName = `${m.name.replace('@khorsheed/', 'khorsheed-')}-${m.version}+${buildStamp}.tgz`
    copyFileSync(join(outDir, canonical), join(TARBALLS, m.tgzName))
    // Prune older timestamped copies of the same package — they exist only to
    // bust the install cache of the moment they were deployed.
    for (const f of readdirSync(TARBALLS)) {
      if (f !== m.tgzName && f.startsWith(`${m.name.replace('@khorsheed/', 'khorsheed-')}-`) && f.includes('+')) rmSync(join(TARBALLS, f), { force: true })
    }
    m.tgzPath = join(TARBALLS, m.tgzName)
  }

  // 3. profile manifest + family overrides + clean install.
  const manifestPath = join(PROFILE, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const m of metas) {
    if (manifest.dependencies?.[m.name] === undefined) usage(`${m.name} is not a profile dependency — add it deliberately, not via deploy-3080`)
    manifest.dependencies[m.name] = `file:${m.tgzPath}`
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  const wsPath = join(PROFILE, 'pnpm-workspace.yaml')
  let ws = readFileSync(wsPath, 'utf8')
  for (const m of metas) {
    const line = `  '${m.name}': 'file:${m.tgzPath}'`
    if (ws.includes(`'${m.name}':`)) ws = ws.replace(new RegExp(`  '${m.name.replace(/[.*+?^${'{}()|[\]\\]/g, '\\$&')}': '[^']*'`), line)
    else ws = ws.trimEnd() + (ws.includes('overrides:') ? `\n${line}\n` : `\n\noverrides:\n${line}\n`)
  }
  writeFileSync(wsPath, ws)
  rmSync(join(PROFILE, 'node_modules'), { recursive: true, force: true })
  rmSync(join(PROFILE, 'pnpm-lock.yaml'), { force: true })
  run('pnpm', ['install'], { cwd: PROFILE })

  // 4. credential for the harness checkout HEAD.
  runGuard(['record', 'build', '--command', 'pnpm deploy:3080 (build+test green)', '--repo', HARNESS])

  // 5. preflight — FAIL aborts, nothing restarts.
  runGuard(['preflight', '--profile', 'web'])

  if (noRestart) {
    process.stdout.write('\ndeploy-3080: packed + refreshed (no restart, per --no-restart)\n')
  } else {
    // 6. gated restart + canary watch.
    const logPath = join(DSH_HOME, 'state', 'watchdog.log')
    const logOffset = existsSync(logPath) ? readFileSync(logPath, 'utf8').length : 0
    runGuard(['schedule-exit', '--port', PORT, '--delay-ms', '5000', '--profile', 'web', '--repo', HARNESS, '--initiator', initiator])
    const deadline = Date.now() + 180_000
    let ok = false
    while (Date.now() < deadline) {
      execFileSync('sleep', ['5'])
      const appended = existsSync(logPath) ? readFileSync(logPath, 'utf8').slice(logOffset) : ''
      if (appended.includes('canary PASS')) {
        try {
          execFileSync('curl', ['-s', '--noproxy', '*', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '3', `http://127.0.0.1:${PORT}/`], { stdio: 'pipe' })
          ok = true
          break
        } catch { /* not yet */ }
      }
    }
    if (!ok) {
      process.stderr.write('\ndeploy-3080: instance did not come back clean within 180s — check the watchdog log before touching anything else\n')
      process.exit(1)
    }
  }

  const names = metas.map(m => `${m.name}@${m.version}`).join(', ')
  process.stdout.write(`\ndeploy-3080 OK (${Math.round((Date.now() - startedAt) / 1000)}s)\n`)
  process.stdout.write(`\n--- 通报(粘贴给群里)---\n[deploy-3080] ${names} 已上线:构建/测试/preflight 全绿,按闸重启 canary PASS。操作者:${initiator}\n`)
} finally {
  rmSync(lockPath, { force: true })
}
