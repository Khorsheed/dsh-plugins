/**
 * Integration tests for the local-files service against a real temporary
 * directory: listing (dirs first then files, canonical path), traversal
 * rejection, text/binary file reads, and image reads.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertSafeLocalPath, LocalFilesService, UnsafeLocalPathError,
} from '../src/service.ts'

describe('assertSafeLocalPath', () => {
  it('accepts plain absolute paths and normalizes separators', () => {
    expect(assertSafeLocalPath('/users/me/docs')).toBe('/users/me/docs')
    expect(assertSafeLocalPath('/users/./me')).toBe('/users/me')
  })

  it('rejects empty, relative, and traversal paths', () => {
    expect(() => assertSafeLocalPath('')).toThrow(UnsafeLocalPathError)
    expect(() => assertSafeLocalPath('relative/path')).toThrow(UnsafeLocalPathError)
    expect(() => assertSafeLocalPath('/users/../etc')).toThrow(UnsafeLocalPathError)
    expect(() => assertSafeLocalPath('/users/me/../../etc')).toThrow(UnsafeLocalPathError)
  })
})

describe('LocalFilesService', () => {
  const service = new LocalFilesService()
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-local-files-'))
    writeFileSync(join(dir, 'b.txt'), 'two\n', 'utf8')
    writeFileSync(join(dir, 'a.md'), '# one\n', 'utf8')
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'nested.txt'), 'nested\n', 'utf8')
    writeFileSync(join(dir, 'binary.bin'), Buffer.from([0, 1, 2, 3, 255, 254, 253]))
    // A minimal 1x1 PNG.
    writeFileSync(join(dir, 'pic.png'), Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('lists a local directory with directories first, then files', async () => {
    const listing = await service.listLocalDirectory(dir)
    // realpath canonicalizes (macOS /var → /private/var), so compare canonical.
    expect(listing.path).toBe(await realpath(dir))
    expect(listing.parent).toBe(dirname(await realpath(dir)))
    expect(listing.entries.map(entry => entry.name)).toEqual(['sub', 'a.md', 'b.txt', 'binary.bin', 'pic.png'])
    const sub = listing.entries.find(entry => entry.name === 'sub')
    expect(sub?.isDir).toBe(true)
    const file = listing.entries.find(entry => entry.name === 'a.md')
    expect(file?.isDir).toBe(false)
    expect(file?.size).toBe(6)
  })

  it('rejects traversal and non-absolute local paths', async () => {
    await expect(service.listLocalDirectory('../escape')).rejects.toThrow()
    await expect(service.listLocalDirectory('relative/path')).rejects.toThrow()
    await expect(service.listLocalDirectory(join(dir, 'missing'))).rejects.toThrow()
  })

  it('reads a local file as text', async () => {
    const result = await service.readFile(join(dir, 'a.md'))
    expect(result.kind).toBe('text')
    expect(result.content).toBe('# one\n')
    expect(result.size).toBe(6)
  })

  it('flags binary local files as non-text', async () => {
    const result = await service.readFile(join(dir, 'binary.bin'))
    expect(result.kind).toBe('binary')
    expect(result.size).toBe(7)
  })

  it('reports a missing path as missing (not a directory)', async () => {
    expect((await service.readFile(join(dir, 'missing'))).kind).toBe('missing')
  })

  it('reads a local image as a base64 data URL', async () => {
    const result = await service.readFile(join(dir, 'pic.png'))
    expect(result.kind).toBe('image')
    expect(result.url?.startsWith('data:image/png;base64,')).toBe(true)
    // Decoded bytes round-trip to the same PNG magic header.
    const decoded = Buffer.from((result.url ?? '').split(',')[1] ?? '', 'base64')
    expect([...decoded.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })
})

describe('LocalFilesService filename search', () => {
  const service = new LocalFilesService()
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-local-files-search-'))
    writeFileSync(join(dir, 'notes.md'), 'root hit\n', 'utf8')
    mkdirSync(join(dir, 'docs', 'guide'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'guide', 'NOTES.txt'), 'nested hit\n', 'utf8')
    writeFileSync(join(dir, 'docs', 'other.txt'), 'no\n', 'utf8')
    writeFileSync(join(dir, '.hidden-notes'), 'hidden\n', 'utf8')
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'pkg', 'notes.js'), 'dep\n', 'utf8')
    mkdirSync(join(dir, '.git'))
    writeFileSync(join(dir, '.git', 'notes-ref'), 'vcs\n', 'utf8')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('matches files and directories by case-insensitive substring, root-relative', async () => {
    const result = await service.searchLocalDirectory(dir, 'notes')
    const paths = result.entries.map(entry => entry.path).sort()
    expect(paths).toEqual(['docs/guide/NOTES.txt', 'notes.md'])
    expect(result.truncated).toBe(false)
  })

  it('matches the root-relative path: a folder-name hit lists its contents', async () => {
    // The web-eval scenario: searching a folder's name must surface the files
    // INSIDE it, not just the folder row itself.
    const result = await service.searchLocalDirectory(dir, 'guide')
    const byPath = new Map(result.entries.map(entry => [entry.path, entry]))
    // The folder is the NAME hit; its contents matched only through the path.
    expect(byPath.get('docs/guide')).toMatchObject({ isDir: true, nameMatch: true })
    expect(byPath.get('docs/guide/NOTES.txt')).toMatchObject({ isDir: false, nameMatch: false })
    // A sibling outside the matched folder stays out.
    expect(byPath.has('docs/other.txt')).toBe(false)
  })

  it('excludes hidden entries by default and includes them on request', async () => {
    const hidden = await service.searchLocalDirectory(dir, 'hidden-notes')
    expect(hidden.entries).toEqual([])
    const shown = await service.searchLocalDirectory(dir, 'hidden-notes', true)
    expect(shown.entries).toEqual([{ path: '.hidden-notes', isDir: false, nameMatch: true }])
  })

  it('never descends into node_modules or .git, even with hidden entries on', async () => {
    const result = await service.searchLocalDirectory(dir, 'notes', true)
    const paths = result.entries.map(entry => entry.path)
    expect(paths.some(path => path.includes('node_modules') || path.includes('.git'))).toBe(false)
  })

  it('answers an empty query with no hits and no walk', async () => {
    const result = await service.searchLocalDirectory(dir, '  ')
    expect(result.entries).toEqual([])
    expect(result.truncated).toBe(false)
  })

  it('rejects traversal and missing roots', async () => {
    await expect(service.searchLocalDirectory('../escape', 'x')).rejects.toThrow()
    await expect(service.searchLocalDirectory(join(dir, 'missing'), 'x')).rejects.toThrow()
  })
})
