#!/usr/bin/env node
/** Desktop-only Quick Tunnel owner. No login tokens, QR content or phone settings.
 * Run from the deployment checkout; origin changes use deploy:3080's gated cutover. */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, openSync, closeSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { createIngress } from '../packages/mobile/examples/https-ingress.mjs'
import { quickTunnelOrigin, rotateMobileCommand } from './mobile-tunnel-config.mts'

export function recoveryDecision({ local, remote, failures, elapsed }: { local: boolean; remote: boolean; failures: number; elapsed: number }) {
  if (remote) return 'healthy'
  if (!local) return 'host-unavailable'
  return failures >= 3 && elapsed >= 600_000 ? 'rebuild' : 'retry'
}
async function reachable(origin: string) {
  try {
    const response = await fetch(`${origin}/`, { redirect: 'manual', signal: AbortSignal.timeout(6000) })
    await response.body?.cancel()
    return response.ok || response.status === 401
  } catch { return false }
}
export async function runManager(repairNow = false) {
  const repo = resolve(import.meta.dirname, '..'), home = process.env.DSH_HOME ?? join(homedir(), '.dsh-official')
  const directory = join(home, 'state', 'mobile-tunnel'), lock = join(directory, 'manager.lock')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  try { mkdirSync(lock) } catch {
    const pid = Number(readFileSync(join(lock, 'pid'), 'utf8'))
    let alive = true
    try { process.kill(pid, 0) } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH' }
    if (alive) throw new Error('Mobile tunnel manager already running')
    rmSync(lock, { recursive: true }); mkdirSync(lock)
  }
  writeFileSync(join(lock, 'pid'), String(process.pid), { mode: 0o600 })
  let stopping = false, owned: { tunnel: ChildProcess; ingress: Awaited<ReturnType<typeof createIngress>> } | undefined
  const status = (phase: string, origin?: string) => {
    const path = join(directory, 'status.json')
    writeFileSync(`${path}.next`, JSON.stringify({ phase, origin, checkedAt: new Date().toISOString(), managerPid: process.pid, tunnelPid: owned?.tunnel.pid }), { mode: 0o600 })
    renameSync(`${path}.next`, path)
    console.log(`${new Date().toISOString()} ${phase}${origin ? ` ${origin}` : ''}`)
  }
  const active = () => JSON.parse(readFileSync(join(home, 'state', 'launch-spec.json'), 'utf8')).active
  const originOf = (spec: { command: string }) => {
    const value = /DSH_MOBILE_PUBLIC_ORIGIN=['"]?(https:\/\/[a-z0-9.-]+)/.exec(spec.command)?.[1]
    const origin = quickTunnelOrigin(value ?? '')
    rotateMobileCommand(spec.command, origin) // Refuse an unsupported binding before creating anything.
    return origin
  }
  const stopOwned = async (value: typeof owned) => {
    if (!value) return
    value.tunnel.kill('SIGTERM'); await value.ingress.close().catch(() => {})
  }
  const shutdown = new AbortController()
  const signal = () => { stopping = true; shutdown.abort() }
  process.on('SIGTERM', signal); process.on('SIGINT', signal)
  async function rebuild() {
    const spec = active(); originOf(spec)
    if (Number(spec.port) !== 3080) throw new Error('Recovery only supports the supervised 3080 deployment')
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'packages/mobile', 'scripts/mobile-tunnel.mts', 'scripts/mobile-tunnel-config.mts', 'scripts/deploy-3080.mts'], { cwd: repo, stdio: 'ignore' })
    const ingress = createIngress({ origin: 'https://pending.trycloudflare.com', targetPort: Number(spec.port), safariStreamCompat: true })
    // Obtain an unused loopback port. Recreate with the assigned public authority
    // after Cloudflare reports it; never expose an unrestricted forwarding proxy.
    await new Promise<void>((done, reject) => { ingress.server.once('error', reject); ingress.server.listen(0, '127.0.0.1', done) })
    const port = (ingress.server.address() as { port: number }).port
    const log = openSync(join(directory, 'cloudflared.log'), 'a', 0o600)
    const tunnel = spawn(process.env.CLOUDFLARED_BIN ?? 'cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`, '--protocol', 'http2', '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let text = '', spawnFailed = false
    const collect = (chunk: Buffer) => { text = (text + chunk.toString()).slice(-24000) }
    tunnel.stdout?.on('data', collect); tunnel.stderr?.on('data', collect)
    let logClosed = false
    const sink = (chunk: Buffer) => { if (!logClosed) writeSync(log, chunk) }
    const closeLog = () => { if (!logClosed) { logClosed = true; closeSync(log) } }
    tunnel.once('exit', closeLog)
    tunnel.stdout?.on('data', sink); tunnel.stderr?.on('data', sink)
    tunnel.once('error', () => { spawnFailed = true })
    let candidate = { tunnel, ingress }, promoted = false
    try {
      const deadline = Date.now() + 90_000
      let origin: string | undefined
      while (!stopping && Date.now() < deadline && !spawnFailed && tunnel.exitCode === null) {
        origin = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text)?.[0]
        if (origin && text.includes('Registered tunnel connection')) break
        await delay(1000)
      }
      if (!origin || !text.includes('Registered tunnel connection') || stopping) throw new Error('Tunnel registration did not become ready')
      quickTunnelOrigin(origin)
      await ingress.close()
      const bound = createIngress({ origin, targetPort: Number(spec.port), safariStreamCompat: true })
      candidate = { tunnel, ingress: bound }
      await new Promise<void>((done, reject) => { bound.server.once('error', reject); bound.server.listen(port, '127.0.0.1', done) })
      status('reconfiguring', origin)
      const deploymentLog = openSync(join(directory, 'deploy.log'), 'a', 0o600)
      try {
        await new Promise<void>((done, reject) => {
          const deploy = spawn('pnpm', ['deploy:3080', '--package', 'packages/mobile', '--mobile-origin', origin!], { cwd: repo, env: { ...process.env, DSH_HOME: home }, stdio: ['ignore', deploymentLog, deploymentLog] })
          deploy.once('error', reject); deploy.once('exit', code => code === 0 ? done() : reject(new Error('Guarded deployment failed; inspect deploy.log')))
        })
      } finally { closeSync(deploymentLog) }
      // DNS propagation and edge reconnect can lag a successful local canary.
      const publicDeadline = Date.now() + 90_000
      while (!stopping && !await reachable(origin) && Date.now() < publicDeadline) await delay(3000)
      if (!await reachable(origin)) throw new Error('New public origin is not reachable yet')
      const previous = owned; owned = candidate; promoted = true
      await stopOwned(previous)
      status('ready', origin)
    } finally {
      if (!promoted) {
        // An uncertain deployment may already have committed this candidate.
        // Keep it alive for the next health check instead of breaking the new origin.
        const configured = originOf(active())
        if (text.includes(configured) && !spawnFailed && tunnel.exitCode === null) { const previous = owned; owned = candidate; await stopOwned(previous) }
        else await stopOwned(candidate)
      }
      if (spawnFailed || tunnel.exitCode !== null) closeLog()
    }
  }
  let failures = repairNow ? 2 : 0, attempted = 0
  try {
    do {
      try {
        const spec = active(), origin = originOf(spec)
        const [local, remote] = await Promise.all([reachable(`http://127.0.0.1:${spec.port}`), reachable(origin)])
        failures = remote ? 0 : failures + 1
        const decision = recoveryDecision({ local, remote, failures, elapsed: Date.now() - attempted })
        if (decision === 'rebuild') { attempted = Date.now(); status('recovering', origin); await rebuild(); failures = 0 }
        else status(decision === 'healthy' ? 'ready' : decision, origin)
      } catch (error) {
        console.error(`${new Date().toISOString()} recovery failed (${error instanceof Error ? error.message : 'unknown'}); retry is bounded by cooldown`)
        status('recovery-failed')
      }
      if (stopping) break
      await delay(30_000, undefined, { signal: shutdown.signal }).catch(() => {})
    } while (!stopping)
  } finally {
    await stopOwned(owned); rmSync(lock, { recursive: true, force: true })
    process.off('SIGTERM', signal); process.off('SIGINT', signal)
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--repair-now')) throw new Error('Usage: pnpm mobile:tunnel [--repair-now]')
  await runManager(args.includes('--repair-now'))
}
