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
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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
    fireEvent.click(screen.getByRole('tab', { name: 'detail.source' }))
    expect(screen.queryByRole('heading', { name: 'Title' })).toBeNull()
    expect(document.querySelector('pre')?.textContent).toContain('alpha hit line')
    fireEvent.click(screen.getByRole('tab', { name: 'detail.preview' }))
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy()
  })

  it('declares the quote source (file name) and locator (absolute path) on its root', () => {
    mount({ kind: 'text', path: 'docs/README.md', content: MARKDOWN }, { displayPath: '/work/docs/README.md' })
    const root = screen.getByRole('heading', { name: 'Title' }).closest('[data-quote-source]')
    expect(root?.getAttribute('data-quote-source')).toBe('README.md')
    expect(root?.getAttribute('data-quote-ref')).toBe('/work/docs/README.md')
  })

  it('offers no preview toggle for a plain code file', () => {
    mount({ kind: 'text', path: '/work/main.ts', content: 'const x = 1\n' })
    expect(screen.queryByRole('tab', { name: 'detail.preview' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'detail.source' })).toBeNull()
  })

  it('keeps the HTML tiers: static default, script tier only when the host says scripted', () => {
    const html = '<html><head></head><body><script>1</script></body></html>'
    mount({ kind: 'text', path: '/work/page.html', content: html, htmlScripted: true })
    // Static render is the default, carries the "scripts did not run" hint and
    // an empty sandbox (no allow-same-origin, ever).
    const frame = screen.getByTitle('preview.htmlRender') as HTMLIFrameElement
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.getAttribute('srcdoc')).toContain('preview.staticHint')
    expect(screen.getByRole('tab', { name: 'preview.htmlScript' })).toBeTruthy()
    // Tier1 is behind an explicit confirmation, never a silent switch.
    fireEvent.click(screen.getByRole('tab', { name: 'preview.htmlScript' }))
    expect(screen.getByText('preview.scriptConfirm')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'preview.scriptRun' }))
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
  })

  it('hides the script tier for a page with no scripts', () => {
    mount({ kind: 'text', path: '/work/plain.html', content: '<html><body>hi</body></html>' })
    expect(screen.queryByRole('tab', { name: 'preview.htmlScript' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'preview.htmlSource' })).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', { name: 'action.showInFolder' }))
    expect(openFolder).toHaveBeenCalledTimes(1)
  })

  it('collapses the IDE control to one button when a single IDE resolved', () => {
    mount({ kind: 'text', path: '/work/a.ts', content: 'x\n' }, {
      chrome: { openIDE: () => {}, ideChoices: [{ id: 'zed', label: 'Zed' }] },
    })
    expect(screen.getByRole('button', { name: 'action.openIDE' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'action.more' })).toBeNull()
  })

  it('lists every resolved IDE in the ⋯ menu once several resolved', () => {
    const onIdeChoice = vi.fn()
    mount({ kind: 'text', path: '/work/a.ts', content: 'x\n' }, {
      chrome: {
        openIDE: () => {},
        ideChoices: [{ id: 'zed', label: 'Zed' }, { id: 'vscode', label: 'VS Code' }],
        onIdeChoice,
      },
    })
    // The default IDE stays one click away; each resolved IDE is a menu row,
    // and picking one routes through the caller (which owns the remembered
    // choice and the host route).
    expect(screen.getByRole('button', { name: 'action.openIDE' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'action.more' }))
    fireEvent.click(screen.getByText('action.openIDE · VS Code'))
    expect(onIdeChoice).toHaveBeenCalledWith('vscode')
  })

  it('offers exactly one copy affordance — the path', () => {
    mount({ kind: 'text', path: '/work/a.ts', content: 'x\n' }, {
      onCopyPath: () => Promise.resolve(true),
      chrome: { openFolder: () => {}, openIDE: () => {} },
    })
    const copies = screen.getAllByRole('button')
      .map(button => button.getAttribute('aria-label') ?? '')
      .filter(label => label.startsWith('action.copy'))
    expect(copies).toEqual(['action.copyPath'])
  })

  it('keeps the view controls on the path row, not the title row or the search row', () => {
    // The header is layered: title = identity + host-open gestures; path row =
    // path + every "what am I looking at" control; search row = search only.
    mount({ kind: 'text', path: '/work/README.md', content: MARKDOWN })
    const row = screen.getByTitle('/work/README.md').parentElement
    expect(row?.contains(screen.getByRole('tab', { name: 'detail.source' }))).toBe(true)
    expect(row?.contains(screen.getByRole('searchbox'))).toBe(false)
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

describe('ContentPane reload gesture', () => {
  const read: PreviewRead = { kind: 'text', path: '/work/a.ts', content: 'x\n' }

  it('renders the button ahead of copy-path, and only when onReload is supplied', () => {
    mount(read, {
      onReload: () => Promise.resolve(),
      onCopyPath: () => Promise.resolve(true),
    })
    const reload = screen.getByRole('button', { name: 'action.reload' })
    const copy = screen.getByRole('button', { name: 'action.copyPath' })
    expect(reload.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    cleanup()
    mount(read, { onCopyPath: () => Promise.resolve(true) })
    expect(screen.queryByRole('button', { name: 'action.reload' })).toBeNull()
    expect(screen.getByRole('button', { name: 'action.copyPath' })).toBeTruthy()
  })

  it('calls the caller-owned onReload on click', async () => {
    const onReload = vi.fn(() => Promise.resolve())
    mount(read, { onReload })
    fireEvent.click(screen.getByRole('button', { name: 'action.reload' }))
    expect(onReload).toHaveBeenCalledTimes(1)
    await act(async () => {})
  })

  it('stays disabled while the reload is in flight and re-arms when it settles', async () => {
    let settle: () => void = () => {}
    const onReload = vi.fn(() => new Promise<void>(resolve => { settle = resolve }))
    mount(read, { onReload })
    const button = screen.getByRole('button', { name: 'action.reload' }) as HTMLButtonElement
    fireEvent.click(button)
    expect(button.disabled).toBe(true)
    // A second click while in flight is a no-op (the guard, not just disabled).
    fireEvent.click(button)
    expect(onReload).toHaveBeenCalledTimes(1)
    await act(async () => { settle() })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(onReload).toHaveBeenCalledTimes(2)
    await act(async () => {})
  })
})

describe('ContentPane compact chrome (panel-responsive-spec P1)', () => {
  /** Lay every element out at a phone width, so the pane measures as compact. */
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 390, height: 800, top: 0, left: 0, right: 390, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('spends two rows before the body: title bar and tabs, the search row folded behind an icon', () => {
    mount({ kind: 'text', path: '/work/README.md', content: MARKDOWN }, { displayPath: '/work/README.md', onCopyPath: () => Promise.resolve(true) })
    expect(document.querySelector('[data-compact=true]')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'detail.preview' })).toBeTruthy()
    // No path row and no search row until asked for.
    expect(screen.queryByTitle('/work/README.md')).toBeNull()
    expect(screen.queryByRole('searchbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'search.placeholder' }))
    search('alpha')
    expect(screen.getByText('search.hit')).toBeTruthy()
    // Escape clears the query first, then closes the row.
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('keeps search and reload inline and folds copy and the host gestures into the ⋯ menu, with no path row', () => {
    mount({ kind: 'text', path: '/work/a.md', content: '# A\n' }, {
      displayPath: '/work/a.md',
      onReload: () => Promise.resolve(),
      onCopyPath: () => Promise.resolve(true),
      chrome: { openFolder: () => {} },
    })
    expect(screen.getByRole('button', { name: 'search.placeholder' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'action.reload' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'action.copyPath' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'action.more' }))
    expect(screen.queryByText('/work/a.md')).toBeNull()
    expect(screen.getByText('action.copyPath')).toBeTruthy()
    expect(screen.getByText('action.showInFolder')).toBeTruthy()
  })

  it('puts a lone remaining action inline instead of a one-row ⋯ (the off-host header)', () => {
    // Off-host the open-in-app probe publishes no apps, so the caller passes no
    // host gestures: search, reload and copy path all fit without a menu.
    mount({ kind: 'text', path: '/work/a.md', content: '# A\n' }, {
      displayPath: '/work/a.md',
      onReload: () => Promise.resolve(),
      onCopyPath: () => Promise.resolve(true),
    })
    expect(screen.getByRole('button', { name: 'search.placeholder' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'action.reload' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'action.copyPath' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'action.more' })).toBeNull()
  })
})

describe('ContentPane edit mode', () => {
  const read = (content: string, path = '/w/notes.md'): PreviewRead => ({ kind: 'text', path, content })
  const editor = (): HTMLTextAreaElement => screen.getByLabelText('edit.label') as HTMLTextAreaElement

  afterEach(() => { cleanup() })

  it('offers no edit gesture without onSave, nor on a truncated window', () => {
    mount(read('# a\n', '/w/none.md'))
    expect(screen.queryByRole('button', { name: 'action.edit' })).toBeNull()
    cleanup()
    mount({ kind: 'text', path: '/w/big.md', content: 'x', truncated: true }, { onSave: vi.fn() })
    expect(screen.queryByRole('button', { name: 'action.edit' })).toBeNull()
  })

  it('edits on the source face, previews the draft, and saves with the original as base', async () => {
    const onSave = vi.fn(async () => ({ ok: true as const }))
    mount(read('# Old\n', '/w/save.md'), { onSave })
    fireEvent.click(screen.getByRole('button', { name: 'action.edit' }))
    expect(screen.getByRole('button', { name: 'edit.save' })).toHaveProperty('disabled', true)
    fireEvent.change(editor(), { target: { value: '# New\n' } })
    expect(screen.getByText('edit.dirty')).toBeTruthy()
    // The rendered face shows the draft, not the file.
    fireEvent.click(screen.getByRole('tab', { name: 'detail.preview' }))
    expect(screen.getByRole('heading', { name: 'New' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'detail.source' }))
    await act(async () => { fireEvent.keyDown(editor(), { key: 's', metaKey: true }) })
    expect(onSave).toHaveBeenCalledWith({ content: '# New\n', base: '# Old\n' })
    expect(screen.queryByLabelText('edit.label')).toBeNull()
  })

  it('restores CRLF line endings on save', async () => {
    const onSave = vi.fn(async () => ({ ok: true as const }))
    mount(read('a\r\nb\r\n', '/w/crlf.txt'), { onSave })
    fireEvent.click(screen.getByRole('button', { name: 'action.edit' }))
    expect(editor().value).toBe('a\nb\n')
    fireEvent.change(editor(), { target: { value: 'a\nb\nc\n' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'edit.save' })) })
    expect(onSave).toHaveBeenCalledWith({ content: 'a\r\nb\r\nc\r\n', base: 'a\r\nb\r\n' })
  })

  it('keeps the draft on a conflict and overwrites with a null base on request', async () => {
    const onSave = vi.fn()
      .mockResolvedValueOnce({ ok: false, reason: 'conflict' })
      .mockResolvedValueOnce({ ok: true })
    mount(read('v1', '/w/conflict.txt'), { onSave })
    fireEvent.click(screen.getByRole('button', { name: 'action.edit' }))
    fireEvent.change(editor(), { target: { value: 'mine' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'edit.save' })) })
    expect(screen.getByText('edit.conflict')).toBeTruthy()
    expect(editor().value).toBe('mine')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'edit.overwrite' })) })
    expect(onSave).toHaveBeenLastCalledWith({ content: 'mine', base: null })
    expect(screen.queryByLabelText('edit.label')).toBeNull()
  })

  it('asks before discarding unsaved changes, and keeps a draft across a file switch', () => {
    const onSave = vi.fn()
    const { rerender } = render(
      <ContentPane path="/w/one.txt" sessionId="sess-1" read={read('one', '/w/one.txt')} loading={false} error={null} labels={labels} t={t} onSave={onSave} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'action.edit' }))
    fireEvent.change(editor(), { target: { value: 'one edited' } })
    rerender(<ContentPane path="/w/two.txt" sessionId="sess-1" read={read('two', '/w/two.txt')} loading={false} error={null} labels={labels} t={t} onSave={onSave} />)
    expect(screen.queryByLabelText('edit.label')).toBeNull()
    rerender(<ContentPane path="/w/one.txt" sessionId="sess-1" read={read('one', '/w/one.txt')} loading={false} error={null} labels={labels} t={t} onSave={onSave} />)
    expect(editor().value).toBe('one edited')
    fireEvent.click(screen.getByRole('button', { name: 'edit.discard' }))
    expect(screen.getByText('edit.discardConfirm')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'edit.discard' }))
    expect(screen.queryByLabelText('edit.label')).toBeNull()
    expect(onSave).not.toHaveBeenCalled()
  })
})
