/**
 * Withdrawal planning: a pure fold from the session log and the live surface
 * to the replacement intent. Kept free of cordis and Session internals so the
 * unit tests drive it directly; the service only validates and appends.
 * @module @khorsheed/dsh-client-message-tools/withdraw
 */
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  RESTORED_ASSISTANT_NOTICE,
  isMessageToolsEdit, isMessageToolsReplacement, isMessageToolsRestore, isMessageToolsRestoreAssistant,
} from './marker.ts'

/**
 * Whether a target seq names an editable user message: an append-surface
 * user-source message (an original), a message-tools restore replay (a
 * restored row withdraws and edits like the message it replays), or a
 * message-tools edit replacement (edit chains — the previous edit's
 * replacement is the surface node). Assistant-text restore replays carry no
 * actions and are excluded.
 */
function isEditableTarget(event: SessionEvent | undefined): event is SessionEvent<'user/message'> {
  if (event === undefined || event.type !== 'user/message') return false
  if (isAppendSurfaceEvent(event)) {
    return event.data.source.kind === 'user' || isMessageToolsRestore(event)
  }
  return isMessageToolsEdit(event)
}

/** The span [target, surface tail] with full provenance, or undefined when off-surface. */
function surfaceSpan(
  surfaceNodes: readonly number[],
  targetSeq: number,
): { start: number; end: number; sourceEventSeqs: number[] } | undefined {
  const startIndex = surfaceNodes.indexOf(targetSeq)
  if (startIndex === -1) return undefined
  const sourceEventSeqs = surfaceNodes.slice(startIndex)
  const end = sourceEventSeqs[sourceEventSeqs.length - 1]
  /* v8 ignore next -- the slice is non-empty by construction (startIndex names a member) */
  if (end === undefined) return undefined
  return { start: targetSeq, end, sourceEventSeqs }
}

/** Why a withdrawal cannot be planned. */
export type WithdrawalPlanFailure =
  | 'target-not-found'
  | 'not-a-user-message'
  | 'already-withdrawn'
/** The validated replacement intent for one withdrawal. */
export interface WithdrawalPlan {
  /** Seq of the withdrawn user message (a current surface node). */
  readonly start: number
  /** Seq of the last current surface node; the span replaces [start, end]. */
  readonly end: number
  /** Every shadowed surface node, in surface order (surface validation requires the complete set). */
  readonly sourceEventSeqs: readonly number[]
}

/** Planning outcome: a replacement intent or a failure code. */
export type WithdrawalPlanResult =
  | { readonly ok: true; readonly plan: WithdrawalPlan }
  | { readonly ok: false; readonly code: WithdrawalPlanFailure }

/**
 * Plan a withdrawal: the target must be an editable user message (original,
 * restore replay, or edit replacement — see `isEditableTarget`) still present
 * on the live surface; the span covers it and every surface node after it.
 * @param events - the full session log (seq === index).
 * @param surfaceNodes - the current model-visible surface seqs, in order.
 * @param targetSeq - seq of the user message to withdraw.
 * @returns the replacement intent, or the failure code.
 */
export function planWithdrawal(
  events: readonly SessionEvent[],
  surfaceNodes: readonly number[],
  targetSeq: number,
): WithdrawalPlanResult {
  const target = events[targetSeq]
  if (target === undefined) return { ok: false, code: 'target-not-found' }
  if (!isEditableTarget(target)) {
    return { ok: false, code: 'not-a-user-message' }
  }
  const span = surfaceSpan(surfaceNodes, targetSeq)
  if (span === undefined) return { ok: false, code: 'already-withdrawn' }
  return { ok: true, plan: span }
}

/** Why an edit cannot be planned. */
export type EditPlanFailure =
  | 'target-not-found'
  | 'not-a-user-message'
  | 'already-withdrawn'
  | 'empty-text'

/** Planning outcome: a replacement intent or a failure code. */
export type EditPlanResult =
  | { readonly ok: true; readonly plan: WithdrawalPlan }
  | { readonly ok: false; readonly code: EditPlanFailure }

/**
 * Plan an edit: the target must be an editable user message still present on
 * the live surface, and the new text must be non-blank. The span covers the
 * target and every surface node after it — editing an old message discards
 * what followed it. The replacement's content is the new text (no
 * placeholder), so the model context reads the edited message in place.
 * @param events - the full session log (seq === index).
 * @param surfaceNodes - the current model-visible surface seqs, in order.
 * @param targetSeq - seq of the user message to edit.
 * @param text - the edited text.
 * @returns the replacement intent, or the failure code.
 */
export function planEdit(
  events: readonly SessionEvent[],
  surfaceNodes: readonly number[],
  targetSeq: number,
  text: string,
): EditPlanResult {
  if (text.trim() === '') return { ok: false, code: 'empty-text' }
  const target = events[targetSeq]
  if (target === undefined) return { ok: false, code: 'target-not-found' }
  if (!isEditableTarget(target)) {
    return { ok: false, code: 'not-a-user-message' }
  }
  const span = surfaceSpan(surfaceNodes, targetSeq)
  if (span === undefined) return { ok: false, code: 'already-withdrawn' }
  return { ok: true, plan: span }
}

/** Why a restore cannot be planned. */
export type RestorePlanFailure =
  | 'target-not-found'
  | 'not-a-user-message'
  | 'not-withdrawn'

/**
 * One replayed entry of a restored span, in original order. User entries
 * replay content blocks verbatim (originals, edit replacements — whose
 * content IS the last edit's new text — and earlier restore replays);
 * assistant entries carry the reply's joined text, framed for the model.
 */
export type RestoreReplayEntry =
  | {
    readonly role: 'user'
    /** The entry's content blocks, replayed verbatim. */
    readonly content: SessionEvent<'user/message'>['data']['content']
    /** Seq of the original event this entry replays. */
    readonly sourceSeq: number
  }
  | {
    readonly role: 'assistant'
    /** The model-facing text (frame included — see RESTORED_ASSISTANT_NOTICE). */
    readonly text: string
    /** Seq of the original event this entry replays. */
    readonly sourceSeq: number
  }

/** The validated restore intent for one withdrawn message. */
export interface RestorePlan {
  /**
   * Every replayable entry of the withdrawn span, in original (surface)
   * order; the host appends them back-to-back at the tail. Never empty: the
   * target message itself always replays. Tool calls/results never replay —
   * the call/result pairing cannot be re-entered and their side effects are
   * not replayable; the assistant text already summarizes them.
   */
  readonly entries: readonly RestoreReplayEntry[]
}

/** Restore planning outcome: a restore intent or a failure code. */
export type RestorePlanResult =
  | { readonly ok: true; readonly plan: RestorePlan }
  | { readonly ok: false; readonly code: RestorePlanFailure }

/** Join the text blocks of one message's content into one plain string. */
function joinText(blocks: readonly unknown[]): string {
  return blocks
    .filter((block): block is { type: string; text: string } =>
      (block as { type?: string; text?: string }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string')
    .map(block => block.text)
    .join('')
}

/**
 * The shadowed seqs of the latest message-tools withdrawal replacement citing
 * `targetSeq`, or undefined when no such replacement exists (the message left
 * the surface through another producer, e.g. compaction). The replacement's
 * `sourceEventSeqs` is the span's authoritative boundary — never re-derived.
 */
function findWithdrawnSpan(
  events: readonly SessionEvent[],
  targetSeq: number,
): readonly number[] | undefined {
  for (let index = events.length - 1; index > targetSeq; index--) {
    const event = events[index]
    if (event !== undefined && isMessageToolsReplacement(event) && event.sourceEventSeqs?.includes(targetSeq)) {
      return event.sourceEventSeqs
    }
  }
  return undefined
}

/**
 * Fold one withdrawn span into its replay entries, in span (original) order.
 * Replayed: user-source messages, edit replacements (their content is the
 * last edit's new text), earlier restore replays, and assistant text (framed;
 * restore-assistant replays already carry the frame). Skipped: withdrawal
 * placeholders, edit triggers, other plugin context, and tool calls/results.
 */
function replayEntries(
  events: readonly SessionEvent[],
  spanSeqs: readonly number[],
): RestoreReplayEntry[] {
  const entries: RestoreReplayEntry[] = []
  for (const seq of spanSeqs) {
    const event = events[seq]
    if (event === undefined) continue
    if (isMessageToolsEdit(event)) {
      entries.push({ role: 'user', content: event.data.content, sourceSeq: seq })
      continue
    }
    if (event.type === 'user/message') {
      if (event.surfaceOp !== 'append') continue
      if (event.data.source.kind === 'user' || isMessageToolsRestore(event)) {
        entries.push({ role: 'user', content: event.data.content, sourceSeq: seq })
      } else if (isMessageToolsRestoreAssistant(event)) {
        entries.push({ role: 'assistant', text: joinText(event.data.content), sourceSeq: seq })
      }
      continue
    }
    if (event.type === 'assistant/message') {
      const text = joinText(event.data.message.content)
      if (text !== '') {
        entries.push({ role: 'assistant', text: `${RESTORED_ASSISTANT_NOTICE}\n${text}`, sourceSeq: seq })
      }
    }
  }
  return entries
}

/**
 * Plan a restore: the target must be an editable user message (the same
 * vocabulary as withdrawal — original, restore replay, or edit replacement)
 * that is no longer on the live surface (i.e. withdrawn). Restoring an edit
 * replacement replays the span's last edit text — the replacement's content
 * IS the new text. The surface model is positional — a replaced span folds
 * into exactly one node — so the withdrawn span can never be put back in
 * place; restore replays the span's replayable content (user messages, the
 * last edit's new text, assistant text) as fresh tail messages in original
 * order. When no message-tools replacement cites the target (a foreign
 * shadowing, e.g. compaction), only the target message replays — the span
 * boundary is never re-guessed.
 * @param events - the full session log (seq === index).
 * @param surfaceNodes - the current model-visible surface seqs.
 * @param targetSeq - seq of the withdrawn user message to restore.
 * @returns the restore intent, or the failure code.
 */
export function planRestore(
  events: readonly SessionEvent[],
  surfaceNodes: readonly number[],
  targetSeq: number,
): RestorePlanResult {
  const target = events[targetSeq]
  if (target === undefined) return { ok: false, code: 'target-not-found' }
  if (!isEditableTarget(target)) return { ok: false, code: 'not-a-user-message' }
  if (surfaceNodes.includes(targetSeq)) return { ok: false, code: 'not-withdrawn' }
  const span = findWithdrawnSpan(events, targetSeq)
  const entries: RestoreReplayEntry[] = span === undefined
    ? [{ role: 'user', content: target.data.content, sourceSeq: targetSeq }]
    : replayEntries(events, span)
  return { ok: true, plan: { entries } }
}
