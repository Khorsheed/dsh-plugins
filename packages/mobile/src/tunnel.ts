/** Quick Tunnel supervisor: owns one cloudflared child process and hot-binds
 * its authority into the host trust fence at runtime through the official
 * config editor — no host restart, no wildcard trust, no token in probes.
 * Everything here is probed and degrades to `unsupported`; the static
 * publicOrigin deployment path is untouched.
 *
 * Host services are located LAZILY: a strict `ctx.get` during composition
 * boot returns undefined for a fiber that is provided but not yet ACTIVE, so
 * a one-shot probe at apply time would bake a false "unsupported" forever.
 * Support is re-evaluated on every status/enable/start, and a persisted
 * enablement retries through the boot window instead of giving up. */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { accessSync, constants, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { MobileTunnelReason, MobileTunnelStatus } from './protocol.ts'
import { edgeReady, publicOriginReachable } from './reachability.ts'
import { sameOriginAction } from './connect.ts'

/** Structural slices of optional host services — probed, never hard-required. */
export interface ConfigEntryLike { options: { id?: string; name?: string } }
export interface ConfigEditorLike {
  entries(): ConfigEntryLike[]
  edit(entry: ConfigEntryLike, change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>): Promise<void>
}
export interface WebStartupLike { trustedHosts?: unknown }
export interface WebServerLike { port?: number; protocol?: string }

/** Fresh reads of the optional host capabilities; called on every decision. */
export interface TunnelLocate {
  configEditor: () => ConfigEditorLike | undefined
  webStartup: () => WebStartupLike | undefined
  webServer: () => WebServerLike | undefined
  profileHome: () => string | undefined
}

export interface TunnelDeps {
  locate: TunnelLocate
  cloudflaredPath?: string | undefined
  stateFile?: string | undefined
  spawnProcess?: typeof spawn
  findBinary?: ((configured?: string) => string | undefined) | undefined
  probe?: ((origin: string) => Promise<boolean>) | undefined
  edgeProbe?: ((origin: string) => Promise<boolean>) | undefined
  sleep?: ((ms: number) => Promise<void>) | undefined
  now?: (() => number) | undefined
  healthIntervalMs?: number | undefined
  recoveryCooldownMs?: number | undefined
  bootProbeMs?: number | undefined
  bootAttempts?: number | undefined
}

export interface TunnelSupervisor {
  status(): MobileTunnelStatus
  enable(): Promise<MobileTunnelStatus>
  disable(): Promise<MobileTunnelStatus>
  managedOrigin(): string | undefined
  dispose(): void
}

export const QUICK_HOST = /^[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/
const QUICK_URL = /https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com/
const CONNECTION_ROW = { id: 'connection', name: '@deepseek-ai/dsh-client-connection' }
const BINARY_CANDIDATES = ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared', '/usr/bin/cloudflared', '/bin/cloudflared']

function authorityHost(authority: string): string {
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']')
    return close > 0 ? authority.slice(0, close + 1) : authority
  }
  const colon = authority.lastIndexOf(':')
  return colon > 0 ? authority.slice(0, colon) : authority
}

/** The trust list for a rotation: launch values and operator entries are
 * always kept (the bundle row documents exactly this shape), only the
 * supervisor's own previous domain is replaced. A static fallback domain —
 * even a quick-tunnel one from the launch command — must survive both
 * rotation and disable. Exact authorities only — wildcards stay impossible. */
export function rotateTrustedHosts(base: readonly unknown[], nextHost?: string, managedHost?: string): string[] {
  const kept = base.filter((entry): entry is string => typeof entry === 'string'
    && (!managedHost || authorityHost(entry) !== managedHost))
  return [...new Set(nextHost ? [...kept, nextHost] : kept)]
}

export function findCloudflared(configured?: string): string | undefined {
  const candidates = configured ? [configured] : BINARY_CANDIDATES
  for (const candidate of candidates) {
    try { accessSync(candidate, constants.X_OK); return candidate } catch { /* try the next candidate */ }
  }
  if (configured) return undefined
  try {
    const found = spawnSync('which', ['cloudflared'], { encoding: 'utf8', timeout: 3000 })
    const path = found.status === 0 ? found.stdout.trim().split('\n')[0] : ''
    return path || undefined
  } catch { return undefined }
}

interface PersistedState { enabled: boolean; origin: string | null; updatedAt: string; lastError?: string }

function cleanOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && QUICK_HOST.test(url.hostname) && !url.port
      && url.pathname === '/' && !url.search && !url.hash ? url.origin : null
  } catch { return null }
}

function readPersisted(file: string): PersistedState {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<PersistedState>
    return { enabled: parsed.enabled === true, origin: cleanOrigin(parsed.origin),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      ...(typeof parsed.lastError === 'string' ? { lastError: parsed.lastError } : {}) }
  } catch { return { enabled: false, origin: null, updatedAt: '' } }
}

function writePersisted(file: string, state: PersistedState): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

type Lifecycle = 'off' | 'starting' | 'ready' | 'recovering' | 'error'

export function createTunnelSupervisor(deps: TunnelDeps): TunnelSupervisor {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const probe = deps.probe ?? publicOriginReachable
  const edgeProbe = deps.edgeProbe ?? edgeReady
  const spawnProcess = deps.spawnProcess ?? spawn
  const findBinary = deps.findBinary ?? findCloudflared
  const healthIntervalMs = deps.healthIntervalMs ?? 45_000
  const recoveryCooldownMs = deps.recoveryCooldownMs ?? 10 * 60 * 1000
  const bootProbeMs = deps.bootProbeMs ?? 5_000
  const bootAttempts = deps.bootAttempts ?? 24
  const locate = deps.locate

  const stateFile = (): string | undefined => deps.stateFile ?? (locate.profileHome() ? join(locate.profileHome()!, 'state', 'mobile-quick-tunnel.json') : undefined)
  // Binary discovery hits the filesystem (and a `which` fallback), so it is
  // cached for a minute instead of blocking every status poll.
  let binaryCache: { at: number; value: string | undefined } | undefined
  const binary = (): string | undefined => {
    if (!binaryCache || now() - binaryCache.at > 60_000) binaryCache = { at: now(), value: findBinary(deps.cloudflaredPath) }
    return binaryCache.value
  }
  const supportReason = (): MobileTunnelReason | undefined => {
    const webServer = locate.webServer()
    return !stateFile() ? 'no-profile'
      : !locate.configEditor() ? 'no-config-editor'
      : !webServer ? 'no-web-server'
      : webServer.protocol !== undefined && webServer.protocol !== 'http:' ? 'tls-host'
      : !binary() ? 'no-cloudflared'
      : undefined
  }

  const file = stateFile()
  const persisted = file ? readPersisted(file) : { enabled: false, origin: null, updatedAt: '' }
  let enabled = persisted.enabled
  let origin = persisted.origin
  let lifecycle: Lifecycle = 'off'
  let lastError: string | undefined
  let child: ChildProcess | undefined
  let intentionalKill = false
  let disposed = false
  let starting = false
  let failures = 0
  let startFailures = 0
  let lastRecovery = 0
  let healthTimer: ReturnType<typeof setInterval> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  const status = (): MobileTunnelStatus => {
    if (lifecycle === 'off') {
      const reason = supportReason()
      return reason ? { state: 'unsupported', origin, reason } : { state: 'off', origin }
    }
    return { state: lifecycle, origin, ...(lifecycle === 'error' ? { reason: 'start-failed' as const, ...(lastError ? { detail: lastError } : {}) } : {}) }
  }

  function persist(): void {
    const file = stateFile()
    if (!file) return
    const state: PersistedState = { enabled, origin, updatedAt: new Date().toISOString(), ...(lastError ? { lastError } : {}) }
    try { writePersisted(file, state) } catch { /* state is a convenience, never a hard failure */ }
  }

  async function bind(nextHost?: string): Promise<void> {
    const editor = locate.configEditor()
    if (!editor) throw new Error('no-config-editor')
    const entry = editor.entries().find(candidate => candidate.options?.id === CONNECTION_ROW.id && candidate.options?.name === CONNECTION_ROW.name)
    if (!entry) throw new Error('no-connection-entry')
    const managed = origin ? new URL(origin).host : undefined
    await editor.edit(entry, (current) => {
      const stored = current.trustedHosts
      // Launch flags come first (a persisted literal may have masked the
      // bundle's !!js expression), then whatever the operator added since.
      const base = [
        ...(Array.isArray(locate.webStartup()?.trustedHosts) ? locate.webStartup()!.trustedHosts as unknown[] : []),
        ...(Array.isArray(stored) ? stored : []),
      ]
      return { ...current, trustedHosts: rotateTrustedHosts(base, nextHost, managed) }
    })
  }

  function killChild(): void {
    if (!child) return
    intentionalKill = true
    try { child.kill() } catch { /* already gone */ }
    child = undefined
  }

  async function waitForPort(timeoutMs: number): Promise<number> {
    const deadline = now() + timeoutMs
    for (;;) {
      const port = locate.webServer()?.port
      if (typeof port === 'number' && port > 0) return port
      if (now() >= deadline) throw new Error('port-timeout')
      await sleep(1000)
    }
  }

  function spawnTunnel(port: number, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let proc: ChildProcess
      try {
        proc = spawnProcess(binary()!, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--protocol', 'http2', '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (error) { reject(error); return }
      child = proc
      intentionalKill = false
      if (disposed) { killChild(); reject(new Error('disposed')); return }
      let settled = false
      const timer = setTimeout(() => { if (!settled) { settled = true; killChild(); reject(new Error('start-timeout')) } }, timeoutMs)
      const onData = (chunk: unknown) => {
        if (settled) return
        const match = QUICK_URL.exec(String(chunk))
        if (match) { settled = true; clearTimeout(timer); resolve(new URL(match[0]).host) }
      }
      proc.stdout?.on('data', onData)
      proc.stderr?.on('data', onData)
      proc.on('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error) } })
      proc.on('exit', () => {
        const wasIntentional = intentionalKill
        if (child === proc) child = undefined
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error('tunnel-exited')) }
        else if (!wasIntentional && !disposed) void recover()
      })
    })
  }

  async function waitEdge(target: string, timeoutMs: number, accept: (value: string) => Promise<boolean>): Promise<void> {
    const deadline = now() + timeoutMs
    for (;;) {
      if (!child) throw new Error('tunnel-exited')
      if (await accept(target)) return
      if (now() >= deadline) throw new Error('edge-timeout')
      await sleep(3000)
    }
  }

  async function start(): Promise<void> {
    if (disposed || starting || !enabled) return
    if (supportReason()) return
    starting = true
    lifecycle = origin ? 'recovering' : 'starting'
    try {
      const port = await waitForPort(60_000)
      const host = await spawnTunnel(port, 60_000)
      const next = `https://${host}`
      await waitEdge(next, 90_000, edgeProbe)
      await bind(host)
      await waitEdge(next, 30_000, probe)
      origin = next
      failures = 0
      startFailures = 0
      lastError = undefined
      persist()
      lifecycle = 'ready'
      armHealth()
    } catch (error) {
      killChild()
      startFailures += 1
      // Coded detail for ops: our own lowercase-hyphen causes pass through,
      // anything external collapses to its constructor name. Never log or
      // persist a provider message — it could carry a secret.
      lastError = error instanceof Error && /^[a-z][a-z0-9-]*$/.test(error.message) ? error.message
        : error instanceof Error ? error.name : 'unknown'
      console.error(`[mobile] quick-tunnel start cycle ${startFailures} failed: ${lastError}`)
      persist()
      if (startFailures >= 3) lifecycle = 'error'
      else { lifecycle = 'recovering'; scheduleRecovery() }
    } finally {
      starting = false
    }
  }

  function scheduleRecovery(): void {
    clearTimeout(retryTimer)
    const wait = Math.max(0, recoveryCooldownMs - (now() - lastRecovery)) + Math.floor(Math.random() * recoveryCooldownMs * 0.1)
    retryTimer = setTimeout(() => { lastRecovery = now(); void start() }, wait)
    retryTimer.unref?.()
  }

  async function recover(): Promise<void> {
    if (disposed || starting || !enabled) return
    lifecycle = 'recovering'
    killChild()
    if (now() - lastRecovery >= recoveryCooldownMs) { lastRecovery = now(); void start() }
    else scheduleRecovery()
  }

  function armHealth(): void {
    clearInterval(healthTimer)
    healthTimer = setInterval(() => {
      if (disposed || lifecycle !== 'ready' || !origin || starting) return
      void (async () => {
        if (await probe(origin!)) { failures = 0; return }
        failures += 1
        if (failures >= 3) { failures = 0; void recover() }
      })()
    }, healthIntervalMs)
    healthTimer.unref?.()
  }

  /** A persisted enablement boots while services may still be starting; retry
   * through the boot window instead of baking a false `unsupported`. */
  async function bootStart(): Promise<void> {
    for (let attempt = 0; attempt < bootAttempts; attempt++) {
      if (disposed || !enabled) return
      if (!supportReason()) { void start(); return }
      await sleep(bootProbeMs)
    }
  }

  async function enableNow(): Promise<MobileTunnelStatus> {
    const reason = supportReason()
    if (reason) return status()
    enabled = true
    lastError = undefined
    persist()
    if (lifecycle === 'off' || lifecycle === 'error') { startFailures = 0; lastRecovery = 0; void start() }
    return status()
  }

  async function disableNow(): Promise<MobileTunnelStatus> {
    enabled = false
    failures = 0
    lastError = undefined
    clearTimeout(retryTimer)
    clearInterval(healthTimer)
    killChild()
    if (!supportReason()) {
      // bind() prunes the managed host read from `origin`, so it must run
      // before origin is cleared; a static fallback domain is never touched.
      try { await bind(undefined) } catch { /* a dead grant is inert; the next bind prunes it */ }
    }
    origin = null
    persist()
    lifecycle = 'off'
    return status()
  }

  if (enabled) void bootStart()

  return {
    status,
    enable: enableNow,
    disable: disableNow,
    managedOrigin: () => (enabled && origin ? origin : undefined),
    dispose(): void {
      disposed = true
      clearTimeout(retryTimer)
      clearInterval(healthTimer)
      killChild()
    },
  }
}

const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }

/** Authenticated operator endpoint; enable/disable are explicit same-origin
 * actions, exactly like issuing a login QR. */
export function tunnelResponse(tunnel: TunnelSupervisor) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'GET') return Response.json(tunnel.status(), { headers })
    if (!sameOriginAction(request) || request.headers.get('content-type') !== 'application/json') {
      return Response.json({ error: 'forbidden' }, { status: 403, headers })
    }
    let action: unknown
    try { action = (await request.json() as { action?: unknown } | null)?.action } catch { return Response.json({ error: 'bad-request' }, { status: 400, headers }) }
    if (action === 'enable') return Response.json(await tunnel.enable(), { headers })
    if (action === 'disable') return Response.json(await tunnel.disable(), { headers })
    return Response.json({ error: 'bad-request' }, { status: 400, headers })
  }
}
