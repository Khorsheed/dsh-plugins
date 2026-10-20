/**
 * Pure pieces of the speech worker (no sherpa, no IPC), so they can be unit
 * tested: turn merging, speaker consolidation, punctuation re-attachment.
 */
import { cosine, type WorkerToken } from './speech-protocol.ts'

/** Same-speaker turns closer than this are one turn. */
export const MERGE_GAP_SEC = 0.5

export interface Turn {
  cluster: number
  start: number
  end: number
}

/**
 * Merge consecutive turns of the same speaker separated by short gaps, and
 * resolve overlaps between different speakers: in a mixed recording the
 * overlapped audio is one signal, so it is transcribed once — it stays with
 * the earlier turn, the later one starts where that ends (or is dropped when
 * fully contained).
 */
export function mergeTurns(list: Turn[]): Turn[] {
  const out: Turn[] = []
  for (const turn of [...list].sort((a, b) => a.start - b.start)) {
    const r = { ...turn }
    const last = out[out.length - 1]
    if (last && last.cluster === r.cluster && r.start - last.end <= MERGE_GAP_SEC) {
      last.end = Math.max(last.end, r.end)
      continue
    }
    if (last && r.start < last.end) {
      if (r.end <= last.end + 0.05) continue
      r.start = last.end
    }
    out.push(r)
  }
  return out
}

/** A cluster with less speech than this is a fragment, not yet a person. */
const MIN_SPEAKER_SEC = 8
/** Two substantial clusters this similar are one person split in two. */
const SAME_SPEAKER = 0.72
/** A fragment joins its nearest substantial cluster if at least this similar. */
const FRAGMENT_JOIN = 0.2

/**
 * Pyannote + fast clustering over-splits real recordings (a 19-minute online
 * meeting came back as 55 "speakers"). Re-cluster on CAM++ embeddings: merge
 * near-identical substantial clusters, then fold short fragments into their
 * nearest substantial voice. Pure apart from the injected embedder.
 */
export function consolidate(turns: Turn[], embedOf: (turns: Turn[], cluster: number) => Float32Array | null): Turn[] {
  let list = turns
  const secOf = (c: number) => list.filter((t) => t.cluster === c).reduce((a, t) => a + (t.end - t.start), 0)
  // 1) merge substantial clusters that are the same voice (greedy, most similar first)
  for (;;) {
    const big = [...new Set(list.map((t) => t.cluster))].filter((c) => secOf(c) >= MIN_SPEAKER_SEC)
    const vecs = new Map(big.map((c) => [c, embedOf(list, c)]))
    let best: [number, number, number] | null = null
    for (let i = 0; i < big.length; i++) {
      for (let j = i + 1; j < big.length; j++) {
        const a = vecs.get(big[i]!)
        const b = vecs.get(big[j]!)
        if (!a || !b) continue
        const sim = cosine(a, b)
        if (sim >= SAME_SPEAKER && (!best || sim > best[2])) best = [big[i]!, big[j]!, sim]
      }
    }
    if (!best) break
    const [keep, drop] = secOf(best[0]) >= secOf(best[1]) ? [best[0], best[1]] : [best[1], best[0]]
    list = mergeTurns(list.map((t) => (t.cluster === drop ? { ...t, cluster: keep } : t)))
  }
  // 2) fold fragments into the nearest substantial voice
  const clusters = [...new Set(list.map((t) => t.cluster))]
  const big = clusters.filter((c) => secOf(c) >= MIN_SPEAKER_SEC)
  if (!big.length) return list
  const bigVecs = new Map(big.map((c) => [c, embedOf(list, c)]))
  const moves = new Map<number, number>()
  for (const c of clusters) {
    if (big.includes(c)) continue
    const v = embedOf(list, c)
    let target = -1
    let bestSim = FRAGMENT_JOIN
    for (const b of big) {
      const bv = bigVecs.get(b)
      if (!v || !bv) continue
      const sim = cosine(v, bv)
      if (sim >= bestSim) {
        bestSim = sim
        target = b
      }
    }
    if (target >= 0) moves.set(c, target)
  }
  return mergeTurns(list.map((t) => (moves.has(t.cluster) ? { ...t, cluster: moves.get(t.cluster)! } : t)))
}

/** Re-insert punctuation from the punctuated string into the token list. */
export function attachPunctuation(tokens: WorkerToken[], punctuated: string): WorkerToken[] {
  const out: WorkerToken[] = []
  let ti = 0
  let consumed = '' // characters of tokens[ti] matched so far
  for (const ch of punctuated) {
    if (/\s/.test(ch)) continue
    if (ti < tokens.length) {
      const tokText = tokens[ti]!.text
      // a token's own spacing (a Latin word's leading space) is not text to match
      while (/\s/.test(tokText[consumed.length] ?? '')) consumed += tokText[consumed.length]
      const want = tokText.slice(consumed.length)
      const head = want[0]
      if (head !== undefined && ch.toLowerCase() === head.toLowerCase()) {
        consumed += head
        if (consumed.length >= tokText.length) {
          out.push(tokens[ti]!)
          ti += 1
          consumed = ''
        }
        continue
      }
    }
    const prev = out[out.length - 1]
    if (/[\p{P}]/u.test(ch) && prev) {
      out.push({ text: ch, start: prev.end, end: prev.end })
    }
    // anything else (case-folded mismatches) is dropped
  }
  while (ti < tokens.length) out.push(tokens[ti++]!)
  return out
}

/** A stretch handed to the recognizer (seconds), and the pause before it. */
export interface PlannedChunk {
  start: number
  end: number
  /** Silence between the previous chunk's speech and this one's (0 for a cut inside speech). */
  gapBefore: number
}

/**
 * Group voice-activity segments into recognizer chunks of at most `maxSec`,
 * cutting in the LONGEST pause that leaves a chunk of at least `minSec` — a
 * long pause is where a sentence most likely ended. A chunk cut mid-speech
 * makes the recognizer close a sentence that did not end (SenseVoice puts a
 * period at every chunk end), so where to cut matters more than how evenly.
 * A single segment longer than `maxSec` comes back as one over-long chunk;
 * the caller splits it.
 */
export function planChunks(speech: readonly { start: number; end: number }[], maxSec = 25, minSec = 8): PlannedChunk[] {
  const out: PlannedChunk[] = []
  let group: { start: number; end: number }[] = []
  let gapBefore = 0
  for (const seg of speech) {
    while (group.length > 0 && seg.end - group[0]!.start > maxSec) {
      let cut = group.length - 1
      let widest = -1
      for (let k = 0; k < group.length; k++) {
        const next = k + 1 < group.length ? group[k + 1]!.start : seg.start
        const gap = next - group[k]!.end
        if (group[k]!.end - group[0]!.start >= minSec && gap >= widest) {
          widest = gap
          cut = k
        }
      }
      const next = cut + 1 < group.length ? group[cut + 1]!.start : seg.start
      out.push({ start: group[0]!.start, end: group[cut]!.end, gapBefore })
      gapBefore = next - group[cut]!.end
      group = group.slice(cut + 1)
    }
    group.push(seg)
  }
  if (group.length > 0) out.push({ start: group[0]!.start, end: group[group.length - 1]!.end, gapBefore })
  return out
}

/** Below this pause a chunk boundary is not a sentence end. */
export const SEAM_GAP_SEC = 0.35

/**
 * Undo the sentence end a recognizer invented at a chunk boundary: the
 * previous chunk's closing period goes, and the next chunk's capital (a
 * sentence start, as far as the recognizer knew) is lowered — "another." +
 * "Entity is…" reads "another entity is…" again. Only periods: a question
 * mark is the speaker's, not the boundary's. Mutates both lists.
 */
export function repairSeam(prev: WorkerToken[], next: WorkerToken[]): void {
  const last = prev[prev.length - 1]
  if (!last) return
  if (/^\s*[.。]$/.test(last.text)) prev.pop()
  else if (/[^.\s][.。]$/.test(last.text)) prev[prev.length - 1] = { ...last, text: last.text.slice(0, -1) }
  else return
  const first = next[0]
  // "I", "I'm" and acronyms keep their capitals.
  if (first && /^\s?[A-Z][a-z]/.test(first.text) && !/^\s?I'/.test(first.text)) {
    const at = first.text.search(/[A-Z]/)
    next[0] = { ...first, text: first.text.slice(0, at) + first.text[at]!.toLowerCase() + first.text.slice(at + 1) }
  }
}
