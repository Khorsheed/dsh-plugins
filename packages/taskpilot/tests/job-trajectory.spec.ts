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
