#!/usr/bin/env node
// trial-boot.mjs — Phase 4 trial boot: start the NEW host on a spare port
// against a THROWAWAY copy of the live profile, without touching the running
// instance. This is the executable form of the verification ladder's
// composition/live rungs: if the upgraded profile (new host deps re-pointed,
// fixed plugins) boots and answers here, the real restart is a path swap.
//
// What it does:
//   1. creates a throwaway HOME (mkdtemp) and copies the live profile into
//      it (symlinks preserved — profile deps typically link into toolchains);
//   2. optionally carries over `.credentials.yaml` and `settings.yaml` from
//      the live $DSH_HOME so the trial instance can reach the model;
//   3. probes a free port, boots the new host binary detached, logs to a file;
//   4. waits until the port answers ANY HTTP status — token-gated hosts
//      (0.1.2+) answer a bare GET / with 401, and 401 is alive;
//   5. surfaces the host's printed `?token=` entry URL (when present) so the
//      browser half of the acceptance can actually log in;
//   6. leaves the trial running for inspection and prints the kill command
//      (KEEP=0 kills it after the check instead).
//
// Required env:
//   HOST_BIN       the NEW host's dsh binary (e.g. .../alpha/node_modules/.bin/dsh)
//   PROFILE_FROM   the live profile dir (e.g. $DSH_HOME/profiles/web)
// Optional env:
//   DSH_HOME_FROM  copy `.credentials.yaml` + `settings.yaml` from this home
//   PORT_MIN/PORT_MAX   probe range (default 3300-3399)
//   HEALTH_TIMEOUT seconds to wait for the first answer (default 120)
//   KEEP           1 (default) leaves the trial running; 0 kills it after check
//
// Exit code: 0 = trial host answered; 2 = never answered (see the printed log).

import { spawn } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdtempSync, openSync, readFileSync, mkdirSync } from 'node:fs'
import { get as httpGet } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOST_BIN = process.env.HOST_BIN
const PROFILE_FROM = process.env.PROFILE_FROM
const DSH_HOME_FROM = process.env.DSH_HOME_FROM || ''
const PORT_MIN = Number(process.env.PORT_MIN || 3300)
const PORT_MAX = Number(process.env.PORT_MAX || 3399)
const HEALTH_TIMEOUT = Number(process.env.HEALTH_TIMEOUT || 120)
const KEEP = process.env.KEEP !== '0'

const log = (msg) => console.log(`[trial-boot ${new Date().toISOString().slice(11, 19)}] ${msg}`)
const fail = (msg) => {
  console.error(`[trial-boot] FATAL: ${msg}`)
  process.exit(2)
}

if (!HOST_BIN || !existsSync(HOST_BIN)) fail(`HOST_BIN missing or not found: ${HOST_BIN}`)
if (!PROFILE_FROM || !existsSync(PROFILE_FROM)) fail(`PROFILE_FROM missing or not found: ${PROFILE_FROM}`)

// ---- throwaway home -------------------------------------------------------

const home = mkdtempSync(join(tmpdir(), 'dsh-trial-boot-'))
const dshHome = join(home, '.dsh')
const profileName = PROFILE_FROM.replace(/\/+$/, '').split('/').pop()
mkdirSync(join(dshHome, 'profiles'), { recursive: true })
cpSync(PROFILE_FROM, join(dshHome, 'profiles', profileName), { recursive: true, verbatimSymlinks: true })
for (const file of ['.credentials.yaml', 'settings.yaml']) {
  const from = DSH_HOME_FROM && join(DSH_HOME_FROM, file)
  if (from && existsSync(from)) copyFileSync(from, join(dshHome, file))
}
log(`throwaway home: ${home} (profile copied from ${PROFILE_FROM})`)

// ---- free port ------------------------------------------------------------

async function freePort() {
  for (let port = PORT_MIN; port <= PORT_MAX; port += 1) {
    const ok = await new Promise((res) => {
      const server = createServer()
      server.once('error', () => res(false))
      server.listen(port, '127.0.0.1', () => server.close(() => res(true)))
    })
    if (ok) return port
  }
  fail(`no free port in ${PORT_MIN}-${PORT_MAX}`)
}
const port = await freePort()

// ---- boot -----------------------------------------------------------------

const logFile = join(home, 'trial-host.log')
const fd = openSync(logFile, 'a')
const child = spawn(HOST_BIN, ['--profile', profileName, '--port', String(port), '--no-open'], {
  detached: true,
  stdio: ['ignore', fd, fd],
  env: { ...process.env, HOME: home, DSH_HOME: dshHome, NO_PROXY: '*', no_proxy: '*' },
})
child.unref()
log(`trial host booting: pid ${child.pid}, port ${port}, log ${logFile}`)

// Any HTTP response means the server is up — only a transport failure is down.
function answers() {
  return new Promise((res) => {
    const req = httpGet(`http://127.0.0.1:${port}/`, { timeout: 5000 }, (r) => {
      r.resume()
      res(true)
    })
    req.on('timeout', () => {
      req.destroy()
      res(false)
    })
    req.on('error', () => res(false))
  })
}

const deadline = Date.now() + HEALTH_TIMEOUT * 1000
let up = false
while (Date.now() < deadline) {
  if (await answers()) {
    up = true
    break
  }
  await new Promise((r) => setTimeout(r, 3000))
}

let entryUrl = `http://127.0.0.1:${port}/`
try {
  const match = /https?:\/\/\S+\?token=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, 'utf8'))
  if (match) entryUrl = match[0]
} catch {
  /* log unreadable */
}

if (!up) fail(`trial host never answered within ${HEALTH_TIMEOUT}s — see ${logFile}`)

console.log(
  JSON.stringify(
    {
      verdict: 'up',
      pid: child.pid,
      port,
      url: entryUrl,
      home,
      log: logFile,
      kill: `kill ${child.pid} && rm -rf ${home}`,
    },
    null,
    2,
  ),
)
if (!KEEP) {
  try {
    process.kill(child.pid, 'SIGTERM')
  } catch {
    /* already gone */
  }
  log('KEEP=0 — trial host stopped; home kept for log inspection')
}
