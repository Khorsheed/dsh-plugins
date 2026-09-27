import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { replay } from '../src/journal.ts'

function events(rows: [string, unknown][]): SessionEvent[] {
  return rows.map(([type, data], seq) => ({ type, data, seq, time: 1000 + seq })) as SessionEvent[]
}
describe('execution history', () => {
  it('retains earlier rounds and their child after rename/removal; a late settlement cannot replace the live round', () => {
    const state = replay(events([
      ['room/member-added', { id: 'm', name: 'worker', kind: 'cli', provider: 'kimi', invitedBy: 'human' }],
      ['room/run-state', { runId: 'a', member: 'worker', state: 'running', startedAt: 10 }],
      ['room/member-updated', { name: 'worker', childSessionId: 'child' }],
      ['room/member-updated', { name: 'worker', rename: 'renamed' }],
      ['room/run-state', { runId: 'b', member: 'renamed', state: 'running', startedAt: 20 }],
      ['room/run-state', { runId: 'a', member: 'renamed', state: 'done', startedAt: 10, elapsedMs: 5, model: 'observed', tokens: 41 }],
    ]))
    expect(state.runs).toMatchObject([{ runId: 'b', state: 'running' }])
    expect(state.executions).toHaveLength(2)
    expect(state.executions?.[0]).toMatchObject({ id: 'a', memberId: 'm', childSessionId: 'child', model: 'observed', tokens: 41, elapsedMs: 5 })
    const removed = replay(events([
      ['room/member-added', { id: 'm', name: 'worker', kind: 'cli', childSessionId: 'old-child', invitedBy: 'human' }],
      ['room/run-state', { runId: 'a', member: 'worker', state: 'done', startedAt: 10 }],
      ['room/member-removed', { name: 'worker' }],
      ['room/member-added', { id: 'new', name: 'worker', kind: 'cli', childSessionId: 'new-child', invitedBy: 'human' }],
    ]))
    expect(removed.executions?.[0]?.childSessionId).toBe('old-child')
  })

  it('replays legacy runs without inventing observed models or usage', () => {
    const state = replay(events([
      ['room/member-added', { name: 'worker', kind: 'cli', model: 'requested', invitedBy: 'human' }],
      ['room/run-state', { member: 'worker', state: 'running', startedAt: 10 }],
      ['room/run-state', { member: 'worker', state: 'done', startedAt: 10 }],
    ]))
    expect(state.executions).toHaveLength(1)
    expect(state.executions?.[0]?.model).toBeUndefined()
    expect(state.executions?.[0]?.tokens).toBeUndefined()
  })
})
