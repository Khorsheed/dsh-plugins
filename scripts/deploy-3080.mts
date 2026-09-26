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
 *      + family overrides, then a clean profile install. A named FAMILY bundle
 *      (`dsh.bundle.kind: 'family'`) additionally retreats its members: each
 *      member leaves the profile's direct dependencies and the bundles roster
 *      (its own patch then never reconciles — reconcilePlugins folds only
 *      DIRECT dsh.bundle dependencies — so the bundle patch mounts the
 *      canonical rows exactly once), while the member's overrides pin STAYS
 *      for transitive resolution of the bundle's rewritten ^-edges. Member
 *      updates ship by naming the member next to its bundle in one call (any
 *      --package order): the member packs first, the bundle retreats it after.
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
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * The restart verb for step 5. The live watchdog pins its preflight runner by
 * path+sha256 in `state/launch-spec.json`; whenever a deploy rebuilt
 * ankh-guard's runner (any change to preflight-runner.ts), schedule-exit's
 * binding check refuses — the guard self-deploy deadlock. A host-version
 * cutover drifts the pinned install anchor the same way (the anchor is the
 * CLI's package.json, whose version field moves with the host — rc.1 → rc.2,
 * 2026-09-27). On either drift, rebind and restart through reconfigure instead
 * (transactional, restore-previous on failure), copying every field from the
 * live spec. No spec, an unreadable spec, or no drift keeps the ordinary
 * schedule-exit path.
 * @returns the guard argv for the restart.
 */
function restartVerb() {
  const scheduleExit = ['schedule-exit', '--port', PORT, '--delay-ms', '5000', '--profile', 'web', '--repo', HARNESS, '--preflight-timeout-ms', '300000', ...(initiator === undefined ? [] : ['--initiator', initiator])]
  const specPath = join(DSH_HOME, 'state', 'launch-spec.json')
  if (!existsSync(specPath)) return scheduleExit
  let active
  try { active = JSON.parse(readFileSync(specPath, 'utf8')).active } catch { return scheduleExit }
  const pf = active?.preflight
  if (typeof pf?.runnerPath !== 'string' || typeof pf?.runnerSha256 !== 'string' || !existsSync(pf.runnerPath)) return scheduleExit
  const runnerDrift = sha256(pf.runnerPath) !== pf.runnerSha256
  const anchorDrift = typeof pf.installAnchor === 'string' && typeof pf.installAnchorSha256 === 'string'
    && existsSync(pf.installAnchor) && sha256(pf.installAnchor) !== pf.installAnchorSha256
  if (!runnerDrift && !anchorDrift) return scheduleExit
  if (typeof active?.command !== 'string' || typeof pf.installAnchor !== 'string' || typeof pf.candidateProbeCommand !== 'string') {
    throw new Error('the bound preflight runner or install anchor changed on disk and launch-spec.json lacks a field reconfigure needs (command / installAnchor / candidateProbeCommand) — rebind by hand per .agents/notes/implemented/process/2026-09-26-ankh-guard-self-deploy-reconfigure.md')
  }
  const drift = [runnerDrift ? 'preflight runner' : '', anchorDrift ? 'install anchor' : ''].filter(Boolean).join(' and ')
  process.stdout.write(`\ndeploy-3080: bound ${drift} changed on disk — rebinding the launch spec through reconfigure (the transactional cutover path)\n`)
  if (initiator !== undefined) process.stdout.write('deploy-3080: note — --initiator report routing is schedule-exit-only; the reconfigure receipt lives in state/launch-cutover.json\n')
  // Re-record the green credential: reconfigure runs its composition preflight
  // twice (live + isolated candidate copy) and the 10-minute freshness window
  // must still be open when the post-restart canary re-verifies it.
  runGuard(['record', 'build', '--trust-command', '--command', 'pnpm deploy:3080 (build+test green)', '--repo', HARNESS])
  return [
    'reconfigure',
    '--start', active.command,
    '--on-failure', 'restore-previous',
    '--port', String(active.port ?? PORT),
    '--home', active.home ?? DSH_HOME,
    '--repo', active.credentialRepo ?? HARNESS,
    '--harness-root', active.harnessRoot ?? HARNESS,
    '--profile', active.profile ?? 'web',
    '--preflight-surface', pf.surface ?? 'built',
    '--preflight-runner', pf.runnerPath,
    '--preflight-install-anchor', pf.installAnchor,
    '--candidate-probe-command', pf.candidateProbeCommand,
    '--preflight-timeout-ms', '300000',
  ]
}

// Update a name's overrides pin, or insert the line inside the overrides block
// (never at EOF: a later top-level key such as minimumReleaseAgeExclude, added
// by dsh plugin add, would swallow the line into its own list and corrupt the
// YAML). Returns the rewritten workspace file.
function upsertOverride(ws, name, tgzPath) {
  const line = `  '${name}': 'file:${tgzPath}'`
  if (ws.includes(`'${name}':`)) {
    return ws.replace(new RegExp(`  '${name.replace(/[.*+?^${'{}()|[\]\\]/g, '\\$&')}': '[^']*'`), line)
  }
  if (ws.includes('overrides:')) {
    const rest = ws.slice(ws.indexOf('overrides:'))
    const nextKey = rest.search(/\n(?=\S)/) // first subsequent line at column 0
    const insertAt = nextKey === -1 ? ws.length : ws.indexOf('overrides:') + nextKey + 1
    return ws.slice(0, insertAt).trimEnd() + `\n${line}\n` + ws.slice(insertAt).replace(/^\n*/, '\n')
  }
  return ws.trimEnd() + `\n\noverrides:\n${line}\n`
}

// The newest stashed tarball for a retreated member — the fallback for
// restoring a missing overrides pin when the member is not co-deployed.
function latestMemberTarball(member) {
  if (!existsSync(TARBALLS)) return undefined
  const base = member.replace('@khorsheed/', 'khorsheed-').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const candidates = readdirSync(TARBALLS)
    .filter((f) => new RegExp(`^${base}-\\d.*\\.tgz$`).test(f))
    .sort((a, b) => statSync(join(TARBALLS, a)).mtimeMs - statSync(join(TARBALLS, b)).mtimeMs)
  return candidates.length === 0 ? undefined : join(TARBALLS, candidates.at(-1))
}

// A retreated member must be OUT of both direct lists yet still resolvable
// through the bundle's installed dependency tree — the proof that the family
// edge and its overrides pin line up. Resolution starts at the bundle's REAL
// directory: pnpm keeps a package's dependencies beside its own store entry,
// so the symlinked top-level path would miss them.
function verifyRetreatedMember(installed, ownerName, member, expectedVersion) {
  if (installed.dependencies?.[member] !== undefined) throw new Error(`${member}: family member is still a direct dependency after the retreat`)
  if (installed.dsh?.profile?.bundles?.includes(member)) throw new Error(`${member}: family member is still in the bundles roster after the retreat`)
  const bundleDir = realpathSync(join(PROFILE, 'node_modules', ownerName))
  let memberPkgPath
  try {
    memberPkgPath = createRequire(join(bundleDir, 'package.json')).resolve(`${member}/package.json`)
  } catch (error) {
    throw new Error(`${member}: family member does not resolve from ${ownerName}'s installed tree — the overrides pin is missing or stale`, { cause: error })
  }
  if (expectedVersion !== undefined) {
    const actual = JSON.parse(readFileSync(memberPkgPath, 'utf8'))
    if (actual.name !== member || actual.version !== expectedVersion) throw new Error(`${member}: resolved family member identity/version mismatch`)
  }
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

  // Family member retreat: a named family bundle (`dsh.bundle.kind: 'family'`)
  // takes over its members' canonical rows, so every member leaves the
  // profile's DIRECT dependencies and the bundles roster in step 3. A member
  // update ships by naming the member next to its bundle in ONE call (any
  // --package order): the member packs first (step 2 refreshes its tarball and
  // its overrides pin), the bundle registers and retreats it after (step 3).
  const retreat = new Map() // member name → owning family bundle meta
  for (const m of metas) {
    if (m.pkg.dsh?.bundle?.kind !== 'family') continue
    for (const member of m.pkg.dsh.bundle.members ?? []) retreat.set(member, m)
  }

  const manifestPath = join(PROFILE, 'package.json')
  const initial = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const needsRegistration = metas.filter(m => {
    // A co-named family member rides the bundle's dependency tree — official
    // add would (re)register its own row on top of the bundle patch's copy.
    if (retreat.has(m.name)) return false
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
  // Member retreat on the manifest (see the retreat map above): the member
  // leaves the direct dependency list and the bundles roster, so its
  // self-mount patch never reconciles and the plugin inventory stops giving
  // it a top-level card. Members absent from the manifest are skipped with a
  // log line — retreat is idempotent.
  for (const member of retreat.keys()) {
    const hadDep = manifest.dependencies?.[member] !== undefined
    if (hadDep) delete manifest.dependencies[member]
    const bundles = manifest.dsh?.profile?.bundles
    const hadBundle = Array.isArray(bundles) && bundles.includes(member)
    if (hadBundle) manifest.dsh.profile.bundles = bundles.filter((b) => b !== member)
    if (!hadDep && !hadBundle) process.stdout.write(`deploy-3080: family member ${member} is not in the profile manifest — nothing to retreat\n`)
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  const wsPath = join(PROFILE, 'pnpm-workspace.yaml')
  let ws = readFileSync(wsPath, 'utf8')
  for (const m of metas) ws = upsertOverride(ws, m.name, m.tgzPath)
  // Retreat pins: the member's file: pin STAYS — the bundle's rewritten
  // ^-edges resolve transitively through it. A missing pin is restored from
  // this call's fresh member tarball, else the newest stashed one; with
  // neither, refuse — an unpinned member edge would resolve from the registry
  // (404 for unpublished members, a silently stale release for published ones).
  for (const member of retreat.keys()) {
    if (ws.includes(`'${member}':`)) continue
    const pin = metas.find((m) => m.name === member)?.tgzPath ?? latestMemberTarball(member)
    if (pin === undefined) throw new Error(`family member ${member} has no overrides pin in ${wsPath} and no tarball in ${TARBALLS} — name the member package next to its bundle so the family edge stays on a file: tarball`)
    process.stdout.write(`deploy-3080: restored missing overrides pin for family member ${member} → file:${pin}\n`)
    ws = upsertOverride(ws, member, pin)
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
    // A co-named family member verifies through the retreat contract, not the
    // direct-dependency one: it just LEFT both direct lists.
    const owner = retreat.get(m.name)
    if (owner !== undefined) {
      verifyRetreatedMember(installed, owner.name, m.name, m.version)
      continue
    }
    if (!installed.dependencies?.[m.name]) throw new Error(`${m.name}: official install did not register the dependency`)
    const packageDir = join(PROFILE, 'node_modules', m.name)
    const actual = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
    if (actual.name !== m.name || actual.version !== m.version) throw new Error(`${m.name}: installed artifact identity/version mismatch`)
    if (m.pkg.dsh?.bundle?.patch && (!installed.dsh?.profile?.bundles?.includes(m.name) || !actual.dsh?.bundle?.patch || !existsSync(join(packageDir, actual.dsh.bundle.patch)))) {
      throw new Error(`${m.name}: installed bundle/patch missing; refusing credential and restart`)
    }
    if (m.pkg.dsh?.bundle?.kind === 'family') {
      for (const member of m.pkg.dsh.bundle.members ?? []) {
        if (metas.some((x) => x.name === member)) continue // co-named members verify on their own pass, with their version
        verifyRetreatedMember(installed, m.name, member)
      }
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
    // 5. gated restart + canary watch. The verb is chosen by the live launch
    // spec: the watchdog pins its preflight runner by path+sha256, and step
    // 1's build rewrites that file whenever ankh-guard's runner source
    // changed — schedule-exit then refuses ("the bound preflight runner
    // changed after launch configuration"), which made every runner-touching
    // ankh-guard deploy self-block. On drift, rebind+restart through
    // reconfigure (the sanctioned transactional path) instead, copying the
    // live launch spec field-by-field and re-recording the credential so its
    // 10-minute freshness window covers reconfigure's double preflight.
    // Without drift, schedule-exit owns the single composition preflight;
    // running it separately here doubled the slowest part of an ordinary
    // 3080 restart without strengthening the gate.
    // --preflight-timeout-ms 300000: the guard's 120s default was calibrated
    // on an idle machine; under multi-agent load (several builds/tests sharing
    // 8 cores + swap pressure) a clean full-profile dry-run can legitimately
    // exceed it. The timeout exists to catch a HUNG preflight, not a slow one.
    const logPath = join(DSH_HOME, 'state', 'watchdog.log')
    const logOffset = existsSync(logPath) ? readFileSync(logPath, 'utf8').length : 0
    runGuard(restartVerb())
    // Same load reasoning as above: restart + readiness + browser handoff
    // normally land in 20-40s; the window is a hang bound, not a speed gate.
    const deadline = Date.now() + 300_000
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
      process.stderr.write('\ndeploy-3080: instance did not come back clean within 300s — check the watchdog log before touching anything else\n')
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
