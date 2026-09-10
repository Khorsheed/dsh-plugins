/**
 * Stage one of this package's right-Sidebar registration: what the
 * `worktrees` tab type IS.
 *
 * The type is a page, not a viewer: it claims no address. The badge's branch
 * capsule opens it by kind (`ctx.sidebarRight.openTab`) with the mode as
 * navigation params, and the guide page offers it as an entry box. Pages
 * deduplicate within a pane, so a repeat open re-navigates the one tab and
 * the body follows `navigation.params`.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { IconBranchOutline16, type IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './locales.ts'
import type { DrawerMode } from './store.ts'

/** The tab kind this package owns. */
export const WORKTREES_KIND = 'worktrees'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const WORKTREES_TAB_ID = '@khorsheed/dsh-worktrees'

/** Navigation params the badge hands `openTab`: which mode the page opens in. */
export interface WorktreesTabParams {
  readonly mode?: DrawerMode
}

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** The worktrees page's initial mode. */
    worktrees: WorktreesTabParams
  }
}

/** The type's branch glyph at the guide capsule's size. */
function BranchGlyph({ size, className }: IconProps) {
  return <IconBranchOutline16 size={size} className={className} />
}

/**
 * The worktrees type's registry definition. No `priority`: the default
 * `extension` band is exactly what a type shipped from outside the product is.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function worktreesDefinition(t: TranslateNS<'worktrees'>): SidebarRightTabDefinition {
  return {
    id: WORKTREES_TAB_ID,
    kind: WORKTREES_KIND,
    title: () => t('tab.title'),
    guide: [{
      order: 30,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: BranchGlyph,
    }],
  }
}
