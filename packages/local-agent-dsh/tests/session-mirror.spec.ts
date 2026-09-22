/**
 * The dsh session mirror: round-scoped event copy from the sub-dsh session
 * file into the parent-side child session — caller-task filtering, verbatim
 * assistant events (usage included), resume-round incrementality, missing and
 * compressed files.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { mirrorDshLiveEvent, mirrorDshSession, readSubDshEvents } from '../src/session-mirror.ts'
import { parseDshSessionLogFilename } from '../src/session-log.ts'
import { fakeSessionPersistence } from './fake-persistence.ts'

/** A context whose sessionPersistence is absent (the mirror tolerates it). */
function fakeCtx(): Context {
  return { get: () => undefined, logger: { warn: () => undefined } } as unknown as Context
}

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-mirror-'))
}

/** One user/message event line as the sub-dsh records it. */
function userLine(text: string, kind: string): object {
  return {
    type: 'user/message',
    seq: 0,
    time: 1,
    data: {
      content: [{ type: 'text', text }],
      source: kind === 'user' ? { kind: 'user' } : { kind: 'plugin', plugin: kind },
      role: 'user',
    },
  }
}

/** One assistant/message event line with usage, as the sub-dsh records it. */
function assistantLine(turn: number, text: string, step = 1): object {
  return {
    type: 'assistant/message',
    seq: 0,
    time: 1,
    data: {
      turn,
      step,
      message: createAssistantMessage({
        content: [{ type: 'reasoning', text: `thinking ${turn}` }, { type: 'text', text }],
        source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      }),
      usage: { inputTokens: 100 * turn, outputTokens: 10 * turn },
    },
  }
}

/** One step boundary event line, as the sub-dsh's real agent loop writes it. */
function stepLine(kind: 'step/start' | 'step/end', turn: number, step: number): object {
  return { type: kind, seq: 0, time: 1, data: { turn, step } }
}

/**
 * Assert every mirrored content event sits inside its `step/start`–`step/end`
 * pair: the real-time subsession view only materializes an assistant message
 * whose step is opened by a step/start boundary — the mirror must copy the
 * sub-dsh's pairs verbatim, or the live view drops the message.
 */
function expectStepBoundaries(child: Session): void {
  const events = child.snapshotEvents()
  const boundaries = events.filter(event => event.type === 'step/start' || event.type === 'step/end')
  const content = events.filter(event =>
    event.type === 'assistant/message' || event.type === 'tool/call' || event.type === 'tool/result')
  expect(content.length).toBeGreaterThan(0)
  for (const event of content) {
    const { turn, step } = event.data as { turn: number; step: number }
    const at = boundaries.filter(boundary => {
      const data = boundary.data as { turn: number; step: number }
      return data.turn === turn && data.step === step
    })
    const start = at.find(boundary => boundary.type === 'step/start')
    const end = at.find(boundary => boundary.type === 'step/end')
    expect(start, `step/start for ${event.type} at ${turn}:${step}`).toBeDefined()
    expect(end, `step/end for ${event.type} at ${turn}:${step}`).toBeDefined()
    expect(start!.seq).toBeLessThan(event.seq)
    expect(end!.seq).toBeGreaterThan(event.seq)
  }
}

/** A two-round sub-dsh session: each round has a task, scaffolding, and a reply. */
function twoRoundLines(): object[] {
  return [
    { type: 'session', version: 0, id: 'x' },
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    userLine('第一轮任务', 'user'),
    userLine('<system-reminder> workspace</system-reminder>', 'agent-instructions'),
    userLine('Current runtime context…', '@deepseek-ai/dsh-system-prompt'),
    stepLine('step/start', 1, 1),
    assistantLine(1, '第一轮回答'),
    stepLine('step/end', 1, 1),
    { type: 'turn/end', seq: 0, time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 2 } },
    userLine('第二轮任务', 'user'),
    stepLine('step/start', 2, 1),
    assistantLine(2, '第二轮回答'),
    stepLine('step/end', 2, 1),
    { type: 'turn/end', seq: 0, time: 1, data: { turn: 2, reason: { kind: 'completed' } } },
  ]
}

function writeSubDshSession(
  homeDir: string,
  id: string,
  lines: object[],
  compressed = false,
  /**
   * The generation basename the store wrote. Defaults to the original
   * unversioned log; host 0.1.5 writes `session.v3.jsonl.zstd`.
   */
  basename?: string,
): void {
  const dir = join(homeDir, 'sessions', 'wd_test', id)
  mkdirSync(dir, { recursive: true })
  if (compressed) {
    // Persist like the real store: one zstd frame per flush batch, so the
    // reader must handle multi-frame concatenation (single-shot decompression
    // would stop at the first frame — the bug this fixture guards).
    const first = lines.slice(0, 3).map(line => JSON.stringify(line)).join('\n') + '\n'
    const rest = lines.slice(3).map(line => JSON.stringify(line)).join('\n') + '\n'
    writeFileSync(join(dir, basename ?? 'session.jsonl.zstd'), Buffer.concat([zstdCompressSync(first), zstdCompressSync(rest)]))
    return
  }
  const text = lines.map(line => JSON.stringify(line)).join('\n') + '\n'
  writeFileSync(join(dir, basename ?? 'session.jsonl'), text)
}

/** A child session pre-loaded with `rounds` turn boundaries, as the provider leaves it. */
function childWithRounds(id: string, rounds: number): Session {
  const child = Session.create(SessionId(id))
  for (let turn = 1; turn <= rounds; turn += 1) {
    child.append('turn/start', { turn })
    child.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  return child
}

describe('readSubDshEvents', () => {
  it('returns undefined when the session is absent', async () => {
    await expect(readSubDshEvents(tempHome(), 'nope')).resolves.toBeUndefined()
  })

  it('reads a zstd-compressed session log', async () => {
    const home = tempHome()
    writeSubDshSession(home, 's1', twoRoundLines(), true)
    const read = await readSubDshEvents(home, 's1')
    expect(read?.events).toHaveLength(twoRoundLines().length - 1)
    // …and it says WHICH file it read, so a generation change cannot look
    // like an empty session.
    expect(read?.log).toMatchObject({ filename: 'session.jsonl.zstd', version: 0, compressed: true })
  })
})

describe('mirrorDshSession', () => {
  it('mirrors only the current round, filtering scaffolding user messages', async () => {
    const home = tempHome()
    writeSubDshSession(home, 'child-1', twoRoundLines())
    const child = childWithRounds('child-1', 1)
    await mirrorDshSession(fakeCtx(), child, home, 'child-1')
    const mirrored = child.snapshotEvents().filter(event => event.type === 'user/message' || event.type === 'assistant/message')
    // Exactly the round-1 task and reply cross; the round-2 content stays behind.
    expect(mirrored).toHaveLength(2)
    const [task, reply] = mirrored
    expect(task?.type).toBe('user/message')
    expect(JSON.stringify(task?.data)).toContain('第一轮任务')
    expect(reply?.type).toBe('assistant/message')
    expect(JSON.stringify(reply?.data)).toContain('第一轮回答')
    // Usage rides the verbatim assistant event into the projection.
    expect(JSON.stringify(reply?.data)).toContain('"inputTokens":100')
    // Scaffolding (agent-instructions / plugin context) never crosses.
    expect(JSON.stringify(child.snapshotEvents())).not.toContain('agent-instructions')
    expect(JSON.stringify(child.snapshotEvents())).not.toContain('runtime context')
    // The sub-dsh's own step boundary pair crossed verbatim around the reply.
    expectStepBoundaries(child)
  })

  it('mirrors only the resumed round incrementally on a later round', async () => {
    const home = tempHome()
    writeSubDshSession(home, 'child-2', twoRoundLines())
    const child = childWithRounds('child-2', 2)
    await mirrorDshSession(fakeCtx(), child, home, 'child-2')
    const mirrored = child.snapshotEvents().filter(event => event.type === 'user/message' || event.type === 'assistant/message')
    expect(mirrored).toHaveLength(2)
    expect(JSON.stringify(mirrored[1]?.data)).toContain('第二轮回答')
    expect(JSON.stringify(child.snapshotEvents())).not.toContain('第一轮回答')
  })

  it('mirrors tool/call + tool/result as native events with the sourceEventSeqs remapped', async () => {
    const home = tempHome()
    writeSubDshSession(home, 'child-tools', [
      { type: 'session', version: 0, id: 'x' },
      { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
      userLine('干活', 'user'),
      stepLine('step/start', 1, 1),
      {
        type: 'tool/call',
        seq: 3,
        time: 2,
        data: { turn: 1, step: 1, callId: 'call_1', name: 'Bash', arguments: '{"command":"ls"}' },
      },
      {
        type: 'tool/result',
        seq: 4,
        time: 3,
        sourceEventSeqs: [3],
        data: {
          turn: 1,
          step: 1,
          message: {
            role: 'user',
            source: { kind: 'tool', callId: 'call_1' },
            content: [{ type: 'tool-result', toolCallId: 'call_1', content: [{ type: 'text', text: 'a.txt' }], isError: false }],
          },
        },
      },
      stepLine('step/end', 1, 1),
      stepLine('step/start', 1, 2),
      assistantLine(1, '做完了', 2),
      stepLine('step/end', 1, 2),
      { type: 'turn/end', seq: 6, time: 4, data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    const child = childWithRounds('child-tools', 1)
    await mirrorDshSession(fakeCtx(), child, home, 'child-tools')

    const calls = child.snapshotEvents().filter(event => event.type === 'tool/call')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.data).toMatchObject({ callId: 'call_1', name: 'Bash' })
    const results = child.snapshotEvents().filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    // The result's pairing reference points at the CHILD's call event seq
    // (the source event's own sourceEventSeqs referenced the sub-dsh log's
    // numbering, which the remap drops).
    expect(results[0]?.sourceEventSeqs).toEqual([calls[0]!.seq])
    // Both steps crossed with their boundary pairs intact.
    expectStepBoundaries(child)
  })

  it('reports the round\'s tool-call accounting off the round window', async () => {
    const home = tempHome()
    const call = (seq: number, name: string, callId: string): object => ({
      type: 'tool/call',
      seq,
      time: seq,
      data: { turn: 1, step: seq, callId, name, arguments: '{}' },
    })
    writeSubDshSession(home, 'child-tool-count', [
      { type: 'session', version: 0, id: 'x' },
      { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
      userLine('干活', 'user'),
      stepLine('step/start', 1, 3),
      call(3, 'Bash', 'c1'),
      stepLine('step/end', 1, 3),
      stepLine('step/start', 1, 4),
      call(4, 'Bash', 'c2'),
      stepLine('step/end', 1, 4),
      stepLine('step/start', 1, 5),
      call(5, 'Read', 'c3'),
      stepLine('step/end', 1, 5),
      stepLine('step/start', 1, 6),
      assistantLine(1, '做完了', 6),
      stepLine('step/end', 1, 6),
      { type: 'turn/end', seq: 7, time: 7, data: { turn: 1, reason: { kind: 'completed' } } },
      // A SECOND round's calls must not leak into the first round's count.
      { type: 'turn/start', seq: 8, time: 8, data: { turn: 2 } },
      call(9, 'WebSearch', 'c4'),
      assistantLine(2, '第二轮'),
      { type: 'turn/end', seq: 11, time: 11, data: { turn: 2, reason: { kind: 'completed' } } },
    ])
    const child = childWithRounds('child-tool-count', 1)
    const delta = await mirrorDshSession(fakeCtx(), child, home, 'child-tool-count')
    expect(delta.toolCalls).toEqual({ count: 3, byName: { Bash: 2, Read: 1 } })
    expectStepBoundaries(child)
  })

  it('a settle pass a live poll already drained still reports the round count', async () => {
    const home = tempHome()
    writeSubDshSession(home, 'child-tool-drained', [
      { type: 'session', version: 0, id: 'x' },
      { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
      userLine('干活', 'user'),
      stepLine('step/start', 1, 1),
      { type: 'tool/call', seq: 3, time: 3, data: { turn: 1, step: 1, callId: 'c1', name: 'Bash', arguments: '{}' } },
      stepLine('step/end', 1, 1),
      stepLine('step/start', 1, 2),
      assistantLine(1, '做完了', 2),
      stepLine('step/end', 1, 2),
      { type: 'turn/end', seq: 5, time: 5, data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    const child = childWithRounds('child-tool-drained', 1)
    const first = await mirrorDshSession(fakeCtx(), child, home, 'child-tool-drained')
    expect(first.toolCalls).toEqual({ count: 1, byName: { Bash: 1 } })
    // Second pass: the prefix skip (step boundaries counted on BOTH sides)
    // leaves nothing new to mirror, but the accounting is read off the round
    // window, so it still comes back.
    const second = await mirrorDshSession(fakeCtx(), child, home, 'child-tool-drained')
    expect(second.texts).toEqual([])
    expect(second.toolCalls).toEqual({ count: 1, byName: { Bash: 1 } })
    expectStepBoundaries(child)
  })

  it('a round that called no tool reports no accounting at all', async () => {
    const home = tempHome()
    writeSubDshSession(home, 'child-no-tools', twoRoundLines())
    const child = childWithRounds('child-no-tools', 1)
    const delta = await mirrorDshSession(fakeCtx(), child, home, 'child-no-tools')
    // Absent, not `{count: 0}`: the table prints a dash for "not observed".
    expect(delta.toolCalls).toBeUndefined()
  })

  it('is a no-op when the sub-dsh session never materialized', async () => {
    const child = childWithRounds('child-3', 1)
    await expect(mirrorDshSession(fakeCtx(), child, tempHome(), 'child-3')).resolves.toEqual({ texts: [], total: 0 })
    expect(child.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(0)
  })

  it('mirrors incrementally: a second pass appends only the round’s new events', async () => {
    const home = tempHome()
    // Round 1 mid-run: task and first reply flushed; more arrives later.
    writeSubDshSession(home, 'child-4', [
      { type: 'session', version: 0, id: 'x' },
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      userLine('第一轮任务', 'user'),
      stepLine('step/start', 1, 1),
      assistantLine(1, '第一条回复'),
      stepLine('step/end', 1, 1),
    ])
    const child = childWithRounds('child-4', 1)
    const first = await mirrorDshSession(fakeCtx(), child, home, 'child-4')
    expect(first).toEqual({
      texts: ['第一轮任务', '第一条回复'],
      // Four events crossed (task, boundary pair, reply); the boundaries
      // count in the total but carry no delta text.
      total: 4,
      // The round's own span names the model and sums the assistant usage.
      sessionLogFile: 'session.jsonl',
      observedModel: 'deepseek-official/deepseek-v4-flash',
      usage: { inputTokens: 100, outputTokens: 10 },
    })

    // The live pass returned; the log grows (second reply), and the next pass
    // mirrors only the delta — the settle-time pass after it is a pure no-op.
    // The observation stays span-derived: the grown round sums BOTH replies.
    writeSubDshSession(home, 'child-4', [
      { type: 'session', version: 0, id: 'x' },
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      userLine('第一轮任务', 'user'),
      stepLine('step/start', 1, 1),
      assistantLine(1, '第一条回复'),
      stepLine('step/end', 1, 1),
      stepLine('step/start', 1, 2),
      assistantLine(1, '第二条回复', 2),
      stepLine('step/end', 1, 2),
      { type: 'turn/end', seq: 0, time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    const second = await mirrorDshSession(fakeCtx(), child, home, 'child-4')
    expect(second).toEqual({
      texts: ['第二条回复'],
      total: 7,
      sessionLogFile: 'session.jsonl',
      observedModel: 'deepseek-official/deepseek-v4-flash',
      usage: { inputTokens: 200, outputTokens: 20 },
    })
    const third = await mirrorDshSession(fakeCtx(), child, home, 'child-4')
    expect(third).toEqual({
      texts: [],
      total: 7,
      sessionLogFile: 'session.jsonl',
      observedModel: 'deepseek-official/deepseek-v4-flash',
      usage: { inputTokens: 200, outputTokens: 20 },
    })

    const assistant = child.snapshotEvents().filter(event => event.type === 'assistant/message')
    expect(assistant).toHaveLength(2)
    const texts = assistant.map(event => JSON.stringify(event.data))
    expect(new Set(texts).size).toBe(texts.length)
    // Each mirrored reply kept its own verbatim boundary pair — no duplicated
    // step/start for a repeated (turn, step).
    expectStepBoundaries(child)
  })

  it('passes todo/write through as the standing snapshot, idempotent across passes', async () => {
    const home = tempHome()
    const todos1 = { todos: [
      { content: '读代码', status: 'completed' },
      { content: '改实现', status: 'in_progress' },
    ] }
    writeSubDshSession(home, 'child-todo', [
      { type: 'session', version: 0, id: 'x' },
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      userLine('任务', 'user'),
      { type: 'todo/write', seq: 0, time: 1, data: todos1 },
      stepLine('step/start', 1, 1),
      assistantLine(1, '回复'),
      stepLine('step/end', 1, 1),
    ])
    const child = childWithRounds('child-todo', 1)

    const first = await mirrorDshSession(fakeCtx(), child, home, 'child-todo')
    // The snapshot crosses verbatim (counted in the total, but not a text delta).
    const writes = child.snapshotEvents().filter(event => event.type === 'todo/write')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.data).toEqual(todos1)
    expect(first.total).toBe(5)
    expect(first.texts).toEqual(['任务', '回复'])

    // A repeat pass over an unchanged log is a pure no-op — no duplicate
    // identical snapshot lands in the child log.
    const repeat = await mirrorDshSession(fakeCtx(), child, home, 'child-todo')
    expect(repeat).toEqual({
      texts: [],
      total: 5,
      sessionLogFile: 'session.jsonl',
      observedModel: 'deepseek-official/deepseek-v4-flash',
      usage: { inputTokens: 100, outputTokens: 10 },
    })
    expect(child.snapshotEvents().filter(event => event.type === 'todo/write')).toHaveLength(1)

    // A CHANGED snapshot (the sub-dsh updated the list) mirrors as the new
    // last-wins state; the intermediate one never entered the child log.
    const todos2 = { todos: [
      { content: '读代码', status: 'completed' },
      { content: '改实现', status: 'completed' },
    ] }
    writeSubDshSession(home, 'child-todo', [
      { type: 'session', version: 0, id: 'x' },
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      userLine('任务', 'user'),
      { type: 'todo/write', seq: 0, time: 1, data: todos1 },
      stepLine('step/start', 1, 1),
      assistantLine(1, '回复'),
      stepLine('step/end', 1, 1),
      { type: 'todo/write', seq: 0, time: 1, data: todos2 },
      { type: 'turn/end', seq: 0, time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    const second = await mirrorDshSession(fakeCtx(), child, home, 'child-todo')
    expect(second).toEqual({
      texts: [],
      total: 6,
      sessionLogFile: 'session.jsonl',
      observedModel: 'deepseek-official/deepseek-v4-flash',
      usage: { inputTokens: 100, outputTokens: 10 },
    })
    const after = child.snapshotEvents().filter(event => event.type === 'todo/write')
    expect(after).toHaveLength(2)
    expect(after[1]?.data).toEqual(todos2)
  })
})

describe('mirrorDshLiveEvent', () => {
  it('applies the file mirror\'s exact filter and verbatim append to one live event', () => {
    const child = Session.create(SessionId('child-live-fold'))
    // The caller task crosses; scaffolding user messages stay behind.
    expect(mirrorDshLiveEvent(child, userLine('实时任务', 'user') as never)).toBe('实时任务')
    expect(mirrorDshLiveEvent(child, userLine('脚手架', 'plugin') as never)).toBeUndefined()
    // Step boundaries cross verbatim (their own coordinates) but carry no
    // delta text — structure, not content.
    expect(mirrorDshLiveEvent(child, stepLine('step/start', 1, 1) as never)).toBeUndefined()
    // Assistant messages cross verbatim, usage included, same as the span loop.
    const text = mirrorDshLiveEvent(child, assistantLine(1, '实时回复') as never)
    expect(text).toBe('实时回复')
    expect(mirrorDshLiveEvent(child, stepLine('step/end', 1, 1) as never)).toBeUndefined()
    const assistant = child.snapshotEvents().find(event => event.type === 'assistant/message')
    expect(assistant?.data).toMatchObject({ usage: { inputTokens: 100, outputTokens: 10 }, message: { content: [{ type: 'reasoning', text: 'thinking 1' }, { type: 'text', text: '实时回复' }] } })
    const starts = child.snapshotEvents().filter(event => event.type === 'step/start')
    expect(starts).toHaveLength(1)
    expect(starts[0]?.data).toEqual({ turn: 1, step: 1 })
    expectStepBoundaries(child)
    // Turn boundaries never cross (the parent's own stay authoritative).
    expect(mirrorDshLiveEvent(child, { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } } as never)).toBeUndefined()
    expect(mirrorDshLiveEvent(child, { type: 'turn/end', seq: 0, time: 1, data: { turn: 1, reason: { kind: 'completed' } } } as never)).toBeUndefined()
    expect(child.snapshotEvents().filter(event => event.type === 'turn/start' || event.type === 'turn/end')).toHaveLength(0)
  })

  it('mirrors an interrupted step as an OPEN pair (start without end — nothing synthesized)', () => {
    const child = Session.create(SessionId('child-live-open-step'))
    mirrorDshLiveEvent(child, stepLine('step/start', 1, 1) as never)
    mirrorDshLiveEvent(child, assistantLine(1, '被打断的回复') as never)
    // The sub-dsh was interrupted before step/end: the open step crosses
    // as-is (its location still resolves to the step, so the reply renders)
    // and no closing boundary is invented.
    expect(child.snapshotEvents().filter(event => event.type === 'step/start')).toHaveLength(1)
    expect(child.snapshotEvents().filter(event => event.type === 'step/end')).toHaveLength(0)
  })

  it('never crosses an assistant/attempt (no surface content — host 0.1.5 retired per-chunk events)', () => {
    const child = Session.create(SessionId('child-live-fold-attempt'))
    const attempt = {
      type: 'assistant/attempt',
      seq: 0,
      time: 1,
      data: { turn: 1, step: 1, stream: [] },
    }
    expect(mirrorDshLiveEvent(child, attempt as never, { granularity: 'token' })).toBeUndefined()
    expect(child.snapshotEvents()).toHaveLength(0)
  })

  it('keeps the file mirror\'s offset consistent after live-appended events (no double mirror)', async () => {
    const home = tempHome()
    const child = Session.create(SessionId('child-live-parity'))
    child.append('turn/start', { turn: 1 })
    // The live transport mirrored the task, the first reply, AND the step
    // boundary pair event-by-event.
    mirrorDshLiveEvent(child, userLine('第一轮任务', 'user') as never)
    mirrorDshLiveEvent(child, stepLine('step/start', 1, 1) as never)
    mirrorDshLiveEvent(child, assistantLine(1, '第一条回复') as never)
    mirrorDshLiveEvent(child, stepLine('step/end', 1, 1) as never)
    // The settle reconciliation pass over the on-disk log (which additionally
    // holds a second reply the wire had not pushed) mirrors exactly the delta —
    // the boundaries occupy skip positions on both sides, so nothing re-crosses.
    writeSubDshSession(home, 'child-live-parity', [
      { type: 'session', version: 0, id: 'x' },
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      userLine('第一轮任务', 'user'),
      stepLine('step/start', 1, 1),
      assistantLine(1, '第一条回复'),
      stepLine('step/end', 1, 1),
      stepLine('step/start', 1, 2),
      assistantLine(1, '第二条回复', 2),
      stepLine('step/end', 1, 2),
      { type: 'turn/end', seq: 0, time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    const delta = await mirrorDshSession(fakeCtx(), child, home, 'child-live-parity')
    expect(delta).toEqual({
      texts: ['第二条回复'],
      total: 7,
      sessionLogFile: 'session.jsonl',
      observedModel: 'deepseek-official/deepseek-v4-flash',
      usage: { inputTokens: 200, outputTokens: 20 },
    })
    expect(child.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(2)
    // Live-pushed and file-mirrored steps both hold their boundary pairs —
    // no duplicated step/start for the same (turn, step).
    expectStepBoundaries(child)
    expect(child.snapshotEvents().filter(event => event.type === 'step/start')).toHaveLength(2)
  })
})

describe('mirrorDshSession persistence', () => {
  it('persists a standalone child through a one-shot handle and a live one through the core sync', async () => {
    const home = tempHome()
    writeSubDshSession(home, 'child-persist', [
      { type: 'session', version: 0, id: 'x' },
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      userLine('任务', 'user'),
      stepLine('step/start', 1, 1),
      assistantLine(1, '回复'),
      stepLine('step/end', 1, 1),
      { type: 'turn/end', seq: 0, time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    const persistence = fakeSessionPersistence()
    const standaloneCtx = {
      get: (name: string) => name === 'sessionPersistence' ? persistence : undefined,
      logger: { warn: () => undefined },
    } as unknown as Context
    const standalone = childWithRounds('child-persist', 1)
    await mirrorDshSession(standaloneCtx, standalone, home, 'child-persist')
    // The mirror's events reached durable storage through the write handle.
    expect(persistence.stored.get('child-persist')).toHaveLength(standalone.snapshotEvents().length)

    // A session live in the sessions service persists through the core's
    // syncChildSession (the cached per-child write handle), never through the
    // one-shot handle flow — so the fake's store stays untouched here and the
    // sync receives exactly the mirrored session.
    const storedBefore = persistence.stored.get('child-persist')!.length
    const synced: string[] = []
    const liveCtx = {
      get: (name: string) => {
        if (name === 'sessions') return { get: () => ({}) }
        if (name === 'localAgent') {
          return {
            syncChildSession: async (session: { id: string }) => { synced.push(String(session.id)) },
          }
        }
        if (name === 'sessionPersistence') return persistence
        return undefined
      },
      logger: { warn: () => undefined },
    } as unknown as Context
    const live = childWithRounds('child-persist', 1)
    const delta = await mirrorDshSession(liveCtx, live, home, 'child-persist')
    expect(delta.texts.length).toBeGreaterThan(0)
    expect(live.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(1)
    expect(synced).toEqual(['child-persist'])
    expect(persistence.stored.get('child-persist')).toHaveLength(storedBefore)
  })
})

// --- T30d · the log filename is resolved, never assumed ------------------------

describe('sub-dsh session log generations', () => {
  it('reads host 0.1.5\u2019s session.v3.jsonl.zstd, the name that read as an empty session', async () => {
    const home = tempHome()
    // The real 0.1.5 directory: one versioned compressed log plus the lock
    // file the store keeps beside it.
    writeSubDshSession(home, 's-v3', twoRoundLines(), true, 'session.v3.jsonl.zstd')
    writeFileSync(join(home, 'sessions', 'wd_test', 's-v3', 'session.lock'), '')
    const read = await readSubDshEvents(home, 's-v3')
    expect(read?.events).toHaveLength(twoRoundLines().length - 1)
    expect(read?.log).toMatchObject({ filename: 'session.v3.jsonl.zstd', version: 3, compressed: true })
  })

  it('still reads the original unversioned log (the old host line)', async () => {
    const home = tempHome()
    writeSubDshSession(home, 's-v0', twoRoundLines(), true)
    const read = await readSubDshEvents(home, 's-v0')
    expect(read?.events).toHaveLength(twoRoundLines().length - 1)
    expect(read?.log).toMatchObject({ filename: 'session.jsonl.zstd', version: 0 })
  })

  it('reads a RAW versioned log too (compression: none)', async () => {
    const home = tempHome()
    writeSubDshSession(home, 's-raw', twoRoundLines(), false, 'session.v3.jsonl')
    const read = await readSubDshEvents(home, 's-raw')
    expect(read?.log).toMatchObject({ filename: 'session.v3.jsonl', version: 3, compressed: false })
  })

  it('picks the numerically highest generation when a directory holds several', async () => {
    const home = tempHome()
    // A store migrated in place keeps the older generations beside the new
    // one; the newest is the history, exactly as the backend selects it.
    writeSubDshSession(home, 's-many', twoRoundLines(), true)
    writeSubDshSession(home, 's-many', twoRoundLines(), true, 'session.v2.jsonl.zstd')
    writeSubDshSession(home, 's-many', twoRoundLines(), true, 'session.v10.jsonl.zstd')
    const read = await readSubDshEvents(home, 's-many')
    // v10 beats v2 numerically — a lexicographic pick would have said v2.
    expect(read?.log).toMatchObject({ filename: 'session.v10.jsonl.zstd', version: 10 })
  })

  it('the mirror reports the file it read on the delta', async () => {
    const home = tempHome()
    writeSubDshSession(home, 'child-v3', twoRoundLines(), true, 'session.v3.jsonl.zstd')
    const child = childWithRounds('child-v3', 1)
    const delta = await mirrorDshSession(fakeCtx(), child, home, 'child-v3')
    expect(delta.sessionLogFile).toBe('session.v3.jsonl.zstd')
    // …and the three read-backs a hardcoded name used to lose come back.
    expect(delta.observedModel).toBe('deepseek-official/deepseek-v4-flash')
    expect(delta.usage).toEqual({ inputTokens: 100, outputTokens: 10 })
  })

  it('a directory with only a lock file yields nothing — absence, not a guess', async () => {
    const home = tempHome()
    const dir = join(home, 'sessions', 'wd_test', 's-lock')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.lock'), '')
    await expect(readSubDshEvents(home, 's-lock')).resolves.toBeUndefined()
  })
})

describe('parseDshSessionLogFilename', () => {
  it('accepts the canonical names and reads their generation', () => {
    expect(parseDshSessionLogFilename('session.jsonl')).toEqual({ version: 0, compressed: false })
    expect(parseDshSessionLogFilename('session.jsonl.zstd')).toEqual({ version: 0, compressed: true })
    expect(parseDshSessionLogFilename('session.v3.jsonl.zstd')).toEqual({ version: 3, compressed: true })
    expect(parseDshSessionLogFilename('session.v12.jsonl')).toEqual({ version: 12, compressed: false })
  })

  it('refuses what the host itself calls noncanonical', () => {
    // The host's own rule, character for character: `.v0`, leading zeros and
    // uppercase are not generations, and a lock or temp file is not a log.
    for (const name of [
      'session.v0.jsonl', 'session.v01.jsonl', 'session.V3.jsonl', 'session.lock',
      'session.jsonl.tmp', 'session.v3.jsonl.zstd.tmp', 'sessions.jsonl', 'session.v3.json',
    ]) {
      expect(parseDshSessionLogFilename(name), name).toBeUndefined()
    }
  })
})
