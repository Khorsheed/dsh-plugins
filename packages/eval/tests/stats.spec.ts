import { describe, expect, it } from 'vitest'
import { allEqualRate, bootstrapMeanCi, cohenKappa, fnv1a, mean, mulberry32 } from '../src/stats.ts'

describe('cohenKappa', () => {
  it('matches the hand-computed table (po=.75, pe=.5 → κ=.5) and pins perfect agreement at 1', () => {
    const pairs: Array<[boolean, boolean]> = [[true, true], [true, true], [false, false], [false, true]]
    expect(cohenKappa(pairs)).toBeCloseTo(0.5, 10)
    const perfect: Array<[boolean, boolean]> = [[true, true], [true, true], [false, false], [false, false]]
    expect(cohenKappa(perfect)).toBeCloseTo(1, 10)
  })

  it('matches the hand-computed 2×2 (po=0.5, pe=0.5 → κ=0)', () => {
    const pairs: Array<[boolean, boolean]> = [[true, true], [true, false]]
    expect(cohenKappa(pairs)).toBeCloseTo(0, 10)
  })

  it('is negative when agreement is below chance', () => {
    const pairs: Array<[boolean, boolean]> = [[true, false], [false, true], [true, true], [false, true]]
    expect(cohenKappa(pairs)).toBeLessThan(0)
  })

  it('returns NaN when both raters are constant (expected chance = 1)', () => {
    const pairs: Array<[boolean, boolean]> = [[true, true], [true, true], [true, true]]
    expect(Number.isNaN(cohenKappa(pairs))).toBe(true)
  })

  it('returns NaN on empty input', () => {
    expect(Number.isNaN(cohenKappa([]))).toBe(true)
  })
})

describe('bootstrapMeanCi', () => {
  it('is deterministic for a given seed', () => {
    const blocks = [[2, 1, 3], [1, 0, 1], [2, 2, 1]]
    const a = bootstrapMeanCi(blocks, { seed: 42 })
    const b = bootstrapMeanCi(blocks, { seed: 42 })
    expect(a).toEqual(b)
  })

  it('centers on the observed block mean and contains it', () => {
    const blocks = [[2, 1, 3], [1, 0, 1]]
    const ci = bootstrapMeanCi(blocks, { seed: 7 })
    expect(ci.mean).toBeCloseTo(mean([mean(blocks[0] as number[]), mean(blocks[1] as number[])]), 10)
    expect(ci.lo).toBeLessThanOrEqual(ci.mean)
    expect(ci.mean).toBeLessThanOrEqual(ci.hi)
  })

  it('degenerates to a point when every delta is identical', () => {
    const ci = bootstrapMeanCi([[1, 1, 1], [1, 1]], { seed: 5 })
    expect(ci.lo).toBe(1)
    expect(ci.hi).toBe(1)
  })

  it('resamples reps within blocks, never across', () => {
    // one rep per block: every resample equals the observed value exactly
    const ci = bootstrapMeanCi([[5], [3], [-1]], { seed: 1 })
    expect(ci.lo).toBeCloseTo(7 / 3, 10)
    expect(ci.hi).toBeCloseTo(7 / 3, 10)
  })
})

describe('prng', () => {
  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(9)
    const b = mulberry32(9)
    const seq = [a(), a(), a()]
    expect(seq).toEqual([b(), b(), b()])
    for (const value of seq) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('fnv1a is deterministic and seed-usable', () => {
    expect(fnv1a('run:a:b')).toBe(fnv1a('run:a:b'))
    expect(fnv1a('run:a:b')).not.toBe(fnv1a('run:b:a'))
  })
})

describe('allEqualRate', () => {
  it('counts groups whose members all match the first', () => {
    expect(allEqualRate([[true, true], [true, false], [false, false]])).toEqual({ agreed: 2, total: 3 })
    expect(allEqualRate([])).toEqual({ agreed: 0, total: 0 })
  })
})
