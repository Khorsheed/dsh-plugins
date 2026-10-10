/**
 * The 文稿 tab's player: plays the reference recording either as the edit
 * will sound (kept ranges back to back, a short fade at every splice) or as
 * recorded. Audio comes from the host as raw 16 kHz PCM chunks read straight
 * out of the cached WAV, so chunks join sample-exactly and Web Audio can
 * schedule the ranges gaplessly.
 */
import type { Range } from '../core/timeline.ts'

export interface PcmChunk {
  sampleRate: number
  start: number
  samples: string
  ended: boolean
}

export type ChunkLoader = (start: number, duration: number) => Promise<PcmChunk>

const CHUNK_SEC = 20
const LOOKAHEAD_SEC = 2.5
const FADE_SEC = 0.012

interface Scheduled {
  when: number
  refStart: number
  dur: number
  node: AudioBufferSourceNode
}

function decode(base64: string): Float32Array {
  const bin = atob(base64)
  const n = bin.length >> 1
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)
    if (v >= 0x8000) v -= 0x10000
    out[i] = v / 0x8000
  }
  return out
}

export class TranscriptPlayer {
  private ctx: AudioContext | null = null
  private readonly chunks = new Map<number, Promise<Float32Array>>()
  private rate = 16000
  private ranges: Range[] = []
  private queue: Scheduled[] = []
  /** Next reference time to schedule from. */
  private cursor = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private playing = false
  private lastRef = 0

  constructor(
    private readonly load: ChunkLoader,
    private readonly onEnd: () => void,
  ) {}

  get isPlaying(): boolean {
    return this.playing
  }

  /** The ranges to play (kept ranges for the edit, [0, duration] for the original). */
  setRanges(ranges: Range[]): void {
    const now = this.currentRef()
    this.ranges = ranges
    if (this.playing) this.play(now)
  }

  /** Reference time being heard now. */
  currentRef(): number {
    if (!this.ctx || !this.playing) return this.lastRef
    const t = this.ctx.currentTime
    for (const s of this.queue) {
      if (t >= s.when && t < s.when + s.dur) return (this.lastRef = s.refStart + (t - s.when))
    }
    const past = this.queue.filter((s) => s.when + s.dur <= t).pop()
    return past ? (this.lastRef = past.refStart + past.dur) : this.lastRef
  }

  play(fromRef: number): void {
    this.stopNodes()
    this.ctx ??= new AudioContext()
    void this.ctx.resume()
    this.playing = true
    this.lastRef = fromRef
    this.cursor = this.snapForward(fromRef)
    this.nextWhen = this.ctx.currentTime + 0.08
    void this.pump()
    this.timer = setInterval(() => void this.pump(), 200)
  }

  /** Move the play position; keeps playing if it was. */
  seek(ref: number): void {
    if (this.playing) this.play(ref)
    else this.lastRef = ref
  }

  pause(): void {
    this.lastRef = this.currentRef()
    this.playing = false
    this.stopNodes()
  }

  dispose(): void {
    this.pause()
    void this.ctx?.close()
    this.ctx = null
  }

  private nextWhen = 0
  private pumping = false

  /** First playable reference time at or after t. */
  private snapForward(t: number): number {
    for (const r of this.ranges) {
      if (t < r.end) return Math.max(t, r.start)
    }
    return Infinity
  }

  private chunk(index: number): Promise<Float32Array> {
    let c = this.chunks.get(index)
    if (!c) {
      c = this.load(index * CHUNK_SEC, CHUNK_SEC).then((res) => {
        this.rate = res.sampleRate
        return decode(res.samples)
      })
      c.catch(() => this.chunks.delete(index))
      this.chunks.set(index, c)
    }
    return c
  }

  private async samples(start: number, end: number): Promise<Float32Array<ArrayBuffer>> {
    const first = Math.floor(start / CHUNK_SEC)
    const last = Math.floor((end - 1e-6) / CHUNK_SEC)
    const parts = await Promise.all(Array.from({ length: last - first + 1 }, (_, k) => this.chunk(first + k)))
    const out = new Float32Array(Math.max(0, Math.round((end - start) * this.rate)))
    let pos = 0
    parts.forEach((pcm, k) => {
      const base = (first + k) * CHUNK_SEC
      const a = Math.max(0, Math.round((start - base) * this.rate))
      const b = Math.min(pcm.length, Math.round((end - base) * this.rate))
      if (b > a) {
        const slice = pcm.subarray(a, b)
        out.set(slice.subarray(0, Math.min(slice.length, out.length - pos)), pos)
        pos += slice.length
      }
    })
    return out
  }

  private async pump(): Promise<void> {
    if (this.pumping || !this.playing || !this.ctx) return
    this.pumping = true
    try {
      const ctx = this.ctx
      while (this.playing && this.nextWhen - ctx.currentTime < LOOKAHEAD_SEC) {
        if (!Number.isFinite(this.cursor)) {
          if (!this.queue.some((s) => s.when + s.dur > ctx.currentTime)) {
            this.playing = false
            this.stopTimer()
            this.onEnd()
          }
          return
        }
        const range = this.ranges.find((r) => this.cursor >= r.start - 1e-6 && this.cursor < r.end)
        if (!range) {
          this.cursor = this.snapForward(this.cursor)
          continue
        }
        // schedule at most one chunk's worth at a time
        const end = Math.min(range.end, this.cursor + CHUNK_SEC / 2)
        const pcm = await this.samples(this.cursor, end)
        if (!this.playing || this.ctx !== ctx) return
        if (pcm.length < 2) {
          this.cursor = end >= range.end ? this.snapForward(range.end) : end
          continue
        }
        const buffer = ctx.createBuffer(1, pcm.length, this.rate)
        buffer.copyToChannel(pcm, 0)
        const node = ctx.createBufferSource()
        node.buffer = buffer
        const gain = ctx.createGain()
        const when = Math.max(this.nextWhen, ctx.currentTime + 0.02)
        const dur = buffer.duration
        // fade only at real splices (range edges), not at chunk joins inside a range
        const splitIn = Math.abs(this.cursor - range.start) < 1e-6
        const splitOut = end >= range.end - 1e-6
        gain.gain.setValueAtTime(splitIn ? 0 : 1, when)
        if (splitIn) gain.gain.linearRampToValueAtTime(1, when + FADE_SEC)
        if (splitOut) {
          gain.gain.setValueAtTime(1, when + Math.max(FADE_SEC, dur - FADE_SEC))
          gain.gain.linearRampToValueAtTime(0, when + dur)
        }
        node.connect(gain).connect(ctx.destination)
        node.start(when)
        this.queue.push({ when, refStart: this.cursor, dur, node })
        this.queue = this.queue.filter((s) => s.when + s.dur > ctx.currentTime - 5)
        this.nextWhen = when + dur
        this.cursor = splitOut ? this.snapForward(range.end) : end
      }
    } finally {
      this.pumping = false
    }
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private stopNodes(): void {
    this.stopTimer()
    for (const s of this.queue) {
      try {
        s.node.stop()
      } catch {
        /* already stopped */
      }
    }
    this.queue = []
  }
}
