import { expect, it } from 'vitest'
import { recoveryDecision } from './mobile-tunnel.mts'
it('does not rotate on a host restart or a transient outage, and backs off failed recovery', () => {
  expect(recoveryDecision({ local: false, remote: false, failures: 9, elapsed: 900000 })).toBe('host-unavailable')
  expect(recoveryDecision({ local: true, remote: false, failures: 2, elapsed: 900000 })).toBe('retry')
  expect(recoveryDecision({ local: true, remote: false, failures: 9, elapsed: 10000 })).toBe('retry')
  expect(recoveryDecision({ local: true, remote: false, failures: 3, elapsed: 900000 })).toBe('rebuild')
  expect(recoveryDecision({ local: true, remote: true, failures: 9, elapsed: 900000 })).toBe('healthy')
})

import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
it.each([false, true])('owns the candidate through guarded cutover; deploy failure=%s', async failure => {
  const root = mkdtempSync(join(tmpdir(), 'mobile-owner-')), bin = join(root, 'bin'), home = join(root, 'home')
  mkdirSync(bin); mkdirSync(join(home, 'state'), { recursive: true })
  const specPath = join(home, 'state/launch-spec.json')
  writeFileSync(specPath, JSON.stringify({ active: { port: 3080, command: 'DSH_MOBILE_PUBLIC_ORIGIN=https://old-link.trycloudflare.com dsh web --trusted-host old-link.trycloudflare.com' } }))
  const executable = (name: string, code: string) => { const path = join(bin, name); writeFileSync(path, `#!${process.execPath}\n${code}`); chmodSync(path, 0o755); return path }
  const cloud = executable('cloudflared', `require('node:fs').writeFileSync(process.env.FAKE_CLOUD_PID,String(process.pid));console.log('https://new-link.trycloudflare.com');console.log('Registered tunnel connection');setInterval(()=>{},1000)`)
  executable('git', 'process.exit(0)')
  executable('pnpm', `const fs=require('node:fs');fs.appendFileSync(process.env.FAKE_CALLS,JSON.stringify(process.argv.slice(2))+'\\n');if(process.env.FAKE_FAILURE==='yes')process.exit(1);const p=process.env.FAKE_SPEC;const s=JSON.parse(fs.readFileSync(p));s.active.command=s.active.command.replaceAll('old-link','new-link');fs.writeFileSync(p,JSON.stringify(s))`)
  const bootstrap = join(root, 'fetch.mjs')
  writeFileSync(bootstrap, `globalThis.fetch=async url=>{if(String(url).includes('old-link'))throw new Error('offline');return new Response('',{status:401})}`)
  const child = spawn(process.execPath, ['--import', pathToFileURL(bootstrap).href, '--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, resolve('scripts/mobile-tunnel.mts'), '--repair-now'], {
    env: { ...process.env, DSH_HOME: home, CLOUDFLARED_BIN: cloud, PATH: bin, FAKE_CLOUD_PID: join(root, 'cloud.pid'), FAKE_CALLS: join(root, 'calls'), FAKE_SPEC: specPath, FAKE_FAILURE: failure ? 'yes' : 'no' }, stdio: 'pipe',
  })
  let logs = ''; child.stdout.on('data', x => { logs += x }); child.stderr.on('data', x => { logs += x })
  const exit = new Promise<void>(done => child.once('exit', () => done()))
  try {
    const status = join(home, 'state/mobile-tunnel/status.json'), deadline = Date.now() + 12000
    let phase = ''
    while (Date.now() < deadline) {
      if (existsSync(status)) phase = JSON.parse(readFileSync(status, 'utf8')).phase
      if (phase === (failure ? 'recovery-failed' : 'ready')) break
      await delay(50)
    }
    expect(phase, logs).toBe(failure ? 'recovery-failed' : 'ready')
    const calls = readFileSync(join(root, 'calls'), 'utf8').trim().split('\n').map(x => JSON.parse(x))
    expect(calls).toEqual([['deploy:3080', '--package', 'packages/mobile', '--mobile-origin', 'https://new-link.trycloudflare.com']])
    if (!failure) expect(() => process.kill(Number(readFileSync(join(root, 'cloud.pid'), 'utf8')), 0)).not.toThrow()
    child.kill('SIGTERM'); await exit
    expect(existsSync(join(home, 'state/mobile-tunnel/manager.lock'))).toBe(false)
  } finally { if (child.exitCode === null) child.kill('SIGTERM'); await exit; rmSync(root, { recursive: true, force: true }) }
})
