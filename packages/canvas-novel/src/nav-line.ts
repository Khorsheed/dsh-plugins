/**
 * The destination line a novel tool appends to its answer (proposal
 * 2026-10-30-agent-sidebar-navigation; format: `@khorsheed/dsh-client-ui-agent-nav`
 * `destination.ts`). Written through the documented no-import path — the host
 * half is not bundled, so it cannot import that source-plane library at
 * runtime; `tests/nav-line.spec.ts` pins this copy to the reference reader.
 *
 * Every place is a canvas address (the canvas tab owns the surface): a chapter
 * is the 章节 face showing chapter `item` (`focus` plan or body), an outline
 * proposal is the 规划 face, a reconciled chapter is 设定 · 最近更新.
 *
 * @module @khorsheed/dsh-canvas-novel
 */

/** The marker that opens a destination line. */
export const NAV_MARK = '⟦dsh-nav⟧'

/** The 设定 face's scope a 对账 lands in (the browser half's `RECENT_SCOPE`). */
export const RECENT_SCOPE = 'recent'

/** A canvas address (the canvas browser half's `CanvasNavParams`). */
interface CanvasPlace {
  readonly canvasId: string
  readonly face?: 'board' | 'manuscripts' | 'lead'
  readonly scope?: string
  readonly item?: string
  readonly focus?: 'plan' | 'body'
  readonly page?: string
  readonly param?: string
  readonly heading?: string
}

/**
 * The answer with its destination line.
 * @param answer - the tool's answer.
 * @param id - stable per landing.
 * @param params - the canvas address.
 * @param label - what the person reads on the card.
 */
export function withNovelDestination(answer: string, id: string, params: CanvasPlace, label: string, card?: NovelCardData): string {
  return `${answer}\n${NAV_MARK}${JSON.stringify({ id, kind: 'canvas', params, label, ...(card === undefined ? {} : { card }) })}`
}

/** What the card says besides the label (the shell draws it; the agent-nav `DestinationCardData`). */
export interface NovelCardData {
  readonly status?: string
  readonly awaiting?: boolean
  readonly door?: string
}

/**
 * A chapter's destination: the 章节 face, chapter `n`, on its plan or its text.
 * @param answer - the tool's answer.
 * @param canvasId - the work.
 * @param n - the chapter.
 * @param title - its title.
 * @param focus - what to open it on.
 * @param version - what makes this landing distinct (an updatedAt, a length).
 * @param card - the card's status and door, when the write asks the person for something.
 */
export function withChapterDestination(answer: string, canvasId: string, n: number, title: string, focus: 'plan' | 'body', version: string, card?: NovelCardData): string {
  return withNovelDestination(answer, `canvas:${canvasId}:chapter:${n}:${focus}:${version}`,
    { canvasId, face: 'manuscripts', item: String(n), focus }, `第 ${n} 章《${title}》${focus === 'plan' ? '计划' : '正文'}`, card)
}

/**
 * An answer without its destination lines: in a room the desk row brings the
 * canvas instead (one source moving the sidebar, never two).
 * @param answer - the tool's answer.
 */
export function withoutDestinations(answer: string): string {
  return answer.split('\n').filter(line => !line.startsWith(NAV_MARK)).join('\n')
}
