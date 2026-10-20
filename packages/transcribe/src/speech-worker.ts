/**
 * Speech worker: runs as its own Node process (child_process.fork) so the
 * synchronous native diarization/ASR work never blocks the host. Receives one
 * SpeechJob over IPC, replies with progress and segment messages and one
 * done/error.
 *
 * Pipeline: (with speaker separation) diarize the whole recording → merge
 * same-speaker turns → split long turns into ≤ 25 s chunks at the quietest
 * point → ASR each chunk with token timestamps → restore punctuation and
 * re-attach it to tokens → (with separation) one embedding per cluster for
 * voiceprint matching.
 */
import { createRequire } from 'node:module'
import { cosine, decodeEmbedding, encodeEmbedding, type SpeechJob, type WorkerMessage, type WorkerSegment, type WorkerSpeaker, type WorkerToken } from './speech-protocol.ts'
import { attachPunctuation, consolidate, mergeTurns, planChunks, repairSeam, SEAM_GAP_SEC, type PlannedChunk, type Turn } from './speech-worker-core.ts'

const require = createRequire(import.meta.url)

const SAMPLE_RATE = 16000
const MAX_CHUNK_SEC = 25
const EMBED_MAX_SEC = 60

let lastProgress = ''

/** Progress is throttled to whole percents: an hour of audio otherwise floods the IPC queue. */
function send(msg: WorkerMessage): void {
  if (msg.type === 'progress') {
    const key = `${msg.stage}:${Math.floor(msg.progress * 100)}`
    if (key === lastProgress) return
    lastProgress = key
  }
  process.send?.(msg)
}

/** The final message can be megabytes: exit only once IPC has flushed it. */
function finish(msg: WorkerMessage): void {
  if (!process.send) process.exit(msg.type === 'done' ? 0 : 1)
  process.send(msg, () => process.disconnect())
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

/** Silence padding kept around a voice-activity chunk (s): the recognizer reads an onset better with a little lead-in. */
const PAD_SEC = 0.15

/**
 * Recognizer chunks cut at real pauses: Silero VAD finds the speech, the
 * planner groups it at the longest pauses, and a stretch of speech with no
 * pause at all falls back to the quietest-point split (a gap of 0).
 */
function vadChunks(sherpa: Sherpa, model: string, samples: Float32Array, numThreads: number): PlannedChunk[] {
  const vad = new sherpa.Vad({
    sileroVad: { model, threshold: 0.5, minSilenceDuration: 0.25, minSpeechDuration: 0.25, windowSize: 512, maxSpeechDuration: 60 },
    sampleRate: SAMPLE_RATE,
    numThreads,
    debug: 0,
  }, 120)
  const speech: { start: number; end: number }[] = []
  const drain = (): void => {
    while (!vad.isEmpty()) {
      const seg = vad.front(false) as { start: number; samples: Float32Array }
      speech.push({ start: seg.start / SAMPLE_RATE, end: (seg.start + seg.samples.length) / SAMPLE_RATE })
      vad.pop()
    }
  }
  for (let i = 0; i + 512 <= samples.length; i += 512) {
    vad.acceptWaveform(samples.subarray(i, i + 512))
    drain()
  }
  vad.flush()
  drain()
  const total = samples.length / SAMPLE_RATE
  const out: PlannedChunk[] = []
  for (const chunk of planChunks(speech, MAX_CHUNK_SEC)) {
    const start = Math.max(0, chunk.start - PAD_SEC)
    const end = Math.min(total, chunk.end + PAD_SEC)
    if (end - start <= MAX_CHUNK_SEC) {
      out.push({ start, end, gapBefore: chunk.gapBefore })
      continue
    }
    chunksOf(samples, start, end).forEach(([a, b], index) => {
      out.push({ start: a / SAMPLE_RATE, end: b / SAMPLE_RATE, gapBefore: index === 0 ? chunk.gapBefore : 0 })
    })
  }
  return out
}

function cleanToken(t: string): string {
  // paraformer/sense-voice BPE pieces mark word starts with ▁ or @@ suffixes
  return t.replace(/▁/g, ' ').replace(/@@$/, '').replace(/^<\|.*\|>$/, '')
}

/** Separated turns: diarize, merge, consolidate on embeddings. */
function diarizedTurns(sherpa: Sherpa, job: SpeechJob, samples: Float32Array, embedOf: (list: Turn[], cluster: number) => Float32Array | null): Turn[] {
  const diar = new sherpa.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: job.models.segmentation }, numThreads: job.numThreads },
    embedding: { model: job.models.embedding, numThreads: job.numThreads },
    clustering: { numClusters: job.numSpeakers, threshold: job.clusterThreshold ?? 0.9 },
    minDurationOn: 0.3,
    minDurationOff: 0.5,
  })
  send({ type: 'progress', stage: 'diarize', progress: 0 })
  const raw = (diar.process(samples) as { start: number; end: number; speaker: number }[]).sort((a, b) => a.start - b.start)
  send({ type: 'progress', stage: 'diarize', progress: 1 })
  return consolidate(mergeTurns(raw.map((r) => ({ cluster: r.speaker, start: r.start, end: r.end }))), embedOf)
}

async function main(job: SpeechJob): Promise<void> {
  send({ type: 'progress', stage: 'load', progress: 0 })
  const sherpa: Sherpa = require('sherpa-onnx-node')
  const wave = sherpa.readWave(job.wavPath) as { samples: Float32Array; sampleRate: number }
  if (wave.sampleRate !== SAMPLE_RATE) throw new Error(`expected ${SAMPLE_RATE} Hz input, got ${wave.sampleRate}`)
  const samples = wave.samples
  if (job.diarize && (!job.models.segmentation || !job.models.embedding)) throw new Error('speaker separation needs the segmentation and embedding models')

  const extractor = job.diarize ? new sherpa.SpeakerEmbeddingExtractor({ model: job.models.embedding, numThreads: job.numThreads }) : null
  /** One embedding over up to EMBED_MAX_SEC of a cluster's longest turns. */
  const embedOf = (list: Turn[], cluster: number): Float32Array | null => {
    if (!extractor) return null
    const longest = list.filter((t) => t.cluster === cluster).sort((x, y) => y.end - y.start - (x.end - x.start))
    const stream = extractor.createStream()
    let fed = 0
    for (const t of longest) {
      if (fed >= EMBED_MAX_SEC) break
      const len = Math.min(t.end - t.start, EMBED_MAX_SEC - fed)
      stream.acceptWaveform({ samples: samples.subarray(Math.floor(t.start * SAMPLE_RATE), Math.floor((t.start + len) * SAMPLE_RATE)), sampleRate: SAMPLE_RATE })
      fed += len
    }
    stream.inputFinished()
    return extractor.isReady(stream) ? (extractor.compute(stream, false) as Float32Array) : null
  }

  // Without separation the whole recording is one turn; its ≤ 25 s chunks
  // are each reported as a segment, so a long recording reads as it goes.
  const turns: Turn[] = job.diarize ? diarizedTurns(sherpa, job, samples, embedOf) : [{ cluster: 0, start: 0, end: samples.length / SAMPLE_RATE }]

  const modelConfig: Record<string, unknown> = { tokens: job.models.asr.tokens, numThreads: job.numThreads, provider: 'cpu', debug: 0 }
  if (job.models.asr.kind === 'paraformer') modelConfig.paraformer = { model: job.models.asr.model }
  else modelConfig.senseVoice = { model: job.models.asr.model, language: job.models.asr.language ?? 'auto', useInverseTextNormalization: 1 }
  const recognizer = new sherpa.OfflineRecognizer({ featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 }, modelConfig, decodingMethod: 'greedy_search' })
  const punct = job.models.punctuation ? new sherpa.OfflinePunctuation({ model: { ctTransformer: job.models.punctuation, numThreads: job.numThreads } }) : null
  /** Seconds of speech per detected language (SenseVoice tags each chunk). */
  const languages = new Map<string, number>()

  /** Recognize one stretch: timed tokens, punctuated. */
  const recognize = (a: number, b: number): WorkerToken[] => {
    const stream = recognizer.createStream()
    stream.acceptWaveform({ samples: samples.subarray(a, b), sampleRate: SAMPLE_RATE })
    recognizer.decode(stream)
    const res = recognizer.getResult(stream) as { text: string; lang?: string; tokens?: string[]; timestamps?: number[]; durations?: number[] }
    const lang = /^<\|(\w+)\|>$/.exec(res.lang ?? '')?.[1]
    if (lang) languages.set(lang, (languages.get(lang) ?? 0) + (b - a) / SAMPLE_RATE)
    const offset = a / SAMPLE_RATE
    const chunkEnd = b / SAMPLE_RATE
    const toks = res.tokens ?? []
    const ts = res.timestamps ?? []
    const tokens: WorkerToken[] = []
    // SenseVoice marks word starts itself (`▁`); only Paraformer needs the spacing rule
    const paraformer = job.models.asr.kind === 'paraformer'
    let inWord = false
    for (let i = 0; i < toks.length; i++) {
      const piece = toks[i] ?? ''
      let text = cleanToken(piece)
      if (!text.trim()) continue
      // Paraformer spells English as BPE pieces (`lar@@ ge`) with no spaces:
      // a piece that starts a Latin word gets one, unless it opens the chunk.
      const latin = /^[A-Za-z0-9']/.test(text)
      if (paraformer && latin && !inWord && tokens.length && !/\s$/.test(tokens[tokens.length - 1]!.text)) text = ` ${text}`
      inWord = latin && piece.endsWith('@@')
      const start = offset + (ts[i] ?? 0)
      const dur = res.durations?.[i]
      const nextTs = ts[i + 1]
      const next = nextTs !== undefined ? offset + nextTs : chunkEnd
      const end = Math.min(next, dur ? start + dur : Math.min(start + 0.4, next))
      tokens.push({ text, start, end: Math.max(end, start + 0.02) })
    }
    // Paraformer emits no punctuation: the CT-Transformer restores it.
    // SenseVoice's own tokens already carry punctuation and casing.
    if (!tokens.length || !punct) return tokens
    return attachPunctuation(tokens, punct.addPunct(tokens.map((t) => t.text).join('')) as string)
  }

  const total = turns.reduce((a, t) => a + (t.end - t.start), 0) || 1
  let done = 0
  const segments: WorkerSegment[] = []
  if (!job.diarize && job.models.vad) {
    // One recording, cut at real pauses. A segment is sent one chunk late: a
    // boundary with almost no pause is not a sentence end, and the previous
    // chunk's invented period is removed before anyone sees it.
    let pending: WorkerSegment | null = null
    for (const chunk of vadChunks(sherpa, job.models.vad, samples, job.numThreads)) {
      const a = Math.floor(chunk.start * SAMPLE_RATE)
      const b = Math.min(samples.length, Math.floor(chunk.end * SAMPLE_RATE))
      const tokens = b - a > SAMPLE_RATE * 0.2 ? recognize(a, b) : []
      done = chunk.end
      // A chunk's first word has no word-start mark of its own: without a
      // space it glues onto the previous chunk's last one ("on" + "some").
      if (pending && tokens[0] && /^[A-Za-z0-9']/.test(tokens[0].text)) tokens[0] = { ...tokens[0], text: ` ${tokens[0].text}` }
      if (tokens.length) {
        if (pending && chunk.gapBefore < SEAM_GAP_SEC) repairSeam(pending.tokens, tokens)
        if (pending) {
          segments.push(pending)
          send({ type: 'segments', segments: [pending] })
        }
        pending = { cluster: 0, start: chunk.start, end: chunk.end, tokens }
      }
      send({ type: 'progress', stage: 'transcribe', progress: Math.min(1, done / total) })
    }
    if (pending) {
      segments.push(pending)
      send({ type: 'segments', segments: [pending] })
    }
    const detected = [...languages.entries()].sort((x, y) => y[1] - x[1])[0]?.[0]
    finish({ type: 'done', segments, speakers: [], language: detected })
    return
  }
  for (const turn of turns) {
    const tokens: WorkerToken[] = []
    for (const [a, b] of chunksOf(samples, turn.start, turn.end)) {
      const chunk = recognize(a, b)
      if (!job.diarize) {
        done += (b - a) / SAMPLE_RATE
        if (chunk.length) {
          const segment = { cluster: 0, start: a / SAMPLE_RATE, end: b / SAMPLE_RATE, tokens: chunk }
          segments.push(segment)
          send({ type: 'segments', segments: [segment] })
        }
        send({ type: 'progress', stage: 'transcribe', progress: done / total })
      } else tokens.push(...chunk)
    }
    if (!job.diarize) continue
    done += turn.end - turn.start
    send({ type: 'progress', stage: 'transcribe', progress: done / total })
    if (!tokens.length) continue
    const segment = { cluster: turn.cluster, start: turn.start, end: turn.end, tokens }
    segments.push(segment)
    send({ type: 'segments', segments: [segment] })
  }
  const language = [...languages.entries()].sort((x, y) => y[1] - x[1])[0]?.[0]
  if (!job.diarize) {
    finish({ type: 'done', segments, speakers: [], language })
    return
  }

  // one embedding per (consolidated) cluster for voiceprint matching
  send({ type: 'progress', stage: 'embed', progress: 0 })
  const known = job.voices.map((v) => ({ ...v, vec: decodeEmbedding(v.embedding) }))
  const clusters = [...new Set(turns.map((t) => t.cluster))]
  const speakers: WorkerSpeaker[] = []
  for (const cluster of clusters) {
    const speechSec = turns.filter((t) => t.cluster === cluster).reduce((a, t) => a + (t.end - t.start), 0)
    const vec = embedOf(turns, cluster)
    if (!vec) continue
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
  finish({ type: 'done', segments, speakers, language })
}

process.once('message', (job: SpeechJob) => {
  main(job).catch((error: unknown) => finish({ type: 'error', message: error instanceof Error ? error.message : String(error) }))
})
