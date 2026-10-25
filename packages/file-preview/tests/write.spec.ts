/**
 * The save core over a fake fs face: the content check against `base`, the
 * version-guarded write (a stale version is a conflict too), the BOM the read
 * decoder strips coming back on save, and the files a text edit must not touch.
 */
import { describe, expect, it, vi } from 'vitest'
import { writeFilePreview, type FilePreviewWriteFs } from '../src/write.ts'

/** One in-memory file behind the fs members the save consumes. */
function fakeFs(bytes: Uint8Array | null, opts: { stale?: boolean } = {}) {
  const writeText = vi.fn(async () => {
    if (opts.stale === true) throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' })
    return { operation: 'update' as const, version: 'v2', before: null, after: '' }
  })
  const fs = {
    resolve: vi.fn(async (path: string) => ({ targetKey: path, displayPath: path })),
    stat: vi.fn(async () => (bytes === null ? undefined : { version: 'v1', type: 'file' as const, size: bytes.byteLength })),
    readBytes: vi.fn(async () => bytes ?? new Uint8Array()),
    writeText,
  } as unknown as FilePreviewWriteFs
  return { fs, writeText }
}

const core = (fs: FilePreviewWriteFs) => ({ fs, cwd: '/w', maxReadBytes: 1024, htmlMaxReadBytes: 4096 })
const utf8 = (text: string) => new TextEncoder().encode(text)

describe('writeFilePreview', () => {
  it('writes when the file still holds the base, guarded by the version it read', async () => {
    const { fs, writeText } = fakeFs(utf8('old'))
    expect(await writeFilePreview(core(fs), 'a.md', 'new', 'old')).toEqual({ ok: true })
    expect(writeText).toHaveBeenCalledWith(expect.anything(), 'new', { kind: 'replaceIfVersion', version: 'v1' }, undefined)
  })

  it('answers conflict on a changed file and on a stale version, and overwrites with a null base', async () => {
    const changed = fakeFs(utf8('agent wrote'))
    expect(await writeFilePreview(core(changed.fs), 'a.md', 'mine', 'old')).toEqual({ ok: false, reason: 'conflict' })
    expect(changed.writeText).not.toHaveBeenCalled()
    expect(await writeFilePreview(core(changed.fs), 'a.md', 'mine', null)).toEqual({ ok: true })
    const raced = fakeFs(utf8('old'), { stale: true })
    expect(await writeFilePreview(core(raced.fs), 'a.md', 'mine', 'old')).toEqual({ ok: false, reason: 'conflict' })
  })

  it('keeps a UTF-8 BOM the read decoder stripped', async () => {
    const { fs, writeText } = fakeFs(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('old')]))
    expect(await writeFilePreview(core(fs), 'a.txt', 'new', 'old')).toEqual({ ok: true })
    expect(writeText).toHaveBeenCalledWith(expect.anything(), '﻿new', expect.anything(), undefined)
  })

  it('refuses images, binaries, non-UTF-8, oversized, and missing files', async () => {
    const { fs, writeText } = fakeFs(utf8('x'))
    expect(await writeFilePreview(core(fs), 'a.png', 'x', null)).toEqual({ ok: false, reason: 'unsupported' })
    expect(await writeFilePreview(core(fs), 'a.zip', 'x', null)).toEqual({ ok: false, reason: 'unsupported' })
    expect(await writeFilePreview(core(fs), 'a.md', 'x'.repeat(2048), null)).toEqual({ ok: false, reason: 'unsupported' })
    const latin1 = fakeFs(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))
    expect(await writeFilePreview(core(latin1.fs), 'a.txt', 'cafe', null)).toEqual({ ok: false, reason: 'unsupported' })
    const gone = fakeFs(null)
    expect(await writeFilePreview(core(gone.fs), 'a.md', 'x', null)).toEqual({ ok: false, reason: 'missing' })
    expect(writeText).not.toHaveBeenCalled()
    expect(latin1.writeText).not.toHaveBeenCalled()
  })
})
