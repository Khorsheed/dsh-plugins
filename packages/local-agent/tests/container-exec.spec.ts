/**
 * The container exec transport: one CLI launch rewritten into `docker exec`.
 * The assertions here are the transport's whole contract — the argv shape, the
 * NAME-only env forwarding that keeps values out of the host process table,
 * and the loud failures for a target that cannot work.
 */
import { describe, expect, it } from 'vitest'
import { containerExecSpawn, containerScopedHome, delegationEnv } from '@khorsheed/dsh-local-agent'

/** Run `body` with `process.env` replaced by `env`, restoring it afterwards. */
function withEnv(env: Record<string, string>, body: () => void): void {
  const saved = process.env
  process.env = { ...env }
  try {
    body()
  } finally {
    process.env = saved
  }
}

const TARGET = { container: 'dsh-lab-abc123', workdir: '/workspace' }

describe('containerExecSpawn', () => {
  it('wraps the CLI argv in `docker exec` without touching it', () => {
    withEnv({ PATH: 'bin', HOME: '/home/user' }, () => {
      const launch = containerExecSpawn(
        TARGET,
        { argv: ['codex', 'exec', '--json', 'do the thing'], env: {} },
        'subagent-codex',
      )
      expect(launch.argv).toEqual([
        'docker', 'exec', '-w', '/workspace', 'dsh-lab-abc123',
        'codex', 'exec', '--json', 'do the thing',
      ])
    })
  })

  it('forwards env by NAME only, carrying values in the docker client env', () => {
    withEnv({ PATH: 'bin', HOME: '/home/user' }, () => {
      const launch = containerExecSpawn(
        TARGET,
        {
          argv: ['dsh', 'x'],
          // The shape a provider builds: explicit entries plus tombstones.
          env: { DEEPSEEK_API_KEY: 'sk-secret', DSH_HOME: '/host/scoped', npm_config_cache: undefined },
        },
        'subagent-dsh',
      )
      // Names ride the argv; the secret does not — a host `ps` shows the flag
      // name and nothing else.
      expect(launch.argv).toEqual([
        'docker', 'exec', '-w', '/workspace',
        '-e', 'DEEPSEEK_API_KEY', '-e', 'DSH_HOME',
        'dsh-lab-abc123', 'dsh', 'x',
      ])
      expect(launch.argv.join(' ')).not.toContain('sk-secret')
      // The docker CLI reads them from its own environment.
      expect(launch.env['DEEPSEEK_API_KEY']).toBe('sk-secret')
      expect(launch.env['DSH_HOME']).toBe('/host/scoped')
      // A tombstone carries no value, so it forwards nothing — while still
      // tombstoning the ambient key for the docker client itself.
      expect(launch.argv).not.toContain('npm_config_cache')
    })
  })

  it("lets the target's env override the provider's host paths", () => {
    withEnv({ PATH: 'bin' }, () => {
      const launch = containerExecSpawn(
        { ...TARGET, env: { CODEX_HOME: '/creds/codex' } },
        { argv: ['codex'], env: { CODEX_HOME: '/host/scoped/codex' } },
        'subagent-codex',
      )
      expect(launch.argv.filter(entry => entry === '-e')).toHaveLength(1)
      expect(launch.env['CODEX_HOME']).toBe('/creds/codex')
    })
  })

  it('sorts the forwarded names so one launch has one argv', () => {
    withEnv({ PATH: 'bin' }, () => {
      const first = containerExecSpawn(
        { ...TARGET, env: { B: '2', A: '1' } },
        { argv: ['kimi'], env: { C: '3' } },
        'subagent-kimi',
      )
      const second = containerExecSpawn(
        { ...TARGET, env: { A: '1', B: '2' } },
        { argv: ['kimi'], env: { C: '3' } },
        'subagent-kimi',
      )
      expect(first.argv).toEqual(second.argv)
      expect(first.argv.slice(4, 10)).toEqual(['-e', 'A', '-e', 'B', '-e', 'C'])
    })
  })

  it('keeps the docker client pointed at the daemon the host configured', () => {
    withEnv({ PATH: 'bin', DOCKER_HOST: 'unix:///custom.sock', DOCKER_CONTEXT: 'lab' }, () => {
      const launch = containerExecSpawn(TARGET, { argv: ['claude'], env: {} }, 'subagent-claude')
      expect(launch.env['DOCKER_HOST']).toBe('unix:///custom.sock')
      expect(launch.env['DOCKER_CONTEXT']).toBe('lab')
      // The daemon coordinates are the CLIENT's, never the container's.
      expect(launch.argv).not.toContain('DOCKER_HOST')
    })
  })

  it('does not forward the ambient allowlist into the container', () => {
    withEnv({ PATH: '/host/bin', HOME: '/home/user', HTTPS_PROXY: 'http://host-proxy:1' }, () => {
      // A provider's explicit layer never names them (delegationEnv leaves
      // allowlisted keys to the seam's inheritance), so they cannot leak in.
      const launch = containerExecSpawn(
        TARGET,
        { argv: ['codex'], env: delegationEnv({ CODEX_HOME: '/host/scoped' }) },
        'subagent-codex',
      )
      expect(launch.argv.filter(entry => entry === '-e')).toHaveLength(1)
      expect(launch.argv).toContain('CODEX_HOME')
      expect(launch.argv).not.toContain('PATH')
      expect(launch.argv).not.toContain('HTTPS_PROXY')
    })
  })

  it('fails loud on a target docker would misread', () => {
    expect(() => containerExecSpawn({ container: '', workdir: '/w' }, { argv: ['x'], env: {} }, 'p'))
      .toThrow(/needs a container name/)
    expect(() => containerExecSpawn({ container: '--rm', workdir: '/w' }, { argv: ['x'], env: {} }, 'p'))
      .toThrow(/needs a container name/)
    expect(() => containerExecSpawn({ container: 'c', workdir: 'workspace' }, { argv: ['x'], env: {} }, 'p'))
      .toThrow(/must be an absolute in-container path/)
    expect(() => containerExecSpawn({ container: 'c', workdir: '/w', env: { 'BAD=KEY': 'v' } }, { argv: ['x'], env: {} }, 'p'))
      .toThrow(/not a usable environment variable name/)
  })
})

describe('containerScopedHome', () => {
  it('returns the in-container scoped home the target declares', () => {
    expect(containerScopedHome({ ...TARGET, env: { CODEX_HOME: '/creds/codex' } }, 'CODEX_HOME', 'p'))
      .toBe('/creds/codex')
  })

  it('fails loud when the target forgets it', () => {
    // Forwarding the host path instead would send the CLI to a directory that
    // does not exist inside the unit: no credentials, no rollout to read back,
    // and nothing in the output naming the cause.
    expect(() => containerScopedHome(TARGET, 'CODEX_HOME', 'subagent-codex'))
      .toThrow(/must declare CODEX_HOME as the in-container path/)
    expect(() => containerScopedHome({ ...TARGET, env: { CODEX_HOME: '' } }, 'CODEX_HOME', 'subagent-codex'))
      .toThrow(/must declare CODEX_HOME/)
  })
})
