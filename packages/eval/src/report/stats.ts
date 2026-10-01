/**
 * Hand-written statistics for the eval report — no dependency, every number
 * reproducible from an explicit seed. The report uses three: a bootstrap
 * percentile CI of a block-structured mean (resampling reps, the pairing
 * unit), Cohen's κ for binary rater agreement, and a small seeded PRNG.
 *
 * Deliberately NOT imported by anything statistical outside the report: if a
 * future task needs more than this, the freeze-decision bar is a written
 * justification plus tests, not an npm stats library.
 * @module @khorsheed/dsh-eval
 */

/**
 * mulberry32 — 32-bit seeded PRNG. Chosen because it is short enough to
 * review line by line, passes hbarnor's prng tests for this use, and makes
 * the report's confidence intervals byte-reproducible from the seed.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a 32-bit hash — turns a stable string (run id, pair key) into a seed. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Arithmetic mean; empty input is a caller bug, not a number. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('mean of empty list')
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

export interface BootstrapCi {
  /** Mean of the observed (unresampled) block means. */
  mean: number
  /** Lower / upper bounds of the percentile CI. */
  lo: number
  hi: number
  /** Resample count actually used. */
  samples: number
  /** The seed the resampling used (printed into the report). */
  seed: number
}

/**
 * Bootstrap percentile CI for a two-level blocked design: `blocks` holds one
 * row of per-rep values per block (tasks), the statistic is the mean over
 * blocks of the per-block mean. Each resample redraws reps WITHIN each block
 * (the rep is the pairing unit; the block structure is kept), then takes the
 * same statistic. Deterministic for a given seed.
 *
 * A block with a single value still resamples to that value — it contributes
 * its delta, with no variance of its own.
 */
export function bootstrapMeanCi(
  blocks: readonly (readonly number[])[],
  options: { samples?: number; seed: number; level?: number } ,
): BootstrapCi {
  const samples = options.samples ?? 2000
  const level = options.level ?? 0.95
  if (blocks.length === 0) throw new Error('bootstrap of no blocks')
  for (const block of blocks) {
    if (block.length === 0) throw new Error('bootstrap of empty block')
  }
  const observed = mean(blocks.map(block => mean(block)))
  const rng = mulberry32(options.seed)
  const draw = (block: readonly number[]): number => block[Math.floor(rng() * block.length)] ?? 0
  const stats: number[] = []
  for (let s = 0; s < samples; s++) {
    const blockMeans = blocks.map((block) => {
      let sum = 0
      for (let i = 0; i < block.length; i++) sum += draw(block)
      return sum / block.length
    })
    stats.push(mean(blockMeans))
  }
  stats.sort((a, b) => a - b)
  const alpha = 1 - level
  const lo = stats[Math.floor((alpha / 2) * samples)] ?? Number.NaN
  const hi = stats[Math.ceil((1 - alpha / 2) * samples) - 1] ?? Number.NaN
  return { mean: observed, lo, hi, samples, seed: options.seed }
}

/**
 * Cohen's κ for two binary raters over the same items. `pairs` holds one
 * [raterA, raterB] verdict pair per item. Returns NaN when κ is undefined
 * (both raters constant — the expected-chance term is 1); the report renders
 * that as 不适用 rather than inventing a number.
 */
export function cohenKappa(pairs: ReadonlyArray<readonly [boolean, boolean]>): number {
  if (pairs.length === 0) return Number.NaN
  let bothPass = 0
  let bothFail = 0
  let aPass = 0
  let bPass = 0
  for (const [a, b] of pairs) {
    if (a && b) bothPass++
    else if (!a && !b) bothFail++
    if (a) aPass++
    if (b) bPass++
  }
  const n = pairs.length
  const po = (bothPass + bothFail) / n
  const pe = (aPass / n) * (bPass / n) + ((n - aPass) / n) * ((n - bPass) / n)
  const denom = 1 - pe
  if (denom <= 0) return Number.NaN
  return (po - pe) / denom
}

/** Fraction of values equal to the first — the multi-sample agreement rate. */
export function allEqualRate(groups: ReadonlyArray<readonly boolean[]>): { agreed: number; total: number } {
  let agreed = 0
  for (const group of groups) {
    if (group.length > 0 && group.every(v => v === group[0])) agreed++
  }
  return { agreed, total: groups.length }
}
