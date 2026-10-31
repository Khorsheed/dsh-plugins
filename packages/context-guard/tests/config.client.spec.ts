/**
 * context-guard entry config: defaults and clamping. The single field tunes
 * only when the compact button appears; the official compaction engine reads
 * its own config and is never touched by it.
 */
import { describe, expect, it } from 'vitest'
import { memberThresholdOf, resolveConfig } from '../src/client/config.ts'

describe('resolveConfig', () => {
  it('applies the documented defaults when no config is passed', () => {
    expect(resolveConfig(undefined)).toEqual({
      thresholdRatio: 0.8, harnessThresholds: {}, memberThresholds: {},
    })
  })

  it('keeps explicit values', () => {
    expect(resolveConfig({ thresholdRatio: 0.6 })).toEqual({
      thresholdRatio: 0.6, harnessThresholds: {}, memberThresholds: {},
    })
  })

  it('clamps the threshold ratio into (0, 1]', () => {
    expect(resolveConfig({ thresholdRatio: 2 }).thresholdRatio).toBe(1)
    expect(resolveConfig({ thresholdRatio: 0 }).thresholdRatio).toBe(0.01)
    expect(resolveConfig({ thresholdRatio: -3 }).thresholdRatio).toBe(0.01)
  })

  it('external-CLI ratios: a member\'s own beats its CLI\'s, which beats the global one; bad entries drop', () => {
    const config = resolveConfig({
      thresholdRatio: 0.8,
      harnessThresholds: { kimi: 0.5, codex: 'x' as never },
      memberThresholds: { 'child-a': { ratio: 0.3, name: '尼尔盖曼', harness: 'kimi' }, 'child-b': { name: 'no ratio' } as never },
    })
    expect(config.harnessThresholds).toEqual({ kimi: 0.5 })
    expect(Object.keys(config.memberThresholds)).toEqual(['child-a'])
    expect(memberThresholdOf(config, { childSessionId: 'child-a', harness: 'kimi' })).toEqual({ ratio: 0.3, from: 'member' })
    expect(memberThresholdOf(config, { childSessionId: 'child-c', harness: 'kimi' })).toEqual({ ratio: 0.5, from: 'harness' })
    expect(memberThresholdOf(config, { childSessionId: 'child-c', harness: 'codex' })).toEqual({ ratio: 0.8, from: 'global' })
  })
})
