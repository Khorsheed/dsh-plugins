import { existsSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTunnelSupervisor, failureDetail, findCloudflared, nodeSidecar, rotateTrustedHosts, tunnelResponse, type SidecarControl, type TunnelDeps, type TunnelLocate, type TunnelSupervisor } from '../src/tunnel.ts'
import type { SidecarConfig } from '../src/tunnel-sidecar.ts'

/** Fake detached sidecars: real state files, fake processes. */
class FakeSidecars implements SidecarControl {
  launched: (SidecarConfig & { pid: number })[] = []
  dead = new Set<number>()
  stopped = new Set<number>()
  private nextPid = 1000
  constructor(private readonly domains: string[], private readonly clock: () => number = Date.now) {}
  launch(config: SidecarConfig) {
    const pid = this.nextPid++
    this.launched.push({ ...config, pid })
    const host = this.domains.shift() ?? `rotated-${this.launched.length}-two-three.trycloudflare.com`
    mkdirSync(join(config.stateFile, '..'), { recursive: true })
    writeFileSync(config.stateFile, JSON.stringify({ pid, port: config.port, host, startedAt: this.clock(), heartbeatAt: this.clock() }))
  }
  /** A live sidecar keeps heartbeating, on the supervisor's clock. */
  read(file: string) { const state = nodeSidecar.read(file); return state && this.alive(state.pid) ? { ...state, heartbeatAt: this.clock() } : state }
  alive(pid: number) { return !this.dead.has(pid) && !this.stopped.has(pid) }
  stop(pid: number) { this.stopped.add(pid) }
  crash(index = this.launched.length - 1) { this.dead.add(this.launched[index]!.pid) }
}

function fakeEditor(stored: Record<string, unknown> = { trustedHosts: { __jsExpr: 'ctx.webStartup.trustedHosts' } }) {
  // The loader entry's options.config is the live config the host applied.
  const entry = { options: { id: 'connection', name: '@deepseek-ai/dsh-client-connection', config: stored } }
  return {
    entry,
    stored,
    entries: () => [entry],
    edit: vi.fn(async (_entry: unknown, change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>) => {
      Object.assign(stored, change(structuredClone(stored), {}))
    }),
  }
}

const dirs: string[] = []
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })

function makeDeps(overrides: Partial<TunnelDeps> & { domains?: string[]; locate?: Partial<TunnelLocate>; dir?: string; sidecars?: FakeSidecars } = {}) {
  const { domains = ['alpha-beta-gamma-delta.trycloudflare.com'], locate: locateOverrides, dir: givenDir, sidecars: givenSidecars, ...rest } = overrides
  const dir = givenDir ?? mkdtempSync(join(tmpdir(), 'dsh-mobile-tunnel-'))
  dirs.push(dir)
  const editor = fakeEditor()
  const sidecars = givenSidecars ?? new FakeSidecars([...domains], rest.now)
  const deps: TunnelDeps = {
    locate: {
      configEditor: () => editor,
      webStartup: () => ({ trustedHosts: ['launch.internal'] }),
      webServer: () => ({ port: 3080, protocol: 'http:' }),
      profileHome: () => dir,
      ...locateOverrides,
    },
    findBinary: () => '/fake/cloudflared',
    sidecar: sidecars,
    probe: vi.fn(async () => true),
    edgeProbe: vi.fn(async () => true),
    // Yield to a macrotask so real timers (vi.waitFor, cooldowns) can fire
    // between supervisor polling iterations.
    sleep: () => new Promise<void>(resolve => setTimeout(resolve, 0)),
    healthIntervalMs: 5,
    wakeGapMs: 60_000,
    recoveryCooldownMs: 60_000,
    bootProbeMs: 1,
    ...rest,
  }
  return { deps, editor, sidecars, dir }
}

const ready = (tunnel: TunnelSupervisor) => vi.waitFor(() => expect(tunnel.status().state).toBe('ready'), { timeout: 2000, interval: 5 })
const stateOf = (dir: string) => JSON.parse(readFileSync(join(dir, 'state', 'mobile-quick-tunnel.json'), 'utf8'))

describe('rotateTrustedHosts', () => {
  it('prunes only the managed host, keeps launch and operator authorities — even stale quick-tunnel ones — and appends the live one', () => {
    expect(rotateTrustedHosts(['launch.internal', 'dead-launch-one-two.trycloudflare.com', 'managed-prev-one.trycloudflare.com', 'operator.example.test:8443', 'launch.internal'],
      'live-four-five-six.trycloudflare.com', 'managed-prev-one.trycloudflare.com'))
      .toEqual(['launch.internal', 'dead-launch-one-two.trycloudflare.com', 'operator.example.test:8443', 'live-four-five-six.trycloudflare.com'])
  })
  it('prunes without appending when no live host is given, and a launch-flag quick domain survives disable', () => {
    expect(rotateTrustedHosts(['managed-prev-one.trycloudflare.com', 'launch.internal'], undefined, 'managed-prev-one.trycloudflare.com')).toEqual(['launch.internal'])
    expect(rotateTrustedHosts(['dead-launch-one-two.trycloudflare.com', 'launch.internal'])).toEqual(['dead-launch-one-two.trycloudflare.com', 'launch.internal'])
  })
  it('matches the managed host through ports and ignores non-string entries', () => {
    expect(rotateTrustedHosts(['managed-one-two.trycloudflare.com:8443', 42, 'ok.trycloudflare.com.evil.test'], undefined, 'managed-one-two.trycloudflare.com'))
      .toEqual(['ok.trycloudflare.com.evil.test'])
  })
})

describe('findCloudflared', () => {
  it('honours an executable configured path and rejects a missing one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-mobile-bin-'))
    dirs.push(dir)
    const bin = join(dir, 'cloudflared')
    writeFileSync(bin, '#!/bin/sh\n')
    chmodSync(bin, 0o755)
    expect(findCloudflared(bin)).toBe(bin)
    expect(findCloudflared(join(dir, 'missing'))).toBeUndefined()
  })
})

function stubSupervisor(status: { state: string; origin: string | null }): TunnelSupervisor & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    status: () => status as ReturnType<TunnelSupervisor['status']>,
    enable: vi.fn(async () => { calls.push('enable'); return status as ReturnType<TunnelSupervisor['status']> }),
    disable: vi.fn(async () => { calls.push('disable'); return status as ReturnType<TunnelSupervisor['status']> }),
    managedOrigin: () => null,
    dispose: () => {},
  }
}

describe('tunnelResponse', () => {
  const post = (headers: Record<string, string> = {}, body = '{"action":"enable"}') => new Request('http://dsh.internal/api/mobile/tunnel', {
    method: 'POST', headers: { host: 'localhost:3080', origin: 'http://localhost:3080', 'content-type': 'application/json', ...headers }, body,
  })
  it('answers status on GET and dispatches explicit same-origin actions', async () => {
    const tunnel = stubSupervisor({ state: 'off', origin: null })
    const response = tunnelResponse(tunnel)
    expect(await (await response(new Request('http://localhost/api/mobile/tunnel'))).json()).toEqual({ state: 'off', origin: null })
    expect((await response(post())).status).toBe(200)
    expect((await response(post({}, '{"action":"disable"}'))).status).toBe(200)
    expect(tunnel.calls).toEqual(['enable', 'disable'])
  })
  it('rejects cross-origin, form and malformed actions without dispatching', async () => {
    const tunnel = stubSupervisor({ state: 'off', origin: null })
    const response = tunnelResponse(tunnel)
    expect((await response(post({ origin: 'https://other.example.test' }))).status).toBe(403)
    expect((await response(post({ 'content-type': 'text/plain' }))).status).toBe(403)
    expect((await response(post({ origin: 'null' }))).status).toBe(403)
    expect((await response(post({}, 'not-json'))).status).toBe(400)
    expect((await response(post({}, '{"action":"restart"}'))).status).toBe(400)
    expect(tunnel.calls).toEqual([])
  })
})

describe('failureDetail', () => {
  it('names the stage, keeps host error text and redacts URL- and token-shaped content', () => {
    expect(failureDetail('tunnel', new Error('start-timeout'))).toBe('tunnel: start-timeout')
    expect(failureDetail('bind', new Error('Configuration entry is no longer available'))).toBe('bind: Error: Configuration entry is no longer available')
    expect(failureDetail('bind', new TypeError('fetch https://h.example/?token=abc failed token=xyz'))).toBe('bind: TypeError: fetch <url> failed token=<redacted>')
    expect(failureDetail('edge', 'weird')).toBe('edge: unknown')
  })
})

describe('quick tunnel supervisor', () => {
  it('reports unsupported with a reason when a capability is missing', () => {
    expect(createTunnelSupervisor(makeDeps({ locate: { profileHome: () => undefined } }).deps).status()).toMatchObject({ state: 'unsupported', reason: 'no-profile' })
    expect(createTunnelSupervisor(makeDeps({ locate: { configEditor: () => undefined } }).deps).status()).toMatchObject({ state: 'unsupported', reason: 'no-config-editor' })
    expect(createTunnelSupervisor(makeDeps({ locate: { webServer: () => undefined } }).deps).status()).toMatchObject({ state: 'unsupported', reason: 'no-web-server' })
    expect(createTunnelSupervisor(makeDeps({ locate: { webServer: () => ({ port: 3080, protocol: 'https:' }) } }).deps).status()).toMatchObject({ state: 'unsupported', reason: 'tls-host' })
    expect(createTunnelSupervisor(makeDeps({ findBinary: () => undefined }).deps).status()).toMatchObject({ state: 'unsupported', reason: 'no-cloudflared' })
  })

  it('reads the persisted enablement once the profile home resolves and starts through the boot window', async () => {
    const built = makeDeps({ bootAttempts: 10_000 })
    mkdirSync(join(built.dir, 'state'), { recursive: true })
    writeFileSync(join(built.dir, 'state', 'mobile-quick-tunnel.json'), JSON.stringify({ enabled: true, origin: null, updatedAt: '' }))
    let home: string | undefined
    let editor = false
    built.deps.locate = { ...built.deps.locate, profileHome: () => home, configEditor: () => (editor ? built.editor : undefined) }
    const tunnel = createTunnelSupervisor(built.deps)
    expect(tunnel.status()).toMatchObject({ state: 'unsupported', reason: 'no-profile' })
    setTimeout(() => { home = built.dir }, 20)
    setTimeout(() => { editor = true }, 50)
    await ready(tunnel)
    expect(built.sidecars.launched).toHaveLength(1)
    tunnel.dispose()
  })

  it('starts disabled and idle when nothing was persisted', () => {
    const { deps, sidecars } = makeDeps()
    const tunnel = createTunnelSupervisor(deps)
    expect(tunnel.status()).toEqual({ state: 'off', origin: null })
    expect(tunnel.managedOrigin()).toBeUndefined()
    expect(sidecars.launched).toHaveLength(0)
    tunnel.dispose()
  })

  it('enables: launches the sidecar, hot-binds the live authority, persists and renews the lease', async () => {
    const { deps, editor, sidecars, dir } = makeDeps()
    const tunnel = createTunnelSupervisor(deps)
    await tunnel.enable()
    await ready(tunnel)
    expect(sidecars.launched).toEqual([expect.objectContaining({ binary: '/fake/cloudflared', port: 3080, stateFile: join(dir, 'state', 'mobile-quick-tunnel.sidecar.json') })])
    expect(tunnel.managedOrigin()).toBe('https://alpha-beta-gamma-delta.trycloudflare.com')
    expect(editor.stored.trustedHosts).toEqual(['launch.internal', 'alpha-beta-gamma-delta.trycloudflare.com'])
    expect(stateOf(dir)).toMatchObject({ enabled: true, origin: 'https://alpha-beta-gamma-delta.trycloudflare.com' })
    expect(existsSync(join(dir, 'state', 'mobile-quick-tunnel.sidecar.json.lease'))).toBe(true)
    tunnel.dispose()
  })

  it('adopts the running tunnel after a host restart: same domain, no relaunch, no profile write', async () => {
    const first = makeDeps()
    const tunnel = createTunnelSupervisor(first.deps)
    await tunnel.enable()
    await ready(tunnel)
    tunnel.dispose()
    expect(first.sidecars.stopped.size).toBe(0)
    const editsBefore = first.editor.edit.mock.calls.length
    const again = createTunnelSupervisor({ ...first.deps })
    await ready(again)
    expect(again.managedOrigin()).toBe('https://alpha-beta-gamma-delta.trycloudflare.com')
    expect(first.sidecars.launched).toHaveLength(1)
    expect(first.editor.edit.mock.calls.length).toBe(editsBefore)
    again.dispose()
  })

  it('relaunches when the host comes back on a different port', async () => {
    const first = makeDeps()
    const tunnel = createTunnelSupervisor(first.deps)
    await tunnel.enable()
    await ready(tunnel)
    tunnel.dispose()
    const again = createTunnelSupervisor({ ...first.deps, locate: { ...first.deps.locate, webServer: () => ({ port: 3181, protocol: 'http:' }) } })
    await vi.waitFor(() => expect(again.managedOrigin()).toBe('https://rotated-2-two-three.trycloudflare.com'), { timeout: 2000, interval: 5 })
    expect(first.sidecars.stopped.has(first.sidecars.launched[0]!.pid)).toBe(true)
    expect(first.editor.stored.trustedHosts).toEqual(['launch.internal', 'rotated-2-two-three.trycloudflare.com'])
    again.dispose()
  })

  it('recovers a dead tunnel with a fresh domain and prunes the stale grant', async () => {
    const { deps, editor, sidecars } = makeDeps()
    const tunnel = createTunnelSupervisor(deps)
    await tunnel.enable()
    await ready(tunnel)
    ;(deps.probe as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    await vi.waitFor(() => expect(sidecars.launched).toHaveLength(2), { timeout: 2000, interval: 5 })
    ;(deps.probe as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    await ready(tunnel)
    expect(tunnel.status().origin).toBe('https://rotated-2-two-three.trycloudflare.com')
    expect(editor.stored.trustedHosts).toEqual(['launch.internal', 'rotated-2-two-three.trycloudflare.com'])
    expect(sidecars.stopped.has(sidecars.launched[0]!.pid)).toBe(true)
    tunnel.dispose()
  })

  it('recovers when the sidecar dies, then throttles further churn inside the cooldown', async () => {
    const { deps, sidecars } = makeDeps()
    const tunnel = createTunnelSupervisor(deps)
    await tunnel.enable()
    await ready(tunnel)
    sidecars.crash()
    await vi.waitFor(() => expect(sidecars.launched).toHaveLength(2), { timeout: 2000, interval: 5 })
    await ready(tunnel)
    sidecars.crash()
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(sidecars.launched).toHaveLength(2)
    expect(tunnel.status().state).toBe('recovering')
    tunnel.dispose()
  })

  it('skips the cooldown after waking from sleep', async () => {
    let offset = 0
    const { deps, sidecars } = makeDeps({ now: () => Date.now() + offset, wakeGapMs: 1000 })
    const tunnel = createTunnelSupervisor(deps)
    await tunnel.enable()
    await ready(tunnel)
    sidecars.crash()
    await vi.waitFor(() => expect(sidecars.launched).toHaveLength(2), { timeout: 2000, interval: 5 })
    await ready(tunnel)
    // Inside the 60s cooldown, but the clock jumped: the machine slept and
    // the edge dropped the tunnel. One failed probe is enough to rotate.
    ;(deps.probe as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)
    offset += 60 * 60 * 1000
    await vi.waitFor(() => expect(sidecars.launched).toHaveLength(3), { timeout: 2000, interval: 5 })
    await ready(tunnel)
    tunnel.dispose()
  })

  it('keeps retrying past three failures, keeps the tunnel through trust-write failures, and heals', async () => {
    const editor = fakeEditor()
    editor.edit.mockRejectedValue(new Error('Configuration entry is no longer available'))
    const { deps, sidecars, dir } = makeDeps({ locate: { configEditor: () => editor }, recoveryCooldownMs: 0 })
    const tunnel = createTunnelSupervisor(deps)
    await tunnel.enable()
    await vi.waitFor(() => expect(tunnel.status()).toMatchObject({ state: 'error', reason: 'start-failed', detail: 'bind: Error: Configuration entry is no longer available' }), { timeout: 2000, interval: 5 })
    expect(stateOf(dir)).toMatchObject({ enabled: true, lastError: 'bind: Error: Configuration entry is no longer available' })
    editor.edit.mockImplementation(async (_entry, change) => { Object.assign(editor.stored, change(structuredClone(editor.stored), {})) })
    await ready(tunnel)
    expect(sidecars.launched).toHaveLength(1)
    expect(tunnel.managedOrigin()).toBe('https://alpha-beta-gamma-delta.trycloudflare.com')
    tunnel.dispose()
  })

  it('drops a tunnel whose edge never comes up', async () => {
    const { deps, sidecars } = makeDeps({ edgeProbe: vi.fn(async () => false), now: (() => { let t = 0; return () => (t += 10_000) })() })
    // Each clock read advances 10s, so the 90s edge deadline passes within a few polls.
    const tunnel = createTunnelSupervisor(deps)
    await tunnel.enable()
    await vi.waitFor(() => expect(tunnel.status().state).toBe('recovering'), { timeout: 2000, interval: 5 })
    expect(sidecars.stopped.has(sidecars.launched[0]!.pid)).toBe(true)
    tunnel.dispose()
  })

  it('keeps a launch-flag static quick-tunnel domain across rotation and disable', async () => {
    const { deps, editor } = makeDeps({ locate: { webStartup: () => ({ trustedHosts: ['dead-launch-one-two.trycloudflare.com'] }) } })
    const tunnel = createTunnelSupervisor(deps)
    await tunnel.enable()
    await ready(tunnel)
    expect(editor.stored.trustedHosts).toEqual(['dead-launch-one-two.trycloudflare.com', 'alpha-beta-gamma-delta.trycloudflare.com'])
    await tunnel.disable()
    expect(editor.stored.trustedHosts).toEqual(['dead-launch-one-two.trycloudflare.com'])
    tunnel.dispose()
  })

  it('disables: stops the sidecar, prunes the grant and persists off', async () => {
    const { deps, editor, sidecars, dir } = makeDeps()
    const tunnel = createTunnelSupervisor(deps)
    await tunnel.enable()
    await ready(tunnel)
    await tunnel.disable()
    expect(tunnel.status()).toEqual({ state: 'off', origin: null })
    expect(tunnel.managedOrigin()).toBeUndefined()
    expect(sidecars.stopped.has(sidecars.launched[0]!.pid)).toBe(true)
    expect(existsSync(join(dir, 'state', 'mobile-quick-tunnel.sidecar.json'))).toBe(false)
    expect(editor.stored.trustedHosts).toEqual(['launch.internal'])
    expect(stateOf(dir)).toMatchObject({ enabled: false, origin: null })
    tunnel.dispose()
  })

  it('refuses to start while unsupported even when persisted enabled', async () => {
    const { deps, sidecars } = makeDeps()
    const tunnel = createTunnelSupervisor(deps)
    await tunnel.enable()
    await ready(tunnel)
    tunnel.dispose()
    sidecars.crash()
    const degraded = createTunnelSupervisor({ ...deps, locate: { ...deps.locate, configEditor: () => undefined } })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(degraded.status()).toMatchObject({ state: 'unsupported', reason: 'no-config-editor' })
    expect(sidecars.launched).toHaveLength(1)
    degraded.dispose()
  })
})
