import { writeFile } from 'node:fs/promises'
import type { Range } from '../core/timeline.ts'
import { loudnormFilter, parseLoudnorm, parseProgressTime, runChecked, type LoudnessMeasure } from './ffmpeg.ts'

/** Each splice gets a 20 ms fade on both sides so cuts never click. */
const FADE = 0.02

const f = (n: number) => n.toFixed(3)

/**
 * Audio filtergraph: every kept range of input 0 trimmed and faded, then
 * concatenated, optionally framed by intro (input 1) and outro (next input).
 * Output label [body].
 */
export function audioGraph(kept: readonly Range[], opts: { intro?: number; outro?: number } = {}): string {
  const lines: string[] = []
  kept.forEach((r, i) => {
    const len = r.end - r.start
    const fade = Math.min(FADE, len / 4)
    lines.push(`[0:a]atrim=start=${f(r.start)}:end=${f(r.end)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,afade=t=in:d=${f(fade)},afade=t=out:st=${f(len - fade)}:d=${f(fade)}[a${i}]`)
  })
  const parts = kept.map((_, i) => `[a${i}]`)
  if (opts.intro !== undefined) {
    lines.push(`[${opts.intro}:a]aformat=sample_rates=48000:channel_layouts=stereo[intro]`)
    parts.unshift('[intro]')
  }
  if (opts.outro !== undefined) {
    lines.push(`[${opts.outro}:a]aformat=sample_rates=48000:channel_layouts=stereo[outro]`)
    parts.push('[outro]')
  }
  lines.push(`${parts.join('')}concat=n=${parts.length}:v=0:a=1[body]`)
  return lines.join(';\n')
}

/**
 * Video+audio filtergraph: input 0 is the recording (audio), input 1 the
 * video. Video time = reference time − offset. Output labels [v] [body].
 */
export function videoGraph(kept: readonly Range[], videoOffset: number, videoDuration: number, size: { w: number; h: number }, subtitles?: string): string {
  const lines: string[] = []
  const pairs: string[] = []
  kept.forEach((r, i) => {
    const len = r.end - r.start
    const fade = Math.min(FADE, len / 4)
    const vs = Math.max(0, r.start - videoOffset)
    const ve = Math.min(videoDuration, Math.max(vs + 0.04, r.end - videoOffset))
    lines.push(`[1:v]trim=start=${f(vs)}:end=${f(ve)},setpts=PTS-STARTPTS,scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease,pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`)
    lines.push(`[0:a]atrim=start=${f(r.start)}:end=${f(r.end)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,afade=t=in:d=${f(fade)},afade=t=out:st=${f(len - fade)}:d=${f(fade)}[a${i}]`)
    pairs.push(`[v${i}][a${i}]`)
  })
  // fps AFTER concat: a per-segment fps filter desyncs concat on ffmpeg 4.x (output ran 4× long)
  lines.push(`${pairs.join('')}concat=n=${kept.length}:v=1:a=1[vcat][body]`)
  const subs = subtitles ? `,subtitles=filename='${subtitles.replace(/\\/g, '/').replace(/'/g, "\\'").replace(/:/g, '\\:')}'` : ''
  lines.push(`[vcat]fps=30${subs}[v]`)
  return lines.join(';\n')
}

export interface RunExportOptions {
  ffmpeg: string
  inputs: string[]
  /** Path for the filter script (graphs can be thousands of lines). */
  scriptPath: string
  graph: string
  /** Output label → stream mapping, and codec args. */
  maps: string[]
  codecArgs: string[]
  output: string
  expectedSec: number
  onProgress?: (p: number) => void
  signal?: AbortSignal
}

async function runGraph(o: RunExportOptions, extraFilter: string, outArgs: string[], label = 'body'): Promise<string> {
  await writeFile(o.scriptPath, `${o.graph};\n[${label}]${extraFilter}[out]`, 'utf8')
  const args = ['-nostdin', '-y', '-v', 'info', '-stats']
  for (const i of o.inputs) args.push('-i', i)
  args.push('-filter_complex_script', o.scriptPath, '-map', '[out]', ...o.maps, ...outArgs)
  const res = await runChecked(o.ffmpeg, args, {
    signal: o.signal,
    stderrLimit: 200_000,
    onStderr: (s) => {
      const t = parseProgressTime(s)
      if (t !== null && o.expectedSec > 0) o.onProgress?.(Math.min(1, t / o.expectedSec))
    },
  })
  return res.stderr
}

/** Two-pass loudnorm audio export (podcast MP3). */
export async function exportAudio(o: RunExportOptions, target: number): Promise<void> {
  const half = (p: number) => o.onProgress?.(p / 2)
  const err = await runGraph({ ...o, onProgress: half }, loudnormFilter(target), ['-f', 'null', '-'])
  const measured: LoudnessMeasure | null = parseLoudnorm(err)
  await runGraph({ ...o, onProgress: (p) => o.onProgress?.(0.5 + p / 2) }, `${loudnormFilter(target, measured)},aresample=48000`, [...o.codecArgs, o.output])
}

/** Single-pass video export: the [v] label carries the picture, [body] the audio. */
export async function exportVideo(o: RunExportOptions, target: number): Promise<void> {
  await writeFile(o.scriptPath, `${o.graph};\n[body]${loudnormFilter(target).replace(':print_format=json', '')},aresample=48000[aout]`, 'utf8')
  const args = ['-nostdin', '-y', '-v', 'info', '-stats']
  for (const i of o.inputs) args.push('-i', i)
  args.push('-filter_complex_script', o.scriptPath, '-map', '[v]', '-map', '[aout]', ...o.maps, ...o.codecArgs, o.output)
  await runChecked(o.ffmpeg, args, {
    signal: o.signal,
    onStderr: (s) => {
      const t = parseProgressTime(s)
      if (t !== null && o.expectedSec > 0) o.onProgress?.(Math.min(1, t / o.expectedSec))
    },
  })
}

/** Short MP3 preview of a reference-time window with cuts applied (for ▶ in the panel). */
export async function renderClip(ffmpeg: string, input: string, kept: readonly Range[], scriptPath: string): Promise<Buffer> {
  if (!kept.length) return Buffer.alloc(0)
  await writeFile(scriptPath, `${audioGraph(kept)};\n[body]anull[out]`, 'utf8')
  const res = await runChecked(ffmpeg, ['-nostdin', '-v', 'error', '-i', input, '-filter_complex_script', scriptPath, '-map', '[out]', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', 'pipe:1'])
  return res.stdout
}

/** Clamp `kept` to a window [from, to). */
export function windowOf(kept: readonly Range[], from: number, to: number): Range[] {
  const out: Range[] = []
  for (const r of kept) {
    const s = Math.max(r.start, from)
    const e = Math.min(r.end, to)
    if (e - s > 0.03) out.push({ start: s, end: e })
  }
  return out
}

export async function hasFilter(ffmpeg: string, name: string): Promise<boolean> {
  try {
    const res = await runChecked(ffmpeg, ['-hide_banner', '-filters'])
    return new RegExp(`^\\s*\\S+\\s+${name}\\s`, 'm').test(res.stdout.toString('utf8'))
  } catch {
    return false
  }
}
