/**
 * Offset between two recordings of the same scene (the recorder and the
 * phone video), found by cross-correlating short-time energy envelopes.
 * No clap needed: speech energy is distinctive enough over a few minutes.
 */

/** Short-time RMS envelope at `rate` Hz, mean-removed and unit-normalised. */
export function envelope(samples: Float32Array, sampleRate: number, rate = 100): Float32Array {
  const hop = Math.max(1, Math.round(sampleRate / rate))
  const n = Math.floor(samples.length / hop)
  const env = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let acc = 0
    const off = i * hop
    for (let k = 0; k < hop; k++) {
      const v = samples[off + k]!
      acc += v * v
    }
    env[i] = Math.sqrt(acc / hop)
  }
  let mean = 0
  for (const v of env) mean += v
  mean /= n || 1
  let norm = 0
  for (let i = 0; i < n; i++) {
    const v = env[i]! - mean
    env[i] = v
    norm += v * v
  }
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < n; i++) env[i] = env[i]! / norm
  return env
}

export interface AlignResult {
  /** Seconds to ADD to `other`'s time to land on `reference` time. */
  offsetSec: number
  /** Normalised peak correlation, 0..1; below ~0.3 the match is doubtful. */
  confidence: number
}

/**
 * Best lag within ±maxLagSec. If `other` starts recording 0.42 s before
 * `reference`, its content appears 0.42 s later in its own timeline, and the
 * returned offset is −0.42.
 */
export function alignEnvelopes(reference: Float32Array, other: Float32Array, rate: number, maxLagSec = 30): AlignResult {
  const maxLag = Math.round(maxLagSec * rate)
  let best = -Infinity
  let bestLag = 0
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    // reference[i] ≈ other[i + lag]
    let acc = 0
    const from = Math.max(0, -lag)
    const to = Math.min(reference.length, other.length - lag)
    for (let i = from; i < to; i++) acc += reference[i]! * other[i + lag]!
    if (acc > best) {
      best = acc
      bestLag = lag
    }
  }
  return { offsetSec: -bestLag / rate, confidence: Math.max(0, Math.min(1, best)) }
}
