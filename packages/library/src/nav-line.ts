/**
 * The destination line a library tool appends to its answer (proposal
 * 2026-10-30-agent-sidebar-navigation; format: `@khorsheed/dsh-client-ui-agent-nav`
 * `destination.ts`). Written through the documented no-import path — the host
 * half is not bundled, so it cannot import that source-plane library at
 * runtime; `tests/nav-line.spec.ts` pins this copy to the reference reader.
 *
 * The tools answer JSON: a tool hands its destination over under
 * {@link NAV_KEY} on the value, and the shared output render (`tools/kit.ts`
 * `jsonOutput`) drops that key from the JSON and writes the line after it.
 *
 * @module @khorsheed/dsh-library
 */

/** The marker that opens a destination line. */
export const NAV_MARK = '⟦dsh-nav⟧'

/**
 * The kind a noted weak point (library_cards) lands under: the cards list,
 * which the follower never opens by itself (the learner is mid-reading) — its
 * write signal feeds the pane's 「已记下 · 撤销」 toast.
 */
export const RECORD_KIND = 'library-record'

/** The value key a tool hands its destination over under (never part of the JSON the model reads). */
export const NAV_KEY = '$nav'

/** The station page's tabs. */
export type LibraryNavTab = 'guide' | 'pages' | 'notes' | 'quiz'

/** The card list's filters. */
export type LibraryNavCardFilter = 'all' | 'photo' | 'chat' | 'quiz' | 'due'

/**
 * One place in the library tab, as an address: the tab kind's navigation
 * params (`SidebarRightTabParamsMap['library']`), and the `params` of every
 * destination a library tool names.
 */
export type LibraryNavParams =
  | { readonly view: 'today' }
  | { readonly view: 'project'; readonly projectId: string }
  /** `draft`: the book's roadmap waiting to be 采用 (its card hears the adoption; the pane lands on the book). */
  | { readonly view: 'book'; readonly projectId: string; readonly resourceId: string; readonly draft?: true }
  | { readonly view: 'station'; readonly projectId: string; readonly resourceId: string; readonly nodeId: string; readonly tab?: LibraryNavTab }
  | { readonly view: 'lesson'; readonly projectId: string; readonly resourceId: string; readonly nodeId: string }
  | { readonly view: 'quiz'; readonly projectId: string; readonly resourceId?: string; readonly quizId: string }
  | { readonly view: 'cards'; readonly projectId: string; readonly filter?: LibraryNavCardFilter }

/**
 * What the card says besides the label, when the write waits for the learner
 * (the shell draws it; the agent-nav `DestinationCardData`).
 */
export interface LibraryCardData {
  readonly status?: string
  readonly awaiting?: boolean
  readonly door?: string
}

/** What a tool hands over under {@link NAV_KEY}. */
export interface LibraryDestination {
  /** `library` (default), or {@link RECORD_KIND} for a noted weak point. */
  readonly kind?: 'library' | typeof RECORD_KIND
  readonly id: string
  readonly params: LibraryNavParams
  readonly label: string
  readonly card?: LibraryCardData
}

/**
 * The marked line for one destination.
 * @param destination - where the write landed.
 * @returns the line, without a trailing newline.
 */
export function libraryDestinationLine(destination: LibraryDestination): string {
  return `${NAV_MARK}${JSON.stringify({
    id: destination.id, kind: destination.kind ?? 'library', params: destination.params, label: destination.label,
    ...(destination.card === undefined ? {} : { card: destination.card }),
  })}`
}
