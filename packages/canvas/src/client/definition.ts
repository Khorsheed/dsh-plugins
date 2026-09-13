/**
 * Stage one of this package's right-Sidebar registration (0.1.5+): what the
 * `canvas` tab type is.
 *
 * The type is a page, not a viewer: it claims no address and is opened by
 * kind. The guide entry is what makes it reachable — the shipped guide renders
 * a capsule for every registered type, and when this is a pane's ONLY
 * registered type the registry's `defaultSeed` opens it directly instead of
 * showing the guide at all (both behaviours are the official registry's; this
 * package registers nothing beside the capsule).
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
