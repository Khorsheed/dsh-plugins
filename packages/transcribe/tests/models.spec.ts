import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CorruptDownloadError, downloadHfFiles, fetchWithResume, ModelManager, MODELS, orderSources } from '../src/models.ts'

const servers: Server[] = []

/** Serve `content`, honoring single-range requests when `range` is on. */
async function serve(content: Buffer, range: boolean): Promise<{ url: string; requests: Array<{ range?: string | undefined }> }> {
  const requests: Array<{ range?: string | undefined }> = []
  const server = createServer((req, res) => {
    requests.push({ range: req.headers.range as string | undefined })
    const match = range && req.headers.range ? /^bytes=(\d+)-$/.exec(req.headers.range) : null
    if (match) {
      const start = Number(match[1])
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${content.length - 1}/${content.length}`, 'Content-Length': content.length - start })
      res.end(content.subarray(start))
    } else {
      res.writeHead(200, { 'Content-Length': content.length })
      res.end(content)
    }
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  return { url: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/asset`, requests }
}

afterEach(() => {
  while (servers.length) servers.pop()!.close()
})

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function sample(size: number): Buffer {
  let seed = 42
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff)
  return Buffer.from({ length: size }, () => rnd() % 256)
}

describe('fetchWithResume', () => {
  it('downloads fresh and reports absolute byte progress', async () => {
    const content = sample(10000)
    const { url } = await serve(content, true)
    const part = join(mkdtempSync(join(tmpdir(), 'vs-dl-')), 'x.part')
    const seen: number[] = []
    const digest = await fetchWithResume(url, part, { bytes: content.length, sha256: sha256(content) }, (got) => seen.push(got))
    expect(readFileSync(part)).toEqual(content)
    expect(digest).toBe(sha256(content))
    expect(seen.at(-1)).toBe(content.length)
  })

  it('resumes a partial file with a Range request and verifies the whole file', async () => {
    const content = sample(10000)
    const { url, requests } = await serve(content, true)
    const part = join(mkdtempSync(join(tmpdir(), 'vs-dl-')), 'x.part')
    writeFileSync(part, content.subarray(0, 4000))
    const seen: number[] = []
    const digest = await fetchWithResume(url, part, { bytes: content.length, sha256: sha256(content) }, (got) => seen.push(got))
    expect(requests[0]!.range).toBe('bytes=4000-')
    expect(readFileSync(part)).toEqual(content)
    expect(digest).toBe(sha256(content))
    expect(seen[0]).toBe(4000) // progress picks up where the partial left off
  })

  it('starts over cleanly when the server ignores Range', async () => {
    const content = sample(10000)
    const { url, requests } = await serve(content, false)
    const part = join(mkdtempSync(join(tmpdir(), 'vs-dl-')), 'x.part')
    writeFileSync(part, content.subarray(0, 4000))
    await fetchWithResume(url, part, { bytes: content.length }, () => {})
    expect(requests[0]!.range).toBe('bytes=4000-')
    expect(readFileSync(part)).toEqual(content) // truncated and rewritten, not appended
  })

  it('verifies a complete leftover without any request', async () => {
    const content = sample(10000)
    const { url, requests } = await serve(content, true)
    const part = join(mkdtempSync(join(tmpdir(), 'vs-dl-')), 'x.part')
    writeFileSync(part, content)
    await fetchWithResume(url, part, { bytes: content.length, sha256: sha256(content) }, () => {})
    expect(requests).toHaveLength(0)
  })

  it('rejects a hash mismatch as corruption, keeps a short read for resuming', async () => {
    const content = sample(10000)
    const { url } = await serve(content, true)
    const part = join(mkdtempSync(join(tmpdir(), 'vs-dl-')), 'x.part')
    await expect(fetchWithResume(url, part, { bytes: content.length, sha256: '0'.repeat(64) }, () => {})).rejects.toBeInstanceOf(CorruptDownloadError)
    const { url: url2 } = await serve(content.subarray(0, 6000), true)
    const part2 = join(mkdtempSync(join(tmpdir(), 'vs-dl-')), 'x.part')
    await expect(fetchWithResume(url2, part2, { bytes: content.length }, () => {})).rejects.toThrow('文件大小不符')
    expect(existsSync(part2)).toBe(true) // valid prefix survives for the retry
  })
})

describe('ModelManager partial state', () => {
  it('reports leftover .part bytes as resumable progress after a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'transcribe-models-'))
    const seg = MODELS.find((m) => m.id === 'segmentation')!
    mkdirSync(join(dir, 'sherpa-onnx-pyannote-segmentation-3-0'))
    writeFileSync(join(dir, 'sherpa-onnx-pyannote-segmentation-3-0/model.onnx.part'), sample(1234))
    const mgr = new ModelManager(dir)
    const list = await mgr.refresh()
    const segStatus = list.find((s) => s.id === 'segmentation')!
    expect(segStatus.state).toBe('missing')
    expect(segStatus.partial).toBe(1234)
    expect(list.every((s) => s.state !== 'installed')).toBe(true)
    // an installed model reports no partial
    writeFileSync(join(dir, seg.check), 'x') // not the real model, just the marker path
    const list2 = await mgr.refresh()
    const seg2 = list2.find((s) => s.id === 'segmentation')!
    expect(seg2.state).toBe('installed')
    expect(seg2.partial).toBeUndefined()
  })
})

describe('orderSources', () => {
  it('orders reachable sources by latency, unreachable last', async () => {
    const content = sample(16)
    const fast = await serve(content, true)
    const deadPort = 1 // nothing listens there
    const ordered = await orderSources([
      { id: 'dead', url: `http://127.0.0.1:${deadPort}/x` },
      { id: 'fast', url: fast.url },
    ])
    expect(ordered[0]).toBe('fast')
    expect(ordered.at(-1)).toBe('dead')
  })
})

describe('downloadHfFiles', () => {
  function serveRepo(files: Record<string, Buffer>) {
    const requests: Array<{ path: string; range?: string | undefined }> = []
    const server = createServer((req, res) => {
      const path = decodeURIComponent((req.url ?? '').replace('/repo/resolve/main/', ''))
      requests.push({ path, range: req.headers.range as string | undefined })
      const content = files[path]
      if (!content) {
        res.writeHead(404)
        res.end()
        return
      }
      const match = req.headers.range ? /^bytes=(\d+)-$/.exec(req.headers.range) : null
      if (match) {
        const start = Number(match[1])
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${content.length - 1}/${content.length}` })
        res.end(content.subarray(start))
      } else {
        res.writeHead(200)
        res.end(content)
      }
    })
    servers.push(server)
    return new Promise<{ origin: string; requests: typeof requests }>((resolve) =>
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        resolve({ origin: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, requests })
      }),
    )
  }

  it('downloads repo files into place, resuming partials and reusing installed files', async () => {
    const a = sample(8000)
    const b = sample(3000)
    const { origin, requests } = await serveRepo({ 'a.onnx': a, 'b.txt': b })
    const dir = mkdtempSync(join(tmpdir(), 'vs-hf-'))
    mkdirSync(join(dir, 'sub'), { recursive: true })
    writeFileSync(join(dir, 'sub', 'a.onnx.part'), a.subarray(0, 5000))
    const files = [
      { repo: 'a.onnx', path: 'sub/a.onnx', bytes: a.length, sha256: sha256(a) },
      { repo: 'b.txt', path: 'sub/b.txt', bytes: b.length, sha256: sha256(b) },
    ]
    const progress: Array<[number, number]> = []
    await downloadHfFiles(dir, origin, 'repo', files, (got, total) => progress.push([got, total]))
    expect(requests.find((r) => r.path === 'a.onnx')!.range).toBe('bytes=5000-')
    expect(readFileSync(join(dir, 'sub', 'a.onnx'))).toEqual(a)
    expect(readFileSync(join(dir, 'sub', 'b.txt'))).toEqual(b)
    expect(progress.at(-1)).toEqual([a.length + b.length, a.length + b.length])
    // second run: everything at pinned size, no network
    requests.length = 0
    await downloadHfFiles(dir, origin, 'repo', files, () => {})
    expect(requests).toHaveLength(0)
  })
})
