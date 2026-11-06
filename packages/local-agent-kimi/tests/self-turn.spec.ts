/**
 * Reading kimi's wire for self-opened turns: the open-turn probe the live
 * driver waits on before a prompt, and the queued-prompt follow it runs when
 * an answerless end_turn collided with one.
 */

import { describe, expect, it } from 'vitest'
import { findOpenSelfTurn, isTaskOrigin, nextSelfTurn, readQueuedPrompt, readTurnAt, selfTurnPrompts, turnEndedStopReason, wireLineCount } from '../src/self-turn.ts'

const wire = (...rows: Record<string, unknown>[]): string => rows.map(row => JSON.stringify(row)).join('\n') + '\n'
const userPrompt = (text: string, time?: number) => ({ type: 'turn.prompt', input: [{ type: 'text', text }], origin: { kind: 'user' }, ...time === undefined ? {} : { time } })
const taskPrompt = (time?: number) => ({
  type: 'turn.prompt',
  input: [{ type: 'text', text: '<notification type="task.completed">' }],
  origin: { kind: 'task', taskId: 'bash-1', status: 'completed', notificationId: 'task:bash-1:completed' },
  ...time === undefined ? {} : { time },
})
const ended = (turnId: number, reason = 'completed') => ({ type: 'turn.ended', turnId, reason })
const text = (turnId: number, step: number, value: string) => ({
  type: 'context.append_loop_event',
  event: { type: 'content.part', turnId: String(turnId), step, stepUuid: `s-${turnId}-${step}`, part: { type: 'text', text: value } },
})

describe('findOpenSelfTurn', () => {
  it('finds a task-opened turn with no end yet', () => {
    expect(findOpenSelfTurn(wire(userPrompt('a'), ended(0), taskPrompt()))).toEqual({ line: 2, origin: 'task' })
  })

  it('accepts the legacy background_task origin', () => {
    const legacy = { ...taskPrompt(), origin: { kind: 'background_task' } }
    expect(findOpenSelfTurn(wire(legacy))?.origin).toBe('background_task')
  })

  it('an ended self turn, an open user turn, or an empty wire is not one', () => {
    expect(findOpenSelfTurn(wire(taskPrompt(), ended(0)))).toBeUndefined()
    expect(findOpenSelfTurn(wire(taskPrompt(), ended(0), userPrompt('a')))).toBeUndefined()
    expect(findOpenSelfTurn('')).toBeUndefined()
  })

  it('a prompt without an origin reads as a user prompt (older wires)', () => {
    expect(findOpenSelfTurn(wire({ type: 'turn.prompt', input: [] }))).toBeUndefined()
  })

  it('a self turn stamped before the process spawned is a dead process\'s leftover', () => {
    expect(findOpenSelfTurn(wire(taskPrompt(1_000)), 2_000)).toBeUndefined()
    expect(findOpenSelfTurn(wire(taskPrompt(3_000)), 2_000)?.origin).toBe('task')
  })

  it('anyOrigin also counts an open user turn', () => {
    expect(findOpenSelfTurn(wire(userPrompt('a')), undefined, true)).toEqual({ line: 0, origin: 'user' })
  })

  it('skips a partial last line', () => {
    expect(findOpenSelfTurn(wire(taskPrompt()) + '{"type":"turn.en')).toEqual({ line: 0, origin: 'task' })
  })
})

describe('readQueuedPrompt', () => {
  const before = wire(userPrompt('earlier'), ended(0))
  const from = wireLineCount(before)

  it('our prompt opening its turn first is a direct drive', () => {
    expect(readQueuedPrompt(before + wire(userPrompt('ours')), from, false)).toEqual({ phase: 'direct' })
  })

  it('nothing after the send is unknown', () => {
    expect(readQueuedPrompt(before, from, false)).toEqual({ phase: 'unknown' })
  })

  it('a self turn landing after the send means our prompt is queued behind it', () => {
    expect(readQueuedPrompt(before + wire(taskPrompt()), from, false)).toEqual({ phase: 'queued' })
  })

  it('a self turn open at the send means queued even before any new line', () => {
    expect(readQueuedPrompt(before, from, true)).toEqual({ phase: 'queued' })
  })

  it('follows the queued prompt\'s turn to its end and collects its answer per step', () => {
    const running = before + wire(taskPrompt(), text(1, 1, 'self'), ended(1), userPrompt('ours'), text(2, 1, '部署'), text(2, 1, '完成'))
    expect(readQueuedPrompt(running, from, false)).toEqual({ phase: 'running', line: 5, segments: ['部署完成'] })
    const done = running + wire(text(2, 2, '第二步'), ended(2))
    expect(readQueuedPrompt(done, from, false)).toEqual({ phase: 'ended', line: 5, reason: 'completed', segments: ['部署完成', '第二步'] })
  })

  it('the queued turn\'s end reason rides through', () => {
    const failed = before + wire(taskPrompt(), ended(1), userPrompt('ours'), ended(2, 'failed'))
    expect(readQueuedPrompt(failed, from, false)).toMatchObject({ phase: 'ended', reason: 'failed', segments: [] })
  })
})

describe('turnEndedStopReason', () => {
  it('maps kimi turn end reasons onto the stop contract', () => {
    expect(turnEndedStopReason('completed')).toBe('completed')
    expect(turnEndedStopReason('cancelled')).toBe('aborted')
    expect(turnEndedStopReason('failed')).toBe('error')
    expect(turnEndedStopReason('something-new')).toBe('error')
  })
})

describe('the self-turn observer\'s readers (member-self-started-rounds M4)', () => {
  it('selfTurnPrompts states a self prompt\'s task, status, notification id and time; user prompts are not listed', () => {
    const rows = wire(userPrompt('部署', 5), taskPrompt(10), { type: 'turn.prompt', input: [], origin: { kind: 'cron_job' } })
    expect(selfTurnPrompts(rows)).toEqual([
      { line: 1, origin: 'task', taskId: 'bash-1', taskStatus: 'completed', notificationId: 'task:bash-1:completed', time: 10 },
      { line: 2, origin: 'cron_job' },
    ])
    expect(selfTurnPrompts(rows, 2)).toEqual([{ line: 2, origin: 'cron_job' }])
    expect(isTaskOrigin('task')).toBe(true)
    expect(isTaskOrigin('background_task')).toBe(true)
    expect(isTaskOrigin('cron_job')).toBe(false)
  })

  it('nextSelfTurn: the first unhandled self prompt after the last user prompt, stamped by this process', () => {
    // One before the user prompt was a round's to wait for; one stamped before the spawn is a dead process's.
    const rows = wire(taskPrompt(100), ended(0), userPrompt('下一步', 110), ended(1), taskPrompt(50), ended(2), taskPrompt(120), ended(3), taskPrompt(130))
    expect(nextSelfTurn(rows, 100, new Set())?.line).toBe(6)
    expect(nextSelfTurn(rows, 100, new Set([6]))?.line).toBe(8)
    expect(nextSelfTurn(rows, 100, new Set([6, 8]))).toBeUndefined()
    // An unstamped prompt cannot be told from a dead process's: never offered.
    expect(nextSelfTurn(wire(userPrompt('a'), taskPrompt()), 0, new Set())).toBeUndefined()
  })

  it('readTurnAt follows one turn to its end, answer segments per model step; a next prompt without an end reads interrupted', () => {
    const open = wire(userPrompt('a'), ended(0), taskPrompt(1), text(1, 1, '部署'), text(1, 1, '完成'), text(1, 2, '已重启'))
    expect(readTurnAt(open, 2)).toEqual({ phase: 'running', segments: ['部署完成', '已重启'] })
    expect(readTurnAt(open + wire(ended(1, 'failed')), 2)).toEqual({ phase: 'ended', reason: 'failed', segments: ['部署完成', '已重启'] })
    expect(readTurnAt(open + wire(userPrompt('b')), 2)).toEqual({ phase: 'ended', reason: 'interrupted', segments: ['部署完成', '已重启'] })
  })
})
