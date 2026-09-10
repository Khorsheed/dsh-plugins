/**
 * Stage one of this package's right-Sidebar registration: what the
 * `file-preview` tab type IS.
 *
 * The type is a page, not a viewer: it claims no address. The guide page
 * offers it as an entry box, the per-turn card opens it by kind for
 * outside-workspace paths, and in-workspace files route to the official
 * document tab through `openResource` instead (the S1 seam landed at
 * 0.1.5-rc.1 — content rendering is the official `text` type's job; the
 * per-write diff history stays ours).
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { FileTypeIcon, type IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './locales.ts'

/** The tab kind this package owns. */
export const FILE_PREVIEW_KIND = 'file-preview'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const FILE_PREVIEW_ID = '@khorsheed/dsh-client-ui-file-preview'

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** The file-preview page takes the path to select (the turn card's outside-workspace gesture). */
    'file-preview': { readonly path?: string }
  }
}

/** The type's glyph at the guide capsule's size: a plain file sheet. */
function FileSheetGlyph({ size, className }: IconProps) {
  return <FileTypeIcon kind="other" size={size} className={className} />
}

/**
 * The file-preview type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function filePreviewDefinition(t: TranslateNS<'filePreview'>): SidebarRightTabDefinition {
  return {
    id: FILE_PREVIEW_ID,
    kind: FILE_PREVIEW_KIND,
    title: () => t('open'),
    guide: [{
      order: 20,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: FileSheetGlyph,
    }],
  }
}
