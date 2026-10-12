import { writeFile } from 'node:fs/promises'
import type { FrameMap } from '../core/parts.ts'
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
 * A `bed` input loops under the whole episode at a low fixed level, ducked by
 * the voice (sidechaincompress, voice as the key). Output label [body].
 */
export interface AudioFormat {
  sampleRate?: number | undefined
  channels?: number | undefined
}

export function audioGraph(kept: readonly Range[], opts: { intro?: number; outro?: number; bed?: { input: number; duration: number }; source?: AudioFormat; refInputs?: number } = {}): string {
  // Segments keep the source's own format: resampling each one separately
  // loses a few ms at every splice (143 cuts came out 1.0 s short). The music
  // is converted TO the source format so concat accepts it, and the body is
  // resampled once, after the concat.
  const rate = opts.source?.sampleRate ?? 48000
  const layout = (opts.source?.channels ?? 2) === 1 ? 'mono' : 'stereo'
  const lines: string[] = []
  // a multi-leg reference: the leading inputs are the legs, butt-joined first
  const legs = opts.refInputs ?? 1
  let refLabel = '0:a'
  if (legs > 1) {
    for (let n = 0; n < legs; n++) lines.push(`[${n}:a]aresample=${rate},aformat=sample_rates=${rate}:channel_layouts=${layout}[p${n}]`)
    lines.push(`${Array.from({ length: legs }, (_, n) => `[p${n}]`).join('')}concat=n=${legs}:v=0:a=1[ref]`)
    refLabel = 'ref'
  }
  // the implicit split ffmpeg inserts for a reused label drops later legs of a
  // concat — split the joined reference explicitly when several ranges consume it
  if (legs > 1 && kept.length > 1) {
    lines.push(`[ref]asplit=${kept.length}${kept.map((_, i) => `[r${i}]`).join('')}`)
  }
  kept.forEach((r, i) => {
    const src = legs > 1 && kept.length > 1 ? `r${i}` : refLabel
    const len = r.end - r.start
    const fade = Math.min(FADE, len / 4)
    lines.push(`[${src}]atrim=start=${f(r.start)}:end=${f(r.end)},asetpts=PTS-STARTPTS,afade=t=in:d=${f(fade)},afade=t=out:st=${f(len - fade)}:d=${f(fade)}[a${i}]`)
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
  const tail = opts.bed ? '[cat]' : '[body]'
  lines.push(`${parts.join('')}concat=n=${parts.length}:v=0:a=1,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo${tail}`)
  if (opts.bed) {
    // bed ducked by the voice: the voice is the sidechain key, the bed is compressed under it
    lines.push(`[${opts.bed.input}:a]aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,atrim=duration=${f(Math.max(0.1, opts.bed.duration))},volume=0.16[bedvol]`)
    lines.push(`[cat]asplit=2[bodyA][bodyKey]`)
    lines.push(`[bedvol][bodyKey]sidechaincompress=threshold=0.02:ratio=6:attack=25:release=500[bedduck]`)
    lines.push(`[bodyA][bedduck]amix=inputs=2:normalize=0[body]`)
  }
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
 * Video+audio filtergraph: input 0 is the recording (audio), input 1 the
 * video; `frames` are snapToFrames output (video time). The picture is made
 * constant-rate first and frames are SELECTED on the grid (a count, so no
 * rounding accumulates); the audio is trimmed on the very same boundaries
 * shifted into reference time. Output labels [v] [body].
 */
export function videoGraph(frames: readonly FrameMap[], size: { w: number; h: number }, subtitles: string | undefined, source: AudioFormat | undefined, bed: { input: number; duration: number } | undefined, refInputs = 1): string {
  const lines: string[] = []
  const half = 1 / (2 * FPS)
  const expr = balancedSum(frames.map((r) => `gte(t,${f(r.video.start - half)})*lt(t,${f(r.video.end - half)})`))
  const subs = subtitles ? `,subtitles=filename='${subtitles.replace(/\\/g, '/').replace(/'/g, "\\'").replace(/:/g, '\\:')}'` : ''
  // the video input sits after the reference legs
  lines.push(`[${refInputs}:v]fps=${FPS},select='${expr}',setpts=N/${FPS}/TB,scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease,pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2,setsar=1${subs}[v]`)
  lines.push(audioGraph(frames.map((r) => r.ref), { ...(source ? { source } : {}), ...(bed ? { bed } : {}), refInputs }))
  return lines.join(';\n')
}

export interface RunExportOptions {
  ffmpeg: string
  inputs: string[]
  /** Inputs that loop forever (the bed music is usually shorter than the episode). */
  loopInputs?: number[]
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
  o.inputs.forEach((i, n) => {
    if (o.loopInputs?.includes(n)) args.push('-stream_loop', '-1')
    args.push('-i', i)
  })
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
  o.inputs.forEach((i, n) => {
    if (o.loopInputs?.includes(n)) args.push('-stream_loop', '-1')
    args.push('-i', i)
  })
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
export async function renderClip(ffmpeg: string, inputs: string[], kept: readonly Range[], scriptPath: string): Promise<Buffer> {
  if (!kept.length) return Buffer.alloc(0)
  await writeFile(scriptPath, `${audioGraph(kept, { refInputs: inputs.length })};\n[body]anull[out]`, 'utf8')
  const args = ['-nostdin', '-v', 'error']
  for (const i of inputs) args.push('-i', i)
  args.push(await scriptFlag(ffmpeg), scriptPath, '-map', '[out]', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', 'pipe:1')
  const res = await runChecked(ffmpeg, args)
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
