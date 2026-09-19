// @vitest-environment jsdom
/**
 * The detail pane's content search keeps the rendered body: with a query that
 * the rendered markdown actually shows, the document view stays mounted and
 * the hits are painted through the Custom Highlight API — only a query the
 * rendered body cannot show (`**`, pure source syntax) falls back to the raw
 * matched-lines view.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { LocalFilesRead } from '../src/types.ts'
import { DetailPane } from '../src/client/DetailPane.tsx'

class FakeHighlight {
  ranges: Range[] = []
  add(range: Range): void { this.ranges.push(range) }
}

// jsdom has no Element.scrollIntoView; the raw view's jump effect calls it.
Element.prototype.scrollIntoView = (() => {}) as never

let registry: Map<string, FakeHighlight>

const MARKDOWN = '# Title\n\nalpha hit line\n\n**bold hit**\n'

const read: LocalFilesRead = { path: '/work/README.md', kind: 'text', content: MARKDOWN }

/** The pane with a fixed read and an identity translator. */
function mountPane(): void {
  render(
    <DetailPane
      path={read.path}
      sessionId="sess-1"
      read={read}
      loading={false}
      error={null}
      t={((key: string) => key) as never}
    />,
  )
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

describe('DetailPane content search', () => {
  it('keeps the rendered markdown and paints the visible hits', () => {
    mountPane()
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy()
    search('hit')
    // The rendered document is still the body...
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy()
    expect(screen.queryByText(/alpha hit line/, { selector: 'span' })).toBeNull()
    // ...and both occurrences of the query are painted over it.
    expect(registry.get('dsh-file-search-hits')?.ranges).toHaveLength(2)
    expect(registry.get('dsh-file-search-active')?.ranges).toHaveLength(1)
    expect(screen.getByText('search.hit', { exact: false })).toBeTruthy()
  })

  it('falls back to the raw matched lines for a query the render cannot show', () => {
    mountPane()
    search('**')
    // The rendered heading is gone: the raw source view replaced the body.
    expect(screen.queryByRole('heading', { name: 'Title' })).toBeNull()
    const marks = document.querySelectorAll('mark')
    expect([...marks].map(mark => mark.textContent)).toEqual(['**', '**'])
    expect(registry.size).toBe(0)
  })

  it('reports no match without switching views when nothing hits at all', () => {
    mountPane()
    search('zzz')
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy()
    expect(screen.getByText('search.noMatch')).toBeTruthy()
  })

  it('does not count the format banner as a hit', () => {
    // The banner literally reads "markdown" whenever the body text does too.
    const bannerRead: LocalFilesRead = { path: '/work/doc.md', kind: 'text', content: 'markdown rules\n' }
    render(
      <DetailPane
        path={bannerRead.path}
        sessionId="sess-1"
        read={bannerRead}
        loading={false}
        error={null}
        t={((key: string) => key) as never}
      />,
    )
    search('markdown')
    expect(registry.get('dsh-file-search-hits')?.ranges).toHaveLength(1)
  })
})
