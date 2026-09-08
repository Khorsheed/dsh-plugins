import { describe, expect, it } from 'vitest'
import { DockerProvider } from '../src/docker.ts'
import type { AcquireSpec, EnvironmentFingerprint, Exec, ExecResult } from '../src/types.ts'

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

/** A provider whose image inspect always answers with one stable repo digest. */
function pinnedImageProvider(): DockerProvider {
  const { exec } = fakeExec(() => ({ exitCode: 0, stdout: '["registry/app@sha256:aaa","registry/app@sha256:bbb"] sha256:local\n', stderr: '' }))
  return makeProvider(exec)
}

/** The fingerprint string for one spec, off the pinned image. */
async function fingerprintOf(spec: Omit<AcquireSpec, 'image'>): Promise<string> {
  const { fingerprint } = await pinnedImageProvider().fingerprint({ image: 'app:latest', ...spec })
  return fingerprint
}

describe('DockerProvider.fingerprint (image component)', () => {
  it('prefers the first repo digest and carries it as the image component', async () => {
    const resolved = await pinnedImageProvider().fingerprint({ image: 'app:latest' })
    expect(resolved.components.image).toBe('registry/app@sha256:aaa')
    expect(resolved.fingerprint).toMatch(/^lab-env:[0-9a-f]{64}$/)
  })

  it('falls back to the image id when no digest exists', async () => {
    const { exec } = fakeExec(() => ({ exitCode: 0, stdout: '[] sha256:local\n', stderr: '' }))
    const resolved = await makeProvider(exec).fingerprint({ image: 'app:latest' })
    expect(resolved.components.image).toBe('sha256:local')
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
    const resolved = await makeProvider(exec).fingerprint({ image: 'app:latest' })
    expect(resolved.components.image).toBe('registry/app@sha256:pulled')
    expect(calls.some((argv) => argv[0] === 'pull' && argv[1] === 'app:latest')).toBe(true)
  })

  it('fails loud when the image cannot be resolved at all', async () => {
    const { exec } = fakeExec((argv) => argv[0] === 'image' ? { exitCode: 1, stdout: '', stderr: 'No such image' } : undefined)
    await expect(makeProvider(exec).fingerprint({ image: 'ghost:latest' })).rejects.toThrow(/fingerprint/)
  })

  it('changes when the image digest changes, everything else equal', async () => {
    const { exec } = fakeExec(() => ({ exitCode: 0, stdout: '["registry/app@sha256:other"] sha256:local\n', stderr: '' }))
    const other = await makeProvider(exec).fingerprint({ image: 'app:latest' })
    expect(other.fingerprint).not.toBe(await fingerprintOf({}))
  })
})

describe('DockerProvider.fingerprint (composite components)', () => {
  it('separates the same image under different resource ceilings', async () => {
    const small = await fingerprintOf({ resources: { cpus: '2', memory: '4g' } })
    const large = await fingerprintOf({ resources: { cpus: '2', memory: '8g' } })
    const wide = await fingerprintOf({ resources: { cpus: '4', memory: '4g' } })
    const none = await fingerprintOf({})
    expect(new Set([small, large, wide, none]).size).toBe(4)
  })

  it('names which component differs, so an incomparable pair is diagnosable', async () => {
    const small = await pinnedImageProvider().fingerprint({ image: 'app:latest', resources: { cpus: '2', memory: '4g' } })
    const large = await pinnedImageProvider().fingerprint({ image: 'app:latest', resources: { cpus: '2', memory: '8g' } })
    expect(small.components.image).toBe(large.components.image)
    expect(small.components.resources).toEqual({ cpus: '2', memory: '4294967296' })
    expect(large.components.resources).toEqual({ cpus: '2', memory: '8589934592' })
  })

  it('reads equal ceilings written in different units as one ceiling', async () => {
    expect(await fingerprintOf({ resources: { cpus: '2', memory: '4g' } }))
      .toBe(await fingerprintOf({ resources: { cpus: 2.0, memory: '4096m' } }))
  })

  it('ignores mount declaration order — it is not an environment fact', async () => {
    const forward = await fingerprintOf({
      mounts: [
        { source: '/host/a', target: '/input', readonly: true },
        { source: '/host/b', target: '/skills' },
      ],
    })
    const reversed = await fingerprintOf({
      mounts: [
        { source: '/host/b', target: '/skills' },
        { source: '/host/a', target: '/input', readonly: true },
      ],
    })
    expect(forward).toBe(reversed)
  })

  it('ignores the host side of a mount — the same input lands at different host paths per machine', async () => {
    expect(await fingerprintOf({ mounts: [{ source: '/run-1/worktree', target: '/input', readonly: true }] }))
      .toBe(await fingerprintOf({ mounts: [{ source: '/run-2/worktree', target: '/input', readonly: true }] }))
  })

  it('separates an extra mount, a moved target, and a dropped read-only bit', async () => {
    const base = await fingerprintOf({ mounts: [{ source: '/host/a', target: '/input', readonly: true }] })
    const extra = await fingerprintOf({
      mounts: [{ source: '/host/a', target: '/input', readonly: true }, { source: '/host/b', target: '/creds' }],
    })
    const moved = await fingerprintOf({ mounts: [{ source: '/host/a', target: '/data', readonly: true }] })
    const writable = await fingerprintOf({ mounts: [{ source: '/host/a', target: '/input' }] })
    expect(new Set([base, extra, moved, writable]).size).toBe(4)
  })

  it('ignores env VALUES and separates env KEYS', async () => {
    const cellA = await fingerprintOf({ env: { EVAL_CELL: 'a', TOKEN: 'secret-a' } })
    const cellB = await fingerprintOf({ env: { EVAL_CELL: 'b', TOKEN: 'secret-b' } })
    const reordered = await fingerprintOf({ env: { TOKEN: 'secret-b', EVAL_CELL: 'b' } })
    const extraKey = await fingerprintOf({ env: { EVAL_CELL: 'a', TOKEN: 'secret-a', HTTP_PROXY: 'x' } })
    expect(cellA).toBe(cellB)
    expect(cellA).toBe(reordered)
    expect(cellA).not.toBe(extraKey)
  })

  it('leaks neither host paths nor env values into the printed components', async () => {
    const resolved = await pinnedImageProvider().fingerprint({
      image: 'app:latest',
      mounts: [{ source: '/srv/private/secret-worktree', target: '/input', readonly: true }],
      env: { TOKEN: 'sk-live-do-not-print' },
    })
    const serialized = JSON.stringify(resolved.components)
    expect(serialized).not.toContain('/srv/private')
    expect(serialized).not.toContain('sk-live-do-not-print')
    expect(resolved.components.envKeys).toEqual(['TOKEN'])
    expect(resolved.components.mounts).toEqual([{ target: '/input', type: 'bind', readonly: true }])
  })

  it('keeps the component shape fixed — an undeclared ceiling is null, not a missing key', async () => {
    const resolved = await pinnedImageProvider().fingerprint({ image: 'app:latest' })
    expect(resolved.components).toEqual({
      version: 1,
      image: 'registry/app@sha256:aaa',
      resources: { cpus: null, memory: null },
      mounts: [],
      envKeys: [],
      network: null,
      user: null,
    })
  })

  it('separates the network and the in-container user', async () => {
    const bare = await fingerprintOf({})
    const isolated = await fingerprintOf({ network: 'eval-net' })
    const none = await fingerprintOf({ network: 'none' })
    const asNode = await fingerprintOf({ user: '1000:1000' })
    expect(new Set([bare, isolated, none, asNode]).size).toBe(4)
  })

  it('names the network and user components, so an incomparable pair is diagnosable', async () => {
    const resolved = await pinnedImageProvider().fingerprint({
      image: 'app:latest',
      network: 'eval-net',
      user: '1000:1000',
    })
    expect(resolved.components.network).toBe('eval-net')
    expect(resolved.components.user).toBe('1000:1000')
  })

  it('separates a volume mount from a bind, but not one volume name from another', async () => {
    const bind = await fingerprintOf({ mounts: [{ source: '/host/creds', target: '/creds' }] })
    const codex = await fingerprintOf({ mounts: [{ source: 'eval-creds-codex', target: '/creds', type: 'volume' }] })
    const claude = await fingerprintOf({ mounts: [{ source: 'eval-creds-claude', target: '/creds', type: 'volume' }] })
    expect(codex).not.toBe(bind)
    expect(codex).toBe(claude)
  })

  it('refuses a ceiling it cannot normalize instead of hashing the raw literal', async () => {
    await expect(pinnedImageProvider().fingerprint({ image: 'app:latest', resources: { memory: '4 gigs' } }))
      .rejects.toThrow(/resources\.memory/)
    await expect(pinnedImageProvider().fingerprint({ image: 'app:latest', resources: { cpus: 'many' } }))
      .rejects.toThrow(/resources\.cpus/)
  })
})

/** A resolved fingerprint standing in for one the provider computed. */
const RESOLVED: EnvironmentFingerprint = {
  fingerprint: 'lab-env:feedface',
  components: {
    version: 1,
    image: 'registry/app@sha256:fp',
    resources: { cpus: null, memory: null },
    mounts: [{ target: '/input', type: 'bind', readonly: true }],
    envKeys: ['MODE'],
  },
}

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
    }, RESOLVED)
    expect(resource).toBe('dsh-lab-abc123')
    const run = calls[0] ?? []
    expect(run.slice(0, 4)).toEqual(['run', '-d', '--name', 'dsh-lab-abc123'])
    const text = run.join(' ')
    expect(text).toContain('dsh-lab.managed=true')
    expect(text).toContain('dsh-lab.unit=abc123')
    expect(text).toContain('dsh-lab.fingerprint=lab-env:feedface')
    expect(text).toContain('dsh-lab.mission=m-1')
    expect(text).toContain('dsh-lab.run=r-1')
    expect(text).toContain('type=bind,source=/data/layer,target=/input,readonly')
    expect(text).toContain('--env MODE=x')
    expect(text).toContain('--workdir /work')
    expect(run.slice(-3)).toEqual(['app:latest', 'sleep', 'infinity'])
    expect(calls[1]).toEqual([
      'exec', '--user', '0', 'dsh-lab-abc123', 'sh', '-c',
      'mkdir -p /run/dsh-lab/pids && chmod 1777 /run/dsh-lab /run/dsh-lab/pids',
    ])
  })

  it('prepares the pid directory as root and world-writable, so a non-root unit can drop pidfiles', async () => {
    const { exec, calls } = fakeExec(() => undefined)
    await makeProvider(exec).acquire('abc123', { image: 'app:latest', user: '1000:1000' }, RESOLVED)
    const prepare = calls[1] ?? []
    expect(prepare.slice(0, 4)).toEqual(['exec', '--user', '0', 'dsh-lab-abc123'])
    expect(prepare[6]).toContain('chmod 1777 ')
    expect(prepare[6]).toContain('/run/dsh-lab/pids')
    expect(calls).toHaveLength(2)
  })

  it('makes the scratch ROOT writable too, so verify can create its material directory as the unit user', async () => {
    const { exec, calls } = fakeExec(() => undefined)
    await makeProvider(exec).acquire('abc123', { image: 'app:latest', user: '1000:1000' }, RESOLVED)
    // Without this, `verify`'s own `mkdir -p /run/dsh-lab/verify` runs as the
    // unit's user against a root-owned 0755 parent and fails — every verify
    // call with material on exactly the units this project runs.
    expect(calls[1]?.[6]).toContain('chmod 1777 /run/dsh-lab /run/dsh-lab/pids')
  })

  it('does not touch the workdir unless ownWorkdir asks it to', async () => {
    const { exec, calls } = fakeExec(() => undefined)
    await makeProvider(exec).acquire('abc123', { image: 'app:latest', workdir: '/workspace' }, RESOLVED)
    expect(calls).toHaveLength(2)
  })

  it('ownWorkdir creates the workdir and chowns it to the unit\'s own uid:gid', async () => {
    const { exec, calls } = fakeExec((argv) => (
      argv[0] === 'exec' && argv.includes('printf %s:%s "$(id -u)" "$(id -g)"')
        ? { exitCode: 0, stdout: '1000:1000', stderr: '' }
        : undefined
    ))
    await makeProvider(exec).acquire('abc123', { image: 'app:latest', user: '1000', workdir: '/workspace', ownWorkdir: true }, RESOLVED)
    // The uid is asked of the UNIT, not derived from the spec: an image that
    // ships its own USER must be served as well as one that declares `user`.
    expect(calls[2]?.[0]).toBe('exec')
    expect(calls[2]?.join(' ')).toContain('id -u')
    expect(calls[3]).toEqual([
      'exec', '--user', '0', 'dsh-lab-abc123', 'sh', '-c',
      `mkdir -p '/workspace' && chown -R '1000:1000' '/workspace'`,
    ])
  })

  it('ownWorkdir falls back to a plain create when the daemon refuses --user 0', async () => {
    const { exec, calls } = fakeExec((argv) => (
      argv[0] === 'exec' && argv[1] === '--user' && argv[6]?.startsWith('mkdir -p \'') === true
        ? { exitCode: 1, stdout: '', stderr: 'unable to find user' }
        : undefined
    ))
    await makeProvider(exec).acquire('abc123', { image: 'app:latest', workdir: '/workspace', ownWorkdir: true }, RESOLVED)
    // The plain create is the pre-option behavior: the unit's own user makes
    // the directory, which works wherever its parent is writable.
    expect(calls[calls.length - 1]?.join(' ')).toContain('mkdir -p /workspace')
  })

  it('falls back to a plain create when the daemon refuses --user 0 (userns-remap)', async () => {
    const { exec, calls } = fakeExec((argv) => (
      argv[0] === 'exec' && argv[1] === '--user' ? { exitCode: 1, stdout: '', stderr: 'unable to find user' } : undefined
    ))
    await makeProvider(exec).acquire('abc123', { image: 'app:latest' }, RESOLVED)
    expect(calls[2]?.slice(0, 4)).toEqual(['exec', 'dsh-lab-abc123', 'sh', '-c'])
  })

  it('labels the container with the components, so reconcile recovers them without a state file', async () => {
    const { exec, calls } = fakeExec(() => undefined)
    await makeProvider(exec).acquire('abc123', { image: 'app:latest' }, RESOLVED)
    const label = (calls[0] ?? []).find((arg) => arg.startsWith('dsh-lab.fingerprint-components='))
    expect(JSON.parse((label ?? '').slice('dsh-lab.fingerprint-components='.length))).toEqual(RESOLVED.components)
  })

  it('applies the declared ceilings — a fingerprint may not claim a limit the container lacks', async () => {
    const { exec, calls } = fakeExec(() => undefined)
    await makeProvider(exec).acquire('abc123', {
      image: 'app:latest',
      resources: { cpus: 2.0, memory: '4g' },
    }, RESOLVED)
    const run = calls[0] ?? []
    expect(run[run.indexOf('--cpus') + 1]).toBe('2')
    expect(run[run.indexOf('--memory') + 1]).toBe('4294967296')
  })

  it('declares no ceiling flags when the spec declares none', async () => {
    const { exec, calls } = fakeExec(() => undefined)
    await makeProvider(exec).acquire('abc123', { image: 'app:latest' }, RESOLVED)
    expect((calls[0] ?? []).join(' ')).not.toContain('--cpus')
    expect((calls[0] ?? []).join(' ')).not.toContain('--memory')
  })

  it('joins the declared network and runs as the declared user', async () => {
    const { exec, calls } = fakeExec(() => undefined)
    await makeProvider(exec).acquire('abc123', {
      image: 'app:latest',
      network: 'eval-net',
      user: '1000:1000',
    }, RESOLVED)
    const run = calls[0] ?? []
    expect(run[run.indexOf('--network') + 1]).toBe('eval-net')
    expect(run[run.indexOf('--user') + 1]).toBe('1000:1000')
  })

  it('passes no --network when none is declared — which is docker\'s default bridge, WITH egress', async () => {
    const { exec, calls } = fakeExec(() => undefined)
    await makeProvider(exec).acquire('abc123', { image: 'app:latest' }, RESOLVED)
    expect((calls[0] ?? []).join(' ')).not.toContain('--network')
    expect((calls[0] ?? []).join(' ')).not.toContain('--user 1000')
  })

  it('mounts a named volume as type=volume and keeps binds unchanged', async () => {
    const { exec, calls } = fakeExec(() => undefined)
    await makeProvider(exec).acquire('abc123', {
      image: 'app:latest',
      mounts: [
        { source: 'eval-creds-codex', target: '/creds/codex', type: 'volume' },
        { source: '/data/layer', target: '/input', readonly: true },
      ],
    }, RESOLVED)
    const text = (calls[0] ?? []).join(' ')
    expect(text).toContain('type=volume,source=eval-creds-codex,target=/creds/codex')
    expect(text).toContain('type=bind,source=/data/layer,target=/input,readonly')
  })

  it('mounts a read-only volume with the readonly option', async () => {
    const { exec, calls } = fakeExec(() => undefined)
    await makeProvider(exec).acquire('abc123', {
      image: 'app:latest',
      mounts: [{ source: 'snapshot', target: '/snapshot', type: 'volume', readonly: true }],
    }, RESOLVED)
    expect((calls[0] ?? []).join(' ')).toContain('type=volume,source=snapshot,target=/snapshot,readonly')
  })
})

describe('DockerProvider.populate / collect', () => {
  it('populates through the pidfile-wrapped exec, then docker cp into the unit, then stamps the activity baseline', async () => {
    const { exec, calls } = fakeExec(() => undefined)
    await makeProvider(exec).populate('dsh-lab-x', { source: '/host/layer', target: '/workspace' })
    const [wrap, cp, stamp] = calls
    expect(wrap?.slice(0, 4)).toEqual(['exec', 'dsh-lab-x', 'sh', '-c'])
    expect(wrap?.[4]).toContain('echo $$ > /run/dsh-lab/pids/$$.pid')
    expect(wrap?.slice(-3)).toEqual(['mkdir', '-p', '/workspace'])
    expect(cp).toEqual(['cp', '/host/layer/.', 'dsh-lab-x:/workspace'])
    // docker cp preserves source mtimes; the marker is the lastActivityAt baseline.
    expect(stamp?.slice(-2)).toEqual(['touch', '/workspace/.lab-materialized'])
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

describe('DockerProvider.activity', () => {
  it('reads the newest workspace mtime and cgroup v2 cpu usage', async () => {
    const { exec, calls } = fakeExec((argv) => {
      const joined = argv.join(' ')
      if (joined.includes('stat -c')) return { exitCode: 0, stdout: '1750000000\n1749999900\n', stderr: '' }
      if (joined.includes('cpu.stat')) return { exitCode: 0, stdout: 'usage_usec 98765\nuser_usec 100\n', stderr: '' }
      return undefined
    })
    const facts = await makeProvider(exec).activity('dsh-lab-x', '/workspace')
    expect(facts).toEqual({ mtime: 1_750_000_000_000, cpuUsageUsec: 98765 })
    expect(calls[0]?.join(' ')).toContain('find')
    expect(calls[0]?.join(' ')).toContain('/run/dsh-lab/pids/$$.pid')
  })

  it('falls back to cgroup v1 cpuacct and tolerates unreadable mtime', async () => {
    const { exec } = fakeExec((argv) => {
      const joined = argv.join(' ')
      if (joined.includes('stat -c')) return { exitCode: 1, stdout: '', stderr: 'stat: unrecognized option' }
      if (joined.includes('cpu.stat')) return { exitCode: 1, stdout: '', stderr: 'No such file' }
      if (joined.includes('cpuacct.usage')) return { exitCode: 0, stdout: '5000000\n', stderr: '' }
      return undefined
    })
    const facts = await makeProvider(exec).activity('dsh-lab-x', '/workspace')
    expect(facts.mtime).toBeUndefined()
    expect(facts.cpuUsageUsec).toBe(5000)
  })
})
