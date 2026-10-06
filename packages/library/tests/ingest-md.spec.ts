/**
 * Markdown ingestion: heading-hierarchy splitting and the minimal renderer.
 */
import { describe, expect, it } from 'vitest'
import { renderMarkdownBlock, splitMarkdown } from '../src/client/ingest-md.ts'

describe('splitMarkdown', () => {
  it('splits on the level that names more than one thing', () => {
    const text = [
      '# 认知神经科学',
      '',
      '作者序。',
      '',
      '## 第一章 概论',
      '',
      '神经系统由神经元构成。',
      '',
      '## 第二章 突触',
      '',
      'Ca²⁺ 内流触发释放。',
    ].join('\n')
    const result = splitMarkdown(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.chapters.map(chapter => chapter.title)).toEqual(['第一章 概论', '第二章 突触'])
    // The title line and the preface open the first chapter rather than vanish.
    expect(result.chapters[0]?.html).toContain('作者序')
    expect(result.chapters[1]?.html).toContain('Ca²⁺')
  })

  it('splits on the top level when several share it', () => {
    const text = ['# A', '', '甲。', '# B', '', '乙。'].join('\n')
    const result = splitMarkdown(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.chapters.map(chapter => chapter.title)).toEqual(['A', 'B'])
    expect(result.chapters[0]?.html).toContain('甲。')
  })

  it('a lone heading is the chapter\'s title, not a split point of nothing', () => {
    const result = splitMarkdown('# 孤本\n\n只有一章。')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0]?.title).toBe('孤本')
    expect(result.chapters[0]?.html).toContain('只有一章。')
  })

  it('a heading-less text is one chapter', () => {
    const result = splitMarkdown('没有标题。\n\n两段。\n\n')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0]?.html).toContain('两段。')
  })

  it('an empty text is refused honestly', () => {
    expect(splitMarkdown('  \n\n')).toEqual({ ok: false, error: 'empty' })
  })
})

describe('renderMarkdownBlock', () => {
  it('renders headings, paragraphs, lists, quotes, fences and the inline marks', () => {
    const html = renderMarkdownBlock([
      '### 节标题',
      '',
      '一段有 **加粗** 和 *斜体* 和 `code` 的话。',
      '',
      '- 甲',
      '- 乙',
      '',
      '1. 一',
      '2. 二',
      '',
      '> 引文',
      '',
      '```',
      'const x = 1 < 2',
      '```',
    ])
    expect(html).toContain('<h5>节标题</h5>') // ### demoted under the reading view's own heading
    expect(html).toContain('<strong>加粗</strong>')
    expect(html).toContain('<em>斜体</em>')
    expect(html).toContain('<code>code</code>')
    // Blocks join with newlines; compare the squeezed form for structure.
    const squeezed = html.replace(/\n/g, '')
    expect(squeezed).toContain('<ul><li>甲</li><li>乙</li></ul>')
    expect(squeezed).toContain('<ol><li>一</li><li>二</li></ol>')
    expect(squeezed).toContain('<blockquote>引文</blockquote>')
    // The fence escapes markup.
    expect(html).toContain('const x = 1 &lt; 2')
  })
})
