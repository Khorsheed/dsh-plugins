/**
 * Stage one of this package's right-Sidebar registration (0.1.5+): what the
 * `local-files` tab type IS.
 *
 * The type is a page, not a viewer: it claims no address. The guide page
 * offers it as an entry box next to the official workspace-scoped files card
 * — theirs is "the session's workspace" (`sidebarFiles`), ours is "any
 * directory, any time", and the naming keeps that split: the tab is 文件列表
 * / Files, leaving 工作区 / workspace to the official surface.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { FileTypeIcon, type IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './locales.ts'

/** The tab kind this package owns. */
export const LOCAL_FILES_KIND = 'local-files'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const LOCAL_FILES_TAB_ID = '@khorsheed/dsh-local-files'

/**
 * The type's glyph at the guide capsule's size: the official coloured folder
 * sheet (the same FileTypeIcon the official files card draws), so the entry
 * reads as one family with the built-in cards.
 */
function FolderGlyph({ size, className }: IconProps) {
  return <FileTypeIcon kind="folder" size={size} className={className} />
}

/**
 * The local-files type's registry definition. No `priority`: the default
 * `extension` band is exactly what a type shipped from outside the product
 * is. Guide order 40 parks the card after the official files card (10), the
 * products card (20), and the worktrees card (30).
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function localFilesDefinition(t: TranslateNS<'localFiles'>): SidebarRightTabDefinition {
  return {
    id: LOCAL_FILES_TAB_ID,
    kind: LOCAL_FILES_KIND,
    title: () => t('tab.label'),
    guide: [{
      order: 40,
      title: () => t('tab.label'),
      description: () => t('guide.description'),
      icon: FolderGlyph,
    }],
  }
}
