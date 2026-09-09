/**
 * The kimi round's tool-call accounting: counted over the transcript's own
 * `tool.call` lines for THIS ROUND'S TURN — deliberately not over the mirror
 * window, so a settle pass a live poll already drained still reports the
 * round's real count and a resume round never inherits earlier turns.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { mirrorKimiSessionDelta, roundToolCalls } from '../src/session-mirror.ts'
import type { KimiTranscriptLine } from '../src/session-view.ts'

function ctx(): Context {
  const context = new Context()
  context.provide('logger', { warn: () => {}, info: () => {} } as never)
  return context
}

const toolLine = (turn: number, name: string, id: string): KimiTranscriptLine =>
  ({ kind: 'tool', id, name, turn })
const textLine = (turn: number, text: string): KimiTranscriptLine =>
  ({ kind: 'assistant', text, turn })

/** A scoped home whose wire log carries two rounds of tool activity. */
function wireHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'kimi-toolcalls-'))
  const dir = join(home, 'sessions', 'wd_tmp_abc', 'session_s1')
  mkdirSync(join(dir, 'agents', 'main'), { recursive: true })
  const event = (payload: object): string => JSON.stringify({ type: 'context.append_loop_event', event: payload })
  writeFileSync(join(dir, 'agents', 'main', 'wire.jsonl'), [
    JSON.stringify({ type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: '第一轮' }] } }),
    event({ type: 'step.begin', turnId: 0 }),
    event({ type: 'tool.call', turnId: 0, toolCall: { name: 'Bash', args: { command: 'ls' } }, uuid: 'u1', toolCallId: 'tc1' }),
    event({ type: 'tool.result', parentUuid: 'u1', result: { output: 'a.txt' } }),
    event({ type: 'tool.call', turnId: 0, toolCall: { name: 'Bash', args: { command: 'wc -l' } }, uuid: 'u2', toolCallId: 'tc2' }),
    event({ type: 'tool.result', parentUuid: 'u2', result: { output: '3' } }),
    event({ type: 'content.part', turnId: 0, part: { type: 'text', text: '第一轮完成。' } }),
    JSON.stringify({ type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: '第二轮' }] } }),
    event({ type: 'step.begin', turnId: 1 }),
    event({ type: 'tool.call', turnId: 1, toolCall: { name: 'Read', args: { path: '/tmp/a' } }, uuid: 'u3', toolCallId: 'tc3' }),
    event({ type: 'tool.result', parentUuid: 'u3', result: { output: 'hi' } }),
    event({ type: 'content.part', turnId: 1, part: { type: 'text', text: '第二轮完成。' } }),
  ].join('\n'))
  return home
}

describe('kimi round tool-call accounting', () => {
  it('counts only the named turn\'s calls, under the wire\'s own tool names', () => {
    const lines = [
      toolLine(1, 'Bash', 'a'),
      toolLine(1, 'Bash', 'b'),
      textLine(1, '好'),
      toolLine(2, 'Read', 'c'),
    ]
    expect(roundToolCalls(lines, 1)).toEqual({ count: 2, byName: { Bash: 2 } })
    expect(roundToolCalls(lines, 2)).toEqual({ count: 1, byName: { Read: 1 } })
  })

  it('reports nothing for a round that called none, and nothing without a turn', () => {
    const lines = [toolLine(1, 'Bash', 'a')]
    // Absent, not `{count: 0}` — the round observed no call, which the table
    // must show as a dash rather than a zero it never measured.
    expect(roundToolCalls(lines, 2)).toBeUndefined()
    expect(roundToolCalls(lines, undefined)).toBeUndefined()
  })

  it('the mirror reports the round\'s count from the wire log', async () => {
    const home = wireHome()
    const child = Session.create(SessionId('child-kimi-tools'))
    const delta = await mirrorKimiSessionDelta(ctx(), child, home, 's1', 0, { turn: 1 })
    expect(delta.toolCalls).toEqual({ count: 2, byName: { Bash: 2 } })
  })

  it('a settle pass a live poll already drained still reports the round count', async () => {
    const home = wireHome()
    const child = Session.create(SessionId('child-kimi-tools-2'))
    // First pass mirrors everything; the second starts past the whole log, so
    // its DELTA is empty — the accounting must still come back, because it is
    // read off the round's turn, not off the window.
    const first = await mirrorKimiSessionDelta(ctx(), child, home, 's1', 0, { turn: 1 })
    const second = await mirrorKimiSessionDelta(ctx(), child, home, 's1', first.total, { turn: 1 })
    expect(second.texts).toEqual([])
    expect(second.toolCalls).toEqual({ count: 2, byName: { Bash: 2 } })
  })

  it('a resume round reports its OWN calls, never the first round\'s', async () => {
    const home = wireHome()
    const child = Session.create(SessionId('child-kimi-tools-3'))
    const delta = await mirrorKimiSessionDelta(ctx(), child, home, 's1', 0, { turn: 2 })
    expect(delta.toolCalls).toEqual({ count: 1, byName: { Read: 1 } })
  })
})
