/**
 * Local transcription of a video or audio entry without captions, on the
 * optional `transcribe` engine (@khorsheed/dsh-transcribe).
 *
 * Opening such an entry starts a job (2026-10-20 decision: automatic on open,
 * never on feed refresh): the audio is fetched into a temporary directory —
 * yt-dlp for a video, curl for an audio URL — handed to the engine, and the
 * finished stretches render as transcript paragraphs while it runs. A job
 * still QUEUED when the reader leaves is withdrawn; a RUNNING one finishes and
 * is stored either way (`cancel` with `force`, the 字幕 switch and the 取消
 * button, stops it). The engine's first use downloads its models: the job
 * waits for one confirmation (`needs-models`) and then runs.
 *
 * The engine is restated here structurally (no code edge between the
 * packages) and probed on every start.
 *
 * @module @khorsheed/dsh-reader/local-transcribe
 */
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mergeCues, renderTranscript, type Cue } from './captions.ts'
import type { ReaderMedia } from './media.ts'
import type { LocalTranscriptState, LocalTranscriptStatus } from './types.ts'

/** The part of the `transcribe` service the reader calls. */
export interface TranscribeEngine {
  modelsFor(request: { language?: 'zh' | 'en' | 'auto'; diarize?: false }): string[]
  missingBytes(ids: readonly string[]): Promise<number>
  run(
    request: { input: { files: string[] }; language: 'zh' | 'en' | 'auto'; diarize: false; owner: string; label?: string },
    options: {
      signal?: AbortSignal
      onProgress?: (progress: { stage: string; progress: number; ahead?: number }) => void
      onSegments?: (segments: readonly EngineSegment[]) => void
    },
  ): Promise<{ segments: EngineSegment[]; language?: string }>
}

/** One finished stretch as the engine reports it. */
export interface EngineSegment {
  readonly start: number
  readonly end: number
  readonly tokens: readonly { readonly text: string; readonly start: number; readonly end: number }[]
}

/** Sentence ends in either script. */
const SENTENCE_END = /[。！？!?…]$|[^.\d]\.$/

/**
 * Engine stretches as caption-like cues: one per sentence (the engine's
 * stretches are cut at quiet points, not sentence ends), so the transcript
 * merges into the same paragraphs platform captions do.
 *
 * @param segments - the engine's segments, in order.
 */
export function cuesFromSegments(segments: readonly EngineSegment[]): Cue[] {
  const cues: Cue[] = []
  let text = ''
  let start: number | undefined
  let end = 0
  const flush = (): void => {
    const trimmed = text.replace(/\s+/g, ' ').trim()
    if (start !== undefined && trimmed !== '') cues.push({ start, end, text: trimmed })
    text = ''
    start = undefined
  }
  for (const segment of segments) {
    for (const token of segment.tokens) {
      start ??= token.start
      text += token.text
      end = token.end
      if (SENTENCE_END.test(text.trimEnd())) flush()
    }
  }
  flush()
  return cues
}

/** The marker a locally transcribed paragraph carries (the 来源 line reads it). */
export const LOCAL_MARK = 'data-src="local"'

/** The engine's segments as transcript markup, each paragraph marked local. */
export function renderLocalTranscript(segments: readonly EngineSegment[]): string {
  return renderTranscript(mergeCues(cuesFromSegments(segments))).replace(/<p data-t=/g, `<p ${LOCAL_MARK} data-t=`)
}

/**
 * The language to ask for: Bilibili and Xiaoyuzhou are Chinese (Paraformer,
 * the finer timing); anything else lets SenseVoice detect it.
 */
export function languageFor(media: ReaderMedia): 'zh' | 'auto' {
  return media.provider === 'bilibili' || media.provider === 'xiaoyuzhou' ? 'zh' : 'auto'
}

/** Fetch a URL to a file with curl (it honors the deployment's proxy environment). */
function curlTo(url: string, file: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('curl', ['-fsSL', '--retry', '2', '-o', file, url], { signal, timeout: 30 * 60_000 }, (error) => {
      if (error === null) resolve()
      else reject(new Error(`下载音频失败：${error.message.split('\n')[0] ?? ''}`))
    })
  })
}

interface Job {
  state: LocalTranscriptState
  progress: number
  ahead?: number
  segments: EngineSegment[]
  html?: string
  rendered: number
  language?: string
  error?: string
  readonly abort: AbortController
}

/** What the transcriber needs from the reader. */
export interface LocalTranscriberDeps {
  /** The engine, probed per start. */
  readonly engine: () => TranscribeEngine | undefined
  /** Where temporary audio goes. */
  readonly tmpRoot: string
  /** Fetch a video's audio track into `dir`. */
  readonly videoAudio: (url: string, dir: string, options: { signal: AbortSignal; onProgress: (fraction: number) => void }) => Promise<string>
  /** Keep the finished transcript as the entry's body. */
  readonly store: (entryId: string, url: string, html: string, language: string | undefined) => Promise<void>
}

/** Share of the progress bar the audio download takes. */
const FETCH_SHARE = 0.1

/** The reader's local transcription jobs, by entry. */
export class LocalTranscriber {
  private readonly jobs = new Map<string, Job>()

  constructor(private readonly deps: LocalTranscriberDeps) {}

  /** An entry's job as the browser sees it. */
  status(entryId: string): LocalTranscriptStatus {
    const job = this.jobs.get(entryId)
    if (job === undefined) return { entryId, state: 'idle' }
    if (job.rendered !== job.segments.length && job.state !== 'done') {
      job.html = renderLocalTranscript(job.segments)
      job.rendered = job.segments.length
    }
    return {
      entryId,
      state: job.state,
      progress: job.progress,
      ...(job.ahead === undefined ? {} : { ahead: job.ahead }),
      ...(job.html === undefined ? {} : { html: job.html }),
      ...(job.language === undefined ? {} : { language: job.language }),
      ...(job.error === undefined ? {} : { error: job.error }),
    }
  }

  /**
   * Start (or rejoin) an entry's transcription.
   *
   * @param request - the entry, its media, and whether the model download was confirmed.
   */
  async start(request: { entryId: string; url: string; media: ReaderMedia; title?: string; confirmModels?: boolean }): Promise<LocalTranscriptStatus> {
    const current = this.jobs.get(request.entryId)
    if (current !== undefined && current.state !== 'failed' && current.state !== 'done') return this.status(request.entryId)
    const engine = this.deps.engine()
    if (engine === undefined) return { entryId: request.entryId, state: 'unavailable' }
    const language = languageFor(request.media)
    const bytes = await engine.missingBytes(engine.modelsFor({ language, diarize: false }))
    if (bytes > 0 && request.confirmModels !== true) return { entryId: request.entryId, state: 'needs-models', bytes }
    const job: Job = { state: 'fetching', progress: 0, segments: [], rendered: 0, abort: new AbortController() }
    this.jobs.set(request.entryId, job)
    void this.execute(request, engine, language, job)
    return this.status(request.entryId)
  }

  /**
   * Leave or stop an entry's job: a queued (or still fetching) job is
   * withdrawn either way; a running one only with `force`.
   */
  cancel(entryId: string, force: boolean): LocalTranscriptStatus {
    const job = this.jobs.get(entryId)
    if (job === undefined) return { entryId, state: 'idle' }
    if (force || job.state === 'queued' || job.state === 'fetching') {
      job.abort.abort()
      this.jobs.delete(entryId)
      return { entryId, state: 'idle' }
    }
    return this.status(entryId)
  }

  /** Stop everything (plugin disposal). */
  dispose(): void {
    for (const job of this.jobs.values()) job.abort.abort()
    this.jobs.clear()
  }

  private async execute(request: { entryId: string; url: string; media: ReaderMedia; title?: string }, engine: TranscribeEngine, language: 'zh' | 'auto', job: Job): Promise<void> {
    const signal = job.abort.signal
    mkdirSync(this.deps.tmpRoot, { recursive: true })
    const dir = mkdtempSync(join(this.deps.tmpRoot, 'audio-'))
    try {
      let file: string
      if (request.media.kind === 'video') {
        file = await this.deps.videoAudio(request.url, dir, { signal, onProgress: (fraction) => { job.progress = FETCH_SHARE * fraction } })
      } else {
        file = join(dir, 'audio')
        await curlTo(request.media.ref, file, signal)
      }
      job.progress = FETCH_SHARE
      job.state = 'queued'
      const result = await engine.run(
        { input: { files: [file] }, language, diarize: false, owner: '@khorsheed/dsh-reader', ...(request.title === undefined ? {} : { label: request.title }) },
        {
          signal,
          onProgress: (progress) => {
            if (progress.stage === 'queued') {
              job.state = 'queued'
              if (progress.ahead === undefined) delete job.ahead
              else job.ahead = progress.ahead
              return
            }
            job.state = 'transcribing'
            delete job.ahead
            job.progress = FETCH_SHARE + (1 - FETCH_SHARE) * progress.progress
          },
          onSegments: (segments) => { job.segments.push(...segments) },
        },
      )
      const html = renderLocalTranscript(result.segments)
      if (html === '') throw new Error('没有识别出语音')
      const detected = result.language ?? (language === 'zh' ? 'zh' : undefined)
      if (detected !== undefined) job.language = detected
      await this.deps.store(request.entryId, request.url, html, detected)
      job.html = html
      job.rendered = result.segments.length
      job.segments = result.segments
      job.progress = 1
      job.state = 'done'
    } catch (error) {
      if (signal.aborted) return
      job.state = 'failed'
      job.error = error instanceof Error ? error.message : String(error)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
