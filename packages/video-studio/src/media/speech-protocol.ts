/**
 * Message shapes between the host and the speech worker process. The worker
 * runs diarization + ASR in its own Node process: sherpa-onnx's diarization
 * and decode calls are synchronous native work that would otherwise block the
 * host's event loop for minutes.
 */

export interface SpeechModelPaths {
  asr: { kind: 'paraformer' | 'senseVoice'; model: string; tokens: string }
  segmentation: string
  embedding: string
  /** Optional punctuation model (paraformer emits none of its own). */
  punctuation?: string | undefined
}

export interface KnownVoice {
  id: string
  name: string
  /** Base64 of the float32 embedding. */
  embedding: string
}

export interface SpeechJob {
  /** 16 kHz mono 16-bit WAV. */
  wavPath: string
  models: SpeechModelPaths
  voices: KnownVoice[]
  /** -1 = let clustering decide. */
  numSpeakers: number
  /** Cosine similarity at or above which a cluster is the stored voice. */
  matchThreshold: number
  numThreads: number
}

export interface WorkerToken {
  text: string
  start: number
  end: number
}

export interface WorkerSegment {
  cluster: number
  start: number
  end: number
  tokens: WorkerToken[]
}

export interface WorkerSpeaker {
  cluster: number
  speechSec: number
  /** Base64 float32 embedding averaged over up to a minute of this cluster's speech. */
  embedding: string
  match?: { id: string; score: number }
}

export type WorkerMessage =
  | { type: 'progress'; stage: 'load' | 'diarize' | 'transcribe' | 'embed'; progress: number }
  | { type: 'done'; segments: WorkerSegment[]; speakers: WorkerSpeaker[] }
  | { type: 'error'; message: string }

export function encodeEmbedding(v: Float32Array): string {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64')
}

export function decodeEmbedding(s: string): Float32Array {
  const buf = Buffer.from(s, 'base64')
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)).slice()
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    na += x * x
    nb += y * y
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}
