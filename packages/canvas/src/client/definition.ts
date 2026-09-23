/**
 * The one right-Sidebar tab type this package owns: `canvas`.
 *
 * It is a page: it claims no address and is opened by kind, and the guide entry
 * is what makes it reachable by hand (the shipped guide renders a capsule for
 * every registered type, and when this is a pane's ONLY registered type the
 * registry's `defaultSeed` opens it directly instead of showing the guide at
 * all — both behaviours are the official registry's).
 *
 * One type is the round-3 ruling. Stage ⑧ added a second, `canvasDetail`, so a
 * card could sit beside the board in the dock; item ⑥ moved those tabs inside
 * this page's own strip and the second type went away — a card's tab is a row of
 * this surface, not a resource of the host's dock.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { IconLightOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './locales.ts'

/** The tab kind this package owns. */
export const CANVAS_KIND = 'canvas'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const CANVAS_TAB_ID = '@khorsheed/dsh-canvas'

/**
 * The type's registry definition. No `priority`: the default `extension` band
 * is exactly what a type shipped from outside the product is. The `title` is
 * only the chip's fallback — this package registers a live title on
 * `sidebar.right.pane.tab.title`, because which canvas or card is showing is
 * the page's state, not the registry's.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function canvasDefinition(t: TranslateNS<'canvas'>): SidebarRightTabDefinition {
  return {
    id: CANVAS_TAB_ID,
    kind: CANVAS_KIND,
    title: () => t('tab.label'),
    guide: [{
      id: CANVAS_KIND,
      order: 50,
      title: () => t('tab.label'),
      description: () => t('guide.description'),
      icon: IconLightOutline16,
    }],
  }
}
