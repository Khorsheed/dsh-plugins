// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ChapterMarkdown } from '../src/client/ChapterMarkdown.tsx'
import { chapterSelectionFromRange } from '../src/client/chapter-selection.ts'
import type { ChapterFeedbackIdea } from '../src/chapter-feedback.ts'

afterEach(cleanup)

function selection(root: HTMLElement, node: Node, start: number, end: number, body: string) {
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  Object.defineProperty(range, 'getBoundingClientRect', { value: () => new DOMRect() })
  return chapterSelectionFromRange(body, root, range)
}

describe('chapter markdown with raw offsets', () => {
  it('renders quotes, strong text, rules, lists, emphasis and code without injecting HTML', () => {
    const body = '# 标题\n\n> **作者说**\n> 继续\n\n---\n\n- 第一项\n- 第二项\n\n*斜体* 和 `代码` <img src=x onerror=alert(1)>'
    const { container } = render(<article data-novel-prose><ChapterMarkdown body={body} ideas={[]} /></article>)
    expect(container.querySelector('blockquote strong')?.textContent).toBe('作者说')
    expect(container.querySelectorAll('hr')).toHaveLength(1)
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.querySelector('em')?.textContent).toBe('斜体')
    expect(container.querySelector('code')?.textContent).toBe('代码')
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(container.querySelector('h4')).toBeNull()
  })

  it('keeps highlight and selection positions tied to the source rather than rendered text length', () => {
    const body = '> **作者说**\n\n普通 *斜体* 和 `代码`。'
    const start = body.indexOf('作者说')
    const idea: ChapterFeedbackIdea = { id: 'f1', chapter: 1, quote: '作者说', start, end: start + 3, baseBodyHash: '', text: '改一下', createdAt: 'now' }
    const { container } = render(<article data-novel-prose><ChapterMarkdown body={body} ideas={[idea]} /></article>)
    const strong = container.querySelector('blockquote strong')!
    expect(strong.getAttribute('data-feedback-start')).toBe(String(start))
    expect(strong.querySelector('mark')?.textContent).toBe('作者说')
    expect(selection(container, strong.querySelector('mark')!.firstChild!, 0, 3, body)).toMatchObject({ start, end: start + 3, quote: '作者说' })
    const code = container.querySelector('code')!
    const codeStart = body.indexOf('代码')
    expect(selection(container, code.firstChild!, 0, 2, body)).toMatchObject({ start: codeStart, end: codeStart + 2, quote: '代码' })
  })
})
