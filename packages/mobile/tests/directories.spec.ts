import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { directoryResponse, listMobileDirectory } from '../src/directories.ts'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
it('lists only directory children, including enterable links and hidden directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mobile-dir-')); roots.push(root)
  await mkdir(join(root, 'project')); await mkdir(join(root, '.hidden')); await writeFile(join(root, 'file.txt'), 'private file contents')
  await symlink(join(root, 'project'), join(root, 'alias')); await symlink(join(root, 'missing'), join(root, 'broken'))
  const result = await listMobileDirectory(root, new AbortController().signal)
  expect(result.entries.map(e => e.name).sort()).toEqual(['.hidden', 'alias', 'project'])
  expect(result.entries.find(e => e.name === '.hidden')?.hidden).toBe(true)
  expect(result.truncated).toBe(false)
  expect((await listMobileDirectory(join(root, 'alias'), new AbortController().signal)).entries).toEqual([])
})
it('refuses relative/invalid paths, files, missing directories and cancelled reads without leaking OS errors', async () => {
  for (const path of ['', 'relative', 'bad\0path']) await expect(listMobileDirectory(path, new AbortController().signal)).rejects.toThrow('invalid-path')
  const abort = new AbortController(); abort.abort(); await expect(listMobileDirectory(undefined, abort.signal)).rejects.toThrow()
  const response = await directoryResponse(new Request('http://localhost/api/mobile/directories?path=relative'))
  expect(response.status).toBe(400); expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({ error: 'invalid-path' })
  const root = await mkdtemp(join(tmpdir(), 'mobile-dir-')); roots.push(root); await writeFile(join(root, 'file'), 'content')
  for (const path of [join(root, 'file'), join(root, 'absent')]) {
    const answer = await directoryResponse(new Request(`http://localhost/api/mobile/directories?path=${encodeURIComponent(path)}`))
    expect(answer.status).toBe(422); expect(await answer.json()).toEqual({ error: 'directory-unavailable' })
  }
})
