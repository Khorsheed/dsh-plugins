/**
 * The `transcribe` service: one queue, one job at a time, in a child process.
 *
 * A job decodes its media to a temporary WAV (unless handed one), makes sure
 * the models it needs are on disk, and runs the speech worker. Finished
 * segments reach the caller as they come (`onSegments`); the result is the
 * caller's to keep — the engine stores no transcripts, and every temporary
 * file is gone when the job ends.
 *
 * @module @khorsheed/dsh-transcribe/service
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rename, rm, rmdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { findBinary, writeAsrWav } from './ffmpeg.ts'
import { MODELS, ModelManager, modelsFor, speechModelPaths, type ModelId, type ModelSourceChoice, type ModelStatus } from './models.ts'
import { runSpeech } from './speech.ts'
import type { WorkerSegment } from './speech-protocol.ts'
import type { SpeakersRequest, SpeakersResult, TranscribeApi, TranscribeProgress, TranscribeQueueItem, TranscribeRequest, TranscribeResult, TranscribeRunOptions, TranscribeSegment } from './types.ts'

/** The engine's configuration. */
export interface TranscribeConfig {
  /** State directory (default $DSH_HOME/state/transcribe). */
  stateDir?: string
  /** An explicit ffmpeg binary. */
  ffmpegPath?: string
  /** Where models download from (default: probe both origins). */
  modelSource?: ModelSourceChoice
  /** Threads per recognizer (default 4). */
  numThreads?: number
}

interface Logger {
  info(...a: unknown[]): void
  warn(...a: unknown[]): void
}

/** $DSH_HOME, falling back to ~/.dsh like the host does. */
function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** A segment's display text from its tokens. */
export function segmentText(segment: WorkerSegment): string {
  return segment.tokens.map((t) => t.text).join('').replace(/\s+/g, ' ').trim()
}

function toSegment(segment: WorkerSegment): TranscribeSegment {
  return { cluster: segment.cluster, start: segment.start, end: segment.end, text: segmentText(segment), tokens: segment.tokens }
}

/** Overall progress bands per stage: [with speakers, without]. */
const BANDS: Record<'decode' | 'load' | 'diarize' | 'transcribe' | 'embed', [[number, number], [number, number]]> = {
  decode: [[0, 0.05], [0, 0.05]],
  load: [[0.05, 0.08], [0.05, 0.07]],
  diarize: [[0.08, 0.35], [0.07, 0.07]],
  transcribe: [[0.35, 0.95], [0.07, 1]],
  embed: [[0.95, 1], [1, 1]],
}

interface Queued {
  readonly id: string
  readonly request: TranscribeRequest
  state: 'queued' | 'running'
  wake: () => void
}

export class TranscribeService implements TranscribeApi {
  readonly root: string
  readonly modelsDir: string
  readonly manager: ModelManager
  private readonly queued: Queued[] = []
  private moved: Promise<void> | null = null
  private disposed = false
  private readonly stopping = new AbortController()

  constructor(
    private readonly config: TranscribeConfig = {},
    private readonly logger: Logger = console,
  ) {
    this.root = config.stateDir || join(dshHome(), 'state', 'transcribe')
    this.modelsDir = join(this.root, 'models')
    this.manager = new ModelManager(this.modelsDir)
    void this.sweepTemp()
  }

  /**
   * Temporary WAVs a killed process left behind (a decoded hour is hundreds
   * of MB): anything in tmp/ older than a day goes, once per start.
   */
  private async sweepTemp(): Promise<void> {
    const dir = join(this.root, 'tmp')
    const names = await readdir(dir).catch(() => [] as string[])
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    for (const name of names) {
      const path = join(dir, name)
      const info = await stat(path).catch(() => undefined)
      if (info !== undefined && info.mtimeMs < cutoff) await rm(path, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** Stop the running job and turn the queue away. */
  dispose(): void {
    this.disposed = true
    this.stopping.abort()
    for (const item of this.queued) item.wake()
  }

  /**
   * Models a video-studio install already downloaded move here once (same
   * disk, a rename): video-studio's own copy is retired with the engine.
   */
  private adoptLegacyModels(): Promise<void> {
    this.moved ??= (async () => {
      if (this.config.stateDir) return
      const legacy = join(dshHome(), 'state', 'video-studio', 'models')
      let names: string[]
      try {
        names = await readdir(legacy)
      } catch {
        return
      }
      await mkdir(this.modelsDir, { recursive: true })
      const have = new Set(await readdir(this.modelsDir))
      let count = 0
      for (const name of names) {
        if (have.has(name) || name.endsWith('.part')) continue
        await rename(join(legacy, name), join(this.modelsDir, name)).then(() => { count++ }, () => undefined)
      }
      await rmdir(legacy).catch(() => undefined)
      if (count) this.logger.info(`[transcribe] 从剪辑插件接管了 ${count} 个已下载的模型`)
    })()
    return this.moved
  }

  modelsFor(request: Pick<TranscribeRequest, 'language' | 'diarize'>): ModelId[] {
    return modelsFor(request.language ?? 'zh', !!request.diarize)
  }

  async models(): Promise<ModelStatus[]> {
    await this.adoptLegacyModels()
    return this.manager.refresh()
  }

  async missingBytes(ids: readonly ModelId[]): Promise<number> {
    const status = await this.models()
    return status.filter((s) => ids.includes(s.id) && s.state !== 'installed').reduce((sum, s) => sum + s.bytes - (s.partial ?? 0), 0)
  }

  async prepare(ids: readonly ModelId[], source?: ModelSourceChoice): Promise<void> {
    await this.adoptLegacyModels()
    await this.manager.ensure(source ?? this.config.modelSource ?? 'auto', ids)
  }

  queue(): TranscribeQueueItem[] {
    return [...this.queued]
      .sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running'))
      .map((q) => ({ id: q.id, owner: q.request.owner, state: q.state, ...(q.request.label ? { label: q.request.label } : {}) }))
  }

  /** Wait for this job's turn; a withdrawn job leaves the line. */
  private async turn(item: Queued, options: TranscribeRunOptions): Promise<void> {
    for (;;) {
      if (options.signal?.aborted) throw new Error('已取消')
      if (this.disposed) throw new Error('转写服务已停止')
      const ahead = this.queued.indexOf(item)
      if (ahead === 0) return
      options.onProgress?.({ stage: 'queued', progress: 0, ahead })
      await new Promise<void>((resolve) => {
        item.wake = resolve
        options.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
    }
  }

  private leave(item: Queued): void {
    const at = this.queued.indexOf(item)
    if (at >= 0) this.queued.splice(at, 1)
    for (const rest of this.queued) rest.wake()
  }

  async run(request: TranscribeRequest, options: TranscribeRunOptions = {}): Promise<TranscribeResult> {
    const item: Queued = { id: randomUUID(), request, state: 'queued', wake: () => {} }
    this.queued.push(item)
    try {
      await this.turn(item, options)
      item.state = 'running'
      return await this.execute(request, options)
    } finally {
      this.leave(item)
    }
  }

  async speakers(request: SpeakersRequest, options: Omit<TranscribeRunOptions, 'onSegments'> = {}): Promise<SpeakersResult> {
    const asJob: TranscribeRequest = { input: request.input, owner: request.owner, diarize: { ...(request.voices ? { voices: request.voices } : {}) }, ...(request.label ? { label: request.label } : {}) }
    const item: Queued = { id: randomUUID(), request: asJob, state: 'queued', wake: () => {} }
    this.queued.push(item)
    try {
      await this.turn(item, options)
      item.state = 'running'
      const result = await this.execute(asJob, options, { speech: request.speech })
      return { single: result.single ?? false, turns: result.turns ?? [], speakers: result.speakers }
    } finally {
      this.leave(item)
    }
  }

  private async execute(request: TranscribeRequest, options: TranscribeRunOptions): Promise<TranscribeResult>
  private async execute(request: TranscribeRequest, options: TranscribeRunOptions, speakersOnly: { speech: SpeakersRequest['speech'] }): Promise<TranscribeResult & { turns?: SpeakersResult['turns']; single?: boolean }>
  private async execute(request: TranscribeRequest, options: TranscribeRunOptions, speakersOnly?: { speech: SpeakersRequest['speech'] }): Promise<TranscribeResult & { turns?: SpeakersResult['turns']; single?: boolean }> {
    const { onProgress, onSegments } = options
    const signal = options.signal ? AbortSignal.any([options.signal, this.stopping.signal]) : this.stopping.signal
    const language = request.language ?? 'zh'
    const diarize = request.diarize ? request.diarize : null
    const band = (stage: keyof typeof BANDS, v: number): void => {
      const [a, b] = BANDS[stage][diarize ? 0 : 1]
      onProgress?.({ stage, progress: a + (b - a) * Math.max(0, Math.min(1, v)) })
    }

    // A speakers job needs only the voiceprint model and the VAD (no pyannote).
    const ids: ModelId[] = speakersOnly
      ? ['embedding', 'vad']
      : this.modelsFor(request)
    if (!(await (await this.adoptLegacyModels(), this.manager.ready(ids)))) {
      const watch = setInterval(() => {
        const rows = this.manager.list().filter((s) => ids.includes(s.id))
        const total = rows.reduce((sum, s) => sum + s.bytes, 0) || 1
        onProgress?.({ stage: 'models', progress: rows.reduce((sum, s) => sum + s.bytes * (s.state === 'installed' ? 1 : s.progress), 0) / total })
      }, 1000)
      try {
        await this.prepare(ids)
      } finally {
        clearInterval(watch)
      }
      if (!(await this.manager.ready(ids))) {
        const failed = this.manager.list().find((m) => ids.includes(m.id) && m.state === 'failed')
        throw new Error(`语音模型下载失败${failed?.error ? `：${failed.error}` : ''}`)
      }
    }
    if (signal?.aborted) throw new Error('已取消')

    let wav: string
    let temp: string | null = null
    if ('wav' in request.input) wav = request.input.wav
    else {
      const ffmpeg = await findBinary('ffmpeg', this.config.ffmpegPath)
      if (!ffmpeg) throw new Error('没有找到 ffmpeg：请安装 ffmpeg，或在插件配置里填写它的路径')
      temp = join(this.root, 'tmp', `${randomUUID()}.wav`)
      await mkdir(dirname(temp), { recursive: true })
      band('decode', 0)
      await writeAsrWav(ffmpeg, request.input.files, temp, () => band('decode', 0.5), signal)
      wav = temp
    }
    try {
      band('load', 0)
      const result = await runSpeech(
        {
          wavPath: wav,
          models: speakersOnly
            ? { ...speechModelPaths(this.modelsDir, language, true), vad: join(this.modelsDir, 'silero_vad.onnx') }
            : speechModelPaths(this.modelsDir, language, !!diarize),
          diarize: !!diarize,
          ...(speakersOnly ? { mode: 'speakers' as const, ...(speakersOnly.speech ? { speech: speakersOnly.speech.map((s) => ({ start: s.start, end: s.end })) } : {}) } : {}),
          voices: [...(diarize?.voices ?? [])],
          numSpeakers: diarize?.numSpeakers ?? -1,
          matchThreshold: diarize?.matchThreshold ?? 0.6,
          numThreads: this.config.numThreads ?? 4,
        },
        (stage, v) => band(stage, v),
        signal,
        (segments) => onSegments?.(segments.map(toSegment)),
      )
      return {
        segments: result.segments.map(toSegment),
        speakers: result.speakers,
        ...(result.language ? { language: result.language } : {}),
        ...(result.turns ? { turns: result.turns } : {}),
        ...(result.single !== undefined ? { single: result.single } : {}),
      }
    } finally {
      if (temp) await rm(temp, { force: true })
    }
  }
}

export { MODELS }
export type { TranscribeProgress }
