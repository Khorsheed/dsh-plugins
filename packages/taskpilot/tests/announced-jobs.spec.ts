import { describe, expect, it, vi } from 'vitest'
import type { JobView } from '@deepseek-ai/dsh-jobs/view'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import {
  collectAnnouncedBashWindow,
  createAnnouncedBashLoader,
  unannouncedBashIds,
  visibleJobs,
} from '../src/client/announced-jobs.ts'
import type { SessionLogRow } from '../src/client/job-trajectory.ts'

const SESSION = 's1' as unknown as SessionId

function row(type: string, seq: number, time: number, data: unknown): SessionLogRow {
  return { type, seq, time, data }
}

/** The current host wire shape: the call id rides the message. */
function call(callId: string, args: Record<string, unknown>, time: number, seq = 1): SessionLogRow {
  return row('tool/call', seq, time, { turn: 1, step: 1, callId, name: 'bash', arguments: JSON.stringify(args) })
}

function result(callId: string, text: string, time: number, seq = 2): SessionLogRow {
  return row('tool/result', seq, time, {
    turn: 1,
    step: 1,
    message: {
      role: 'tool',
      source: { kind: 'tool', callId },
      toolCallId: callId,
      content: [{ type: 'text', text }],
      isError: false,
    },
  })
}

function job(overrides: Partial<JobView> = {}): JobView {
  return {
    id: 'bash-1' as JobView['id'],
    kind: 'bash',
    label: 'pnpm build',
    status: 'running',
    startedAt: 1_000,
    output: { total: 0, earliest: 0 },
    ...overrides,
  }
}

describe('collectAnnouncedBashWindow', () => {
  it('credits the ack of a registered background call', () => {
    const window = collectAnnouncedBashWindow([
      call('c1', { command: 'sleep 1', run_in_background: true }, 1_000),
      result('c1', 'started background job bash-65', 1_010),
    ])
    expect([...window.ids]).toEqual(['bash-65'])
    expect(window.since).toBe(1_000)
    expect(window.ambiguousSince).toBeUndefined()
  })

  it('reads the legacy page shape, where the call id and text nest one level deeper', () => {
    const window = collectAnnouncedBashWindow([
      row('tool/call', 1, 1_000, { callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'sleep 1', run_in_background: true }) }),
      row('tool/result', 2, 1_010, {
        message: {
          content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'started background job bash-2' }] }],
        },
      }),
    ])
    expect([...window.ids]).toEqual(['bash-2'])
  })

  it('credits a promotion ack even when no call row paired with it', () => {
    const window = collectAnnouncedBashWindow([
      row('tool/call', 1, 1_000, { callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'sleep 60' }) }),
      result('c1', 'partial output\n[still running after 20000ms; moved to background job bash-7]\nThe command keeps running', 1_020),
    ])
    expect([...window.ids]).toEqual(['bash-7'])
    expect(window.ambiguousSince).toBeUndefined()
  })

  it('ignores a background ack whose printer was not a registered background call', () => {
    // A foreground command that merely printed the sentence (a grep over a
    // session log, say) must not whitelist a job.
    const window = collectAnnouncedBashWindow([
      row('tool/call', 1, 1_000, { callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'grep bash /log' }) }),
      result('c1', 'started background job bash-99', 1_010),
    ])
    expect([...window.ids]).toEqual([])
    // The foreground call itself is not ambiguous: only background calls wait for an ack.
    expect(window.ambiguousSince).toBeUndefined()
  })

  it('marks a background call whose ack never arrived as ambiguous from its own time', () => {
    const window = collectAnnouncedBashWindow([
      call('c1', { command: 'sleep 1', run_in_background: true }, 1_000),
      call('c2', { command: 'sleep 1', run_in_background: true }, 1_500),
      result('c2', 'started background job bash-2', 1_510),
    ])
    expect([...window.ids]).toEqual(['bash-2'])
    expect(window.ambiguousSince).toBe(1_000)
  })

  it('marks an unreadable ack as ambiguous rather than assuming foreground', () => {
    const window = collectAnnouncedBashWindow([
      call('c1', { command: 'sleep 1', run_in_background: true }, 1_000),
      result('c1', '', 1_010),
    ])
    expect([...window.ids]).toEqual([])
    expect(window.ambiguousSince).toBe(1_000)
  })

  it('covers no time (and so judges nothing) when the page is empty', () => {
    const window = collectAnnouncedBashWindow([])
    expect(window.ids.size).toBe(0)
    expect(window.since).toBe(Number.POSITIVE_INFINITY)
  })

  it('skips malformed rows without throwing', () => {
    const window = collectAnnouncedBashWindow([
      row('tool/call', 1, 1_000, { callId: 'x', name: 'bash', arguments: '{broken' }),
      row('tool/result', 2, 1_000, null),
      row('tool/result', 3, 1_000, { message: { content: 'not-an-array' } }),
    ])
    expect(window.ids.size).toBe(0)
    expect(window.since).toBe(1_000)
  })
})

describe('visibleJobs', () => {
  it('hides a judged bash row the log never announced', () => {
    const window = { ids: new Set<string>(), since: 0 }
    expect(visibleJobs([job()], window)).toEqual([])
  })

  it('keeps the announced background row', () => {
    const window = { ids: new Set(['bash-1']), since: 0 }
    expect(visibleJobs([job()], window)).toHaveLength(1)
  })

  it('never hides a non-bash kind', () => {
    const window = { ids: new Set<string>(), since: 0 }
    const subagent = job({ id: 'subagent-1' as JobView['id'], kind: 'subagent' })
    expect(visibleJobs([subagent], window)).toEqual([subagent])
  })

  it('keeps a row registered before the page begins', () => {
    const window = { ids: new Set<string>(), since: 5_000 }
    expect(visibleJobs([job({ startedAt: 1_000 })], window)).toHaveLength(1)
  })

  it('keeps every row while the log is unreadable', () => {
    const settled = job({ status: 'completed', finishedAt: 2_000 })
    expect(visibleJobs([job(), settled], undefined)).toEqual([job(), settled])
  })

  it('keeps a row an unresolved background call could own', () => {
    const window = { ids: new Set<string>(), since: 0, ambiguousSince: 900 }
    expect(visibleJobs([job({ startedAt: 1_000 })], window)).toHaveLength(1)
    // Older than the ambiguity: still judged, still hidden.
    expect(visibleJobs([job({ startedAt: 800 })], window)).toEqual([])
  })
})

describe('unannouncedBashIds', () => {
  it('lists a judged row awaiting its ack', () => {
    expect(unannouncedBashIds([job({ startedAt: 1_000 })], { ids: new Set<string>(), since: 0 })).toEqual(['bash-1'])
  })

  it('drops the row once announced, or when the page does not judge it', () => {
    expect(unannouncedBashIds([job()], { ids: new Set(['bash-1']), since: 0 })).toEqual([])
    expect(unannouncedBashIds([job({ startedAt: 1_000 })], { ids: new Set<string>(), since: 5_000 })).toEqual([])
    expect(unannouncedBashIds([job({ startedAt: 1_000 })], { ids: new Set<string>(), since: 0, ambiguousSince: 900 })).toEqual([])
  })

  it('still lists a settled row, whose record only a background job keeps', () => {
    const settled = job({ status: 'completed', finishedAt: 2_000 })
    expect(unannouncedBashIds([settled], { ids: new Set<string>(), since: 0 })).toEqual(['bash-1'])
  })

  it('lists nothing while the log is unreadable', () => {
    expect(unannouncedBashIds([job()], undefined)).toEqual([])
  })
})

describe('createAnnouncedBashLoader', () => {
  it('folds the page it reads', async () => {
    const loadHistory = vi.fn(async () => ({
      events: [
        call('c1', { run_in_background: true }, 1_000),
        result('c1', 'started background job bash-4', 1_010),
      ],
      hasMore: false,
    }))
    const load = createAnnouncedBashLoader(loadHistory)
    const window = await load(SESSION)
    expect([...(window?.ids ?? [])]).toEqual(['bash-4'])
    expect(loadHistory).toHaveBeenCalledWith(SESSION, undefined, 200)
  })

  it('resolves undefined when the history face is absent', async () => {
    const load = createAnnouncedBashLoader(async () => undefined)
    await expect(load(SESSION)).resolves.toBeUndefined()
  })

  it('resolves undefined when the read rejects, so the filter stays open', async () => {
    const load = createAnnouncedBashLoader(async () => { throw new Error('offline') })
    await expect(load(SESSION)).resolves.toBeUndefined()
  })
})
