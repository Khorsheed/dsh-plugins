import { describe, expect, it, vi } from 'vitest'
import type { EvalPlanItemFacts, EvalPlanReview } from '../src/types.ts'
import { createLabViewStore } from '../src/client/store.ts'
import { deliverSendBack, sendBackSuggestions } from '../src/client/SendBack.tsx'
import { stageScopeLine } from '../src/client/DesignPage.tsx'

const t = (key: string, params?: Record<string, unknown>): string => (
  params === undefined ? key : `${key} ${JSON.stringify(params)}`
)

function item(over: Partial<EvalPlanItemFacts>): EvalPlanItemFacts {
  return {
    id: 'P0-placeholder', title: null, level: null, stages: 2, container: false,
    criteria: null, probes: 0, fullScore: 100, task: null, taskPath: null,
    phases: ['stage1', 'stage2'], runStages: ['stage1', 'stage2'], fullScoreAll: 100, criteriaOutOfScope: 0,
    ...over,
  }
}

const F2 = item({
  id: 'F2-multi-agent-room', stages: 4, fullScore: 65, fullScoreAll: 100, criteriaOutOfScope: 4,
  phases: ['stage1', 'stage2', 'stage3', 'stage4'], runStages: ['stage1', 'stage2'],
})

describe('send-back and stage scope (T84)', () => {
  it('names the stages a partial run leaves out, and what that takes off the score', () => {
    const line = stageScopeLine([F2, item({})], ['stage1', 'stage2'], t)
    expect(line?.partial).toBe(true)
    expect(line?.text).toContain('"items":"F2-multi-agent-room"')
    expect(line?.text).toContain('"stages":"stage3、stage4"')
    expect(line?.text).toMatch(/score\W+35/)
    // Every stage runs: one plain sentence; no plan stages: nothing to say.
    expect(stageScopeLine([item({})], ['stage1', 'stage2'], t)?.partial).toBe(false)
    expect(stageScopeLine([F2], [], t)).toBeNull()
  })

  it('suggests one difference, the missing stages, and each reminder', () => {
    const review = { items: { items: [F2], notes: [] } } as Pick<EvalPlanReview, 'items'>
    const out = sendBackSuggestions(
      { factors: ['factor.model.declared', 'factor.harness.name'] },
      review,
      [{ severity: 'warn', code: 'X_UNKNOWN', message: 'mind the probe', condition: null }],
      t,
    )
    expect(out.map(s => s.key)).toEqual(['factors', 'stages', 'remind:X_UNKNOWN:0'])
    expect(sendBackSuggestions({ factors: ['one'] }, null, [], t)).toEqual([])
  })

  it('degrades: drafting session → this session (said so) → clipboard → the page', async () => {
    const openSession = vi.fn()
    const writeClipboard = vi.fn(async () => true)
    // The drafting session's composer never mounts: this session's takes it.
    const insertDraft = vi.fn((sid: string) => sid === 'here')
    vi.useFakeTimers()
    const pending = deliverSendBack({ kind: 'origin', sessionId: 'here', origin: 'origin' }, 'x', { openSession, insertDraft, writeClipboard })
    await vi.runAllTimersAsync()
    expect(await pending).toBe('hereFallback')
    vi.useRealTimers()
    expect(openSession).toHaveBeenCalledWith('origin', null)

    expect(await deliverSendBack({ kind: 'origin', sessionId: 'here', origin: 'origin' }, 'x', {
      openSession, insertDraft: () => true, writeClipboard,
    })).toBe('origin')
    expect(await deliverSendBack({ kind: 'here', sessionId: 'here' }, 'x', {
      openSession, insertDraft: () => false, writeClipboard,
    })).toBe('copied')
    expect(await deliverSendBack({ kind: 'here', sessionId: 'here' }, 'x', {
      openSession, insertDraft: () => false, writeClipboard: async () => false,
    })).toBe('manual')
  })

  it('clears 已交给 agent when the plan changes or turns green, never on the same failing plan', () => {
    const store = createLabViewStore().create()
    const review = (planSha: string, ok: boolean) => ({ planSha, ok } as unknown as EvalPlanReview)
    store.actions.sendBack({ planSha: 'a', ok: false })
    store.actions.setReview(review('a', false))
    expect((store.getSnapshot() as { sentBack: boolean; sentBackBasis: unknown }).sentBack).toBe(true)
    store.actions.setReview(review('a', true))
    expect((store.getSnapshot() as { sentBack: boolean; sentBackBasis: unknown }).sentBack).toBe(false)

    store.actions.sendBack({ planSha: 'a', ok: true })
    store.actions.setReview(review('a', true))
    expect((store.getSnapshot() as { sentBack: boolean; sentBackBasis: unknown }).sentBack).toBe(true)
    store.actions.setReview(review('b', true))
    expect((store.getSnapshot() as { sentBack: boolean; sentBackBasis: unknown }).sentBack).toBe(false)
    expect((store.getSnapshot() as { sentBack: boolean; sentBackBasis: unknown }).sentBackBasis).toBeNull()
  })
})
