/**
 * Speech worker: runs as its own Node process (child_process.fork) so the
 * synchronous native diarization/ASR work never blocks the host. Receives one
 * SpeechJob over IPC, replies with progress messages and one done/error.
 *
 * Pipeline: diarize the whole recording → merge same-speaker turns → split
 * long turns into ≤ 25 s chunks at the quietest point → ASR each chunk with
 * token timestamps → restore punctuation and re-attach it to tokens → one
 * embedding per cluster for voiceprint matching.
 */
import { createRequire } from 'node:module'
import { cosine, decodeEmbedding, encodeEmbedding, type SpeechJob, type WorkerMessage, type WorkerSegment, type WorkerSpeaker, type WorkerToken } from './speech-protocol.ts'

const require = createRequire(import.meta.url)

const SAMPLE_RATE = 16000
const MAX_CHUNK_SEC = 25
const MERGE_GAP_SEC = 0.5
const EMBED_MAX_SEC = 60

function send(msg: WorkerMessage): void {
  process.send?.(msg)
}

/* eslint-disable @typescript-eslint/no-explicit-any -- sherpa-onnx-node ships JS + JSDoc only */
type Sherpa = any

function quietestSplit(samples: Float32Array, from: number, to: number): number {
  // search the middle half of the window for the lowest 50 ms energy
  const win = Math.floor(SAMPLE_RATE * 0.05)
  let best = Math.floor((from + to) / 2)
  let bestE = Infinity
  const lo = from + Math.floor((to - from) / 4)
  const hi = to - Math.floor((to - from) / 4)
  for (let i = lo; i + win < hi; i += win) {
    let e = 0
    for (let k = i; k < i + win; k++) e += samples[k]! * samples[k]!
    if (e < bestE) {
      bestE = e
      best = i + Math.floor(win / 2)
    }
  }
  return best
}

function chunksOf(samples: Float32Array, start: number, end: number): [number, number][] {
  const out: [number, number][] = []
  const stack: [number, number][] = [[Math.floor(start * SAMPLE_RATE), Math.min(samples.length, Math.floor(end * SAMPLE_RATE))]]
  while (stack.length) {
    const [a, b] = stack.shift()!
    if (b - a <= MAX_CHUNK_SEC * SAMPLE_RATE) {
      if (b - a > SAMPLE_RATE * 0.2) out.push([a, b])
      continue
    }
    const mid = quietestSplit(samples, a, b)
    stack.unshift([mid, b])
    stack.unshift([a, mid])
  }
  return out
}

/** Re-insert punctuation from the punctuated string into the token list. */
export function attachPunctuation(tokens: WorkerToken[], punctuated: string): WorkerToken[] {
  const out: WorkerToken[] = []
  let ti = 0
  let consumed = '' // characters of tokens[ti] matched so far
  for (const ch of punctuated) {
    if (ti < tokens.length) {
      const tokText = tokens[ti]!.text
      const want = tokText.slice(consumed.length)
      const head = want[0]
      if (head !== undefined && ch.toLowerCase() === head.toLowerCase()) {
        consumed += head
        if (consumed.length >= tokText.length) {
          out.push(tokens[ti]!)
          ti += 1
          consumed = ''
        }
        continue
      }
    }
    const prev = out[out.length - 1]
    if (/[\p{P}]/u.test(ch) && prev) {
      out.push({ text: ch, start: prev.end, end: prev.end })
    }
    // anything else (spaces, case-folded mismatches) is dropped
  }
  while (ti < tokens.length) out.push(tokens[ti++]!)
  return out
}

function cleanToken(t: string): string {
  // paraformer/sense-voice BPE pieces mark word starts with ▁ or @@ suffixes
  return t.replace(/▁/g, ' ').replace(/@@$/, '').replace(/^<\|.*\|>$/, '')
}

async function main(job: SpeechJob): Promise<void> {
  send({ type: 'progress', stage: 'load', progress: 0 })
  const sherpa: Sherpa = require('sherpa-onnx-node')
  const wave = sherpa.readWave(job.wavPath) as { samples: Float32Array; sampleRate: number }
  if (wave.sampleRate !== SAMPLE_RATE) throw new Error(`expected ${SAMPLE_RATE} Hz input, got ${wave.sampleRate}`)
  const samples = wave.samples

  const diar = new sherpa.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: job.models.segmentation }, numThreads: job.numThreads },
    embedding: { model: job.models.embedding, numThreads: job.numThreads },
    clustering: { numClusters: job.numSpeakers, threshold: 0.5 },
    minDurationOn: 0.3,
    minDurationOff: 0.5,
  })
  send({ type: 'progress', stage: 'diarize', progress: 0 })
  const raw = (diar.process(samples) as { start: number; end: number; speaker: number }[]).sort((a, b) => a.start - b.start)
  send({ type: 'progress', stage: 'diarize', progress: 1 })

  // merge consecutive turns of the same speaker
  const turns: { cluster: number; start: number; end: number }[] = []
  for (const r of raw) {
    const last = turns[turns.length - 1]
    if (last && last.cluster === r.speaker && r.start - last.end <= MERGE_GAP_SEC) last.end = Math.max(last.end, r.end)
    else turns.push({ cluster: r.speaker, start: r.start, end: r.end })
  }

  const modelConfig: Record<string, unknown> = { tokens: job.models.asr.tokens, numThreads: job.numThreads, provider: 'cpu', debug: 0 }
  if (job.models.asr.kind === 'paraformer') modelConfig.paraformer = { model: job.models.asr.model }
  else modelConfig.senseVoice = { model: job.models.asr.model, language: 'zh', useInverseTextNormalization: 1 }
  const recognizer = new sherpa.OfflineRecognizer({ featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 }, modelConfig, decodingMethod: 'greedy_search' })
  const punct = job.models.punctuation ? new sherpa.OfflinePunctuation({ model: { ctTransformer: job.models.punctuation, numThreads: job.numThreads } }) : null

  const total = turns.reduce((a, t) => a + (t.end - t.start), 0) || 1
  let done = 0
  const segments: WorkerSegment[] = []
  for (const turn of turns) {
    const tokens: WorkerToken[] = []
    for (const [a, b] of chunksOf(samples, turn.start, turn.end)) {
      const stream = recognizer.createStream()
      stream.acceptWaveform({ samples: samples.subarray(a, b), sampleRate: SAMPLE_RATE })
      recognizer.decode(stream)
      const res = recognizer.getResult(stream) as { text: string; tokens?: string[]; timestamps?: number[]; durations?: number[] }
      const offset = a / SAMPLE_RATE
      const chunkEnd = b / SAMPLE_RATE
      const toks = res.tokens ?? []
      const ts = res.timestamps ?? []
      for (let i = 0; i < toks.length; i++) {
        const text = cleanToken(toks[i] ?? '')
        if (!text.trim()) continue
        const start = offset + (ts[i] ?? 0)
        const dur = res.durations?.[i]
        const nextTs = ts[i + 1]
        const next = nextTs !== undefined ? offset + nextTs : chunkEnd
        const end = Math.min(next, dur ? start + dur : Math.min(start + 0.4, next))
        tokens.push({ text, start, end: Math.max(end, start + 0.02) })
      }
    }
    done += turn.end - turn.start
    send({ type: 'progress', stage: 'transcribe', progress: done / total })
    if (!tokens.length) continue
    let final = tokens
    if (punct) {
      const plain = tokens.map((t) => t.text).join('')
      const punctuated = punct.addPunct(plain) as string
      final = attachPunctuation(tokens, punctuated)
    }
    segments.push({ cluster: turn.cluster, start: turn.start, end: turn.end, tokens: final })
  }

  // one embedding per cluster over up to EMBED_MAX_SEC of its longest turns
  send({ type: 'progress', stage: 'embed', progress: 0 })
  const extractor = new sherpa.SpeakerEmbeddingExtractor({ model: job.models.embedding, numThreads: job.numThreads })
  const known = job.voices.map((v) => ({ ...v, vec: decodeEmbedding(v.embedding) }))
  const clusters = [...new Set(turns.map((t) => t.cluster))]
  const speakers: WorkerSpeaker[] = []
  for (const cluster of clusters) {
    const mine = turns.filter((t) => t.cluster === cluster)
    const speechSec = mine.reduce((a, t) => a + (t.end - t.start), 0)
    const longest = [...mine].sort((x, y) => y.end - y.start - (x.end - x.start))
    const stream = extractor.createStream()
    let fed = 0
    for (const t of longest) {
      if (fed >= EMBED_MAX_SEC) break
      const len = Math.min(t.end - t.start, EMBED_MAX_SEC - fed)
      stream.acceptWaveform({ samples: samples.subarray(Math.floor(t.start * SAMPLE_RATE), Math.floor((t.start + len) * SAMPLE_RATE)), sampleRate: SAMPLE_RATE })
      fed += len
    }
    stream.inputFinished()
    if (!extractor.isReady(stream)) continue
    const vec = extractor.compute(stream, false) as Float32Array
    let match: { id: string; score: number } | undefined
    for (const v of known) {
      const score = cosine(vec, v.vec)
      if (score >= job.matchThreshold && (!match || score > match.score)) match = { id: v.id, score }
    }
    speakers.push({ cluster, speechSec, embedding: encodeEmbedding(vec), ...(match ? { match } : {}) })
  }
  // a stored voice can match at most one cluster: keep the best, drop the rest
  const byVoice = new Map<string, WorkerSpeaker>()
  for (const s of speakers) {
    if (!s.match) continue
    const prev = byVoice.get(s.match.id)
    if (!prev || prev.match!.score < s.match.score) {
      if (prev) delete prev.match
      byVoice.set(s.match.id, s)
    } else delete s.match
  }
  send({ type: 'progress', stage: 'embed', progress: 1 })
  send({ type: 'done', segments, speakers })
}

process.once('message', (job: SpeechJob) => {
  main(job)
    .catch((error: unknown) => send({ type: 'error', message: error instanceof Error ? error.message : String(error) }))
    .finally(() => setTimeout(() => process.exit(0), 50))
})
