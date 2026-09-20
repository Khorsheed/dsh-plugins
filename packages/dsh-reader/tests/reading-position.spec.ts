// @vitest-environment jsdom
/**
 * The reading anchor's in-block mapping (`offsetInBlock` in ReaderPane).
 *
 * The anchor's pixel offset into its block is only valid for the layout it was
 * measured in; the TEXT offset is what survives a translation (different words,
 * different block height). These cases pin the resolution order directly —
 * exact Range rect when the text is the one the anchor was taken from, the same
 * fraction of the text when it is not, the stored pixels when no text offset
 * was recorded — because jsdom's missing layout is exactly what the pane-level
 * specs cannot reach.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { offsetInBlock, type ArticleBlockMetrics } from '../src/client/ReaderPane.tsx'

/** A DOMRect literal (jsdom constructs none). */
function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

/** A block element holding one text run, laid out at the given top/height. */
function blockWith(text: string, top: number, height: number): HTMLElement {
  const element = document.createElement('p')
  element.textContent = text
  document.body.append(element)
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect(top, height))
  return element
}

const TEXT = 'Another paragraph entirely, with more words in it.' // 50 chars

afterEach(() => {
  vi.restoreAllMocks()
  document.body.textContent = ''
  // The Range geometry these tests install is not jsdom's: take it back off.
  delete (Range.prototype as unknown as Record<string, unknown>).getBoundingClientRect
})

describe('offsetInBlock', () => {
  it('passes the pixel offset through for an anchor from before the text offset existed', () => {
    const block: ArticleBlockMetrics = { top: 420, height: 500, textLength: TEXT.length, element: blockWith(TEXT, 420, 500) }
    expect(offsetInBlock(block, { block: 1, offset: 80, top: 500 })).toBe(80)
  })

  it('resolves the recorded character exactly when the block still holds the same text', () => {
    const element = blockWith(TEXT, 420, 500)
    const block: ArticleBlockMetrics = { top: 420, height: 500, textLength: TEXT.length, element }
    // jsdom's Range has no geometry at all; give it one that places each
    // character 12px into the block, so this path is distinguishable from the
    // proportional one (which would answer 80).
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: Range): DOMRect { return rect(420 + this.startOffset * 12, 14) },
    })
    expect(offsetInBlock(block, { block: 1, offset: 80, top: 500, text: 8, textLength: 50 })).toBe(96)
  })

  it('falls back to the same FRACTION of the text when there is no layout to resolve against', () => {
    // Same text, but jsdom's Range cannot answer: the proportional mapping is
    // what remains, and it is still better than the stale pixels once the
    // block's height has moved (images settling).
    const element = blockWith(TEXT, 420, 600)
    const block: ArticleBlockMetrics = { top: 420, height: 600, textLength: TEXT.length, element }
    expect(offsetInBlock(block, { block: 1, offset: 80, top: 500, text: 8, textLength: 50 })).toBe(96)
  })

  it('maps by fraction when the text changed — the translated view sets different words', () => {
    // The translation of the same sentence is longer here ("译：…"): the same
    // PLACE in the paragraph is the same fraction of the new text.
    const translated = `译：${TEXT}` // 52 chars
    const element = blockWith(translated, 460, 520)
    const block: ArticleBlockMetrics = { top: 460, height: 520, textLength: translated.length, element }
    expect(offsetInBlock(block, { block: 1, offset: 80, top: 500, text: 8, textLength: 50 })).toBe(Math.round((8 / 50) * 520))
  })

  it('treats a zero text offset as no text offset (the very top of the block)', () => {
    const block: ArticleBlockMetrics = { top: 420, height: 500, textLength: TEXT.length, element: blockWith(TEXT, 420, 500) }
    expect(offsetInBlock(block, { block: 1, offset: 80, top: 500, text: 0, textLength: 50 })).toBe(80)
  })
})
