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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mergeCues, renderTranscript, type Cue } from './captions.ts'
import type { ReaderMedia } from './media.ts'
import type { LocalTranscriptState, LocalTranscriptStatus } from './types.ts'

/** The part of the `transcribe` service the reader calls. */
export interface TranscribeEngine {
  modelsFor(request: { language?: 'zh' | 'en' | 'auto'; diarize?: false }): string[]
  missingBytes(ids: readonly string[]): Promise<number>
  run(
    request: { input: { files: string[] }; fromSec?: number; language: 'zh' | 'en' | 'auto'; diarize: false; owner: string; label?: string },
    options: {
      signal?: AbortSignal
      onProgress?: (progress: { stage: string; progress: number; ahead?: number }) => void
      onSegments?: (segments: readonly EngineSegment[]) => void
    },
  ): Promise<{ segments: EngineSegment[]; language?: string }>
  /** Who spoke when (an engine older than this has none: transcripts stay one voice). */
  speakers?(
    request: { input: { files: string[] }; speech?: { start: number; end: number }[]; owner: string; label?: string },
    options: { signal?: AbortSignal; onProgress?: (progress: { stage: string; progress: number; ahead?: number }) => void },
  ): Promise<{ single: boolean; turns: { cluster: number; start: number; end: number }[] }>
}

/** A speaker turn as the engine reports it. */
export interface EngineTurn {
  readonly cluster: number
  readonly start: number
  readonly end: number
}

/** One finished stretch as the engine reports it. */
export interface EngineSegment {
  readonly start: number
  readonly end: number
  readonly tokens: readonly { readonly text: string; readonly start: number; readonly end: number }[]
}

/** Sentence ends in either script. */
const SENTENCE_END = /[。！？!?…]$|[^.\d]\.$/

/** A run-on sentence (SenseVoice punctuates English sparsely) closes at a comma past this long (s)… */
const LONG_AT_COMMA_SEC = 20
/** …at a pause between words past this long… */
const LONG_AT_PAUSE_SEC = 30
/** …and in any case by this. */
const LONGEST_CUE_SEC = 45

/**
 * Engine stretches as caption-like cues: one per sentence (the engine's
 * stretches are cut at pauses, not sentence ends), so the transcript merges
 * into the same paragraphs platform captions do. A sentence that runs on
 * without a period is closed at a comma or a pause once it is long, or a
 * single cue would make a minute-and-a-half paragraph (measured 2026-10-20).
 *
 * @param segments - the engine's segments, in order.
 */
export function cuesFromSegments(segments: readonly EngineSegment[], speakers?: readonly (number | undefined)[]): (Cue & { speaker?: number })[] {
  const cues: (Cue & { speaker?: number })[] = []
  let text = ''
  let start: number | undefined
  let end = 0
  let speaker: number | undefined
  const flush = (): void => {
    const trimmed = text.replace(/\s+/g, ' ').trim()
    if (start !== undefined && trimmed !== '') cues.push({ start, end, text: trimmed, ...(speaker === undefined ? {} : { speaker }) })
    text = ''
    start = undefined
  }
  const tokens = segments.flatMap(segment => segment.tokens)
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    // A new voice starts a new cue (and so a new paragraph).
    const voice = speakers?.[index]
    if (voice !== undefined && voice !== speaker) {
      flush()
      speaker = voice
    }
    start ??= token.start
    text += token.text
    end = token.end
    const length = end - start
    const next = tokens[index + 1]
    if (SENTENCE_END.test(text.trimEnd())
      || (length >= LONG_AT_COMMA_SEC && /[,，、;；]$/.test(token.text.trim()))
      || (length >= LONG_AT_PAUSE_SEC && next !== undefined && next.start - token.end >= 0.4)
      || length >= LONGEST_CUE_SEC) flush()
  }
  flush()
  return cues
}

/** A run of one voice shorter than this is the diarizer flickering, not a turn (s). */
const MIN_TURN_SEC = 2.5

/**
 * Each token's speaker, as an index in order of first appearance (A, B, …):
 * the turn covering the token's middle, else the nearest one; then runs of a
 * voice shorter than {@link MIN_TURN_SEC} are folded into the voice before
 * them — a diarizer's boundary wobble would otherwise split sentences.
 *
 * @param segments - the transcript's segments.
 * @param turns - the engine's turns.
 */
export function speakerPerToken(segments: readonly EngineSegment[], turns: readonly EngineTurn[]): number[] {
  const sorted = [...turns].sort((a, b) => a.start - b.start)
  const order = new Map<number, number>()
  const tokens = segments.flatMap(segment => segment.tokens)
  const raw = tokens.map(token => {
    const at = (token.start + token.end) / 2
    let best: EngineTurn | undefined
    let distance = Infinity
    for (const turn of sorted) {
      const d = at < turn.start ? turn.start - at : at > turn.end ? at - turn.end : 0
      if (d < distance) { distance = d; best = turn }
      if (turn.start > at + distance) break
    }
    return best?.cluster ?? -1
  })
  // Fold flickers: a run shorter than the minimum takes the previous voice.
  const out = [...raw]
  let runStart = 0
  for (let index = 1; index <= out.length; index++) {
    if (index < out.length && out[index] === out[runStart]) continue
    const length = (tokens[index - 1]?.end ?? 0) - (tokens[runStart]?.start ?? 0)
    if (runStart > 0 && length < MIN_TURN_SEC) for (let k = runStart; k < index; k++) out[k] = out[runStart - 1]!
    runStart = index
  }
  // Punctuation belongs to the word before it, never opens the next voice's paragraph.
  for (let index = 1; index < out.length; index++) {
    if (/^\s*[\p{P}]+\s*$/u.test(tokens[index]!.text)) out[index] = out[index - 1]!
  }
  return out.map(cluster => {
    if (!order.has(cluster)) order.set(cluster, order.size)
    return order.get(cluster)!
  })
}

/** Escape text for HTML content. */
function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * The transcript with its speakers: paragraphs never cross a change of voice,
 * and each carries `data-spk` (the speaker's index) beside its `data-t`.
 */
export function renderSpeakerTranscript(segments: readonly EngineSegment[], turns: readonly EngineTurn[]): string {
  const cues = cuesFromSegments(segments, speakerPerToken(segments, turns))
  const out: string[] = []
  let run: (Cue & { speaker?: number })[] = []
  const flush = (): void => {
    const speaker = run[0]?.speaker
    for (const paragraph of mergeCues(run)) {
      out.push(`<p ${LOCAL_MARK} data-spk="${String(speaker ?? 0)}" data-t="${paragraph.start.toFixed(1)}">${escapeText(paragraph.text)}</p>`)
    }
    run = []
  }
  for (const cue of cues) {
    if (run.length > 0 && cue.speaker !== run[0]!.speaker) flush()
    run.push(cue)
  }
  flush()
  return out.join('\n')
}

/** The marker a locally transcribed paragraph carries (the 来源 line reads it). */
export const LOCAL_MARK = 'data-src="local"'

/** The engine's segments as transcript markup, each paragraph marked local. */
export function renderLocalTranscript(segments: readonly EngineSegment[]): string {
  return renderTranscript(mergeCues(cuesFromSegments(segments))).replace(/<p data-t=/g, `<p ${LOCAL_MARK} data-t=`)
}

/**
 * The language to ask for: always detection (SenseVoice). Measured
 * 2026-10-20: a platform says nothing reliable about the spoken language — a
 * Bilibili upload of an English interview came out of the Chinese model as
 * lower-case English with Chinese punctuation — and on Chinese speech
 * SenseVoice reads about as well as Paraformer (a 90 s sample: each missed
 * two or three characters the other got right).
 */
export function languageFor(_media: ReaderMedia): 'auto' {
  return 'auto'
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
  speakers?: number
  speakersError?: string
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
  /** How often a restart checks for the engine before resuming jobs (ms; default 2 s). */
  readonly resumePollMs?: number
  /** Keep the finished transcript as the entry's body (`speakers`: how many voices, once known). */
  readonly store: (entryId: string, url: string, html: string, language: string | undefined, speakers?: number) => Promise<void>
}

/** A model download larger than this asks first; a small addition (the 2 MB VAD) just happens. */
const CONFIRM_BYTES = 20_000_000

/** Share of the progress bar the audio download takes. */
const FETCH_SHARE = 0.1

/** How often a running job writes its finished segments down (ms). */
const SAVE_EVERY_MS = 15_000

/** How long a restart waits for the engine to be provided before giving up on resuming (ms). */
const RESUME_WAIT_MS = 10 * 60_000

/**
 * A job's record, kept in its temporary directory next to its audio, so a
 * restart (another plugin's deploy restarts the instance) resumes it instead
 * of losing an hour of work: `job.json` says what and how far, and
 * `segments.json` holds the stretches already transcribed.
 */
interface JobRecord {
  readonly entryId: string
  readonly url: string
  readonly media: ReaderMedia
  readonly title?: string
  /** The downloaded audio, once there. */
  file?: string
  /** `transcribe` until the transcript is stored, then `speakers`. */
  phase: 'transcribe' | 'speakers'
  language?: string
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

function writeJson(path: string, value: unknown): void {
  try {
    writeFileSync(`${path}.tmp`, JSON.stringify(value))
    renameSync(`${path}.tmp`, path)
  } catch {
    // A record that cannot be written only costs the resume.
  }
}

/** The reader's local transcription jobs, by entry. */
export class LocalTranscriber {
  private readonly jobs = new Map<string, Job>()
  /** Jobs a previous process left mid-way, waiting for the engine. */
  private readonly resumable: { dir: string; record: JobRecord }[] = []
  private resumeTimer: ReturnType<typeof setInterval> | undefined
  private disposing = false

  constructor(private readonly deps: LocalTranscriberDeps) {
    try {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000
      for (const name of readdirSync(deps.tmpRoot)) {
        if (!name.startsWith('audio-')) continue
        const dir = join(deps.tmpRoot, name)
        // Audio a killed process left behind (an hour of it is tens of MB): gone after a day.
        if (statSync(dir).mtimeMs < cutoff) {
          rmSync(dir, { recursive: true, force: true })
          continue
        }
        const record = readJson<JobRecord>(join(dir, 'job.json'))
        if (record?.entryId !== undefined && record.media !== undefined) this.resumable.push({ dir, record })
        else rmSync(dir, { recursive: true, force: true })
      }
    } catch {
      // No tmp directory yet.
    }
    if (this.resumable.length > 0) {
      // The engine is another plugin: it may be provided after this one boots.
      const since = Date.now()
      this.resumeTimer = setInterval(() => {
        const engine = this.deps.engine()
        if (engine === undefined && Date.now() - since < RESUME_WAIT_MS) return
        clearInterval(this.resumeTimer)
        this.resumeTimer = undefined
        for (const { dir, record } of this.resumable.splice(0)) {
          if (engine === undefined || this.jobs.has(record.entryId)) {
            rmSync(dir, { recursive: true, force: true })
            continue
          }
          const job: Job = { state: 'queued', progress: FETCH_SHARE, segments: [], rendered: 0, abort: new AbortController() }
          this.jobs.set(record.entryId, job)
          void this.execute(record, engine, 'auto', job, dir)
        }
      }, this.deps.resumePollMs ?? 2000)
      this.resumeTimer.unref?.()
    }
  }

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
      ...(job.speakers === undefined ? {} : { speakers: job.speakers }),
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
    if (bytes > CONFIRM_BYTES && request.confirmModels !== true) return { entryId: request.entryId, state: 'needs-models', bytes }
    const job: Job = { state: 'fetching', progress: 0, segments: [], rendered: 0, abort: new AbortController() }
    this.jobs.set(request.entryId, job)
    const record: JobRecord = { entryId: request.entryId, url: request.url, media: request.media, ...(request.title === undefined ? {} : { title: request.title }), phase: 'transcribe' }
    void this.execute(record, engine, language, job)
    return this.status(request.entryId)
  }

  /**
   * Leave or stop an entry's job: a queued (or still fetching) job is
   * withdrawn either way; a running one only with `force`.
   */
  cancel(entryId: string, force: boolean): LocalTranscriptStatus {
    const job = this.jobs.get(entryId)
    if (job === undefined) return { entryId, state: 'idle' }
    // Leaving during the speakers pass lets it finish too (the transcript is stored already).
    if (force || job.state === 'queued' || job.state === 'fetching') {
      job.abort.abort()
      this.jobs.delete(entryId)
      return { entryId, state: 'idle' }
    }
    return this.status(entryId)
  }

  /** Whether the engine is installed right now. */
  engineAvailable(): boolean {
    return this.deps.engine() !== undefined
  }

  /** Stop everything (plugin disposal) — keeping each job's record, so the next process resumes it. */
  dispose(): void {
    this.disposing = true
    if (this.resumeTimer !== undefined) clearInterval(this.resumeTimer)
    for (const job of this.jobs.values()) job.abort.abort()
    this.jobs.clear()
  }

  /**
   * Run (or resume) one job: fetch the audio unless the record has it,
   * transcribe from where the saved segments end, store, then the speakers.
   *
   * @param resumeDir - a previous process's directory for this job.
   */
  private async execute(record: JobRecord, engine: TranscribeEngine, language: 'auto', job: Job, resumeDir?: string): Promise<void> {
    const signal = job.abort.signal
    mkdirSync(this.deps.tmpRoot, { recursive: true })
    const dir = resumeDir ?? mkdtempSync(join(this.deps.tmpRoot, 'audio-'))
    const recordPath = join(dir, 'job.json')
    const segmentsPath = join(dir, 'segments.json')
    writeJson(recordPath, record)
    let lastSave = 0
    const saveSegments = (force: boolean): void => {
      if (!force && Date.now() - lastSave < SAVE_EVERY_MS) return
      lastSave = Date.now()
      writeJson(segmentsPath, job.segments)
    }
    try {
      let file = record.file !== undefined && existsSync(record.file) ? record.file : undefined
      if (file === undefined) {
        // No audio yet (or it went): whatever was transcribed from it is not trusted either.
        job.segments = []
        if (record.media.kind === 'video') {
          file = await this.deps.videoAudio(record.url, dir, { signal, onProgress: (fraction) => { job.progress = FETCH_SHARE * fraction } })
        } else {
          file = join(dir, 'audio')
          await curlTo(record.media.ref, file, signal)
        }
        record.file = file
        record.phase = 'transcribe'
        writeJson(recordPath, record)
      } else {
        job.segments = readJson<EngineSegment[]>(segmentsPath) ?? []
      }
      job.progress = FETCH_SHARE
      let segments: EngineSegment[]
      let detected = record.language
      if (record.phase === 'transcribe') {
        job.state = 'queued'
        // A resumed job picks up where its saved segments end.
        const earlier = [...job.segments]
        const fromSec = earlier[earlier.length - 1]?.end ?? 0
        const result = await engine.run(
          {
            input: { files: [file] },
            ...(fromSec > 0 ? { fromSec } : {}),
            language,
            diarize: false,
            owner: '@khorsheed/dsh-reader',
            ...(record.title === undefined ? {} : { label: record.title }),
          },
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
            onSegments: (more) => {
              job.segments.push(...more)
              saveSegments(false)
            },
          },
        )
        segments = [...earlier, ...result.segments]
        detected = result.language ?? detected
      } else {
        segments = job.segments
      }
      const html = renderLocalTranscript(segments)
      if (html === '') throw new Error('没有识别出语音')
      if (detected !== undefined) job.language = detected
      job.segments = segments
      saveSegments(true)
      if (record.phase === 'transcribe') {
        await this.deps.store(record.entryId, record.url, html, detected)
        record.phase = 'speakers'
        if (detected !== undefined) record.language = detected
        writeJson(recordPath, record)
      }
      job.html = html
      job.rendered = segments.length
      job.progress = 1
      // Then who spoke when, on the audio still at hand. The transcript is
      // already stored and readable; this pass only re-cuts its paragraphs.
      if (engine.speakers !== undefined) {
        job.state = 'speakers'
        try {
          const voices = await engine.speakers(
            {
              input: { files: [file] },
              speech: segments.map(segment => ({ start: segment.start, end: segment.end })),
              owner: '@khorsheed/dsh-reader',
              ...(record.title === undefined ? {} : { label: record.title }),
            },
            { signal },
          )
          const count = voices.single ? 1 : new Set(voices.turns.map(turn => turn.cluster)).size
          if (count >= 2) {
            const split = renderSpeakerTranscript(segments, voices.turns)
            await this.deps.store(record.entryId, record.url, split, detected, count)
            job.html = split
          } else {
            await this.deps.store(record.entryId, record.url, html, detected, 1)
          }
          job.speakers = count
        } catch (error) {
          if (signal.aborted) return
          // The transcript stands; only the speakers are missing.
          job.speakersError = error instanceof Error ? error.message : String(error)
        }
      }
      job.state = 'done'
    } catch (error) {
      if (signal.aborted) return
      job.state = 'failed'
      job.error = error instanceof Error ? error.message : String(error)
    } finally {
      // A shutdown keeps the record for the next process; anything else ends the job.
      if (!this.disposing) rmSync(dir, { recursive: true, force: true })
    }
  }
}
