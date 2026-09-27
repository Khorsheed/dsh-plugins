import { describe, expect, it } from 'vitest'
import { buildJobTrajectory } from '../src/client/job-trajectory.ts'
import { parseTaskPilotCommand, renderTaskPilotCommand } from '../src/types.ts'

function event(type: string, seq: number, time: number, data: unknown) {
  return { type, seq, time, data }
}

describe('parseTaskPilotCommand', () => {
  it('parses both verbs with their payloads', () => {
    expect(parseTaskPilotCommand('/taskpilot-stop bash-1')).toEqual({ kind: 'stop-job', jobId: 'bash-1' })
    expect(parseTaskPilotCommand('/taskpilot-interrupt child-2')).toEqual({ kind: 'interrupt-subagent', childId: 'child-2' })
  })

  it('rejects malformed lines', () => {
    expect(parseTaskPilotCommand('/taskpilot-stop')).toBeUndefined()
    expect(parseTaskPilotCommand('/taskpilot-interrupt')).toBeUndefined()
    expect(parseTaskPilotCommand('/other foo')).toBeUndefined()
  })

  it('round-trips through renderTaskPilotCommand', () => {
    const command = { kind: 'stop-job' as const, jobId: 'bash-3' }
    expect(parseTaskPilotCommand(renderTaskPilotCommand(command))).toEqual(command)
  })
})

describe('buildJobTrajectory', () => {
  const logs = [
    event('tool/call', 1, 1000, {
      callId: 'c1', name: 'bash',
      arguments: JSON.stringify({
        command: 'pnpm build', description: 'Build the workspace', workdir: '/workspace', run_in_background: true,
      }),
    }),
    event('tool/result', 2, 1000, {
      message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'job started: bash-1' }] }] },
    }),
    event('tool/call', 3, 2000, {
      callId: 'c2', name: 'job_output', arguments: JSON.stringify({ job_id: 'bash-1' }),
    }),
    event('tool/result', 4, 2000, {
      message: { content: [{ type: 'tool-result', toolCallId: 'c2', content: [{ type: 'text', text: 'compiling...\n[status: running]' }] }] },
    }),
    event('tool/call', 5, 3000, {
      callId: 'c3', name: 'job_kill', arguments: JSON.stringify({ job_id: 'bash-1' }),
    }),
    event('user/message', 6, 4000, {
      content: [{ type: 'text', text: 'background job bash-1 (bash: pnpm build) finished [status: killed]' }],
      source: { kind: 'plugin', plugin: 'tool-jobs', form: 'notice' },
    }),
  ]

  it('folds the whole lifecycle into chronological entries', () => {
    const entries = buildJobTrajectory(logs, 'bash-1')
    expect(entries.map(entry => entry.kind)).toEqual(['start', 'read', 'kill', 'notice'])
    expect(entries[0]?.title).toContain('bash-1 started')
    expect(entries[1]?.detail).toContain('compiling...')
    expect(entries[3]?.detail).toContain('finished [status: killed]')
  })

  it('shows the issued command in the start row title and detail', () => {
    const entries = buildJobTrajectory(logs, 'bash-1')
    const start = entries[0]
    expect(start?.title).toContain('bash-1 started · pnpm build')
    expect(start?.detail).toContain('$ pnpm build')
    expect(start?.detail).toContain('workdir: /workspace')
    expect(start?.detail).toContain('description: Build the workspace')
    // The ack text is still present under the command block.
    expect(start?.detail).toContain('job started: bash-1')
  })

  it('mints the start row from the call args when the paired ack is missing', () => {
    const ackless = [
      event('tool/call', 1, 1000, {
        callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'sleep 60', run_in_background: true }),
      }),
      event('tool/result', 2, 1000, {
        message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [] }] },
      }),
    ]
    const entries = buildJobTrajectory(ackless, 'bash-1')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.kind).toBe('start')
    expect(entries[0]?.detail).toContain('$ sleep 60')
  })

  it('clips a long command in the title but keeps it whole in the detail', () => {
    const command = 'pnpm build --filter @khorsheed/dsh-taskpilot --reporter append-only --stream'.repeat(2)
    const long = [
      event('tool/call', 1, 1000, {
        callId: 'c1', name: 'bash', arguments: JSON.stringify({ command, run_in_background: true }),
      }),
      event('tool/result', 2, 1000, {
        message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'job started: bash-1' }] }] },
      }),
    ]
    const entries = buildJobTrajectory(long, 'bash-1')
    expect(entries[0]?.title).toContain('…')
    expect(entries[0]?.title.length).toBeLessThan(command.length)
    expect(entries[0]?.detail).toContain(command)
  })

  it('ignores unrelated jobs and unrelated events', () => {
    const entries = buildJobTrajectory(logs, 'bash-99')
    expect(entries).toEqual([])
  })

  it('skips malformed rows without throwing', () => {
    const corrupted = [
      event('tool/call', 1, 1000, { callId: 'x', name: 'bash', arguments: '{broken' }),
      event('tool/result', 2, 1000, null),
      event('user/message', 3, 1000, undefined),
    ]
    expect(buildJobTrajectory(corrupted, 'bash-1')).toEqual([])
  })

  it('treats a missing source on user/message as not a notice', () => {
    const logsNoSource = [
      event('user/message', 1, 1000, {
        content: [{ type: 'text', text: 'background job bash-1 finished' }],
        source: { kind: 'user' },
      }),
    ]
    expect(buildJobTrajectory(logsNoSource, 'bash-1')).toEqual([])
  })
})

// The current host line keys a result by `message.toolCallId` and carries flat
// `message.content[]` text, and names the notice producer at `source.kind`.
// Reading only the older nested shape left a real log's trajectory with nothing
// but the job controls that name the id in their arguments.
describe('buildJobTrajectory on the current wire shape', () => {
  const logs = [
    event('tool/call', 1, 1000, {
      callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'pnpm build', run_in_background: true }),
    }),
    event('tool/result', 2, 1000, {
      message: {
        role: 'tool',
        source: { kind: 'tool', callId: 'c1' },
        toolCallId: 'c1',
        content: [{ type: 'text', text: 'started background job bash-1' }],
      },
    }),
    event('tool/call', 3, 2000, {
      callId: 'c2', name: 'job_output', arguments: JSON.stringify({ job_id: 'bash-1' }),
    }),
    event('tool/result', 4, 2000, {
      message: { toolCallId: 'c2', content: [{ type: 'text', text: 'compiling...' }] },
    }),
    event('tool/call', 5, 3000, {
      callId: 'c3', name: 'job_kill', arguments: JSON.stringify({ job_id: 'bash-1', reason: 'no longer needed' }),
    }),
    event('tool/result', 6, 3000, {
      message: { toolCallId: 'c3', content: [{ type: 'text', text: 'kill requested' }] },
    }),
    event('user/message', 7, 4000, {
      content: [{ type: 'text', text: 'background job bash-1 (bash: pnpm build) finished [status: completed, exit code: 0]. Read its output with job_output.' }],
      source: { kind: 'tool-jobs', form: 'notice', summary: 'bash pnpm build [status: completed]' },
    }),
  ]

  it('pairs results by message.toolCallId and reads flat content text', () => {
    const entries = buildJobTrajectory(logs, 'bash-1')
    expect(entries.map(entry => entry.kind)).toEqual(['start', 'read', 'kill', 'notice'])
    expect(entries[0]?.title).toContain('bash-1 started · pnpm build')
    expect(entries[0]?.detail).toContain('$ pnpm build')
    expect(entries[0]?.detail).toContain('started background job bash-1')
    expect(entries[1]?.detail).toBe('compiling...')
    expect(entries[2]?.detail).toBe('kill requested')
    expect(entries[3]?.detail).toContain('exit code: 0')
  })

  it('pairs through the mirrored source.callId when the message field is absent', () => {
    const viaSource = [
      event('tool/call', 1, 1000, {
        callId: 'c9', name: 'bash', arguments: JSON.stringify({ command: 'sleep 60', run_in_background: true }),
      }),
      event('tool/result', 2, 1000, {
        message: { source: { kind: 'tool', callId: 'c9' }, content: [{ type: 'text', text: 'started background job bash-2' }] },
      }),
    ]
    const entries = buildJobTrajectory(viaSource, 'bash-2')
    expect(entries.map(entry => entry.kind)).toEqual(['start'])
    expect(entries[0]?.detail).toContain('$ sleep 60')
  })

  it('mints the start row for a foreground call its timeout promoted', () => {
    const promoted = [
      event('tool/call', 1, 1000, {
        callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'sleep 600' }),
      }),
      event('tool/result', 2, 1000, {
        message: { toolCallId: 'c1', content: [{ type: 'text', text: 'moved to background job bash-3\ntimeout after 5000ms' }] },
      }),
    ]
    const entries = buildJobTrajectory(promoted, 'bash-3')
    expect(entries.map(entry => entry.kind)).toEqual(['start'])
    expect(entries[0]?.detail).toContain('$ sleep 600')
  })

  it('keeps only the trail of the job registered at the given time', () => {
    const reused = [
      event('tool/call', 1, 1_000, {
        callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'old job', run_in_background: true }),
      }),
      event('tool/result', 2, 1_000, {
        message: { toolCallId: 'c1', content: [{ type: 'text', text: 'started background job bash-1' }] },
      }),
      event('tool/call', 3, 60_000, {
        callId: 'c2', name: 'bash', arguments: JSON.stringify({ command: 'new job', run_in_background: true }),
      }),
      event('tool/result', 4, 60_000, {
        message: { toolCallId: 'c2', content: [{ type: 'text', text: 'started background job bash-1' }] },
      }),
    ]
    expect(buildJobTrajectory(reused, 'bash-1')).toHaveLength(2)
    const latest = buildJobTrajectory(reused, 'bash-1', 60_000)
    expect(latest).toHaveLength(1)
    expect(latest[0]?.detail).toContain('$ new job')
  })

  it('mints nothing for a plain foreground call or another producer notice', () => {
    const foreground = [
      event('tool/call', 1, 1000, {
        callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'ls -la' }),
      }),
      event('tool/result', 2, 1000, {
        message: { toolCallId: 'c1', content: [{ type: 'text', text: 'total 8' }] },
      }),
      event('user/message', 3, 2000, {
        content: [{ type: 'text', text: 'background job bash-9 finished' }],
        source: { kind: 'plugin', plugin: 'other', form: 'notice' },
      }),
    ]
    expect(buildJobTrajectory(foreground, 'bash-1')).toEqual([])
    expect(buildJobTrajectory(foreground, 'bash-9')).toEqual([])
  })
})
