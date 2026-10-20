import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { cuesFromSegments, languageFor, LocalTranscriber, renderLocalTranscript, renderSpeakerTranscript, speakerPerToken, type EngineSegment, type TranscribeEngine } from '../src/local-transcribe.ts'
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

  it('always lets the engine detect the language', () => {
    expect(languageFor(video)).toBe('auto')
    expect(languageFor({ kind: 'audio', provider: 'xiaoyuzhou', ref: 'https://x/a.m4a' })).toBe('auto')
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
      finish = () => resolve({ segments: [{ start: 0, end: 1, tokens: [tok('你', 0), tok('好', 0.3), tok('。', 0.6)] }], language: 'zh' })
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
    expect(engine.run.mock.calls[0]![0]).toMatchObject({ language: 'auto', diarize: false, owner: '@khorsheed/dsh-reader' })
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

describe('long run-on sentences', () => {
  it('close at a comma once they are long, so paragraphs stay readable', () => {
    // 40 one-second words, a comma at 25 s, no period at all
    const tokens = Array.from({ length: 40 }, (_, index) => ({ text: index === 25 ? ' word,' : ' word', start: index, end: index + 0.9 }))
    const cues = cuesFromSegments([{ start: 0, end: 40, tokens }])
    expect(cues.map((cue) => cue.start)).toEqual([0, 26])
  })
})

describe('speakers', () => {
  // two voices: A 0–10 s, B 10–20 s, with a 1 s flicker of B inside A's turn
  const tokens = Array.from({ length: 20 }, (_, index) => ({ text: index === 9 || index === 19 ? ' end.' : ' word', start: index, end: index + 0.9 }))
  const segments = [{ start: 0, end: 20, tokens }]
  const turns = [{ cluster: 7, start: 0, end: 4.8 }, { cluster: 3, start: 4.8, end: 5.6 }, { cluster: 7, start: 5.6, end: 10 }, { cluster: 3, start: 10, end: 20 }]

  it('gives each word its voice, in order of appearance, folding flickers', () => {
    const voices = speakerPerToken(segments, turns)
    expect(voices.slice(0, 10)).toEqual(Array(10).fill(0))
    expect(voices.slice(10)).toEqual(Array(10).fill(1))
  })

  it('never lets a paragraph cross a change of voice', () => {
    const html = renderSpeakerTranscript(segments, turns)
    expect(html.split('\n')).toEqual([
      expect.stringContaining('data-spk="0" data-t="0.0"'),
      expect.stringContaining('data-spk="1" data-t="10.0"'),
    ])
  })
})

describe('the speakers pass', () => {
  const request = { entryId: 'e1', url: 'https://www.bilibili.com/video/BV1xx', media: video, title: 'T' }

  it('runs after the transcript is stored, and re-stores it cut by speaker', async () => {
    const { engine, finish } = fakeEngine()
    let answer: ((value: { single: boolean; turns: { cluster: number; start: number; end: number }[] }) => void) | undefined
    const withSpeakers = { ...engine, speakers: vi.fn(() => new Promise<{ single: boolean; turns: { cluster: number; start: number; end: number }[] }>((resolve) => { answer = resolve })) }
    const { local, store } = transcriber(withSpeakers)
    await local.start(request)
    await flush()
    finish()
    await flush()
    expect(local.status('e1').state).toBe('speakers')
    expect(store).toHaveBeenCalledTimes(1)
    expect(withSpeakers.speakers.mock.calls[0]![0]).toMatchObject({ speech: [{ start: 0, end: 1 }] })
    answer?.({ single: false, turns: [{ cluster: 0, start: 0, end: 0.4 }, { cluster: 1, start: 0.4, end: 1 }] })
    await flush()
    expect(local.status('e1')).toMatchObject({ state: 'done', speakers: 2 })
    expect(store).toHaveBeenLastCalledWith('e1', request.url, expect.stringContaining('data-spk='), 'zh', 2)
  })

  it('leaves a one-voice transcript as it is', async () => {
    const { engine, finish } = fakeEngine()
    const single = { ...engine, speakers: vi.fn(async () => ({ single: true, turns: [] })) }
    const { local, store } = transcriber(single)
    await local.start(request)
    await flush()
    finish()
    await flush()
    expect(local.status('e1')).toMatchObject({ state: 'done', speakers: 1 })
    expect(store).toHaveBeenLastCalledWith('e1', request.url, '<p data-src="local" data-t="0.0">你好。</p>', 'zh', 1)
  })
})
