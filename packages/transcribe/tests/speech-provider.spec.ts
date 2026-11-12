import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SpeechToText from '@deepseek-ai/dsh-experimental-speech-to-text'
import { LocalSpeechProvider, registerLocalSpeechProvider } from '../src/speech-provider.ts'
import { TranscribeService } from '../src/service.ts'
import { fetchWithResume, MODELS, type ModelStatus } from '../src/models.ts'

function wav(): Uint8Array {
  const data = Buffer.alloc(44 + 320)
  data.write('RIFF', 0)
  data.writeUInt32LE(data.length - 8, 4)
  data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(16000, 24)
  data.writeUInt32LE(32000, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(data.length - 44, 40)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

function models(state: 'installed' | 'missing'): ModelStatus[] {
  return MODELS.map(model => ({ id: model.id, label: model.label, bytes: model.bytes, state, progress: state === 'installed' ? 1 : 0 }))
}

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

async function fixture(): Promise<TranscribeService> {
  const root = await mkdtemp(join(tmpdir(), 'transcribe-speech-provider-'))
  roots.push(root)
  return new TranscribeService({ stateDir: root })
}

describe('official local speech provider', () => {
  it('registers with the official registry and transcribes a real WAV through the shared service', async () => {
    const service = await fixture()
    vi.spyOn(service, 'models').mockResolvedValue(models('installed'))
    const run = vi.spyOn(service, 'run').mockImplementation(async request => {
      expect(await readFile(request.input.wav)).toEqual(Buffer.from(wav()))
      return { segments: [{ cluster: 0, start: 0, end: 0.01, text: '你好', tokens: [{ text: '你好', start: 0, end: 0.01 }] }], speakers: [] }
    })
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SpeechToText, { defaultProvider: 'transcribe-local', language: 'zh' })
    registerLocalSpeechProvider(ctx, service)
    await vi.waitFor(() => { expect(ctx.speechToText.listProviders().map(provider => provider.id)).toEqual(['transcribe-local']) })
    const result = await ctx.speechToText.transcribe(ctx.speechToText.resolve({ audio: wav(), language: 'zh' }), new AbortController().signal)
    expect(result.text).toBe('你好')
    expect(result.audioSeconds).toBe(0.01)
    expect(result.inferenceSeconds).toBeGreaterThanOrEqual(0)
    expect(run).toHaveBeenCalledOnce()
    expect(run.mock.calls[0]?.[0].language).toBe('zh')
    await ctx.speechToText.transcribe(ctx.speechToText.resolve({ audio: wav(), language: 'en' }), new AbortController().signal)
    expect(run.mock.calls[1]?.[0].language).toBe('en')
    expect(await readdir(join(service.root, 'tmp'))).toEqual([])
    const registry = ctx.speechToText
    await ctx.fiber.dispose()
    expect(registry.listProviders()).toEqual([])
  })

  it('rejects invalid WAV input without starting work', async () => {
    const service = await fixture()
    const run = vi.spyOn(service, 'run')
    const provider = new LocalSpeechProvider(service)
    await expect(provider.transcribe({ audio: new Uint8Array([1, 2]), language: 'zh' }, new AbortController().signal)).rejects.toThrow('canonical')
    expect(run).not.toHaveBeenCalled()
    await provider.dispose()
  })

  it('cancels shared model preparation and reports a usable retry state', async () => {
    const service = await fixture()
    vi.spyOn(service, 'models').mockResolvedValue(models('missing'))
    let signal: AbortSignal | undefined
    const prepare = vi.spyOn(service, 'prepare').mockImplementation(async (_ids, _source, caller) => {
      signal = caller
      await new Promise<void>((_resolve, reject) => { caller?.addEventListener('abort', () => { reject(new Error('cancelled')) }, { once: true }) })
    })
    const provider = new LocalSpeechProvider(service)
    expect(() => provider.preparation!.prepare({ downloadSource: 'https://example.invalid' })).toThrow('unavailable')
    provider.preparation!.prepare({ downloadSource: 'https://hf-mirror.com' })
    await vi.waitFor(() => { expect(provider.preparation!.snapshot().phase).toBe('downloading') })
    await provider.preparation!.cancel()
    expect(signal?.aborted).toBe(true)
    expect(provider.preparation!.snapshot().phase).toBe('cancelled')
    expect(prepare.mock.calls[0]?.[1]).toBe('hf-mirror')
    await provider.dispose()
  })
})

describe('cancellable model downloads', () => {
  it('aborts the response stream and keeps the verified partial bytes for a retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'transcribe-download-cancel-'))
    roots.push(root)
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-length': 2 })
      response.write('a')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    expect(address).not.toBeNull()
    const abort = new AbortController()
    setTimeout(() => { abort.abort(new Error('cancel download')) }, 50)
    const part = join(root, 'model.part')
    try {
      await expect(fetchWithResume(`http://127.0.0.1:${String(address!.port)}/model`, part, { bytes: 2 }, () => {}, abort.signal)).rejects.toThrow()
      expect(await readFile(part, 'utf8')).toBe('a')
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => { resolve() }))
    }
  })
})
