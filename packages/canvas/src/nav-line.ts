/**
 * The destination line a canvas tool appends to its answer (proposal
 * 2026-10-30-agent-sidebar-navigation; format: `@khorsheed/dsh-client-ui-agent-nav`
 * `destination.ts`). Written through the documented no-import path — the host
 * half is not bundled, so it cannot import that source-plane library at
 * runtime; `tests/nav-line.spec.ts` pins this copy to the reference reader.
 *
 * In a room the desk row (desk.ts) already brings the canvas to the room, so a
 * desk call names no destination (one source moving the sidebar, never two).
 *
 * @module @khorsheed/dsh-canvas
 */

/** The marker that opens a destination line. */
export const NAV_MARK = '⟦dsh-nav⟧'

/** One canvas address (`CanvasNavParams` of the browser half). */
export interface CanvasDestinationParams {
  readonly canvasId: string
  readonly card?: string
  readonly manuscript?: string
  readonly type?: string
  readonly face?: 'board' | 'link' | 'manuscripts' | 'view' | 'lead'
  readonly scope?: string | null
  readonly item?: string
  readonly focus?: string
  readonly heading?: string
}

/**
 * The answer with its destination line.
 * @param answer - the tool's answer.
 * @param id - stable per landing (`canvas:<canvas>:<thing>:<version>`).
 * @param params - the canvas address.
 * @param label - what the person reads on the card.
 */
export function withCanvasDestination(answer: string, id: string, params: CanvasDestinationParams, label: string): string {
  return `${answer}\n${NAV_MARK}${JSON.stringify({ id, kind: 'canvas', params, label })}`
}
