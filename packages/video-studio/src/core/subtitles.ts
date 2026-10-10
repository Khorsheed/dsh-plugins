import { isRemoved, toOutputTime, type Range } from './timeline.ts'
import type { Segment, Speaker, SubtitleStyle } from './types.ts'

export interface Cue {
  start: number
  end: number
  text: string
  speaker: string
}

const MAX_CHARS = 16
const BREAK_GAP = 0.6

/**
 * Subtitle cues in OUTPUT time: removed tokens are dropped, lines break at
 * punctuation, long gaps, or MAX_CHARS. Punctuation at a line end is dropped
 * (subtitle convention), inner punctuation kept.
 */
export function buildCues(transcript: readonly Segment[], speakers: readonly Speaker[], removed: readonly Range[]): Cue[] {
  const names = new Map(speakers.map((s) => [s.id, s.name || '']))
  const cues: Cue[] = []
  for (const seg of transcript) {
    let cur: { start: number; end: number; text: string } | null = null
    const flush = () => {
      if (!cur) return
      const text = cur.text.replace(/[，。、,.\s]+$/u, '').trim()
      if (text) cues.push({ start: toOutputTime(cur.start, removed), end: toOutputTime(cur.end, removed), text, speaker: names.get(seg.speakerId) ?? '' })
      cur = null
    }
    for (const tok of seg.tokens) {
      if (isRemoved(tok.start, tok.end, removed)) continue
      const punct = /^[\p{P}]+$/u.test(tok.text)
      if (cur && !punct && tok.start - cur.end > BREAK_GAP) flush()
      if (!cur) {
        if (punct) continue
        cur = { start: tok.start, end: tok.end, text: '' }
      }
      cur.text += tok.text
      cur.end = Math.max(cur.end, tok.end)
      if ((punct && /[，。？！,.?!；;]/u.test(tok.text)) || cur.text.length >= MAX_CHARS) flush()
    }
    flush()
  }
  return cues.filter((c) => c.end > c.start)
}

function srtTime(t: number): string {
  const ms = Math.max(0, Math.round(t * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const r = ms % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`
}

export function toSrt(cues: readonly Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n')
}

function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

const ASS_STYLES: Record<SubtitleStyle, string> = {
  // Name, Fontname, Fontsize, Primary, Secondary, Outline, Back, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
  standard: 'Style: Default,PingFang SC,44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,0,2,60,60,48,1',
  'big-center': 'Style: Default,PingFang SC,72,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,4,0,5,80,80,0,1',
  'bottom-bar': 'Style: Default,PingFang SC,44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H8C000000,0,0,0,0,100,100,0,0,3,10,0,2,0,0,36,1',
}

export function toAss(cues: readonly Cue[], style: SubtitleStyle, width = 1920, height = 1080): string {
  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ASS_STYLES[style],
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  const lines = cues.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${c.text.replace(/[{}\\]/g, '')}`)
  return [...head, ...lines, ''].join('\n')
}

export function toPlainText(transcript: readonly Segment[], speakers: readonly Speaker[], removed: readonly Range[]): string {
  const names = new Map(speakers.map((s) => [s.id, s.name || '未命名']))
  const out: string[] = []
  for (const seg of transcript) {
    const text = seg.tokens
      .filter((t) => !isRemoved(t.start, t.end, removed))
      .map((t) => t.text)
      .join('')
      .trim()
    if (!text) continue
    out.push(`${names.get(seg.speakerId) ?? ''}：${text}`)
  }
  return out.join('\n\n') + '\n'
}
