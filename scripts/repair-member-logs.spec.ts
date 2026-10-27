/** The member-log repair rules, on the incident shapes they were written for. */
import { describe, expect, it } from 'vitest'
import { repairMemberLog } from './repair-member-logs.mts'

type Row = Parameters<typeof repairMemberLog>[0][number]
let seq = 0
const row = (type: string, data: Record<string, unknown> = {}, extra: Partial<Row> = {}): Row => ({ type, seq: seq++, time: seq, data, ...extra })
const steps = (rows: readonly Row[]) => rows.filter(r => r.type === 'step/start').map(r => [(r.data as { turn: number }).turn, (r.data as { step: number }).step])

describe('repairMemberLog', () => {
  it('closes a turn a restart left open, before the end-seed marker', () => {
    seq = 0
    const { rows } = repairMemberLog([
      row('turn/start', { turn: 1 }), row('step/start', { turn: 1, step: 1 }), row('step/end', { turn: 1, step: 1 }),
      row('session/end-seed'), row('turn/start', { turn: 2 }), row('turn/end', { turn: 2, reason: { kind: 'completed' } }),
    ])
    expect(rows.map(r => r.type)).toEqual(['turn/start', 'step/start', 'step/end', 'turn/end', 'session/end-seed', 'turn/start', 'turn/end'])
    expect(rows.map(r => r.seq)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('drops a closed turn\'s late events and moves never-opened-turn content into the open turn', () => {
    seq = 0
    const { rows } = repairMemberLog([
      row('turn/start', { turn: 1 }), row('turn/end', { turn: 1, reason: { kind: 'completed' } }),
      row('step/start', { turn: 1, step: 2 }), row('step/end', { turn: 1, step: 2 }),
      row('turn/start', { turn: 2 }), row('step/start', { turn: 3, step: 1 }), row('step/end', { turn: 3, step: 1 }),
      row('turn/end', { turn: 2, reason: { kind: 'completed' } }),
    ])
    expect(steps(rows)).toEqual([[2, 1]])
  })

  it('drops kimi orphan duplicates and plan-only steps, renumbers by position, repoints results', () => {
    seq = 0
    const message = (blocks: unknown[]) => ({ message: { content: blocks } })
    const input = [
      row('turn/start', { turn: 1 }),
      row('step/start', { turn: 1, step: 1 }),
      row('assistant/message', { turn: 1, step: 1, ...message([{ type: 'tool-call', id: 'x' }]) }),
      row('tool/call', { turn: 1, step: 1, callId: 'x' }),
      row('tool/result', { turn: 1, step: 1, message: { toolCallId: 'x' } }, { sourceEventSeqs: [99] }),
      row('step/end', { turn: 1, step: 1 }),
      row('step/start', { turn: 1, step: 5 }),
      row('assistant/message', { turn: 1, step: 5, ...message([{ type: 'text', text: 'answer' }]) }),
      row('step/end', { turn: 1, step: 5 }),
      row('step/start', { turn: 1, step: 6 }),
      row('assistant/message', { turn: 1, step: 6, ...message([{ type: 'tool-call', id: '1:x' }]) }),
      row('step/end', { turn: 1, step: 6 }),
      row('step/start', { turn: 1, step: 7 }),
      row('assistant/message', { turn: 1, step: 7, ...message([{ type: 'reasoning', text: '☑ 第一步\n▶ 第二步' }]) }),
      row('step/end', { turn: 1, step: 7 }),
      row('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    const { rows, changes } = repairMemberLog(input)
    expect(steps(rows)).toEqual([[1, 1], [1, 2]])
    expect(rows.find(r => r.type === 'tool/result')!.sourceEventSeqs).toEqual([3])
    expect(changes.join(';')).toContain('dropped 2 orphan duplicate or plan-only steps')
  })
})
