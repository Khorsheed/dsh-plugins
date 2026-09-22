// @vitest-environment jsdom
/**
 * The shared content pane's contract-level behaviour: the two surfaces it
 * replaced each lacked half of this, so every assertion here is an acceptance
 * item from proposal preview-kernel §能力清单.
 *
 * Covered: the rendered-body content search with its honest raw fallback (E),
 * the UNION of the two preview controls — markdown/JSON/CSV render⇄source plus
 * HTML's tiered sandbox (B1/B2/B3), the per-file host-open chrome (F1), the
 * designed non-text placeholders (B4), and the "scripts did not run" hint that
 * makes a static render non-silent (D2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PreviewRead } from '../src/client/contract.ts'
import type { StructuredLabels } from '../src/client/labels.ts'
import { ContentPane } from '../src/client/ContentPane.tsx'

class FakeHighlight {
  ranges: Range[] = []
  add(range: Range): void { this.ranges.push(range) }
}

// jsdom has no Element.scrollIntoView; the raw view's jump effect calls it.
Element.prototype.scrollIntoView = (() => {}) as never

let registry: Map<string, FakeHighlight>

const MARKDOWN = '# Title\n\nalpha hit line\n\n**bold hit**\n'

/** An identity translator: every key prints itself, so assertions read as keys. */
const t = ((key: string) => key) as never

/** Minimal locale chrome (see the consumers' own adapters). */
const labels = {
  markdown: { code: { copyLabel: 'copy', copiedLabel: 'copied' }, footnotes: 'Footnotes' },
  json: {
    copyValue: 'v', copyJson: 'j', copyPath: 'p', copyPrettyJson: 'pj', copyCompactJson: 'cj',
    copied: 'ok', copyFailed: 'fail', collapseNode: 'collapse', expandNode: 'expand',
    copyButtonTitle: (action: string) => action,
  },
} satisfies StructuredLabels

/** Mount the pane over one read. */
function mount(read: PreviewRead, extra: Record<string, unknown> = {}): void {
  render(
    <ContentPane
      path={read.path}
      sessionId="sess-1"
      read={read}
      loading={false}
      error={null}
      labels={labels}
      t={t}
      {...extra}
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

describe('ContentPane content search', () => {
  const read: PreviewRead = { kind: 'text', path: '/work/README.md', content: MARKDOWN }

  it('keeps the rendered markdown and paints the visible hits', () => {
    mount(read)
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy()
    search('hit')
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy()
    expect(screen.queryByText(/alpha hit line/, { selector: 'span' })).toBeNull()
    expect(registry.get('dsh-file-search-hits')?.ranges).toHaveLength(2)
    expect(registry.get('dsh-file-search-active')?.ranges).toHaveLength(1)
    expect(screen.getByText('search.hit', { exact: false })).toBeTruthy()
  })

  it('falls back to the raw matched lines for a query the render cannot show', () => {
    mount(read)
    search('**')
    expect(screen.queryByRole('heading', { name: 'Title' })).toBeNull()
    const marks = document.querySelectorAll('mark')
    expect([...marks].map(mark => mark.textContent)).toEqual(['**', '**'])
    expect(registry.size).toBe(0)
  })

  it('reports no match without switching views when nothing hits at all', () => {
    mount(read)
    search('zzz')
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy()
    expect(screen.getByText('search.noMatch')).toBeTruthy()
  })

  it('does not count the format banner as a hit', () => {
    mount({ kind: 'text', path: '/work/doc.md', content: 'markdown rules\n' })
    search('markdown')
    expect(registry.get('dsh-file-search-hits')?.ranges).toHaveLength(1)
  })
})

describe('ContentPane preview controls (the union of both surfaces)', () => {
  it('renders markdown as a document and offers a source toggle', () => {
    const read: PreviewRead = { kind: 'text', path: '/work/README.md', content: MARKDOWN }
    mount(read)
    // Rendered by default, inside the shared block chrome (format banner + body).
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy()
    expect(screen.getByText('markdown')).toBeTruthy()
    // The toggle `local-files` never had: switch to the source form.
    fireEvent.click(screen.getByRole('button', { name: 'detail.source' }))
    expect(screen.queryByRole('heading', { name: 'Title' })).toBeNull()
    expect(document.querySelector('pre')?.textContent).toContain('alpha hit line')
    fireEvent.click(screen.getByRole('button', { name: 'detail.preview' }))
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy()
  })

  it('offers no preview toggle for a plain code file', () => {
    mount({ kind: 'text', path: '/work/main.ts', content: 'const x = 1\n' })
    expect(screen.queryByRole('button', { name: 'detail.preview' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'detail.source' })).toBeNull()
  })

  it('keeps the HTML tiers: static default, script tier only when the host says scripted', () => {
    const html = '<html><head></head><body><script>1</script></body></html>'
    mount({ kind: 'text', path: '/work/page.html', content: html, htmlScripted: true })
    // Static render is the default, carries the "scripts did not run" hint and
    // an empty sandbox (no allow-same-origin, ever).
    const frame = screen.getByTitle('preview.htmlRender') as HTMLIFrameElement
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.getAttribute('srcdoc')).toContain('preview.staticHint')
    expect(screen.getByRole('button', { name: 'preview.htmlScript' })).toBeTruthy()
    // Tier1 is behind an explicit confirmation, never a silent switch.
    fireEvent.click(screen.getByRole('button', { name: 'preview.htmlScript' }))
    expect(screen.getByText('preview.scriptConfirm')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'preview.scriptRun' }))
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
  })

  it('hides the script tier for a page with no scripts', () => {
    mount({ kind: 'text', path: '/work/plain.html', content: '<html><body>hi</body></html>' })
    expect(screen.queryByRole('button', { name: 'preview.htmlScript' })).toBeNull()
    expect(screen.getByRole('button', { name: 'preview.htmlSource' })).toBeTruthy()
  })
})

describe('ContentPane chrome and non-text reads', () => {
  it('renders each host-open gesture only when the caller supplies it', () => {
    const openFolder = vi.fn()
    mount({ kind: 'text', path: '/work/a.ts', content: 'x\n' }, {
      displayPath: '/work/a.ts',
      chrome: { openFolder },
      onCopyPath: () => Promise.resolve(true),
    })
    expect(screen.getByRole('button', { name: 'action.copyPath' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'action.openIDE' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'action.openFolder' }))
    expect(openFolder).toHaveBeenCalledTimes(1)
  })

  it('offers the copy-content gesture alongside the copy-path one', () => {
    const copyContent = vi.fn()
    mount({ kind: 'text', path: '/work/a.ts', content: 'x\n' }, {
      onCopyPath: () => Promise.resolve(true),
      chrome: { copyContent },
    })
    expect(screen.getByRole('button', { name: 'action.copyPath' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'action.copyContent' }))
    expect(copyContent).toHaveBeenCalledTimes(1)
  })

  it('shows designed placeholders for binary, deleted and unreadable reads', () => {
    mount({ kind: 'binary', path: '/work/a.png', size: 12 })
    expect(screen.getByText('local.binary · 12 B')).toBeTruthy()
    cleanup()
    mount({ kind: 'missing', path: '/work/gone.ts', reason: 'deleted' })
    expect(screen.getByText('detail.deleted')).toBeTruthy()
    cleanup()
    mount({ kind: 'missing', path: '/work/x.ts', reason: 'unreadable' })
    expect(screen.getByText('local.unreadable')).toBeTruthy()
  })

  it('renders the diff body and its toggle only when the caller supplies a diff', () => {
    mount({ kind: 'text', path: '/work/a.ts', content: 'x\n' }, {
      diffView: <div>the-diff</div>,
      view: 'diff' as const,
      onViewChange: () => {},
    })
    expect(screen.getByText('the-diff')).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()
  })
})
