/** Quick Tunnel supervisor: keeps one cloudflared tunnel alive through a
 * detached sidecar and hot-binds its authority into the host trust fence at
 * runtime through the official config editor — no host restart, no wildcard
 * trust, no token in probes. Everything here is probed and degrades to
 * `unsupported`; the static publicOrigin deployment path is untouched.
 *
 * The sidecar (./tunnel-sidecar.ts) outlives the host process, so a host
 * restart adopts the running tunnel and keeps its domain — phones stay signed
 * in. Only a dead tunnel (sleep, reboot, edge drop) rotates to a new domain.
 *
 * Host services are located LAZILY: a strict `ctx.get` during composition
 * boot returns undefined for a fiber that is provided but not yet ACTIVE, so
 * a one-shot probe at apply time would bake a false "unsupported" forever. */
import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MobileTunnelReason, MobileTunnelStatus } from './protocol.ts'
import { edgeReady, publicOriginReachable } from './reachability.ts'
import { sameOriginAction } from './connect.ts'
import { SIDECAR_HEARTBEAT_MS, leaseFile, type SidecarConfig, type SidecarState } from './tunnel-sidecar.ts'

/** Structural slices of optional host services — probed, never hard-required. */
export interface ConfigEntryLike { options: { id?: string; name?: string; config?: unknown } }
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

/** Process boundary to the detached sidecar; injectable for tests. */
export interface SidecarControl {
  launch(config: SidecarConfig): void
  read(stateFile: string): SidecarState | undefined
  alive(pid: number): boolean
  stop(pid: number): void
}

export interface TunnelDeps {
  locate: TunnelLocate
  cloudflaredPath?: string | undefined
  stateFile?: string | undefined
  sidecar?: SidecarControl | undefined
  findBinary?: ((configured?: string) => string | undefined) | undefined
  probe?: ((origin: string) => Promise<boolean>) | undefined
  edgeProbe?: ((origin: string) => Promise<boolean>) | undefined
  sleep?: ((ms: number) => Promise<void>) | undefined
  now?: (() => number) | undefined
  healthIntervalMs?: number | undefined
  recoveryCooldownMs?: number | undefined
  maxRetryMs?: number | undefined
  wakeGapMs?: number | undefined
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
const CONNECTION_ROW = { id: 'connection', name: '@deepseek-ai/dsh-client-connection' }
const BINARY_CANDIDATES = ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared', '/usr/bin/cloudflared', '/bin/cloudflared']
/** Heartbeats older than this mean the sidecar is gone (or its pid was reused). */
const SIDECAR_STALE_MS = SIDECAR_HEARTBEAT_MS * 3

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

/** Ops-readable failure detail: the failing stage plus the error text, with
 * anything URL- or token-shaped redacted — a provider message must never
 * carry a credential into logs or the state file. */
export function failureDetail(stage: string, error: unknown): string {
  const raw = error instanceof Error ? (/^[a-z][a-z0-9-]*$/.test(error.message) ? error.message : `${error.name}: ${error.message}`) : 'unknown'
  const clean = raw.replace(/\b\w+:\/\/\S+/g, '<url>').replace(/token[=:]\s*\S+/gi, 'token=<redacted>').replace(/\s+/g, ' ').slice(0, 200)
  return `${stage}: ${clean}`
}

export const nodeSidecar: SidecarControl = {
  launch(config) {
    const script = fileURLToPath(new URL('./tunnel-sidecar.js', import.meta.url))
    spawn(process.execPath, [script, JSON.stringify(config)], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  },
  read(stateFile) {
    try {
      const parsed = JSON.parse(readFileSync(stateFile, 'utf8')) as Partial<SidecarState>
      return typeof parsed.pid === 'number' && typeof parsed.port === 'number' && typeof parsed.heartbeatAt === 'number'
        ? { pid: parsed.pid, port: parsed.port, host: typeof parsed.host === 'string' && QUICK_HOST.test(parsed.host) ? parsed.host : null,
            startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0, heartbeatAt: parsed.heartbeatAt }
        : undefined
    } catch { return undefined }
  },
  alive(pid) {
    try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
  },
  stop(pid) {
    try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
  },
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

function writeAtomic(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, file)
}

type Lifecycle = 'off' | 'starting' | 'ready' | 'recovering' | 'error'

export function createTunnelSupervisor(deps: TunnelDeps): TunnelSupervisor {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const probe = deps.probe ?? publicOriginReachable
  const edgeProbe = deps.edgeProbe ?? edgeReady
  const sidecar = deps.sidecar ?? nodeSidecar
  const findBinary = deps.findBinary ?? findCloudflared
  const healthIntervalMs = deps.healthIntervalMs ?? 20_000
  const recoveryCooldownMs = deps.recoveryCooldownMs ?? 10 * 60 * 1000
  const maxRetryMs = deps.maxRetryMs ?? 60 * 60 * 1000
  const wakeGapMs = deps.wakeGapMs ?? healthIntervalMs * 3
  const bootProbeMs = deps.bootProbeMs ?? 5_000
  const bootAttempts = deps.bootAttempts ?? 24
  const locate = deps.locate

  const stateFile = (): string | undefined => deps.stateFile ?? (locate.profileHome() ? join(locate.profileHome()!, 'state', 'mobile-quick-tunnel.json') : undefined)
  const sidecarFile = (): string | undefined => { const file = stateFile(); return file ? file.replace(/\.json$/, '.sidecar.json') : undefined }
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

  // Persisted enablement loads once the profile home resolves, which may be
  // after apply — reading it eagerly would silently drop it on a slow boot.
  let loaded = false
  let enabled = false
  let origin: string | null = null
  let lifecycle: Lifecycle = 'off'
  let lastError: string | undefined
  let disposed = false
  let starting = false
  let failures = 0
  let startFailures = 0
  let lastRecovery = 0
  let lastTick = 0
  let healthTimer: ReturnType<typeof setInterval> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  function load(): boolean {
    if (loaded) return true
    const file = stateFile()
    if (!file) return false
    const persisted = readPersisted(file)
    enabled = persisted.enabled
    origin = persisted.origin
    loaded = true
    return true
  }

  const status = (): MobileTunnelStatus => {
    load()
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
    try { writeAtomic(file, `${JSON.stringify(state, null, 2)}\n`) } catch { /* state is a convenience, never a hard failure */ }
  }

  /** Renew the sidecar's lease; a lapsed lease stops the tunnel. */
  function renewLease(): void {
    const file = sidecarFile()
    if (file) try { writeAtomic(leaseFile(file), String(now())) } catch { /* the sidecar's grace window absorbs a missed renewal */ }
  }

  /** The running sidecar, if its heartbeat is fresh and its process alive. */
  function liveSidecar(): SidecarState | undefined {
    const file = sidecarFile()
    const state = file ? sidecar.read(file) : undefined
    return state && now() - state.heartbeatAt < SIDECAR_STALE_MS && sidecar.alive(state.pid) ? state : undefined
  }

  function stopSidecar(): void {
    const state = liveSidecar()
    if (state) sidecar.stop(state.pid)
    const file = sidecarFile()
    if (file) try { rmSync(file, { force: true }) } catch { /* best effort */ }
  }

  async function bind(nextHost?: string): Promise<void> {
    const editor = locate.configEditor()
    if (!editor) throw new Error('no-config-editor')
    const entry = editor.entries().find(candidate => candidate.options?.id === CONNECTION_ROW.id && candidate.options?.name === CONNECTION_ROW.name)
    if (!entry) throw new Error('no-connection-entry')
    const managed = origin ? new URL(origin).host : undefined
    // An adopted tunnel is usually already trusted: skip the profile write
    // (and its connection reload) instead of rewriting an identical list.
    const stored = (entry.options.config as { trustedHosts?: unknown } | undefined)?.trustedHosts
    if (nextHost && nextHost === managed && Array.isArray(stored) && stored.includes(nextHost)) return
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

  async function waitForPort(timeoutMs: number): Promise<number> {
    const deadline = now() + timeoutMs
    for (;;) {
      const port = locate.webServer()?.port
      if (typeof port === 'number' && port > 0) return port
      if (now() >= deadline) throw new Error('port-timeout')
      await sleep(1000)
    }
  }

  /** Adopt the running sidecar for this port, or launch a fresh one. */
  async function acquireTunnel(port: number, timeoutMs: number): Promise<string> {
    const running = liveSidecar()
    if (running?.host && running.port === port) return running.host
    // A live sidecar on this port that has not announced yet is adopted and awaited.
    if (running?.port !== port) {
      if (running) stopSidecar()
      renewLease()
      sidecar.launch({ binary: binary()!, port, stateFile: sidecarFile()! })
    }
    const deadline = now() + timeoutMs
    for (;;) {
      await sleep(500)
      if (disposed) throw new Error('disposed')
      const state = sidecar.read(sidecarFile()!)
      if (state?.host && state.port === port) return state.host
      if (state && !sidecar.alive(state.pid)) throw new Error('tunnel-exited')
      if (now() >= deadline) { stopSidecar(); throw new Error('start-timeout') }
    }
  }

  async function waitEdge(target: string, timeoutMs: number, accept: (value: string) => Promise<boolean>): Promise<void> {
    const deadline = now() + timeoutMs
    for (;;) {
      if (!liveSidecar()) throw new Error('tunnel-exited')
      if (await accept(target)) return
      if (now() >= deadline) throw new Error('edge-timeout')
      await sleep(3000)
    }
  }

  async function start(): Promise<void> {
    if (disposed || starting || !load() || !enabled) return
    if (supportReason()) return
    starting = true
    lifecycle = origin ? 'recovering' : 'starting'
    let stage = 'port'
    try {
      const port = await waitForPort(60_000)
      stage = 'tunnel'
      const host = await acquireTunnel(port, 60_000)
      const next = `https://${host}`
      stage = 'edge'
      await waitEdge(next, 90_000, edgeProbe)
      stage = 'bind'
      await bind(host)
      stage = 'verify'
      await waitEdge(next, 30_000, probe)
      origin = next
      failures = 0
      startFailures = 0
      lastError = undefined
      persist()
      lifecycle = 'ready'
    } catch (error) {
      // A trust-write failure (e.g. the profile locked by a deploy) says
      // nothing about the tunnel: keep it so the retry re-adopts its domain.
      if (stage === 'edge' || stage === 'tunnel') stopSidecar()
      startFailures += 1
      lastError = failureDetail(stage, error)
      console.error(`[mobile] quick-tunnel start cycle ${startFailures} failed: ${lastError}`)
      persist()
      lifecycle = startFailures >= 3 ? 'error' : 'recovering'
      scheduleRetry()
    } finally {
      starting = false
    }
  }

  /** Retries never stop while enabled: cooldown-spaced at first, then backing
   * off to `maxRetryMs` so a long outage heals by itself without hammering. */
  function scheduleRetry(): void {
    clearTimeout(retryTimer)
    const backoff = startFailures >= 3 ? Math.min(maxRetryMs, recoveryCooldownMs * 2 ** (startFailures - 3)) : recoveryCooldownMs
    const wait = Math.max(0, backoff - (now() - lastRecovery)) + Math.floor(Math.random() * recoveryCooldownMs * 0.1)
    retryTimer = setTimeout(() => { lastRecovery = now(); void start() }, wait)
    retryTimer.unref?.()
  }

  async function recover(immediate = false): Promise<void> {
    if (disposed || starting || !enabled) return
    lifecycle = 'recovering'
    stopSidecar()
    if (immediate || now() - lastRecovery >= recoveryCooldownMs) { lastRecovery = now(); void start() }
    else scheduleRetry()
  }

  /** One timer for the whole enabled lifetime: it renews the lease in every
   * state (a kept sidecar must survive a long retry backoff) and health-checks
   * only once the entry is ready. */
  function armHealth(): void {
    clearInterval(healthTimer)
    renewLease()
    lastTick = now()
    healthTimer = setInterval(() => {
      renewLease()
      // Timers freeze while the machine sleeps; a long gap means we just woke
      // up and the tunnel is likely dead — check now and skip the cooldown.
      const woke = now() - lastTick > wakeGapMs
      lastTick = now()
      if (disposed || lifecycle !== 'ready' || !origin || starting) return
      if (!liveSidecar()) { void recover(woke); return }
      void (async () => {
        if (await probe(origin!)) { failures = 0; return }
        failures += 1
        if (woke || failures >= 3) { failures = 0; void recover(woke) }
      })()
    }, healthIntervalMs)
    healthTimer.unref?.()
  }

  /** A persisted enablement boots while services may still be starting; retry
   * through the boot window instead of baking a false `unsupported`. */
  async function bootStart(): Promise<void> {
    for (let attempt = 0; attempt < bootAttempts; attempt++) {
      if (disposed) return
      if (load()) {
        if (!enabled) return
        if (!healthTimer) armHealth()
        if (!supportReason()) { void start(); return }
      }
      await sleep(bootProbeMs)
    }
  }

  async function enableNow(): Promise<MobileTunnelStatus> {
    const reason = supportReason()
    if (reason || !load()) return status()
    enabled = true
    lastError = undefined
    persist()
    if (!healthTimer) armHealth()
    if (lifecycle === 'off' || lifecycle === 'error') {
      clearTimeout(retryTimer)
      startFailures = 0; lastRecovery = 0; void start()
    }
    return status()
  }

  async function disableNow(): Promise<MobileTunnelStatus> {
    load()
    enabled = false
    failures = 0
    lastError = undefined
    clearTimeout(retryTimer)
    clearInterval(healthTimer)
    healthTimer = undefined
    stopSidecar()
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

  void bootStart()

  return {
    status,
    enable: enableNow,
    disable: disableNow,
    managedOrigin: () => (enabled && origin ? origin : undefined),
    /** Leaves the sidecar running: a restart re-adopts it, and an uninstall
     * lets its lease lapse so it stops by itself. */
    dispose(): void {
      disposed = true
      clearTimeout(retryTimer)
      clearInterval(healthTimer)
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
