/**
 * What started a member's round, for the 「回应 X 的…」 line on its reply:
 * the delivery the round ran (its run id IS the delivery id,
 * `<dispatchSeq>:<memberId>`). The human's own messages need no line — the
 * message sits right above — and neither do help requests (their own rows).
 * @module @khorsheed/dsh-room/client/speech-cause
 */
import type { RoomDelivery, RoomState } from '../types.ts'

export interface SpeechCause {
  /** `followUp`/`followUpLost`: a follow-up report on a background task (member-self-started-rounds A④/C②). */
  readonly kind: 'task' | 'notify' | 'report' | 'followUp' | 'followUpLost'
  /** Who sent it (reporters, joined, for a release round). */
  readonly member: string
  /** The message text, for 派活/告知. */
  readonly text?: string
  /** The row a click scrolls to: a member message row, or the reporter's reply. */
  readonly target?: string
}

/**
 * The reporter's member id and the run a click scrolls to, off a report
 * delivery. A delivery's report names its run (`<seq>:<memberId>`); a
 * follow-up names the round the member's CLI opened on its own
 * (`execution:<id>`, the member read off that run) or a lost task
 * (`background-task:<memberId>:<taskId>`, no round: the original delivery
 * is the target).
 */
function reporter(row: RoomDelivery, state: RoomState): { readonly id: string; readonly runId: string; readonly lost?: true } | undefined {
  const runId = row.reportFor
  if (runId === undefined) return undefined
  if (runId.startsWith('execution:')) {
    const id = state.executions?.find(entry => entry.id === runId)?.memberId
      ?? (row.followUpOf === undefined ? undefined : row.followUpOf.slice(row.followUpOf.indexOf(':') + 1))
    return id === undefined ? undefined : { id, runId }
  }
  if (runId.startsWith('background-task:')) {
    const rest = runId.slice('background-task:'.length)
    const id = rest.slice(0, Math.max(0, rest.lastIndexOf(':')))
    return id === '' ? undefined : { id, runId: row.followUpOf ?? runId, lost: true }
  }
  const at = runId.indexOf(':')
  return at < 0 ? undefined : { id: runId.slice(at + 1), runId }
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
  const reports = row.releases === undefined
    ? [row]
    : row.releases.flatMap(seq => deliveries.filter(entry => entry.dispatchSeq === seq && entry.memberId === row.memberId))
  const sources = reports.map(entry => reporter(entry, state)).filter(source => source !== undefined)
  const names = [...new Set(sources.map(source => name(source.id)).filter(member => member !== undefined))]
  if (names.length === 0) return undefined
  // A follow-up on its own (not folded into a release round) says so.
  const followUp = row.releases === undefined && row.followUpOf !== undefined
  const kind = !followUp ? 'report' : sources[0]?.lost === true ? 'followUpLost' : 'followUp'
  return { kind, member: names.join('、'), target: `[data-room-run="${sources[0]!.runId}"]` }
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
