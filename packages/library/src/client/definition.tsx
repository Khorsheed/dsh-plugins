/**
 * Stage one of the library's right-Sidebar registration: the tab type, the
 * body of which is registered in `client/index.ts`.
 *
 * The kind is MINTED (`library`) rather than taken over: this is a page type
 * of its own, not a superset of an official one, so it claims no address and
 * ships no `patterns` / `canOpen`. It joins the guide page as its own card,
 * which is how a learner finds it before pinning the tab.
 *
 * @module @khorsheed/dsh-library/client/definition
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { IconBookOutlineMedium, type IconProps } from './icons-local.tsx'
import type {} from './locales.ts'

/** The tab kind: minted, since no official kind means "library". */
export const LIBRARY_KIND = 'library'

/** This implementation's identity, and the key its body registers under. */
export const LIBRARY_TAB_ID = '@khorsheed/dsh-library'

/** The type's glyph on the guide card. */
function LibraryGlyph({ size, className }: IconProps) {
  return <IconBookOutlineMedium size={size} className={className} />
}

/**
 * The library type's registry definition. No `priority` (the default
 * `extension` band is right for a type from outside the product) and no
 * `patterns`/`canOpen` (a page type recognises no address).
 *
 * @param t - the library namespace's translator.
 * @returns the definition to register.
 */
export function libraryDefinition(t: TranslateNS<'library'>): SidebarRightTabDefinition {
  return {
    id: LIBRARY_TAB_ID,
    kind: LIBRARY_KIND,
    title: () => t('tab.label'),
    guide: [{
      id: LIBRARY_KIND,
      order: 62,
      title: () => t('tab.label'),
      description: () => t('guide.description'),
      icon: LibraryGlyph,
    }],
  }
}
