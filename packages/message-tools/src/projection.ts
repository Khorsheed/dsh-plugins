/**
 * Effective message view over a session's events: consumes edit/withdraw
 * events to decide what the model and UI should see for each user message.
 * Pure, replayable, tested in node.
 * @module @khorsheed/dsh-client-message-tools/projection
 */

/** The effective state of one user message. */
export type EffectiveMessage =
  | { seq: number; state: 'original'; text: string }
  | { seq: number; state: 'edited'; text: string; editedAt: number }
  | { seq: number; state: 'withdrawn'; withdrawnAt: number }

/** Minimal event shapes the projection reads (structural subset). */
export interface FoldableEvent {
  seq: number
  type: string
  data: Record<string, unknown>
}

/**
 * Fold a session's events into effective user-message states.
 * - `user/message` with source.kind === 'user' → original (or edited by a later event)
 * - `user/message/edited` → replace the text of targetSeq
 * - `user/message/withdrawn` → mark targetSeq withdrawn
 * @param events - session events in ascending seq order.
 * @returns effective messages keyed by original seq, in seq order.
 */
export function foldEffectiveMessages(events: readonly FoldableEvent[]): Map<number, EffectiveMessage> {
  const out = new Map<number, EffectiveMessage>()
  for (const event of events) {
    if (event.type === 'user/message') {
      const source = event.data.source as { kind?: string } | undefined
      if (source?.kind !== 'user') continue
      const content = event.data.content as MessageTextLike[] | undefined
      out.set(event.seq, { seq: event.seq, state: 'original', text: joinText(content) })
      continue
    }
    if (event.type === 'user/message/edited') {
      const target = event.data.targetSeq as number
      const content = event.data.content as MessageTextLike[] | undefined
      const ts = event.data.ts as number | undefined
      const existing = out.get(target)
      if (existing === undefined) continue
      out.set(target, { seq: target, state: 'edited', text: joinText(content), editedAt: ts ?? 0 })
      continue
    }
    if (event.type === 'user/message/withdrawn') {
      const target = event.data.targetSeq as number
      const ts = event.data.ts as number | undefined
      if (!out.has(target)) continue
      out.set(target, { seq: target, state: 'withdrawn', withdrawnAt: ts ?? 0 })
    }
  }
  return out
}

/** Text-ish content block (subset of the session content union). */
interface MessageTextLike { type?: string; text?: string }

/** Join text blocks into one plain string. @param blocks - content blocks. */
export function joinText(blocks: readonly MessageTextLike[] | undefined): string {
  if (blocks === undefined) return ''
  return blocks.filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string).join('')
}
