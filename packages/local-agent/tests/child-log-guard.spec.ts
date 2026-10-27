/**
 * The member child-log write guard against every shape that corrupted a
 * stored member log in the wild (10-24 … 10-27): each spec writes the bad
 * sequence through the guarded session and asserts the log still passes the
 * host's released-log check, with nothing silently lost.
 */
import { describe, expect, it } from 'vitest'
import { KNOWN_SESSION_EVENT_TYPES, Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { assertReleasedV4Relationships } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { guardChildLog, type QuarantineEntry } from '../src/child-log-guard.ts'

const validate = (session: Session, events: readonly SessionEvent[]): string | undefined => {
  try {
    assertReleasedV4Relationships({
      header: { version: 4, id: String(session.id), createdAt: 0, isSeeded: false, delegationDepth: 1 },
      inheritedEventCount: 0,
      events,
    } as unknown as Parameters<typeof assertReleasedV4Relationships>[0], KNOWN_SESSION_EVENT_TYPES)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function guarded(id: string): { child: Session; diverted: QuarantineEntry[] } {
  const child = Session.create(SessionId(id))
  const diverted: QuarantineEntry[] = []
  guardChildLog(child, { quarantine: entry => diverted.push(entry), validate })
  return { child, diverted }
}

const assistant = (blocks: unknown[]) => ({ role: 'assistant', content: blocks, source: { kind: 'model', provider: 'kimi-cli', model: 'k' } })
const call = (id: string) => ({ type: 'tool-call', id, name: 'Read', arguments: '{}' })
const result = (id: string, text = 'ok') => ({ role: 'tool', toolCallId: id, content: [{ type: 'text', text }], source: { kind: 'tool', callId: id } })
const steps = (child: Session) => child.snapshotEvents().filter(e => e.type === 'step/start').map(e => (e.data as { turn: number; step: number }))
const assertValid = (child: Session) => expect(validate(child, child.snapshotEvents())).toBeUndefined()

/** One provider step: start, a message with a call, the call, its result, end. */
function step(child: Session, turn: number, n: number, id: string): void {
  child.append('step/start', { turn, step: n })
  child.append('assistant/message', { turn, step: n, message: assistant([call(id)]), stream: [] } as never, { surfaceOp: 'append' })
  const c = child.append('tool/call', { turn, step: n, callId: id, name: 'Read', arguments: '{}' } as never)
  child.append('tool/result', { turn, step: n, message: result(id) } as never, { surfaceOp: 'append', sourceEventSeqs: [c.seq] })
  child.append('step/end', { turn, step: n })
}

describe('member child-log write guard', () => {
  it('renumbers out-of-order and repeated steps densely (kimi reservations, 2e9c1ffb)', () => {
    const { child, diverted } = guarded('steps')
    child.append('turn/start', { turn: 1 })
    for (const [n, id] of [[1, 'a'], [3, 'b'], [7, 'c'], [2, 'd'], [3, 'e']] as const) step(child, 1, n, id)
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(steps(child).map(s => s.step)).toEqual([1, 2, 3, 4, 5])
    expect(diverted).toEqual([])
    assertValid(child)
  })

  it('keeps content naming a turn the log never opened in the open turn (kimi Skill injection, fbc8ba18)', () => {
    const { child, diverted } = guarded('skill')
    child.append('turn/start', { turn: 1 })
    step(child, 1, 1, 'skill')
    step(child, 2, 1, 'next')
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(steps(child)).toEqual([{ turn: 1, step: 1 }, { turn: 1, step: 2 }])
    expect(diverted).toEqual([])
    assertValid(child)
  })

  it('closes a turn left open before the next one starts (restart, 2377f26d)', () => {
    const { child } = guarded('restart')
    child.append('turn/start', { turn: 1 })
    child.append('step/start', { turn: 1, step: 1 })
    child.append('assistant/message', { turn: 1, step: 1, message: assistant([call('x')]), stream: [] } as never, { surfaceOp: 'append' })
    child.append('turn/start', { turn: 2 })
    child.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    const ends = child.snapshotEvents().filter(e => e.type === 'turn/end').map(e => e.data)
    expect(ends[0]).toMatchObject({ turn: 1, reason: { kind: 'interrupted' } })
    assertValid(child)
  })

  it('diverts writes into a turn the log already closed, keeping them (late notice after a cancel, 5dd078d9)', () => {
    const { child, diverted } = guarded('late')
    child.append('turn/start', { turn: 1 })
    step(child, 1, 1, 'a')
    child.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'parent' } } })
    const before = child.snapshotEvents().length
    child.append('step/start', { turn: 1, step: 2 })
    child.append('assistant/message', { turn: 1, step: 2, message: assistant([{ type: 'text', text: '[Request interrupted by user]' }]), stream: [] } as never, { surfaceOp: 'append' })
    child.append('step/end', { turn: 1, step: 2 })
    expect(child.snapshotEvents()).toHaveLength(before)
    expect(diverted.map(d => [d.type, d.reason])).toEqual([
      ['step/start', 'no open turn'], ['assistant/message', 'no open turn'], ['step/end', 'no open turn'],
    ])
    expect(JSON.stringify(diverted[1]!.data)).toContain('Request interrupted')
    assertValid(child)
  })

  it('diverts a backlog of a closed turn written inside the next one (kimi reattach, 2e9c1ffb)', () => {
    const { child, diverted } = guarded('backlog')
    child.append('turn/start', { turn: 1 })
    step(child, 1, 1, 'a')
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    child.append('turn/start', { turn: 2 })
    step(child, 1, 32, 'old')
    step(child, 2, 1, 'new')
    child.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    expect(steps(child)).toEqual([{ turn: 1, step: 1 }, { turn: 2, step: 1 }])
    expect(diverted.every(d => d.reason === 'turn 1 is already closed')).toBe(true)
    expect(diverted.length).toBe(5)
    assertValid(child)
  })

  it('diverts a result whose call nothing advertised, and lands a result whose call never started', () => {
    const { child, diverted } = guarded('tools')
    child.append('turn/start', { turn: 1 })
    child.append('step/start', { turn: 1, step: 1 })
    child.append('assistant/message', { turn: 1, step: 1, message: assistant([call('advertised')]), stream: [] } as never, { surfaceOp: 'append' })
    child.append('tool/result', { turn: 1, step: 1, message: result('1:advertised', 'orphan') } as never, { surfaceOp: 'append' })
    child.append('tool/result', { turn: 1, step: 1, message: result('advertised') } as never, { surfaceOp: 'append' })
    child.append('step/end', { turn: 1, step: 1 })
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(diverted.map(d => d.reason)).toEqual(['tool/result with no advertised call'])
    expect(child.snapshotEvents().filter(e => e.type === 'tool/call')).toHaveLength(1)
    assertValid(child)
  })

  it('passes a well-formed round through unchanged', () => {
    const plain = Session.create(SessionId('plain'))
    const { child, diverted } = guarded('plain-guarded')
    const hello = createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })
    for (const session of [plain, child]) {
      session.append('turn/start', { turn: 1 })
      session.append('user/message', hello, { surfaceOp: 'append' })
      step(session, 1, 1, 'a')
      step(session, 1, 2, 'b')
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    }
    const shape = (s: Session) => s.snapshotEvents().map(e => [e.type, e.seq, JSON.stringify(e.data)])
    expect(shape(child)).toEqual(shape(plain))
    expect(diverted).toEqual([])
  })

  it('never diverts a round because the log was already invalid before the guard', () => {
    const child = Session.create(SessionId('pre-broken'))
    // An unrepaired history: step 3 with no step 2, written before any guard.
    child.append('turn/start', { turn: 1 })
    child.append('step/start', { turn: 1, step: 3 })
    child.append('step/end', { turn: 1, step: 3 })
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const diverted: QuarantineEntry[] = []
    guardChildLog(child, { quarantine: entry => diverted.push(entry), validate })
    child.append('turn/start', { turn: 2 })
    step(child, 2, 1, 'a')
    child.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    expect(diverted).toEqual([])
    expect(child.snapshotEvents().filter(e => e.type === 'tool/call')).toHaveLength(1)
  })

  it('installs once', () => {
    const { child, diverted } = guarded('once')
    guardChildLog(child, { quarantine: entry => diverted.push(entry), validate })
    child.append('turn/start', { turn: 1 })
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    assertValid(child)
  })
})
