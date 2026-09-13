// @vitest-environment jsdom
/**
 * The clipboard → markdown-table converters. These are the only pure
 * functions the writing surface leans on for correctness, so they are tested
 * directly: spreadsheet quoting, ragged rows, the refusal to convert prose,
 * HTML table extraction (including column spans degrading to empty slots),
 * and the explicit space-aligned path.
 */
import { describe, expect, it } from 'vitest'
import {
  convertPaste, htmlTableToMarkdown, looksLikeTsv, parseDelimited,
  spaceAlignedToMarkdown, toMarkdownTable,
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

describe('spaceAlignedToMarkdown', () => {
  it('splits columns on runs of two or more spaces', () => {
    expect(spaceAlignedToMarkdown('角色   年龄\n林岚   29')).toBe(
      '| 角色 | 年龄 |\n| --- | --- |\n| 林岚 | 29 |',
    )
  })

  it('refuses text with no column structure', () => {
    expect(spaceAlignedToMarkdown('雨下了一整夜。')).toBeNull()
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
