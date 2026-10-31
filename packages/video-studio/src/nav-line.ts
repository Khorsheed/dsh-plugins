/**
 * The destination line a video tool appends to its answer (proposal
 * 2026-10-30-agent-sidebar-navigation; format: `@khorsheed/dsh-client-ui-agent-nav`
 * `destination.ts`). Written through the documented no-import path — the host
 * half is not bundled, so it cannot import that source-plane library at
 * runtime; `tests/nav-line.spec.ts` pins this copy to the reference reader.
 *
 * In a room the desk row (desk.ts) brings the project instead, so a desk call
 * names no destination (one source moving the sidebar, never two).
 *
 * @module @khorsheed/dsh-video-studio
 */

/** The marker that opens a destination line. */
export const NAV_MARK = '⟦dsh-nav⟧'

/** The 剪辑 tab kind (the browser half's `VIDEO_KIND`). */
export const VIDEO_NAV_KIND = 'video-studio'

/** One place in the 剪辑 panel (the browser half's `VideoNavParams`). */
export interface VideoDestinationParams {
  readonly projectId: string
  readonly tab?: 'sources' | 'transcript' | 'export' | 'settings'
  /** A proposal group, shown at the top of 文稿. */
  readonly groupId?: string
  readonly jobId?: string
}

/**
 * The answer with its destination line.
 * @param answer - the tool's answer.
 * @param what - what landed (`open`, `import`, `group:<id>`, `export:<job>`), part of the id.
 * @param params - the panel address.
 * @param label - what the person reads on the card.
 */
export function withVideoDestination(answer: string, what: string, params: VideoDestinationParams, label: string): string {
  const destination = { id: `${VIDEO_NAV_KIND}:${params.projectId}:${what}:${Date.now()}`, kind: VIDEO_NAV_KIND, params, label }
  return `${answer}\n${NAV_MARK}${JSON.stringify(destination)}`
}
