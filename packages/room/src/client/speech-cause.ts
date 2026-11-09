/**
 * What started a member's round, for the 「回应 X 的…」 line on its reply:
 * the delivery the round ran (its run id IS the delivery id,
 * `<dispatchSeq>:<memberId>`). The human's own messages need no line — the
 * message sits right above — and neither do help requests (their own rows).
 * @module @khorsheed/dsh-room/client/speech-cause
 */
import type { RoomState } from '../types.ts'
import { releasedReports, reportSource } from '../release-preview.ts'

export interface SpeechCause {
  /** `followUp`/`followUpLost`: a follow-up report on a background task (member-self-started-rounds A④/C②). */
  readonly kind: 'task' | 'notify' | 'report' | 'followUp' | 'followUpLost'
  /** Who sent it (reporters, joined, for a release round). */
  readonly member: string
  /** The message text, for 派活/告知; a release round's carried reports' openings. */
  readonly text?: string
  /** The row a click scrolls to: a member message row, or the reporter's reply. */
  readonly target?: string
}

/**
 * @param runId - the speech's run id.
 * @param state - the room state (deliveries, roster).
 * @returns the cause, or undefined for a human-started (or unknown) round.
 */
export function speechCause(runId: string | undefined, state: RoomState | undefined): SpeechCause | undefined {
  if (runId === undefined || state === undefined) return undefined
  const deliveries = state.deliveries ?? []
  const row = deliveries.find(entry => entry.id === runId)
  if (row === undefined) return undefined
  const name = (id: string): string | undefined => state.members.find(member => member.id === id)?.name
  if (row.origin === 'coordinator' || row.origin === 'member' || row.origin === 'relay') {
    const member = row.from === undefined ? undefined : name(row.from)
    if (member === undefined) return undefined
    return {
      kind: row.kind === 'notify' ? 'notify' : 'task', member, text: row.text,
      // The native main agent's sends have no row of their own (its tool call shows).
      ...row.from?.startsWith('legacy:') === true ? {} : { target: `[data-room-dispatch="${row.dispatchSeq}"]` },
    }
  }
  if (row.origin !== 'report') return undefined
  // A release round hands over the reports the gate held for this member.
  const released = releasedReports(state, row)
  const reports = row.releases === undefined ? [row] : released.map(report => report.row)
  const sources = reports.map(entry => reportSource(entry, state)).filter(source => source !== undefined)
  const names = [...new Set(sources.map(source => name(source.id)).filter(member => member !== undefined))]
  if (names.length === 0) return undefined
  // A follow-up on its own (not folded into a release round) says so.
  const followUp = row.releases === undefined && row.followUpOf !== undefined
  const kind = !followUp ? 'report' : sources[0]?.lost === true ? 'followUpLost' : 'followUp'
  // A release round hands over reports from long ago: say what they were.
  const carried = released.map(report => report.opening).filter(opening => opening !== '')
  return { kind, member: names.join('、'), target: `[data-room-run="${sources[0]!.runId}"]`, ...carried.length === 0 ? {} : { text: carried.join(' / ') } }
}

/**
 * Scroll a room row into view and flash it briefly.
 * @param selector - the row's attribute selector.
 */
export function revealRoomRow(selector: string): void {
  const element = document.querySelector<HTMLElement>(selector)
  if (element === null) return
  element.scrollIntoView({ block: 'center', behavior: 'smooth' })
  element.setAttribute('data-flash', '')
  setTimeout(() => { element.removeAttribute('data-flash') }, 1200)
}
