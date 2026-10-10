import type { Edit } from './types.ts'

/** A half-open range [start, end) of reference time that survives into the output. */
export interface Range {
  start: number
  end: number
}

const EPS = 1e-6

/**
 * The ranges that are REMOVED by applied cut/shorten edits, merged and
 * clamped to [0, duration]. A shorten edit keeps `value` seconds centred in
 * its range and removes the rest.
 */
export function removedRanges(duration: number, edits: readonly Edit[]): Range[] {
  const raw: Range[] = []
  for (const e of edits) {
    if (e.state !== 'applied') continue
    const s = Math.max(0, Math.min(duration, e.start))
    const t = Math.max(0, Math.min(duration, e.end))
    if (t - s <= EPS) continue
    if (e.kind === 'cut') raw.push({ start: s, end: t })
    else if (e.kind === 'shorten') {
      const keep = Math.max(0, e.value ?? 0)
      const drop = t - s - keep
      if (drop <= EPS) continue
      const mid = (s + t) / 2
      raw.push({ start: mid - drop / 2, end: mid + drop / 2 })
    }
  }
  raw.sort((a, b) => a.start - b.start)
  const out: Range[] = []
  for (const r of raw) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end + EPS) last.end = Math.max(last.end, r.end)
    else out.push({ ...r })
  }
  return out
}

/** Complement of removedRanges within [0, duration]. */
export function keptRanges(duration: number, edits: readonly Edit[]): Range[] {
  const out: Range[] = []
  let cursor = 0
  for (const r of removedRanges(duration, edits)) {
    if (r.start - cursor > EPS) out.push({ start: cursor, end: r.start })
    cursor = r.end
  }
  if (duration - cursor > EPS) out.push({ start: cursor, end: duration })
  return out
}

export function outputDuration(duration: number, edits: readonly Edit[]): number {
  return keptRanges(duration, edits).reduce((acc, r) => acc + (r.end - r.start), 0)
}

/**
 * Map a reference time to output time. A time inside a removed range maps to
 * the output point where that range was spliced out.
 */
export function toOutputTime(t: number, removed: readonly Range[]): number {
  let shift = 0
  for (const r of removed) {
    if (t >= r.end) shift += r.end - r.start
    else if (t > r.start) return r.start - shift
    else break
  }
  return t - shift
}

/** Inverse of toOutputTime for points that survive. */
export function toReferenceTime(out: number, removed: readonly Range[]): number {
  let t = out
  for (const r of removed) {
    if (t >= r.start) t += r.end - r.start
    else break
  }
  return t
}

/** True if [start, end) is entirely inside removed ranges. */
export function isRemoved(start: number, end: number, removed: readonly Range[]): boolean {
  for (const r of removed) {
    if (r.start <= start + EPS && r.end >= end - EPS) return true
  }
  return false
}

export function formatClock(sec: number, withHours = false): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const mm = String(m).padStart(2, '0')
  const rr = String(r).padStart(2, '0')
  return h > 0 || withHours ? `${h}:${mm}:${rr}` : `${mm}:${rr}`
}
