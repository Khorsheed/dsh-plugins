/**
 * Behavior lock for the exec mirror: one fixed `codex exec --json` stream →
 * the exact child-session event sequence. The live driver's lock sits beside
 * its fake app-server in live-driver.spec.ts.
 */
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { startCodexCliRun } from '../src/codex-cli-provider.ts'
import { expectValidReleasedLog } from './expect-valid-log.ts'
import { fakeSessionPersistence } from './fake-persistence.ts'
import { mirrorSnapshot, snapshotExecution, SNAPSHOT_NOW, until } from './mirror-snapshot.ts'
import { CODEX_UNRECORDED } from '../src/index.ts'

/** Every shape the exec mirror writes: reasoning, a tool, a failed tool, a reply, an unfinished tool at settle. */
const fixture = [
  { type: 'thread.started', thread_id: 't1' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: '先列目录' } },
  { type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: 'ls', status: 'in_progress' } },
  { type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: 'ls', aggregated_output: 'a.txt', exit_code: 0, status: 'completed' } },
  { type: 'item.completed', item: { id: 'item_2', type: 'command_execution', command: 'false', aggregated_output: 'boom', exit_code: 1, status: 'failed' } },
  { type: 'item.completed', item: { id: 'item_3', type: 'agent_message', text: '完成了。' } },
  { type: 'item.completed', item: { id: 'item_4', type: 'command_execution', command: 'sleep 9', status: 'in_progress' } },
  { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 6, output_tokens: 4 } },
].map(event => JSON.stringify(event)).join('\n') + '\n'

function fixtureChild(): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  stdout.push(fixture)
  stdout.push(null)
  const stderr = new Readable({ read() {} })
  stderr.push(null)
  return {
    pid: 4301,
    stdin: undefined,
    stdout,
    stderr,
    collected: {
      stdout: { readFrom: () => ({ text: fixture, nextOffset: 0, lossy: false }) },
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
    },
    done: new Promise<{ exitCode: number; signal: null }>((resolve) => { setImmediate(() => { resolve({ exitCode: 0, signal: null }) }) }),
    terminate: () => undefined,
    waitForExit: async () => true,
  }
}

describe('codex mirror snapshot (exec)', () => {
  it('one fixed exec --json stream → the exact child-session event sequence', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: SNAPSHOT_NOW })
    try {
      const child = Session.create(SessionId('child-codex-snapshot'))
      const execution = snapshotExecution(child, CODEX_UNRECORDED)
      const ctx = new Context()
      ctx.provide('sessionPersistence', fakeSessionPersistence())
      const handle = fixtureChild()
      const request = {
        prompt: [{ type: 'text', text: 'do the task' }],
        parent: { session: { header: { cwd: '/tmp' } } },
        signal: new AbortController().signal,
      } as unknown as SubagentStartRequest
      const run = await startCodexCliRun(request, {
        cwd: '/tmp',
        env: {},
        sandbox: 'workspace-write',
        model: 'gpt-5.4',
        effort: 'high',
        disposeGraceMs: 3_000,
        spawn: () => handle,
        childSession: child,
        ctx,
      })
      const result = await run.result
      expect(result.stopReason).toBe('completed')
      await until(() => child.snapshotEvents().at(-1)?.type === 'turn/end')
      execution.settle(result)
      expectValidReleasedLog(child)
      expect(mirrorSnapshot(child)).toMatchSnapshot()
    } finally {
      vi.useRealTimers()
    }
  })
})
