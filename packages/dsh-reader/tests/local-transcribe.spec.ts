import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { cuesFromSegments, languageFor, LocalTranscriber, renderLocalTranscript, type EngineSegment, type TranscribeEngine } from '../src/local-transcribe.ts'
import type { ReaderMedia } from '../src/media.ts'

const tok = (text: string, start: number) => ({ text, start, end: start + 0.3 })
const video: ReaderMedia = { kind: 'video', provider: 'bilibili', ref: 'BV1xx' }
const flush = () => new Promise((resolve) => setTimeout(resolve, 5))

describe('local transcript markup', () => {
  it('cuts the engine stretches into sentences, across stretch boundaries', () => {
    const segments: EngineSegment[] = [
      { start: 0, end: 2, tokens: [tok('大', 0), tok('家', 0.3), tok('好', 0.6), tok('。', 0.9), tok('今', 1.2)] },
      { start: 2, end: 4, tokens: [tok('天', 2), tok('聊', 2.3), tok('？', 2.6)] },
      { start: 4, end: 6, tokens: [tok('Hello', 4), tok(' world', 4.3), tok('.', 4.6), tok(' Version', 5), tok(' 2', 5.3), tok('.5', 5.4)] },
    ]
    expect(cuesFromSegments(segments).map((cue) => [cue.start, cue.text])).toEqual([
      [0, '大家好。'],
      [1.2, '今天聊？'],
      [4, 'Hello world.'],
      [5, 'Version 2.5'],
    ])
  })

  it('marks every paragraph as local and keeps its start time', () => {
    const html = renderLocalTranscript([{ start: 0, end: 1, tokens: [tok('好', 0.5), tok('。', 0.8)] }])
    expect(html).toBe('<p data-src="local" data-t="0.5">好。</p>')
  })

  it('asks for Chinese on Bilibili and Xiaoyuzhou, detection elsewhere', () => {
    expect(languageFor(video)).toBe('zh')
    expect(languageFor({ kind: 'audio', provider: 'xiaoyuzhou', ref: 'https://x/a.m4a' })).toBe('zh')
    expect(languageFor({ kind: 'video', provider: 'youtube', ref: 'abc' })).toBe('auto')
  })
})

/** A scripted engine: `run` waits for `finish` (or an abort). */
function fakeEngine(missing = 0) {
  let finish: (() => void) | undefined
  let queued: (() => void) | undefined
  const engine: TranscribeEngine & { run: ReturnType<typeof vi.fn> } = {
    modelsFor: () => ['paraformer', 'punctuation'],
    missingBytes: async () => missing,
    run: vi.fn((_request, options) => new Promise((resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      options.onProgress?.({ stage: 'queued', progress: 0, ahead: 1 })
      queued = () => {
        options.onProgress?.({ stage: 'transcribe', progress: 0.5 })
        options.onSegments?.([{ start: 0, end: 1, tokens: [tok('你', 0), tok('好', 0.3), tok('。', 0.6)] }])
      }
      finish = () => resolve({ segments: [{ start: 0, end: 1, tokens: [tok('你', 0), tok('好', 0.3), tok('。', 0.6)] }] })
    })),
  }
  return { engine, advance: () => queued?.(), finish: () => finish?.() }
}

function transcriber(engine: TranscribeEngine | undefined) {
  const store = vi.fn(async () => {})
  const videoAudio = vi.fn(async (_url: string, dir: string) => join(dir, 'audio.m4a'))
  const local = new LocalTranscriber({ engine: () => engine, tmpRoot: mkdtempSync(join(tmpdir(), 'reader-local-')), videoAudio, store })
  return { local, store, videoAudio }
}

describe('LocalTranscriber', () => {
  const request = { entryId: 'e1', url: 'https://www.bilibili.com/video/BV1xx', media: video, title: 'T' }

  it('answers unavailable without the engine', async () => {
    expect((await transcriber(undefined).local.start(request)).state).toBe('unavailable')
  })

  it('waits for the model download to be confirmed', async () => {
    const { engine } = fakeEngine(323_000_000)
    const { local } = transcriber(engine)
    expect(await local.start(request)).toEqual({ entryId: 'e1', state: 'needs-models', bytes: 323_000_000 })
    expect(engine.run).not.toHaveBeenCalled()
    expect((await local.start({ ...request, confirmModels: true })).state).toBe('fetching')
    await flush()
    expect(engine.run).toHaveBeenCalledTimes(1)
  })

  it('downloads the audio, streams the transcript, and stores it when done', async () => {
    const { engine, advance, finish } = fakeEngine()
    const { local, store, videoAudio } = transcriber(engine)
    await local.start(request)
    await flush()
    expect(videoAudio).toHaveBeenCalledWith(request.url, expect.any(String), expect.anything())
    expect(engine.run.mock.calls[0]![0]).toMatchObject({ language: 'zh', diarize: false, owner: '@khorsheed/dsh-reader' })
    expect(local.status('e1')).toMatchObject({ state: 'queued', ahead: 1 })
    advance()
    expect(local.status('e1')).toMatchObject({ state: 'transcribing', html: '<p data-src="local" data-t="0.0">你好。</p>' })
    finish()
    await flush()
    expect(local.status('e1')).toMatchObject({ state: 'done', progress: 1, language: 'zh' })
    expect(store).toHaveBeenCalledWith('e1', request.url, '<p data-src="local" data-t="0.0">你好。</p>', 'zh')
  })

  it('withdraws a queued job on leave, but lets a running one finish unless forced', async () => {
    const queued = fakeEngine()
    const first = transcriber(queued.engine)
    await first.local.start(request)
    await flush()
    expect(first.local.cancel('e1', false).state).toBe('idle')
    await flush()
    expect(first.store).not.toHaveBeenCalled()

    const running = fakeEngine()
    const second = transcriber(running.engine)
    await second.local.start(request)
    await flush()
    running.advance()
    expect(second.local.cancel('e1', false).state).toBe('transcribing')
    expect(second.local.cancel('e1', true).state).toBe('idle')
    running.finish()
    await flush()
    expect(second.store).not.toHaveBeenCalled()
  })
})
