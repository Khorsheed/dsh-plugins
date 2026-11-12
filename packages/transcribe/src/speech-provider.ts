import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type { SpeechPreparation, SpeechPreparationOptions, SpeechPreparationState, SpeechProvider, SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { MODELS, type ModelId, type ModelSourceChoice } from './models.ts'
import type { TranscribeService } from './service.ts'

const DOWNLOAD_SOURCES = ['https://huggingface.co', 'https://hf-mirror.com'] as const
const REQUIRED_MODELS: readonly ModelId[] = ['paraformer', 'punctuation', 'senseVoice', 'vad']

function validateWav(audio: Uint8Array): number {
  const data = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength)
  if (data.length < 46 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE'
    || data.toString('ascii', 12, 16) !== 'fmt ' || data.readUInt32LE(16) !== 16
    || data.readUInt16LE(20) !== 1 || data.readUInt16LE(22) !== 1 || data.readUInt32LE(24) !== 16000
    || data.readUInt32LE(28) !== 32000 || data.readUInt16LE(32) !== 2 || data.readUInt16LE(34) !== 16
    || data.toString('ascii', 36, 40) !== 'data' || data.readUInt32LE(4) !== data.length - 8
    || data.readUInt32LE(40) !== data.length - 44 || (data.length - 44) % 2 !== 0) {
    throw new Error('Audio must be a canonical 16 kHz mono PCM16 WAV recording')
  }
  return (data.length - 44) / 32000
}

/** The existing local engine as an official short-recording provider. */
export class LocalSpeechProvider implements SpeechProvider {
  readonly info: SpeechProvider['info']
  readonly preparation: SpeechPreparation
  private state: SpeechPreparationState = { phase: 'unprepared' }
  private readonly listeners = new Set<() => void>()
  private task: { abort: AbortController; settled: Promise<void>; source: ModelSourceChoice | undefined } | undefined
  private stopped = false

  constructor(private readonly service: TranscribeService, private readonly modelSource?: ModelSourceChoice) {
    this.info = {
      id: 'transcribe-local' as SpeechProviderId,
      name: 'Local Paraformer / SenseVoice',
      location: 'host-local',
      languages: ['auto', 'zh', 'en'],
      downloadSources: DOWNLOAD_SOURCES,
      setupEstimate: {
        recommendedDiskBytes: MODELS.filter(model => REQUIRED_MODELS.includes(model.id)).reduce((sum, model) => sum + model.bytes, 0),
        expectedMemoryBytes: 1_500_000_000,
        minimumMinutes: 1,
        maximumMinutes: 15,
      },
    }
    this.preparation = {
      snapshot: () => this.state,
      subscribe: listener => {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      },
      prepare: options => { this.prepare(options) },
      cancel: () => this.cancel(),
    }
  }

  private publish(state: SpeechPreparationState): void {
    this.state = state
    for (const listener of this.listeners) listener()
  }

  private prepare(options: SpeechPreparationOptions = {}): void {
    if (this.stopped) throw new Error('Local speech provider is disposed')
    if (options.downloadSource !== undefined && !DOWNLOAD_SOURCES.includes(options.downloadSource as typeof DOWNLOAD_SOURCES[number])) {
      throw new Error('Local speech download source is unavailable')
    }
    const source = options.downloadSource === undefined ? this.modelSource
      : options.downloadSource === 'https://huggingface.co' ? 'huggingface' : 'hf-mirror'
    if (this.task !== undefined) {
      if (this.task.source !== source) throw new Error('Cancel preparation before changing its download source')
      return
    }
    const abort = new AbortController()
    const task = { abort, settled: Promise.resolve(), source }
    this.task = task
    task.settled = (async () => {
      try {
        this.publish({ phase: 'checking', startedAt: Date.now(), step: 'check' })
        const ids = [...REQUIRED_MODELS]
        const missing = (await this.service.models()).filter(model => ids.includes(model.id) && model.state !== 'installed')
        if (missing.length > 0) {
          this.publish({ phase: 'downloading', resource: 'Local speech models', completedBytes: 0, totalBytes: missing.reduce((sum, model) => sum + model.bytes, 0), step: 'model' })
          await this.service.prepare(ids, source, abort.signal)
        }
        abort.signal.throwIfAborted()
        const ready = (await this.service.models()).filter(model => ids.includes(model.id)).every(model => model.state === 'installed')
        if (!ready) throw new Error('Local speech model preparation did not complete')
        this.publish({ phase: 'ready', step: 'verify' })
      } catch (error) {
        this.publish(abort.signal.aborted ? { phase: 'cancelled' } : { phase: 'failed', message: error instanceof Error ? error.message : String(error) })
      } finally {
        this.task = undefined
      }
    })()
  }

  private async cancel(): Promise<void> {
    const task = this.task
    if (task === undefined) return
    this.publish({ phase: 'cancelling', startedAt: Date.now() })
    task.abort.abort(new Error('Local speech preparation cancelled'))
    await task.settled
  }

  async dispose(): Promise<void> {
    this.stopped = true
    await this.cancel()
    this.listeners.clear()
  }

  async transcribe(input: { audio: Uint8Array; language: string }, signal: AbortSignal) {
    const audioSeconds = validateWav(input.audio)
    const language = input.language === 'zh' ? 'zh' : input.language === 'en' ? 'en' : 'auto'
    const required = this.service.modelsFor({ language })
    if (!(await this.service.models()).filter(model => required.includes(model.id)).every(model => model.state === 'installed')) {
      throw new Error('Prepare the local speech models before recording')
    }
    const path = join(this.service.root, 'tmp', `${randomUUID()}.wav`)
    await mkdir(join(this.service.root, 'tmp'), { recursive: true })
    await writeFile(path, input.audio, { flag: 'wx' })
    const startedAt = performance.now()
    try {
      const result = await this.service.run({ input: { wav: path }, language, owner: '@khorsheed/dsh-transcribe/speech-provider' }, { signal })
      return {
        text: result.segments.map(segment => segment.text).filter(Boolean).join(' '),
        audioSeconds,
        inferenceSeconds: (performance.now() - startedAt) / 1000,
      }
    } finally {
      await rm(path, { force: true })
    }
  }
}

/** Register only in a composition that explicitly provides the experimental speech registry. */
export function registerLocalSpeechProvider(ctx: Context, service: TranscribeService, modelSource?: ModelSourceChoice): void {
  ctx.inject(['speechToText'], (speechCtx) => {
    const provider = new LocalSpeechProvider(service, modelSource)
    speechCtx.effect(() => {
      const unregister = speechCtx.speechToText.register(provider)
      return async () => {
        await unregister()
        await provider.dispose()
      }
    }, 'transcribe: official speech provider')
  })
}
