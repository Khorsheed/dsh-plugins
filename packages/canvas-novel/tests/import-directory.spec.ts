import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pickNovelImportDirectory, readNovelImportDirectory } from '../src/import-directory.ts'
import { parseNovelBinaryDocuments } from '../src/client/import-documents.ts'

const temporary: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'novel-import-'))
  temporary.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('novel directory import', () => {
  it('recurses real nested documents in relative-path order and skips unsafe or irrelevant entries', async () => {
    const root = await fixture()
    const source = join(root, 'source')
    await mkdir(join(source, '01'), { recursive: true })
    await mkdir(join(source, '02'), { recursive: true })
    await mkdir(join(source, 'node_modules'), { recursive: true })
    await writeFile(join(source, '01', '第一章.md'), '第一章 前\n甲。')
    await writeFile(join(source, '01', '第二章.txt'), '第二章 后\n乙。')
    await writeFile(join(source, '02', '第三章.md'), '没有标题的正文。')
    await writeFile(join(source, '.hidden.txt'), '隐藏。')
    await writeFile(join(source, 'node_modules', 'ignored.md'), '依赖。')
    await writeFile(join(source, 'notes.pdf'), '不是小说。')
    await writeFile(join(root, 'outside.txt'), '目录外，不能读。')
    await symlink(join(root, 'outside.txt'), join(source, 'escape.txt'))

    const result = await readNovelImportDirectory(source)
    expect(result.ok).toBe(true)
    expect(result.rootName).toBe('source')
    expect((await parseNovelBinaryDocuments(result.files)).drafts.map(draft => [draft.file, draft.title, draft.text])).toEqual([
      ['01/第一章.md', '第一章 前', '甲。'],
      ['01/第二章.txt', '第二章 后', '乙。'],
      ['02/第三章.md', '第三章', '没有标题的正文。'],
    ])
    expect(result.issues).toEqual([])
    expect(result.skipped).toBeGreaterThanOrEqual(4)
    expect(result.truncated).toBe(false)
    expect(basename(root)).toContain('novel-import-')
  })

  it('reports Word conversion guidance without reading Word files or losing valid chapters', async () => {
    const root = await fixture()
    await writeFile(join(root, 'word.docx'), 'Word prose')
    await writeFile(join(root, 'valid.txt'), '第一章 好\n正文。')
    const result = await readNovelImportDirectory(root)
    expect(result.files.map(file => file.file)).toEqual(['valid.txt'])
    expect(result.issues).toEqual([{ file: 'word.docx', reason: 'legacy-doc' }])
    const parsed = await parseNovelBinaryDocuments(result.files)
    expect(parsed.drafts.map(draft => draft.title)).toEqual(['第一章 好'])
    expect(parsed.issues).toEqual([])
  })

  it('supports native and official browse selection, cancellation and missing capabilities', async () => {
    const root = await fixture()
    await writeFile(join(root, 'chapter.txt'), '正文。')
    const ctx = new Context()
    ctx.provide('directoryPicker' as never, { capability: () => ({ kind: 'native', pick: async () => root }) } as never)
    const picked = await pickNovelImportDirectory(ctx)
    expect((await parseNovelBinaryDocuments(picked.files)).drafts.map(draft => draft.title)).toEqual(['chapter'])

    const cancelled = new Context()
    cancelled.provide('directoryPicker' as never, { capability: () => ({ kind: 'native', pick: async () => null }) } as never)
    expect(await pickNovelImportDirectory(cancelled)).toMatchObject({ ok: false, error: 'cancelled' })

    const browse = new Context()
    const list = vi.fn(async (path: string) => ({ path }))
    browse.provide('directoryPicker' as never, { capability: () => ({ kind: 'browse', list }) } as never)
    expect(await pickNovelImportDirectory(browse)).toMatchObject({ ok: false, error: 'browse' })
    const selected = await pickNovelImportDirectory(browse, root)
    expect(selected.ok).toBe(true)
    expect(list).toHaveBeenCalledWith(root, expect.any(AbortSignal))
    expect((await parseNovelBinaryDocuments(selected.files)).drafts.map(draft => draft.title)).toEqual(['chapter'])

    const missing = new Context()
    expect(await pickNovelImportDirectory(missing)).toMatchObject({ ok: false, error: 'unsupported' })
  })

  it('marks a directory truncated at the candidate-file cap instead of silently claiming completeness', async () => {
    const root = await fixture()
    await Promise.all(Array.from({ length: 501 }, (_, index) => writeFile(join(root, `${String(index).padStart(4, '0')}.txt`), '正文。')))
    const result = await readNovelImportDirectory(root)
    expect((await parseNovelBinaryDocuments(result.files)).drafts).toHaveLength(500)
    expect(result.truncated).toBe(true)
  })
})
