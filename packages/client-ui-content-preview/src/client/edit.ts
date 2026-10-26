/**
 * The content pane's edit plane: the draft record, its per-(session,path)
 * memory, and the line-ending round-trip a `<textarea>` forces.
 *
 * A textarea's value normalizes every CRLF to LF, so the editor works on LF
 * text and the save restores the file's own convention — otherwise opening and
 * saving a Windows-style file would rewrite every line.
 *
 * Drafts live at module level, like the scroll offsets: switching to another
 * file (or another tab that unmounts the pane) and back finds the unsaved
 * draft and its base where it was left, instead of either blocking the switch
 * or silently dropping the edit.
 *
 * @module @khorsheed/dsh-client-ui-content-preview
 */

/** One in-progress edit. */
export interface Draft {
  /** The editor text (LF line endings). */
  readonly text: string
  /** The read content the edit started from — the save's conflict anchor.
   * Pinned at edit entry, so a reload mid-edit never moves it: saving over a
   * file that changed since then must surface as a conflict. */
  readonly base: string
}

const drafts = new Map<string, Draft>()

/** The draft saved under `key`, if any. */
export function draftFor(key: string): Draft | undefined {
  return drafts.get(key)
}

/** Remember (or, with null, forget) the draft under `key`. */
export function rememberDraft(key: string, draft: Draft | null): void {
  if (draft === null) drafts.delete(key)
  else drafts.set(key, draft)
}

/** The text a textarea shows for `content` (CRLF folded to LF, as the element would). */
export function toEditorText(content: string): string {
  return content.replace(/\r\n/g, '\n')
}

/**
 * The text to write for an editor value, in the line-ending convention of the
 * content the edit started from: a base carrying CRLF gets CRLF back.
 * @param text - the editor value (LF).
 * @param base - the content the edit started from.
 * @returns the content to save.
 */
export function fromEditorText(text: string, base: string): string {
  return base.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text
}

/** Whether the draft differs from the content it started from. */
export function isDirty(draft: Draft): boolean {
  return draft.text !== toEditorText(draft.base)
}
