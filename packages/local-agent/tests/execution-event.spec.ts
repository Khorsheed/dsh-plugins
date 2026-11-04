/**
 * `local-agent/execution` is registered before any build writes it (batch 5
 * S0): a stored member log carrying start/end records must load through the
 * host's real reader, and the child-log guard's released-log check must
 * accept both records — including an end record written after `turn/end`.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { KNOWN_SESSION_EVENT_TYPES, SESSION_FORMAT_VERSION, Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { assertReleasedV4Relationships } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { guardChildLog, type QuarantineEntry } from '../src/child-log-guard.ts'
import { mirrorAssistantMessage } from '../src/mirror-step.ts'
import type { LocalAgentExecutionEndEvent, LocalAgentExecutionStartEvent } from '../src/index.ts'
// Module load performs the registration under test.
import '../src/index.ts'

const TYPE = 'local-agent/execution'

const start: LocalAgentExecutionStartEvent = {
  phase: 'start', executionId: 'exec-1', caller: 'room', callerRef: 'run-a', operation: 'prompt',
  cause: { kind: 'help', sessionId: 'room-1', helpId: 'h1', fromRoom: 'room-2', fromTask: { sessionId: 'room-2', id: 'msg-9' } },
  task: { sessionId: 'room-1', id: 'msg-1' }, parentSessionId: 'room-1', admittedAt: 1000,
}
const end: LocalAgentExecutionEndEvent = {
  phase: 'end', executionId: 'exec-1', outcome: 'done', turns: [1], endedAt: 2000,
  unrecorded: ['call-boundaries', 'per-call-usage'],
  providerReportedUsage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 64 } as never,
}

/** A mirrored assistant message, built the way every provider's mirror builds one. */
const assistant = () => mirrorAssistantMessage([{ kind: 'text', text: 'ok' }], { provider: 'codex-local', model: 'm' })

/**
 * A member log in the order S1 writes: start, one round, end after
 * turn/end — appended through a real session, so every envelope is the
 * host's own.
 */
function memberLog(): SessionEvent[] {
  const session = Session.create(SessionId('member-log'))
  session.append(TYPE, start)
  session.append('turn/start', { turn: 1 } as never)
  session.append('step/start', { turn: 1, step: 1 } as never)
  session.append('assistant/message', { turn: 1, step: 1, message: assistant(), stream: [] } as never, { surfaceOp: 'append' } as never)
  session.append('step/end', { turn: 1, step: 1 } as never)
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } } as never)
  session.append(TYPE, end)
  return [...session.snapshotEvents()]
}

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

async function readBack(rows: SessionEvent[]): Promise<readonly SessionEvent[]> {
  const dir = await mkdtemp(join(tmpdir(), 'local-agent-execution-'))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const fiber = await ctx.plugin(JsonlSessionPersistence, { root: dir, compression: 'none' })
  try {
    const id = SessionId('member-child')
    const handle = await ctx.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false, delegationDepth: 1 } as never)
    await handle.append(rows)
    await handle.flush()
    const reader = await ctx.sessionPersistence.open(id, 'read')
    try {
      return (await reader.read(0)).events
    } finally {
      await reader.close()
    }
  } finally {
    await fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  }
}

describe('local-agent/execution registration', () => {
  it('is registered in the host event catalog at module load', () => {
    expect(KNOWN_SESSION_EVENT_TYPES.has(TYPE)).toBe(true)
  })

  it('a stored member log with start/end records loads through the host reader', async () => {
    const events = await readBack(memberLog())
    expect(events.map(event => event.type)).toEqual([TYPE, 'turn/start', 'step/start', 'assistant/message', 'step/end', 'turn/end', TYPE])
    expect(events.filter(event => event.type === TYPE).map(event => event.data)).toEqual([start, end])
  })

  it('without the registration the same log is refused (the control: removal breaks history)', async () => {
    const catalog = KNOWN_SESSION_EVENT_TYPES as Set<string>
    catalog.delete(TYPE)
    try {
      const failure = await readBack(memberLog()).then(() => undefined, (error: unknown) => error as Error)
      expect(failure?.name).toBe('SessionFormatUnsupportedError')
    } finally {
      catalog.add(TYPE)
    }
  })

  it('the released-log check accepts start before turn/start and end after turn/end', () => {
    expect(validate(Session.create(SessionId('v')), memberLog())).toBeUndefined()
  })

  it('the child-log guard writes both records without diverting either, end after turn/end included', () => {
    const child = Session.create(SessionId('guarded'))
    const diverted: QuarantineEntry[] = []
    guardChildLog(child, { quarantine: entry => diverted.push(entry), validate })
    child.append(TYPE, start)
    child.append('turn/start', { turn: 1 } as never)
    child.append('step/start', { turn: 1, step: 1 } as never)
    child.append('assistant/message', { turn: 1, step: 1, message: assistant(), stream: [] } as never, { surfaceOp: 'append' } as never)
    child.append('step/end', { turn: 1, step: 1 } as never)
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } } as never)
    child.append(TYPE, end)
    // A compaction execution: start and end with no turn between them.
    child.append(TYPE, { ...start, executionId: 'exec-2', operation: 'compact', cause: { kind: 'human', sessionId: 'room-1', via: 'compact-button' } })
    child.append(TYPE, { ...end, executionId: 'exec-2', turns: [], unrecorded: ['compaction'] })
    expect(diverted).toEqual([])
    expect(child.snapshotEvents().map(event => event.type)).toEqual([
      TYPE, 'turn/start', 'step/start', 'assistant/message', 'step/end', 'turn/end', TYPE, TYPE, TYPE,
    ])
    expect(validate(child, child.snapshotEvents())).toBeUndefined()
  })
})
