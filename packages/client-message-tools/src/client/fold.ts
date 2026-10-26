/**
 * Long user messages fold: a message past {@link FOLD_CHARS} characters or
 * {@link FOLD_LINES} lines starts clamped, except the session's newest user
 * message (what the human just sent stays readable while it is answered; it
 * folds once the next one arrives). The human's own expand/collapse wins and
 * is remembered per message in browser storage — a per-viewer convenience:
 * unreadable storage only means the default applies.
 */
import type { ChatSlice } from './chat-hook.ts'

/** Characters past which a message folds (roughly ten rendered lines). */
export const FOLD_CHARS = 600
/** Lines past which a message folds even when short in characters. */
export const FOLD_LINES = 12

/** The kinds that render as the human's own message bubble. */
const USER_KINDS = new Set(['user', 'steering', 'message-tools-edited', 'message-tools-restored'])

/** Whether a message's text is long enough to fold. */
export function foldable(text: string): boolean {
  return text.length > FOLD_CHARS || text.split('\n').length > FOLD_LINES
}

/** Selector: the newest user message's seq (-1 when none). Module-level so uSES memoization holds. */
export function selectNewestUserSeq(chat: ChatSlice): number {
  let newest = -1
  for (const node of chat.nodes.values()) {
    const seq = (node as { readonly data?: { readonly seq?: unknown } }).data?.seq
    if (USER_KINDS.has(node.kind) && typeof seq === 'number' && seq > newest) newest = seq
  }
  return newest
}

const KEY_PREFIX = 'dsh-message-tools:fold:'
/** Choices kept per session (newest messages win): bounds the stored map. */
const KEEP = 200

/** The human's remembered expand/collapse choices, by message seq. */
export const foldChoices = {
  read(sessionId: string): Record<string, boolean> {
    try {
      const raw = globalThis.localStorage?.getItem(KEY_PREFIX + sessionId)
      const parsed: unknown = raw == null ? undefined : JSON.parse(raw)
      return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, boolean> : {}
    } catch { return {} }
  },
  write(sessionId: string, seq: number, expanded: boolean): void {
    try {
      const choices = { ...foldChoices.read(sessionId), [String(seq)]: expanded }
      const kept = Object.keys(choices).map(Number).sort((a, b) => b - a).slice(0, KEEP)
      globalThis.localStorage?.setItem(KEY_PREFIX + sessionId, JSON.stringify(Object.fromEntries(kept.map(key => [key, choices[key]]))))
    } catch { /* a convenience: never fail the view */ }
  },
}
