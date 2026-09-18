// @vitest-environment jsdom
/**
 * The rendered-body content search: the scan collects visible hits only
 * (chrome and marked banners are skipped), the paint path registers both
 * registry names through the Custom Highlight API when it exists, and the hook
 * reports the visible count — or the raw-line fallback when the rendered body
 * cannot show the query at all. jsdom has no Highlight API, which is exactly
 * the no-API branch the pane must degrade through.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef, type ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import {
  SEARCH_ACTIVE, SEARCH_HITS, clearPaintedRanges, collectMatchRanges, paintRanges,
  supportsRenderedSearch, useRenderedSearch,
} from '../src/client/rendered-search.ts'

/** Minimal stand-in for the browser's Highlight (a Set of ranges). */
class FakeHighlight {
  ranges: Range[] = []
  add(range: Range): void { this.ranges.push(range) }
}

let registry: Map<string, FakeHighlight>

/** Install / remove the API so both branches are reachable in one suite. */
function installHighlightApi(): void {
  registry = new Map()
  vi.stubGlobal('Highlight', FakeHighlight)
  vi.stubGlobal('CSS', {
    highlights: {
      set: (name: string, highlight: FakeHighlight) => { registry.set(name, highlight) },
      delete: (name: string) => { registry.delete(name) },
    },
  })
}

beforeEach(() => { installHighlightApi() })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('collectMatchRanges', () => {
  it('finds every occurrence in nested rendered text, case-insensitively', () => {
    const root = document.createElement('div')
    root.innerHTML = '<h2>Alpha beta</h2><p>beta <em>BETA</em> gamma</p>'
    const ranges = collectMatchRanges(root, 'beta')
    expect(ranges.map(range => range.toString())).toEqual(['beta', 'beta', 'BETA'])
  })

  it('skips chrome: button labels and marked banners/notices', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div data-dsh-search-skip=""><span>markdown</span></div><p>markdown rules</p><button>markdown</button>'
    const ranges = collectMatchRanges(root, 'markdown')
    expect(ranges.map(range => range.toString())).toEqual(['markdown'])
  })

  it('returns no ranges for an empty query', () => {
    const root = document.createElement('div')
    root.textContent = 'anything'
    expect(collectMatchRanges(root, '')).toEqual([])
  })
})

describe('paintRanges', () => {
  it('registers the hit set and the active hit under both names', () => {
    const root = document.createElement('div')
    root.textContent = 'a hit and a hit'
    paintRanges(collectMatchRanges(root, 'hit'), 1)
    expect(registry.get(SEARCH_HITS)?.ranges).toHaveLength(2)
    expect(registry.get(SEARCH_ACTIVE)?.ranges.map(range => range.toString())).toEqual(['hit'])
    clearPaintedRanges()
    expect(registry.size).toBe(0)
  })

  it('clears both names when there is nothing to paint', () => {
    paintRanges([], 0)
    expect(registry.size).toBe(0)
  })

  it('is a no-op without the API', () => {
    vi.unstubAllGlobals()
    expect(supportsRenderedSearch()).toBe(false)
    const root = document.createElement('div')
    root.textContent = 'hit'
    expect(() => { paintRanges(collectMatchRanges(root, 'hit'), 0) }).not.toThrow()
    expect(() => { clearPaintedRanges() }).not.toThrow()
  })
})

/** A body plus the hook's live verdict, so the count/fallback are observable. */
function Harness({ query, body }: { query: string; body: ReactNode }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const { count, fallback } = useRenderedSearch({ rootRef, query, active: 0, enabled: true })
  return (
    <div ref={rootRef} data-testid="root">
      {body}
      <span data-testid="count">{count === null ? 'null' : String(count)}</span>
      <span data-testid="fallback">{String(fallback)}</span>
    </div>
  )
}

describe('useRenderedSearch', () => {
  it('counts visible hits and paints them', () => {
    render(<Harness query="hit" body={<p>a hit, another hit</p>} />)
    expect(screen.getByTestId('count').textContent).toBe('2')
    expect(registry.get(SEARCH_HITS)?.ranges).toHaveLength(2)
  })

  it('falls back when the rendered body cannot show the query', () => {
    render(<Harness query="**" body={<p>a rendered paragraph</p>} />)
    expect(screen.getByTestId('count').textContent).toBe('0')
    expect(screen.getByTestId('fallback').textContent).toBe('true')
  })

  it('stays unmeasured without the API, so the pane keeps its own hit count', () => {
    vi.unstubAllGlobals()
    render(<Harness query="hit" body={<p>a hit</p>} />)
    expect(screen.getByTestId('count').textContent).toBe('null')
    expect(screen.getByTestId('fallback').textContent).toBe('false')
  })
})
