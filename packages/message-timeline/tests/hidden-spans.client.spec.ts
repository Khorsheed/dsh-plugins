// @vitest-environment jsdom
/**
 * The rail's hidden-span fold: the span a message-tools withdraw/edit covers,
 * folded from the sibling `message-tools-withdrawn` / `message-tools-edited`
 * nodes a session carries. An ordinary session has no such node, so the fold
 * is empty and nothing is hidden.
 */
import { describe, expect, it } from 'vitest'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'
import { foldHiddenSpans, isSeqHidden } from '../src/client/hidden-spans.ts'

function carrier(
  kind: 'message-tools-withdrawn' | 'message-tools-edited',
  anchorSeq: number,
  hiddenStartSeq: number,
  seq: number,
): ChatConversationViewNode {
  return {
    key: `${kind}-${seq}`, kind, target: 'chat', anchorSeq, visibility: 'visible',
    data: { seq, hiddenStartSeq },
  } as unknown as ChatConversationViewNode
}

describe('foldHiddenSpans', () => {
  it('is empty for an ordinary session (no withdraw/edit landed)', () => {
    expect(foldHiddenSpans([
      { key: 'k1', kind: 'user', target: 'chat', anchorSeq: 1, data: {} },
      { key: 'a1', kind: 'assistant', target: 'chat', anchorSeq: 2, data: {} },
    ] as unknown as ChatConversationViewNode[])).toEqual([])
  })

  it('folds a withdrawal divider span into [start, endExclusive]', () => {
    const spans = foldHiddenSpans([carrier('message-tools-withdrawn', 9, 5, 9)])
    expect(spans).toEqual([5, 9])
  })

  it('folds an edited span alongside a withdrawal divider, ordered by start', () => {
    const spans = foldHiddenSpans([
      carrier('message-tools-edited', 9, 5, 9),
      carrier('message-tools-withdrawn', 20, 12, 20),
    ])
    expect(spans).toEqual([5, 9, 12, 20])
  })

  it('skips a malformed carrier (missing or inverted bounds)', () => {
    const missing = carrier('message-tools-withdrawn', 9, 5, 9)
    ;(missing.data as { hiddenStartSeq?: number }).hiddenStartSeq = undefined
    expect(foldHiddenSpans([missing])).toEqual([])
    expect(foldHiddenSpans([carrier('message-tools-withdrawn', 5, 9, 5)])).toEqual([])
  })
})

describe('isSeqHidden', () => {
  const spans = foldHiddenSpans([
    carrier('message-tools-withdrawn', 9, 5, 9),
    carrier('message-tools-edited', 20, 12, 20),
  ])

  it('hides a seq inside a span (the withdrawn original)', () => {
    expect(isSeqHidden(spans, 5)).toBe(true)
    expect(isSeqHidden(spans, 8)).toBe(true)
    expect(isSeqHidden(spans, 12)).toBe(true)
  })

  it('does not hide the span end (the divider/edited bubble anchor) or empty spans', () => {
    expect(isSeqHidden(spans, 9)).toBe(false)
    expect(isSeqHidden(spans, 20)).toBe(false)
    expect(isSeqHidden(spans, 1)).toBe(false)
    expect(isSeqHidden([], 5)).toBe(false)
  })
})
