import { EventEmitter } from 'node:events'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTunnelSupervisor, findCloudflared, rotateTrustedHosts, tunnelResponse, type TunnelDeps, type TunnelSupervisor } from '../src/tunnel.ts'

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  exitCode: number | null = null
  killed = false
  kill() {
    if (this.killed) return
    this.killed = true
    this.exitCode = 0
    queueMicrotask(() => this.emit('exit', 0))
  }
  crash() {
    this.exitCode = 1
    this.emit('exit', 1)
  }
  announce(domain: string) {
    queueMicrotask(() => this.stderr.emit('data', Buffer.from(`+---+\n|  Your quick Tunnel: https://${domain}  |\n`)))
  }
}

function fakeEditor(stored: Record<string, unknown> = { trustedHosts: { __jsExpr: 'ctx.webStartup.trustedHosts' } }) {
  const entry = { options: { id: 'connection', name: '@deepseek-ai/dsh-client-connection' } }
  return {
    entry,
    stored,
    entries: () => [entry],
    edit: vi.fn(async (_entry: unknown, change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>) => {
      Object.assign(stored, change(structuredClone(stored), {}))
    }),
  }
}

function makeDeps(overrides: Partial<TunnelDeps> & { domains?: string[] } = {}) {
  const { domains = ['alpha-beta-gamma-delta.trycloudflare.com'], ...rest } = overrides
  const queue = [...domains]
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mobile-tunnel-'))
  const editor = fakeEditor()
  const children: FakeChild[] = []
  const deps: TunnelDeps = {
    configEditor: editor,
    webStartup: { trustedHosts: ['launch.internal'] },
    webServer: { port: 3080, protocol: 'http:' },
    profileHome: dir,
    findBinary: () => '/fake/cloudflared',
    spawnProcess: ((..._args: unknown[]) => {
      const child = new FakeChild()
      children.push(child)
      const domain = queue.shift() ?? `rotated-${children.length}-two-three.trycloudflare.com`
      child.announce(domain)
      return child
    }) as unknown as typeof spawn,
    probe: vi.fn(async () => true),
    edgeProbe: vi.fn(async () => true),
    // Yield to a macrotask so real timers (vi.waitFor, cooldowns) can fire
    // between supervisor polling iterations.
    sleep: () => new Promise<void>(resolve => setTimeout(resolve, 0)),
    healthIntervalMs: 60_000,
    recoveryCooldownMs: 60_000,
    ...rest,
  }
  return { deps, editor, children, dir }
}

const dirs: string[] = []
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })

describe('rotateTrustedHosts', () => {
  it('drops every stale quick-tunnel grant, keeps launch and operator authorities, appends the live one', () => {
    expect(rotateTrustedHosts(['launch.internal', 'dead-one-two-three.trycloudflare.com', 'operator.example.test:8443', 'launch.internal'],
      'live-four-five-six.trycloudflare.com'))
      .toEqual(['launch.internal', 'operator.example.test:8443', 'live-four-five-six.trycloudflare.com'])
  })
  it('prunes without appending when no live host is given', () => {
    expect(rotateTrustedHosts(['dead-one-two-three.trycloudflare.com', 'launch.internal'])).toEqual(['launch.internal'])
  })
  it('ignores non-string entries and never matches lookalike domains', () => {
    expect(rotateTrustedHosts([42, 'trycloudflare.com', 'evil-trycloudflare.com.evil.test', 'ok.trycloudflare.com.evil.test'], 'a-b-c-d.trycloudflare.com'))
      .toEqual(['trycloudflare.com', 'evil-trycloudflare.com.evil.test', 'ok.trycloudflare.com.evil.test', 'a-b-c-d.trycloudflare.com'])
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

describe('quick tunnel supervisor', () => {
  it('reports unsupported with a reason when a capability is missing', () => {
    expect(createTunnelSupervisor(makeDeps({ profileHome: undefined }).deps).status()).toMatchObject({ state: 'unsupported', reason: 'no-profile' })
    expect(createTunnelSupervisor(makeDeps({ configEditor: undefined }).deps).status()).toMatchObject({ state: 'unsupported', reason: 'no-config-editor' })
    expect(createTunnelSupervisor(makeDeps({ webServer: undefined }).deps).status()).toMatchObject({ state: 'unsupported', reason: 'no-web-server' })
    expect(createTunnelSupervisor(makeDeps({ webServer: { port: 3080, protocol: 'https:' } }).deps).status()).toMatchObject({ state: 'unsupported', reason: 'tls-host' })
    expect(createTunnelSupervisor(makeDeps({ findBinary: () => undefined }).deps).status()).toMatchObject({ state: 'unsupported', reason: 'no-cloudflared' })
  })

  it('starts disabled and idle when nothing was persisted', () => {
    const { deps, children } = makeDeps()
    const tunnel = createTunnelSupervisor(deps)
    expect(tunnel.status()).toEqual({ state: 'off', origin: null })
    expect(tunnel.managedOrigin()).toBeUndefined()
    expect(children).toHaveLength(0)
  })

  it('enables: spawns the tunnel, hot-binds the live authority and persists', async () => {
    const { deps, editor, children, dir } = makeDeps()
    dirs.push(dir)
    const tunnel = createTunnelSupervisor(deps)
    await tunnel.enable()
    await vi.waitFor(() => expect(tunnel.status().state).toBe('ready'), { timeout: 2000, interval: 5 })
    expect(children).toHaveLength(1)
    expect(tunnel.status().origin).toBe('https://alpha-beta-gamma-delta.trycloudflare.com')
    expect(tunnel.managedOrigin()).toBe('https://alpha-beta-gamma-delta.trycloudflare.com')
    expect(editor.stored.trustedHosts).toEqual(['launch.internal', 'alpha-beta-gamma-delta.trycloudflare.com'])
    expect(JSON.parse(readFileSync(join(dir, 'state', 'mobile-quick-tunnel.json'), 'utf8'))).toMatchObject({ enabled: true, origin: 'https://alpha-beta-gamma-delta.trycloudflare.com' })
    tunnel.dispose()
  })

  it('recovers a dead tunnel with a fresh domain and prunes the stale grant', async () => {
    const { deps, editor, children, dir } = makeDeps({ healthIntervalMs: 5, probe: vi.fn(async () => true) })
    dirs.push(dir)
    const tunnel = createTunnelSupervisor(deps)
    await tunnel.enable()
    await vi.waitFor(() => expect(tunnel.status().state).toBe('ready'), { timeout: 2000, interval: 5 })
    ;(deps.probe as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    await vi.waitFor(() => expect(children).toHaveLength(2), { timeout: 2000, interval: 5 })
    ;(deps.probe as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    await vi.waitFor(() => expect(tunnel.status().state).toBe('ready'), { timeout: 2000, interval: 5 })
    expect(tunnel.status().origin).toBe('https://rotated-2-two-three.trycloudflare.com')
    expect(editor.stored.trustedHosts).toEqual(['launch.internal', 'rotated-2-two-three.trycloudflare.com'])
    expect(children[0].killed).toBe(true)
    tunnel.dispose()
  })

  it('recovers when the child process exits unexpectedly', async () => {
    const { deps, children, dir } = makeDeps()
    dirs.push(dir)
    const tunnel = createTunnelSupervisor(deps)
    await tunnel.enable()
    await vi.waitFor(() => expect(tunnel.status().state).toBe('ready'), { timeout: 2000, interval: 5 })
    children[0].crash()
    await vi.waitFor(() => expect(children).toHaveLength(2), { timeout: 2000, interval: 5 })
    await vi.waitFor(() => expect(tunnel.status().state).toBe('ready'), { timeout: 2000, interval: 5 })
    expect(tunnel.managedOrigin()).toBe('https://rotated-2-two-three.trycloudflare.com')
    tunnel.dispose()
  })

  it('throttles recovery churn inside the cooldown window', async () => {
    const { deps, children, dir } = makeDeps()
    dirs.push(dir)
    const tunnel = createTunnelSupervisor(deps)
    await tunnel.enable()
    await vi.waitFor(() => expect(tunnel.status().state).toBe('ready'), { timeout: 2000, interval: 5 })
    children[0].crash()
    await vi.waitFor(() => expect(children).toHaveLength(2), { timeout: 2000, interval: 5 })
    await vi.waitFor(() => expect(tunnel.status().state).toBe('ready'), { timeout: 2000, interval: 5 })
    children[1].crash()
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(children).toHaveLength(2)
    expect(tunnel.status().state).toBe('recovering')
    tunnel.dispose()
  })

  it('enters error after three consecutive failed starts', async () => {
    const editor = fakeEditor()
    editor.edit.mockRejectedValue(new Error('edit-refused'))
    const { deps, dir } = makeDeps({ configEditor: editor, recoveryCooldownMs: 0 })
    dirs.push(dir)
    const tunnel = createTunnelSupervisor(deps)
    await tunnel.enable()
    await vi.waitFor(() => expect(tunnel.status()).toMatchObject({ state: 'error', reason: 'start-failed' }), { timeout: 2000, interval: 5 })
    tunnel.dispose()
  })

  it('disables: kills the child, prunes the grant and persists off', async () => {
    const { deps, editor, children, dir } = makeDeps()
    dirs.push(dir)
    const tunnel = createTunnelSupervisor(deps)
    await tunnel.enable()
    await vi.waitFor(() => expect(tunnel.status().state).toBe('ready'), { timeout: 2000, interval: 5 })
    await tunnel.disable()
    expect(tunnel.status()).toEqual({ state: 'off', origin: null })
    expect(tunnel.managedOrigin()).toBeUndefined()
    expect(children[0].killed).toBe(true)
    expect(editor.stored.trustedHosts).toEqual(['launch.internal'])
    expect(JSON.parse(readFileSync(join(dir, 'state', 'mobile-quick-tunnel.json'), 'utf8'))).toMatchObject({ enabled: false, origin: null })
    tunnel.dispose()
  })

  it('auto-starts on construction when a previous run persisted enabled', async () => {
    const first = makeDeps()
    dirs.push(first.dir)
    const tunnel = createTunnelSupervisor(first.deps)
    await tunnel.enable()
    await vi.waitFor(() => expect(tunnel.status().state).toBe('ready'), { timeout: 2000, interval: 5 })
    tunnel.dispose()
    const second = makeDeps({ profileHome: first.dir, domains: ['second-live-domain-one.trycloudflare.com'] })
    dirs.push(second.dir)
    const again = createTunnelSupervisor(second.deps)
    await vi.waitFor(() => expect(again.status().state).toBe('ready'), { timeout: 2000, interval: 5 })
    expect(second.children).toHaveLength(1)
    expect(again.managedOrigin()).toBe('https://second-live-domain-one.trycloudflare.com')
    again.dispose()
  })

  it('refuses to start while unsupported even when persisted enabled', async () => {
    const { deps, children, dir } = makeDeps()
    dirs.push(dir)
    const tunnel = createTunnelSupervisor(deps)
    await tunnel.enable()
    tunnel.dispose()
    const degraded = createTunnelSupervisor({ ...deps, configEditor: undefined })
    expect(degraded.status()).toMatchObject({ state: 'unsupported', reason: 'no-config-editor' })
    expect(children).toHaveLength(1)
    degraded.dispose()
  })

  it('keeps literal stored grants and evaluates the launch expression through webStartup', async () => {
    const { deps, editor, children, dir } = makeDeps()
    dirs.push(dir)
    const tunnel = createTunnelSupervisor(deps)
    await tunnel.enable()
    await vi.waitFor(() => expect(tunnel.status().state).toBe('ready'), { timeout: 2000, interval: 5 })
    // The bundle row's !!js expression was evaluated via webStartup.trustedHosts.
    expect(editor.stored.trustedHosts).toEqual(['launch.internal', 'alpha-beta-gamma-delta.trycloudflare.com'])
    // The next rotation starts from the literal list the first one persisted.
    children[0].crash()
    await vi.waitFor(() => expect(tunnel.status().origin).toBe('https://rotated-2-two-three.trycloudflare.com'), { timeout: 2000, interval: 5 })
    expect(editor.stored.trustedHosts).toEqual(['launch.internal', 'rotated-2-two-three.trycloudflare.com'])
    tunnel.dispose()
  })
})
