import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { mirrorKimiSession, mirrorKimiSessionDelta } from '../src/session-mirror.ts'
import { expectValidReleasedLog } from './expect-valid-log.ts'
import { fakeSessionPersistence } from './fake-persistence.ts'

function tempHome(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/**
 * Every mirrored content event sits inside a step/start–step/end pair at its
 * own (turn, step) — the boundary the live conversation assembler needs to
 * materialize the step (without it the real-time view renders nothing), and
 * the atomic-triple shape the released-log reader requires (dense, strictly
 * sequential steps, one open at a time).
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

  it('never writes into a turn the log already closed — a backlog of earlier rounds is skipped', async () => {
    // In the wild (2e9c1ffb): the fold had failed for rounds, and after a
    // restart the offset restarted at 0; turn 1's never-folded steps landed as
    // "turn 1, step 32" inside turn 11 and the stored log became unreadable.
    const wire = [
      { type: 'turn.prompt', input: [{ type: 'text', text: '第一轮' }] },
      { type: 'context.append_loop_event', event: { type: 'tool.call', turnId: 0, step: 1, toolCallId: 'old-tool', toolCall: { name: 'Read', args: { path: 'a' } } } },
      { type: 'context.append_loop_event', event: { type: 'tool.result', turnId: 0, step: 1, toolCallId: 'old-tool', result: { output: 'a' } } },
      { type: 'context.append_loop_event', event: { type: 'step.end', turnId: 0, step: 1 } },
      { type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, step: 2, part: { type: 'text', text: '旧回复' } } },
      { type: 'context.append_loop_event', event: { type: 'step.end', turnId: 0, step: 2 } },
      { type: 'turn.prompt', input: [{ type: 'text', text: '继续' }] },
      { type: 'context.append_loop_event', event: { type: 'tool.call', turnId: 1, step: 1, toolCallId: 'new-tool', toolCall: { name: 'Read', args: { path: 'b' } } } },
      { type: 'context.append_loop_event', event: { type: 'tool.result', turnId: 1, step: 1, toolCallId: 'new-tool', result: { output: 'b' } } },
      { type: 'context.append_loop_event', event: { type: 'step.end', turnId: 1, step: 1 } },
      { type: 'context.append_loop_event', event: { type: 'content.part', turnId: 1, step: 2, part: { type: 'text', text: '新回复' } } },
      { type: 'context.append_loop_event', event: { type: 'step.end', turnId: 1, step: 2 } },
    ]
    const { home } = wireHome('closed-turn-backlog', wire)
    const child = Session.create(SessionId('closed-turn-backlog'))
    const ctx = new Context()
    ctx.provide('sessionPersistence', fakeSessionPersistence())
    // Turn 1 was shown live but never folded, and is closed; turn 2 is open.
    child.append('turn/start', { turn: 1 })
    child.append('user/message', createUserMessage({ content: [{ type: 'text', text: '第一轮' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    child.append('turn/end', { turn: 1, reason: { kind: 'interrupted' } })
    child.append('turn/start', { turn: 2 })
    child.append('user/message', createUserMessage({ content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    await mirrorKimiSessionDelta(ctx, child, home, 'closed-turn-backlog', 0, { turn: 2, settle: true })
    const written = child.snapshotEvents().filter(event => event.type === 'tool/call' || event.type === 'assistant/message')
    expect(written.every(event => (event.data as { turn: number }).turn === 2)).toBe(true)
    expect(child.snapshotEvents().filter(event => event.type === 'tool/call').map(event => event.data.callId)).toEqual(['new-tool'])
    expect(JSON.stringify(written.at(-1)!.data)).toContain('新回复')
    child.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    expectValidReleasedLog(child)
  })

  it('counts a boundary usage record once while a held unit keeps the offset still (3.2M = 10 × 320k)', async () => {
    // In the wild (fbc8ba18 turn 43): the round's only wire step never closed,
    // so every poll re-read the same window and re-carried its usage record.
    const wire = [
      { type: 'turn.prompt', input: [{ type: 'text', text: '继续' }] },
      { type: 'usage.record', usage: { inputOther: 320112, inputCacheRead: 11264, output: 10 } },
      { type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, step: 1, part: { type: 'think', think: '在想' } } },
    ]
    const { home } = wireHome('held-usage', wire)
    const child = Session.create(SessionId('held-usage'))
    const ctx = new Context()
    ctx.provide('sessionPersistence', fakeSessionPersistence())
    child.append('turn/start', { turn: 1 })
    let carried = 0
    let offset = 0
    for (let pass = 0; pass < 10; pass += 1) {
      const delta = await mirrorKimiSessionDelta(ctx, child, home, 'held-usage', offset, { turn: 1 })
      offset = delta.total
      carried += (delta.usageUnattached?.inputTokens ?? 0) + (delta.usageAttached === true ? delta.usage?.inputTokens ?? 0 : 0)
    }
    expect(carried).toBe(320112)
  })

  it('an empty stream reservation never strands a step gap (dense, strictly sequential log)', async () => {
    const { home } = wireHome('empty-reservation', fullWire)
    const child = Session.create(SessionId('empty-reservation'))
    const ctx = new Context()
    ctx.provide('sessionPersistence', fakeSessionPersistence())
    child.append('turn/start', { turn: 1 })
    // A stream reserved step 2 with NO content (a wire step that carried only
    // reasoning + a tool call): the driver's finalizeBefore releases it
    // without writing. The fold must then take the freed coordinate — writing
    // above it would strand a permanent gap (the prod lens corruption).
    const reserved: number[] = [2]
    await mirrorKimiSessionDelta(ctx, child, home, 'empty-reservation', 0, {
      streams: {
        reservedSteps: () => reserved,
        completeStreams: () => undefined,
        finalizeBefore: (_turn, step) => {
          // The driver's below-the-fold-step filter, with the empty release.
          if (step > 2) reserved.length = 0
        },
      },
    })
    const steps = child.snapshotEvents().filter(event => event.type === 'step/start')
      .map(event => (event.data as { step: number }).step)
    expect(steps.length).toBeGreaterThan(1)
    expect(steps).toEqual(Array.from({ length: steps.length }, (_, index) => index + 1))
    expectValidReleasedLog(child)
  })

  it('mirrors user prompts and folds assistant activity into messages', async () => {
    const { home } = wireHome('s1', fullWire)
    const child = Session.create(SessionId('child-1'))
    const ctx = new Context()
    const persistence = fakeSessionPersistence()
    const append = persistence.append
    ctx.provide('sessionPersistence', persistence)
    // The provider owns the turn boundary in production; the released-log
    // reader admits steps only inside an open turn.
    child.append('turn/start', { turn: 1 })

    await mirrorKimiSession(ctx, child, home)

    const events = child.snapshotEvents()
    expect(events.filter(event => event.type === 'user/message').map(event => event.data.content)).toEqual([
      [{ type: 'text', text: '建个文件' }],
    ])
    const assistant = events.filter(event => event.type === 'assistant/message')
    expect(assistant.map(event => event.data.message.content)).toEqual([
      [{ type: 'reasoning', text: 'Simple task.' }],
      [{ type: 'text', text: '我开始了。' }],
      // The native lifecycle: the call is advertised by an assistant message
      // (the released-log reader pairs call and result against it).
      [{ type: 'tool-call', id: 'kimi-tool-3', name: 'Write', arguments: '' }],
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
    // …and the whole log passes the released-log read path.
    expectValidReleasedLog(child)
    // the mirrored batch reaches persistence
    expect(append).toHaveBeenCalledWith(child.id, events)
  })

  it('holds a tool call whose result the wire has not recorded yet, folding the whole lifecycle when it lands', async () => {
    const pendingWire = [
      { type: 'turn.prompt', input: [{ type: 'text', text: '建个文件' }] },
      { type: 'context.append_loop_event', event: { type: 'tool.call', toolCall: { name: 'Write', args: { path: '/tmp/a.txt' } }, toolCallId: 'tc1' } },
    ]
    const { home, dir } = wireHome('s1', pendingWire)
    const child = Session.create(SessionId('child-late'))
    const ctx = new Context()
    ctx.provide('sessionPersistence', fakeSessionPersistence())
    child.append('turn/start', { turn: 1 })

    // Mid-round pass: the unresulted call cannot close its step (the
    // released-log contract resolves every advertised call before step/end),
    // so the fold HOLDS — the offset stops before the line and nothing of it
    // is mirrored yet.
    let total = await mirrorKimiSession(ctx, child, home, 's1')
    expect(total).toBe(1) // only the user prompt folded
    expect(child.snapshotEvents().filter(event => event.type === 'tool/call')).toHaveLength(0)

    // The result lands in the wire later (merging into the call's line in
    // place); the next pass folds the whole native lifecycle — advertisement,
    // call, result — in one atomic step.
    appendFileSync(
      join(dir, 'agents', 'main', 'wire.jsonl'),
      '\n' + JSON.stringify({ type: 'context.append_loop_event', event: { type: 'tool.result', toolCallId: 'tc1', result: { output: 'Wrote 10 bytes' } } }),
    )
    total = await mirrorKimiSession(ctx, child, home, 's1', total)
    expect(total).toBe(2)
    const calls = child.snapshotEvents().filter(event => event.type === 'tool/call')
    expect(calls).toHaveLength(1)
    const results = child.snapshotEvents().filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    expect(results[0]!.data.message).toMatchObject({
      role: 'tool',
      toolCallId: 'tc1',
      content: [{ type: 'text', text: 'Wrote 10 bytes' }],
      isError: false,
    })
    expect(results[0]!.sourceEventSeqs).toEqual([calls[0]!.seq])
    // The advertisement the released-log reader pairs the lifecycle against.
    const assistant = child.snapshotEvents().filter(event => event.type === 'assistant/message')
    expect(assistant).toHaveLength(1)
    expect(assistant[0]!.data.message.content).toEqual([{ type: 'tool-call', id: 'tc1', name: 'Write', arguments: '/tmp/a.txt' }])
    expectStepBoundaries(child)
    expectValidReleasedLog(child)
    // A third pass is a no-op (no duplicate fold).
    await mirrorKimiSession(ctx, child, home, 's1', total)
    expect(child.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
  })

  it('the settle pass folds a never-answered call with an interrupted placeholder result', async () => {
    const pendingWire = [
      { type: 'turn.prompt', input: [{ type: 'text', text: '建个文件' }] },
      { type: 'context.append_loop_event', event: { type: 'tool.call', toolCall: { name: 'Write' }, toolCallId: 'tc2' } },
    ]
    const { home } = wireHome('s2', pendingWire)
    const child = Session.create(SessionId('child-interrupted-tool'))
    const ctx = new Context()
    ctx.provide('sessionPersistence', fakeSessionPersistence())
    child.append('turn/start', { turn: 1 })

    // The round is over and the result never came: the settle pass folds the
    // call with the synthesized interrupted result instead of holding forever.
    const delta = await mirrorKimiSessionDelta(ctx, child, home, 's2', 0, { settle: true })
    expect(delta.total).toBe(2)
    const results = child.snapshotEvents().filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    expect(results[0]!.data.message).toMatchObject({ role: 'tool', toolCallId: 'tc2', isError: true })
    expect(JSON.stringify(results[0]!.data.message.content)).toContain('中断')
    expectStepBoundaries(child)
    expectValidReleasedLog(child)
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
    child.append('turn/start', { turn: 1 })
    await mirrorKimiSession(new Context(), child, home)

    const assistant = child.snapshotEvents().filter(event => event.type === 'assistant/message')
    expect(assistant).toHaveLength(2)
    // Only the last assistant message carries the usage; earlier steps omit it.
    expect(assistant[0]!.data.usage).toBeUndefined()
    expect(assistant[1]!.data.usage).toEqual({ inputTokens: 100, outputTokens: 25, cacheReadTokens: 40 })
    expectValidReleasedLog(child)
  })

  it('folds one wire step — think, reply and tool — into a single dsh step', async () => {
    // The wire's own LLM-request boundary: one step's parts share its number.
    const wire = [
      { type: 'turn.prompt', input: [{ type: 'text', text: '建个文件' }] },
      { type: 'llm.request', model: 'k3', thinkingEffort: 'high', maxTokens: 1_048_576 },
      { type: 'usage.record', model: 'kimi-code/k3', usage: { inputOther: 100, output: 25, inputCacheRead: 40, inputCacheCreation: 0 } },
      { type: 'context.append_loop_event', event: { type: 'step.begin', turnId: 0, step: 1 } },
      { type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, step: 1, part: { type: 'think', think: 'Simple task.' } } },
      { type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, step: 1, part: { type: 'text', text: '我开始了。' } } },
      { type: 'context.append_loop_event', event: { type: 'tool.call', turnId: 0, step: 1, toolCallId: 'call_1', toolCall: { name: 'Write' } } },
      { type: 'context.append_loop_event', event: { type: 'tool.result', toolCallId: 'call_1', result: { output: 'Wrote 10 bytes' } } },
      { type: 'context.append_loop_event', event: { type: 'step.end', turnId: 0, step: 1 } },
    ]
    const { home } = wireHome('step-fold', wire)
    const child = Session.create(SessionId('child-step-fold'))
    const ctx = new Context()
    ctx.provide('sessionPersistence', fakeSessionPersistence())
    child.append('turn/start', { turn: 1 })
    await mirrorKimiSession(ctx, child, home)

    const events = child.snapshotEvents()
    const assistant = events.filter(event => event.type === 'assistant/message')
    expect(assistant).toHaveLength(1)
    expect(assistant[0]!.data).toMatchObject({ turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 25, cacheReadTokens: 40 } })
    expect(assistant[0]!.data.message.content).toEqual([
      { type: 'reasoning', text: 'Simple task.' },
      { type: 'text', text: '我开始了。' },
      { type: 'tool-call', id: 'call_1', name: 'Write', arguments: '' },
    ])
    // The tool lifecycle rides the same step.
    expect(events.filter(event => event.type === 'tool/call').map(event => (event.data as { step?: number }).step)).toEqual([1])
    expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
    // The wire's llm.request declares the request config; the fold logs it as
    // a request/header in the host's own shape. The model follows the
    // usage.record's alias spelling — the same name the message source carries.
    const headers = events.filter(event => event.type === 'request/header')
    expect(headers).toHaveLength(1)
    expect(headers[0]!.data).toEqual({
      header: { config: { provider: 'kimi-cli', model: 'kimi-code/k3', reasoningEffort: 'high', maxTokens: 1_048_576 } },
      reason: 'initial',
    })
    expectStepBoundaries(child)
    expectValidReleasedLog(child)
  })

  it('holds an open wire step until the wire closes it, then folds the whole step', async () => {
    const wire = [
      { type: 'turn.prompt', input: [{ type: 'text', text: '建个文件' }] },
      { type: 'context.append_loop_event', event: { type: 'step.begin', turnId: 0, step: 1 } },
      { type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, step: 1, part: { type: 'think', think: 'Simple task.' } } },
    ]
    const { home, dir } = wireHome('step-hold', wire)
    const child = Session.create(SessionId('child-step-hold'))
    const ctx = new Context()
    ctx.provide('sessionPersistence', fakeSessionPersistence())
    child.append('turn/start', { turn: 1 })

    const first = await mirrorKimiSessionDelta(ctx, child, home, 'step-hold', 0)
    // The open step's think part waits for the wire step to close (the live
    // channel renders it meanwhile) — only the prompt folded.
    expect(first.total).toBe(1)
    expect(child.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(0)

    appendFileSync(join(dir, 'agents', 'main', 'wire.jsonl'), '\n' + [
      { type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, step: 1, part: { type: 'text', text: '任务完成。' } } },
      { type: 'context.append_loop_event', event: { type: 'step.end', turnId: 0, step: 1 } },
    ].map(line => JSON.stringify(line)).join('\n'))
    const second = await mirrorKimiSessionDelta(ctx, child, home, 'step-hold', first.total)
    expect(second.total).toBe(3)
    const assistant = child.snapshotEvents().filter(event => event.type === 'assistant/message')
    expect(assistant).toHaveLength(1)
    expect(assistant[0]!.data.message.content).toEqual([
      { type: 'reasoning', text: 'Simple task.' },
      { type: 'text', text: '任务完成。' },
    ])
    expectValidReleasedLog(child)
  })

  it('holds a wire-step group whose tool call lacks its result — the step folds whole, or interrupted at settle', async () => {
    const wire = [
      { type: 'turn.prompt', input: [{ type: 'text', text: '建个文件' }] },
      { type: 'context.append_loop_event', event: { type: 'step.begin', turnId: 0, step: 1 } },
      { type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, step: 1, part: { type: 'think', think: 'Simple task.' } } },
      { type: 'context.append_loop_event', event: { type: 'tool.call', turnId: 0, step: 1, toolCallId: 'call_1', toolCall: { name: 'Write' } } },
      { type: 'context.append_loop_event', event: { type: 'step.end', turnId: 0, step: 1 } },
    ]
    const { home, dir } = wireHome('step-tool-hold', wire)
    const child = Session.create(SessionId('child-step-tool-hold'))
    const ctx = new Context()
    ctx.provide('sessionPersistence', fakeSessionPersistence())
    child.append('turn/start', { turn: 1 })

    // The step is closed but its tool result is not in — nothing of it folds.
    const first = await mirrorKimiSessionDelta(ctx, child, home, 'step-tool-hold', 0)
    expect(first.total).toBe(1)
    expect(child.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(0)

    // The result merges into the call's line in place; the next pass folds
    // the whole step.
    appendFileSync(join(dir, 'agents', 'main', 'wire.jsonl'), '\n' + JSON.stringify(
      { type: 'context.append_loop_event', event: { type: 'tool.result', toolCallId: 'call_1', result: { output: 'Wrote 10 bytes' } } },
    ))
    const second = await mirrorKimiSessionDelta(ctx, child, home, 'step-tool-hold', first.total)
    expect(second.total).toBe(3)
    const assistant = child.snapshotEvents().filter(event => event.type === 'assistant/message')
    expect(assistant).toHaveLength(1)
    expect(assistant[0]!.data.message.content).toEqual([
      { type: 'reasoning', text: 'Simple task.' },
      { type: 'tool-call', id: 'call_1', name: 'Write', arguments: '' },
    ])
    expect(child.snapshotEvents().filter(event => event.type === 'tool/result')
      .map(event => event.data.message.isError)).toEqual([false])
    expectValidReleasedLog(child)
  })

  it('settle folds a closed-incomplete group — an unresulted call resolves interrupted', async () => {
    const wire = [
      { type: 'turn.prompt', input: [{ type: 'text', text: '建个文件' }] },
      { type: 'context.append_loop_event', event: { type: 'step.begin', turnId: 0, step: 1 } },
      { type: 'context.append_loop_event', event: { type: 'content.part', turnId: 0, step: 1, part: { type: 'think', think: 'Simple task.' } } },
      { type: 'context.append_loop_event', event: { type: 'tool.call', turnId: 0, step: 1, toolCallId: 'call_1', toolCall: { name: 'Write' } } },
      { type: 'context.append_loop_event', event: { type: 'step.end', turnId: 0, step: 1 } },
    ]
    const { home } = wireHome('step-settle', wire)
    const child = Session.create(SessionId('child-step-settle'))
    const ctx = new Context()
    ctx.provide('sessionPersistence', fakeSessionPersistence())
    child.append('turn/start', { turn: 1 })

    await mirrorKimiSessionDelta(ctx, child, home, 'step-settle', 0, { settle: true })
    const assistant = child.snapshotEvents().filter(event => event.type === 'assistant/message')
    expect(assistant).toHaveLength(1)
    expect(assistant[0]!.data.message.content).toEqual([
      { type: 'reasoning', text: 'Simple task.' },
      { type: 'tool-call', id: 'call_1', name: 'Write', arguments: '' },
    ])
    expect(child.snapshotEvents().filter(event => event.type === 'tool/result')
      .map(event => event.data.message.isError)).toEqual([true])
    expectValidReleasedLog(child)
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
    // ONLY the delta, so no round-1 message is duplicated. The provider
    // closes round 1's turn before opening the next one (production order).
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
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
    // The resumed round's usage attaches PER WIRE STEP: one record per LLM
    // request rides its own step's message (the host session's own shape).
    const round2Usage = assistant
      .map(event => event.data as { turn?: number; usage?: { inputTokens?: number } })
      .filter(event => event.turn === 2 && event.usage !== undefined)
    expect(round2Usage.map(event => event.usage?.inputTokens)).toEqual([15817, 8360, 1160, 5698, 5268])
    // Grouped fold: one wire step's reasoning, reply and tool calls share ONE
    // dsh step's message (round 2 step 1).
    const round2First = assistant
      .map(event => event.data as { turn?: number; message?: { content?: { type: string }[] } })
      .filter(event => event.turn === 2)[0]
    expect(round2First?.message?.content.map(block => block.type)).toEqual(['reasoning', 'text', 'tool-call', 'tool-call'])
    expectValidReleasedLog(child)
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
