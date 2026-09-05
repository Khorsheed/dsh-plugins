import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findPidsOnPort, processIdentityMatches } from '../src/processes.ts'
import { TEST_RUN_DIR_ENV, TEST_RUN_TOKEN_ENV } from '../src/test-seam.ts'
import { formatMachineLeaseReport, inspectMachineTestLeases, TestProcessLifecycle } from './helpers/process-lifecycle.ts'

const registerBin = fileURLToPath(new URL('../lib/test-seam-cli.js', import.meta.url))

async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    if (predicate()) return true
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return false
}

describe('watchdog test process lifecycle', () => {
  it('owns a detached process group by immutable identity and leaves its leased port empty', async () => {
    const lifecycle = new TestProcessLifecycle(registerBin)
    const port = await lifecycle.acquirePort()
    const child = spawn(process.execPath, ['-e', `require('net').createServer(()=>{}).listen(${port},'127.0.0.1')`], {
      detached: true,
      stdio: 'ignore',
      env: lifecycle.childEnv('lifecycle-listener', process.env, { port }),
    })
    const record = lifecycle.track(child, 'lifecycle-listener', { port })
    expect(record).not.toBeNull()
    try {
      expect(await waitUntil(() => findPidsOnPort(port).length === 1)).toBe(true)
    } finally {
      await lifecycle.teardown()
    }
    expect(processIdentityMatches(record!)).toBe(false)
    expect(findPidsOnPort(port)).toEqual([])
  })

  it('escalates from TERM to KILL when a registered child ignores graceful shutdown', async () => {
    const lifecycle = new TestProcessLifecycle(registerBin)
    const child = spawn(process.execPath, ['-e', `process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`], {
      detached: true,
      stdio: 'ignore',
      env: lifecycle.childEnv('term-resistant-child'),
    })
    const record = lifecycle.track(child, 'term-resistant-child')
    expect(record).not.toBeNull()
    await new Promise(resolve => setTimeout(resolve, 100))
    const started = performance.now()
    await lifecycle.teardown()
    expect(performance.now() - started).toBeGreaterThanOrEqual(1_900)
    expect(processIdentityMatches(record!)).toBe(false)
  }, 10_000)

  it('records the real macOS Bash background-function pid instead of the outer $$ value', async () => {
    const lifecycle = new TestProcessLifecycle(registerBin)
    const port = await lifecycle.acquirePort()
    const child = spawn('bash', ['-c', `worker() {
  node "$ANKH_GUARD_TEST_REGISTER_BIN" register-parent instance-wrapper
  node "$ANKH_GUARD_TEST_REGISTER_BIN" event-parent instance-wrapper ready
  node -e "require('net').createServer(()=>{}).listen(${port},'127.0.0.1')"
}
worker & wait`], {
      detached: true,
      stdio: 'ignore',
      env: lifecycle.childEnv('shell-launcher', process.env, { port }),
    })
    lifecycle.track(child, 'shell-launcher', { port })
    try {
      expect(await waitUntil(() => findPidsOnPort(port).length === 1)).toBe(true)
      expect(await waitUntil(() => lifecycle.events().some(event =>
        event.role === 'instance-wrapper' && event.event === 'ready' && event.pid !== child.pid,
      ))).toBe(true)
    } finally {
      await lifecycle.teardown()
    }
    expect(findPidsOnPort(port)).toEqual([])
  })

  it('does not honor the short-sleep knob without explicit test-run coordinates', async () => {
    const lifecycle = new TestProcessLifecycle(registerBin)
    const port = await lifecycle.acquirePort()
    const home = join(lifecycle.runDir, 'unscaled-home')
    const stateDir = join(home, 'state')
    mkdirSync(join(home, 'home'), { recursive: true })
    const env = lifecycle.childEnv('unscaled-watchdog', process.env, { port, tempRoot: stateDir })
    delete env[TEST_RUN_DIR_ENV]
    delete env[TEST_RUN_TOKEN_ENV]
    const script = fileURLToPath(new URL('../scripts/dsh-watchdog.sh', import.meta.url))
    const started = performance.now()
    let output = ''
    const child = spawn('bash', [script, '--supervise'], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env, WD_HOME: home, WD_PORT: String(port), WD_TEST_BREAK: '1' },
    })
    child.stdout?.on('data', chunk => { output += chunk.toString() })
    child.stderr?.on('data', chunk => { output += chunk.toString() })
    lifecycle.track(child, 'unscaled-watchdog', { port, tempRoot: stateDir })
    try {
      const failedOnce = await waitUntil(() => output.includes('failure #1'), 15_000)
      expect(failedOnce, `${output}\n${lifecycle.diagnostics()}`).toBe(true)
      expect(performance.now() - started).toBeGreaterThanOrEqual(900)
    } finally {
      await lifecycle.teardown()
    }
  }, 25_000)

  it('reports dead records separately from over-age live identities without cleaning either by port', async () => {
    const lifecycle = new TestProcessLifecycle(registerBin)
    const live = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      stdio: 'ignore', env: lifecycle.childEnv('report-live-child'),
    })
    const liveRecord = lifecycle.track(live, 'report-live-child')
    expect(liveRecord).not.toBeNull()
    const gone = spawn(process.execPath, ['-e', 'setTimeout(()=>process.exit(0),100)'], {
      stdio: 'ignore', env: lifecycle.childEnv('report-gone-child'),
    })
    expect(lifecycle.track(gone, 'report-gone-child')).not.toBeNull()
    await new Promise<void>(resolve => gone.once('close', () => { resolve() }))
    try {
      const report = inspectMachineTestLeases(Date.now() + 2 * 60 * 60_000, 60 * 60_000)
      expect(report.reclaimable.some(item => 'runToken' in item.record && item.record.runToken === lifecycle.runToken)).toBe(true)
      expect(report.overAgeLive.some(item => item.record.runToken === lifecycle.runToken && 'role' in item.record && item.record.role === 'report-live-child')).toBe(true)
      expect(formatMachineLeaseReport(report)).toContain('over-age-live-human-review')
      expect(processIdentityMatches(liveRecord!)).toBe(true)
    } finally {
      await lifecycle.teardown()
    }
  })

  it('uses one machine-wide namespace so independent run leases never return the same port', async () => {
    const first = new TestProcessLifecycle(registerBin)
    const second = new TestProcessLifecycle(registerBin)
    try {
      const [firstPort, secondPort] = await Promise.all([first.acquirePort(), second.acquirePort()])
      expect(secondPort).not.toBe(firstPort)
    } finally {
      await second.teardown()
      await first.teardown()
    }
  })
})
