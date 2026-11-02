import { describe, expect, it } from 'vitest'
import { MAX_IMPORT_CHAPTER_CHARS, parseNovelFiles, splitNovelDocument } from '../src/client/import-documents.ts'

function textFile(name: string, text: string): File {
  return new File([text], name)
}

describe('novel document parsing', () => {
  it('splits Chinese chapter headings without changing the prose', async () => {
    const parsed = await parseNovelFiles([textFile('梦境.txt', '书名：梦境\n第一章 门\n他推开门。\n第二章 叶\n叶子亮了。')])
    expect(parsed.issues).toEqual([])
    expect(parsed.drafts.map(draft => ({ title: draft.title, text: draft.text }))).toEqual([
      { title: '第一章 门', text: '书名：梦境\n他推开门。' },
      { title: '第二章 叶', text: '叶子亮了。' },
    ])
  })

  it('sorts multiple files naturally and keeps each file whole when no heading exists', async () => {
    const parsed = await parseNovelFiles([
      textFile('10.txt', '第十份没有标题的正文'),
      textFile('2.md', '第二份没有标题的正文'),
      textFile('1.txt', '第一份没有标题的正文'),
    ])
    expect(parsed.drafts.map(draft => [draft.file, draft.title, draft.noHeadings])).toEqual([
      ['1.txt', '1', true], ['2.md', '2', true], ['10.txt', '10', true],
    ])
  })

  it('recognizes English, special and Markdown headings but not a chapter mention in prose', () => {
    const split = splitNovelDocument('book.txt', 'Chapter 1: Arrival\n甲。\n正文提到第二章，不在这里拆。\n第二章 返回\n乙。\n番外一 后来\n丙。')
    expect(split.chapters.map(chapter => chapter.title)).toEqual(['Chapter 1: Arrival', '第二章 返回', '番外一 后来'])
    expect(split.chapters[0]!.text).toBe('甲。\n正文提到第二章，不在这里拆。')
    const markdown = splitNovelDocument('book.md', '# 开篇\n甲。\n# 第二夜\n乙。')
    expect(markdown.chapters.map(chapter => chapter.title)).toEqual(['开篇', '第二夜'])
  })

  it('keeps front matter with the first chapter and skips empty chapter shells', () => {
    const split = splitNovelDocument('book.txt', '\uFEFF书名\r\n作者\r\n第一章 开始\r\n正文\r\n第二章 空章\r\n第三章 结束\r\n尾声。')
    expect(split.chapters).toEqual([
      { title: '第一章 开始', text: '书名\n作者\n正文' },
      { title: '第三章 结束', text: '尾声。' },
    ])
    expect(split.issues).toEqual([{ file: 'book.txt', reason: 'empty-chapter', title: '第二章 空章' }])
  })

  it('decodes a legacy Chinese plain-text file', async () => {
    const bytes = new Uint8Array([0xd5, 0xfd, 0xce, 0xc4])
    const parsed = await parseNovelFiles([new File([bytes], 'gbk.txt')])
    expect(parsed.drafts[0]?.text).toBe('正文')
  })

  it('reports Word, unsupported, empty and oversized inputs without producing invalid drafts', async () => {
    const parsed = await parseNovelFiles([
      textFile('old.doc', ' legacy '),
      textFile('book.pdf', 'pdf'),
      textFile('word.docx', 'Word prose'),
      textFile('empty.txt', ' \n '),
      textFile('huge.txt', '甲'.repeat(MAX_IMPORT_CHAPTER_CHARS + 1)),
    ])
    expect(parsed.drafts).toEqual([])
    expect(parsed.issues).toHaveLength(5)
    expect(parsed.issues.map(issue => issue.reason)).toEqual(expect.arrayContaining(['empty', 'too-long', 'legacy-doc', 'unsupported']))
    expect(parsed.issues.filter(issue => issue.reason === 'legacy-doc').map(issue => issue.file)).toEqual(['old.doc', 'word.docx'])
  })
})
