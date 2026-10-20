/**
 * The one ffmpeg job the engine has: decode media into the recognizer's
 * input, a 16 kHz mono 16-bit WAV. ffmpeg is FOUND, not bundled: a configured
 * path wins, then PATH, then the usual package-manager prefixes.
 *
 * @module @khorsheed/dsh-transcribe/ffmpeg
 */
import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { delimiter, join } from 'node:path'

const EXTRA_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

/** The first executable `name`: the configured path, then PATH, then the usual prefixes. */
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

/** Parse the last `time=HH:MM:SS.xx` in an ffmpeg stats chunk. */
export function parseProgressTime(chunk: string): number | null {
  const all = [...chunk.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)]
  const m = all[all.length - 1]
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

/**
 * Decode to a 16 kHz mono 16-bit WAV. Several paths are the legs of one
 * continuous recording, butt-joined.
 */
export function writeAsrWav(ffmpeg: string, paths: readonly string[], out: string, onProgress?: (sec: number) => void, signal?: AbortSignal, fromSec = 0): Promise<void> {
  const args = ['-v', 'error', '-stats', '-nostdin', '-y']
  // A resumed job decodes from where it stopped (seeking before the input is fast).
  for (const one of paths) {
    if (fromSec > 0 && paths.length === 1) args.push('-ss', String(fromSec))
    args.push('-i', one)
  }
  if (paths.length > 1) {
    const legs = paths.map((_, i) => `[${i}:a]aresample=16000,aformat=sample_rates=16000:channel_layouts=mono[l${i}]`).join(';')
    args.push('-filter_complex', `${legs};${paths.map((_, i) => `[l${i}]`).join('')}concat=n=${paths.length}:v=0:a=1[o]`, '-map', '[o]')
  } else {
    args.push('-vn')
  }
  args.push('-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out)
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'], signal })
    let tail = ''
    child.stderr.on('data', (b: Buffer) => {
      const s = b.toString('utf8')
      const t = parseProgressTime(s)
      if (t !== null) onProgress?.(t)
      tail = (tail + s).slice(-4000)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg 退出码 ${code}：${tail.trim().split('\n').filter((l) => !l.includes('time=')).slice(-2).join(' | ')}`))
    })
  })
}
