import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { run } from './ffmpeg.ts'
import type { SpeechModelPaths } from './speech-protocol.ts'

/**
 * The speech models, pinned to sherpa-onnx GitHub release assets and
 * downloaded on first use. Each entry is checked by the file it must leave
 * behind and by the archive's byte size (GitHub publishes no checksums).
 */
const BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download'

export interface ModelSpec {
  id: 'asr' | 'punctuation' | 'segmentation' | 'embedding'
  label: string
  url: string
  /** Archive (or single-file) byte size, for progress and integrity. */
  bytes: number
  /** tar.bz2 archive to unpack, or a single file saved as-is. */
  archive: boolean
  /** Path (relative to the models dir) that exists once installed. */
  check: string
}

export const MODELS: readonly ModelSpec[] = [
  {
    id: 'asr',
    label: '语音转写 · Paraformer 中文',
    url: `${BASE}/asr-models/sherpa-onnx-paraformer-zh-2023-09-14.tar.bz2`,
    bytes: 234051698,
    archive: true,
    check: 'sherpa-onnx-paraformer-zh-2023-09-14/model.int8.onnx',
  },
  {
    id: 'punctuation',
    label: '标点 · CT-Transformer',
    url: `${BASE}/punctuation-models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2`,
    bytes: 64717756,
    archive: true,
    check: 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8/model.int8.onnx',
  },
  {
    id: 'segmentation',
    label: '分人 · pyannote 分段',
    url: `${BASE}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`,
    bytes: 6958444,
    archive: true,
    check: 'sherpa-onnx-pyannote-segmentation-3-0/model.onnx',
  },
  {
    id: 'embedding',
    label: '认人 · CAM++ 声纹',
    url: `${BASE}/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx`,
    bytes: 28281138,
    archive: false,
    check: '3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx',
  },
]

export type ModelState = 'missing' | 'downloading' | 'installed' | 'failed'

export interface ModelStatus {
  id: ModelSpec['id']
  label: string
  bytes: number
  state: ModelState
  progress: number
  error?: string | undefined
}

export function speechModelPaths(dir: string): SpeechModelPaths {
  return {
    asr: {
      kind: 'paraformer',
      model: join(dir, 'sherpa-onnx-paraformer-zh-2023-09-14/model.int8.onnx'),
      tokens: join(dir, 'sherpa-onnx-paraformer-zh-2023-09-14/tokens.txt'),
    },
    punctuation: join(dir, 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8/model.int8.onnx'),
    segmentation: join(dir, 'sherpa-onnx-pyannote-segmentation-3-0/model.onnx'),
    embedding: join(dir, '3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx'),
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Downloads models one at a time; status is in memory and re-derived from disk at start. */
export class ModelManager {
  private readonly status = new Map<ModelSpec['id'], ModelStatus>()
  private running: Promise<void> | null = null

  constructor(readonly dir: string) {
    for (const m of MODELS) this.status.set(m.id, { id: m.id, label: m.label, bytes: m.bytes, state: 'missing', progress: 0 })
  }

  async refresh(): Promise<ModelStatus[]> {
    for (const m of MODELS) {
      const s = this.status.get(m.id)!
      if (s.state === 'downloading') continue
      if (await exists(join(this.dir, m.check))) Object.assign(s, { state: 'installed', progress: 1, error: undefined })
      else if (s.state === 'installed') Object.assign(s, { state: 'missing', progress: 0 })
    }
    return this.list()
  }

  list(): ModelStatus[] {
    return MODELS.map((m) => ({ ...this.status.get(m.id)! }))
  }

  async ready(): Promise<boolean> {
    return (await this.refresh()).every((s) => s.state === 'installed')
  }

  /** Start (or join) downloading every missing model. */
  ensure(): Promise<void> {
    if (!this.running) {
      this.running = this.downloadMissing().finally(() => {
        this.running = null
      })
    }
    return this.running
  }

  private async downloadMissing(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await this.refresh()
    for (const m of MODELS) {
      const s = this.status.get(m.id)!
      if (s.state === 'installed') continue
      Object.assign(s, { state: 'downloading', progress: 0, error: undefined })
      try {
        await this.download(m, (p) => {
          s.progress = p
        })
        if (!(await exists(join(this.dir, m.check)))) throw new Error('下载完成但文件不完整')
        Object.assign(s, { state: 'installed', progress: 1 })
      } catch (error) {
        Object.assign(s, { state: 'failed', error: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  private async download(m: ModelSpec, onProgress: (p: number) => void): Promise<void> {
    const name = m.url.split('/').pop()!
    const part = join(this.dir, `${name}.part`)
    let lastError: unknown
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(m.url, { redirect: 'follow' })
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
        let got = 0
        const body = Readable.fromWeb(res.body as never)
        body.on('data', (chunk: Buffer) => {
          got += chunk.length
          onProgress(Math.min(0.99, got / m.bytes))
        })
        await pipeline(body, createWriteStream(part))
        if ((await stat(part)).size !== m.bytes) throw new Error('文件大小不符')
        if (m.archive) {
          const res2 = await run('tar', ['-xjf', part, '-C', this.dir])
          if (res2.code !== 0) throw new Error(`解压失败：${res2.stderr.trim().slice(-200)}`)
          await rm(part, { force: true })
        } else {
          await rename(part, join(this.dir, m.check))
        }
        return
      } catch (error) {
        lastError = error
        await rm(part, { force: true })
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }
}
