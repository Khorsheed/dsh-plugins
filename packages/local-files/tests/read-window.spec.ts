/**
 * Windowed-read tests for the local-files service: text reads are bounded by
 * the MAX_CONTENT_BYTES + 1 window (never a whole-file read), the Remote
 * `offset` parameter reads mid-file windows, truncated reads report
 * `nextOffset`, and an oversized image short-circuits at stat.
 */
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalFilesRemoteService } from '../src/remote.ts'
import { LocalFilesService, MAX_CONTENT_BYTES } from '../src/service.ts'

/** Window arguments of every `handle.read` the service issues (mock below). */
const fsReads = vi.hoisted(() => [] as { length: number; position: number }[])

// Wrap `open` so the suite can assert every read stays inside the bounded
// window; every other fs/promises function passes through to the real module.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: vi.fn(async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      const read = handle.read.bind(handle)
      handle.read = (async (buffer: Buffer, offset: number, length: number, position: number) => {
        fsReads.push({ length, position })
        return read(buffer, offset, length, position)
      }) as unknown as typeof handle.read
      return handle
    }),
  }
})

describe('LocalFilesService windowed reads', () => {
  const service = new LocalFilesService()
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-local-files-window-'))
    fsReads.length = 0
    vi.mocked(open).mockClear()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads a large text file through the bounded window, never the whole file', async () => {
    writeFileSync(join(dir, 'big.txt'), 'a'.repeat(MAX_CONTENT_BYTES + 100))
    const result = await service.readFile(join(dir, 'big.txt'))
    expect(result.kind).toBe('text')
    expect(result.truncated).toBe(true)
    expect(result.content).toHaveLength(MAX_CONTENT_BYTES)
    expect(result.nextOffset).toBe(MAX_CONTENT_BYTES)
    expect(result.size).toBe(MAX_CONTENT_BYTES + 100)
    // The whole-file read would have issued one read of size + 1; a bounded
    // read never asks for more than the window.
    expect(fsReads.length).toBeGreaterThan(0)
    for (const call of fsReads) {
      expect(call.length).toBeLessThanOrEqual(MAX_CONTENT_BYTES + 1)
    }
  })

  it('a file of exactly the cap is not truncated', async () => {
    writeFileSync(join(dir, 'exact.txt'), 'b'.repeat(MAX_CONTENT_BYTES))
    const result = await service.readFile(join(dir, 'exact.txt'))
    expect(result.kind).toBe('text')
    expect(result.truncated).toBe(false)
    expect(result.content).toHaveLength(MAX_CONTENT_BYTES)
    expect(result.nextOffset).toBeUndefined()
  })

  it('reads a middle window from a nonzero offset', async () => {
    writeFileSync(join(dir, 'data.txt'), '0123456789')
    const result = await service.readFile(join(dir, 'data.txt'), 4)
    expect(result).toMatchObject({ kind: 'text', content: '456789', truncated: false, size: 10 })
    expect(result.nextOffset).toBeUndefined()
    expect(fsReads[0]).toMatchObject({ position: 4 })
  })

  it('chains windows: nextOffset resumes exactly where the cap cut', async () => {
    const content = 'x'.repeat(MAX_CONTENT_BYTES) + 'tail'
    writeFileSync(join(dir, 'chain.txt'), content)
    const first = await service.readFile(join(dir, 'chain.txt'))
    expect(first.truncated).toBe(true)
    expect(first.nextOffset).toBe(MAX_CONTENT_BYTES)
    const second = await service.readFile(join(dir, 'chain.txt'), first.nextOffset)
    expect(second).toMatchObject({ kind: 'text', content: 'tail', truncated: false, size: MAX_CONTENT_BYTES + 4 })
    expect(second.nextOffset).toBeUndefined()
    // The continuation consumed the file with no gap and no overlap.
    expect((first.content?.length ?? 0) + (second.content?.length ?? 0)).toBe(content.length)
  })

  it('short-circuits an oversized image at stat without opening the file', async () => {
    // A sparse file: over the cap by stat size, without writing real content.
    writeFileSync(join(dir, 'huge.png'), Buffer.alloc(8))
    truncateSync(join(dir, 'huge.png'), MAX_CONTENT_BYTES + 1)
    const result = await service.readFile(join(dir, 'huge.png'))
    expect(result).toEqual({ path: join(dir, 'huge.png'), kind: 'too-large', size: MAX_CONTENT_BYTES + 1 })
    expect(open).not.toHaveBeenCalled()
    expect(fsReads).toHaveLength(0)
  })

  it('still serves an image within the cap through the bounded read', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    writeFileSync(join(dir, 'pic.png'), png)
    const result = await service.readFile(join(dir, 'pic.png'))
    expect(result.kind).toBe('image')
    expect(Buffer.from((result.url ?? '').split(',')[1] ?? '', 'base64')).toEqual(png)
  })

  it('Remote readFile forwards the optional offset window parameter', async () => {
    const ctx = new Context()
    Object.assign(ctx, { localFiles: service })
    const remote = new LocalFilesRemoteService(ctx)
    writeFileSync(join(dir, 'remote.txt'), '0123456789')
    const windowed = await remote.readFile({ path: join(dir, 'remote.txt'), offset: 4 })
    expect(windowed).toMatchObject({ kind: 'text', content: '456789' })
    // An offset-less request reads from the start, exactly as before.
    const full = await remote.readFile({ path: join(dir, 'remote.txt') })
    expect(full).toMatchObject({ kind: 'text', content: '0123456789' })
  })
})
