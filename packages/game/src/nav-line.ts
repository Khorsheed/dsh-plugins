/**
 * The destination line a game tool appends to its answer (proposal
 * 2026-10-30-agent-sidebar-navigation; format: `@khorsheed/dsh-client-ui-agent-nav`
 * `destination.ts`). Written through the documented no-import path — the host
 * half is not bundled, so it cannot import that source-plane library at
 * runtime; `tests/nav-line.spec.ts` pins this copy to the reference reader.
 *
 * In a room the desk row (desk.ts) brings the project to the room instead, so
 * a desk call names no destination (one source moving the sidebar, never two).
 *
 * @module @khorsheed/dsh-game
 */

/** The marker that opens a destination line. */
export const NAV_MARK = '⟦dsh-nav⟧'

/** One place in the game tab (`GameNavParams` of the browser half). */
export interface GamePlace {
  /** The project the place is in (the tab shows the session's bound project). */
  readonly projectId?: string
  readonly view: 'play' | 'elements' | 'design' | 'versions'
  readonly elementId?: string
  readonly chapterId?: string
}

/** What the card says besides the label (the shell draws it; the agent-nav `DestinationCardData`). */
export interface GameCardData {
  readonly status?: string
  readonly awaiting?: boolean
  readonly door?: string
}

/**
 * The answer with its destination line.
 * @param answer - the tool's answer.
 * @param id - stable per landing (`game:<project>:<thing>:<version>`).
 * @param params - the game tab address.
 * @param label - what the person reads on the card.
 * @param card - the card's status and door, when the write waits for the person.
 */
export function withGameDestination(answer: string, id: string, params: GamePlace, label: string, card?: GameCardData): string {
  return `${answer}\n${NAV_MARK}${JSON.stringify({ id, kind: 'game', params, label, ...(card === undefined ? {} : { card }) })}`
}
