// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as SessionStats from '@deepseek-ai/dsh-session-stats'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { InspectorService } from '../src/service.ts'
import { Trend } from '../src/client/Trend.tsx'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

describe('official whole-log statistics', () => {
  it('reads the native projections and never applies them to a filtered scope', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SessionStats)
    await ctx.plugin(TokenMeter)
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('official-stats'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', {
      turn: 1, step: 1,
      message: createAssistantMessage({ content: [{ type: 'text', text: 'answer' }], source: { provider: 'mock', model: 'mock' } }),
      stream: [],
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 5 },
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    const service = new InspectorService(ctx)
    const trend = await service.getSessionTrend(session.id)
    expect(trend.official).toEqual({
      session: { turns: 1, steps: 1, llmMs: expect.any(Number), toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 },
      tokenUsage: { uncachedInputTokens: 100, outputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 5 },
    })
    expect((await service.getSessionTrend(session.id, { scopes: [] })).official).toBeUndefined()
    service.dispose()
  })

  it('renders whole-log totals separately from the per-request trend', () => {
    render(<Trend
      data={{
        turns: [], backfill: { state: 'complete' }, requests: [],
        official: {
          session: { turns: 8, steps: 13, llmMs: 1_200, toolMs: 250, ttftMs: 100, ttftSteps: 1, decodeMs: 1_000, decodeTokens: 50 },
          tokenUsage: { uncachedInputTokens: 100, outputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 5 },
        },
      }}
      turnSeq={null}
      selectedSeq={null}
      scopeId="main"
      scopeLabel="main"
      onSelect={() => {}}
      t={(key, params) => `${key} ${JSON.stringify(params ?? {})}`}
    />)
    const note = screen.getByRole('note').textContent!
    expect(note).toContain('trend.officialTotals')
    for (const value of ['8', '13', '125', '50', '1.2', '0.3']) expect(note).toContain(value)
  })
})
