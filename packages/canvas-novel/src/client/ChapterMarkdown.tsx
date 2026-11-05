import type { ReactNode } from 'react'
import { locateChapterFeedback, type ChapterFeedbackIdea } from '../chapter-feedback.ts'
import css from './novel.module.css'

interface ChapterMarkdownIdea extends ChapterFeedbackIdea {
  readonly archived?: boolean
}

type Style = 'text' | 'strong' | 'em' | 'code'
interface InlineToken {
  readonly start: number
  readonly end: number
  readonly style: Style
}
interface Block {
  readonly start: number
  readonly end: number
  readonly kind: 'heading' | 'paragraph' | 'quote' | 'hr' | 'ul' | 'ol'
  readonly level?: number
  readonly items?: readonly { readonly start: number; readonly end: number }[]
}

function inlineTokens(body: string, start: number, end: number, style: Style = 'text'): InlineToken[] {
  const out: InlineToken[] = []
  let plain = start
  let at = start
  const push = (from: number, to: number, nextStyle: Style): void => {
    if (to > from) out.push({ start: from, end: to, style: nextStyle })
  }
  while (at < end) {
    const marker = body.startsWith('**', at) ? '**' : body[at] === '`' ? '`' : body[at] === '*' || body[at] === '_' ? body[at]! : undefined
    if (marker === undefined) { at += 1; continue }
    const close = body.indexOf(marker, at + marker.length)
    if (close < 0 || close >= end || close === at + marker.length) { at += marker.length; continue }
    push(plain, at, style)
    if (marker === '`') push(at + 1, close, 'code')
    else out.push(...inlineTokens(body, at + marker.length, close, marker === '**' ? 'strong' : 'em'))
    at = close + marker.length
    plain = at
  }
  push(plain, end, style)
  return out
}

function blocksOf(body: string): Block[] {
  const blocks: Block[] = []
  const lines = body.split('\n')
  let offset = 0
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    const start = offset
    offset += line.length + 1
    index += 1
    const trimmed = line.trim()
    if (trimmed === '') continue
    const leading = line.indexOf(trimmed)
    const content = start + leading
    const heading = /^(#{1,6})\s+/.exec(trimmed)
    if (heading !== null) {
      const from = content + heading[0].length
      blocks.push({ start: from, end: content + trimmed.length, kind: 'heading', level: heading[1]!.length })
      continue
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed.replace(/\s/g, ''))) {
      blocks.push({ start: content, end: content + trimmed.length, kind: 'hr' })
      continue
    }
    if (trimmed.startsWith('>')) {
      const items: { start: number; end: number }[] = []
      let current = index - 1
      let quoteStart = start
      while (current < lines.length && lines[current]!.trim().startsWith('>')) {
        const raw = lines[current]!
        const text = raw.trim()
        const marker = /^>\s?/.exec(text)!
        const from = raw.indexOf(text) + marker[0].length
        items.push({ start: quoteStart + from, end: quoteStart + text.length })
        quoteStart += raw.length + 1
        current += 1
      }
      offset = quoteStart
      index = current
      blocks.push({ start: items[0]!.start, end: items.at(-1)!.end, kind: 'quote', items })
      continue
    }
    const list = /^(?:([-+*])|(\d+)[.)])\s+/.exec(trimmed)
    if (list !== null) {
      const ordered = list[2] !== undefined
      const items: { start: number; end: number }[] = []
      let current = index - 1
      let listStart = start
      const pattern = ordered ? /^(?:\d+)[.)]\s+/ : /^[-+*]\s+/
      while (current < lines.length) {
        const raw = lines[current]!
        const text = raw.trim()
        const marker = pattern.exec(text)
        if (marker === null) break
        const from = raw.indexOf(text) + marker[0].length
        items.push({ start: listStart + from, end: listStart + text.length })
        listStart += raw.length + 1
        current += 1
      }
      offset = listStart
      index = current
      blocks.push({ start: items[0]!.start, end: items.at(-1)!.end, kind: ordered ? 'ol' : 'ul', items })
      continue
    }
    blocks.push({ start: content, end: content + trimmed.length, kind: 'paragraph' })
  }
  return blocks
}

function highlighted(body: string, token: InlineToken, ideas: readonly ChapterMarkdownIdea[]): ReactNode {
  const ranges = ideas.flatMap(idea => {
    const found = locateChapterFeedback(idea, body)
    return found === undefined || found.end <= token.start || found.start >= token.end ? [] : [{ idea, start: Math.max(token.start, found.start), end: Math.min(token.end, found.end) }]
  })
  if (ranges.length === 0) return body.slice(token.start, token.end)
  const boundaries = [...new Set([token.start, token.end, ...ranges.flatMap(range => [range.start, range.end])])].sort((a, b) => a - b)
  return boundaries.slice(1).map((boundary, index) => {
    const from = boundaries[index]!
    const range = ranges.find(row => row.start <= from && row.end >= boundary)
    const text = body.slice(from, boundary)
    return range === undefined
      ? <span key={from}>{text}</span>
      : <mark key={from} data-idea-id={range.idea.id} className={range.idea.archived === true ? css.feedbackMarkArchived : css.feedbackMark}>{text}</mark>
  })
}

function Inline({ body, start, end, ideas }: { readonly body: string; readonly start: number; readonly end: number; readonly ideas: readonly ChapterMarkdownIdea[] }): ReactNode {
  return inlineTokens(body, start, end).map((token, index) => {
    const content = highlighted(body, token, ideas)
    const props = { 'data-feedback-start': token.start, 'data-feedback-end': token.end, children: content }
    return token.style === 'strong' ? <strong key={`${token.start}:${index}`} {...props} />
      : token.style === 'em' ? <em key={`${token.start}:${index}`} {...props} />
        : token.style === 'code' ? <code key={`${token.start}:${index}`} {...props} />
          : <span key={`${token.start}:${index}`} {...props} />
  })
}

function BlockView({ block, body, ideas }: { readonly block: Block; readonly body: string; readonly ideas: readonly ChapterMarkdownIdea[] }): ReactNode {
  if (block.kind === 'hr') return <hr />
  if (block.kind === 'heading') return <h4 className={css.proseHeading}><Inline body={body} start={block.start} end={block.end} ideas={ideas} /></h4>
  if (block.kind === 'quote') return <blockquote>{block.items!.map(item => <p key={item.start}><Inline body={body} start={item.start} end={item.end} ideas={ideas} /></p>)}</blockquote>
  if (block.kind === 'ul' || block.kind === 'ol') {
    const Tag = block.kind
    return <Tag>{block.items!.map(item => <li key={item.start}><Inline body={body} start={item.start} end={item.end} ideas={ideas} /></li>)}</Tag>
  }
  return <p><Inline body={body} start={block.start} end={block.end} ideas={ideas} /></p>
}

/** A safe Markdown subset whose every selectable inline token retains its raw chapter offsets. */
export function ChapterMarkdown({ body, ideas, skipFirstHeading = true }: {
  readonly body: string
  readonly ideas: readonly ChapterMarkdownIdea[]
  readonly skipFirstHeading?: boolean
}): ReactNode {
  const blocks = blocksOf(body)
  const shown = skipFirstHeading && blocks[0]?.kind === 'heading' ? blocks.slice(1) : blocks
  return <>{shown.map(block => <BlockView key={block.start} block={block} body={body} ideas={ideas} />)}</>
}
