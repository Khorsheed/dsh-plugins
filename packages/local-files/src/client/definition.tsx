/**
 * Stage one of this package's right-Sidebar registration (0.1.5+): what the
 * `files` tab type becomes once we register.
 *
 * The kind is the official files type's own (`dsh-client-ui-sidebar-files`):
 * the registry (`ui-sidebar-right`'s tab-registry) admits exactly one
 * `extension` registration per `builtin` kind and puts the extension in force
 * — claims, `get`, the guide page, and the body/title seat lookup all follow
 * the in-force definition, and the shadowed builtin resumes when the
 * extension unregisters. Our browser defaults to the session workspace and
 * browses any directory on top, a functional superset, so the official
 * workspace card is shadowed rather than duplicated on the guide page. The
 * `id` stays our own — ids collide hard (a duplicate id throws), kinds are
 * the designed takeover channel.
 *
 * The type is a page, not a viewer: it claims no address, exactly like the
 * builtin it shadows.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { FileTypeIcon, type IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './locales.ts'

/** The tab kind: the official files kind, taken over at the extension band. */
export const LOCAL_FILES_KIND = 'files'

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
 * `extension` band is both what a type shipped from outside the product is
 * and the band the takeover needs.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function localFilesDefinition(t: TranslateNS<'localFiles'>): SidebarRightTabDefinition {
  return {
    id: LOCAL_FILES_TAB_ID,
    kind: LOCAL_FILES_KIND,
    title: () => t('tab.label'),
    guide: [{
      id: LOCAL_FILES_KIND,
      order: 40,
      title: () => t('tab.label'),
      description: () => t('guide.description'),
      icon: FolderGlyph,
    }],
  }
}
