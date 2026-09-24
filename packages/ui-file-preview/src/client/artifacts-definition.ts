/**
 * What the `file-artifacts` tab type IS — the **rc.1 line's** session-products
 * entry (the 0.1.5 line keeps the full `file-preview` page; see
 * definition.tsx). A thin LIST SHELL, not a content surface: the guide page
 * offers it as an entry box, the page lists the session's written/edited
 * files, and a row click routes the file's canonical
 * `dsh-resource://file/session/<id>/<path>` address through
 * `sidebarRight.openResource` — the official document tab opens it (this
 * plugin's content renderer is its default body, the change history one
 * dropdown away). The shell claims no address itself: `patterns` stays off, so
 * the document tab's claim is the only routing a file address sees.
 */

import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'
import { ProductsGlyph } from './definition.tsx'

/** The tab kind this shell owns. */
export const FILE_ARTIFACTS_KIND = 'file-artifacts'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const FILE_ARTIFACTS_ID = '@khorsheed/dsh-client-ui-file-preview/artifacts'

/**
 * The shell's registry definition: a page type (opened by kind from the guide
 * page), no address claims.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function fileArtifactsDefinition(t: TranslateNS<'filePreview'>): SidebarRightTabDefinition {
  return {
    id: FILE_ARTIFACTS_ID,
    kind: FILE_ARTIFACTS_KIND,
    // Page tabs open by kind, so the chip text never sees a resource address;
    // the shell's name is the surface's long-standing 「会话产物」 label.
    title: () => t('guide.title'),
    guide: [{
      id: FILE_ARTIFACTS_KIND,
      order: 20,
      title: () => t('guide.title'),
      description: () => t('artifacts.guide.description'),
      icon: ProductsGlyph,
    }],
  }
}
