import { writeFile } from 'node:fs/promises'
import type { Range } from '../core/timeline.ts'
import { loudnormFilter, parseLoudnorm, parseProgressTime, run, runChecked, versionScore, type LoudnessMeasure } from './ffmpeg.ts'

const scriptFlags = new Map<string, Promise<string>>()

/**
 * How this ffmpeg reads a filtergraph from a file: `-/filter_complex <file>`
 * since 7.0 (9.x removed `-filter_complex_script`), the old flag before.
 */
export function scriptFlag(ffmpeg: string): Promise<string> {
  let flag = scriptFlags.get(ffmpeg)
  if (!flag) {
    flag = run(ffmpeg, ['-hide_banner', '-version']).then(
      (r) => (versionScore(r.stdout.toString('utf8')) >= 70000 ? '-/filter_complex' : '-filter_complex_script'),
      () => '-filter_complex_script',
    )
    scriptFlags.set(ffmpeg, flag)
  }
  return flag
}

/** Each splice gets a 20 ms fade on both sides so cuts never click. */
const FADE = 0.02

const f = (n: number) => n.toFixed(3)

/**
 * Audio filtergraph: every kept range of input 0 trimmed and faded, then
 * concatenated, optionally framed by intro (input 1) and outro (next input).
 * Output label [body].
 */
export interface AudioFormat {
  sampleRate?: number | undefined
  channels?: number | undefined
}

export function audioGraph(kept: readonly Range[], opts: { intro?: number; outro?: number; source?: AudioFormat } = {}): string {
  // Segments keep the source's own format: resampling each one separately
  // loses a few ms at every splice (143 cuts came out 1.0 s short). The music
  // is converted TO the source format so concat accepts it, and the body is
  // resampled once, after the concat.
  const rate = opts.source?.sampleRate ?? 48000
  const layout = (opts.source?.channels ?? 2) === 1 ? 'mono' : 'stereo'
  const lines: string[] = []
  kept.forEach((r, i) => {
    const len = r.end - r.start
    const fade = Math.min(FADE, len / 4)
    lines.push(`[0:a]atrim=start=${f(r.start)}:end=${f(r.end)},asetpts=PTS-STARTPTS,afade=t=in:d=${f(fade)},afade=t=out:st=${f(len - fade)}:d=${f(fade)}[a${i}]`)
  })
  const parts = kept.map((_, i) => `[a${i}]`)
  if (opts.intro !== undefined) {
    lines.push(`[${opts.intro}:a]aresample=${rate},aformat=sample_rates=${rate}:channel_layouts=${layout}[intro]`)
    parts.unshift('[intro]')
  }
  if (opts.outro !== undefined) {
    lines.push(`[${opts.outro}:a]aresample=${rate},aformat=sample_rates=${rate}:channel_layouts=${layout}[outro]`)
    parts.push('[outro]')
  }
  lines.push(`${parts.join('')}concat=n=${parts.length}:v=0:a=1,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[body]`)
  return lines.join(';\n')
}

const FPS = 30

/**
 * `a+b+c+…` as a balanced tree: ffmpeg's expression parser recurses per
 * operator, and a flat sum of ~140 terms fails with "Cannot allocate memory".
 */
export function balancedSum(terms: readonly string[]): string {
  if (!terms.length) return '0'
  if (terms.length === 1) return terms[0]!
  const mid = terms.length >> 1
  return `(${balancedSum(terms.slice(0, mid))}+${balancedSum(terms.slice(mid))})`
}

/**
 * Kept ranges snapped to the output frame grid (in VIDEO time), so a range's
 * audio and picture have exactly the same length. Without the snap every
 * splice rounds the picture up to a whole frame: 143 cuts on a variable-
 * frame-rate phone recording drifted the picture 0.77 s past the audio.
 */
export function snapToFrames(kept: readonly Range[], videoOffset: number, videoDuration: number, fps = FPS): Range[] {
  const out: Range[] = []
  for (const r of kept) {
    const vs = Math.max(0, Math.round((r.start - videoOffset) * fps) / fps)
    const ve = Math.min(Math.floor(videoDuration * fps) / fps, Math.round((r.end - videoOffset) * fps) / fps)
    if (ve - vs >= 1 / fps) out.push({ start: vs, end: ve })
  }
  return out
}

/**
 * Video+audio filtergraph: input 0 is the recording (audio), input 1 the
 * video; `frames` are snapToFrames output (video time). The picture is made
 * constant-rate first and frames are SELECTED on the grid (a count, so no
 * rounding accumulates); the audio is trimmed on the very same boundaries
 * shifted into reference time. Output labels [v] [body].
 */
export function videoGraph(frames: readonly Range[], videoOffset: number, size: { w: number; h: number }, subtitles?: string, source?: AudioFormat): string {
  const lines: string[] = []
  const half = 1 / (2 * FPS)
  const expr = balancedSum(frames.map((r) => `gte(t,${f(r.start - half)})*lt(t,${f(r.end - half)})`))
  const subs = subtitles ? `,subtitles=filename='${subtitles.replace(/\\/g, '/').replace(/'/g, "\\'").replace(/:/g, '\\:')}'` : ''
  lines.push(`[1:v]fps=${FPS},select='${expr}',setpts=N/${FPS}/TB,scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease,pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2,setsar=1${subs}[v]`)
  lines.push(audioGraph(frames.map((r) => ({ start: r.start + videoOffset, end: r.end + videoOffset })), source ? { source } : {}))
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
  args.push(await scriptFlag(o.ffmpeg), o.scriptPath, '-map', '[out]', ...o.maps, ...outArgs)
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
  args.push(await scriptFlag(o.ffmpeg), o.scriptPath, '-map', '[v]', '-map', '[aout]', ...o.maps, ...o.codecArgs, o.output)
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
  const res = await runChecked(ffmpeg, ['-nostdin', '-v', 'error', '-i', input, await scriptFlag(ffmpeg), scriptPath, '-map', '[out]', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', 'pipe:1'])
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
