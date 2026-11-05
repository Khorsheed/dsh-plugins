/**
 * A mirror annotation — an external agent's assistant/message carrying only
 * reasoning/text, with no usage and an empty logged stream — is history, not
 * a request. The fixture is shaped like a kimi live member log written before
 * 2026-11-06: the live driver sealed a later call's streamed reasoning as its
 * own step, at the same instant the wire fold wrote the earlier call's tool
 * step (synthetic content).
 */
import { describe, expect, it } from 'vitest'
import { reconstructSession, type SessionLogRow } from '../src/log-lane.ts'

const usage = (input: number, output: number) => ({ inputTokens: input, outputTokens: output, cacheReadTokens: input - 1 })
const streamOf = (start: number, blocks: { type: string; text?: string; id?: string; name?: string }[]) => blocks.flatMap((block, index) => [
  { type: 'chunk', time: start + index * 10, chunk: { type: 'block-start', index, blockType: block.type } },
  { type: 'chunk', time: start + index * 10 + 5, chunk: { type: 'block-end', index, block: block.type === 'tool-call' ? { ...block, arguments: '' } : block } },
])

let seq = 0
const row = (type: string, time: number, data: Record<string, unknown>, surfaceOp?: 'append'): SessionLogRow =>
  ({ type, seq: seq++, time, data, ...surfaceOp === undefined ? {} : { surfaceOp } })

/** One mirrored step; `extra` carries usage / stream / interrupted. */
function step(n: number, time: number, content: Record<string, unknown>[], extra: Record<string, unknown>, tool?: { id: string; name: string }): SessionLogRow[] {
  return [
    row('step/start', time, { turn: 1, step: n }),
    row('assistant/message', time, { turn: 1, step: n, message: { id: `m${n}`, role: 'assistant', content, source: { kind: 'model', provider: 'kimi-cli', model: 'k' } }, ...extra }, 'append'),
    ...tool === undefined ? [] : [
      row('tool/call', time, { turn: 1, step: n, callId: tool.id, name: tool.name, arguments: '' }),
      row('tool/result', time, { turn: 1, step: n, message: { id: `r${n}`, role: 'tool', toolCallId: tool.id, content: [{ type: 'text', text: `${tool.name} ok` }] } }, 'append'),
    ],
    row('step/end', time, { turn: 1, step: n }),
  ]
}

/** The prod shape: A (reasoning + Read), the split pair (reasoning-only at the same instant as B's Edit), C (Bash). */
function splitLog(recorded: boolean): SessionLogRow[] {
  seq = 0
  const read = { type: 'tool-call', id: 'tA', name: 'Read', arguments: '' }
  const edit = { type: 'tool-call', id: 'tB', name: 'Edit', arguments: '' }
  const bash = { type: 'tool-call', id: 'tC', name: 'Bash', arguments: '' }
  return [
    row('subagent/descriptor', 1, { version: 3, mode: 'persistent', provider: 'kimi-cli', label: 'member' }),
    ...recorded ? [row('local-agent/execution', 2, { phase: 'start', executionId: 'e1', caller: 'room', operation: 'round', parentSessionId: 'room', admittedAt: 2 })] : [],
    row('turn/start', 1000, { turn: 1 }),
    row('user/message', 1000, { id: 'u1', role: 'user', content: [{ type: 'text', text: 'fix the filter' }], source: { kind: 'user' } }, 'append'),
    ...step(1, 2000, [{ type: 'reasoning', text: 'look at the store first' }, read], { usage: usage(100, 10), stream: streamOf(1500, [{ type: 'reasoning', text: 'look at the store first' }, { type: 'tool-call', id: 'tA', name: 'Read' }]) }, { id: 'tA', name: 'Read' }),
    // The split pair: the later call's reasoning, sealed from live text (no usage, empty stream)…
    ...step(2, 3000, [{ type: 'reasoning', text: 'run the tests again' }], { stream: [] }),
    // …written at the same instant as the earlier call's tool step.
    ...step(3, 3000, [edit], { usage: usage(200, 20), stream: streamOf(2100, [{ type: 'tool-call', id: 'tB', name: 'Edit' }]) }, { id: 'tB', name: 'Edit' }),
    ...step(4, 4000, [bash], { usage: usage(300, 30), stream: streamOf(2900, [{ type: 'reasoning', text: 'run the tests again' }, { type: 'tool-call', id: 'tC', name: 'Bash' }]) }, { id: 'tC', name: 'Bash' }),
    row('turn/end', 4001, { turn: 1, reason: { kind: 'completed' } }),
    ...recorded ? [row('local-agent/execution', 4002, { phase: 'end', executionId: 'e1', outcome: 'done', turns: [1], endedAt: 4002 })] : [],
  ]
}

describe('mirror annotations (reasoning/text only, no usage, empty logged stream)', () => {
  for (const recorded of [true, false]) {
    it(`reads the split reasoning step as history, not a request (${recorded ? 'recorded' : 'unrecorded'} log)`, () => {
      const [turn] = reconstructSession(splitLog(recorded))
      const requests = turn!.requests
      // Three real calls; the reasoning-only step mints no "思考" request.
      expect(requests.map(request => request.usage?.inputTokens)).toEqual([100, 200, 300])
      expect(requests.map(request => request.requestNumber)).toEqual([1, 2, 3])
      expect(requests.map(request => request.responseSummary)).toEqual([
        expect.objectContaining({ kind: 'tool', name: 'Read' }),
        expect.objectContaining({ kind: 'tool', name: 'Edit' }),
        expect.objectContaining({ kind: 'tool', name: 'Bash' }),
      ])
      // The Edit request's diff baseline is the Read request: what it adds is
      // the Read response, its result and the annotation — nothing earlier.
      const edit = requests[1]!
      expect(edit.segments.history.map(item => item.messageId)).toEqual(['u1'])
      expect(edit.segments.added.map(item => item.messageId)).toEqual(['m1', 'r1', 'm2'])
      // The annotation stays in history for the request after it.
      expect(requests[2]!.segments.history.map(item => item.messageId)).toContain('m2')
    })
  }

  it('reads the annotation the same with read-time harness timing', () => {
    // A historical stream matching the reasoning by content must not turn it back into a request.
    const [turn] = reconstructSession(splitLog(true), undefined, undefined, {
      streams: new Map([['1:2', streamOf(2900, [{ type: 'reasoning', text: 'run the tests again' }])]]),
      requestStarts: new Map([['1:2', 2800]]),
    })
    expect(turn!.requests).toHaveLength(3)
  })

  it('keeps a reasoning-only step that reports usage, a logged stream or an interrupted mark as a request', () => {
    const variants: Record<string, unknown>[] = [
      { usage: usage(150, 5), stream: [] },
      { stream: streamOf(2500, [{ type: 'reasoning', text: 'run the tests again' }]) },
      { stream: [], interrupted: true },
    ]
    for (const extra of variants) {
      const rows = splitLog(true)
      const pair = rows.find(candidate => candidate.type === 'assistant/message' && (candidate.data as { step?: number }).step === 2)!
      pair.data = { ...pair.data as Record<string, unknown>, ...extra }
      const [turn] = reconstructSession(rows)
      expect(turn!.requests).toHaveLength(4)
      expect(turn!.requests[1]!.responseSummary).toEqual(expect.objectContaining({ kind: 'reasoning' }))
    }
  })

  it('leaves an in-process subagent\'s reasoning-only step a request', () => {
    const rows = splitLog(false).map(candidate => candidate.type === 'subagent/descriptor'
      ? { ...candidate, data: { ...candidate.data as Record<string, unknown>, provider: 'spawn' } }
      : candidate)
    const [turn] = reconstructSession(rows)
    expect(turn!.requests).toHaveLength(4)
  })
})
