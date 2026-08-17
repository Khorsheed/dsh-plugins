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

  it('turns overdue when the budget exceeds the CONFIGURED window', () => {
    // overdue 以适配器配置的窗口为准；配置值小于 provider 真实窗口时会提前变红，这是安全方向。
    const reading = guardReading({
      projectedTokens: 1_048_576 - 256_000, contextWindow: 1_048_576, maxTokens: 256_000, thresholdRatio: 0.8,
    })
    expect(reading?.level).toBe('overdue')
    expect(reading?.percent).toBe(100)
  })

  it('warns at 544k and turns overdue at 744k against the configured window, ahead of the real provider wall', () => {
    // Real deployment has two distinct windows: the adapter catalog configures
    // contextWindow = 1,000,000 (the value the guard reads from the
    // contextPressure projection), while the provider's real window is
    // 1,048,576 (the number in the CONTEXT_WINDOW_EXCEEDED error). The guard
    // keys off the CONFIGURED window, so with the 256k reservation the warning
    // lights at 544,000 (0.8 × 1,000,000 − 256,000) and overdue at 744,000
    // (1,000,000 − 256,000) — both before the real wall at 792,576. That lead
    // is the safe direction: the guard never waits for the provider's number.
    const warning = guardReading({
      projectedTokens: 544_000, contextWindow: 1_000_000, maxTokens: 256_000, thresholdRatio: 0.8,
    })
    expect(warning?.level).toBe('warning')
    const overdue = guardReading({
      projectedTokens: 744_000, contextWindow: 1_000_000, maxTokens: 256_000, thresholdRatio: 0.8,
    })
    expect(overdue?.level).toBe('overdue')
    expect(overdue?.percent).toBe(100)
  })
})
