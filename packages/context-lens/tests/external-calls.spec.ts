/**
 * An external agent's log (claude-local, codex-local, kimi-cli, dsh-cli) is
 * a mirror written after each call: its steps open when a call is already
 * over, and one call may span several steps with the call's usage on the
 * last. A request starts when the log's previous event happened, and the
 * usage-less steps of a call join the step that carries its usage.
 */
import { describe, expect, it } from 'vitest'
import { reconstructSession, type SessionLogRow } from '../src/log-lane.ts'

const descriptor = (provider: string): SessionLogRow => ({ type: 'subagent/descriptor', seq: 0, time: 1, data: { version: 3, mode: 'one-shot', provider, label: 'x' } })
const call = (id: string, name: string) => ({ type: 'tool-call', id, name, arguments: '' })

function log(provider: string): SessionLogRow[] {
  return [
    descriptor(provider),
    { type: 'turn/start', seq: 2, time: 1000, data: { turn: 1 } },
    { type: 'user/message', seq: 3, time: 1000, surfaceOp: 'append', data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } } },
    // Call A, mirrored at 8000 as two steps: Skill (no usage), ToolSearch (A's usage).
    { type: 'step/start', seq: 4, time: 8000, data: { turn: 1, step: 1 } },
    { type: 'assistant/message', seq: 5, time: 8000, surfaceOp: 'append', data: { turn: 1, step: 1, message: { id: 'm1', role: 'assistant', content: [call('t1', 'Skill')] } } },
    { type: 'tool/call', seq: 6, time: 8000, data: { turn: 1, step: 1, callId: 't1', name: 'Skill', arguments: '' } },
    { type: 'tool/result', seq: 7, time: 8001, surfaceOp: 'append', data: { turn: 1, step: 1, message: { id: 'r1', role: 'tool', toolCallId: 't1', content: [{ type: 'text', text: 'ok' }] } } },
    { type: 'step/end', seq: 8, time: 8001, data: { turn: 1, step: 1 } },
    { type: 'step/start', seq: 9, time: 8002, data: { turn: 1, step: 2 } },
    { type: 'assistant/message', seq: 10, time: 8002, surfaceOp: 'append', data: { turn: 1, step: 2, message: { id: 'm2', role: 'assistant', content: [call('t2', 'ToolSearch')] }, usage: { inputTokens: 2, outputTokens: 242, cacheReadTokens: 0, cacheWriteTokens: 22711 } } },
    { type: 'tool/call', seq: 11, time: 8002, data: { turn: 1, step: 2, callId: 't2', name: 'ToolSearch', arguments: '' } },
    { type: 'tool/result', seq: 12, time: 9000, surfaceOp: 'append', data: { turn: 1, step: 2, message: { id: 'r2', role: 'tool', toolCallId: 't2', content: [{ type: 'text', text: 'x' }] } } },
    { type: 'step/end', seq: 13, time: 9000, data: { turn: 1, step: 2 } },
    // Call B, mirrored at 12000.
    { type: 'step/start', seq: 14, time: 12000, data: { turn: 1, step: 3 } },
    { type: 'assistant/message', seq: 15, time: 12000, surfaceOp: 'append', data: { turn: 1, step: 3, message: { id: 'm3', role: 'assistant', content: [{ type: 'text', text: 'done' }] }, usage: { inputTokens: 4, outputTokens: 109, cacheReadTokens: 22711 } } },
    { type: 'step/end', seq: 16, time: 12000, data: { turn: 1, step: 3 } },
    { type: 'turn/end', seq: 17, time: 12001, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

describe('external agent calls', () => {
  it('times each call from the previous event and joins a call\'s steps into one request', () => {
    const [turn] = reconstructSession(log('claude-local'))
    const requests = turn!.requests
    expect(requests.map(r => [r.requestNumber, r.startedAt, r.settledAt, r.usage?.outputTokens])).toEqual([
      [1, 1000, 8002, 242],
      [2, 9000, 12000, 109],
    ])
    expect(requests[0]!.responseSummary).toMatchObject({ kind: 'tool', name: 'Skill', more: 1 })
    expect(requests[0]!.response?.toolCalls.map(c => c.name)).toEqual(['Skill', 'ToolSearch'])
    expect(requests[0]!.execs.map(e => e.name)).toEqual(['Skill', 'ToolSearch'])
  })

  it('uses native stream blocks instead of folding model time into other', () => {
    const rows = log('kimi-cli')
    const assistant = rows.find(row => row.type === 'assistant/message' && (row.data as { message?: { id?: string } }).message?.id === 'm1')!
    assistant.data = {
      ...assistant.data as object,
      stream: [
        { type: 'chunk', time: 1000, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } },
        { type: 'chunk', time: 2000, chunk: { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'think' } } },
        { type: 'chunk', time: 2000, chunk: { type: 'block-start', index: 1, blockType: 'tool-call' } },
        { type: 'chunk', time: 3000, chunk: { type: 'block-end', index: 1, block: { type: 'tool-call', id: 't1', name: 'Skill', arguments: '' } } },
      ],
    }
    const [turn] = reconstructSession(rows)
    expect(turn!.requests[0]?.blocks.slice(0, 2).map(block => [block.kind, block.start, block.end])).toEqual([
      ['reasoning', 1000, 2000],
      ['tool-call', 2000, 3000],
    ])
  })

  it('backfills missing model streams and tool intervals from member history', () => {
    const rows = log('kimi-cli')
    const assistant = rows.find(row => row.type === 'assistant/message' && (row.data as { message?: { id?: string } }).message?.id === 'm1')!
    ;(assistant.data as { message: { content: unknown[] } }).message.content.unshift({ type: 'reasoning', text: 'think' })
    const [turn] = reconstructSession(rows, undefined, undefined, {
      streams: new Map([['1:1', [
        { type: 'chunk', time: 1000, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } },
        { type: 'chunk', time: 2000, chunk: { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'think' } } },
        { type: 'chunk', time: 2000, chunk: { type: 'block-start', index: 1, blockType: 'tool-call' } },
        { type: 'chunk', time: 2100, chunk: { type: 'block-end', index: 1, block: { type: 'tool-call', id: 't1', name: 'Skill', arguments: '' } } },
      ]]]),
      requestStarts: new Map([['1:1', 500]]),
      toolTimings: new Map([['t1', { startedAt: 2100, endedAt: 2500 }], ['t2', { startedAt: 7000, endedAt: 8500 }]]),
    })
    expect(turn!.requests[0]).toMatchObject({ startedAt: 500, firstChunkAt: 1000 })
    expect(turn!.requests[0]?.blocks[0]).toMatchObject({ kind: 'reasoning', start: 1000, end: 2000 })
    expect(turn!.requests[0]?.execs.find(exec => exec.callId === 't2')).toMatchObject({ start: 7000, end: 8500 })
  })

  it('aligns historical streams by tool identity when mirror step numbers shifted', () => {
    const rows = log('kimi-cli')
    for (const row of rows) {
      const data = row.data as { step?: number; usage?: { inputTokens: number; outputTokens: number }; message?: { id?: string } }
      if (data.message?.id === 'm1') data.usage = { inputTokens: 1, outputTokens: 1 }
      if (data.step === 2) data.step = 9
    }
    const [turn] = reconstructSession(rows, undefined, undefined, {
      streams: new Map([['1:2', [
        { type: 'chunk', time: 7000, chunk: { type: 'block-start', index: 0, blockType: 'tool-call' } },
        { type: 'chunk', time: 7100, chunk: { type: 'block-end', index: 0, block: { type: 'tool-call', id: 't2', name: 'ToolSearch', arguments: '' } } },
      ]]]),
      requestStarts: new Map([['1:2', 6000]]),
      toolTimings: new Map([['t2', { startedAt: 7100, endedAt: 8500 }]]),
    })
    expect(turn!.requests[1]).toMatchObject({ startedAt: 6000, firstChunkAt: 7000, settledAt: 8500 })
    expect(turn!.requests[1]?.blocks[0]).toMatchObject({ kind: 'tool-call', callId: 't2', start: 7000, end: 7100 })
  })

  it('projects a split stream once and keeps mirror-only annotations out of requests', () => {
    const assistant = (step: number, content: unknown[], usage?: { inputTokens: number; outputTokens: number }): SessionLogRow[] => [
      { type: 'step/start', time: step * 1000, data: { turn: 1, step } },
      { type: 'assistant/message', time: step * 1000, data: { turn: 1, step, message: { id: `m${step}`, role: 'assistant', content }, ...usage === undefined ? {} : { usage } } },
      { type: 'step/end', time: step * 1000, data: { turn: 1, step } },
    ]
    const rows: SessionLogRow[] = [
      descriptor('kimi-cli'),
      { type: 'turn/start', time: 0, data: { turn: 1 } },
      ...assistant(1, [{ type: 'reasoning', text: 'think' }]),
      ...assistant(2, [call('t1', 'Skill')], { inputTokens: 1, outputTokens: 1 }),
      { type: 'tool/call', time: 2100, data: { turn: 1, step: 2, callId: 't1', name: 'Skill', arguments: '' } },
      { type: 'tool/result', time: 2500, data: { turn: 1, step: 2, message: { id: 'r1', role: 'tool', toolCallId: 't1', content: [{ type: 'text', text: 'ok' }] } } },
      ...assistant(3, [{ type: 'text', text: '[未支持的内容类型 image]' }]),
      ...assistant(4, [{ type: 'text', text: 'done' }], { inputTokens: 1, outputTokens: 1 }),
      { type: 'turn/end', time: 5000, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    const [turn] = reconstructSession(rows, undefined, undefined, {
      streams: new Map([
        ['1:1', [
          { type: 'chunk', time: 1000, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } },
          { type: 'chunk', time: 2000, chunk: { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'think' } } },
          { type: 'chunk', time: 2000, chunk: { type: 'block-start', index: 1, blockType: 'tool-call' } },
          { type: 'chunk', time: 2100, chunk: { type: 'block-end', index: 1, block: { type: 'tool-call', id: 't1', name: 'Skill', arguments: '' } } },
        ]],
        ['1:4', [
          { type: 'chunk', time: 3500, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
          { type: 'chunk', time: 4000, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } } },
        ]],
      ]),
      requestStarts: new Map([['1:1', 500], ['1:4', 3000]]),
      toolTimings: new Map([['t1', { startedAt: 2100, endedAt: 2500 }]]),
    })
    expect(turn!.requests).toHaveLength(2)
    // Step 1 logged no stream and no usage: an annotation even though the
    // historical stream covers its text — judged on the log, not the
    // enrichment. Step 2 takes the call's dispatch by its tool identity.
    expect(turn!.requests[0]).toMatchObject({ startedAt: 500, firstChunkAt: 2000, settledAt: 2500 })
    expect(turn!.requests[0]?.blocks.map(block => block.kind)).toEqual(['tool-call'])
    expect(turn!.requests[1]).toMatchObject({ startedAt: 3000, firstChunkAt: 3500, settledAt: 4000 })
  })

  it('uses a mirrored result\'s real execution interval and ignores invalid metadata', () => {
    const rows = log('kimi-cli')
    const result = rows.find(row => row.type === 'tool/result' && (row.data as { message?: { toolCallId?: string } }).message?.toolCallId === 't2')!
    result.data = {
      ...result.data as object,
      meta: { localAgentTiming: { version: 1, startedAt: 7000, endedAt: 8500 } },
    }
    const [turn] = reconstructSession(rows)
    expect(turn!.requests[0]?.execs.find(exec => exec.callId === 't2')).toMatchObject({ start: 7000, end: 8500 })

    result.data = {
      ...result.data as object,
      meta: { localAgentTiming: { version: 2, startedAt: 7000, endedAt: 8500 } },
    }
    const [legacy] = reconstructSession(rows)
    expect(legacy!.requests[0]?.execs.find(exec => exec.callId === 't2')).toMatchObject({ start: 8002, end: 9000 })
  })

  it('keeps an in-process subagent\'s steps as they are', () => {
    const [turn] = reconstructSession(log('spawn'))
    expect(turn!.requests.map(r => [r.startedAt, r.usage?.outputTokens])).toEqual([[8000, undefined], [8002, 242], [12000, 109]])
  })

  it('still shows a call that never got its usage step', () => {
    const rows = log('codex-local').filter(row => row.seq < 9 || row.seq === 17)
    const [turn] = reconstructSession(rows)
    expect(turn!.requests.map(r => r.responseSummary)).toEqual([expect.objectContaining({ kind: 'tool', name: 'Skill' })])
  })
})
