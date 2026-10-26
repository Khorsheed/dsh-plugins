/**
 * Captions → the transcript a video or audio entry reads as.
 *
 * Every platform's caption file is parsed into the same flat cue list (start,
 * end, text), merged into paragraphs a person can read (sentence ends, pauses,
 * a length cap), and rendered as article markup where each paragraph carries
 * its start time. The markup is the entry's body: notes, highlights,
 * translation and the model's ¶ numbering all work on it unchanged, and the
 * player reads `data-t` to seek.
 *
 * Pure: no fs, no network — the formats are measured on real files and pinned
 * by the specs.
 *
 * @module @khorsheed/dsh-reader/captions
 */

/** One caption line. Times are seconds. */
export interface Cue {
  readonly start: number
  readonly end: number
  readonly text: string
}

/** One transcript paragraph. */
export interface TranscriptSegment {
  readonly start: number
  readonly end: number
  readonly text: string
  /** The start of every cue merged in, so a note can anchor to its line. */
  readonly lines: readonly { readonly start: number; readonly text: string }[]
}

/** Collapse whitespace and strip the markup some caption files carry. */
function clean(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Seconds from `hh:mm:ss.mmm` / `mm:ss.mmm` / `hh:mm:ss,mmm`. */
function clock(value: string): number {
  const parts = value.trim().replace(',', '.').split(':').map(Number)
  if (parts.some(part => !Number.isFinite(part))) return Number.NaN
  return parts.reduce((total, part) => total * 60 + part, 0)
}

/**
 * YouTube's `json3` captions: `events[]` with `tStartMs`, `dDurationMs` and
 * `segs[].utf8`. Auto captions also carry `aAppend` newline events and
 * word-level `tOffsetMs`; only whole events become cues.
 */
export function parseJson3(raw: string): Cue[] {
  const data = JSON.parse(raw) as { events?: { tStartMs?: number; dDurationMs?: number; aAppend?: number; segs?: { utf8?: string }[] }[] }
  const cues: Cue[] = []
  for (const event of data.events ?? []) {
    if (event.segs === undefined || event.aAppend === 1) continue
    const text = clean(event.segs.map(seg => seg.utf8 ?? '').join(''))
    if (text === '') continue
    const startMs = event.tStartMs ?? 0
    cues.push({ start: startMs / 1000, end: (startMs + (event.dDurationMs ?? 0)) / 1000, text })
  }
  return cues
}

/**
 * WebVTT. YouTube's auto captions in VTT are ROLLING: each cue repeats the
 * previous line and adds the next, with inline word timings. The rolling
 * duplicates are dropped by keeping only the text a cue adds over the one
 * before it.
 */
export function parseVtt(raw: string): Cue[] {
  const blocks = raw.replace(/\r/g, '').split(/\n\n+/)
  const cues: Cue[] = []
  let previous = ''
  for (const block of blocks) {
    const lines = block.split('\n')
    const timing = lines.findIndex(line => line.includes('-->'))
    if (timing < 0) continue
    const [from, to] = lines[timing]!.split('-->')
    const start = clock(from ?? '')
    const end = clock((to ?? '').trim().split(/\s+/)[0] ?? '')
    if (!Number.isFinite(start)) continue
    const textLines = lines.slice(timing + 1).map(line => clean(line)).filter(line => line !== '')
    let text = textLines.join(' ')
    if (text === '') continue
    if (previous !== '' && text.startsWith(previous)) text = text.slice(previous.length).trim()
    else if (textLines.length > 1 && textLines[0] === previous) text = textLines.slice(1).join(' ')
    previous = textLines[textLines.length - 1] ?? previous
    if (text === '' || (cues.length > 0 && cues[cues.length - 1]!.text === text)) continue
    cues.push({ start, end: Number.isFinite(end) ? end : start, text })
  }
  return cues
}

/** SubRip (`.srt`). */
export function parseSrt(raw: string): Cue[] {
  const cues: Cue[] = []
  for (const block of raw.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n')
    const timing = lines.findIndex(line => line.includes('-->'))
    if (timing < 0) continue
    const [from, to] = lines[timing]!.split('-->')
    const start = clock(from ?? '')
    const end = clock(to ?? '')
    const text = clean(lines.slice(timing + 1).join(' '))
    if (!Number.isFinite(start) || text === '') continue
    cues.push({ start, end: Number.isFinite(end) ? end : start, text })
  }
  return cues
}

/** Bilibili's subtitle JSON: `body[]` with `from`, `to`, `content` (seconds). */
export function parseBiliJson(raw: string): Cue[] {
  const data = JSON.parse(raw) as { body?: { from?: number; to?: number; content?: string }[] }
  return (data.body ?? []).flatMap(item => {
    const text = clean(item.content ?? '')
    if (text === '' || typeof item.from !== 'number') return []
    return [{ start: item.from, end: typeof item.to === 'number' ? item.to : item.from, text }]
  })
}

/**
 * Parse a caption file by its extension (the one yt-dlp wrote).
 *
 * @param raw - the file's text.
 * @param ext - `json3`, `vtt`, `srt` or `json`.
 */
export function parseCaptions(raw: string, ext: string): Cue[] {
  switch (ext.toLowerCase()) {
    case 'json3': return parseJson3(raw)
    case 'vtt': return parseVtt(raw)
    case 'srt': return parseSrt(raw)
    case 'json': return parseBiliJson(raw)
    default: return []
  }
}

/** True when a line ends a sentence (Latin or CJK punctuation). */
function endsSentence(text: string): boolean {
  return /[.!?。！？…]["'”’）)]?$/.test(text)
}

/** True for text that is mostly CJK (joined without spaces). */
function isCjk(text: string): boolean {
  return /[㐀-鿿]/.test(text)
}

/** The merge rules (exported for the specs). */
export const MERGE = {
  /** A paragraph closes at a sentence end once it is at least this long (seconds). */
  minSeconds: 15,
  /** …and always closes past this length, sentence end or not. */
  maxSeconds: 60,
  /** A pause this long between cues closes the paragraph too. */
  pauseSeconds: 2.5,
  /**
   * Unpunctuated captions (YouTube's automatic ones carry no punctuation at
   * all — measured 2026-10-20): close at the first pause of this length once
   * the paragraph has run {@link MERGE.bareMinSeconds}, and always by
   * {@link MERGE.bareMaxSeconds}.
   */
  barePauseSeconds: 0.7,
  bareMinSeconds: 15,
  bareMaxSeconds: 35,
  /** Below this share of sentence-ending cues, captions count as unpunctuated. */
  punctuatedShare: 0.1,
} as const

/**
 * Merge caption cues into readable paragraphs.
 *
 * Punctuated captions close a paragraph at a sentence end once it has run
 * {@link MERGE.minSeconds}, at a pause of {@link MERGE.pauseSeconds}, or past
 * {@link MERGE.maxSeconds}. Unpunctuated ones have no sentence ends to use, so
 * they close at a short pause past {@link MERGE.bareMinSeconds} — short enough
 * to point at, long enough to read as prose rather than subtitles.
 *
 * @param cues - the caption cues in time order.
 * @returns the paragraphs.
 */
export function mergeCues(cues: readonly Cue[]): TranscriptSegment[] {
  const sorted = [...cues].sort((left, right) => left.start - right.start)
  const punctuated = sorted.length > 0 && sorted.filter(cue => endsSentence(cue.text)).length / sorted.length >= MERGE.punctuatedShare
  const segments: TranscriptSegment[] = []
  let current: { start: number; end: number; lines: { start: number; text: string }[] } | undefined
  const flush = (): void => {
    if (current === undefined || current.lines.length === 0) return
    const joiner = isCjk(current.lines.map(line => line.text).join('')) ? '' : ' '
    segments.push({
      start: current.start,
      end: current.end,
      text: current.lines.map(line => line.text).join(joiner).replace(/\s+/g, ' ').trim(),
      lines: current.lines,
    })
    current = undefined
  }
  for (let index = 0; index < sorted.length; index++) {
    const cue = sorted[index]!
    if (current !== undefined && cue.start - current.end >= MERGE.pauseSeconds) flush()
    if (current === undefined) current = { start: cue.start, end: cue.end, lines: [] }
    current.lines.push({ start: cue.start, text: cue.text })
    current.end = Math.max(current.end, cue.end)
    const length = current.end - current.start
    if (punctuated) {
      if ((length >= MERGE.minSeconds && endsSentence(cue.text)) || length >= MERGE.maxSeconds) flush()
    } else {
      const next = sorted[index + 1]
      const gap = next === undefined ? Infinity : next.start - cue.end
      if ((length >= MERGE.bareMinSeconds && gap >= MERGE.barePauseSeconds) || length >= MERGE.bareMaxSeconds) flush()
    }
  }
  flush()
  return segments
}

/** `mm:ss` or `h:mm:ss`. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${String(h)}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

/** Escape text for HTML content. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * The transcript as article markup: one `<p>` per paragraph, its start time in
 * `data-t` (seconds, one decimal) — the attribute the player seeks by.
 *
 * @param segments - the merged paragraphs.
 */
export function renderTranscript(segments: readonly TranscriptSegment[]): string {
  return segments
    .map(segment => `<p data-t="${segment.start.toFixed(1)}">${escapeHtml(segment.text)}</p>`)
    .join('\n')
}
