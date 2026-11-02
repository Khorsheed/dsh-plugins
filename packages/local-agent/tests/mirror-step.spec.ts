import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  MIRROR_INTERRUPTED_TOOL_RESULT,
  appendMirrorContent,
  appendMirrorStep,
  appendRequestHeaderIfChanged,
  closeMirrorTurn,
  mirrorStreamRecords,
  recordContextOccupancy,
} from '../src/mirror-step.ts'

const source = { provider: 'test-local', model: 'test-model' }

function child(): Session {
  const session = Session.create(SessionId('child-mirror-step'))
  session.append('turn/start', { turn: 1 })
  return session
}

describe('appendMirrorStep', () => {
  it('writes one closed step: the advertising message, then each call resolved in order', () => {
    const session = child()
    appendMirrorStep(session, 1, 1, {
      blocks: [
        { kind: 'think', text: '想', generation: { startedAt: 100, endedAt: 200 } },
        { kind: 'text', text: '说' },
        { kind: 'tool', id: 'ok', name: 'Bash', args: 'ls', result: 'a.txt', timing: { startedAt: 300, endedAt: 450, source: 'provider' } },
        { kind: 'tool', id: 'bad', name: 'Bash', args: 'false', result: 'exit 1', failed: true },
        { kind: 'tool', id: 'lost', name: 'Read' },
      ],
      usage: { inputTokens: 3, outputTokens: 4 },
    }, source)
    const events = session.snapshotEvents().slice(1)
    expect(events.map(event => event.type)).toEqual([
      'step/start', 'assistant/message',
      'tool/call', 'tool/result', 'tool/call', 'tool/result', 'tool/call', 'tool/result',
      'step/end',
    ])
    const message = events[1]!.data as { message: { content: unknown[]; source: unknown }; usage?: unknown; stream: unknown[] }
    expect(message.message.source).toEqual({ kind: 'model', provider: 'test-local', model: 'test-model' })
    expect(message.message.content).toEqual([
      { type: 'reasoning', text: '想' },
      { type: 'text', text: '说' },
      { type: 'tool-call', id: 'ok', name: 'Bash', arguments: 'ls' },
      { type: 'tool-call', id: 'bad', name: 'Bash', arguments: 'false' },
      { type: 'tool-call', id: 'lost', name: 'Read', arguments: '' },
    ])
    expect(message.usage).toEqual({ inputTokens: 3, outputTokens: 4 })
    // Only blocks with a generation interval reach the stream.
    expect(message.stream).toEqual([
      { type: 'chunk', time: 100, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } },
      { type: 'chunk', time: 200, chunk: { type: 'block-end', index: 0, block: { type: 'reasoning', text: '想' } } },
    ])
    const results = events.filter(event => event.type === 'tool/result')
    const calls = events.filter(event => event.type === 'tool/call')
    expect(results.map(event => (event.data as { message: { isError: boolean } }).message.isError)).toEqual([false, true, true])
    expect((results[2]!.data as { message: { content: unknown } }).message.content).toEqual([{ type: 'text', text: MIRROR_INTERRUPTED_TOOL_RESULT }])
    expect(results.map(event => event.sourceEventSeqs)).toEqual(calls.map(call => [call.seq]))
    // The tool timing meta names the same provider as the message source.
    expect((results[0]!.data as { meta?: unknown }).meta).toEqual({
      localAgentTiming: { version: 1, provider: 'test-local', startedAt: 300, endedAt: 450, source: 'provider' },
    })
    expect((results[1]!.data as { meta?: unknown }).meta).toBeUndefined()
  })

  it('an explicit stream wins over the block generations; interrupted marks a partial', () => {
    const session = child()
    session.append('step/start', { turn: 1, step: 1 })
    appendMirrorContent(session, 1, 1, {
      blocks: [{ kind: 'text', text: '一半', generation: { startedAt: 1, endedAt: 2 } }],
      stream: [],
      interrupted: true,
    }, source)
    const message = session.snapshotEvents().at(-1)!
    expect(message.type).toBe('assistant/message')
    expect(message.data).toMatchObject({ turn: 1, step: 1, stream: [], interrupted: true })
    expect((message.data as { usage?: unknown }).usage).toBeUndefined()
  })

  it('mirrorStreamRecords indexes by block position, skipping blocks without timing', () => {
    expect(mirrorStreamRecords([
      { kind: 'text', text: 'x' },
      { kind: 'tool', id: 't', name: 'Bash', generation: { startedAt: 5, endedAt: 9 } },
    ])).toEqual([
      { type: 'chunk', time: 5, chunk: { type: 'block-start', index: 1, blockType: 'tool-call' } },
      { type: 'chunk', time: 9, chunk: { type: 'block-end', index: 1, block: { type: 'tool-call', id: 't', name: 'Bash', arguments: '' } } },
    ])
  })
})

describe('appendRequestHeaderIfChanged', () => {
  it('writes initial, skips an identical config, writes a change', () => {
    const session = child()
    appendRequestHeaderIfChanged(session, { provider: 'p', model: 'a' })
    appendRequestHeaderIfChanged(session, { provider: 'p', model: 'a' })
    appendRequestHeaderIfChanged(session, { provider: 'p', model: 'b', reasoningEffort: 'high' })
    expect(session.snapshotEvents().filter(event => event.type === 'request/header').map(event => event.data)).toEqual([
      { header: { config: { provider: 'p', model: 'a' } }, reason: 'initial' },
      { header: { config: { provider: 'p', model: 'b', reasoningEffort: 'high' } }, reason: 'change' },
    ])
  })
})

describe('closeMirrorTurn', () => {
  it('maps each stop reason onto its turn/end reason', () => {
    const reasons = (['completed', 'aborted', 'error'] as const).map((stop) => {
      const session = child()
      closeMirrorTurn(session, 1, stop, 'boom')
      return session.snapshotEvents().at(-1)!.data
    })
    expect(reasons).toEqual([
      { turn: 1, reason: { kind: 'completed' } },
      { turn: 1, reason: { kind: 'aborted', reason: { kind: 'parent' } } },
      { turn: 1, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } },
    ])
  })
})

describe('recordContextOccupancy', () => {
  it('records a moved reading once, and a repeated one only when forced', () => {
    const session = child()
    recordContextOccupancy(session, { provider: 'p', usedTokens: 10, contextWindow: 100 })
    recordContextOccupancy(session, { provider: 'p', usedTokens: 10, contextWindow: 100 })
    recordContextOccupancy(session, { provider: 'p', usedTokens: 10, contextWindow: 100 }, { force: true })
    recordContextOccupancy(session, { provider: 'p', usedTokens: 12 })
    expect(session.snapshotEvents().filter(event => event.type === 'local-agent/context').map(event => event.data)).toEqual([
      { provider: 'p', usedTokens: 10, contextWindow: 100 },
      { provider: 'p', usedTokens: 10, contextWindow: 100 },
      { provider: 'p', usedTokens: 12 },
    ])
  })
})
