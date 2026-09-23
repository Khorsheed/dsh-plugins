/**
 * The address grammar behind the card-detail tab (stage ⑧, §11.2 row 7).
 *
 * A detail is a RESOURCE of this package's `canvas` type, not a page. The host
 * dedupes resources by `(kind, contentId)` and the contentId is the whole
 * address (`ui-sidebar-right/src/client/tab-registry.ts:375`), so one card is
 * one tab — clicking it twice focuses that tab instead of stacking a second
 * one — while two cards are two tabs in the same pane. An unsaved draft gets
 * ONE address per canvas and carries its category in `navigation.params`, which
 * is what keeps the ＋新卡 menu from ever producing a second blank draft.
 *
 * Ids are minted here (`makeBoardId`: `canvas_…`, `c_…`), and the draft
 * sentinel `_draft` is outside the card-id grammar by construction — a card can
 * never be handed the draft's address.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { normalizeCanvasId } from '../../types.ts'

/** The resource type segment every canvas detail address carries. */
export const DETAIL_RESOURCE_TYPE = 'canvas'

/** The card-id segment of a draft tab; no minted card id can equal it. */
export const DRAFT_SEGMENT = '_draft'

/**
 * One card id, as `makeBoardId('c', …)` mints it: `c_` over the base36 time and
 * the random tail. Deliberately a shape check and not a lookup — the address is
 * resolved before any board is read, and an id the store never mints has no
 * card to show anyway.
 */
const CARD_SEGMENT = /^c_[a-z0-9]{9,40}$/

/** The full scheme prefix a detail address carries. */
const PREFIX = `dsh-resource://${DETAIL_RESOURCE_TYPE}/`

/** Where a detail tab points: one card of one canvas, or that canvas's draft. */
export interface DetailTarget {
  /** The canvas the card belongs to. */
  readonly canvasId: string
  /** The card, or `null` for the canvas's unsaved draft. */
  readonly cardId: string | null
}

/** The address of one card's detail tab. */
export function cardDetailAddress(canvasId: string, cardId: string): string {
  return `${PREFIX}${canvasId}/${cardId}`
}

/** The address of one canvas's draft tab (one per canvas, whatever the category). */
export function draftDetailAddress(canvasId: string): string {
  return `${PREFIX}${canvasId}/${DRAFT_SEGMENT}`
}

/**
 * Read a detail address back, or `undefined` when it is not one.
 *
 * The caller built every detail address with the two functions above, so
 * anything else is a wiring mistake; answering `undefined` keeps a tab that
 * outlived a grammar change on a notice rather than on a file request nobody
 * authorized.
 * @param address - a tab's `navigation.address`.
 * @returns the target, or `undefined` when the address is not a canvas detail.
 */
export function parseDetailAddress(address: string): DetailTarget | undefined {
  if (!address.startsWith(PREFIX)) return undefined
  const segments = address.slice(PREFIX.length).split('/')
  if (segments.length !== 2) return undefined
  const [canvas, card] = segments
  if (canvas === undefined || card === undefined) return undefined
  const canvasId = normalizeCanvasId(canvas)
  if (canvasId === undefined) return undefined
  if (card === DRAFT_SEGMENT) return { canvasId, cardId: null }
  return CARD_SEGMENT.test(card) ? { canvasId, cardId: card } : undefined
}
