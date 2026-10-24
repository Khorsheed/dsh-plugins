import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'

const script = fileURLToPath(new URL('../src/tunnel-sidecar.ts', import.meta.url))
const dirs: string[] = []
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mobile-sidecar-'))
  dirs.push(dir)
  const binary = join(dir, 'cloudflared')
  // Announces like cloudflared (on stderr), records its pid, then idles.
  writeFileSync(binary, `#!/bin/sh\necho $$ > "${join(dir, 'child.pid')}"\necho "|  https://live-one-two-three.trycloudflare.com  |" >&2\nexec sleep 60\n`)
  chmodSync(binary, 0o755)
  return { dir, binary, stateFile: join(dir, 'state', 'mobile-quick-tunnel.sidecar.json') }
}
const run = (config: object) => spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', script, JSON.stringify(config)], { stdio: 'ignore' })
const childPid = (dir: string) => Number(readFileSync(join(dir, 'child.pid'), 'utf8'))

it.skipIf(process.platform === 'win32')('publishes the tunnel domain, then takes cloudflared down with it on SIGTERM', async () => {
  const { dir, binary, stateFile } = fixture()
  const sidecar = run({ binary, port: 3080, stateFile })
  try {
    await vi.waitFor(() => {
      expect(JSON.parse(readFileSync(stateFile, 'utf8'))).toMatchObject({ pid: sidecar.pid, port: 3080, host: 'live-one-two-three.trycloudflare.com' })
    }, { timeout: 10_000, interval: 50 })
    const child = childPid(dir)
    expect(alive(child)).toBe(true)
    sidecar.kill('SIGTERM')
    await vi.waitFor(() => expect(alive(child)).toBe(false), { timeout: 5000, interval: 50 })
    expect(existsSync(stateFile)).toBe(false)
  } finally {
    sidecar.kill('SIGKILL')
  }
}, 20_000)

it.skipIf(process.platform === 'win32')('stops by itself once the supervisor lease lapses (host stopped or plugin uninstalled)', async () => {
  const { dir, binary, stateFile } = fixture()
  const sidecar = run({ binary, port: 3080, stateFile, graceMs: 2000, heartbeatMs: 50 })
  try {
    await vi.waitFor(() => expect(existsSync(join(dir, 'child.pid'))).toBe(true), { timeout: 10_000, interval: 50 })
    const child = childPid(dir)
    await vi.waitFor(() => expect(alive(sidecar.pid!) || alive(child)).toBe(false), { timeout: 5000, interval: 50 })
    expect(existsSync(stateFile)).toBe(false)
  } finally {
    sidecar.kill('SIGKILL')
  }
}, 20_000)
