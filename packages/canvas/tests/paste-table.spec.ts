// @vitest-environment jsdom
/**
 * The clipboard → markdown-table converters. These are the only pure
 * functions the writing surface leans on for correctness, so they are tested
 * directly: spreadsheet quoting, ragged rows, the refusal to convert prose,
 * and HTML table extraction (including column spans degrading to empty slots).
 * The paste arm sits on top of those and is tested the same way: which of the
 * five arms a clipboard reads as, against the card text the paste would produce.
 */
import { describe, expect, it } from 'vitest'
import {
  choosePaste, convertPaste, htmlTableToMarkdown, looksLikeTsv, parseDelimited,
  toMarkdownTable,
} from '../src/client/paste-table.ts'

describe('parseDelimited', () => {
  it('splits tabs and newlines and drops the trailing blank row', () => {
    expect(parseDelimited('a\tb\n1\t2\n', '\t')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('keeps empty cells — a gap in the middle is a real column', () => {
    expect(parseDelimited('a\t\tc\n', '\t')).toEqual([['a', '', 'c']])
  })

  it('honours quoting: the delimiter and newline inside quotes stay in the cell', () => {
    expect(parseDelimited('"a\tb"\t"c\nd"\n', '\t')).toEqual([['a\tb', 'c\nd']])
  })

  it('unescapes a doubled quote', () => {
    expect(parseDelimited('"say ""hi"""\n', '\t')).toEqual([['say "hi"']])
  })

  it('treats CRLF and LF identically', () => {
    expect(parseDelimited('a\tb\r\n1\t2\r\n', '\t')).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('toMarkdownTable', () => {
  it('treats the first row as the header and pads ragged rows', () => {
    expect(toMarkdownTable([['a', 'b', 'c'], ['1', '2']])).toBe(
      '| a | b | c |\n| --- | --- | --- |\n| 1 | 2 |  |',
    )
  })

  it('escapes a literal pipe and flattens an embedded newline', () => {
    expect(toMarkdownTable([['a|b'], ['x\ny']])).toBe(
      '| a\\|b |\n| --- |\n| x<br>y |',
    )
  })
})

describe('looksLikeTsv', () => {
  it('accepts a rectangular two-column block', () => {
    expect(looksLikeTsv('a\tb\n1\t2')).toBe(true)
  })

  it('tolerates exactly one ragged row', () => {
    expect(looksLikeTsv('a\tb\n1\t2\n3')).toBe(true)
  })

  it('refuses prose', () => {
    expect(looksLikeTsv('雨下了一整夜。\n屋檐上的水声像有人在数数。')).toBe(false)
  })

  it('refuses a single line — one row is not a table', () => {
    expect(looksLikeTsv('a\tb')).toBe(false)
  })

  it('refuses a single-column block', () => {
    expect(looksLikeTsv('a\nb\nc')).toBe(false)
  })

  it('refuses a block where more than one row disagrees on width', () => {
    expect(looksLikeTsv('a\tb\n1\n2\n3\t4')).toBe(false)
  })
})

describe('htmlTableToMarkdown', () => {
  it('extracts the first table and ignores the rest of the document', () => {
    const html = '<div><p>junk</p><table><tr><th>角色</th><th>年龄</th></tr>'
      + '<tr><td>林岚</td><td>29</td></tr></table><p>trailing</p></div>'
    expect(htmlTableToMarkdown(html)).toBe('| 角色 | 年龄 |\n| --- | --- |\n| 林岚 | 29 |')
  })

  it('degrades a column span to its text plus empty slots', () => {
    const html = '<table><tr><th>a</th><th>b</th></tr>'
      + '<tr><td colspan="2">wide</td></tr></table>'
    expect(htmlTableToMarkdown(html)).toBe('| a | b |\n| --- | --- |\n| wide |  |')
  })

  it('returns null without a table', () => {
    expect(htmlTableToMarkdown('<p>no table here</p>')).toBeNull()
    expect(htmlTableToMarkdown('')).toBeNull()
  })

  it('returns null for a table that cannot make a table (one row)', () => {
    expect(htmlTableToMarkdown('<table><tr><td>only</td><td>row</td></tr></table>')).toBeNull()
  })
})

describe('convertPaste', () => {
  it('prefers the HTML table over the plain-text flavour', () => {
    const html = '<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>'
    expect(convertPaste(html, 'a\tb\n1\t2')).toEqual({
      markdown: '| a | b |\n| --- | --- |\n| 1 | 2 |',
      source: 'html-table',
    })
  })

  it('falls back to TSV when the clipboard carries no HTML', () => {
    expect(convertPaste('', 'a\tb\n1\t2')).toEqual({
      markdown: '| a | b |\n| --- | --- |\n| 1 | 2 |',
      source: 'tsv',
    })
  })

  it('declines anything that is not unambiguously a table', () => {
    expect(convertPaste('', '雨下了一整夜。')).toBeNull()
    expect(convertPaste('<p>html but no table</p>', 'plain prose')).toBeNull()
  })
})

describe('choosePaste', () => {
  /** The card text a candidate would produce, appended to what the card holds. */
  const held = (text: string) => (candidate: string): string => `${text}${candidate}`
  const page = '<!doctype html><html><head><title>雨</title></head><body><p>一整页的正文</p></body></html>'
  const sheet = '<html><body><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table></body></html>'
  const grid = '<table><tr><th>名称</th><th>数量</th></tr><tr><td>伞</td><td>2</td></tr></table>'

  it('takes a page as a page while the card it produces is still one page', () => {
    expect(choosePaste(page, '雨\n\n一整页的正文', held(''))).toEqual({ arm: 'page', text: page })
  })

  it('keeps the words of a page that would land in a card holding prose', () => {
    expect(choosePaste(page, '雨\n\n一整页的正文', held('我已经在写这段话。\n')))
      .toEqual({ arm: 'words', text: '雨\n\n一整页的正文' })
  })

  it('converts a spreadsheet even into an empty card: the grid beats the soup', () => {
    expect(choosePaste(sheet, 'a\tb\n1\t2', held(''))).toEqual({
      arm: 'table',
      text: '| a | b |\n| --- | --- |\n| 1 | 2 |',
    })
  })

  it('keeps a table inside a real page, because the page is the content', () => {
    const html = `<!doctype html><html><body><p>产品说明</p>${grid}</body></html>`
    expect(choosePaste(html, '产品说明\n\n名称\t数量', held('')).arm).toBe('page')
  })

  it('takes the grid out of markup that the card cannot render as a page', () => {
    expect(choosePaste(`<!doctype html><html><body>${grid}</body></html>`, '名称 数量\n伞 2', held('正文。\n')))
      .toEqual({ arm: 'table', text: '| 名称 | 数量 |\n| --- | --- |\n| 伞 | 2 |' })
  })

  it('says nothing about rich text that was never a page', () => {
    expect(choosePaste('<b>粗</b>的话', '粗的话', held(''))).toEqual({ arm: 'plain', text: '粗的话' })
  })

  it('inserts markup as it came when the clipboard carried no text at all', () => {
    expect(choosePaste('<b>粗</b>', '   ', held(''))).toEqual({ arm: 'markup', text: '<b>粗</b>' })
  })
})
