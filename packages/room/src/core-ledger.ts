/**
 * The local-agent core's per-member execution ledger, as the room reads it
 * (batch 5 S7). Since S7 the ledger is the only queue a CLI member's rounds
 * pass through, and the only place that says what became of a round a
 * restart cut off: `uncertain` until someone reconciles it, in the room, on
 * the members page or in the member edit dialog — all three settle the same
 * ledger row (user decision 2026-11-03 ③). The room never guesses an outcome
 * for an execution the core knows; it journals what the core says.
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

  /** Whether the member's input queue is paused after a restart (typed input waits in the member session). */
  paused(childSessionId: string | undefined): boolean {
    return this.inbox(childSessionId)?.paused === true
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

  /** Whether the member has an execution with an unknown outcome: the core admits nothing else of it until that is reconciled. */
  uncertain(childSessionId: string | undefined): boolean {
    return this.rows(childSessionId)?.some(row => row.status === 'uncertain') === true
  }
}

/**
 * Settle a member's uncertain execution in the core (`reconcileExecution`).
 * A row that is not uncertain any more (reconciled elsewhere meanwhile) is
 * left alone: the same finding is not recorded twice.
 * @returns undefined on success (or nothing to do), else why it failed.
 */
export function reconcileCore(facade: LocalAgentFacade | undefined, childSessionId: string, row: CoreRow | undefined, outcome: CoreOutcome, evidence: string): string | undefined {
  if (row?.status !== 'uncertain' || facade?.reconcileExecution === undefined) return undefined
  try {
    facade.reconcileExecution(childSessionId, row.id, outcome, evidence)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
