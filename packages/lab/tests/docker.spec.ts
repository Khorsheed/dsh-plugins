import { describe, expect, it } from 'vitest'
import { DockerProvider } from '../src/docker.ts'
import type { Exec, ExecResult } from '../src/types.ts'

/** A scripted host command runner recording every invocation (docker prefix asserted, then stripped). */
function fakeExec(handler: (argv: string[], options?: { timeoutMs?: number }) => ExecResult | undefined): { exec: Exec; calls: string[][] } {
  const calls: string[][] = []
  const exec: Exec = (argv, options) => {
    if (argv[0] !== 'docker') return Promise.reject(new Error(`unprefixed command: ${argv.join(' ')}`))
    const stripped = argv.slice(1)
    calls.push(stripped)
    return Promise.resolve(handler(stripped, options) ?? { exitCode: 0, stdout: '', stderr: '' })
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

describe('DockerProvider.checkpoint', () => {
  it('initializes git on first use, commits, tags, and returns the commit sha', async () => {
    const { exec, calls } = fakeExec((argv) => {
      if (argv.includes('rev-parse') && argv.includes('--is-inside-work-tree')) {
        return { exitCode: 128, stdout: '', stderr: 'not a git repository' }
      }
      if (argv.includes('rev-parse')) return { exitCode: 0, stdout: 'deadbeef123\n', stderr: '' }
      return undefined
    })
    const ref = await makeProvider(exec).checkpoint('dsh-lab-x', '/workspace', 'iter-1')
    expect(ref).toBe('deadbeef123')
    const inner = calls.map((argv) => argv.slice(6).join(' ')) // strip exec … sh -c <wrapper> dsh-lab
    expect(inner[0]).toBe('git -C /workspace rev-parse --is-inside-work-tree')
    expect(inner[1]).toBe('git -C /workspace init')
    expect(inner[2]).toBe('git -C /workspace add -A')
    expect(inner[3]).toContain('commit --allow-empty -m iter-1')
    expect(inner[3]).toContain('user.name=dsh-lab')
    expect(inner[4]).toBe('git -C /workspace tag -f iter-1')
    expect(inner[5]).toBe('git -C /workspace rev-parse iter-1')
  })

  it('skips init inside an existing repo', async () => {
    const { exec, calls } = fakeExec((argv) => {
      if (argv.includes('rev-parse') && !argv.includes('--is-inside-work-tree')) {
        return { exitCode: 0, stdout: 'cafe\n', stderr: '' }
      }
      return undefined
    })
    await makeProvider(exec).checkpoint('dsh-lab-x', '/workspace', 'iter-2')
    expect(calls.some((argv) => argv.includes('init'))).toBe(false)
  })

  it('fails loud when the workspace cannot be committed (e.g. read-only mount)', async () => {
    const { exec } = fakeExec((argv) => {
      if (argv.includes('--is-inside-work-tree')) return { exitCode: 128, stdout: '', stderr: 'not a git repository' }
      if (argv.includes('init')) return { exitCode: 1, stdout: '', stderr: 'Read-only file system' }
      return undefined
    })
    await expect(makeProvider(exec).checkpoint('dsh-lab-x', '/input', 'iter-1')).rejects.toThrow(/Read-only file system/)
  })
})

describe('DockerProvider.verify', () => {
  it('runs the command in the workspace through the pidfile wrapper and returns the outcome verbatim', async () => {
    const { exec, calls } = fakeExec((argv) => {
      if (argv[0] === 'exec' && argv.includes('npm')) {
        return { exitCode: 1, stdout: 'tests failed: 2', stderr: 'boom', timedOut: false }
      }
      return undefined
    })
    const result = await makeProvider(exec).verify('dsh-lab-x', '/workspace', { command: ['npm', 'test'] })
    expect(result).toMatchObject({ exitCode: 1, stdout: 'tests failed: 2', stderr: 'boom', timedOut: false })
    const runCall = calls[0] ?? []
    expect(runCall.slice(0, 4)).toEqual(['exec', '--workdir', '/workspace', 'dsh-lab-x'])
    expect(runCall.slice(-2)).toEqual(['npm', 'test'])
  })

  it('copies material in, always removes it after — even when the run fails', async () => {
    const { exec, calls } = fakeExec((argv) => {
      if (argv[0] === 'exec' && argv.includes('./run.sh')) return { exitCode: 2, stdout: '', stderr: '' }
      return undefined
    })
    await makeProvider(exec).verify('dsh-lab-x', '/workspace', { command: ['./run.sh'], source: '/host/verify' })
    const verbs = calls.map((argv) => argv.join(' '))
    expect(verbs.some((v) => v.includes('rm -rf /run/dsh-lab/verify') && v.includes('mkdir') === false)).toBe(true)
    expect(calls.some((argv) => argv.join(' ') === 'cp /host/verify/. dsh-lab-x:/run/dsh-lab/verify')).toBe(true)
    expect(verbs[verbs.length - 1]).toContain('rm -rf /run/dsh-lab/verify')
  })

  it('forwards the timeout to the exec runner and surfaces the timedOut fact', async () => {
    let seenTimeout: number | undefined
    const { exec, calls } = fakeExec((argv, options) => {
      if (argv[0] === 'exec') {
        seenTimeout = options?.timeoutMs
        return { exitCode: -1, stdout: '', stderr: '', timedOut: true }
      }
      return undefined
    })
    const result = await makeProvider(exec).verify('dsh-lab-x', '/workspace', { command: ['sleep', '99'], timeoutMs: 100 })
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBe(-1)
    expect(seenTimeout).toBe(100)
    expect(calls[0]?.slice(0, 2)).toEqual(['exec', '--workdir'])
  })
})
