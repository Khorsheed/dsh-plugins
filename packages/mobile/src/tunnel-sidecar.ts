/** Detached Quick Tunnel sidecar: owns the cloudflared child so the public
 * domain outlives host restarts. The supervisor launches it detached and
 * adopts it on the next boot through the state file it heartbeats.
 *
 * It exits — taking cloudflared with it — on SIGTERM (explicit disable), when
 * cloudflared exits, or when the supervisor stops renewing its lease for the
 * grace window (host stopped or plugin uninstalled). A host restart pauses the
 * lease for seconds, well inside the window, so the domain survives it.
 * Zero dependencies; nothing here reads a credential. */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface SidecarConfig {
  binary: string
  port: number
  stateFile: string
  graceMs?: number
  heartbeatMs?: number
}

/** Heartbeat record the supervisor reads to adopt a live tunnel. */
export interface SidecarState {
  pid: number
  port: number
  host: string | null
  startedAt: number
  heartbeatAt: number
}

export const SIDECAR_HEARTBEAT_MS = 10_000
const QUICK_URL = /https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com/

/** The supervisor renews `<stateFile>.lease` (epoch ms) while it is alive. */
export const leaseFile = (stateFile: string) => `${stateFile}.lease`

function readLease(file: string): number | undefined {
  try { const value = Number(readFileSync(file, 'utf8')); return Number.isFinite(value) ? value : undefined } catch { return undefined }
}

export function runSidecar(config: SidecarConfig): void {
  const graceMs = config.graceMs ?? 10 * 60 * 1000
  const state: SidecarState = { pid: process.pid, port: config.port, host: null, startedAt: Date.now(), heartbeatAt: Date.now() }
  let child: ChildProcess | undefined
  let exiting = false

  const write = () => {
    state.heartbeatAt = Date.now()
    try {
      mkdirSync(dirname(config.stateFile), { recursive: true })
      const tmp = `${config.stateFile}.${process.pid}.tmp`
      writeFileSync(tmp, `${JSON.stringify(state)}\n`, 'utf8')
      renameSync(tmp, config.stateFile)
    } catch { /* the supervisor treats a stale heartbeat as dead */ }
  }
  const exit = () => {
    if (exiting) return
    exiting = true
    try { child?.kill() } catch { /* already gone */ }
    // A replacement sidecar may already own the file; remove only our own record.
    try { if ((JSON.parse(readFileSync(config.stateFile, 'utf8')) as Partial<SidecarState>).pid === process.pid) rmSync(config.stateFile, { force: true }) } catch { /* gone or unreadable */ }
    process.exit(0)
  }

  child = spawn(config.binary, ['tunnel', '--url', `http://127.0.0.1:${config.port}`, '--protocol', 'http2', '--no-autoupdate'],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const onData = (chunk: unknown) => {
    if (state.host) return
    const match = QUICK_URL.exec(String(chunk))
    if (match) { state.host = new URL(match[0]).host; write() }
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  child.on('error', exit)
  child.on('exit', exit)
  process.on('SIGTERM', exit)
  process.on('SIGINT', exit)
  process.on('SIGHUP', () => { /* detached: a closing terminal is not a stop request */ })

  write()
  setInterval(() => {
    write()
    const renewed = Math.max(readLease(leaseFile(config.stateFile)) ?? 0, state.startedAt)
    if (Date.now() - renewed >= graceMs) exit()
  }, config.heartbeatMs ?? SIDECAR_HEARTBEAT_MS)
}

function isEntry(): boolean {
  try { return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]) } catch { return false }
}

if (isEntry()) {
  runSidecar(JSON.parse(process.argv[2] ?? '{}') as SidecarConfig)
}
