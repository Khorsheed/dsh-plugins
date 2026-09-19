// @vitest-environment jsdom
/**
 * The preview pane's content search keeps the read's own form: with a query
 * the rendered markdown actually shows, the document view stays mounted and
 * the hits are painted through the Custom Highlight API — only a query the
 * rendered body cannot show (`**`, pure source syntax) falls back to the raw
 * matched-lines view.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { FilePreviewRead } from '@khorsheed/dsh-file-preview/types'
import { FilePreviewPane } from '../src/client/FilePreviewPane.tsx'

class FakeHighlight {
  ranges: Range[] = []
  add(range: Range): void { this.ranges.push(range) }
}

let registry: Map<string, FakeHighlight>

// jsdom has no Element.scrollIntoView; the raw view's jump effect calls it.
Element.prototype.scrollIntoView = (() => {}) as never

const read: FilePreviewRead = {
  path: '/work/README.md',
  kind: 'text',
  content: '# Title\n\nalpha hit line\n\n**bold hit**\n',
}

/** Type a query into the content-search row. */
function search(query: string): void {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } })
}

beforeEach(() => {
  registry = new Map()
  vi.stubGlobal('Highlight', FakeHighlight)
  vi.stubGlobal('CSS', {
    highlights: {
      set: (name: string, highlight: FakeHighlight) => { registry.set(name, highlight) },
      delete: (name: string) => { registry.delete(name) },
    },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('FilePreviewPane content search', () => {
  it('keeps the rendered markdown and paints the visible hits', () => {
    render(<FilePreviewPane entry={undefined} read={read} t={((key: string) => key) as never} />)
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy()
    search('hit')
    // The rendered document is still the body, and both occurrences are painted.
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy()
    expect(registry.get('dsh-file-search-hits')?.ranges).toHaveLength(2)
    expect(registry.get('dsh-file-search-active')?.ranges).toHaveLength(1)
    expect(screen.getByText('1/2')).toBeTruthy()
  })

  it('falls back to the raw matched lines for a query the render cannot show', () => {
    render(<FilePreviewPane entry={undefined} read={read} t={((key: string) => key) as never} />)
    search('**')
    // The rendered heading is gone: the raw source view replaced the body.
    expect(screen.queryByRole('heading', { name: 'Title' })).toBeNull()
    const marks = document.querySelectorAll('mark')
    expect([...marks].map(mark => mark.textContent)).toEqual(['**', '**'])
    expect(registry.size).toBe(0)
  })

  it('does not count the format banner as a hit', () => {
    // The banner literally reads "markdown" whenever the body text does too.
    const bannerRead: FilePreviewRead = { path: '/work/doc.md', kind: 'text', content: 'markdown rules\n' }
    render(<FilePreviewPane entry={undefined} read={bannerRead} t={((key: string) => key) as never} />)
    search('markdown')
    expect(registry.get('dsh-file-search-hits')?.ranges).toHaveLength(1)
  })

  it('reports no match without switching views when nothing hits at all', () => {
    render(<FilePreviewPane entry={undefined} read={read} t={((key: string) => key) as never} />)
    search('zzz')
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy()
    expect(screen.getByText('preview.search.noMatch')).toBeTruthy()
  })
})
