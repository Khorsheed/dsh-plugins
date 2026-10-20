/**
 * The `transcribe` service's public shapes — what a consumer (video-studio,
 * dsh-reader) imports type-only and probes for at call time.
 *
 * @module @khorsheed/dsh-transcribe/types
 */
import type { KnownVoice, WorkerSpeaker, WorkerToken } from './speech-protocol.ts'
import type { ModelId, ModelSourceChoice, ModelStatus } from './models.ts'

export type { KnownVoice, WorkerSpeaker, WorkerToken } from './speech-protocol.ts'
export type { ModelId, ModelSourceChoice, ModelState, ModelStatus } from './models.ts'

/**
 * The spoken language: `zh` runs Paraformer + punctuation (per-character
 * timing), `en` and `auto` run SenseVoice (which detects the language itself).
 */
export type TranscribeLanguage = 'zh' | 'en' | 'auto'

/** Speaker separation for one job. */
export interface DiarizeOptions {
  /** Voices to recognize (cosine match on CAM++ embeddings). */
  readonly voices?: readonly KnownVoice[]
  /** Similarity at or above which a cluster is a known voice (default 0.6). */
  readonly matchThreshold?: number
  /** A fixed speaker count; omitted = let clustering decide. */
  readonly numSpeakers?: number
}

/** One transcription job. */
export interface TranscribeRequest {
  /**
   * The audio: media files (several = the legs of one continuous recording,
   * butt-joined) decoded by ffmpeg into a temporary WAV, or a WAV that is
   * already 16 kHz mono 16-bit, used as is.
   */
  readonly input: { readonly files: readonly string[] } | { readonly wav: string }
  /** Default `zh`. */
  readonly language?: TranscribeLanguage
  /** Separate speakers (default: no). */
  readonly diarize?: DiarizeOptions | false
  /** The consumer's package name: shown in the queue, never interpreted. */
  readonly owner: string
  /** What the job is, for the queue. */
  readonly label?: string
}

/** A finished stretch of speech. Without speaker separation `cluster` is 0. */
export interface TranscribeSegment {
  readonly cluster: number
  readonly start: number
  readonly end: number
  /** The text, punctuated. */
  readonly text: string
  /** Per-token timing (characters for Chinese, word pieces for English). */
  readonly tokens: readonly WorkerToken[]
}

/** Where a job is. `progress` is overall, 0–1. */
export interface TranscribeProgress {
  readonly stage: 'queued' | 'models' | 'decode' | 'load' | 'diarize' | 'transcribe' | 'embed'
  readonly progress: number
  /** Jobs ahead of this one, while queued. */
  readonly ahead?: number
}

/** Call-site hooks for one job. */
export interface TranscribeRunOptions {
  /** Aborting withdraws a queued job or stops a running one. */
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: TranscribeProgress) => void
  /** Newly finished segments, in order, as the job goes. */
  readonly onSegments?: (segments: readonly TranscribeSegment[]) => void
}

/** What a finished job returns. */
export interface TranscribeResult {
  readonly segments: TranscribeSegment[]
  /** Only with speaker separation. */
  readonly speakers: WorkerSpeaker[]
  /** SenseVoice's detected language (`zh`, `en`, …), when it ran. */
  readonly language?: string
}

/** Who spoke when in a recording, without transcribing it (a transcript already exists). */
export interface SpeakersRequest {
  readonly input: TranscribeRequest['input']
  /** Speech regions already known (seconds) — the transcript's stretches — so the VAD need not run again. */
  readonly speech?: readonly { readonly start: number; readonly end: number }[]
  readonly voices?: readonly KnownVoice[]
  readonly owner: string
  readonly label?: string
}

/** One speaker turn. */
export interface SpeakerTurn {
  readonly cluster: number
  readonly start: number
  readonly end: number
}

/** A speakers job's answer: one voice (a quick probe settled it), or the turns. */
export interface SpeakersResult {
  readonly single: boolean
  readonly turns: SpeakerTurn[]
  readonly speakers: WorkerSpeaker[]
}

/** One row of the queue, for display. */
export interface TranscribeQueueItem {
  readonly id: string
  readonly owner: string
  readonly label?: string
  readonly state: 'queued' | 'running'
}

/** The `transcribe` service, as consumers see it. */
export interface TranscribeApi {
  /** The models a request needs. */
  modelsFor(request: Pick<TranscribeRequest, 'language' | 'diarize'>): ModelId[]
  /** Model install state (refreshed from disk). */
  models(): Promise<ModelStatus[]>
  /** Bytes still to download before `ids` are ready (0 = ready). */
  missingBytes(ids: readonly ModelId[]): Promise<number>
  /** Download the missing models among `ids`; resolves when the pass ends (check `models()` for failures). */
  prepare(ids: readonly ModelId[], source?: ModelSourceChoice): Promise<void>
  /** Queue a job (one runs at a time) and resolve with its result. Missing models are downloaded first. */
  run(request: TranscribeRequest, options?: TranscribeRunOptions): Promise<TranscribeResult>
  /**
   * Who spoke when (queued like `run`). A probe of a couple of dozen windows
   * settles a one-voice recording in about a second; only several voices pay
   * for the full diarization.
   */
  speakers(request: SpeakersRequest, options?: Omit<TranscribeRunOptions, 'onSegments'>): Promise<SpeakersResult>
  /** The queue, running job first. */
  queue(): TranscribeQueueItem[]
}
