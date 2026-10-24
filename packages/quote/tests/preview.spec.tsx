// @vitest-environment jsdom
/**
 * The chip-click preview card: renders the quote body plus the label title,
 * and dismisses on the close button, Escape, and an outside mousedown.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { zh } from '../src/client/locales.ts'
import { QuotePreview, type QuotePreviewProps } from '../src/client/QuotePreview.tsx'
import { createQuotePreviewStore } from '../src/client/reference.ts'

afterEach(cleanup)

/** A plain translate over the zh dictionary. */
const t = ((key: keyof typeof zh, params?: Record<string, string>): string =>
  zh[key].replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)) as QuotePreviewProps['t']

function bench() {
  const preview = createQuotePreviewStore()
  render(<QuotePreview {...({ preview, t } as unknown as QuotePreviewProps)} />)
  return preview
}

describe('QuotePreview', () => {
  it('renders nothing while the store is empty', () => {
    bench()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the title and the full body once the store shows a quote', () => {
    const preview = bench()
    act(() => preview.show({ title: '引用「主会话」', body: '第一行\n第二行\n\n第三段' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('引用「主会话」')
    expect(dialog.textContent).toContain('第一行\n第二行\n\n第三段')
  })

  it('closes a located quote with its locator row, and shows none without one', () => {
    const preview = bench()
    act(() => preview.show({ title: '引用「README.md」', body: '正文', location: '/home/user/r/README.md' }))
    expect(screen.getByText(zh['preview.location'])).toBeTruthy()
    expect(screen.getByText('/home/user/r/README.md')).toBeTruthy()
    act(() => preview.show({ title: 'T', body: 'B' }))
    expect(screen.queryByText(zh['preview.location'])).toBeNull()
  })

  it('falls back to the menu title when the payload carries no label', () => {
    const preview = bench()
    act(() => preview.show({ body: '旧引用' }))
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe(zh['menu.title'])
  })

  it('closes on the close button, Escape, and an outside mousedown', () => {
    const preview = bench()
    act(() => preview.show({ title: 'T', body: 'B' }))
    fireEvent.click(screen.getByRole('button', { name: zh['preview.close'] }))
    expect(screen.queryByRole('dialog')).toBeNull()

    act(() => preview.show({ title: 'T', body: 'B' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    act(() => preview.show({ title: 'T', body: 'B' }))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
    // A mousedown INSIDE the card does not close it.
    act(() => preview.show({ title: 'T', body: 'B' }))
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('floats beside the click anchor (clamped above it), centered without one', () => {
    const preview = bench()
    // jsdom measures zero size: above a y=300 click with a zero-height card → top = 300 − 0 − 8.
    act(() => preview.show({ title: 'T', body: 'B' }, { x: 200, y: 300 }))
    const anchored = screen.getByRole('dialog')
    expect(anchored.style.left).toBe('200px')
    expect(anchored.style.top).toBe('292px')
    preview.clear()
    act(() => preview.show({ title: 'T', body: 'B' }))
    expect(screen.getByRole('dialog').style.left).toBe('')
  })

  it('a fresh open never inherits the previous placement', () => {
    const preview = bench()
    act(() => preview.show({ title: 'T', body: 'B' }, { x: 200, y: 300 }))
    expect(screen.getByRole('dialog').style.top).toBe('292px')
    preview.clear()
    act(() => preview.show({ title: 'T', body: 'B' }, { x: 400, y: 600 }))
    expect(screen.getByRole('dialog').style.left).toBe('400px')
    expect(screen.getByRole('dialog').style.top).toBe('592px')
  })
})
