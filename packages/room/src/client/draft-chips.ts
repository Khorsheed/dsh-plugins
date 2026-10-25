/**
 * Reference chips in the room composer's plain textarea. The draft lives in
 * the session's official input machine (RoomComposer's module header), whose
 * `draft` is the CLIPBOARD projection — each chip expanded to the full text
 * it sends (a quote chip: its whole `> ` block). A textarea showing that
 * projection shows raw wire text, and editing it through `setDraft` flattens
 * every chip. So the composer shows chips as their own row and the textarea
 * only the typed text BETWEEN them; an edit is mapped back onto the machine
 * as detect-coordinate replacements (`insertText`), which never touch a chip
 * outside the edited range.
 *
 * Coordinates: the machine's spans speak the DETECT projection, where each
 * chip folds to one placeholder character. With chips at clipboard offsets,
 * the typed text splits into segments around them; free-text index `i` in
 * segment `k` sits at detect index `i + k` (k chips precede it).
 *
 * Pure and DOM-free — unit-tested on its own.
 * @module @khorsheed/dsh-room/client/draft-chips
 */

/** One reference chip of the input machine (the host's Occurrence, mirrored to the fields used). */
export interface DraftChip {
  /** Shell-assigned stable identity. */
  readonly occurrenceId: number
  /** Owning trigger source (the preview route's key). */
  readonly source: string
  /** Owner-scoped reference payload. */
  readonly ref: string
  /** Offset in the clipboard projection. */
  readonly offset: number
  /** Length in the clipboard projection. */
  readonly length: number
  /** Inline display label. */
  readonly label: string
}

/** One detect-coordinate replacement (empty text deletes). */
export interface DraftEdit {
  readonly start: number
  readonly end: number
  readonly text: string
}

/**
 * The typed text around the chips: one segment before each chip plus the
 * tail, in order (so `segments.length === chips.length + 1`).
 * @param draft - the clipboard projection.
 * @param chips - the machine's chips, sorted by offset.
 */
export function draftSegments(draft: string, chips: readonly DraftChip[]): string[] {
  const segments: string[] = []
  let cursor = 0
  for (const chip of chips) {
    segments.push(draft.slice(cursor, chip.offset))
    cursor = chip.offset + chip.length
  }
  segments.push(draft.slice(cursor))
  return segments
}

/** The textarea's text: the draft with every chip's clipboard text removed. */
export function freeText(draft: string, chips: readonly DraftChip[]): string {
  return draftSegments(draft, chips).join('')
}

/** The detect index of chip `k` (its single placeholder character). */
export function chipDetectIndex(draft: string, chips: readonly DraftChip[], k: number): number {
  const before = draftSegments(draft, chips).slice(0, k + 1).reduce((sum, segment) => sum + segment.length, 0)
  return before + k
}

/**
 * Plan the machine edits turning the current free text into `next` while
 * keeping every chip. The change is the span between the common prefix and
 * suffix; its replacement lands in the segment where it starts (a caret on a
 * chip boundary types BEFORE the chip, which keeps a quote block's
 * attribution line closed), and any part of the old span in later segments
 * is deleted segment by segment — a range swept across a chip never deletes
 * the chip itself. Edits are ordered last-first, so applying them in order
 * keeps every earlier coordinate valid.
 * @param draft - the clipboard projection.
 * @param chips - the machine's chips, sorted by offset.
 * @param next - the textarea's new value.
 * @returns the edits to apply in order (empty when nothing changed).
 */
export function planFreeEdit(draft: string, chips: readonly DraftChip[], next: string): DraftEdit[] {
  const segments = draftSegments(draft, chips)
  const current = segments.join('')
  if (current === next) return []
  const limit = Math.min(current.length, next.length)
  let prefix = 0
  while (prefix < limit && current[prefix] === next[prefix]) prefix += 1
  let suffix = 0
  while (suffix < limit - prefix && current[current.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix += 1
  const removeEnd = current.length - suffix
  const inserted = next.slice(prefix, next.length - suffix)

  const edits: DraftEdit[] = []
  let insertedPlaced = false
  let segmentStart = 0
  segments.forEach((segment, k) => {
    const segmentEnd = segmentStart + segment.length
    // The replacement's home: the first segment whose span holds the prefix
    // point (boundary → the earlier segment, i.e. before the chip).
    const home = !insertedPlaced && prefix >= segmentStart && prefix <= segmentEnd
    const from = Math.max(prefix, segmentStart)
    const to = Math.min(removeEnd, segmentEnd)
    if (home) {
      const end = Math.max(prefix, to)
      if (end > prefix || inserted !== '') edits.push({ start: prefix + k, end: end + k, text: inserted })
      insertedPlaced = true
    } else if (from < to) {
      edits.push({ start: from + k, end: to + k, text: '' })
    }
    segmentStart = segmentEnd
  })
  return edits.reverse()
}
