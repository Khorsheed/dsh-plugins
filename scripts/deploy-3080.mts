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
 *   5. schedule-exit (owns the one preflight; FAIL stops before host exit)
 *   6. watchdog respawn → wait for authenticated canary PASS
 *
 * Usage:
 *   pnpm deploy:3080 --package packages/<dir> [--package packages/<dir2> ...]
 *   pnpm deploy:3080 --package packages/<dir> --no-restart   # pack+refresh only
 *
 * Options:
 *   --version X     override the tarball version (default: package.json)
 *   --initiator ID  session id the restart report is routed to. DEFAULT IS TO
 *      OMIT THE FLAG: the guard then routes the report to its caller's
 *      $DSH_SESSION_ID — the session that ran this deploy gets woken with the
 *      receipt. Passing a non-session id (a username, a branch slug) routes
 *      the report to a session that will never exist: it stays pending until
 *      the next restart overwrites it (silently lost).
 *   --no-restart    install/refresh + diagnostic preflight; do not restart
 * @module scripts/deploy-3080
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { checkDeploymentLinks } from './dependency-links.mts'
import { familySpecsFor, formatFamilySpecs, loadWorkspaceVersions } from './pack-dist.ts'

/** Every workspace package's own version — a family edge ranges on the target's. */
const workspaceVersions = loadWorkspaceVersions(join(import.meta.dirname, '..', 'packages'))

const HOME = homedir()
const DSH_HOME = process.env.DSH_HOME ?? join(HOME, '.dsh-official')
const HARNESS = process.env.DSH_HARNESS ?? join(HOME, 'code/deepseek-harness')
const PROFILE = join(DSH_HOME, 'profiles', 'web')
const TARBALLS = join(DSH_HOME, 'tarballs')
const GUARD = ['node', [join('packages', 'ankh-guard', 'lib', 'cli.js')]]
const PORT = '3080'

function usage(message) {
  process.stderr.write(`deploy-3080: ${message}\n`)
  throw new Error(`invalid deployment request: ${message}`)
}

const args = process.argv.slice(2)
const packages = []
let versionOverride
// The restart report's routing session. Deliberately undefined by default:
// the --initiator flag is only passed when the operator names a session
// explicitly — otherwise ankh-guard routes the report to its caller's
// $DSH_SESSION_ID, which is the session that actually ran this deploy. The
// old default ($USER) routed every report to a session that never exists,
// orphaning it until the next restart overwrote the record.
let initiator
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

// Diagnose existing damage before build work or any deployment writes.
checkDeploymentLinks(DSH_HOME, HARNESS)

// Multi-agent deploy lock: two concurrent deploys would race the profile and
// the restart. A live pidfile holder wins; stale locks are reclaimed.
const lockPath = join(DSH_HOME, 'state', 'deploy-3080.pid')
mkdirSync(join(DSH_HOME, 'state'), { recursive: true })
if (existsSync(lockPath)) {
  const holder = Number(readFileSync(lockPath, 'utf8'))
  if (Number.isInteger(holder) && holder > 0) {
    let alive = true
    try { process.kill(holder, 0) } catch (error) {
      if (error.code === 'ESRCH') alive = false
      else throw error
    }
    if (alive) usage(`another deploy is running (pid ${holder}) — wait for it or remove ${lockPath} if stale`)
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

  const manifestPath = join(PROFILE, 'package.json')
  const initial = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const needsRegistration = metas.filter(m => {
    if (!m.pkg.dsh?.bundle?.patch) {
      if (!initial.dependencies?.[m.name]) usage(`${m.name} has no self-mounting bundle; install internal companions through their owning plugin`)
      return false
    }
    return !initial.dependencies?.[m.name] || !initial.dsh?.profile?.bundles?.includes(m.name)
  })
  const hostCli = join(HARNESS, 'apps', 'cli', 'lib', 'bin.js')
  if (needsRegistration.length && !existsSync(hostCli)) usage(`first installation needs the built official CLI: ${hostCli}`)

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
    const family = familySpecsFor(m.pkg, workspaceVersions)
    const packArgs = ['scripts/pack-dist.ts', '--package', m.dir, '--scope', '@khorsheed', '--version', m.version, '--out', outDir]
    if (family.length > 0) packArgs.push('--family', formatFamilySpecs(family))
    run('npx', ['tsx', ...packArgs])
    const canonical = `${m.name.replace('@khorsheed/', 'khorsheed-')}-${m.version}.tgz`
    m.tgzName = `${m.name.replace('@khorsheed/', 'khorsheed-')}-${m.version}+${buildStamp}.tgz`
    copyFileSync(join(outDir, canonical), join(TARBALLS, m.tgzName))
    m.tgzPath = join(TARBALLS, m.tgzName)
  }

  // 3. profile manifest + family overrides + clean install.
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const m of metas) {
    // Existing dependencies move together before official add resolves the family.
    // New names and bundle registration remain owned by the official CLI.
    if (manifest.dependencies?.[m.name] !== undefined) manifest.dependencies[m.name] = `file:${m.tgzPath}`
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  const wsPath = join(PROFILE, 'pnpm-workspace.yaml')
  let ws = readFileSync(wsPath, 'utf8')
  for (const m of metas) {
    const line = `  '${m.name}': 'file:${m.tgzPath}'`
    if (ws.includes(`'${m.name}':`)) {
      ws = ws.replace(new RegExp(`  '${m.name.replace(/[.*+?^${'{}()|[\]\\]/g, '\\$&')}': '[^']*'`), line)
    } else if (ws.includes('overrides:')) {
      // Append inside the overrides block, not at EOF: a later top-level key
      // (e.g. minimumReleaseAgeExclude, added by dsh plugin add) must not
      // swallow the line into its own list — that corrupts the YAML.
      const rest = ws.slice(ws.indexOf('overrides:'))
      const nextKey = rest.search(/\n(?=\S)/) // first subsequent line at column 0
      const insertAt = nextKey === -1 ? ws.length : ws.indexOf('overrides:') + nextKey + 1
      ws = ws.slice(0, insertAt).trimEnd() + `\n${line}\n` + ws.slice(insertAt).replace(/^\n*/, '\n')
    } else {
      ws = ws.trimEnd() + `\n\noverrides:\n${line}\n`
    }
  }
  writeFileSync(wsPath, ws)
  if (needsRegistration.length) {
    process.stdout.write(`\n=== official first-install / bundle registration: ${needsRegistration.map(m => m.name).join(', ')} ===\n`)
    run('node', [hostCli, 'plugin', 'add', ...needsRegistration.map(m => m.tgzPath), '--profile', 'web'], {
      env: { ...process.env, DSH_HOME, DSH_HARNESS: HARNESS },
    })
  }
  rmSync(join(PROFILE, 'node_modules'), { recursive: true, force: true })
  rmSync(join(PROFILE, 'pnpm-lock.yaml'), { force: true })
  run('pnpm', ['install'], { cwd: PROFILE })

  const installed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const m of metas) {
    if (!installed.dependencies?.[m.name]) throw new Error(`${m.name}: official install did not register the dependency`)
    const packageDir = join(PROFILE, 'node_modules', m.name)
    const actual = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
    if (actual.name !== m.name || actual.version !== m.version) throw new Error(`${m.name}: installed artifact identity/version mismatch`)
    if (m.pkg.dsh?.bundle?.patch && (!installed.dsh?.profile?.bundles?.includes(m.name) || !actual.dsh?.bundle?.patch || !existsSync(join(packageDir, actual.dsh.bundle.patch)))) {
      throw new Error(`${m.name}: installed bundle/patch missing; refusing credential and restart`)
    }
  }
  // Recheck links introduced by install, before recording proof or requesting a restart.
  checkDeploymentLinks(DSH_HOME, HARNESS)

  // 4. credential for the harness checkout HEAD.
  // This orchestrator has already observed every package build/test above;
  // use the explicit trusted seam instead of pretending the guard ran them.
  runGuard(['record', 'build', '--trust-command', '--command', 'pnpm deploy:3080 (build+test green)', '--repo', HARNESS])

  if (noRestart) {
    // With no stop-capable verb there is no internal composition gate, so the
    // refresh-only acceptance path runs the diagnostic explicitly.
    runGuard(['preflight', '--profile', 'web'])
    process.stdout.write('\ndeploy-3080: packed + refreshed (no restart, per --no-restart)\n')
  } else {
    // 5. gated restart + canary watch. schedule-exit owns the single
    // composition preflight; running it separately here doubled the slowest
    // part of an ordinary 3080 restart without strengthening the gate.
    const logPath = join(DSH_HOME, 'state', 'watchdog.log')
    const logOffset = existsSync(logPath) ? readFileSync(logPath, 'utf8').length : 0
    runGuard(['schedule-exit', '--port', PORT, '--delay-ms', '5000', '--profile', 'web', '--repo', HARNESS, ...(initiator === undefined ? [] : ['--initiator', initiator])])
    const deadline = Date.now() + 180_000
    let ok = false
    while (Date.now() < deadline) {
      execFileSync('sleep', ['5'])
      const appended = existsSync(logPath) ? readFileSync(logPath, 'utf8').slice(logOffset) : ''
      if (appended.includes('canary PASS')) {
        try {
          const status = execFileSync('curl', ['-s', '--noproxy', '*', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '3', `http://127.0.0.1:${PORT}/`], { stdio: 'pipe', encoding: 'utf8' }).trim()
          if (status !== '200' && status !== '401') continue
          ok = true
          break
        } catch { /* not yet */ }
      }
    }
    if (!ok) {
      process.stderr.write('\ndeploy-3080: instance did not come back clean within 180s — check the watchdog log before touching anything else\n')
      throw new Error('restart/canary verification failed')
    }
  }

  // Preserve previous artifacts until the entire requested deployment succeeds.
  for (const m of metas) {
    // Prune older timestamped copies of the same package — they exist only to
    // bust the install cache of the moment they were deployed. The name prefix
    // must end at a VERSION digit: `khorsheed-dsh-local-agent-` is a prefix of
    // `khorsheed-dsh-local-agent-codex-…`, and a bare startsWith pruned the
    // family's tarballs alive in the profile (ENOENT at profile install).
    const base = m.name.replace('@khorsheed/', 'khorsheed-')
    const prunePattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d.*\\+.*\\.tgz$`)
    for (const f of readdirSync(TARBALLS)) {
      if (f !== m.tgzName && prunePattern.test(f)) rmSync(join(TARBALLS, f), { force: true })
    }
  }

  const names = metas.map(m => `${m.name}@${m.version}`).join(', ')
  process.stdout.write(`\ndeploy-3080 OK (${Math.round((Date.now() - startedAt) / 1000)}s)\n`)
  const outcome = noRestart
    ? '已安装/更新并通过构建、测试及诊断 preflight；未重启，运行实例尚未验证加载本次构建，未验证 canary。'
    : '已上线：构建/测试/preflight 全绿，按闸重启 canary PASS。'
  process.stdout.write(`\n--- 通报(粘贴给群里)---\n[deploy-3080] ${names} ${outcome}操作者:${process.env.USER ?? 'unknown'}\n`)
} finally {
  rmSync(lockPath, { force: true })
}
