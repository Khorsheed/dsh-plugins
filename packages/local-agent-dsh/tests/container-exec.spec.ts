/**
 * Container exec target: the same sub-dsh round, spawned through `docker exec`
 * inside a unit the caller acquired. Beyond the shared transport assertions
 * (argv shape on both drives, NAME-only env forwarding, no member channel),
 * dsh carries the one extra knob the four CLIs do not share: `NODE_OPTIONS=
 * --use-env-proxy`, without which undici ignores the unit's proxy variables
 * and the round never reaches the network at all.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { LocalAgentDelegationIntent } from '@khorsheed/dsh-local-agent'
import { describe, expect, it, vi } from 'vitest'
import { CONTAINER_NODE_OPTIONS, DshCliProvider } from '../src/dsh-cli-provider.ts'

/** A stub child that prints the final answer, then exits 0. */
function stubChild(): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  stdout.push('4\n')
  stdout.push(null)
  const stderr = new Readable({ read() {} })
  stderr.push(null)
  return {
    pid: 4242,
    stdin: undefined,
    stdout,
    stderr,
    collected: {
      stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
    },
    done: new Promise<{ exitCode: number; signal: null }>((resolve) => {
      setImmediate(() => { resolve({ exitCode: 0, signal: null }) })
    }),
    terminate: () => undefined,
    waitForExit: async () => true,
  }
}

const CHILD = 'child-1'
const TARGET = { container: 'dsh-lab-unit', workdir: '/workspace', env: { DSH_HOME: '/creds/dsh' } }

interface Capture {
  argv?: readonly string[]
  env?: Readonly<Record<string, string | undefined>>
  cwd?: string
}

function mount(intent: LocalAgentDelegationIntent | undefined): {
  provider: DshCliProvider
  capture: Capture
  homeDir: string
  member: ReturnType<typeof vi.fn>
} {
  const homeDir = mkdtempSync(join(tmpdir(), 'dsh-container-'))
  const capture: Capture = {}
  const member = vi.fn(() => 'token-xyz-1234')
  const liveChild = Session.create(SessionId(CHILD))
  liveChild.append('turn/start', { turn: 1 })
  liveChild.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const ctx = new Context()
  ctx.provide('localAgent', {
    homeDir: () => homeDir,
    takeDelegationIntent: () => intent,
    recordDelegation: () => {},
    getDelegation: () => undefined,
    recordRoundSettled: () => {},
    get: () => undefined,
    acquireResumeLock: () => true,
    releaseResumeLock: () => {},
    reportRunProgress: () => {},
    // A member channel IS available on this core — the container path must
    // decline it on purpose, not because the core lacks one.
    registerMemberRun: member,
    unregisterMemberRun: vi.fn(),
    memberBridgeSocketPath: () => '/host/member.sock',
    memberBridgeCommand: () => ({ command: 'node', args: ['/host/bridge.js'] }),
  })
  ctx.provide('subprocess', {
    spawn: (spec: { argv: readonly string[]; env: Readonly<Record<string, string>>; cwd: string }) => {
      capture.argv = spec.argv
      capture.env = spec.env
      capture.cwd = spec.cwd
      return stubChild()
    },
  })
  ctx.provide('credentials', { resolve: async () => ({ value: 'sk-test', source: 'env' }) })
  ctx.provide('sessions', {
    create: (id: string) => Session.create(SessionId(id)),
    get: (id: string) => (id === CHILD ? liveChild : undefined),
  })
  ctx.provide('logger', { warn: () => {}, info: () => {} })
  // `cliLaunch` is the existing knob for naming the CLI entry: on the host it
  // replicates this process, in a unit it is the image's own `dsh`.
  return { provider: new DshCliProvider(ctx, { cliLaunch: ['dsh'] }), capture, homeDir, member }
}

function request(): unknown {
  return {
    prompt: [{ type: 'text', text: '回答 2+2' }],
    parent: { session: { id: 'parent-1', header: { cwd: '/tmp' } } },
    descriptor: { description: '测试委派' },
    signal: new AbortController().signal,
  }
}

describe('dsh container exec target', () => {
  it('wraps the fresh argv in docker exec, forwarding the key and the proxy flag by name', async () => {
    const { provider, capture, homeDir, member } = mount({ kind: 'fresh', exec: TARGET })
    const run = await provider.start(request() as never)
    await run.result
    const argv = capture.argv as readonly string[]
    // Names are sorted, so the flag block is stable; the session id and task
    // stay wherever the CLI argv puts them.
    expect(argv.slice(0, 13)).toEqual([
      'docker', 'exec', '-w', '/workspace',
      '-e', 'DEEPSEEK_API_KEY', '-e', 'DSH_HOME', '-e', 'NODE_OPTIONS',
      'dsh-lab-unit', 'dsh', '--profile',
    ])
    // The resolved credential never reaches the host process table.
    expect(argv.join(' ')).not.toContain('sk-test')
    expect(capture.env?.['DEEPSEEK_API_KEY']).toBe('sk-test')
    // The caller's in-container scoped home wins over the host path.
    expect(capture.env?.['DSH_HOME']).toBe('/creds/dsh')
    expect(argv).not.toContain(homeDir)
    // undici does not read HTTP(S)_PROXY on its own: without this flag the
    // round dials the API directly and the unit's proxy sees no CONNECT.
    expect(capture.env?.['NODE_OPTIONS']).toBe(CONTAINER_NODE_OPTIONS)
    expect(capture.cwd).toBe('/tmp')
    // No member channel across the boundary — not even a minted token.
    expect(member).not.toHaveBeenCalled()
    await run.dispose()
  })

  it('leaves the host argv and env unchanged without a target', async () => {
    const { provider, capture, homeDir } = mount({ kind: 'fresh' })
    const run = await provider.start(request() as never)
    await run.result
    expect((capture.argv as readonly string[])[0]).toBe('dsh')
    expect(capture.env?.['DSH_HOME']).toBe(homeDir)
    // No proxy flag on the host: the host round is not behind a unit proxy,
    // and the injection is a container-transport fact, not a dsh default.
    expect(capture.env?.['NODE_OPTIONS']).toBeUndefined()
    // The member channel IS wired on a host round — the container path is the
    // one that declines it.
    expect(capture.env?.['DSH_MEMBER_TOKEN']).toBe('token-xyz-1234')
    await run.dispose()
  })

  it("keeps a caller's own NODE_OPTIONS instead of overriding it", async () => {
    const { provider, capture } = mount({
      kind: 'fresh',
      exec: { ...TARGET, env: { ...TARGET.env, NODE_OPTIONS: '--use-env-proxy --max-old-space-size=512' } },
    })
    const run = await provider.start(request() as never)
    await run.result
    expect(capture.env?.['NODE_OPTIONS']).toBe('--use-env-proxy --max-old-space-size=512')
    await run.dispose()
  })

  it('wraps the resume argv the same way', async () => {
    const { provider, capture } = mount({
      kind: 'resume', childSessionId: CHILD, cliSessionId: CHILD, exec: TARGET,
    })
    const run = await provider.start(request() as never)
    await run.result
    const argv = capture.argv as readonly string[]
    expect(argv.slice(0, 11)).toEqual([
      'docker', 'exec', '-w', '/workspace',
      '-e', 'DEEPSEEK_API_KEY', '-e', 'DSH_HOME', '-e', 'NODE_OPTIONS',
      'dsh-lab-unit',
    ])
    expect(argv).toContain('--resume')
    await run.dispose()
  })

  it('refuses a target that does not name the in-container scoped home', async () => {
    const { provider, capture } = mount({
      kind: 'fresh', exec: { container: 'dsh-lab-unit', workdir: '/workspace' },
    })
    await expect(provider.start(request() as never)).rejects.toThrow(/must declare DSH_HOME/)
    expect(capture.argv).toBeUndefined()
  })
})
