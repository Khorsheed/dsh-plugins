/**
 * Hidden-span folding for the rail. A message-tools withdraw (or an in-place
 * edit) shadows a span of the transcript but leaves the withdrawn original
 * rows in the node store — and, because the projection offers no suppression
 * seam, a withdrawn user message stays visible in the host `order` while the
 * sibling DOM hider hides its row by CSS. A rail row for such a node is a dead
 * row: the transcript row it would target is `display:none`, so a click cannot
 * scroll to it.
 *
 * The span a withdraw or edit covers is carried right on the store by the
 * sibling `message-tools-withdrawn` / `message-tools-edited` node as
 * `{ hiddenStartSeq, seq }` (its `anchorSeq` is `seq`, the exclusive end, so
 * the divider/edited bubble itself is never inside its own span). Folding
 * those spans — exactly the pair list message-tools' `foldHiddenRanges`
 * builds — lets the rail skip any row whose `anchorSeq` falls inside one.
 *
 * This module reads only generic store node data (no import from message-tools
 * and no dependence on its type map). An ordinary session carries no such
 * node, so the fold is empty and every order row still renders: the fix never
 * alters the baseline path.
 */
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'
import { isHiddenSpanCarrierKind } from './timeline-kinds.ts'

/** Span data carried by a `message-tools-withdrawn` / `message-tools-edited` node. */
interface SpanCarrier {
  readonly hiddenStartSeq?: number
  readonly seq?: number
}

/**
 * Fold the hidden seq spans out of the store into the flat
 * `[start, endExclusive, ...]` pair list ordered by start — the same shape
 * message-tools' renderers and DOM hider consume (`{ hiddenStartSeq, seq }`,
 * inclusive start, exclusive end). A malformed carrier (missing or inverted
 * bounds) is skipped rather than poisoning the fold.
 * @param nodes - every materialized chat node (any order).
 * @returns the flattened hidden spans; empty when no withdraw/edit landed.
 */
export function foldHiddenSpans(nodes: readonly ChatConversationViewNode[]): number[] {
  const pairs: Array<[number, number]> = []
  for (const node of nodes) {
    if (!isHiddenSpanCarrierKind(node.kind)) continue
    const data = node.data as SpanCarrier
    if (data.hiddenStartSeq === undefined || data.seq === undefined) continue
    if (data.hiddenStartSeq >= data.seq) continue
    pairs.push([data.hiddenStartSeq, data.seq])
  }
  pairs.sort((left, right) => left[0] - right[0])
  return pairs.flat()
}

/**
 * Whether a node seq falls inside one of the folded hidden spans.
 * @param spans - the flattened spans from {@link foldHiddenSpans}.
 * @param seq - the node seq to test.
 * @returns true when the seq is hidden (a withdrawn original).
 */
export function isSeqHidden(spans: readonly number[], seq: number): boolean {
  for (let index = 0; index + 1 < spans.length; index += 2) {
    const start = spans[index]
    const end = spans[index + 1]
    if (start !== undefined && end !== undefined && seq >= start && seq < end) return true
  }
  return false
}
