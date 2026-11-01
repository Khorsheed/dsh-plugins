/**
 * The destination line a reader tool appends to its answer (proposal
 * 2026-10-30-agent-sidebar-navigation; format: `@khorsheed/dsh-client-ui-agent-nav`
 * `destination.ts`). Written through the documented no-import path — the host
 * half is not bundled, so it cannot import that source-plane library at
 * runtime; `tests/nav-line.spec.ts` pins this copy to the reference reader.
 *
 * The reader never follows by itself (user decision 2026-10-30): the line only
 * feeds the conversation card's 「查看 →」 door.
 *
 * @module @khorsheed/dsh-reader
 */

/** The marker that opens a destination line. */
export const NAV_MARK = '⟦dsh-nav⟧'

/** The reader tab kind (the browser half's `READER_KIND`). */
export const READER_NAV_KIND = 'reader'

/** One place in the reader: an article, on its text or its notes. */
export interface ReaderNavParams {
  readonly entryId: string
  readonly tab?: 'article' | 'notes'
}

/**
 * The answer with its destination line.
 * @param answer - the tool's answer.
 * @param id - stable per landing (`reader:<entry>:<thing>:<version>`).
 * @param params - the reader address.
 * @param label - what the person reads on the card.
 */
export function withReaderDestination(answer: string, id: string, params: ReaderNavParams, label: string): string {
  return `${answer}\n${NAV_MARK}${JSON.stringify({ id, kind: READER_NAV_KIND, params, label })}`
}
