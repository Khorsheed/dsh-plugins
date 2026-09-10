/**
 * Dual-arm session history loader for the job detail tab.
 *
 * The tab's seam probes capability instead of version-sniffing: the generated
 * session remote (`remote.session.follow`/`page` — the follow stream's
 * opening snapshot is the only source of the log cut the page RPC requires)
 * when mounted, the payload-direct `connection.api.sessions.history`
 * otherwise. Each arm keeps its own unwrapping: remote pages carry
 * `SessionHistoryRecord[]` (raw events plus packed chunk runs, both
 * `{seq, time, type, data}` under `.event`), the connection arm answers
 * `HistoryEntry[]` (`{ event }` wrappers). Every failure mode resolves
 * undefined so the tab degrades to its error row, never a throw.
 *
 * @module dsh-taskpilot/client/history-loader
 */

import type { SessionAddress, SessionHistoryRecord, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { HistoryPage } from './JobTab.tsx'
import type { SessionLogRow } from './job-trajectory.ts'

/** The detail tab's history channel signature. */
export type LoadHistory = (
  sessionId: SessionId,
  beforeSeq: number | undefined,
  maxMessages: number,
) => Promise<HistoryPage | undefined>

/** Structural alpha face: the generated session remote's two history methods. */
interface SessionRemoteLike {
  follow(
    request: { readonly address: SessionAddress; readonly maxMessages?: number },
    signal?: AbortSignal,
  ): AsyncIterable<{
    readonly type: string
    readonly cursor?: number
    readonly records?: readonly SessionHistoryRecord[]
    readonly hasMore?: boolean
  }>
  page(
    request: {
      readonly address: SessionAddress
      readonly throughSeq: number
      readonly beforeSeq?: number
      readonly maxMessages?: number
    },
    signal?: AbortSignal,
  ): Promise<{
    readonly ok: boolean
    readonly value?: { readonly records: readonly SessionHistoryRecord[]; readonly hasMore: boolean }
  }>
}

/**
 * Structural rc.2 face: `ConnectionHandle.api.sessions.history`, retired in
 * 0.1.2-alpha.1 together with the whole `api` field — hence optional.
 */
interface LegacyHistoryConnection {
  readonly api?: {
    readonly sessions: {
      history(payload: {
        readonly sessionId: SessionId
        readonly beforeSeq?: number
        readonly maxMessages?: number
      }): Promise<{
        readonly result: {
          readonly ok: boolean
          readonly value?: { readonly events: readonly { readonly event: unknown }[]; readonly hasMore: boolean }
        }
      }>
    }
  }
}

/** Unwrap alpha history records into the fold's narrow row shape. */
function unwrapRecords(records: readonly SessionHistoryRecord[]): SessionLogRow[] {
  return records.map(record => record.event as unknown as SessionLogRow)
}

/** Alpha arm helper: the follow stream's opening snapshot, then abort. */
async function followTail(
  session: SessionRemoteLike,
  address: SessionAddress,
  maxMessages: number,
): Promise<{ readonly cursor: number; readonly page: HistoryPage } | undefined> {
  const controller = new AbortController()
  try {
    for await (const frame of session.follow({ address, maxMessages }, controller.signal)) {
      if (frame.type !== 'snapshot') continue
      return {
        cursor: frame.cursor ?? -1,
        page: { events: unwrapRecords(frame.records ?? []), hasMore: frame.hasMore === true },
      }
    }
    return undefined
  } catch {
    return undefined
  } finally {
    controller.abort()
  }
}

/**
 * Build the detail tab's history loader for the host face actually mounted.
 * @param sessionRemote - `ctx.get('remote.session')` (hosts with the generated
 *   session remote mount follow/page; older ones resolve undefined).
 * @param connection - `ctx.get('connection')` (either face; the legacy line carries `api`).
 * @returns the loader; with neither face present it resolves undefined.
 */
export function createHistoryLoader(sessionRemote: unknown, connection: unknown): LoadHistory {
  // Capability probe, not a version check: the session remote mounts follow on
  // the namespace; the legacy connection keeps the payload-direct api client.
  const session = sessionRemote as SessionRemoteLike | null | undefined
  if (typeof session?.follow === 'function') {
    // Log cuts captured from follow snapshots: the page RPC's throughSeq is the
    // "inclusive log cut obtained from the corresponding follow opening frame",
    // so the first (tail) read seeds it and older pages reuse it.
    const cuts = new Map<SessionId, number>()
    return async (sessionId, beforeSeq, maxMessages) => {
      const address: SessionAddress = { kind: 'session', sessionId }
      if (beforeSeq === undefined) {
        const tail = await followTail(session, address, maxMessages)
        if (tail === undefined) return undefined
        cuts.set(sessionId, tail.cursor)
        return tail.page
      }
      let cut = cuts.get(sessionId)
      if (cut === undefined) {
        // Older page requested without a tail read (a tab re-navigation raced):
        // a one-message snapshot relearns the cut.
        const tail = await followTail(session, address, 1)
        if (tail === undefined) return undefined
        cuts.set(sessionId, tail.cursor)
        cut = tail.cursor
      }
      try {
        const result = await session.page({ address, throughSeq: cut, beforeSeq, maxMessages })
        return result.ok && result.value !== undefined
          ? { events: unwrapRecords(result.value.records), hasMore: result.value.hasMore }
          : undefined
      } catch {
        return undefined
      }
    }
  }
  const api = (connection as LegacyHistoryConnection | null | undefined)?.api
  if (api === undefined) return async () => undefined
  return async (sessionId, beforeSeq, maxMessages) => {
    try {
      const payload = beforeSeq === undefined ? { sessionId, maxMessages } : { sessionId, beforeSeq, maxMessages }
      const response = await api.sessions.history(payload)
      const value = response.result.value
      return response.result.ok && value !== undefined
        ? { events: value.events.map(entry => entry.event as SessionLogRow), hasMore: value.hasMore }
        : undefined
    } catch {
      return undefined
    }
  }
}
