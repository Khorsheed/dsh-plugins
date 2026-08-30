/**
 * Timeline node-kind classification. The rail's projection (which store nodes
 * become rows) and its DOM tracking (which flow rows read as the reading
 * position) must agree on the set of "timeline row" kinds, and the hidden-
 * span fold must agree on the set of "span carrier" kinds. Rather than repeat
 * these inline predicates at every site — where a future kind could be added
 * to one place and silently missed in another — they live here as the single
 * source of truth. Both are pure and read only the `kind` string, so they hold
 * no dependency on the message-tools package and work for any session.
 */

/** A message-tools edited-bubble row (an in-place edit replacement). */
export const EDIT_KIND = 'message-tools-edited'
/** A message-tools restored row (a withdrawn message replayed at the tail). */
export const RESTORED_KIND = 'message-tools-restored'

/**
 * Whether a node kind renders as a timeline row. The rail lists user messages
 * (and optionally steering), plus the message-tools edited/restored bubbles
 * that the host `order` does not always surface.
 * @param kind - the node's kind string.
 * @param includeSteering - whether steering rows count as user messages.
 * @returns true when the kind belongs on the timeline.
 */
export function isTimelineRowKind(kind: string, includeSteering: boolean): boolean {
  return kind === 'user' || (includeSteering && kind === 'steering')
    || kind === EDIT_KIND || kind === RESTORED_KIND
}

/**
 * Whether a node kind carries a hidden span (`{ hiddenStartSeq, seq }`) that
 * the rail must fold to drop the covered originals. The withdrawal divider and
 * the edited bubble both declare the span they shadow.
 * @param kind - the node's kind string.
 * @returns true when the kind declares a hidden span.
 */
export function isHiddenSpanCarrierKind(kind: string): boolean {
  return kind === 'message-tools-withdrawn' || kind === EDIT_KIND
}
