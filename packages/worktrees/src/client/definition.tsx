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
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
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

/**
 * The type's guide glyph: the branch mark on a tinted tile, drawn in
 * currentColor so it follows the theme (the guide renders icons at 26px; the
 * tile reads like the official coloured file sheets without borrowing a
 * file-type glyph that would misname the page).
 */
function BranchGlyph({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="16" height="16" rx="4" fill="currentColor" fillOpacity="0.1" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        transform="translate(1.5, 1.5) scale(0.8125)"
        fill="currentColor"
        d="M13.0762 1.37207C14.0846 1.37228 14.9021 2.19077 14.9023 3.19922C14.9022 4.20772 14.0847 5.02518 13.0762 5.02539C12.2967 5.02539 11.6325 4.53691 11.3701 3.84961H4.35547C4.79397 4.26458 5.15861 4.7644 5.41699 5.33496L7.10645 9.06738C7.88526 10.7875 9.55104 11.9228 11.4189 12.0371C11.7085 11.4109 12.3411 10.9756 13.0762 10.9756C14.0843 10.9759 14.9023 11.7936 14.9023 12.8018C14.9023 13.81 14.0843 14.6277 13.0762 14.6279C12.2534 14.6279 11.5574 14.0832 11.3291 13.335C8.9868 13.1879 6.89981 11.7612 5.92285 9.60352L4.23242 5.87109C3.67503 4.64033 2.44878 3.84961 1.09766 3.84961V2.54883C1.10665 2.54883 1.11601 2.54975 1.125 2.5498L11.3701 2.54883C11.6326 1.86151 12.2969 1.37207 13.0762 1.37207ZM13.0762 12.2764C12.7858 12.2764 12.5508 12.5114 12.5508 12.8018C12.5508 13.0921 12.7858 13.3281 13.0762 13.3281C13.3664 13.3279 13.6025 13.092 13.6025 12.8018C13.6025 12.5115 13.3664 12.2766 13.0762 12.2764ZM13.0762 2.67285C12.7855 2.90861 12.55 2.90861 12.5498 3.19922C12.5499 3.48975 12.7855 3.72559 13.0762 3.72559C13.3667 3.72538 13.6024 3.48975 13.6025 3.19922C13.6023 2.90874 13.3666 2.67306 13.0762 2.67285Z"
      />
    </svg>
  )
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
