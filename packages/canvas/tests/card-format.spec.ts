/**
 * The card format heuristic: whole HTML documents and whole-fragment markup
 * render in the sandbox; anything plausibly markdown (including markdown
 * with inline HTML, and prose wrapped in a single inline tag) stays
 * markdown. The title extractor pulls `<title>` with entities decoded.
 */
import { describe, expect, it } from 'vitest'
import { detectCardFormat, htmlTitleOf, MAX_HTML_TITLE_LENGTH } from '../src/card-format.ts'

describe('detectCardFormat', () => {
  it('detects a whole document by its doctype or html/head/body opener', () => {
    expect(detectCardFormat('<!DOCTYPE html>\n<html><head><title>x</title></head><body>y</body></html>')).toBe('html')
    expect(detectCardFormat('  <html lang="zh"><body>y</body></html>')).toBe('html')
    expect(detectCardFormat('<body><p>y</p></body>')).toBe('html')
    expect(detectCardFormat('<head><title>x</title></head><body>y</body>')).toBe('html')
  })

  it('detects a whole-fragment: wrapped in tags, ≥2 tag pairs, no markdown structure', () => {
    expect(detectCardFormat('<div><p>甲</p><p>乙</p></div>')).toBe('html')
    expect(detectCardFormat('<section><h1>标题</h1><div><p>正文</p></div></section>')).toBe('html')
    expect(detectCardFormat('<table><tr><td>1</td></tr><tr><td>2</td></tr></table>')).toBe('html')
  })

  it('keeps markdown with a markdown block marker, whatever tags it holds', () => {
    expect(detectCardFormat('# 标题\n\n<div><p>甲</p><p>乙</p></div>')).toBe('markdown')
    expect(detectCardFormat('- 列表\n<div><p>甲</p><p>乙</p></div>')).toBe('markdown')
    expect(detectCardFormat('> 引用\n<div><p>甲</p><p>乙</p></div>')).toBe('markdown')
  })

  it('keeps prose with inline HTML (a single inline tag is not a document)', () => {
    expect(detectCardFormat('用 <code>npm install</code> 安装后再 <strong>重启</strong>')).toBe('markdown')
    expect(detectCardFormat('一段 <em>强调</em> 的文字')).toBe('markdown')
  })

  it('keeps plain markdown and plain text', () => {
    expect(detectCardFormat('沉默并不总是因为恐惧')).toBe('markdown')
    expect(detectCardFormat('# 沉默的两种成因\n\n正文。**重点**')).toBe('markdown')
    expect(detectCardFormat('')).toBe('markdown')
  })

  it('keeps an unmatched single tag pair (one pair is not a fragment document)', () => {
    expect(detectCardFormat('<div>只有一对</div>')).toBe('markdown')
  })
})

describe('htmlTitleOf', () => {
  it('extracts the title with entities decoded', () => {
    expect(htmlTitleOf('<html><head><title>大模型心理学 &amp; 综述</title></head></html>'))
      .toBe('大模型心理学 & 综述')
    expect(htmlTitleOf('<head><title>Tom &lt;Jerry&gt; &#39;26</title></head>')).toBe("Tom <Jerry> '26")
  })

  it('collapses whitespace and caps the length', () => {
    expect(htmlTitleOf(`<title>  多\n 行   标题 </title>`)).toBe('多 行 标题')
    expect(htmlTitleOf(`<title>${'长'.repeat(100)}</title>`)).toHaveLength(MAX_HTML_TITLE_LENGTH)
  })

  it('reads undefined when there is no title or an empty one', () => {
    expect(htmlTitleOf('<html><body>无标题</body></html>')).toBeUndefined()
    expect(htmlTitleOf('<title>   </title>')).toBeUndefined()
    expect(htmlTitleOf('纯文本')).toBeUndefined()
  })
})
