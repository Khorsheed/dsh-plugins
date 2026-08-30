#!/usr/bin/env node
/**
 * run-self-upgrade.mjs — e2e driver for the @khorsheed/dsh-plugin-upgrade
 * "one-sentence self-upgrade" acceptance run. NOT shipped in the package
 * tarball (tests/ is outside `files`).
 *
 * Commands:
 *   up                      Build a throwaway instance home, boot a 0.1.1-rc.2
 *                           instance with the legacy fixture + plugin-upgrade
 *                           installed, wait until ready, print the handoff
 *                           guidance (URL + the one sentence to send).
 *   assert --home <dir>     Post-upgrade assertions: instance answers HTTP
 *                           (200 on rc.2, token-gated 401 on 0.1.2), the
 *                           listener on the recorded port runs from the alpha
 *                           toolchain, the fixture re-applied on the NEW boot
 *                           (marker pid == listener pid), fixture client.js
 *                           serves 200 (rc.2 single-file URL, or the 0.1.2
 *                           batch-manifest URL with auth cookie). Exit code
 *                           reflects the verdict.
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
import { readdirSync, statSync } from 'node:fs'

const HOME_REAL = process.env.HOME
const STABLE_BIN = join(HOME_REAL, '.dsh-toolchains/stable/node_modules/.bin/dsh')
const ALPHA_BIN = join(HOME_REAL, '.dsh-toolchains/alpha-0.1.2/node_modules/.bin/dsh')
const ALPHA_BASE = join(HOME_REAL, '.dsh-toolchains/alpha-0.1.2/node_modules/@deepseek-ai/dsh-base')
const ALPHA_WEB_APP = join(HOME_REAL, '.dsh-toolchains/alpha-0.1.2/node_modules/@deepseek-ai/dsh-web-app')
const CREDENTIALS = join(HOME_REAL, '.dsh-official/.credentials.yaml')
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WORKTREE_ROOT = resolve(PKG_ROOT, '..', '..')
const FIXTURE_DIR = join(PKG_ROOT, 'tests/e2e/fixtures/fixture-legacy-store')
const TARBALL = join(WORKTREE_ROOT, 'dist-publish/khorsheed-dsh-plugin-upgrade-0.1.0.tgz')

const MARKER_REL = 'state/legacy-store-alive.json'
const CLIENT_URL_PATH = '/plugins/@fixture/legacy-store/client.js'

const log = (msg) => console.log(`[e2e ${new Date().toISOString().slice(11, 19)}] ${msg}`)
const fail = (msg) => {
  console.error(`[e2e] FATAL: ${msg}`)
  process.exit(2)
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const opts = { wait: 0 }
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--home') opts.home = rest[++i]
    else if (rest[i] === '--wait') opts.wait = Number(rest[++i])
    else fail(`unknown argument: ${rest[i]}`)
  }
  return { command, opts }
}

function checkPrerequisites() {
  for (const [label, path] of [
    ['stable toolchain (0.1.1-rc.2)', STABLE_BIN],
    ['fixture plugin', FIXTURE_DIR],
    ['plugin-upgrade tarball', TARBALL],
    ['official credentials', CREDENTIALS],
  ]) {
    if (!existsSync(path)) fail(`${label} not found: ${path}`)
  }
  if (!existsSync(ALPHA_BIN)) {
    log(`WARNING: alpha toolchain missing at ${ALPHA_BIN} — environment will be built, but the upgrade target is not staged yet`)
  }
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
      const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(readFileSync(file, 'utf8'))
      if (match) return match[1]
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

async function up() {
  checkPrerequisites()
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
  // links, so the rc.2 line is what boots) plus the two test subjects.
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
          '@khorsheed/dsh-plugin-upgrade': `file:${TARBALL}`,
        },
        dsh: {
          profile: {
            bundles: [
              '@deepseek-ai/dsh-base',
              '@deepseek-ai/dsh-web-app',
              '@fixture/legacy-store',
              '@khorsheed/dsh-plugin-upgrade',
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
    timeout: 300_000,
  })

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
  const ready = await poll(async () => (await httpCode(`${base}/`)) === 200, 90)
  if (!ready) fail(`instance did not answer 200 within 90s — see ${instanceLog}`)

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
    tarball: TARBALL,
    stableBin: STABLE_BIN,
    alphaBin: ALPHA_BIN,
    alphaBase: ALPHA_BASE,
    alphaWebApp: ALPHA_WEB_APP,
    createdAt: new Date().toISOString(),
  }
  writeFileSync(join(home, 'e2e-env.json'), JSON.stringify(env, null, 2) + '\n')

  log('environment is READY')
  console.log(`
================================================================================
NEXT STEP (browser driver — a human, or an agent with playwright):
  1. Open ${base}/ in a NEW browser tab (do not close other tabs).
  2. Start a new session and send exactly this one sentence:

     把这个实例升级到 0.1.2,新宿主的 npm 包在 ~/.dsh-toolchains/alpha-0.1.2 已经装好,fixture 插件的源码在 ${FIXTURE_DIR},插件包管理器用 npm

  3. Watch the agent work through the plugin-upgrade skill. The page WILL
     disconnect when it restarts itself — reconnect and check recovery.
  4. Afterwards run:
     node ${fileURLToPath(import.meta.url)} assert --home ${home} --wait 600
  5. When finished inspecting:
     node ${fileURLToPath(import.meta.url)} cleanup --home ${home}

State file: ${join(home, 'e2e-env.json')}
================================================================================`)
}

// ----------------------------------------------------------------- assert --

async function assertCmd(opts) {
  if (!opts.home) fail('assert needs --home <dir>')
  const env = JSON.parse(readFileSync(join(opts.home, 'e2e-env.json'), 'utf8'))
  const deadlineMsg = opts.wait > 0 ? `within ${opts.wait}s` : 'on first probe'

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
    // rc.2 serves the single-file URL unauthenticated; 0.1.2 only serves the
    // batch form from the boot manifest and requires the auth cookie. Try the
    // rc.2 form first, then authenticate and follow the manifest.
    clientJsServed: async () => {
      if ((await httpCode(`${env.base}${CLIENT_URL_PATH}`)) === 200) return true
      const token = findSessionToken(env.home)
      if (token === undefined) return false
      const gate = await httpRequest(`${env.base}/?token=${token}`)
      const cookie = (gate.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ')
      const index = await httpRequest(`${env.base}/`, cookie)
      if (index.code !== 200) return false
      const match = /\/plugins\/\?\?[^"']*legacy-store\/client\.js[^"']*/.exec(index.body)
      if (!match) return false
      const batchUrl = match[0].replaceAll('&amp;', '&')
      return (await httpRequest(`${env.base}${batchUrl}`, cookie)).code === 200
    },
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
if (command === 'up') await up()
else if (command === 'assert') await assertCmd(opts)
else if (command === 'cleanup') cleanup(opts)
else fail('usage: run-self-upgrade.mjs <up|assert|cleanup> [--home <dir>] [--wait <sec>]')
