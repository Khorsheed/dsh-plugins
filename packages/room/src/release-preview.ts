/**
 * What a release round carries: the reports the gate held for its recipient
 * (the dispatch's `releases` seqs), read back from the room state. The
 * release dispatch's own text is only the trailer the model needs
 * (「以上 N 条回报一直等着交给你…」); the held reports' bodies are prepended
 * when the prompt is built. Every place that previews a release — the core
 * queue row's `preview` (the members page's 「来自协作间：…」), the reply's
 * cause line, the team view — reads what it carries here instead.
 * Pure: the client bundle imports this module.
 * @module @khorsheed/dsh-room/release-preview
 */
import type { RoomDelivery, RoomState } from './types.ts'

/** Characters of a held report's opening kept for a preview. */
const OPENING_CHARS = 80

/**
 * The reporter's member id and the run a click scrolls to, off a report
 * delivery. A delivery's report names its run (`<seq>:<memberId>`); a
 * follow-up names the round the member's CLI opened on its own
 * (`execution:<id>`, the member read off that run) or a lost task
 * (`background-task:<memberId>:<taskId>`, no round: the original delivery
 * is the target).
 * @param row - a report delivery.
 * @param state - the room state.
 * @returns the reporter, or undefined when the report names none.
 */
export function reportSource(row: RoomDelivery, state: RoomState): { readonly id: string; readonly runId: string; readonly lost?: true } | undefined {
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

/** One report a release round hands over. */
export interface ReleasedReport {
  /** The held report's own delivery. */
  readonly row: RoomDelivery
  /** The reporting member's name, when the roster still knows it. */
  readonly member?: string
  /** The report's opening, on one line. */
  readonly opening: string
}

/**
 * The held reports a release round hands over, in its `releases` order.
 * @param state - the room state.
 * @param release - the release round's delivery (`releases` set).
 * @returns the reports; empty for any other delivery.
 */
export function releasedReports(state: RoomState, release: RoomDelivery): readonly ReleasedReport[] {
  if (release.releases === undefined) return []
  const deliveries = state.deliveries ?? []
  return release.releases.flatMap((seq) => {
    const row = deliveries.find(entry => entry.dispatchSeq === seq && entry.memberId === release.memberId)
    if (row === undefined) return []
    const source = reportSource(row, state)
    const member = source === undefined ? undefined : state.members.find(entry => entry.id === source.id)?.name
    const flat = row.text.replace(/\s+/g, ' ').trim()
    const opening = flat.length > OPENING_CHARS ? `${flat.slice(0, OPENING_CHARS)}…` : flat
    return [{ row, opening, ...member === undefined ? {} : { member } }]
  })
}

/**
 * A release round's one-line preview: 「补交回报：招摇构筑师 · 四地区交付…」,
 * several 「补交 2 条回报：招摇构筑师、地图匠」.
 * @param state - the room state.
 * @param release - the release round's delivery.
 * @returns the preview, or undefined when it carries nothing the state still knows.
 */
export function releasePreview(state: RoomState, release: RoomDelivery): string | undefined {
  const reports = releasedReports(state, release)
  if (reports.length === 0) return undefined
  if (reports.length === 1) {
    const [report] = reports
    return `补交回报：${[report!.member, report!.opening].filter(part => part !== undefined && part !== '').join(' · ')}`
  }
  const names = [...new Set(reports.map(report => report.member).filter(name => name !== undefined))]
  return `补交 ${reports.length} 条回报${names.length === 0 ? '' : `：${names.join('、')}`}`
}
