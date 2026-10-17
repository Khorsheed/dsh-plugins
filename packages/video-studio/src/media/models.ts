import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { SpeechModelPaths } from './speech-protocol.ts'

/**
 * The speech models — open-source models (FunASR Paraformer / CT-Transformer,
 * pyannote, 3D-Speaker CAM++) as packaged by the sherpa-onnx project —
 * downloaded on first use from HuggingFace repos (csukuangfj is the k2-fsa
 * maintainer; the int8 punctuation repo is a community re-upload, pinned all
 * the same). Every file is verified against a pinned sha256 taken from the HF
 * LFS oid, cross-checked against a known-good local install of the previous
 * GitHub release channel (byte-identical). Two origins are offered —
 * huggingface.co and the hf-mirror.com 国内镜像 — probed per download when set
 * to auto. Partial downloads are kept and resumed with Range requests, so a
 * restart never re-downloads received bytes; bytes that fail verification are
 * dropped.
 */
export type ModelSourceChoice = 'auto' | 'huggingface' | 'hf-mirror'
export const MODEL_SOURCE_CHOICES: readonly ModelSourceChoice[] = ['auto', 'huggingface', 'hf-mirror']

const HF_ORIGINS = {
  huggingface: 'https://huggingface.co',
  'hf-mirror': 'https://hf-mirror.com',
} as const

type HfOrigin = keyof typeof HF_ORIGINS

export interface ModelFile {
  /** Path inside the HF repo. */
  repo: string
  /** Install path relative to the models dir. */
  path: string
  bytes: number
  sha256: string
}

export interface ModelSpec {
  id: 'asr' | 'punctuation' | 'segmentation' | 'embedding'
  label: string
  /** Display size — total bytes across the model's files. */
  bytes: number
  /** Path (relative to the models dir) that exists once installed. */
  check: string
  /** HuggingFace repo with the model's files, downloaded one by one. */
  hf: { repo: string; files: ModelFile[] }
}

export const MODELS: readonly ModelSpec[] = [
  {
    id: 'asr',
    label: '语音转写 · Paraformer 中文',
    bytes: 243446974,
    check: 'sherpa-onnx-paraformer-zh-2023-09-14/model.int8.onnx',
    hf: {
      repo: 'csukuangfj/sherpa-onnx-paraformer-zh-2023-09-14',
      files: [
        { repo: 'model.int8.onnx', path: 'sherpa-onnx-paraformer-zh-2023-09-14/model.int8.onnx', bytes: 243371218, sha256: 'f36a0433bcf096bd6d6f11b80a3ac8bed110bdca632fe0d731df8d1a84475945' },
        { repo: 'tokens.txt', path: 'sherpa-onnx-paraformer-zh-2023-09-14/tokens.txt', bytes: 75756, sha256: '59aba8873a2ed1e122c25fee421e25f283b63290efbde85c1f01a853d83cb6e6' },
      ],
    },
  },
  {
    id: 'punctuation',
    label: '标点 · CT-Transformer',
    bytes: 79726678,
    check: 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8/model.int8.onnx',
    hf: {
      // csukuangfj 只有 fp32 仓；int8 内容经哈希验证与此前的 GitHub 发布逐字节一致。
      repo: 'ranger810/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8',
      files: [
        { repo: 'model.int8.onnx', path: 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8/model.int8.onnx', bytes: 75519198, sha256: '65a3fb9f5ad7bfb96bf69e0dc4481df97f6ee60513c1d94ce981ba6effd524b1' },
        { repo: 'tokens.json', path: 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8/tokens.json', bytes: 4207480, sha256: 'c960ab87bccea4aa15cf49a59f71973c2c330b46668048cd8da253749ec71ee3' },
      ],
    },
  },
  {
    id: 'segmentation',
    label: '分人 · pyannote 分段',
    bytes: 5992913,
    check: 'sherpa-onnx-pyannote-segmentation-3-0/model.onnx',
    hf: {
      repo: 'csukuangfj/sherpa-onnx-pyannote-segmentation-3-0',
      files: [
        { repo: 'model.onnx', path: 'sherpa-onnx-pyannote-segmentation-3-0/model.onnx', bytes: 5992913, sha256: '220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079' },
      ],
    },
  },
  {
    id: 'embedding',
    label: '认人 · CAM++ 声纹',
    bytes: 28281138,
    check: '3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx',
    hf: {
      repo: 'csukuangfj/speaker-embedding-models',
      files: [
        { repo: '3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx', path: '3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx', bytes: 28281138, sha256: 'f682b514c05d947ee3fa91cd6ec6c5c7543479a128373fa29b1faedccd21fd11' },
      ],
    },
  },
]

export type ModelState = 'missing' | 'downloading' | 'installed' | 'failed'

export interface ModelStatus {
  id: ModelSpec['id']
  label: string
  bytes: number
  state: ModelState
  progress: number
  /** Bytes of resumable partial downloads left on disk (only when not installed). */
  partial?: number | undefined
  error?: string | undefined
}

/** The downloaded bytes failed verification — the partial file cannot be a resume base. */
export class CorruptDownloadError extends Error {}

function hfUrl(origin: string, repo: string, file: ModelFile): string {
  return `${origin}/${repo}/resolve/main/${file.repo}`
}

/**
 * Download `url` into `part`, resuming from the bytes already on disk when
 * the server honors Range (HF resolve URLs do). Never deletes `part` on
 * network failure — the caller decides. Throws CorruptDownloadError when the
 * completed file fails verification. Returns the file's sha256.
 */
export async function fetchWithResume(
  url: string,
  part: string,
  expected: { bytes: number; sha256?: string | undefined },
  onProgress: (got: number) => void,
): Promise<string> {
  const digestFile = async (): Promise<string> => {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(part)) hash.update(chunk as Buffer)
    return hash.digest('hex')
  }
  let have = await stat(part).then((s) => s.size, () => 0)
  if (have > expected.bytes) {
    await rm(part, { force: true })
    have = 0
  }
  if (have > 0) onProgress(have)
  // A complete leftover (crash between download and publish) only needs verifying.
  if (have === expected.bytes) {
    const digest = await digestFile()
    if (expected.sha256 && digest !== expected.sha256) throw new CorruptDownloadError('校验和不符')
    return digest
  }
  const res = await fetch(url, { redirect: 'follow', headers: have > 0 ? { Range: `bytes=${have}-` } : {} })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  let append = false
  if (have > 0 && res.status === 206) {
    const range = /^bytes (\d+)-/.exec(res.headers.get('content-range') ?? '')
    append = range !== null && Number(range[1]) === have
  }
  const hash = createHash('sha256')
  let got = 0
  if (append) {
    got = have
    for await (const chunk of createReadStream(part)) hash.update(chunk as Buffer)
  }
  const body = Readable.fromWeb(res.body as never)
  body.on('data', (chunk: Buffer) => {
    hash.update(chunk)
    got += chunk.length
    onProgress(got)
  })
  await pipeline(body, createWriteStream(part, { flags: append ? 'a' : 'w' }))
  // Short read: the prefix is still valid — keep it and let the retry resume.
  if (got !== expected.bytes) throw new Error(`文件大小不符（${got}/${expected.bytes}）`)
  const digest = hash.digest('hex')
  if (expected.sha256 && digest !== expected.sha256) throw new CorruptDownloadError('校验和不符')
  return digest
}

/** HEAD-probe candidate sources; reachable ones first, fastest first. */
export async function orderSources(cands: ReadonlyArray<{ id: string; url: string }>, timeoutMs = 3000): Promise<string[]> {
  const probed = await Promise.all(
    cands.map(async (c) => {
      const start = Date.now()
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeoutMs)
      try {
        const res = await fetch(c.url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal })
        return { id: c.id, ok: res.ok, ms: Date.now() - start }
      } catch {
        return { id: c.id, ok: false, ms: timeoutMs }
      } finally {
        clearTimeout(timer)
      }
    }),
  )
  return probed.sort((a, b) => Number(b.ok) - Number(a.ok) || a.ms - b.ms).map((p) => p.id)
}

/**
 * Download a model file-by-file from an HF origin, resuming each file and
 * publishing with an atomic rename. Files already at their pinned size are
 * reused; a file that fails verification is dropped before the caller retries.
 */
export async function downloadHfFiles(
  dir: string,
  origin: string,
  repo: string,
  files: readonly ModelFile[],
  onProgress: (got: number, total: number) => void,
): Promise<void> {
  const total = files.reduce((s, f) => s + f.bytes, 0)
  let done = 0
  for (const f of files) {
    const finalPath = join(dir, f.path)
    const part = `${finalPath}.part`
    const installed = await stat(finalPath).then((s) => s.size, () => 0)
    if (installed === f.bytes) {
      done += f.bytes
      onProgress(done, total)
      continue
    }
    if (installed > 0) await rm(finalPath, { force: true })
    try {
      await fetchWithResume(hfUrl(origin, repo, f), part, { bytes: f.bytes, sha256: f.sha256 }, (got) => onProgress(done + got, total))
    } catch (error) {
      if (error instanceof CorruptDownloadError) await rm(part, { force: true })
      throw error
    }
    await mkdir(dirname(finalPath), { recursive: true })
    await rename(part, finalPath)
    done += f.bytes
    onProgress(done, total)
  }
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
      if (await exists(join(this.dir, m.check))) Object.assign(s, { state: 'installed', progress: 1, error: undefined, partial: undefined })
      else {
        if (s.state === 'installed') Object.assign(s, { state: 'missing', progress: 0 })
        let partial = 0
        for (const f of m.hf.files) partial += await stat(join(this.dir, `${f.path}.part`)).then((x) => x.size, () => 0)
        s.partial = partial > 0 ? partial : undefined
      }
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
  ensure(choice: ModelSourceChoice = 'auto'): Promise<void> {
    if (!this.running) {
      const source = MODEL_SOURCE_CHOICES.includes(choice) ? choice : 'auto'
      this.running = this.downloadMissing(source).finally(() => {
        this.running = null
      })
    }
    return this.running
  }

  private async downloadMissing(choice: ModelSourceChoice): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    // Legacy GitHub-channel archive partials can never be resumed — drop them.
    for (const f of await readdir(this.dir)) if (f.endsWith('.tar.bz2.part')) await rm(join(this.dir, f), { force: true })
    await this.refresh()
    for (const m of MODELS) {
      const s = this.status.get(m.id)!
      if (s.state === 'installed') continue
      Object.assign(s, { state: 'downloading', progress: 0, error: undefined, partial: undefined })
      try {
        await this.download(m, choice, (p) => {
          s.progress = p
        })
        if (!(await exists(join(this.dir, m.check)))) throw new Error('下载完成但文件不完整')
        Object.assign(s, { state: 'installed', progress: 1 })
      } catch (error) {
        Object.assign(s, { state: 'failed', error: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  private async download(m: ModelSpec, choice: ModelSourceChoice, onProgress: (p: number) => void): Promise<void> {
    const order: HfOrigin[] =
      choice === 'auto'
        ? ((await orderSources((Object.keys(HF_ORIGINS) as HfOrigin[]).map((o) => ({ id: o, url: hfUrl(HF_ORIGINS[o], m.hf.repo, m.hf.files[0]!) })))) as HfOrigin[])
        : [choice]
    let lastError: unknown
    for (const origin of order) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await downloadHfFiles(this.dir, HF_ORIGINS[origin], m.hf.repo, m.hf.files, (got, total) => onProgress(Math.min(0.99, got / total)))
          return
        } catch (error) {
          lastError = error
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }
}
