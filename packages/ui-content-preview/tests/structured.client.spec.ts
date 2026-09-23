import { describe, expect, it } from 'vitest'
import { jsonTreeData, parseDelimited, toMarkdownTable } from '../src/client/structured.tsx'

describe('parseDelimited', () => {
  it('parses plain rows and drops the trailing newline', () => {
    expect(parseDelimited('a,b\n1,2\n', ',')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('handles quoted fields with commas and escaped quotes', () => {
    expect(parseDelimited('name,note\n"doe, john","said ""hi"""', ',')).toEqual([
      ['name', 'note'],
      ['doe, john', 'said "hi"'],
    ])
  })

  it('handles CRLF and drops blank lines', () => {
    expect(parseDelimited('a\tb\r\n1\t2\r\n\r\n', '\t')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('returns null for empty or blank content', () => {
    expect(parseDelimited('', ',')).toBeNull()
    expect(parseDelimited('\n\n', ',')).toBeNull()
  })
})

describe('toMarkdownTable', () => {
  it('builds a GFM table with the first row as the header', () => {
    expect(toMarkdownTable([['a', 'b'], ['1', '2']])).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
  })

  it('escapes pipes and collapses newlines inside cells', () => {
    expect(toMarkdownTable([['x|y'], ['a\nb']])).toBe('| x\\|y |\n| --- |\n| a b |')
  })
})

describe('jsonTreeData', () => {
  it('accepts objects and arrays', () => {
    expect(jsonTreeData('{"a":1}')).toEqual({ a: 1 })
    expect(jsonTreeData('[1,2]')).toEqual([1, 2])
  })

  it('rejects scalars, null, and invalid JSON', () => {
    expect(jsonTreeData('42')).toBeNull()
    expect(jsonTreeData('"str"')).toBeNull()
    expect(jsonTreeData('null')).toBeNull()
    expect(jsonTreeData('{ bad')).toBeNull()
  })
})
