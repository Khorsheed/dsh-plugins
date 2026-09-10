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
function assistantLine(turn: number, text: string): object {
  return {
    type: 'assistant/message',
    seq: 0,
    time: 1,
    data: {
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'reasoning', text: `thinking ${turn}` }, { type: 'text', text }],
        source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      }),
      usage: { inputTokens: 100 * turn, outputTokens: 10 * turn },
    },
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
    assistantLine(1, '第一轮回答'),
    { type: 'turn/end', seq: 0, time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 2 } },
    userLine('第二轮任务', 'user'),
    assistantLine(2, '第二轮回答'),
    { type: 'turn/end', seq: 0, time: 1, data: { turn: 2, reason: { kind: 'completed' } } },
  ]
}

function writeSubDshSession(homeDir: string, id: string, lines: object[], compressed = false): void {
  const dir = join(homeDir, 'sessions', 'wd_test', id)
  mkdirSync(dir, { recursive: true })
  if (compressed) {
    // Persist like the real store: one zstd frame per flush batch, so the
    // reader must handle multi-frame concatenation (single-shot decompression
    // would stop at the first frame — the bug this fixture guards).
    const first = lines.slice(0, 3).map(line => JSON.stringify(line)).join('\n') + '\n'
    const rest = lines.slice(3).map(line => JSON.stringify(line)).join('\n') + '\n'
    writeFileSync(join(dir, 'session.jsonl.zstd'), Buffer.concat([zstdCompressSync(first), zstdCompressSync(rest)]))
    return
  }
  const text = lines.map(line => JSON.stringify(line)).join('\n') + '\n'
  writeFileSync(join(dir, 'session.jsonl'), text)
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
    await expect(readSubDshEvents(home, 's1')).resolves.toHaveLength(twoRoundLines().length - 1)
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
      assistantLine(1, '做完了'),
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
      call(3, 'Bash', 'c1'),
      call(4, 'Bash', 'c2'),
      call(5, 'Read', 'c3'),
      assistantLine(1, '做完了'),
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
  })

  it('a settle pass a live poll already drained still reports the round count', async () => {
    const home = tempHome()
    writeSubDshSession(home, 'child-tool-drained', [
      { type: 'session', version: 0, id: 'x' },
      { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
      userLine('干活', 'user'),
      { type: 'tool/call', seq: 3, time: 3, data: { turn: 1, step: 1, callId: 'c1', name: 'Bash', arguments: '{}' } },
      assistantLine(1, '做完了'),
      { type: 'turn/end', seq: 5, time: 5, data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    const child = childWithRounds('child-tool-drained', 1)
    const first = await mirrorDshSession(fakeCtx(), child, home, 'child-tool-drained')
    expect(first.toolCalls).toEqual({ count: 1, byName: { Bash: 1 } })
    // Second pass: the prefix skip leaves nothing new to mirror, but the
    // accounting is read off the round window, so it still comes back.
    const second = await mirrorDshSession(fakeCtx(), child, home, 'child-tool-drained')
    expect(second.texts).toEqual([])
    expect(second.toolCalls).toEqual({ count: 1, byName: { Bash: 1 } })
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
      assistantLine(1, '第一条回复'),
    ])
    const child = childWithRounds('child-4', 1)
    const first = await mirrorDshSession(fakeCtx(), child, home, 'child-4')
    expect(first).toEqual({
      texts: ['第一轮任务', 'thinking 1第一条回复'],
      total: 2,
      // The round's own span names the model and sums the assistant usage.
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
      assistantLine(1, '第一条回复'),
      assistantLine(1, '第二条回复'),
      { type: 'turn/end', seq: 0, time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    const second = await mirrorDshSession(fakeCtx(), child, home, 'child-4')
    expect(second).toEqual({
      texts: ['thinking 1第二条回复'],
      total: 3,
      observedModel: 'deepseek-official/deepseek-v4-flash',
      usage: { inputTokens: 200, outputTokens: 20 },
    })
    const third = await mirrorDshSession(fakeCtx(), child, home, 'child-4')
    expect(third).toEqual({
      texts: [],
      total: 3,
      observedModel: 'deepseek-official/deepseek-v4-flash',
      usage: { inputTokens: 200, outputTokens: 20 },
    })

    const assistant = child.snapshotEvents().filter(event => event.type === 'assistant/message')
    expect(assistant).toHaveLength(2)
    const texts = assistant.map(event => JSON.stringify(event.data))
    expect(new Set(texts).size).toBe(texts.length)
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
      assistantLine(1, '回复'),
    ])
    const child = childWithRounds('child-todo', 1)

    const first = await mirrorDshSession(fakeCtx(), child, home, 'child-todo')
    // The snapshot crosses verbatim (counted in the total, but not a text delta).
    const writes = child.snapshotEvents().filter(event => event.type === 'todo/write')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.data).toEqual(todos1)
    expect(first.total).toBe(3)
    expect(first.texts).toEqual(['任务', 'thinking 1回复'])

    // A repeat pass over an unchanged log is a pure no-op — no duplicate
    // identical snapshot lands in the child log.
    const repeat = await mirrorDshSession(fakeCtx(), child, home, 'child-todo')
    expect(repeat).toEqual({
      texts: [],
      total: 3,
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
      assistantLine(1, '回复'),
      { type: 'todo/write', seq: 0, time: 1, data: todos2 },
      { type: 'turn/end', seq: 0, time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    const second = await mirrorDshSession(fakeCtx(), child, home, 'child-todo')
    expect(second).toEqual({
      texts: [],
      total: 4,
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
    // Assistant messages cross verbatim, usage included, same as the span loop.
    const text = mirrorDshLiveEvent(child, assistantLine(1, '实时回复') as never)
    expect(text).toBe('thinking 1实时回复')
    const assistant = child.snapshotEvents().find(event => event.type === 'assistant/message')
    expect(assistant?.data).toMatchObject({ usage: { inputTokens: 100, outputTokens: 10 } })
    // Turn boundaries never cross (the parent's own stay authoritative).
    expect(mirrorDshLiveEvent(child, { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } } as never)).toBeUndefined()
    expect(mirrorDshLiveEvent(child, { type: 'turn/end', seq: 0, time: 1, data: { turn: 1, reason: { kind: 'completed' } } } as never)).toBeUndefined()
    expect(child.snapshotEvents().filter(event => event.type === 'turn/start' || event.type === 'turn/end')).toHaveLength(0)
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
    // The live transport mirrored the task and the first reply event-by-event.
    mirrorDshLiveEvent(child, userLine('第一轮任务', 'user') as never)
    mirrorDshLiveEvent(child, assistantLine(1, '第一条回复') as never)
    // The settle reconciliation pass over the on-disk log (which additionally
    // holds a second reply the wire had not pushed) mirrors exactly the delta.
    writeSubDshSession(home, 'child-live-parity', [
      { type: 'session', version: 0, id: 'x' },
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      userLine('第一轮任务', 'user'),
      assistantLine(1, '第一条回复'),
      assistantLine(1, '第二条回复'),
      { type: 'turn/end', seq: 0, time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
    ])
    const delta = await mirrorDshSession(fakeCtx(), child, home, 'child-live-parity')
    expect(delta).toEqual({
      texts: ['thinking 1第二条回复'],
      total: 3,
      observedModel: 'deepseek-official/deepseek-v4-flash',
      usage: { inputTokens: 200, outputTokens: 20 },
    })
    expect(child.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(2)
  })
})

describe('mirrorDshSession persistence', () => {
  it('persists only a standalone child session (a live session’s write-behind owns durability)', async () => {
    const home = tempHome()
    writeSubDshSession(home, 'child-persist', [
      { type: 'session', version: 0, id: 'x' },
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      userLine('任务', 'user'),
      assistantLine(1, '回复'),
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

    // A session live in the sessions service must NOT get the redundant
    // persist: its own write handle routing is durable, and re-appending
    // stored events would violate the contiguous-seq contract.
    const storedBefore = persistence.stored.get('child-persist')!.length
    const liveCtx = {
      get: (name: string) => {
        if (name === 'sessions') return { get: () => ({}) }
        if (name === 'sessionPersistence') return persistence
        return undefined
      },
      logger: { warn: () => undefined },
    } as unknown as Context
    const live = childWithRounds('child-persist', 1)
    const delta = await mirrorDshSession(liveCtx, live, home, 'child-persist')
    expect(delta.texts.length).toBeGreaterThan(0)
    expect(live.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(1)
    expect(persistence.stored.get('child-persist')).toHaveLength(storedBefore)
  })
})
