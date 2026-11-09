/**
 * The local-agent core's per-member execution ledger, as the room reads it
 * (batch 5 S7). Since S7 the ledger is the only queue a CLI member's rounds
 * pass through, and the place that says what became of each round. A round
 * a restart cut off reads closed as interrupted (`cancelled` +
 * `interrupted: 'restart'`; an older core said `uncertain`) — see
 * {@link coreInterrupted} (restart-recovery consolidation). The room never
 * guesses an outcome for an execution the core knows; it journals what the
 * core says.
 *
 * Reads are optional: without the core, or with a core older than the
 * ledger, every lookup answers `undefined` and the caller keeps the room's
 * pre-S7 verdict.
 * @module @khorsheed/dsh-room/core-ledger
 */
import type { LocalAgentMemberInput } from '@khorsheed/dsh-local-agent/types'
import type { LocalAgentFacade } from './adapter.ts'

/** One ledger row (an execution of a member, whoever submitted it). */
export type CoreRow = LocalAgentMemberInput

/** The core statuses that are an outcome (journaled by the room as such). */
export type CoreOutcome = 'done' | 'failed' | 'cancelled'

/** Whether a row's status is an outcome. */
export function isCoreOutcome(status: CoreRow['status']): status is CoreOutcome {
  return status === 'done' || status === 'failed' || status === 'cancelled'
}

/**
 * Whether the core says a host restart cut this row off: closed as
 * interrupted, or left `uncertain` by an older core (read by data).
 */
export function coreInterrupted(row: CoreRow | undefined): boolean {
  return row !== undefined && (row.interrupted === 'restart' || row.status === 'uncertain')
}

/**
 * The ledgers of a room's members, read once per pass (a recovery pass, one
 * `getState` projection). A member the core does not know (never ran, no
 * prepared identity) or an unreadable ledger reads as `undefined`.
 */
export class CoreLedgers {
  private readonly cache = new Map<string, { readonly rows: readonly CoreRow[]; readonly paused: boolean } | undefined>()

  constructor(private readonly facade: LocalAgentFacade | undefined) {}

  /** Whether the core's ledger can be read at all (a core with the S4 ledger). */
  get readable(): boolean { return this.facade?.readMemberInbox !== undefined }

  /** The member's rows, or undefined when the core cannot say. */
  rows(childSessionId: string | undefined): readonly CoreRow[] | undefined {
    return this.inbox(childSessionId)?.rows
  }

  /**
   * Whether the member's input queue is paused with typed input waiting in
   * the member session (members page): the operator's own pause. (An older
   * core also paused every ledger at boot after a restart; only a queued
   * composer row behind the flag is input the human still has to decide on.)
   */
  paused(childSessionId: string | undefined): boolean {
    const inbox = this.inbox(childSessionId)
    return inbox?.paused === true && inbox.rows.some(row => row.status === 'queued' && row.caller === 'composer')
  }

  private inbox(childSessionId: string | undefined): { readonly rows: readonly CoreRow[]; readonly paused: boolean } | undefined {
    if (childSessionId === undefined || this.facade?.readMemberInbox === undefined) return undefined
    if (this.cache.has(childSessionId)) return this.cache.get(childSessionId)
    let inbox: { readonly rows: readonly CoreRow[]; readonly paused: boolean } | undefined
    try {
      const read = this.facade.readMemberInbox(childSessionId)
      inbox = { rows: read.messages, paused: read.paused === true }
    } catch { inbox = undefined }
    this.cache.set(childSessionId, inbox)
    return inbox
  }

  /**
   * One execution's row: by its execution id when the room recorded one, else
   * by the room's idempotency key (a delivery id).
   */
  find(childSessionId: string | undefined, key: string | undefined, executionId?: string): CoreRow | undefined {
    const rows = this.rows(childSessionId)
    if (rows === undefined) return undefined
    return (executionId === undefined ? undefined : rows.find(row => row.id === executionId))
      ?? (key === undefined ? undefined : rows.find(row => row.key === key))
  }
}
