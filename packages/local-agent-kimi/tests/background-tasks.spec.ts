/**
 * A Kimi member's background tasks, read from Kimi's own task state
 * (member-self-started-rounds M1). Every fixture is synthetic: task files
 * and wire lines are written here in the shapes Kimi 2.4.1 uses, with
 * placeholder content — nothing is copied from a real session.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { executionOfToolCall, selfExecutionOfTask } from '@khorsheed/dsh-local-agent'
import { KIMI_TASK_RECENT_MS, kimiTasksDir, readKimiBackgroundTasks } from '../src/background-tasks.ts'

const NOW = 1_800_000_000_000
const MIN = 60_000

function session(tasks: Record<string, unknown>[], wire: unknown[] = [], extra: Record<string, string> = {}): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'kimi-bg-')), 'session_test')
  mkdirSync(kimiTasksDir(dir), { recursive: true })
  for (const task of tasks) writeFileSync(join(kimiTasksDir(dir), `${String(task['taskId'])}.json`), JSON.stringify(task))
  // Each task also has an output directory next to its state file; it is not a task.
  mkdirSync(join(kimiTasksDir(dir), 'bash-dir-only'))
  for (const [name, content] of Object.entries(extra)) writeFileSync(join(kimiTasksDir(dir), name), content)
  writeFileSync(join(dir, 'agents', 'main', 'wire.jsonl'), wire.map(line => JSON.stringify(line)).join('\n') + '\n')
  return dir
}

const shell = (taskId: string, fields: Record<string, unknown>) => ({
  taskId, description: `placeholder ${taskId}`, status: 'running', detached: true, startedAt: NOW - 10 * MIN, endedAt: null,
  kind: 'process', command: 'sleep 20', pid: 4242, exitCode: null, parentToolCallId: `call-${taskId}`, ...fields,
})

describe('readKimiBackgroundTasks', () => {
  it('maps Kimi states and kinds; lists running, lost and recently ended tasks only, oldest first', async () => {
    const dir = session([
      shell('bash-run', { startedAt: NOW - 5 * MIN }),
      shell('bash-done', { status: 'completed', endedAt: NOW - 20 * MIN, exitCode: 0, startedAt: NOW - 30 * MIN }),
      shell('bash-fail', { status: 'failed', endedAt: NOW - MIN, exitCode: 2, startedAt: NOW - 2 * MIN }),
      shell('bash-slow', { status: 'timed_out', endedAt: NOW - MIN, exitCode: -1, startedAt: NOW - 3 * MIN }),
      shell('bash-kill', { status: 'killed', endedAt: NOW - MIN, startedAt: NOW - 4 * MIN }),
      shell('bash-lost', { status: 'lost', startedAt: NOW - 20 * 60 * MIN }),
      shell('bash-old', { status: 'completed', endedAt: NOW - KIMI_TASK_RECENT_MS - 1, exitCode: 0, startedAt: NOW - 3 * 60 * MIN }),
      { taskId: 'agent-bg', description: 'explore placeholder', status: 'running', detached: true, startedAt: NOW - 6 * MIN, endedAt: null,
        kind: 'agent', agentId: 'agent-7', subagentType: 'explore', parentToolCallId: 'call-agent-bg' },
      // Not background work: an ask-user record, a foreground task, an unknown status.
      { taskId: 'question-1', kind: 'question', status: 'completed', detached: true, startedAt: NOW - MIN, endedAt: NOW - MIN, toolCallId: 'call-q' },
      shell('bash-fg', { detached: false }),
      shell('bash-odd', { status: 'paused' }),
    ], [], { 'broken.json': '{"taskId": "half-writ' })
    const tasks = await readKimiBackgroundTasks(dir, { now: NOW })
    expect(tasks.map(task => [task.id, task.state])).toEqual([
      ['bash-lost', 'lost'],
      ['bash-done', 'completed'],
      ['agent-bg', 'running'],
      ['bash-run', 'running'],
      ['bash-kill', 'stopped'],
      ['bash-slow', 'timed-out'],
      ['bash-fail', 'failed'],
    ])
    expect(tasks.find(task => task.id === 'bash-fail')).toEqual({
      id: 'bash-fail', label: 'placeholder bash-fail', command: 'sleep 20', kind: 'shell',
      startedAt: NOW - 2 * MIN, endedAt: NOW - MIN, state: 'failed', exitCode: 2,
    })
    // A running task carries no end, exit code or result; an agent task no command.
    expect(tasks.find(task => task.id === 'bash-run')).toEqual({ id: 'bash-run', label: 'placeholder bash-run', command: 'sleep 20', kind: 'shell', startedAt: NOW - 5 * MIN, state: 'running' })
    expect(tasks.find(task => task.id === 'agent-bg')).toEqual({ id: 'agent-bg', label: 'explore placeholder', kind: 'agent', startedAt: NOW - 6 * MIN, state: 'running' })
    // Kimi's own `lost` is reported as is; no reason of ours is invented.
    expect(tasks.find(task => task.id === 'bash-lost')).not.toHaveProperty('lostBecause')
  })

  it('labels a task without a description by its command (60 characters)', async () => {
    const long = `pnpm deploy:3080 --package packages/${'x'.repeat(80)}`
    const dir = session([shell('bash-1', { description: '  ', command: long })])
    expect((await readKimiBackgroundTasks(dir, { now: NOW }))[0]).toMatchObject({ label: long.slice(0, 60), command: long })
  })

  it('a session without a tasks directory has no tasks', async () => {
    expect(await readKimiBackgroundTasks(join(mkdtempSync(join(tmpdir(), 'kimi-bg-none-')), 'session_x'), { now: NOW })).toEqual([])
  })

  it('startedBy follows the facts: task → tool call (state file, else the wire\'s task.started) → mirrored turn → execution', async () => {
    const dir = session([
      shell('bash-a', {}),
      // An older state file without the call id: the wire's task.started names it.
      shell('bash-b', { parentToolCallId: undefined }),
      // No call id anywhere: not recorded.
      shell('bash-c', { parentToolCallId: undefined }),
      // A call id the member log never mirrored: not recorded.
      shell('bash-d', { parentToolCallId: 'call-never-mirrored' }),
      shell('bash-e', { status: 'completed', endedAt: NOW - MIN, exitCode: 0 }),
    ], [
      { type: 'turn.prompt', input: [{ type: 'text', text: 'placeholder' }], origin: { kind: 'user' }, turnId: 1 },
      { type: 'task.started', info: { taskId: 'bash-b', status: 'running', kind: 'process', parentToolCallId: 'call-bash-b' } },
      { type: 'task.started', info: { taskId: 'bash-c', status: 'running', kind: 'process' } },
      { type: 'turn.ended', turnId: 1 },
    ])
    let seq = 0
    const ev = (type: string, data: unknown): SessionEvent => ({ type, data, seq: seq++, time: 0 }) as never
    const toolCall = (turn: number, id: string) => ev('assistant/message', { turn, step: 1, message: { role: 'assistant', content: [{ type: 'tool-call', id, name: 'Bash', arguments: '{}' }] }, stream: [] })
    const memberLog: SessionEvent[] = [
      ev('local-agent/execution', { phase: 'start', executionId: 'room-run-1', caller: 'room', operation: 'prompt', parentSessionId: 'room-1', admittedAt: 1 }),
      ev('turn/start', { turn: 1 }), toolCall(1, 'call-bash-a'), toolCall(1, 'call-bash-b'),
      ev('local-agent/execution', { phase: 'end', executionId: 'room-run-1', outcome: 'done', turns: [1], endedAt: 2 }),
      ev('local-agent/execution', { phase: 'start', executionId: 'room-run-2', caller: 'room', operation: 'prompt', parentSessionId: 'room-1', admittedAt: 3 }),
      ev('turn/start', { turn: 2 }), toolCall(2, 'call-bash-e'),
      ev('local-agent/execution', { phase: 'end', executionId: 'room-run-2', outcome: 'done', turns: [2], endedAt: 4 }),
      ev('local-agent/execution', { phase: 'start', executionId: 'self-1', caller: 'cli', operation: 'prompt', parentSessionId: 'room-1', admittedAt: 5,
        cause: { kind: 'self', reason: 'background-task', taskId: 'bash-e', taskStatus: 'completed', notificationId: 'task:bash-e:completed', startedBy: 'room-run-2' } }),
    ]
    const tasks = await readKimiBackgroundTasks(dir, {
      now: NOW,
      executionOfCall: async callId => executionOfToolCall(memberLog, callId),
      selfExecutionOf: async taskId => selfExecutionOfTask(memberLog, taskId),
    })
    const byId = new Map(tasks.map(task => [task.id, task]))
    expect(byId.get('bash-a')?.startedBy).toBe('room-run-1')
    expect(byId.get('bash-b')?.startedBy).toBe('room-run-1')
    expect(byId.get('bash-c')).not.toHaveProperty('startedBy')
    expect(byId.get('bash-d')).not.toHaveProperty('startedBy')
    expect(byId.get('bash-e')).toMatchObject({ startedBy: 'room-run-2', resultIn: 'self-1' })
    // A running task has no result yet, whatever the log says.
    expect(byId.get('bash-a')).not.toHaveProperty('resultIn')
  })
})
