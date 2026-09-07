/**
 * Regression: `codex exec` refuses to start outside a Git repository unless
 * `--skip-git-repo-check` is on the argv. It exits before emitting a single
 * stream event, so the delegation fails with no diagnosable output — the
 * caller sees a bare "subagent run failed".
 *
 * The delegation cwd is the CALLER's choice (the facade's `cwd` option), and
 * nothing requires it to be a repository: an eval cell directory, a scratch
 * workspace, a freshly created output directory. These assertions pin the
 * flag onto BOTH argv shapes so it cannot be dropped silently.
 */
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it } from 'vitest'
import { CodexCliProvider } from '../src/codex-cli-provider.ts'

/** A stub child that emits a minimal `--json` run and exits 0. */
function stubChild(): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  stdout.push([
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 2, output_tokens: 1 } }),
  ].join('\n') + '\n')
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

describe('codex exec argv: non-git delegation cwd', () => {
  const PARENT = 'parent-1'

  function request(): SubagentStartRequest {
    return {
      label: '委派',
      prompt: [{ type: 'text', text: 'do the task' }],
      parent: { session: { id: SessionId(PARENT), header: { cwd: '/tmp', delegationDepth: 0 } } },
      signal: new AbortController().signal,
      descriptor: { version: 2, mode: 'one-shot', provider: 'codex-local', label: '委派' },
    } as unknown as SubagentStartRequest
  }

  function mount(registry: Record<string, unknown>): { ctx: Context; spawned: string[][] } {
    const ctx = new Context()
    ctx.provide('localAgent', registry as never)
    const spawned: string[][] = []
    ctx.provide('subprocess', {
      spawn: (spec: { argv: string[] }) => {
        spawned.push(spec.argv)
        return stubChild()
      },
    } as never)
    ctx.provide('logger', { warn: () => {}, info: () => {} } as never)
    return { ctx, spawned }
  }

  const baseRegistry = {
    homeDir: () => '/tmp/codex-home',
    get: () => ({ displayName: 'Codex' }),
    takeDelegationIntent: () => undefined,
    recordDelegation: () => {},
    getDelegation: () => undefined,
    recordRoundSettled: () => {},
    reportRunProgress: () => {},
  }

  it('carries --skip-git-repo-check on the fresh argv', async () => {
    const { ctx, spawned } = mount({ ...baseRegistry })
    const provider = new CodexCliProvider(ctx)

    const run = await provider.start(request())
    await run.result

    expect(spawned[0]).toContain('--skip-git-repo-check')
    // Sandboxing is unaffected: the tier still rides its own flag.
    expect(spawned[0]).toContain('--sandbox')
  })

  it('carries --skip-git-repo-check on the resume argv too', async () => {
    const { ctx, spawned } = mount({
      ...baseRegistry,
      takeDelegationIntent: () => ({ kind: 'resume', childSessionId: 'child-run-1', cliSessionId: 'thread-1' }),
      acquireResumeLock: () => true,
      releaseResumeLock: () => {},
    })
    const child = Session.create(SessionId('child-run-1'))
    ctx.provide('sessions', { get: (id: SessionId) => (id === SessionId('child-run-1') ? child : undefined) } as never)
    ctx.provide('sessionPersistence', { create: async () => {}, append: async () => {} } as never)
    const provider = new CodexCliProvider(ctx)

    const run = await provider.start(request())
    await run.result

    expect(spawned[0]).toContain('--skip-git-repo-check')
    // The flag must precede the `resume` subcommand and its positional args,
    // which codex parses positionally.
    const argv = spawned[0] as string[]
    expect(argv.indexOf('--skip-git-repo-check')).toBeLessThan(argv.indexOf('resume'))
  })
})
