import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { mirrorKimiSession, mirrorKimiSessionDelta } from '../src/session-mirror.ts'
import { fakeSessionPersistence } from './fake-persistence.ts'

function tempHome(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/**
 * Every mirrored content event sits inside a step/start–step/end pair at its
 * own (turn, step) — the boundary the live conversation assembler needs to
 * materialize the step (without it the real-time view renders nothing). The
 * one sanctioned exception is a backfilled late tool/result: it reuses its
 * call's already-closed coordinates BARE, because a second step/start for the
 * same context throws in the live assembler.
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
    expect(
      at.some(boundary => boundary.type === 'step/start' && boundary.seq < event.seq),
      `step/start for ${event.type} at ${turn}:${step}`,
    ).toBe(true)
    const closedBefore = at.some(boundary => boundary.type === 'step/end' && boundary.seq < event.seq)
    if (closedBefore && event.type === 'tool/result') continue // bare backfill, by design
    expect(
      at.some(boundary => boundary.type === 'step/end' && boundary.seq > event.seq),
      `step/end for ${event.type} at ${turn}:${step}`,
    ).toBe(true)
  }
}

/** A kimi scoped home with one session directory carrying a wire log. */
function wireHome(sessionId: string, wireLines: unknown[]): { home: string; dir: string } {
  const home = tempHome('kimi-mirror-')
  const dir = join(home, 'sessions', 'wd_tmp_abc', `session_${sessionId}`)
  mkdirSync(join(dir, 'agents', 'main'), { recursive: true })
  writeFileSync(join(dir, 'agents', 'main', 'wire.jsonl'), wireLines.map(line => JSON.stringify(line)).join('\n'))
  return { home, dir }
}

const fullWire = [
  { type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: '建个文件' }] } },
  { type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'think', think: 'Simple task.' } } },
  { type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: '我开始了。' } } },
  { type: 'context.append_loop_event', event: { type: 'tool.call', toolCall: { name: 'Write' } } },
  { type: 'context.append_loop_event', event: { type: 'tool.result', result: { output: 'Wrote 10 bytes' } } },
  { type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: '任务完成。' } } },
]

describe('session-mirror', () => {
  it('attributes each replayed answer to its own native model and never carries a previous turn into unknown output', async () => {
    const wire = ['kimi-code/k3', 'kimi-code/kimi-for-coding', undefined].flatMap((model, index) => [
      { type: 'turn.prompt', input: [{ type: 'text', text: `prompt ${index}` }] },
      ...model === undefined ? [] : [{ type: 'usage.record', model }],
      { type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: `answer ${index}` } } },
    ])
    const { home } = wireHome('model-switch', wire)
    const child = Session.create(SessionId('model-switch'))
    const ctx = new Context()
    ctx.provide('sessionPersistence', fakeSessionPersistence())
    await mirrorKimiSession(ctx, child, home)
    expect(child.snapshotEvents().filter(event => event.type === 'assistant/message').map(event => event.data.message.source)).toEqual([
      { kind: 'model', provider: 'kimi-cli', model: 'kimi-code/k3' },
      { kind: 'model', provider: 'kimi-cli', model: 'kimi-code/kimi-for-coding' },
      { kind: 'model', provider: 'kimi-cli', model: 'unobserved' },
    ])
    const latest = await mirrorKimiSessionDelta(ctx, child, home, 'model-switch', 6, { turn: 3 })
    expect(latest.model).toBeUndefined()
  })

  it('mirrors user prompts and folds assistant activity into messages', async () => {
    const { home } = wireHome('s1', fullWire)
    const child = Session.create(SessionId('child-1'))
    const ctx = new Context()
    const persistence = fakeSessionPersistence()
    const append = persistence.append
    ctx.provide('sessionPersistence', persistence)

    await mirrorKimiSession(ctx, child, home)

    const events = child.snapshotEvents()
    expect(events.filter(event => event.type === 'user/message').map(event => event.data.content)).toEqual([
      [{ type: 'text', text: '建个文件' }],
    ])
    const assistant = events.filter(event => event.type === 'assistant/message')
    expect(assistant.map(event => event.data.message.content)).toEqual([
      [{ type: 'reasoning', text: 'Simple task.' }],
      [{ type: 'text', text: '我开始了。' }],
      [{ type: 'text', text: '任务完成。' }],
    ])
    // Tool activity mirrors as a native tool/call + tool/result pair (the
    // wire line carried no ids, so the callId is the position fallback).
    const calls = events.filter(event => event.type === 'tool/call')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.data).toMatchObject({ callId: 'kimi-tool-3', name: 'Write', arguments: '' })
    const results = events.filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    // rc.1's tool-result message is the native tool role: the call id and the
    // error flag sit at the message top level, the content holds the raw
    // result blocks (the pre-V4 shape wrapped everything in one content
    // block — the mirror reads both, see session-mirror.ts).
    expect(results[0]!.data.message).toMatchObject({
      role: 'tool',
      toolCallId: 'kimi-tool-3',
      content: [{ type: 'text', text: 'Wrote 10 bytes' }],
      isError: false,
    })
    expect(results[0]!.sourceEventSeqs).toEqual([calls[0]!.seq])
    // assistant events attribute the kimi route
    expect(assistant[0]!.data.message.source).toEqual({ kind: 'model', provider: 'kimi-cli', model: 'unobserved' })
    // every folded step carries its step/start–step/end boundary pair
    expectStepBoundaries(child)
    // the mirrored batch reaches persistence
    expect(append).toHaveBeenCalledWith(child.id, events)
  })

  it('backfills a tool result that lands after its call was mirrored', async () => {
    const pendingWire = [
      { type: 'turn.prompt', input: [{ type: 'text', text: '建个文件' }] },
      { type: 'context.append_loop_event', event: { type: 'tool.call', toolCall: { name: 'Write', args: { path: '/tmp/a.txt' } }, toolCallId: 'tc1' } },
    ]
    const { home, dir } = wireHome('s1', pendingWire)
    const child = Session.create(SessionId('child-late'))
    const ctx = new Context()
    ctx.provide('sessionPersistence', fakeSessionPersistence())

    let total = await mirrorKimiSession(ctx, child, home, 's1')
    expect(child.snapshotEvents().filter(event => event.type === 'tool/call')).toHaveLength(1)
    expect(child.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(0)

    // The result lands in the wire later; the next delta pass pairs it with
    // the already-mirrored call instead of dropping or duplicating it.
    appendFileSync(
      join(dir, 'agents', 'main', 'wire.jsonl'),
      '\n' + JSON.stringify({ type: 'context.append_loop_event', event: { type: 'tool.result', toolCallId: 'tc1', result: { output: 'Wrote 10 bytes' } } }),
    )
    total = await mirrorKimiSession(ctx, child, home, 's1', total)
    const results = child.snapshotEvents().filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    expect(results[0]!.data.message).toMatchObject({
      role: 'tool',
      toolCallId: 'tc1',
      content: [{ type: 'text', text: 'Wrote 10 bytes' }],
    })
    // The backfilled result reuses its call's coordinates BARE — no second
    // step/start at the same (turn, step), which the live assembler rejects
    // as a duplicate start match.
    const starts = child.snapshotEvents().filter(event => event.type === 'step/start')
    expect(starts).toHaveLength(1)
    expectStepBoundaries(child)
    // A third pass is a no-op (no duplicate result).
    await mirrorKimiSession(ctx, child, home, 's1', total)
    expect(child.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
  })

  it('attaches the wire usage record to the final assistant message', async () => {
    const wire = [
      { type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: '建个文件' }] } },
      { type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: '我开始了。' } } },
      { type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: '任务完成。' } } },
      { type: 'usage.record', model: 'kimi-code/k3', usage: { inputOther: 100, output: 25, inputCacheRead: 40, inputCacheCreation: 0 }, usageScope: 'turn', time: 1 },
    ]
    const { home } = wireHome('usage', wire)
    const child = Session.create(SessionId('child-usage'))
    await mirrorKimiSession(new Context(), child, home)

    const assistant = child.snapshotEvents().filter(event => event.type === 'assistant/message')
    expect(assistant).toHaveLength(2)
    // Only the last assistant message carries the usage; earlier steps omit it.
    expect(assistant[0]!.data.usage).toBeUndefined()
    expect(assistant[1]!.data.usage).toEqual({ inputTokens: 100, outputTokens: 25, cacheReadTokens: 40 })
  })

  it('mirrors the most recent session across workspaces', async () => {
    const home = tempHome('kimi-mirror-newest-')
    const olderDir = join(home, 'sessions', 'wd_old', 'session_s1')
    mkdirSync(join(olderDir, 'agents', 'main'), { recursive: true })
    writeFileSync(join(olderDir, 'agents', 'main', 'wire.jsonl'), JSON.stringify(
      { type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: '旧任务' }] } },
    ))
    const newerDir = join(home, 'sessions', 'wd_new', 'session_s2')
    mkdirSync(join(newerDir, 'agents', 'main'), { recursive: true })
    writeFileSync(join(newerDir, 'agents', 'main', 'wire.jsonl'), JSON.stringify(
      { type: 'context.append_message', message: { role: 'user', content: [{ type: 'text', text: '新任务' }] } },
    ))

    const child = Session.create(SessionId('child-2'))
    await mirrorKimiSession(new Context(), child, home)

    const user = child.snapshotEvents().find(event => event.type === 'user/message')
    expect(user?.data.content).toEqual([{ type: 'text', text: '新任务' }])
  })

  it('mirrors a named session id instead of the newest', async () => {
    const { home } = wireHome('named', fullWire)
    const child = Session.create(SessionId('child-3'))
    await mirrorKimiSession(new Context(), child, home, 'named')

    const user = child.snapshotEvents().find(event => event.type === 'user/message')
    expect(user?.data.content).toEqual([{ type: 'text', text: '建个文件' }])
  })

  it('resolves a session id that already carries the ACP directory prefix (never double-prefixes)', async () => {
    const { home } = wireHome('named', fullWire)
    const child = Session.create(SessionId('child-3p'))
    await mirrorKimiSession(new Context(), child, home, 'session_named')

    const user = child.snapshotEvents().find(event => event.type === 'user/message')
    expect(user?.data.content).toEqual([{ type: 'text', text: '建个文件' }])
  })

  it('skips a wire user line the turn already carries (round-start append), but folds a different prompt text', async () => {
    const { home } = wireHome('dedupe', fullWire)
    const child = Session.create(SessionId('child-dedupe'))
    // The live driver's round-start append: same turn, same text.
    child.append('turn/start', { turn: 1 })
    child.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '建个文件' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await mirrorKimiSession(new Context(), child, home, 'dedupe')
    expect(child.snapshotEvents().filter(event => event.type === 'user/message')).toHaveLength(1)

    // A pre-existing message with DIFFERENT text does not suppress the fold.
    const child2 = Session.create(SessionId('child-dedupe2'))
    child2.append('turn/start', { turn: 1 })
    child2.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '别的问题' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await mirrorKimiSession(new Context(), child2, home, 'dedupe')
    expect(child2.snapshotEvents().filter(event => event.type === 'user/message')).toHaveLength(2)
  })

  it('keeps looking for a named session past earlier empty workspaces', async () => {
    // The named session lives in the SECOND workspace; the first contains a
    // directory for another session id, whose absent wire log reads as an
    // empty transcript rather than throwing. The mirror must not stop there.
    const home = tempHome('kimi-mirror-later-')
    const emptyDir = join(home, 'sessions', 'wd_first', 'session_other')
    mkdirSync(join(emptyDir, 'agents', 'main'), { recursive: true })
    const wireHome_ = wireHome('named-later', fullWire)
    // wireHome creates its own root; reuse its session under this home instead.
    const { dir } = wireHome_
    const target = join(home, 'sessions', 'wd_second', 'session_named-later')
    mkdirSync(join(target, 'agents', 'main'), { recursive: true })
    writeFileSync(join(target, 'agents', 'main', 'wire.jsonl'), readFileSync(join(dir, 'agents', 'main', 'wire.jsonl')))

    const child = Session.create(SessionId('child-6'))
    await mirrorKimiSession(new Context(), child, home, 'named-later')

    const user = child.snapshotEvents().find(event => event.type === 'user/message')
    expect(user?.data.content).toEqual([{ type: 'text', text: '建个文件' }])
  })

  it('leaves the session untouched when no kimi session exists', async () => {
    const home = tempHome('kimi-mirror-empty-')
    const child = Session.create(SessionId('child-4'))
    await mirrorKimiSession(new Context(), child, home)
    expect(child.snapshotEvents()).toEqual([])
  })

  it('leaves the session untouched when the newest session has no transcript', async () => {
    const home = tempHome('kimi-mirror-notranscript-')
    const dir = join(home, 'sessions', 'wd_x', 'session_s1')
    mkdirSync(join(dir, 'agents', 'main'), { recursive: true })
    const child = Session.create(SessionId('child-5'))
    await mirrorKimiSession(new Context(), child, home)
    expect(child.snapshotEvents()).toEqual([])
  })
})

describe('session-mirror resume deltas', () => {
  it('mirrors two resume rounds without duplicating earlier messages (real fixture)', async () => {
    const fixtureWire = readFileSync(
      fileURLToPath(new URL('./fixtures/two-round-resume.wire.jsonl', import.meta.url)),
      'utf8',
    )
    // The fixture is the FULL two-round wire. Round 1's wire is everything up
    // to the second turn's user prompt ('继续上一个话题'); a real fresh round
    // saw only that prefix, then the resume round appended the rest.
    const round2PromptIndex = fixtureWire.split('\n').findIndex(line => line.includes('继续上一个话题'))
    const round1Wire = fixtureWire.split('\n').slice(0, round2PromptIndex).join('\n')

    const home = tempHome('kimi-mirror-resume-')
    const dir = join(home, 'sessions', 'wd_tmp_abc', 'session_resume')
    mkdirSync(join(dir, 'agents', 'main'), { recursive: true })
    const wirePath = join(dir, 'agents', 'main', 'wire.jsonl')

    const child = Session.create(SessionId('child-resume'))
    const ctx = new Context()
    const persistence = fakeSessionPersistence()
    const append = persistence.append
    ctx.provide('sessionPersistence', persistence)
    // Round 1 mirrors what the wire contained then (turn/start already opened
    // by the provider, so the base turn is 1).
    child.append('turn/start', { turn: 1 })
    writeFileSync(wirePath, round1Wire)
    const round1Total = await mirrorKimiSession(ctx, child, home, 'resume', 0)
    const afterRound1 = child.snapshotEvents().length

    // Round 2 (resume): the full wire is now on disk; the offset must slice
    // ONLY the delta, so no round-1 message is duplicated.
    child.append('turn/start', { turn: 2 })
    writeFileSync(wirePath, fixtureWire)
    const round2Total = await mirrorKimiSession(ctx, child, home, 'resume', round1Total)
    const afterRound2 = child.snapshotEvents().length

    expect(round1Total).toBeGreaterThan(0)
    expect(round2Total).toBeGreaterThan(round1Total)
    // The delta appended new events; nothing from round 1 was re-mirrored.
    expect(afterRound2).toBeGreaterThan(afterRound1)

    const assistant = child.snapshotEvents().filter(event => event.type === 'assistant/message')
    const texts = assistant.map(event => JSON.stringify(event.data.message.content))
    expect(new Set(texts).size).toBe(texts.length)

    const userEvents = child.snapshotEvents().filter(event => event.type === 'user/message')
    // Two rounds, two real user prompts (the system-reminders are filtered).
    expect(userEvents).toHaveLength(2)
    // Rounds carry distinct dsh turn numbers on their assistant messages.
    const turns = new Set(assistant.map(event => (event.data as { turn?: number }).turn))
    expect(turns.has(1)).toBe(true)
    expect(turns.has(2)).toBe(true)
    // The resumed round's usage is the SUM of its own per-request records,
    // attached to its final assistant message.
    const round2Usage = assistant
      .map(event => event.data as { turn?: number; usage?: { inputTokens?: number } })
      .filter(event => event.turn === 2 && event.usage !== undefined)
    expect(round2Usage.length).toBe(1)
    expect(round2Usage[0]!.usage?.inputTokens).toBe(15817 + 8360 + 1160 + 5698 + 5268)
  })

  it('tracks the mirror offset independently of a delegation record', async () => {
    // Regression for the double-mirror: the offset used to live inside the
    // delegation record, which is only written when the stderr hint parses.
    // The mirror bookkeeping must survive without a record.
    const { home } = wireHome('s1', fullWire)
    const child = Session.create(SessionId('child-offset'))
    const ctx = new Context()
    const persistence = fakeSessionPersistence()
    const append = persistence.append
    ctx.provide('sessionPersistence', persistence)

    const total = await mirrorKimiSession(ctx, child, home, 's1', 0)
    expect(total).toBeGreaterThan(0)
    // Mirroring again from the recorded offset appends nothing new.
    const eventsBefore = child.snapshotEvents().length
    const totalAgain = await mirrorKimiSession(ctx, child, home, 's1', total)
    expect(totalAgain).toBe(total)
    expect(child.snapshotEvents().length).toBe(eventsBefore)
  })
})
