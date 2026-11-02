/**
 * Behavior lock for the exec mirror: one fixed stream-json transcript → the
 * exact child-session event sequence. The live driver's lock sits beside its
 * fake runtime in live-driver.spec.ts.
 */
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { startClaudeCliRun } from '../src/claude-cli-provider.ts'
import { expectValidReleasedLog } from './expect-valid-log.ts'
import { fakeSessionPersistence } from './fake-persistence.ts'
import { mirrorSnapshot, SNAPSHOT_NOW, until } from './mirror-snapshot.ts'

const at = (ms: number): string => new Date(Date.parse('2026-08-16T00:00:00.000Z') + ms).toISOString()
const usage1 = { input_tokens: 3, output_tokens: 40, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }
const usage2 = { input_tokens: 4, output_tokens: 12, cache_read_input_tokens: 140, cache_creation_input_tokens: 0 }
const usage3 = { input_tokens: 5, output_tokens: 8, cache_read_input_tokens: 150, cache_creation_input_tokens: 0 }

/** Every shape the exec mirror writes: a mixed call, a failed tool, a reply, an unresulted tool at settle. */
const fixture = [
  { type: 'system', subtype: 'init', session_id: 's1', model: 'claude-opus-5-5', timestamp: at(0) },
  { type: 'assistant', timestamp: at(100), message: { id: 'm1', usage: usage1, content: [{ type: 'thinking', thinking: '先列目录' }] } },
  { type: 'assistant', timestamp: at(200), message: { id: 'm1', usage: usage1, content: [{ type: 'text', text: '我看看。' }] } },
  { type: 'assistant', timestamp: at(300), message: { id: 'm1', usage: usage1, content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }] } },
  { type: 'user', timestamp: at(500), message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'a.txt' }] } },
  { type: 'assistant', timestamp: at(700), message: { id: 'm2', usage: usage2, content: [{ type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'false' } }] } },
  { type: 'user', timestamp: at(800), message: { content: [{ type: 'tool_result', tool_use_id: 'tu2', is_error: true, content: 'exit 1' }] } },
  { type: 'assistant', timestamp: at(900), message: { id: 'm3', usage: usage3, content: [{ type: 'text', text: '完成。' }] } },
  { type: 'assistant', timestamp: at(1000), message: { id: 'm4', content: [{ type: 'tool_use', id: 'tu3', name: 'Read', input: { file_path: 'b.txt' } }] } },
  { type: 'result', is_error: false, session_id: 's1', timestamp: at(1100), usage: { input_tokens: 12, output_tokens: 60 } },
].map(event => JSON.stringify(event)).join('\n') + '\n'

function fixtureChild(): SubprocessHandle {
  const stdout = new Readable({ read() {} })
  stdout.push(fixture)
  stdout.push(null)
  const stderr = new Readable({ read() {} })
  stderr.push(null)
  return {
    pid: 4300,
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

describe('claude mirror snapshot (exec)', () => {
  it('one fixed stream-json → the exact child-session event sequence', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: SNAPSHOT_NOW })
    try {
      const child = Session.create(SessionId('child-claude-snapshot'))
      const ctx = new Context()
      ctx.provide('sessionPersistence', fakeSessionPersistence())
      const handle = fixtureChild()
      const request = {
        prompt: [{ type: 'text', text: 'do the task' }],
        parent: { session: { header: { cwd: '/tmp' } } },
        signal: new AbortController().signal,
      } as unknown as SubagentStartRequest
      const run = await startClaudeCliRun(request, {
        cwd: '/tmp',
        env: {},
        permissionMode: 'skip',
        model: 'claude-opus-5',
        effort: 'high',
        controlled: true,
        disposeGraceMs: 3_000,
        spawn: () => handle,
        childSession: child,
        ctx,
      })
      expect((await run.result).stopReason).toBe('completed')
      await until(() => child.snapshotEvents().at(-1)?.type === 'turn/end')
      expectValidReleasedLog(child)
      expect(mirrorSnapshot(child)).toMatchSnapshot()
    } finally {
      vi.useRealTimers()
    }
  })
})
