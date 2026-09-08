/**
 * The codex `model` key on the exec argv: unset, every argv is byte-identical
 * to the shape that shipped before the key existed; set, `-m <model>` rides
 * both the fresh and the resume argv, in the one position `codex exec` accepts
 * it (before the `resume` subcommand).
 */
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { startCodexCliRun } from '../src/codex-cli-provider.ts'

/** A child that emits one completed run and exits 0. */
function stubChild(): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  stdout.push([
    { type: 'thread.started', thread_id: 't1' },
    { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: '好了' } },
    { type: 'turn.completed', usage: { input_tokens: 2, cached_input_tokens: 0, output_tokens: 1 } },
  ].map(event => JSON.stringify(event)).join('\n') + '\n')
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

const request = {
  prompt: [{ type: 'text', text: '建个文件' }],
  parent: { session: { header: { cwd: '/tmp' } } },
  signal: new AbortController().signal,
} as unknown as SubagentStartRequest

/** Run one round and return the argv it spawned. */
async function argvOf(over: Partial<Parameters<typeof startCodexCliRun>[1]>): Promise<readonly string[]> {
  const spawned: SubprocessSpawnSpec[] = []
  const run = await startCodexCliRun(request, {
    cwd: '/tmp',
    env: { CODEX_HOME: '/tmp/codex-home' },
    sandbox: 'workspace-write',
    disposeGraceMs: 3_000,
    spawn: (spec) => {
      spawned.push(spec)
      return stubChild()
    },
    ...over,
  })
  await run.result
  return spawned[0]!.argv
}

describe('codex model key on the exec argv', () => {
  it('unset: the fresh argv is exactly the pre-key shape', async () => {
    await expect(argvOf({})).resolves.toEqual(
      ['codex', 'exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--json', '建个文件'],
    )
  })

  it('unset: the resume argv is exactly the pre-key shape', async () => {
    await expect(argvOf({ resume: { cliSessionId: 't1', turn: 2 } })).resolves.toEqual(
      ['codex', 'exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--json', 'resume', 't1', '建个文件'],
    )
  })

  it('set: the fresh argv carries -m before the sandbox flag', async () => {
    await expect(argvOf({ model: 'gpt-5.2' })).resolves.toEqual(
      ['codex', 'exec', '-m', 'gpt-5.2', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--json', '建个文件'],
    )
  })

  it('set: a resume round runs the same model — -m precedes the resume subcommand', async () => {
    // `codex exec resume` declares no -m of its own; the option belongs to
    // `codex exec`, so it has to lead the subcommand or clap rejects it.
    const argv = await argvOf({ model: 'gpt-5.2', resume: { cliSessionId: 't1', turn: 2 } })
    expect(argv).toEqual(
      ['codex', 'exec', '-m', 'gpt-5.2', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--json', 'resume', 't1', '建个文件'],
    )
    expect(argv.indexOf('-m')).toBeLessThan(argv.indexOf('resume'))
  })

  it('set: the member bridge override still leads, so the model never splits the -c pair', async () => {
    await expect(argvOf({ model: 'gpt-5.2', member: { configOverride: 'mcp_servers.member.command="node"' } })).resolves.toEqual([
      'codex', 'exec',
      '-c', 'mcp_servers.member.command="node"',
      '-m', 'gpt-5.2',
      '--sandbox', 'workspace-write', '--skip-git-repo-check', '--json', '建个文件',
    ])
  })
})
