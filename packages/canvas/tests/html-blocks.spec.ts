/**
 * Whole HTML blocks inside markdown: a line opening with a block tag that
 * closes further on becomes one block; inline HTML, fenced tags and unclosed
 * tags stay markdown, and a text with no block comes back untouched.
 */
import { describe, expect, it } from 'vitest'
import { splitHtmlBlocks, withHtmlBlocksMarked } from '../src/html-blocks.ts'

const DIAGRAM = '<div style="border:1px solid #e2e5ea"> <div style="color:#8a94a3">同一个问题</div> <div>行为层<br><span>它做了什么</span></div> </div>'

describe('splitHtmlBlocks', () => {
  it('returns the very text as one markdown run when there is no block', () => {
    const text = '# 引言\n\n正文里有 <span>行内</span> 标签。'
    expect(splitHtmlBlocks(text)).toEqual([{ kind: 'markdown', text }])
  })

  it('takes a nested div block between paragraphs', () => {
    const segments = splitHtmlBlocks(`先声明边界。\n\n${DIAGRAM}\n\n下一段。`)
    expect(segments.map(segment => segment.kind)).toEqual(['markdown', 'html', 'markdown'])
    expect(segments[1]).toEqual({ kind: 'html', html: DIAGRAM })
    expect(segments[2]).toEqual({ kind: 'markdown', text: '\n下一段。' })
  })

  it('follows a block across lines and blank lines until its tag closes', () => {
    const block = '<figure>\n  <div>甲</div>\n\n  <figcaption>图：自绘</figcaption>\n</figure>'
    expect(splitHtmlBlocks(`${block}\n结尾`)).toEqual([
      { kind: 'html', html: block },
      { kind: 'markdown', text: '结尾' },
    ])
  })

  it('counts a self-closing svg as closed', () => {
    expect(splitHtmlBlocks('<svg viewBox="0 0 1 1"/>')).toEqual([{ kind: 'html', html: '<svg viewBox="0 0 1 1"/>' }])
  })

  it('leaves an unclosed tag as markdown, swallowing nothing', () => {
    const text = '<div class="x">\n\n后面的文字'
    expect(splitHtmlBlocks(text)).toEqual([{ kind: 'markdown', text }])
  })

  it('leaves tags inside a code fence alone', () => {
    const text = '```html\n<div>源码</div>\n```\n'
    expect(splitHtmlBlocks(text)).toEqual([{ kind: 'markdown', text }])
  })

  it('leaves an indented (code) line and a mid-line tag alone', () => {
    const text = '    <div>缩进代码</div>\n文字 <div>行中</div>'
    expect(splitHtmlBlocks(text)).toEqual([{ kind: 'markdown', text }])
  })
})

describe('withHtmlBlocksMarked', () => {
  it('replaces each block with the mark', () => {
    expect(withHtmlBlocksMarked(`开头\n${DIAGRAM}\n结尾`, '[图示]')).toBe('开头\n[图示]\n结尾')
  })

  it('returns a text with no block unchanged', () => {
    expect(withHtmlBlocksMarked('只有文字', '[图示]')).toBe('只有文字')
  })
})
