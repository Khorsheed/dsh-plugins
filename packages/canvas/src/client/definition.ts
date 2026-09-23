/**
 * The two right-Sidebar tab types this package owns (0.1.5+): `canvas`, and —
 * since stage ⑧ — `canvasDetail`.
 *
 * The first is a page: it claims no address and is opened by kind, and the
 * guide entry is what makes it reachable by hand (the shipped guide renders a
 * capsule for every registered type, and when this is a pane's ONLY registered
 * type the registry's `defaultSeed` opens it directly instead of showing the
 * guide at all — both behaviours are the official registry's). It now holds
 * ONLY the board: the detail that used to be a drill-down inside it is the
 * second type, a RESOURCE type, so one card is one tab of the same dock rather
 * than a page the board flips to — and a card click calls `openResource`
 * instead of flipping this page's own view.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { IconLightOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CardCategoryId } from '../types.ts'
import { DETAIL_RESOURCE_TYPE, DRAFT_SEGMENT, parseDetailAddress } from './detail/detail-address.ts'
import type {} from './locales.ts'

/** The tab kind this package owns. */
export const CANVAS_KIND = 'canvas'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const CANVAS_TAB_ID = '@khorsheed/dsh-canvas'

/** The card-detail kind (stage ⑧): a resource type, so one card is one tab. */
export const CANVAS_DETAIL_KIND = 'canvasDetail'

/** The detail implementation's identity, and the key its body and chip register under. */
export const CANVAS_DETAIL_TAB_ID = '@khorsheed/dsh-canvas/detail'

/**
 * What a detail open carries as navigation params — keyed by the RESOURCE type
 * (`canvas`), which is a different namespace from the page kind above. The
 * heading is the chip's text: the host captures `title(address)` once at open
 * time and never refreshes it, so the live label rides the navigation record
 * instead (a re-open of an already-open card re-delivers params and bumps
 * `revision`, which is what updates the chip). `kind` is the draft tab's only
 * extra state: one draft address per canvas means the ＋新卡 menu can never
 * produce a second blank draft, only re-categorize the one that is open.
 */
export interface CanvasDetailParams {
  /** The chip's text (a card's heading, or the draft's label). */
  readonly heading: string
  /** The draft tab's category; absent on a card tab. */
  readonly kind?: CardCategoryId
}

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightResourceParamsMap {
    /** One card detail of one canvas, addressed `dsh-resource://canvas/<canvasId>/<cardId>`. */
    canvas: CanvasDetailParams
  }
}

/**
 * The type's registry definition. No `priority`: the default `extension` band
 * is exactly what a type shipped from outside the product is.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function canvasDefinition(t: TranslateNS<'canvas'>): SidebarRightTabDefinition {
  return {
    id: CANVAS_TAB_ID,
    kind: CANVAS_KIND,
    title: () => t('tab.label'),
    guide: [{
      order: 50,
      title: () => t('tab.label'),
      description: () => t('guide.description'),
      icon: IconLightOutline16,
    }],
  }
}

/**
 * The card detail's registry definition (stage ⑧, §11.2 row 7): the board's
 * drill-down became a tab of the same dock, so a card, its draft, and the board
 * are siblings in one strip.
 *
 * It is a RESOURCE type — `patterns` claim only this package's own address
 * grammar, and `canOpen` re-checks it (naming the kind bypasses the globs, so
 * that is the gate a deliberate caller meets). No `guide` entry: a detail is
 * never opened by hand, only from the board. The chip's `title` is the
 * placeholder the grammar allows without reading the board; the live text comes
 * from the params above, through this package's `sidebar.right.pane.tab.title`
 * registrant.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function canvasDetailDefinition(t: TranslateNS<'canvas'>): SidebarRightTabDefinition {
  return {
    id: CANVAS_DETAIL_TAB_ID,
    kind: CANVAS_DETAIL_KIND,
    patterns: [`dsh-resource://${DETAIL_RESOURCE_TYPE}/*/*`],
    canOpen: address => parseDetailAddress(address) !== undefined,
    title: address => address.endsWith(`/${DRAFT_SEGMENT}`) ? t('detail.tabDraft') : t('detail.tabCard'),
  }
}
