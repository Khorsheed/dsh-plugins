/**
 * context-guard entry config: defaults and clamping. The single field tunes
 * only when the compact button appears; the official compaction engine reads
 * its own config and is never touched by it.
 */
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/client/config.ts'

describe('resolveConfig', () => {
  it('applies the documented defaults when no config is passed', () => {
    expect(resolveConfig(undefined)).toEqual({
      thresholdRatio: 0.8,
    })
  })

  it('keeps explicit values', () => {
    expect(resolveConfig({ thresholdRatio: 0.6 })).toEqual({
      thresholdRatio: 0.6,
    })
  })

  it('clamps the threshold ratio into (0, 1]', () => {
    expect(resolveConfig({ thresholdRatio: 2 }).thresholdRatio).toBe(1)
    expect(resolveConfig({ thresholdRatio: 0 }).thresholdRatio).toBe(0.01)
    expect(resolveConfig({ thresholdRatio: -3 }).thresholdRatio).toBe(0.01)
  })
})
