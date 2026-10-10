import { pauseThresholdFor } from './settings.ts'
import type { Edit, Segment, Settings, Speaker, Token } from './types.ts'

export interface ScanResult {
  edits: Omit<Edit, 'id' | 'group'>[]
  counts: { fillers: number; pauses: number; repeats: number }
  /** Seconds the output would shrink by if every proposal is applied. */
  savedSec: number
}

/** Single-character fillers are always fillers; longer ones only next to a pause or a comma. */
const EDGE_GAP = 0.25
const REPEAT_MIN = 2
/** A repeat shorter than this many characters is conversational (继续继续, 对对), not a stumble. */
const REPEAT_MIN_CHARS = 3
const REPEAT_MAX = 6

function isPunct(text: string): boolean {
  return /^[\p{P}\s]+$/u.test(text)
}

/**
 * Rule-based rough-cut scan over the transcript: fillers, long pauses (per-speaker
 * threshold, shortened rather than cut), and adjacent repeated phrases. Ranges
 * already covered by an existing non-rejected edit are skipped, so re-running
 * the scan after a partial review only proposes what is new.
 */
export function scanTranscript(
  transcript: readonly Segment[],
  speakers: readonly Speaker[],
  settings: Settings,
  existing: readonly Edit[] = [],
): ScanResult {
  const names = new Map(speakers.map((s) => [s.id, s.name]))
  const taken = existing.filter((e) => e.state !== 'rejected' && (e.kind === 'cut' || e.kind === 'shorten'))
  const covered = (s: number, t: number) => taken.some((e) => e.start <= s + 1e-3 && e.end >= t - 1e-3)
  const edits: ScanResult['edits'] = []
  const counts = { fillers: 0, pauses: 0, repeats: 0 }
  let saved = 0
  const push = (e: ScanResult['edits'][number], kind: keyof typeof counts) => {
    if (covered(e.start, e.end)) return
    edits.push(e)
    counts[kind] += 1
    saved += e.kind === 'shorten' ? Math.max(0, e.end - e.start - (e.value ?? 0)) : e.end - e.start
  }

  const fillers = [...settings.fillers].filter(Boolean).sort((a, b) => b.length - a.length)

  for (let si = 0; si < transcript.length; si++) {
    const seg = transcript[si]!
    const toks = seg.tokens.filter((t) => !isPunct(t.text))
    // index (in toks) of tokens directly followed by punctuation in the original sequence
    const punctAfter = new Set<Token>()
    seg.tokens.forEach((t, k) => {
      const next = seg.tokens[k + 1]
      if (!isPunct(t.text) && next && isPunct(next.text)) punctAfter.add(t)
    })
    const threshold = pauseThresholdFor(settings, names.get(seg.speakerId) ?? '')

    // fillers
    for (let i = 0; i < toks.length; ) {
      const match = fillers.find((f) => joined(toks, i, f.length) === f)
      if (!match) {
        i += 1
        continue
      }
      const n = match.length
      const first = toks[i]!
      const last = toks[i + n - 1]!
      const before = i === 0 ? 0 : first.start - toks[i - 1]!.end
      const after = i + n >= toks.length ? 0 : toks[i + n]!.start - last.end
      const edge = before >= EDGE_GAP || after >= EDGE_GAP || punctAfter.has(last)
      if (n === 1 || edge) {
        push({ kind: 'cut', start: first.start, end: last.end, origin: 'agent', state: 'proposed', reason: `语气词「${match}」` }, 'fillers')
      }
      i += n
    }

    // repeats: "主要是主要是主要是" → cut every occurrence but the last
    for (let i = 0; i < toks.length; i++) {
      for (let n = REPEAT_MAX; n >= REPEAT_MIN; n--) {
        if (i + 2 * n > toks.length) continue
        const a = joined(toks, i, n)
        if (a.length < REPEAT_MIN_CHARS || a !== joined(toks, i + n, n)) continue
        let j = i + n
        while (j + 2 * n <= toks.length && joined(toks, j, n) === joined(toks, j + n, n)) j += n
        // an utterance that is nothing but the repetition is an exclamation, keep it
        if (toks.length - (j + n - i) <= 1) break
        push({ kind: 'cut', start: toks[i]!.start, end: toks[j]!.start, origin: 'agent', state: 'proposed', reason: `说重复了「${a}」` }, 'repeats')
        i = j + n - 1
        break
      }
    }

    // pauses inside the segment, and the gap to the next segment
    const gaps: [number, number][] = []
    for (let i = 1; i < toks.length; i++) gaps.push([toks[i - 1]!.end, toks[i]!.start])
    const next = transcript[si + 1]
    if (next && toks.length) gaps.push([toks[toks.length - 1]!.end, next.tokens[0]?.start ?? next.start])
    for (const [s, t] of gaps) {
      if (t - s > threshold && t - s > settings.pauseKeep) {
        push({ kind: 'shorten', start: s, end: t, value: settings.pauseKeep, origin: 'agent', state: 'proposed', reason: `停顿 ${(t - s).toFixed(1)} 秒` }, 'pauses')
      }
    }
  }
  edits.sort((x, y) => x.start - y.start)
  return { edits, counts, savedSec: saved }
}

function joined(toks: readonly Token[], i: number, n: number): string {
  let s = ''
  for (let k = i; k < i + n && k < toks.length; k++) s += toks[k]!.text
  return s
}
