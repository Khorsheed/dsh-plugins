import { describe, expect, it } from 'vitest'
import { createMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { tokenUsageProjectionDefinition } from '../../../llm/token-meter/src/usage-projection.ts'
import { subagentTimingProjectionDefinition } from '../../../subagent/subagent/src/projection.ts'

/**
 * Fold one projection definition over a session event list, exactly as the
 * projection registry replays a durable log. These tests pin the *mirrored*
 * event sequence the kimi and codex providers append (descriptor → turn
 * boundaries → mirrored messages) so a future change to either the append
 * order or the projection fold cannot silently break the visible timing and
 * token numbers.
 */

interface Foldable<T> {
  init(): T
  apply(state: T, event: SessionEvent): T
  view(state: T): unknown
}

function fold<T>(definition: Foldable<T>, events: readonly SessionEvent[]): unknown {
  let state = definition.init()
  for (const event of events) state = definition.apply(state, event)
  return definition.view(state)
}

function event(over: Partial<SessionEvent> & Pick<SessionEvent, 'type'>): SessionEvent {
  return {
    seq: 0,
    time: 0,
    data: {},
    ...over,
  } as SessionEvent
}

/** The assistant/message data the mirrored delegation carries. */
function assistantMessage(usage?: unknown): SessionEvent {
  return event({
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider: 'mock', model: 'mock' } }),
      ...usage === undefined ? {} : { usage },
    },
  })
}

describe('mirrored delegation projections', () => {
  it('subagentTiming folds the descriptor→turn→message sequence to real runtime', () => {
    // The provider appends descriptor, then turn/start at spawn, then the
    // mirrored user/assistant messages, then turn/end at settle. The fold
    // must attribute the full CLI runtime to the child's own descriptor.
    const events = [
      event({ type: 'subagent/descriptor', seq: 0, time: 1_000 }),
      event({ type: 'turn/start', seq: 1, time: 1_010 }),
      event({ type: 'user/message', seq: 2, time: 5_000 }),
      event({ type: 'assistant/message', seq: 3, time: 5_100 }),
      event({ type: 'turn/end', seq: 4, time: 9_000 }),
    ]
    expect(fold(subagentTimingProjectionDefinition, events)).toEqual({ settledMs: 7_990 })
  })

  it('subagentTiming stays stable when messages land after turn/end (codex order)', () => {
    // codex closes the turn at settle and appends messages after; timing is
    // the spawn→settle interval either way.
    const events = [
      event({ type: 'subagent/descriptor', seq: 0, time: 1_000 }),
      event({ type: 'turn/start', seq: 1, time: 1_010 }),
      event({ type: 'turn/end', seq: 2, time: 9_000 }),
      event({ type: 'user/message', seq: 3, time: 9_100 }),
      assistantMessage(),
    ]
    expect(fold(subagentTimingProjectionDefinition, events)).toEqual({ settledMs: 7_990 })
  })

  it('tokenUsage folds the mirrored assistant usage into the four buckets', () => {
    const events = [
      event({ type: 'user/message' }),
      assistantMessage({ inputTokens: 100, outputTokens: 25, cacheReadTokens: 40, cacheWriteTokens: 10 }),
    ]
    expect(fold(tokenUsageProjectionDefinition, events)).toEqual({
      uncachedInputTokens: 100,
      outputTokens: 25,
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
    })
  })

  it('tokenUsage maps a cache-less usage to zero cache buckets', () => {
    const events = [
      event({ type: 'user/message' }),
      assistantMessage({ inputTokens: 8, outputTokens: 2 }),
    ]
    expect(fold(tokenUsageProjectionDefinition, events)).toEqual({
      uncachedInputTokens: 8,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })
})
