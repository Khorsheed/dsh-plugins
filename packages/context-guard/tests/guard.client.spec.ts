/**
 * context-guard decision math: the context-occupancy reminder rule
 * (`projectedTokens / contextWindow` — the same figure the composer's context
 * ring shows), the level ladder, and the unknown-input degradation.
 */
import { describe, expect, it } from 'vitest'
import { guardReading } from '../src/client/guard.ts'

const WINDOW = 100_000

describe('guardReading', () => {
  it('stays ok below the threshold', () => {
    const reading = guardReading({
      projectedTokens: 70_000, contextWindow: WINDOW, thresholdRatio: 0.8,
    })
    expect(reading).toEqual({
      level: 'ok', percent: 70, contextWindow: WINDOW,
    })
  })

  it('turns warning exactly at the threshold (occupancy = 80% of the window)', () => {
    const reading = guardReading({
      projectedTokens: 80_000, contextWindow: WINDOW, thresholdRatio: 0.8,
    })
    expect(reading?.level).toBe('warning')
    expect(reading?.percent).toBe(80)
  })

  it('turns warning as soon as occupancy crosses the threshold', () => {
    const reading = guardReading({
      projectedTokens: 80_001, contextWindow: WINDOW, thresholdRatio: 0.8,
    })
    expect(reading?.level).toBe('warning')
  })

  it('turns overdue when occupancy reaches the whole window (a defensive floor, not a reachable state)', () => {
    const reading = guardReading({
      projectedTokens: 100_000, contextWindow: WINDOW, thresholdRatio: 0.8,
    })
    expect(reading?.level).toBe('overdue')
    expect(reading?.percent).toBe(100) // clamped
  })

  it('clamps percent to 100', () => {
    const reading = guardReading({
      projectedTokens: 200_000, contextWindow: WINDOW, thresholdRatio: 0.8,
    })
    expect(reading?.percent).toBe(100)
  })

  it('returns null while the context window is unknown', () => {
    expect(guardReading({
      projectedTokens: 50_000, contextWindow: undefined, thresholdRatio: 0.8,
    })).toBeNull()
    expect(guardReading({
      projectedTokens: 50_000, contextWindow: 0, thresholdRatio: 0.8,
    })).toBeNull()
  })

  it('returns null while the context figure is unknown or negative', () => {
    expect(guardReading({
      projectedTokens: Number.NaN, contextWindow: WINDOW, thresholdRatio: 0.8,
    })).toBeNull()
    expect(guardReading({
      projectedTokens: -1, contextWindow: WINDOW, thresholdRatio: 0.8,
    })).toBeNull()
  })

  it('respects a custom threshold — a lower ratio reminds earlier', () => {
    // At 1,048,576 (the provider's real window), occupancy of 750k is ~71.5%:
    // below the default 0.8, but above a 0.7 reminder ratio. The real
    // rejection wall sits below 100% occupancy (the request reserves output),
    // so a lower threshold is how the reminder beats the wall.
    expect(guardReading({
      projectedTokens: 750_000, contextWindow: 1_048_576, thresholdRatio: 0.7,
    })?.level).toBe('warning')
    expect(guardReading({
      projectedTokens: 750_000, contextWindow: 1_048_576, thresholdRatio: 0.8,
    })?.level).toBe('ok')
  })

  it('mirrors the composer ring: the same occupancy the ring shows at 81%', () => {
    const reading = guardReading({
      projectedTokens: 850_000, contextWindow: 1_048_576, thresholdRatio: 0.8,
    })
    expect(reading?.percent).toBe(81)
    expect(reading?.level).toBe('warning')
  })
})
