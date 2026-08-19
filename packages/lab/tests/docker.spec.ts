import { describe, expect, it } from 'vitest'
import { DockerProvider } from '../src/docker.ts'
import type { Exec, ExecResult } from '../src/types.ts'

/** A scripted host command runner recording every invocation. */
function fakeExec(handler: (argv: string[]) => ExecResult | undefined): { exec: Exec; calls: string[][] } {
  const calls: string[][] = []
  const exec: Exec = (argv) => {
    calls.push([...argv])
    return Promise.resolve(handler(argv) ?? { exitCode: 0, stdout: '', stderr: '' })
  }
  return { exec, calls }
}

const noopSleep = (): Promise<void> => Promise.resolve()

function makeProvider(exec: Exec): DockerProvider {
  return new DockerProvider(exec, { sleep: noopSleep })
}

describe('DockerProvider.fingerprint', () => {
  it('prefers the first repo digest', async () => {
    const { exec } = fakeExec(() => ({ exitCode: 0, stdout: '["registry/app@sha256:aaa","registry/app@sha256:bbb"] sha256:local\n', stderr: '' }))
    await expect(makeProvider(exec).fingerprint({ image: 'app:latest' })).resolves.toBe('registry/app@sha256:aaa')
  })

  it('falls back to the image id when no digest exists', async () => {
    const { exec } = fakeExec(() => ({ exitCode: 0, stdout: '[] sha256:local\n', stderr: '' }))
    await expect(makeProvider(exec).fingerprint({ image: 'app:latest' })).resolves.toBe('sha256:local')
  })

  it('pulls a missing image, then resolves the fingerprint', async () => {
    let inspected = 0
    const { exec, calls } = fakeExec((argv) => {
      if (argv[0] === 'image') {
        inspected += 1
        return inspected === 1
          ? { exitCode: 1, stdout: '', stderr: 'No such image' }
          : { exitCode: 0, stdout: '["registry/app@sha256:pulled"] sha256:x\n', stderr: '' }
      }
      return undefined
    })
    await expect(makeProvider(exec).fingerprint({ image: 'app:latest' })).resolves.toBe('registry/app@sha256:pulled')
    expect(calls.some((argv) => argv[0] === 'pull' && argv[1] === 'app:latest')).toBe(true)
  })

  it('fails loud when the image cannot be resolved at all', async () => {
    const { exec } = fakeExec((argv) => argv[0] === 'image' ? { exitCode: 1, stdout: '', stderr: 'No such image' } : undefined)
    await expect(makeProvider(exec).fingerprint({ image: 'ghost:latest' })).rejects.toThrow(/fingerprint/)
  })
})

describe('DockerProvider.acquire', () => {
  it('runs a detached labeled container and prepares the pid directory', async () => {
    const { exec, calls } = fakeExec(() => undefined)
    const resource = await makeProvider(exec).acquire('abc123', {
      image: 'app:latest',
      missionId: 'm-1',
      runId: 'r-1',
      mounts: [{ source: '/data/layer', target: '/input', readonly: true }],
      env: { MODE: 'x' },
      workdir: '/work',
    }, 'registry/app@sha256:fp')
    expect(resource).toBe('dsh-lab-abc123')
    const run = calls[0] ?? []
    expect(run.slice(0, 4)).toEqual(['run', '-d', '--name', 'dsh-lab-abc123'])
    const text = run.join(' ')
    expect(text).toContain('dsh-lab.managed=true')
    expect(text).toContain('dsh-lab.unit=abc123')
    expect(text).toContain('dsh-lab.fingerprint=registry/app@sha256:fp')
    expect(text).toContain('dsh-lab.mission=m-1')
    expect(text).toContain('dsh-lab.run=r-1')
    expect(text).toContain('type=bind,source=/data/layer,target=/input,readonly')
    expect(text).toContain('--env MODE=x')
    expect(text).toContain('--workdir /work')
    expect(run.slice(-3)).toEqual(['app:latest', 'sleep', 'infinity'])
    expect(calls[1]).toEqual(['exec', 'dsh-lab-abc123', 'mkdir', '-p', '/run/dsh-lab/pids'])
  })
})

describe('DockerProvider.populate / collect', () => {
  it('populates through the pidfile-wrapped exec, then docker cp into the unit', async () => {
    const { exec, calls } = fakeExec(() => undefined)
    await makeProvider(exec).populate('dsh-lab-x', { source: '/host/layer', target: '/workspace' })
    const [wrap, cp] = calls
    expect(wrap?.slice(0, 4)).toEqual(['exec', 'dsh-lab-x', 'sh', '-c'])
    expect(wrap?.[4]).toContain('echo $$ > /run/dsh-lab/pids/$$.pid')
    expect(wrap?.slice(-3)).toEqual(['mkdir', '-p', '/workspace'])
    expect(cp).toEqual(['cp', '/host/layer/.', 'dsh-lab-x:/workspace'])
  })

  it('collects out of the unit with docker cp', async () => {
    const { exec, calls } = fakeExec(() => undefined)
    await makeProvider(exec).collect('dsh-lab-x', { source: '/workspace/out', target: '/host/target' })
    expect(calls[0]).toEqual(['cp', 'dsh-lab-x:/workspace/out/.', '/host/target'])
  })
})

describe('DockerProvider.terminate (orphan compensation)', () => {
  it('sweeps pidfile-recorded processes before removing the container', async () => {
    const { exec, calls } = fakeExec(() => undefined)
    await makeProvider(exec).terminate('dsh-lab-x')
    expect(calls).toHaveLength(2)
    const [sweep, rm] = calls
    expect(sweep?.slice(0, 4)).toEqual(['exec', 'dsh-lab-x', 'sh', '-c'])
    expect(sweep?.[4]).toContain('/run/dsh-lab/pids/*.pid')
    expect(sweep?.[4]).toContain('kill -TERM')
    expect(rm).toEqual(['rm', '-f', 'dsh-lab-x'])
  })

  it('still removes the container when the sweep fails (container already stopped)', async () => {
    const { exec, calls } = fakeExec((argv) => argv[0] === 'exec' ? { exitCode: 1, stdout: '', stderr: 'container is not running' } : undefined)
    await makeProvider(exec).terminate('dsh-lab-x')
    expect(calls[1]).toEqual(['rm', '-f', 'dsh-lab-x'])
  })
})

describe('DockerProvider.listManaged', () => {
  it('rebuilds managed resources from daemon labels', async () => {
    const { exec } = fakeExec((argv) => {
      if (argv[0] === 'ps') return { exitCode: 0, stdout: 'dsh-lab-a\ndsh-lab-b\n', stderr: '' }
      if (argv[0] === 'inspect') {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            { Name: '/dsh-lab-a', Created: '2026-08-20T01:00:00.000Z', Config: { Labels: { 'dsh-lab.unit': 'a', 'dsh-lab.mission': 'm-1', 'dsh-lab.fingerprint': 'fp-a' } }, State: { Running: true } },
            { Name: '/dsh-lab-b', Created: '2026-08-20T02:00:00.000Z', Config: { Labels: { 'dsh-lab.unit': 'b' } }, State: { Running: false } },
          ]),
          stderr: '',
        }
      }
      return undefined
    })
    const managed = await makeProvider(exec).listManaged()
    expect(managed).toHaveLength(2)
    expect(managed[0]).toMatchObject({ id: 'a', resource: 'dsh-lab-a', running: true, createdAt: Date.parse('2026-08-20T01:00:00.000Z') })
    expect(managed[0]?.labels['dsh-lab.mission']).toBe('m-1')
    expect(managed[1]).toMatchObject({ id: 'b', running: false })
  })

  it('returns an empty list without spawning inspect when nothing is managed', async () => {
    const { exec, calls } = fakeExec((argv) => argv[0] === 'ps' ? { exitCode: 0, stdout: '', stderr: '' } : undefined)
    await expect(makeProvider(exec).listManaged()).resolves.toEqual([])
    expect(calls).toHaveLength(1)
  })
})
