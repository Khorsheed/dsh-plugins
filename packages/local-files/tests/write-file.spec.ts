/**
 * Save-path tests for the local-files service: an edit lands atomically with
 * the file's mode kept, a file that changed since the edit began answers
 * `conflict` (and `base: null` overwrites it), and a file a text edit cannot
 * round-trip — not UTF-8, an image, gone — is never written.
 */
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalFilesService } from '../src/service.ts'

describe('LocalFilesService.writeFile', () => {
  const service = new LocalFilesService()
  let dir: string

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'local-files-write-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('writes the new text when the file still holds the base, keeping its mode and leaving no temp file', async () => {
    const file = join(dir, 'notes.md')
    writeFileSync(file, '# old\n')
    chmodSync(file, 0o640)
    expect(await service.writeFile(file, '# new\n', '# old\n')).toEqual({ ok: true })
    expect(readFileSync(file, 'utf8')).toBe('# new\n')
    expect(statSync(file).mode & 0o777).toBe(0o640)
    expect(readdirSync(dir)).toEqual(['notes.md'])
  })

  it('answers conflict when the file changed since the edit began, and overwrites with a null base', async () => {
    const file = join(dir, 'notes.md')
    writeFileSync(file, 'model wrote this\n')
    expect(await service.writeFile(file, 'mine\n', 'what I opened\n')).toEqual({ ok: false, reason: 'conflict' })
    expect(readFileSync(file, 'utf8')).toBe('model wrote this\n')
    expect(await service.writeFile(file, 'mine\n', null)).toEqual({ ok: true })
    expect(readFileSync(file, 'utf8')).toBe('mine\n')
  })

  it('writes through a symlink to its target and keeps the link', async () => {
    const target = join(dir, 'real.txt')
    const link = join(dir, 'link.txt')
    writeFileSync(target, 'a')
    symlinkSync(target, link)
    expect(await service.writeFile(link, 'b', 'a')).toEqual({ ok: true })
    expect(readFileSync(target, 'utf8')).toBe('b')
    expect(statSync(link).isFile()).toBe(true)
  })

  it('refuses files a text edit cannot round-trip, and missing files', async () => {
    const latin1 = join(dir, 'latin1.txt')
    writeFileSync(latin1, Buffer.from([0x63, 0x61, 0x66, 0xe9]))
    expect(await service.writeFile(latin1, 'cafe', null)).toEqual({ ok: false, reason: 'unsupported' })
    expect(readFileSync(latin1)).toEqual(Buffer.from([0x63, 0x61, 0x66, 0xe9]))

    const svg = join(dir, 'icon.svg')
    writeFileSync(svg, '<svg/>')
    expect(await service.writeFile(svg, '<svg></svg>', '<svg/>')).toEqual({ ok: false, reason: 'unsupported' })

    expect(await service.writeFile(join(dir, 'gone.md'), 'x', null)).toEqual({ ok: false, reason: 'missing' })
    expect(await service.writeFile(dir, 'x', null)).toEqual({ ok: false, reason: 'missing' })
  })

  it('rejects relative and traversing paths like every other verb', async () => {
    await expect(service.writeFile('notes.md', 'x', null)).rejects.toThrow(/invalid local path/)
    await expect(service.writeFile(`${dir}/../x`, 'x', null)).rejects.toThrow(/invalid local path/)
  })
})
