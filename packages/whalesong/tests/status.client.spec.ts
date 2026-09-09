import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { anySessionRunning, diffPendingInteractions, diffSessionList } from '../src/client/status.ts'

type RowSpec = Partial<SessionSummary> & { running: boolean }

/** Build a minimal SessionListState; only the fields whalesong reads are meaningful. */
function state(rows: Record<string, RowSpec>): SessionListState {
  const byId: Record<string, SessionSummary> = {}
  for (const [id, spec] of Object.entries(rows)) {
    byId[id] = { id, displayTitle: id, ...spec } as unknown as SessionSummary
  }
  return {
    ids: Object.keys(rows),
    byId,
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
  } as unknown as SessionListState
}

/** Build a pending-interaction frame: one approval-shaped entry per session id. */
function pending(...ids: string[]): SessionPendingInteractionSnapshot {
  return new Map(ids.map(id => [id as SessionId, { key: `${id}:approval`, kind: 'approval', sessionId: id as SessionId }]))
}

describe('anySessionRunning', () => {
  it('is false for an empty list and true when any listed row runs', () => {
    expect(anySessionRunning(state({}))).toBe(false)
    expect(anySessionRunning(state({ a: { running: false }, b: { running: true } }))).toBe(true)
  })

  it('counts only UI-listed rows: a lingering running subagent row outside ids does not whalesong', () => {
    // Regression for the 3081 latch: byId carries addressed subagent rows
    // (running projected from the child catalog) that can linger after the
    // work ends; the UI list (ids) is the口径 anyRunning must follow.
    const s = state({ a: { running: false } })
    const byId = s.byId as Record<string, SessionSummary>
    byId.sub1 = { id: 'sub1', displayTitle: 'sub1', running: true, origin: 'subagent' } as unknown as SessionSummary
    expect(anySessionRunning(s)).toBe(false)
    const events = diffSessionList(undefined, s)
    expect(events.anyRunning).toBe(false)
  })
})

describe('diffSessionList', () => {
  it('treats the first frame as a pure baseline (no edges)', () => {
    const events = diffSessionList(undefined, state({
      a: { running: true },
      b: { running: false },
    }))
    expect(events.anyRunning).toBe(true)
    expect(events.completed).toEqual([])
  })

  it('flags running true→false as a completion edge', () => {
    const prev = state({ a: { running: true } })
    const next = state({ a: { running: false } })
    const events = diffSessionList(prev, next)
    expect(events.completed).toEqual(['a'])
    expect(events.anyRunning).toBe(false)
  })

  it('handles multiple sessions independently', () => {
    const prev = state({
      a: { running: true },
      b: { running: true },
      c: { running: false },
    })
    const next = state({
      a: { running: false },
      b: { running: true },
      c: { running: false },
    })
    const events = diffSessionList(prev, next)
    expect(events.completed).toEqual(['a'])
    expect(events.anyRunning).toBe(true) // b still runs
  })

  it('does not flag a new session that appears already running or stopped', () => {
    const prev = state({ a: { running: false } })
    const next = state({
      a: { running: false },
      b: { running: true },
      c: { running: false },
    })
    const events = diffSessionList(prev, next)
    expect(events.completed).toEqual([])
    expect(events.anyRunning).toBe(true)
  })

  it('does not flag a completion when a new session appears already stopped', () => {
    const prev = state({ a: { running: true } })
    const next = state({ a: { running: true }, b: { running: false } })
    expect(diffSessionList(prev, next).completed).toEqual([])
  })

  it('tolerates rows vanishing between frames (no crash, no edge)', () => {
    const prev = state({ a: { running: true }, b: { running: true } })
    const next = state({ a: { running: true } })
    const events = diffSessionList(prev, next)
    expect(events.completed).toEqual([])
    expect(events.anyRunning).toBe(true)
  })

  it('re-fires on each true→false crossing of a flapping row', () => {
    const running = state({ a: { running: true } })
    const stopped = state({ a: { running: false } })
    expect(diffSessionList(running, stopped).completed).toEqual(['a'])
    expect(diffSessionList(stopped, running).completed).toEqual([])
    expect(diffSessionList(running, stopped).completed).toEqual(['a'])
  })

  it('keeps a still-running session out of completion even as another finishes', () => {
    const prev = state({ a: { running: true }, b: { running: true } })
    const next = state({ a: { running: false }, b: { running: true } })
    const events = diffSessionList(prev, next)
    expect(events.completed).toEqual(['a'])
    expect(events.anyRunning).toBe(true)
  })
})

describe('diffPendingInteractions', () => {
  it('treats the first frame as a pure baseline (no edges)', () => {
    expect(diffPendingInteractions(undefined, pending('a'))).toEqual([])
  })

  it('flags a pending interaction appearing as a blocked edge', () => {
    expect(diffPendingInteractions(pending(), pending('a'))).toEqual(['a'])
  })

  it('does not re-flag a pending interaction that persists', () => {
    expect(diffPendingInteractions(pending('a'), pending('a'))).toEqual([])
  })

  it('handles multiple sessions independently', () => {
    expect(diffPendingInteractions(pending('a'), pending('a', 'b'))).toEqual(['b'])
  })

  it('does not flag a session whose interaction clears, and re-fires when it returns', () => {
    expect(diffPendingInteractions(pending('a'), pending())).toEqual([])
    expect(diffPendingInteractions(pending(), pending('a'))).toEqual(['a'])
  })

  it('tolerates sessions vanishing between frames (no crash, no edge)', () => {
    expect(diffPendingInteractions(pending('a', 'b'), pending('a'))).toEqual([])
  })
})
