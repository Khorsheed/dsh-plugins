#!/usr/bin/env node
// restart-resume.mjs — detached supervisor for a guard-less self-restart,
// Node edition. Use this instead of restart-resume.sh where `setsid` does not
// exist (macOS): child_process.spawn(..., { detached: true }) IS setsid(2) —
// new session, reparented to init — so this script survives the teardown of
// the instance that spawns it. The logic mirrors restart-resume.sh exactly:
//
//   1. waits for the old process to die,
//   2. starts the new host,
//   3. polls a health URL until the server answers (ANY HTTP status code —
//      token-gated hosts answer a bare GET / with 401, and 401 is alive),
//   4. on failure kills the new host and rolls back to the OLD launch command,
//      health-checking that too,
//   5. records the outcome in a status file for the post-restart session.
//
// It never stops the old instance itself — the caller writes the handoff note,
// spawns this supervisor, verifies it is alive, and only then stops the old
// process.
//
// Required env:
//   OLD_PID        pid of the running instance to wait for
//   NEW_HOST_CMD   shell command that starts the new host (its stdout/stderr
//                  go to LOG_FILE; a token-gated host prints its `?token=` URL
//                  there, and this script copies it into the status file)
//   HEALTH_URL     URL the new host will answer once up (any status counts)
// Optional env:
//   ROLLBACK_CMD   shell command that starts the OLD host again
//   STATUS_FILE    outcome record (default: ./restart-resume.status)
//   LOG_FILE       new host's own stdout/stderr (default: ./restart-resume.host.log)
//   STOP_TIMEOUT   seconds to wait for OLD_PID to exit (default 120)
//   HEALTH_TIMEOUT seconds to poll HEALTH_URL per boot attempt (default 120)
//
// Exit code: 0 = new host healthy; 1 = rollback healthy; 2 = everything failed.

import { spawn } from 'node:child_process'
import { openSync, readFileSync, writeFileSync } from 'node:fs'
import { get as httpGet } from 'node:http'

// Self-detach: no matter HOW we were launched (nohup, plain `&`, a sandboxed
// shell that reaps its process group), the durable supervisor runs in its own
// session. The first process re-spawns itself fully detached and exits at
// once. (Observed in the wild: `nohup node restart-resume.mjs &` is NOT a
// detach — the old instance's teardown took the supervisor with it.)
if (process.env.RESTART_RESUME_DETACHED !== '1') {
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname], {
    env: { ...process.env, RESTART_RESUME_DETACHED: '1' },
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  console.error(`restart-resume.mjs: detached supervisor pid ${child.pid}`)
  process.exit(0)
}

const OLD_PID = process.env.OLD_PID
const NEW_HOST_CMD = process.env.NEW_HOST_CMD
const HEALTH_URL = process.env.HEALTH_URL
const ROLLBACK_CMD = process.env.ROLLBACK_CMD || ''
const STATUS_FILE = process.env.STATUS_FILE || './restart-resume.status'
const LOG_FILE = process.env.LOG_FILE || './restart-resume.host.log'
const STOP_TIMEOUT = Number(process.env.STOP_TIMEOUT || 120)
const HEALTH_TIMEOUT = Number(process.env.HEALTH_TIMEOUT || 120)

if (!OLD_PID || !NEW_HOST_CMD || !HEALTH_URL) {
  console.error('restart-resume.mjs: OLD_PID, NEW_HOST_CMD and HEALTH_URL are required')
  process.exit(2)
}

const log = (msg) => console.log(`[restart-resume ${new Date().toISOString().slice(11, 19)}] ${msg}`)

// A token-gated host prints its entry URL (with ?token=) on stdout at boot;
// surface it in the status file so the post-restart session can hand it over.
function tokenUrl() {
  try {
    const match = /https?:\/\/\S+\?token=[A-Za-z0-9_-]+/.exec(readFileSync(LOG_FILE, 'utf8'))
    return match ? match[0] : undefined
  } catch {
    return undefined
  }
}

// On success, hand the user straight into the new host: a token-gated host's
// old bookmarks are dead (401), so the supervisor — the only thing alive
// across the restart — opens the entry URL itself. GUI-less deployments skip
// silently; the status file always carries the URL either way.
function openForUser(url) {
  if (!url || process.env.RESTART_RESUME_NO_OPEN === '1') return
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
  try {
    const child = spawn(opener, [url], { detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
  } catch {
    /* headless host: the status file carries the URL */
  }
}

function status(verdict, detail) {
  const token = tokenUrl()
  writeFileSync(
    STATUS_FILE,
    `verdict: ${verdict}\nat: ${new Date().toISOString()}\ndetail: ${detail}\n${token ? `url: ${token}\n` : ''}`,
  )
}

function pidAlive(pid) {
  try {
    process.kill(Number(pid), 0)
    return true
  } catch {
    return false
  }
}

// Any HTTP response means the server is up — only a transport failure is down.
function healthy() {
  return new Promise((res) => {
    const req = httpGet(HEALTH_URL, { timeout: 5000 }, (r) => {
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

async function waitDead(pid, sec) {
  const deadline = Date.now() + sec * 1000
  while (pidAlive(pid)) {
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, 2000))
  }
  return true
}

async function waitHealthy(sec) {
  const deadline = Date.now() + sec * 1000
  while (!(await healthy())) {
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, 3000))
  }
  return true
}

// boot — start a host fully detached from this supervisor, return its pid.
function boot(cmd) {
  log(`booting: ${cmd}`)
  const fd = openSync(LOG_FILE, 'a')
  const child = spawn('sh', ['-c', cmd], { detached: true, stdio: ['ignore', fd, fd], env: process.env })
  child.unref()
  return child.pid
}

function killTree(pid) {
  // detached:true made the child a process-group leader; kill the GROUP
  // (negative pid), or the host children outlive their wrapper — and the
  // rollback health check would misread a surviving NEW host as the old one.
  for (const sig of ['SIGTERM', 'SIGKILL']) {
    try {
      process.kill(-pid, sig)
    } catch {
      try {
        process.kill(pid, sig)
      } catch {
        /* already gone */
      }
    }
  }
}

async function main() {
  status('supervising', `waiting for old pid ${OLD_PID} to exit`)
  log(`waiting for old pid ${OLD_PID} to exit (up to ${STOP_TIMEOUT}s)`)
  if (!(await waitDead(OLD_PID, STOP_TIMEOUT))) {
    status('aborted', `old pid ${OLD_PID} still alive after ${STOP_TIMEOUT}s — nothing was restarted`)
    log('ABORT: old instance did not exit; leaving it running untouched')
    process.exit(2)
  }

  const newPid = boot(NEW_HOST_CMD)
  status('booting-new', `new host pid ${newPid}, polling ${HEALTH_URL}`)
  log(`new host pid ${newPid}; polling ${HEALTH_URL} (up to ${HEALTH_TIMEOUT}s)`)
  if (await waitHealthy(HEALTH_TIMEOUT)) {
    status('upgraded', `new host healthy at ${HEALTH_URL} (pid ${newPid})`)
    openForUser(tokenUrl())
    log('new host is healthy — upgrade complete')
    process.exit(0)
  }

  log(`new host FAILED its health check — killing pid ${newPid} and rolling back`)
  killTree(newPid)
  await new Promise((r) => setTimeout(r, 2000))

  if (!ROLLBACK_CMD) {
    status('down', `new host failed health check; no ROLLBACK_CMD given — manual recovery needed (see ${LOG_FILE})`)
    process.exit(2)
  }

  const rollPid = boot(ROLLBACK_CMD)
  status('rolling-back', `old host pid ${rollPid}, polling ${HEALTH_URL}`)
  log(`rollback started (pid ${rollPid}); polling ${HEALTH_URL}`)
  if (await waitHealthy(HEALTH_TIMEOUT)) {
    status('rolled-back', `new host failed; old host healthy again at ${HEALTH_URL} (pid ${rollPid}) — see ${LOG_FILE} for the boot error`)
    process.exit(1)
  }

  status('down', `new host failed AND rollback failed — instance is DOWN; recover manually with the old launch command (see ${LOG_FILE})`)
  process.exit(2)
}

main().catch((error) => {
  status('down', `supervisor crash: ${String(error)}`)
  process.exit(2)
})
