#!/usr/bin/env node
/**
 * run-self-upgrade.mjs — e2e driver for the plugin-upgrade skill's
 * "one-sentence self-upgrade" acceptance run. Test asset, never shipped in
 * the skill zip (tests/ is excluded).
 *
 * Commands:
 *   up [--skill <dir>] [--tarballs <dir>] [--extra <name@spec>]… [--home-note <file>]
 *                           Build a throwaway instance home, boot a 0.1.1-rc.2
 *                           instance with the legacy fixture installed, wait
 *                           until ready, print the handoff guidance.
 *                           --skill copies a skill directory (minus tests/)
 *                           into $DSH_HOME/skills/ (the user-level skill root
 *                           dsh-skill-filesystem discovers). --tarballs
 *                           installs every *.tgz in a directory as the plugin
 *                           fleet. --extra adds one registry/file plugin.
 *                           --home-note records the throwaway home path to a
 *                           file for the outer harness.
 *   assert --home <dir>     Post-upgrade assertions: instance answers HTTP
 *                           (200 on rc.2, token-gated 401 on 0.1.2), the
 *                           listener on the recorded port runs from the alpha
 *                           toolchain, the fixture re-applied on the NEW boot
 *                           (marker pid == listener pid), fixture client.js
 *                           serves 200 (rc.2 single-file URL, or the 0.1.2
 *                           batch-manifest URL with auth cookie), plus one
 *                           check per installed plugin that declares a browser
 *                           half. --report adds the v2+ checks: Phase 6.5
 *                           final report on disk covering every installed
 *                           plugin, and the second session's log surviving
 *                           the restart. Exit code reflects the verdict.
 *                           --wait <sec> polls until all pass (default 0).
 *   cleanup --home <dir>    Kill the instance and delete the throwaway home.
 *
 * The script never drives a browser; an agent/human does that with the
 * printed guidance. `up` leaves the instance running for inspection.
 */

import { execFileSync, spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { get as httpGet } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lstatSync, readdirSync, statSync } from 'node:fs'

const HOME_REAL = process.env.HOME
const STABLE_BIN = join(HOME_REAL, '.dsh-toolchains/stable/node_modules/.bin/dsh')
const STABLE_MODULES = join(HOME_REAL, '.dsh-toolchains/stable/node_modules')
const ALPHA_BIN = join(HOME_REAL, '.dsh-toolchains/alpha-0.1.2/node_modules/.bin/dsh')
const ALPHA_BASE = join(HOME_REAL, '.dsh-toolchains/alpha-0.1.2/node_modules/@deepseek-ai/dsh-base')
const ALPHA_WEB_APP = join(HOME_REAL, '.dsh-toolchains/alpha-0.1.2/node_modules/@deepseek-ai/dsh-web-app')
const CREDENTIALS = join(HOME_REAL, '.dsh-official/.credentials.yaml')
const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const REPO_ROOT = resolve(SKILL_ROOT, '..', '..')
const FIXTURE_DIR = join(SKILL_ROOT, 'tests/e2e/fixtures/fixture-legacy-store')

const MARKER_REL = 'state/legacy-store-alive.json'
const CLIENT_URL_PATH = '/plugins/@fixture/legacy-store/client.js'

const log = (msg) => console.log(`[e2e ${new Date().toISOString().slice(11, 19)}] ${msg}`)
const fail = (msg) => {
  console.error(`[e2e] FATAL: ${msg}`)
  process.exit(2)
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const opts = { wait: 0, extra: [], report: false }
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--home') opts.home = rest[++i]
    else if (rest[i] === '--wait') opts.wait = Number(rest[++i])
    else if (rest[i] === '--report') opts.report = true // v2+: also assert final report + second session
    else if (rest[i] === '--extra') opts.extra.push(rest[++i]) // name@spec, spec = version range or file: path
    else if (rest[i] === '--tarballs') opts.tarballs = rest[++i] // dir of *.tgz — the whole fleet
    else if (rest[i] === '--links') opts.links = rest[++i] // plugin repo dir — link: every packages/* bundle
    else if (rest[i] === '--skill') opts.skill = rest[++i] // skill dir copied into $DSH_HOME/skills/
    else if (rest[i] === '--home-note') opts.homeNote = rest[++i] // file to record the throwaway home path
    else fail(`unknown argument: ${rest[i]}`)
  }
  return { command, opts }
}

function checkPrerequisites(opts = {}) {
  for (const [label, path] of [
    ['stable toolchain (0.1.1-rc.2)', STABLE_BIN],
    ['fixture plugin', FIXTURE_DIR],
    ['official credentials', CREDENTIALS],
  ]) {
    if (!existsSync(path)) fail(`${label} not found: ${path}`)
  }
  if (opts.tarballs !== undefined && !existsSync(opts.tarballs)) fail(`tarballs dir not found: ${opts.tarballs}`)
  if (opts.skill !== undefined && !existsSync(join(opts.skill, 'SKILL.md'))) fail(`skill dir has no SKILL.md: ${opts.skill}`)
  if (!existsSync(ALPHA_BIN)) {
    log(`WARNING: alpha toolchain missing at ${ALPHA_BIN} — environment will be built, but the upgrade target is not staged yet`)
  }
}

/**
 * Re-point every non-symlink @deepseek-ai/* entry in the profile's
 * node_modules at the stable toolchain. npm's peer auto-install otherwise
 * drags REGISTRY builds of host packages into the profile tree, and a
 * registry-built client package shadowing the toolchain's rc.2 line broke
 * the / route (400) in the v2 run. The toolchain symlink keeps every host
 * package resolution on the line the instance actually runs.
 */
function repointHostPackages(profileDir) {
  const scopeDir = join(profileDir, 'node_modules', '@deepseek-ai')
  if (!existsSync(scopeDir)) return 0
  let repointed = 0
  for (const entry of readdirSync(scopeDir)) {
    const p = join(scopeDir, entry)
    if (lstatSync(p).isSymbolicLink()) continue
    const target = join(STABLE_MODULES, '@deepseek-ai', entry)
    if (!existsSync(target)) continue // not a toolchain package — leave it
    rmSync(p, { recursive: true, force: true })
    symlinkSync(target, p)
    repointed += 1
  }
  return repointed
}

async function freePort() {
  for (let port = 3200; port <= 3299; port += 1) {
    const ok = await new Promise((res) => {
      const server = createServer()
      server.once('error', () => res(false))
      server.listen(port, '127.0.0.1', () => server.close(() => res(true)))
    })
    if (ok) return port
  }
  fail('no free port in 3200-3299')
}

function httpCode(url) {
  return new Promise((res) => {
    const req = httpGet(url, { timeout: 5000 }, (r) => {
      r.resume()
      res(r.statusCode ?? 0)
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => res(0))
  })
}

/** Full response (code + headers + body), optionally carrying a cookie. */
function httpRequest(url, cookie) {
  return new Promise((res) => {
    const req = httpGet(url, { timeout: 5000, headers: cookie ? { cookie } : {} }, (r) => {
      const chunks = []
      r.on('data', (c) => chunks.push(c))
      r.on('end', () => res({ code: r.statusCode ?? 0, headers: r.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => res({ code: 0, headers: {}, body: '' }))
  })
}

/**
 * The 0.1.2 host gates the web UI behind a per-boot `?token=` (printed to the
 * host's stdout on startup). Find the newest token in any log under the
 * instance home — the supervisor's host log lands there after an upgrade.
 */
function findSessionToken(homeDir) {
  const logs = []
  const walk = (dir, depth) => {
    if (depth > 4) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (/\.(log|status)$/.test(e.name)) logs.push(p)
    }
  }
  walk(homeDir, 0)
  logs.sort((a, b) => {
    try {
      return statSync(b).mtimeMs - statSync(a).mtimeMs
    } catch {
      return 0
    }
  })
  for (const file of logs) {
    try {
      // LAST match wins: host logs append across restarts, and only the latest
      // boot's token is valid.
      const matches = [...readFileSync(file, 'utf8').matchAll(/[?&]token=([A-Za-z0-9_-]+)/g)]
      if (matches.length > 0) return matches[matches.length - 1][1]
    } catch {
      /* unreadable */
    }
  }
  return undefined
}

async function poll(fn, timeoutSec, everyMs = 2000) {
  const deadline = Date.now() + timeoutSec * 1000
  for (;;) {
    const value = await fn()
    if (value) return value
    if (Date.now() >= deadline) return undefined
    await new Promise((r) => setTimeout(r, everyMs))
  }
}

function listenerPid(port) {
  try {
    return execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n')[0]
  } catch {
    return undefined
  }
}

function commandOf(pid) {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

// --------------------------------------------------------------------- up --

async function up(opts) {
  checkPrerequisites(opts)
  const home = mkdtempSync(join(tmpdir(), 'dsh-e2e-upgrade-'))
  const dshHome = join(home, '.dsh')
  const profileDir = join(dshHome, 'profiles', 'web')
  const logsDir = join(home, 'logs')
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(join(dshHome, 'state'), { recursive: true })
  mkdirSync(logsDir, { recursive: true })

  // Model access: credentials come from the official home (read-only symlink);
  // settings pin the default model so the first session needs no onboarding.
  symlinkSync(CREDENTIALS, join(dshHome, '.credentials.yaml'))
  writeFileSync(
    join(dshHome, 'settings.yaml'),
    [
      'agent-default-model:',
      '  provider: deepseek-official',
      '  model: deepseek-v4-flash-vision-exp',
      'ui-onboarding:',
      '  welcomeNoticeVersion: 2026-08-13.1',
      '',
    ].join('\n'),
  )

  // The profile mounts the official bundles from the STABLE toolchain (file:
  // links, so the rc.2 line is what boots) plus the fixture, any --extra
  // name@spec plugins, and every tarball in --tarballs <dir> (the fleet).
  const extraDeps = {}
  const extraNames = []
  for (const spec of opts.extra ?? []) {
    const at = spec.lastIndexOf('@')
    if (at <= 0) fail(`--extra expects name@spec, got: ${spec}`)
    const name = spec.slice(0, at)
    const version = spec.slice(at + 1)
    extraDeps[name] = /^(\d|\^|~)/.test(version) ? version : version.startsWith('file:') ? version : `file:${version}`
    extraNames.push(name)
  }
  if (opts.tarballs !== undefined) {
    for (const file of readdirSync(opts.tarballs)) {
      if (!file.endsWith('.tgz')) continue
      const tgz = join(opts.tarballs, file)
      const pkgJson = JSON.parse(execFileSync('tar', ['-xzOf', tgz, 'package/package.json'], { encoding: 'utf8' }))
      extraDeps[pkgJson.name] = `file:${tgz}`
      // Family-internal row packages (no dsh.bundle.patch) ride as plain
      // dependencies — the family's core row mounts them; only self-mounting
      // bundles get a bundle row.
      if (pkgJson.dsh?.bundle?.patch !== undefined) extraNames.push(pkgJson.name)
    }
    log(`fleet: ${Object.keys(extraDeps).length} tarballs (${extraNames.length} bundles) from ${opts.tarballs}`)
  }
  // --links <repoDir>: the "user has the plugin repo locally" form — every
  // packages/* bundle links live (npm file: on a directory is a symlink), so
  // the upgrading agent edits sources, rebuilds, and a restart picks it up.
  //
  // @khorsheed/dsh-local-agent-dsh-headless is a HEADLESS-profile bundle (it
  // composes a sub-dsh app and inserts a code-runtime row the web profile
  // already owns — a duplicate-id boot failure). It links as a plain
  // dependency so the family provider resolves it, but gets no bundle row.
  const HEADLESS_ONLY = new Set(['@khorsheed/dsh-local-agent-dsh-headless'])
  const linkedPackages = {}
  if (opts.links !== undefined) {
    const packagesDir = join(opts.links, 'packages')
    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifest = join(packagesDir, entry.name, 'package.json')
      if (!existsSync(manifest)) continue
      const pkgJson = JSON.parse(readFileSync(manifest, 'utf8'))
      if (pkgJson.private === true) continue
      const dir = join(packagesDir, entry.name)
      extraDeps[pkgJson.name] = `file:${dir}`
      linkedPackages[pkgJson.name] = dir
      if (pkgJson.dsh?.bundle?.patch !== undefined && !HEADLESS_ONLY.has(pkgJson.name)) extraNames.push(pkgJson.name)
    }
    log(`fleet: ${Object.keys(linkedPackages).length} linked packages (${extraNames.length} bundles) from ${opts.links}`)
  }
  writeFileSync(
    join(profileDir, 'package.json'),
    JSON.stringify(
      {
        name: 'dsh-e2e-upgrade-profile',
        private: true,
        dependencies: {
          '@deepseek-ai/dsh-base': `file:${join(HOME_REAL, '.dsh-toolchains/stable/node_modules/@deepseek-ai/dsh-base')}`,
          '@deepseek-ai/dsh-web-app': `file:${join(HOME_REAL, '.dsh-toolchains/stable/node_modules/@deepseek-ai/dsh-web-app')}`,
          '@fixture/legacy-store': `file:${FIXTURE_DIR}`,
          ...extraDeps,
        },
        dsh: {
          profile: {
            bundles: [
              '@deepseek-ai/dsh-base',
              '@deepseek-ai/dsh-web-app',
              '@fixture/legacy-store',
              ...extraNames,
            ],
          },
        },
      },
      null,
      2,
    ) + '\n',
  )
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')

  log(`installing profile dependencies (npm) in ${profileDir}`)
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: profileDir,
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, HOME: home },
    timeout: 600_000,
  })
  const repointed = repointHostPackages(profileDir)
  if (repointed > 0) log(`re-pointed ${repointed} registry-hoisted @deepseek-ai package(s) back at the stable toolchain`)

  // The skill under test installs as a plain skill directory (user root),
  // which is how dsh-skill-filesystem discovers it — no package machinery.
  if (opts.skill !== undefined) {
    const skillName = /^name:\s*(.+)$/m.exec(readFileSync(join(opts.skill, 'SKILL.md'), 'utf8'))?.[1]?.trim()
    if (!skillName) fail(`cannot read skill name from ${opts.skill}/SKILL.md`)
    const target = join(dshHome, 'skills', skillName)
    mkdirSync(target, { recursive: true })
    execFileSync('cp', ['-R', `${opts.skill}/`, target], { stdio: 'pipe' })
    rmSync(join(target, 'tests'), { recursive: true, force: true }) // test assets never ship
    log(`skill installed: ${skillName} -> ${target}`)
  }

  const port = await freePort()
  const instanceLog = join(logsDir, 'instance-rc2.log')
  const fd = openSync(instanceLog, 'a')
  const child = spawn(STABLE_BIN, ['web', '--port', String(port), '--no-open'], {
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, HOME: home, DSH_HOME: dshHome, NO_PROXY: '*', no_proxy: '*' },
  })
  child.unref()
  log(`booting rc.2 instance: pid ${child.pid}, port ${port}, log ${instanceLog}`)

  const base = `http://127.0.0.1:${port}`
  const ready = await poll(async () => (await httpCode(`${base}/`)) === 200, 240)
  if (!ready) fail(`instance did not answer 200 within 240s — see ${instanceLog}`)

  const markerPath = join(dshHome, MARKER_REL)
  const marker = await poll(() => existsSync(markerPath), 30)
  if (!marker) fail(`fixture alive marker never appeared at ${markerPath} — see ${instanceLog}`)

  const clientCode = await httpCode(`${base}${CLIENT_URL_PATH}`)
  if (clientCode !== 200) fail(`fixture client.js not served (${clientCode}) at ${base}${CLIENT_URL_PATH}`)

  const env = {
    home,
    dshHome,
    profileDir,
    port,
    pid: child.pid,
    base,
    instanceLog,
    logsDir,
    fixtureDir: FIXTURE_DIR,
    extraPlugins: extraNames,
    installedPlugins: ['@fixture/legacy-store', ...Object.keys(extraDeps)],
    linkedPackages,
    skill: opts.skill,
    stableBin: STABLE_BIN,
    alphaBin: ALPHA_BIN,
    alphaBase: ALPHA_BASE,
    alphaWebApp: ALPHA_WEB_APP,
    createdAt: new Date().toISOString(),
  }
  writeFileSync(join(home, 'e2e-env.json'), JSON.stringify(env, null, 2) + '\n')
  if (opts.homeNote) writeFileSync(opts.homeNote, `${home}\n`)

  log('environment is READY')
  console.log(`
================================================================================
NEXT STEP (browser driver — a human, or an agent with playwright):
  1. Open ${base}/ in a NEW browser tab (do not close other tabs).
  2. Start a new session and send the upgrade sentence. The CURRENT v3
     variant (no paths, no hints — the skill must self-serve):

     官方发了 0.1.2(https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.2),帮我把这个实例升上去,插件别坏

     If the agent asks where the plugin sources live, answer with the
     scratch clone path only (e.g. /tmp/dsh-v3-plugin-repo). If it asks to
     restart, answer 可以.

  3. Watch the agent work through the plugin-upgrade skill. The page WILL
     disconnect when it restarts itself — reconnect and check recovery.
  4. Afterwards run:
     node ${fileURLToPath(import.meta.url)} assert --home ${home} --report --wait 600
  5. When finished inspecting:
     node ${fileURLToPath(import.meta.url)} cleanup --home ${home}

Installed plugins: ${env.installedPlugins.length} (fixture included)
State file: ${join(home, 'e2e-env.json')}
================================================================================`)
}

// ----------------------------------------------------------------- assert --

async function assertCmd(opts) {
  if (!opts.home) fail('assert needs --home <dir>')
  const env = JSON.parse(readFileSync(join(opts.home, 'e2e-env.json'), 'utf8'))
  const deadlineMsg = opts.wait > 0 ? `within ${opts.wait}s` : 'on first probe'

  // rc.2 serves the single-file URL unauthenticated; 0.1.2 only serves the
  // batch form from the boot manifest and requires the auth cookie. Try the
  // rc.2 form first, then authenticate and follow the manifest. Returns the
  // bundle body (freshness checks hash it) or undefined when unserved.
  const fetchBundle = async (singlePath, nameFragment) => {
    if (singlePath) {
      const direct = await httpRequest(`${env.base}${singlePath}`)
      if (direct.code === 200) return direct.body
    }
    const token = findSessionToken(env.home)
    if (token === undefined) return undefined
    const gate = await httpRequest(`${env.base}/?token=${token}`)
    const cookie = (gate.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ')
    const index = await httpRequest(`${env.base}/`, cookie)
    if (index.code !== 200) return undefined
    const match = new RegExp(`\\/plugins\\/\\?\\?[^"']*${nameFragment}[^"']*`).exec(index.body)
    if (!match) return undefined
    const batchUrl = match[0].replaceAll('&amp;', '&')
    const batch = await httpRequest(`${env.base}${batchUrl}`, cookie)
    return batch.code === 200 ? batch.body : undefined
  }
  const manifestBundleOk = async (singlePath, nameFragment) =>
    (await fetchBundle(singlePath, nameFragment)) !== undefined

  const checks = {
    // rc.2 answers plain 200; 0.1.2 gates the UI behind a per-boot token and
    // answers 401 without it — both prove an HTTP server is up.
    httpAnswers: async () => {
      const code = await httpCode(`${env.base}/`)
      return (code >= 200 && code < 400) || code === 401
    },
    alphaProcess: async () => {
      const pid = listenerPid(env.port)
      return pid !== undefined && commandOf(pid).includes('.dsh-toolchains/alpha-0.1.2')
    },
    fixtureReapplied: async () => {
      const markerPath = join(env.dshHome, MARKER_REL)
      if (!existsSync(markerPath)) return false
      const pid = listenerPid(env.port)
      if (pid === undefined) return false
      try {
        const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
        return String(marker.pid) === String(pid)
      } catch {
        return false
      }
    },
    clientJsServed: async () => manifestBundleOk(CLIENT_URL_PATH, 'legacy-store\\/client\\.js'),
  }

  // Every installed plugin with a browser half must still serve post-upgrade.
  // Which plugins HAVE a browser half is read from the installed package.json
  // (dsh.client declaration), so host-only plugins are not expected to serve.
  for (const name of env.installedPlugins ?? env.extraPlugins ?? []) {
    const short = name.split('/').pop()
    if (name === '@fixture/legacy-store') continue // covered by clientJsServed
    let hasClient = true
    try {
      const pj = JSON.parse(readFileSync(join(env.profileDir, 'node_modules', name, 'package.json'), 'utf8'))
      hasClient = pj.dsh?.client !== undefined || pj.exports?.['./client'] !== undefined
    } catch {
      /* unreadable — assume client */
    }
    if (hasClient) checks[`fleetClient:${short}`] = () => manifestBundleOk(`/plugins/${name}/client.js`, `${short}\\/client\\.js`)
  }

  // Linked fleet: the served bundle must match the CURRENT source checkout's
  // built file — proves the agent's rebuild actually reached the new host
  // (a stale bundle would mean the fix never landed). The 0.1.2 batch URL
  // concatenates module bodies verbatim minus the sourcemap comment, so the
  // check is containment of the comment-stripped file, not a whole-body hash.
  for (const [name, dir] of Object.entries(env.linkedPackages ?? {})) {
    const clientFile = join(dir, 'lib', 'client.js')
    if (!existsSync(clientFile)) continue
    const short = name.split('/').pop()
    checks[`linksFresh:${short}`] = async () => {
      const body = await fetchBundle(`/plugins/${name}/client.js`, `${short}\\/client\\.js`)
      if (body === undefined) return false
      const current = readFileSync(clientFile, 'utf8').replace(/\n?\/\/# sourceMappingURL=.*$/s, '').trim()
      return current.length > 0 && body.includes(current)
    }
  }

  if (opts.report) {
    // Phase 6.5: the final report landed beside the handoff note and covers
    // EVERY installed plugin — "unaffected" rows included.
    checks.finalReport = async () => {
      const report = join(env.dshHome, 'state', 'upgrade-final-report.md')
      if (!existsSync(report)) return false
      const text = readFileSync(report, 'utf8')
      const all = env.installedPlugins ?? ['@fixture/legacy-store', ...(env.extraPlugins ?? [])]
      return all.every((name) => text.includes(name))
    }
    // The second ("user keeps working") session survives the restart: both
    // session logs are still on disk and non-trivial afterwards.
    checks.secondSessionIntact = async () => {
      const sessionsRoot = join(env.dshHome, 'sessions')
      const logs = []
      const walk = (dir, depth) => {
        if (depth > 3) return
        let entries
        try {
          entries = readdirSync(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const e of entries) {
          const p = join(dir, e.name)
          if (e.isDirectory()) walk(p, depth + 1)
          else if (e.name === 'session.jsonl.zstd') logs.push(p)
        }
      }
      walk(sessionsRoot, 0)
      // At least two substantive session logs survive (the upgrade session and
      // the "user keeps working" session). Empty auto-created shells (the
      // restart machinery may register a zero-turn session) don't count.
      const substantive = logs.filter((f) => statSync(f).size > 2000)
      return substantive.length >= 2
    }
  }

  const results = {}
  for (const [name, fn] of Object.entries(checks)) {
    results[name] = Boolean(await poll(fn, opts.wait))
    log(`${results[name] ? 'PASS' : 'FAIL'} ${name} (${deadlineMsg})`)
  }

  const pid = listenerPid(env.port)
  if (pid !== undefined) log(`listener on :${env.port} is pid ${pid}: ${commandOf(pid)}`)

  const failed = Object.entries(results).filter(([, ok]) => !ok).map(([name]) => name)
  if (failed.length > 0) {
    console.error(`[e2e] ASSERTIONS FAILED: ${failed.join(', ')}`)
    process.exit(1)
  }
  log('all assertions passed — instance upgraded to the alpha toolchain with the fixture alive')
}

// ---------------------------------------------------------------- cleanup --

function cleanup(opts) {
  if (!opts.home) fail('cleanup needs --home <dir>')
  const envPath = join(opts.home, 'e2e-env.json')
  if (existsSync(envPath)) {
    const env = JSON.parse(readFileSync(envPath, 'utf8'))
    const pid = listenerPid(env.port)
    if (pid !== undefined) {
      log(`killing listener pid ${pid} on :${env.port}`)
      try {
        process.kill(Number(pid), 'SIGTERM')
      } catch {
        /* already gone */
      }
    }
  }
  rmSync(opts.home, { recursive: true, force: true })
  log(`removed ${opts.home}`)
}

// --------------------------------------------------------------------- main --

const { command, opts } = parseArgs(process.argv.slice(2))
if (command === 'up') await up(opts)
else if (command === 'assert') await assertCmd(opts)
else if (command === 'cleanup') cleanup(opts)
else fail('usage: run-self-upgrade.mjs <up|assert|cleanup> [--home <dir>] [--wait <sec>] [--report] [--extra <name@spec>]…')
