/**
 * Stage one of the reader's right-Sidebar registration: the tab type, the body
 * of which is registered in `client/index.ts`.
 *
 * The kind is MINTED (`reader`) rather than taken over: this is a page type of
 * its own, not a superset of an official one, so it claims no address and ships
 * no `patterns` / `canOpen`. It joins the guide page as its own card, which is
 * how a reader finds it before pinning the tab.
 *
 * @module @khorsheed/dsh-reader/client/definition
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { IconGlobeOutlineMedium, type IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './locales.ts'

/** The tab kind: minted, since no official kind means "reader". */
export const READER_KIND = 'reader'

/** This implementation's identity, and the key its body registers under. */
export const READER_TAB_ID = '@khorsheed/dsh-reader'

/** The type's glyph on the guide card. */
function ReaderGlyph({ size, className }: IconProps) {
  return <IconGlobeOutlineMedium size={size} className={className} />
}

/**
 * The reader type's registry definition. No `priority` (the default
 * `extension` band is right for a type from outside the product) and no
 * `patterns`/`canOpen` (a page type recognises no address).
 *
 * @param t - the reader namespace's translator.
 * @returns the definition to register.
 */
export function readerDefinition(t: TranslateNS<'reader'>): SidebarRightTabDefinition {
  return {
    id: READER_TAB_ID,
    kind: READER_KIND,
    title: () => t('tab.label'),
    guide: [{
      id: READER_KIND,
      order: 60,
      title: () => t('tab.label'),
      description: () => t('guide.description'),
      icon: ReaderGlyph,
    }],
  }
}
