import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { modelsFor } from '../src/models.ts'
import type { SpeechJob } from '../src/speech-protocol.ts'

const calls: SpeechJob[] = []
let release: (() => void)[] = []

vi.mock('../src/speech.ts', () => ({
  runSpeech: vi.fn((job: SpeechJob, onProgress: (stage: string, v: number) => void, signal: AbortSignal, onSegments: (s: unknown[]) => void) => {
    calls.push(job)
    onProgress('transcribe', 0.5)
    onSegments([{ cluster: 0, start: 0, end: 2, tokens: [{ text: '你', start: 0, end: 1 }, { text: '好', start: 1, end: 2 }] }])
    return new Promise((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      release.push(() => resolve({ segments: [{ cluster: 0, start: 0, end: 2, tokens: [{ text: '你', start: 0, end: 1 }, { text: '好', start: 1, end: 2 }] }], speakers: [], language: 'zh' }))
    })
  }),
}))

const { TranscribeService, segmentText } = await import('../src/service.ts')

/** A state dir whose models all "exist" (the marker files the manager checks). */
async function installedRoot(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'transcribe-svc-'))
  const { MODELS } = await import('../src/models.ts')
  for (const m of MODELS) {
    mkdirSync(join(root, 'models', m.check, '..'), { recursive: true })
    writeFileSync(join(root, 'models', m.check), 'x')
  }
  return root
}

const flush = () => new Promise((r) => setTimeout(r, 10))

beforeEach(() => {
  calls.length = 0
  release = []
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('modelsFor', () => {
  it('routes Chinese to Paraformer + punctuation and everything else to SenseVoice', () => {
    expect(modelsFor('zh', false)).toEqual(['paraformer', 'punctuation', 'vad'])
    expect(modelsFor('en', false)).toEqual(['senseVoice', 'vad'])
    expect(modelsFor('auto', true)).toEqual(['senseVoice', 'segmentation', 'embedding'])
  })
})

describe('TranscribeService', () => {
  it('runs one job at a time, in order, streaming segments and progress', async () => {
    const svc = new TranscribeService({ stateDir: await installedRoot() })
    const progress: string[] = []
    const streamed: string[] = []
    const first = svc.run({ input: { wav: '/a.wav' }, owner: 'a' }, { onSegments: (s) => streamed.push(...s.map((x) => x.text)) })
    const second = svc.run({ input: { wav: '/b.wav' }, language: 'en', owner: 'b' }, { onProgress: (p) => progress.push(p.stage) })
    await vi.waitFor(() => { expect(calls.map((c) => c.wavPath)).toEqual(['/a.wav']) })
    expect(svc.queue().map((q) => `${q.owner}:${q.state}`)).toEqual(['a:running', 'b:queued'])
    expect(progress).toContain('queued')
    expect(streamed).toEqual(['你好'])
    release.shift()!()
    expect((await first).segments[0]!.text).toBe('你好')
    await vi.waitFor(() => { expect(calls.map((c) => c.wavPath)).toEqual(['/a.wav', '/b.wav']) })
    expect(calls[1]!.models.asr.kind).toBe('senseVoice')
    expect(calls[1]!.diarize).toBe(false)
    release.shift()!()
    expect((await second).language).toBe('zh')
    expect(svc.queue()).toEqual([])
  })

  it('withdraws a queued job on abort and stops a running one', async () => {
    const svc = new TranscribeService({ stateDir: await installedRoot() })
    const running = new AbortController()
    const waiting = new AbortController()
    const first = svc.run({ input: { wav: '/a.wav' }, owner: 'a' }, { signal: running.signal })
    const second = svc.run({ input: { wav: '/b.wav' }, owner: 'b' }, { signal: waiting.signal })
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })
    waiting.abort()
    await expect(second).rejects.toThrow('已取消')
    expect(svc.queue().map((q) => q.owner)).toEqual(['a'])
    running.abort()
    await expect(first).rejects.toThrow('aborted')
    expect(svc.queue()).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('runs a speakers job through the same queue, with only the speaker models', async () => {
    const svc = new TranscribeService({ stateDir: await installedRoot() })
    const job = svc.speakers({ input: { wav: '/s.wav' }, speech: [{ start: 0, end: 30 }], owner: 'r' })
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })
    expect(calls[0]!.mode).toBe('speakers')
    expect(calls[0]!.speech).toEqual([{ start: 0, end: 30 }])
    release.shift()!()
    expect((await job).single).toBe(false)
  })

  it('keeps segment times absolute for a job resumed partway (fromSec)', async () => {
    const svc = new TranscribeService({ stateDir: await installedRoot() })
    const job = svc.run({ input: { wav: '/r.wav' }, fromSec: 100, owner: 'r' })
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })
    release.shift()!()
    // A WAV input is used as is: no offset applies.
    expect((await job).segments[0]!.start).toBe(0)
  })

  it('reports what is left to download for a request', async () => {
    const root = mkdtempSync(join(tmpdir(), 'transcribe-svc-'))
    const svc = new TranscribeService({ stateDir: root })
    const { MODELS } = await import('../src/models.ts')
    const sense = MODELS.find((m) => m.id === 'senseVoice')!
    const vad = MODELS.find((m) => m.id === 'vad')!
    expect(await svc.missingBytes(svc.modelsFor({ language: 'en' }))).toBe(sense.bytes + vad.bytes)
    for (const m of [sense, vad]) {
      mkdirSync(join(root, 'models', m.check, '..'), { recursive: true })
      writeFileSync(join(root, 'models', m.check), 'x')
    }
    expect(await svc.missingBytes(svc.modelsFor({ language: 'en' }))).toBe(0)
  })

  it('joins token text, keeping the spacing Latin words carry', () => {
    expect(segmentText({ cluster: 0, start: 0, end: 1, tokens: [{ text: '聊', start: 0, end: 0.1 }, { text: ' large', start: 0.1, end: 0.2 }, { text: ' model', start: 0.2, end: 0.3 }, { text: '是', start: 0.3, end: 0.4 }] })).toBe('聊 large model是')
  })
})
