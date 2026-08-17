/**
 * context-guard decision math: the request-budget overflow rule
 * (`projected + maxTokens` vs the context window), the level ladder, and the
 * unknown-input degradation.
 */
import { describe, expect, it } from 'vitest'
import { guardReading } from '../src/client/guard.ts'

const WINDOW = 100_000

describe('guardReading', () => {
  it('stays ok below the threshold', () => {
    const reading = guardReading({
      projectedTokens: 50_000, contextWindow: WINDOW, maxTokens: 20_000, thresholdRatio: 0.8,
    })
    expect(reading).toEqual({
      level: 'ok', percent: 70, budgetTokens: 70_000, contextWindow: WINDOW,
    })
  })

  it('turns warning exactly at the threshold (budget = 80% of the window)', () => {
    const reading = guardReading({
      projectedTokens: 60_000, contextWindow: WINDOW, maxTokens: 20_000, thresholdRatio: 0.8,
    })
    expect(reading?.level).toBe('warning')
    expect(reading?.percent).toBe(80)
  })

  it('turns warning as soon as context + maxTokens crosses the threshold, even when the context alone is far below it', () => {
    // The whole point of the guard: the official pre-step check only looks at
    // context vs 80%, so context at 60% with a 20k output budget (80% total)
    // would pass the official check while the next request is already at the
    // edge of being rejected once provider-side tokenization is applied.
    const reading = guardReading({
      projectedTokens: 60_000, contextWindow: WINDOW, maxTokens: 20_001, thresholdRatio: 0.8,
    })
    expect(reading?.level).toBe('warning')
  })

  it('turns overdue when the budget already exceeds the window', () => {
    const reading = guardReading({
      projectedTokens: 90_000, contextWindow: WINDOW, maxTokens: 20_000, thresholdRatio: 0.8,
    })
    expect(reading?.level).toBe('overdue')
    expect(reading?.percent).toBe(100) // clamped
  })

  it('clamps percent to 100', () => {
    const reading = guardReading({
      projectedTokens: 200_000, contextWindow: WINDOW, maxTokens: 20_000, thresholdRatio: 0.8,
    })
    expect(reading?.percent).toBe(100)
  })

  it('returns null while the context window is unknown', () => {
    expect(guardReading({
      projectedTokens: 50_000, contextWindow: undefined, maxTokens: 20_000, thresholdRatio: 0.8,
    })).toBeNull()
    expect(guardReading({
      projectedTokens: 50_000, contextWindow: 0, maxTokens: 20_000, thresholdRatio: 0.8,
    })).toBeNull()
  })

  it('returns null while the context figure is unknown or negative', () => {
    expect(guardReading({
      projectedTokens: Number.NaN, contextWindow: WINDOW, maxTokens: 20_000, thresholdRatio: 0.8,
    })).toBeNull()
    expect(guardReading({
      projectedTokens: -1, contextWindow: WINDOW, maxTokens: 20_000, thresholdRatio: 0.8,
    })).toBeNull()
  })

  it('returns null for a non-positive output budget', () => {
    expect(guardReading({
      projectedTokens: 50_000, contextWindow: WINDOW, maxTokens: 0, thresholdRatio: 0.8,
    })).toBeNull()
  })

  it('respects a custom threshold', () => {
    const reading = guardReading({
      projectedTokens: 30_000, contextWindow: WINDOW, maxTokens: 20_000, thresholdRatio: 0.5,
    })
    expect(reading?.level).toBe('warning')
  })

  it('warns before the main request hits the provider wall with the 256k reservation', () => {
    // Regression pin: the pre-fix default modeled the summarizer's 8192 cap,
    // so the button appeared at projected >= 830,668 — AFTER the provider
    // wall (window − 256,000 = 792,576). With the main request's real 256k
    // reservation, a 700k projection must already show the warning.
    const reading = guardReading({
      projectedTokens: 700_000, contextWindow: 1_048_576, maxTokens: 256_000, thresholdRatio: 0.8,
    })
    expect(reading?.level).toBe('warning')
  })

  it('turns overdue exactly at the provider wall (projected = window − maxTokens)', () => {
    // The wall: the main request is rejected once projected + 256,000
    // reaches the window. The guard must have been warning for the whole
    // stretch below it, and turn red only at the wall itself.
    const reading = guardReading({
      projectedTokens: 1_048_576 - 256_000, contextWindow: 1_048_576, maxTokens: 256_000, thresholdRatio: 0.8,
    })
    expect(reading?.level).toBe('overdue')
    expect(reading?.percent).toBe(100)
  })
})
