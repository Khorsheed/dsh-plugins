// @vitest-environment jsdom
/**
 * The transcript half: the quote-block UserTextRule (both locales'
 * attributions, line-start anchoring, the `from` contract, nearest-candidate
 * resolution, non-attribution blockquotes left alone) and the keyed
 * renderer's card (wire prefixes stripped, the source row re-localized).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { zh } from '../src/client/locales.ts'
import { QuoteTextNode, type QuoteTextNodeProps } from '../src/client/QuoteTextNode.tsx'
import { quoteTextRule } from '../src/client/usertext.ts'

afterEach(cleanup)

/** A plain translate over the zh dictionary. */
const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as QuoteTextNodeProps['t']

/** Run the rule's match at `from` over `text` (the registry's context is unused by this rule). */
function match(text: string, from = 0) {
  return quoteTextRule.match(text, from, undefined as never)
}

describe('quoteTextRule', () => {
  it('matches a zh block and parses the label', () => {
    const text = '> 况开场，从展开 Thinking 的日常体验切入。\n> —— 引用自「大模型心理学文章初稿组织」'
    expect(match(text)).toEqual({
      id: 'quote-block',
      start: 0,
      end: text.length,
      data: { label: '大模型心理学文章初稿组织', text },
    })
  })

  it('matches an en block (a message quoted under another locale keeps its card)', () => {
    const text = '> hello world\n> — quoted from “Notes”'
    const node = match(text)
    expect(node?.id).toBe('quote-block')
    expect(node?.data).toEqual({ label: 'Notes', text })
  })

  it('keeps interior quoted blank lines inside the block', () => {
    const text = '> 上\n> \n> 下\n> —— 引用自「A」'
    expect(match(text)?.end).toBe(text.length)
  })

  it('matches a block that starts exactly at `from` (line-start lookbehind, mid-text)', () => {
    const text = '先打好的字\n> 引用\n> —— 引用自「A」'
    const start = text.indexOf('>')
    const node = match(text, start)
    expect(node?.start).toBe(start)
    expect(node?.end).toBe(text.length)
  })

  it('answers the NEAREST candidate at or after from', () => {
    const text = '> 第一块\n> —— 引用自「A」\n间隔\n> 第二块\n> —— 引用自「B」'
    const second = text.indexOf('> 第二块')
    const node = match(text, second)
    expect(node?.data.label).toBe('B')
  })

  it('parses a located attribution into label + locator (both locales)', () => {
    const zhBlock = '> 正文\n> —— 引用自「README.md」（/home/user/repo/README.md）'
    expect(match(zhBlock)?.data).toEqual({ label: 'README.md', ref: '/home/user/repo/README.md', text: zhBlock })
    const enBlock = '> body\n> — quoted from “README.md” (/home/user/repo/README.md)'
    expect(match(enBlock)?.data).toEqual({ label: 'README.md', ref: '/home/user/repo/README.md', text: enBlock })
  })

  it('matches a bare (sourceless) quote with no label', () => {
    const text = '> 对话里的一句\n> —— 引用'
    expect(match(text)).toEqual({ id: 'quote-block', start: 0, end: text.length, data: { text } })
  })

  it('leaves a blockquote without the attribution line, and a mid-line >, alone', () => {
    expect(match('> 只是 markdown 引用\n> 没有署名')).toBeUndefined()
    expect(match('他说 > —— 引用自「A」 不算')).toBeUndefined()
    expect(match('')).toBeUndefined()
  })

  it('does not consume the trailing newline (the following text node keeps it)', () => {
    const text = '> 引用\n> —— 引用自「A」\n后文'
    const node = match(text)
    expect(node?.end).toBe(text.indexOf('\n后文'))
  })
})

describe('QuoteTextNode (the transcript card)', () => {
  function card(block: string, label: string | null = '主会话', ref?: string) {
    const props = {
      node: { id: 'quote-block', start: 0, end: block.length, data: { ...label === null ? {} : { label }, ...ref === undefined ? {} : { ref }, text: block } },
      raw: block,
      interactive: false,
      t,
    } as unknown as QuoteTextNodeProps
    render(<QuoteTextNode {...props} />)
  }

  it('renders the body without wire prefixes and the source row from the label', () => {
    card('> 第一行\n> 第二行\n> —— 引用自「主会话」')
    const body = document.querySelector('span[class*="body"]')
    expect(body?.textContent).toBe('第一行\n第二行')
    expect(screen.getByText(zh['card.source'].replace('{label}', '主会话'))).toBeTruthy()
  })

  it('a bare quote renders the body alone; a located one keeps its locator on hover', () => {
    card('> 对话里的一句\n> —— 引用', null)
    expect(document.querySelector('span[class*="body"]')?.textContent).toBe('对话里的一句')
    expect(document.querySelector('span[class*="source"]')).toBeNull()
    cleanup()
    card('> 正文\n> —— 引用自「README.md」（/home/user/r/README.md）', 'README.md', '/home/user/r/README.md')
    expect(screen.getByText(zh['card.source'].replace('{label}', 'README.md')).getAttribute('title')).toBe('/home/user/r/README.md')
  })

  it('keeps an interior quoted blank line as an empty line', () => {
    card('> 上\n> \n> 下\n> —— 引用自「A」', 'A')
    expect(document.querySelector('span[class*="body"]')?.textContent).toBe('上\n\n下')
  })

  it('renders the source row in the CURRENT locale for an en wire block', () => {
    card('> hello\n> — quoted from “Notes”', 'Notes')
    expect(screen.getByText(zh['card.source'].replace('{label}', 'Notes'))).toBeTruthy()
    // The attribution's wire locale never leaks into the card.
    expect(screen.queryByText(/quoted from/)).toBeNull()
  })
})
