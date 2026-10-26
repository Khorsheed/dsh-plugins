/**
 * Composer-draft backfill for the withdrawal divider's「重新编辑」action: the
 * withdrawn span's first user message text is written into the session's
 * composer draft (never auto-sent — the user edits and sends through the
 * official pipeline as a fresh ordinary message, decoupled from the
 * withdrawal history). Kept free of services so the unit tests drive it
 * directly.
 * @module
 */

/**
 * Merge the backfill text into the current draft: an empty (or blank) draft
 * is filled directly; a non-empty draft gets the text appended on a new line
 * — the user's in-progress input is never silently overwritten.
 * @param current - the current composer draft.
 * @param text - the withdrawn message's original text.
 * @returns the next draft.
 */
export function mergedDraft(current: string, text: string): string {
  return current.trim() === '' ? text : `${current}\n${text}`
}
