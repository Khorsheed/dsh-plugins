import type { Edit, Segment, Token } from './types.ts'

const EPS = 1e-3

/**
 * The tokens a reader sees: applied `text` edits replace the tokens they
 * cover with one token carrying the corrected text (same time span).
 * Audio is never affected — cuts still work on the original token times.
 */
export function displayTokens(seg: Segment, edits: readonly Edit[]): Token[] {
  const fixes = edits.filter((e) => e.kind === 'text' && e.state === 'applied' && e.end > seg.start - EPS && e.start < seg.end + EPS)
  if (!fixes.length) return seg.tokens
  const out: Token[] = []
  const used = new Set<Edit>()
  for (const tok of seg.tokens) {
    const fix = fixes.find((e) => e.start <= tok.start + EPS && e.end >= tok.end - EPS)
    if (!fix) {
      out.push(tok)
      continue
    }
    if (used.has(fix)) continue
    used.add(fix)
    out.push({ text: fix.text ?? '', start: fix.start, end: fix.end, kind: 'word' })
  }
  return out
}

export interface Occurrence {
  segmentId: string
  start: number
  end: number
  text: string
}

/**
 * Every occurrence of `needle` in the (displayed) transcript, as token time
 * ranges. Matching is on the concatenated text so a word split across tokens
 * (Chinese is one token per character) is found; punctuation inside the
 * needle must match literally.
 */
export function findOccurrences(transcript: readonly Segment[], edits: readonly Edit[], needle: string): Occurrence[] {
  const q = needle.trim()
  if (!q) return []
  const out: Occurrence[] = []
  for (const seg of transcript) {
    const toks = displayTokens(seg, edits)
    let text = ''
    const owner: number[] = [] // char index → token index
    toks.forEach((t, i) => {
      for (let k = 0; k < t.text.length; k++) owner.push(i)
      text += t.text
    })
    const lower = text.toLowerCase()
    const ql = q.toLowerCase()
    for (let at = lower.indexOf(ql); at >= 0; at = lower.indexOf(ql, at + ql.length)) {
      const a = toks[owner[at]!]!
      const b = toks[owner[at + ql.length - 1]!]!
      out.push({ segmentId: seg.id, start: a.start, end: b.end, text: text.slice(at, at + ql.length) })
    }
  }
  return out
}
