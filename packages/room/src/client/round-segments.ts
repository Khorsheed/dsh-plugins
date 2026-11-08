/**
 * A member's round cut at the points it stopped for the human
 * (room-timeline-order E1): what the round said before a question stays with
 * the question card where it was asked; what it says after the answer grows
 * below the answer (「接着说」). Read from data the room already records — the
 * question log (asked/settled times, the recorded tail) and the landed
 * reply's question offsets — so old logs fall back by what they carry: a
 * reply with an unfound offset keeps its questions inside itself, a question
 * with no round keeps its own row.
 * @module @khorsheed/dsh-room/client/round-segments
 */
import { useLayoutEffect, useState, type RefObject } from 'react'
import type { RoomAsk } from '../types.ts'
import type { RoomSpeechData } from './nodes.ts'

/**
 * The questions one round asked, in the order it asked them.
 * @param askLog - the room's question log.
 * @param runId - the round.
 * @returns the round's questions.
 */
export function roundAsks(askLog: readonly RoomAsk[] | undefined, runId: string | undefined): RoomAsk[] {
  if (runId === undefined) return []
  return (askLog ?? []).filter(ask => ask.runId === runId).sort((a, b) => a.time - b.time)
}

/**
 * Where a question's stretch of live output starts: the previous question of
 * the round settled there (else the round's start).
 * @param ask - the question.
 * @param askLog - the room's question log.
 * @returns the previous question, when there is one.
 */
export function previousAsk(ask: RoomAsk, askLog: readonly RoomAsk[] | undefined): RoomAsk | undefined {
  const asks = roundAsks(askLog, ask.runId)
  const index = asks.findIndex(entry => entry.id === ask.id)
  return index > 0 ? asks[index - 1] : undefined
}

/**
 * Where a running round goes on after its questions: the latest time one of
 * them settled, once none waits — the run card then shows only what came
 * after (「接着说」). Undefined while a question waits or none was asked.
 * @param askLog - the room's question log.
 * @param runId - the round.
 * @returns the continuation's start, or undefined.
 */
export function continuedSince(askLog: readonly RoomAsk[] | undefined, runId: string | undefined): number | undefined {
  const asks = roundAsks(askLog, runId)
  if (asks.length === 0 || asks.some(ask => ask.state === 'pending')) return undefined
  return Math.max(...asks.map(ask => ask.resolvedAt ?? ask.time))
}

/**
 * How a landed reply shows its round's questions: `split` — they sit at
 * their own question cards above, the reply shows only what came after the
 * last one (`rest`, from offset `from`); `inline` — they are carried inside
 * the reply (no questions, an unfound offset, or a log that does not know them).
 * @param data - the speech node data.
 * @param askLog - the room's question log.
 * @returns the reply's shape.
 */
export function replySplit(data: RoomSpeechData, askLog: readonly RoomAsk[] | undefined): { readonly kind: 'split'; readonly from: number; readonly rest: string } | { readonly kind: 'inline' } {
  const logged = new Set((askLog ?? []).filter(ask => ask.runId !== undefined).map(ask => ask.id))
  const asks = (data.asks ?? []).filter(entry => logged.has(entry.id))
  if (asks.length === 0 || asks.some(entry => entry.at < 0)) return { kind: 'inline' }
  const from = Math.min(data.text.length, Math.max(...asks.map(entry => entry.at)))
  return { kind: 'split', from, rest: data.text.slice(from) }
}

/** The attribute a question card carries with its round's id, for the card after it to group with. */
export const SEGMENT_ATTR = 'data-room-seg'

/**
 * Whether a card directly follows a question card of the same round in the
 * conversation (nothing visible between): it then joins that card — no
 * avatar, just the 「接着说」 chip. Read off the rendered flow (the host seats
 * each node in its own `data-chat-flow-key` item; a bare list in previews),
 * skipping seats that render nothing.
 * @param element - the card's root.
 * @param runId - its round.
 * @returns whether it follows its round's question card.
 */
export function followsRoundSegment(element: Element, runId: string): boolean {
  const item = element.closest('[data-chat-flow-key]') ?? element
  let previous = item.previousElementSibling
  while (previous !== null && previous.childElementCount === 0 && (previous.textContent ?? '').trim() === '') previous = previous.previousElementSibling
  if (previous === null) return false
  const selector = `[${SEGMENT_ATTR}="${runId.replace(/["\\]/g, '\\$&')}"]`
  return previous.matches(selector) || previous.querySelector(selector) !== null
}

/**
 * {@link followsRoundSegment}, kept current as the flow around the card changes.
 * @param ref - the card's root.
 * @param runId - its round (undefined = never grouped).
 * @param enabled - whether the card is a continuation at all.
 * @returns whether the card joins the question card above it.
 */
export function useRoundGroup(ref: RefObject<HTMLElement | null>, runId: string | undefined, enabled: boolean): boolean {
  const [grouped, setGrouped] = useState(false)
  // Every render (the room state changed: something may have landed between).
  useLayoutEffect(() => {
    const element = ref.current
    setGrouped(enabled && runId !== undefined && element !== null && followsRoundSegment(element, runId))
  })
  // Seats added or removed around it.
  useLayoutEffect(() => {
    const element = ref.current
    if (!enabled || runId === undefined || element === null || typeof MutationObserver === 'undefined') return undefined
    const list = (element.closest('[data-chat-flow-key]') ?? element).parentElement
    if (list === null) return undefined
    const observer = new MutationObserver(() => { setGrouped(followsRoundSegment(element, runId)) })
    observer.observe(list, { childList: true })
    return () => { observer.disconnect() }
  }, [ref, runId, enabled])
  return grouped
}
