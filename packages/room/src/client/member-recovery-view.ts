/**
 * The edit dialog's recovery block as a pure state: what local-agent knows
 * about a CLI member that cannot take work right now — its last native start
 * failed (the member's configuration control is `failed`), or a host restart
 * left one of its executions with an unknown outcome (an `uncertain` ledger
 * row) — folded into what the block shows. Kept apart from the component so
 * every state is testable without rendering.
 *
 * Read through local-agent's gateway (`memberConfiguration` and
 * `memberInbox`), duck-typed: a composition without the family, or an older
 * core, answers undefined and the block never shows.
 */
import type { LocalAgentMemberControlState, LocalAgentMemberInbox } from '@khorsheed/dsh-local-agent/types'

/** What the dialog reads for one member (either half may be missing). */
export interface MemberRecoveryRead {
  readonly configuration?: LocalAgentMemberControlState | undefined
  readonly inbox?: LocalAgentMemberInbox | undefined
}

/** One execution a restart interrupted, waiting for the human's verdict. */
export interface MemberRecoveryUncertain {
  readonly id: string
  /** Who asked for it: the members page, the room, a host session's tool call, a plugin, the CLI itself. */
  readonly caller: 'composer' | 'room' | 'tool' | 'api' | 'cli'
  /** What was typed (members-page input only). */
  readonly text?: string
}

export interface MemberRecoveryState {
  /**
   * The member's configuration control failed. `cause`: a native start (or
   * a refused admission: nothing waits in place), or a model/effort choice
   * that did not apply (it stays pending). `revision` is what a retry names.
   */
  readonly failed?: { readonly cause: 'start' | 'selection'; readonly reason: string; readonly revision: number }
  /** Executions a restart left with an unknown outcome (they block the member). */
  readonly uncertain: readonly MemberRecoveryUncertain[]
}

/**
 * Fold the reads into the block's state.
 * @param read - the gateway's answers; undefined = nothing known.
 * @returns the state; `undefined` when there is nothing to recover.
 */
export function memberRecovery(read: MemberRecoveryRead | undefined): MemberRecoveryState | undefined {
  const control = read?.configuration
  const failed = control?.status === 'failed'
    ? { cause: control.pending === undefined ? 'start' as const : 'selection' as const, reason: plainReason(control.error), revision: control.revision }
    : undefined
  const uncertain = (read?.inbox?.messages ?? [])
    .filter(row => row.status === 'uncertain')
    .map(row => ({ id: row.id, caller: row.caller ?? 'composer', ...row.text === undefined ? {} : { text: row.text } }))
  if (failed === undefined && uncertain.length === 0) return undefined
  return { ...failed === undefined ? {} : { failed }, uncertain }
}

/**
 * The reason as the user reads it after 「上次启动没有成功：」: the
 * provider's own sentence, without a leading `Error:` and trimmed to one
 * short paragraph. Empty → undefined-safe placeholder handled by the caller.
 * @param error - the control's stored error.
 * @returns the sentence.
 */
export function plainReason(error: string | undefined): string {
  // Drop a leading `Error:` and a provider's own channel prefix
  // ("subagent-kimi live: "): the user reads the sentence, not the plumbing.
  const text = (error ?? '').replace(/^(?:\w*Error:\s*)+/, '').replace(/^subagent-[\w-]+(?: live)?:\s*/, '').trim()
  return text.length > 280 ? `${text.slice(0, 279)}…` : text
}
