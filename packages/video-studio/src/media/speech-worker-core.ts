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
    if (ti < tokens.length) {
      const tokText = tokens[ti]!.text
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
    // anything else (spaces, case-folded mismatches) is dropped
  }
  while (ti < tokens.length) out.push(tokens[ti++]!)
  return out
}
