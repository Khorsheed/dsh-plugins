import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { delimiter, join } from 'node:path'

/**
 * ffmpeg is FOUND, not bundled: an explicit path from global settings wins,
 * then PATH, then the usual package-manager prefixes. A missing binary is a
 * designed panel state, never a boot failure.
 */
const EXTRA_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

/** Every executable candidate, configured path first, without duplicates. */
export async function findBinaries(name: string, configured?: string): Promise<string[]> {
  const candidates: string[] = []
  if (configured) candidates.push(configured)
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) candidates.push(join(dir, name))
  for (const dir of EXTRA_DIRS) candidates.push(join(dir, name))
  const out: string[] = []
  for (const c of [...new Set(candidates)]) {
    try {
      await access(c, constants.X_OK)
      out.push(c)
    } catch {
      /* next */
    }
  }
  return out
}

/** Parse `ffmpeg version 9.0.2 …` into a comparable number (0 when unknown). */
export function versionScore(banner: string): number {
  const m = /version\s+n?(\d+)\.(\d+)(?:\.(\d+))?/.exec(banner)
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3] ?? 0) : 0
}

export async function findBinary(name: string, configured?: string): Promise<string | null> {
  const candidates: string[] = []
  if (configured) candidates.push(configured)
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) candidates.push(join(dir, name))
  for (const dir of EXTRA_DIRS) candidates.push(join(dir, name))
  for (const c of candidates) {
    try {
      await access(c, constants.X_OK)
      return c
    } catch {
      /* next */
    }
  }
  return null
}

export interface RunResult {
  code: number
  stdout: Buffer
  stderr: string
}

export interface RunOptions {
  signal?: AbortSignal | undefined
  /** Called with each stderr chunk (ffmpeg reports progress on stderr). */
  onStderr?: (chunk: string) => void
  /** Keep only the tail of stderr in the result. */
  stderrLimit?: number | undefined
}

export function run(bin: string, args: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], signal: opts.signal })
    const out: Buffer[] = []
    let err = ''
    const limit = opts.stderrLimit ?? 64_000
    child.stdout.on('data', (b: Buffer) => out.push(b))
    child.stderr.on('data', (b: Buffer) => {
      const s = b.toString('utf8')
      opts.onStderr?.(s)
      err += s
      if (err.length > limit * 2) err = err.slice(-limit)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stdout: Buffer.concat(out), stderr: err.slice(-limit) }))
  })
}

export class MediaError extends Error {
  constructor(
    message: string,
    readonly detail?: string | undefined,
  ) {
    super(message)
  }
}

async function must(bin: string, args: readonly string[], opts?: RunOptions): Promise<RunResult> {
  const res = await run(bin, args, opts)
  if (res.code !== 0) {
    const tail = res.stderr.trim().split('\n').slice(-3).join(' | ')
    throw new MediaError(`${bin.split('/').pop()} 退出码 ${res.code}`, tail)
  }
  return res
}

export interface ProbeInfo {
  durationSec: number
  /** The audio stream's own length; containers often run past it (a phone MP4 by ~1 s). */
  audioDurationSec?: number | undefined
  hasAudio: boolean
  hasVideo: boolean
  sampleRate?: number | undefined
  channels?: number | undefined
  width?: number | undefined
  height?: number | undefined
  fps?: number | undefined
}

export async function probe(ffprobe: string, path: string): Promise<ProbeInfo> {
  const res = await must(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path])
  const json = JSON.parse(res.stdout.toString('utf8')) as {
    format?: { duration?: string } | undefined
    streams?: { codec_type?: string; sample_rate?: string; channels?: number; width?: number; height?: number; duration?: string; avg_frame_rate?: string; disposition?: { attached_pic?: number } }[]
  }
  const streams = json.streams ?? []
  const audio = streams.find((s) => s.codec_type === 'audio')
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const duration = Number(json.format?.duration ?? audio?.duration ?? video?.duration ?? 0)
  let fps: number | undefined
  if (video?.avg_frame_rate && video.avg_frame_rate.includes('/')) {
    const [n = 0, d = 0] = video.avg_frame_rate.split('/').map(Number)
    if (d) fps = n / d
  }
  return {
    durationSec: Number.isFinite(duration) ? duration : 0,
    audioDurationSec: audio?.duration && Number.isFinite(Number(audio.duration)) ? Number(audio.duration) : undefined,
    hasAudio: !!audio,
    hasVideo: !!video,
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : undefined,
    channels: audio?.channels,
    width: video?.width,
    height: video?.height,
    fps,
  }
}

/** Decode a stretch of audio to mono float32 PCM in memory. Keep stretches short (minutes). */
export async function decodeMono(ffmpeg: string, path: string, rate: number, startSec = 0, durationSec?: number, signal?: AbortSignal): Promise<Float32Array> {
  const args = ['-v', 'error', '-nostdin']
  if (startSec > 0) args.push('-ss', String(startSec))
  args.push('-i', path)
  if (durationSec) args.push('-t', String(durationSec))
  args.push('-vn', '-ac', '1', '-ar', String(rate), '-f', 'f32le', 'pipe:1')
  const res = await must(ffmpeg, args, { signal })
  const buf = res.stdout
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)).slice()
}

/** 16 kHz mono 16-bit WAV — the ASR / diarization input. Several paths are the legs of a continuous recording, butt-joined. */
export async function writeAsrWav(ffmpeg: string, path: string | string[], out: string, onProgress?: (sec: number) => void, signal?: AbortSignal): Promise<void> {
  const paths = Array.isArray(path) ? path : [path]
  const args = ['-v', 'error', '-stats', '-nostdin', '-y']
  for (const one of paths) args.push('-i', one)
  if (paths.length > 1) {
    const legs = paths.map((_, i) => `[${i}:a]aresample=16000,aformat=sample_rates=16000:channel_layouts=mono[l${i}]`).join(';')
    args.push('-filter_complex', `${legs};${paths.map((_, i) => `[l${i}]`).join('')}concat=n=${paths.length}:v=0:a=1[o]`, '-map', '[o]')
  } else {
    args.push('-vn')
  }
  args.push('-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out)
  await must(ffmpeg, args, {
    signal,
    onStderr: (s) => {
      const t = parseProgressTime(s)
      if (t !== null) onProgress?.(t)
    },
  })
}

/** Waveform peaks for the panel: `buckets` max-abs values over the whole file. */
export function peaksOf(samples: Float32Array, buckets: number): number[] {
  const out: number[] = new Array(buckets).fill(0)
  const per = samples.length / buckets
  for (let b = 0; b < buckets; b++) {
    let m = 0
    const from = Math.floor(b * per)
    const to = Math.min(samples.length, Math.floor((b + 1) * per))
    for (let i = from; i < to; i++) {
      const v = Math.abs(samples[i]!)
      if (v > m) m = v
    }
    out[b] = Math.round(m * 1000) / 1000
  }
  return out
}

/** Parse the last `time=HH:MM:SS.xx` in an ffmpeg stats chunk. */
export function parseProgressTime(chunk: string): number | null {
  const all = [...chunk.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)]
  const m = all[all.length - 1]
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

export interface LoudnessMeasure {
  input_i: string
  input_tp: string
  input_lra: string
  input_thresh: string
  target_offset: string
}

/** First pass of two-pass loudnorm: measure an arbitrary filtergraph's output. */
export function parseLoudnorm(stderr: string): LoudnessMeasure | null {
  const at = stderr.lastIndexOf('{')
  const end = stderr.lastIndexOf('}')
  if (at < 0 || end < at) return null
  try {
    const j = JSON.parse(stderr.slice(at, end + 1)) as Partial<LoudnessMeasure>
    if (!j.input_i || !j.input_tp || !j.input_lra || !j.input_thresh || !j.target_offset) return null
    return j as LoudnessMeasure
  } catch {
    return null
  }
}

export function loudnormFilter(target: number, measured?: LoudnessMeasure | null): string {
  const base = `loudnorm=I=${target}:TP=-1:LRA=11`
  if (!measured || !Number.isFinite(Number(measured.input_i))) return `${base}:print_format=json`
  return `${base}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true:print_format=summary`
}

export { must as runChecked }
