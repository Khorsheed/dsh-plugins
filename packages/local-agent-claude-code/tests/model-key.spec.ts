/**
 * The claude-code `model` key on the exec argv: unset, all four argv variants
 * are byte-identical to the shapes that shipped before the key existed; set,
 * `--model <model>` rides each of them, ahead of the member flags whose `--`
 * terminator closes the flag section.
 */
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { startClaudeCliRun } from '../src/claude-cli-provider.ts'

const streamJson = [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '好了' }] } }),
  JSON.stringify({ type: 'result', is_error: false, session_id: 's1', usage: { input_tokens: 2, output_tokens: 1 } }),
].join('\n')

/** A child that emits one completed run and exits 0. */
function stubChild(): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  stdout.push(streamJson + '\n')
  stdout.push(null)
  const stderr = new Readable({ read() {} })
  stderr.push(null)
  return {
    pid: 4242,
    stdin: undefined,
    stdout,
    stderr,
    collected: {
      stdout: { readFrom: () => ({ text: streamJson + '\n', nextOffset: 0, lossy: false }) },
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
async function argvOf(over: Partial<Parameters<typeof startClaudeCliRun>[1]>): Promise<readonly string[]> {
  const spawned: SubprocessSpawnSpec[] = []
  const run = await startClaudeCliRun(request, {
    cwd: '/tmp',
    env: {},
    permissionMode: 'skip',
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

describe('claude-code model key on the exec argv', () => {
  it('unset: the fresh argv is exactly the pre-key shape (skip mode)', async () => {
    await expect(argvOf({})).resolves.toEqual(
      ['claude', '-p', '--dangerously-skip-permissions', '--verbose', '--output-format', 'stream-json', '建个文件'],
    )
  })

  it('unset: the fresh argv is exactly the pre-key shape (normal mode)', async () => {
    await expect(argvOf({ permissionMode: 'normal' })).resolves.toEqual(
      ['claude', '-p', '--verbose', '--output-format', 'stream-json', '建个文件'],
    )
  })

  it('unset: the resume argv is exactly the pre-key shape', async () => {
    await expect(argvOf({ resume: { cliSessionId: 's1', turn: 2 } })).resolves.toEqual(
      ['claude', '-p', '--dangerously-skip-permissions', '--verbose', '--resume', 's1', '--output-format', 'stream-json', '建个文件'],
    )
  })

  it('set: the fresh argv carries --model', async () => {
    await expect(argvOf({ model: 'claude-opus-5' })).resolves.toEqual(
      ['claude', '-p', '--dangerously-skip-permissions', '--verbose', '--model', 'claude-opus-5', '--output-format', 'stream-json', '建个文件'],
    )
  })

  it('set: normal permission mode carries it too', async () => {
    await expect(argvOf({ model: 'claude-opus-5', permissionMode: 'normal' })).resolves.toEqual(
      ['claude', '-p', '--verbose', '--model', 'claude-opus-5', '--output-format', 'stream-json', '建个文件'],
    )
  })

  it('set: a resume round runs the same model', async () => {
    await expect(argvOf({ model: 'claude-opus-5', resume: { cliSessionId: 's1', turn: 2 } })).resolves.toEqual(
      ['claude', '-p', '--dangerously-skip-permissions', '--verbose', '--model', 'claude-opus-5', '--resume', 's1', '--output-format', 'stream-json', '建个文件'],
    )
  })

  it('set: the model precedes the member flags — the variadic --allowedTools must stay last', async () => {
    const argv = await argvOf({
      model: 'claude-opus-5',
      member: { mcpConfig: '{}', allowedTool: 'mcp__member__member_message' },
    })
    expect(argv).toEqual([
      'claude', '-p', '--dangerously-skip-permissions', '--verbose',
      '--model', 'claude-opus-5',
      '--output-format', 'stream-json',
      '--mcp-config', '{}', '--allowedTools', 'mcp__member__member_message', '--',
      '建个文件',
    ])
    expect(argv.indexOf('--model')).toBeLessThan(argv.indexOf('--allowedTools'))
  })
})
