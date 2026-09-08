import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * End-to-end CLI tests: the real `src/cli.ts` entry (via tsx) against stub
 * `docker` / `dsh-mission` binaries on PATH. The stubs log every invocation
 * to $LOG and answer from $STUB_* env vars.
 */

const pkgRoot = join(import.meta.dirname, '..')

const DOCKER_STUB = `#!/bin/sh
echo "docker $*" >> "$LOG"
case "$1" in
  image) echo '["registry/app@sha256:test"] sha256:local';;
  ps) if [ -n "$STUB_PS" ]; then echo "$STUB_PS"; fi;;
  inspect) if [ -n "$STUB_INSPECT" ]; then printf '%s' "$STUB_INSPECT"; fi;;
  exec) if [ -n "$STUB_EXEC_OUT" ]; then echo "$STUB_EXEC_OUT"; fi;;
esac
exit 0
`

const MISSION_STUB = `#!/bin/sh
echo "dsh-mission $*" >> "$LOG"
if [ "$1" = "is-releasable" ]; then exit "\${MISSION_EXIT:-1}"; fi
exit 0
`

interface CliRun {
  code: number | null
  stdout: string
  stderr: string
  log: string
}

const tmpDirs: string[] = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Write the stubs into a fresh bin dir and run the CLI against them. */
async function runLab(args: string[], env: Record<string, string>, withMission: boolean): Promise<CliRun> {
  const dir = mkdtempSync(join(tmpdir(), 'lab-cli-'))
  tmpDirs.push(dir)
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const log = join(dir, 'log')
  writeFileSync(join(bin, 'docker'), DOCKER_STUB)
  chmodSync(join(bin, 'docker'), 0o755)
  if (withMission) {
    writeFileSync(join(bin, 'dsh-mission'), MISSION_STUB)
    chmodSync(join(bin, 'dsh-mission'), 0o755)
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx/esm', join(pkgRoot, 'src/cli.ts'), ...args], {
      cwd: pkgRoot,
      // DSH_HOME keeps the fingerprint mirror inside the throwaway dir instead
      // of the package checkout.
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, LOG: log, DSH_HOME: dir, ...env },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')))
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')))
    child.on('error', reject)
    child.on('close', (code) => {
      let logContent = ''
      try {
        logContent = readFileSync(log, 'utf8')
      } catch {
        // No log file: no stub was invoked.
      }
      resolve({ code, stdout, stderr, log: logContent })
    })
  })
}

const UNIT_INSPECT = JSON.stringify([{
  Name: '/dsh-lab-t1',
  Created: '2026-08-20T00:00:00.000Z',
  Config: { Labels: { 'dsh-lab.managed': 'true', 'dsh-lab.unit': 't1', 'dsh-lab.mission': 'm-1', 'dsh-lab.fingerprint': 'fp:t1', 'dsh-lab.workdir': '/workspace' } },
  State: { Running: true },
}])

describe('dsh-lab CLI', { timeout: 30000 }, () => {
  it('prints usage and exits 2 with no arguments', async () => {
    const run = await runLab([], {}, false)
    expect(run.code).toBe(2)
    expect(run.stdout).toContain('acquire --image')
  })

  it('acquire prints the unit JSON and labels the container with the fingerprint', async () => {
    const run = await runLab(['acquire', '--image', 'app:latest'], {}, false)
    expect(run.code).toBe(0)
    const info = JSON.parse(run.stdout) as {
      id: string; resource: string; fingerprint: string; workspace: string
      fingerprintComponents: { image: string }
    }
    expect(info.fingerprint).toMatch(/^lab-env:[0-9a-f]{64}$/)
    expect(info.fingerprintComponents.image).toBe('registry/app@sha256:test')
    expect(info.resource).toBe(`dsh-lab-${info.id}`)
    expect(info.workspace).toBe('/workspace')
    expect(run.log).toContain('docker run -d --name')
    expect(run.log).toContain(`dsh-lab.fingerprint=${info.fingerprint}`)
    expect(run.log).toContain('dsh-lab.fingerprint-components=')
  })

  it('acquire applies declared ceilings to the container', async () => {
    const run = await runLab(['acquire', '--image', 'app:latest', '--cpus', '2.0', '--memory', '4g'], {}, false)
    expect(run.code).toBe(0)
    expect(run.log).toContain('--cpus 2')
    expect(run.log).toContain('--memory 4294967296')
  })

  it('acquire joins a network, runs as a user, and mounts a named volume', async () => {
    const run = await runLab([
      'acquire', '--image', 'app:latest',
      '--network', 'eval-net', '--user', '1000:1000',
      '--volume', 'eval-creds-codex:/creds/codex',
      '--mount', '/host/layer:/input:ro',
    ], {}, false)
    expect(run.code).toBe(0)
    expect(run.log).toContain('--network eval-net')
    expect(run.log).toContain('--user 1000:1000')
    expect(run.log).toContain('type=volume,source=eval-creds-codex,target=/creds/codex')
    expect(run.log).toContain('type=bind,source=/host/layer,target=/input,readonly')
    const info = JSON.parse(run.stdout) as { fingerprintComponents: { network: string; user: string; mounts: { target: string; type: string }[] } }
    expect(info.fingerprintComponents.network).toBe('eval-net')
    expect(info.fingerprintComponents.user).toBe('1000:1000')
    expect(info.fingerprintComponents.mounts).toContainEqual({ target: '/creds/codex', type: 'volume', readonly: false })
  })

  it('a bad --volume is a usage error, not a silently mangled mount', async () => {
    const run = await runLab(['acquire', '--image', 'app:latest', '--volume', 'novolume'], {}, false)
    expect(run.code).toBe(2)
    expect(run.stderr).toContain('bad --volume')
  })

  it('fingerprint reports the network and user for a spec, and status --json for a held unit', async () => {
    const spec = await runLab(['fingerprint', '--image', 'app:latest', '--network', 'none', '--user', 'node'], {}, false)
    expect(spec.code).toBe(0)
    const resolved = JSON.parse(spec.stdout) as { components: { network: string; user: string } }
    expect(resolved.components).toMatchObject({ network: 'none', user: 'node' })

    const acquired = await runLab(['acquire', '--image', 'app:latest', '--network', 'eval-net', '--user', '1000'], {}, false)
    const info = JSON.parse(acquired.stdout) as { id: string; resource: string; fingerprint: string; fingerprintComponents: unknown }
    const env = { STUB_PS: info.resource, STUB_INSPECT: JSON.stringify([{
      Name: `/${info.resource}`,
      Config: { Labels: {
        'dsh-lab.managed': 'true', 'dsh-lab.unit': info.id, 'dsh-lab.fingerprint': info.fingerprint,
        'dsh-lab.fingerprint-components': JSON.stringify(info.fingerprintComponents),
      } },
      State: { Running: true },
    }]) }
    const status = await runLab(['status', '--json'], env, false)
    const rows = JSON.parse(status.stdout) as { fingerprintComponents: { network: string; user: string } }[]
    expect(rows[0]?.fingerprintComponents).toMatchObject({ network: 'eval-net', user: '1000' })
  })

  it('fingerprint resolves a spec without acquiring, and names the component that differs', async () => {
    const small = await runLab(['fingerprint', '--image', 'app:latest', '--cpus', '2', '--memory', '4g'], {}, false)
    const large = await runLab(['fingerprint', '--image', 'app:latest', '--cpus', '2', '--memory', '8g'], {}, false)
    expect(small.code).toBe(0)
    expect(small.log).not.toContain('docker run')
    const a = JSON.parse(small.stdout) as { fingerprint: string; components: { image: string; resources: { memory: string } } }
    const b = JSON.parse(large.stdout) as { fingerprint: string; components: { image: string; resources: { memory: string } } }
    expect(a.fingerprint).not.toBe(b.fingerprint)
    expect(a.components.image).toBe(b.components.image)
    expect(a.components.resources.memory).toBe('4294967296')
    expect(b.components.resources.memory).toBe('8589934592')
  })

  it('fingerprint UNIT prints the held unit\'s components, null for a legacy bare digest', async () => {
    const env = { STUB_PS: 'dsh-lab-t1', STUB_INSPECT: UNIT_INSPECT }
    const run = await runLab(['fingerprint', 't1'], env, false)
    expect(run.code).toBe(0)
    expect(JSON.parse(run.stdout)).toEqual({ unit: 't1', fingerprint: 'fp:t1', components: null })
  })

  it('release is refused when dsh-mission says not releasable (exit 1)', async () => {
    const env = { STUB_PS: 'dsh-lab-t1', STUB_INSPECT: UNIT_INSPECT, MISSION_EXIT: '1' }
    const run = await runLab(['release', 't1'], env, true)
    expect(run.code).toBe(1)
    expect(run.stderr).toContain('not in a releasable state')
    expect(run.log).not.toContain('rm -f')
  })

  it('release proceeds when dsh-mission says releasable (exit 0)', async () => {
    const env = { STUB_PS: 'dsh-lab-t1', STUB_INSPECT: UNIT_INSPECT, MISSION_EXIT: '0' }
    const run = await runLab(['release', 't1'], env, true)
    expect(run.code).toBe(0)
    expect(run.log).toContain('docker rm -f dsh-lab-t1')
  })

  it('release fails closed when the gate query itself fails (exit neither 0 nor 1)', async () => {
    const env = { STUB_PS: 'dsh-lab-t1', STUB_INSPECT: UNIT_INSPECT, MISSION_EXIT: '3' }
    const run = await runLab(['release', 't1'], env, true)
    expect(run.code).toBe(1)
    expect(run.stderr).toContain('failed closed')
    expect(run.log).not.toContain('rm -f')
  })

  it('an unbound unit needs --force, then warns and releases', async () => {
    const inspect = JSON.stringify([{
      Name: '/dsh-lab-t2',
      Config: { Labels: { 'dsh-lab.managed': 'true', 'dsh-lab.unit': 't2', 'dsh-lab.fingerprint': 'fp:t2' } },
      State: { Running: true },
    }])
    const env = { STUB_PS: 'dsh-lab-t2', STUB_INSPECT: inspect }
    const refused = await runLab(['release', 't2'], env, false)
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('pass force')
    const forced = await runLab(['release', 't2', '--force'], env, false)
    expect(forced.code).toBe(0)
    expect(forced.stderr).toContain('without a mission releasable gate')
    expect(forced.log).toContain('docker rm -f dsh-lab-t2')
  })

  it('verify prints the verbatim outcome JSON and annotates via dsh-mission', async () => {
    const env = { STUB_PS: 'dsh-lab-t1', STUB_INSPECT: UNIT_INSPECT, STUB_EXEC_OUT: 'canned-output' }
    const run = await runLab(['verify', 't1', '--', 'npm', 'test'], env, true)
    expect(run.code).toBe(0)
    const result = JSON.parse(run.stdout) as { exitCode: number; stdout: string; timedOut: boolean }
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('canned-output')
    expect(result.timedOut).toBe(false)
    expect(run.log).toContain("dsh-mission annotate m-1 --ns lab")
  })

  it('acquire registers refs and checkpoint registers the ref via the dsh-mission bin', async () => {
    const acquire = await runLab(['acquire', '--image', 'app:latest', '--mission', 'm-1', '--run', 'r-1'], {}, true)
    expect(acquire.code).toBe(0)
    const info = JSON.parse(acquire.stdout) as { id: string; resource: string; fingerprint: string }
    expect(acquire.log).toContain(`dsh-mission set-refs m-1 --resource ${info.resource} --fingerprint ${info.fingerprint} --run r-1`)
    const env = { STUB_PS: info.resource, STUB_INSPECT: JSON.stringify([{
      Name: `/${info.resource}`,
      Config: { Labels: { 'dsh-lab.managed': 'true', 'dsh-lab.unit': info.id, 'dsh-lab.mission': 'm-1', 'dsh-lab.run': 'r-1', 'dsh-lab.fingerprint': info.fingerprint } },
      State: { Running: true },
    }]) }
    const checkpoint = await runLab(['checkpoint', info.id, '--name', 'iter-1'], env, true)
    expect(checkpoint.code).toBe(0)
    expect(checkpoint.log).toContain('dsh-mission add-checkpoint m-1 --name iter-1 --ref')
  })

  it('status prints the reconciled unit list (--json)', async () => {
    const env = { STUB_PS: 'dsh-lab-t1', STUB_INSPECT: UNIT_INSPECT }
    const run = await runLab(['status', '--json'], env, false)
    expect(run.code).toBe(0)
    const units = JSON.parse(run.stdout) as { id: string; running: boolean; missionId?: string }[]
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({ id: 't1', running: true, missionId: 'm-1' })
  })

  it('status without --json renders the progress table', async () => {
    const env = { STUB_PS: 'dsh-lab-t1', STUB_INSPECT: UNIT_INSPECT }
    const run = await runLab(['status'], env, false)
    expect(run.code).toBe(0)
    expect(run.stdout).toContain('UNIT')
    expect(run.stdout).toContain('MISSION')
    expect(run.stdout).toContain('TASK')
    // Identical ENV cells across rows are the comparability proof, next to
    // TASK's fairness proof.
    expect(run.stdout).toContain('ENV')
    expect(run.stdout).toContain('t1')
  })
})

describe('dsh-lab CLI flag validation', () => {
  it('an unknown flag WITH a value exits 2, not silent success', async () => {
    const run = await runLab(['populate', 't1', '--source', '/tmp', '--manifest-path', '/tmp/m.json'], {}, false)
    expect(run.code).toBe(2)
    expect(run.stderr).toContain('unknown flag --manifest-path')
  })

  it('an unknown value-less flag exits 2', async () => {
    const run = await runLab(['release', 't1', '--froce'], {}, false)
    expect(run.code).toBe(2)
    expect(run.stderr).toContain('unknown flag --froce')
  })
})
