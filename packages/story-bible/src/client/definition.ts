/**
 * The ONE right-Sidebar tab type this package owns: `story` (写作). F1-4:
 * the M3 two-kind shape (story-fragments / story-reader) retired into an
 * internal switcher — one plugin, one host tab. A page type: it claims no
 * address and opens by kind, with the guide entry making it reachable by
 * hand.
 *
 * Mode visibility follows the cross-session rule (docs/plugin-visibility.md):
 * the works store is deployment-level content shared by every session, so
 * there is NO runtime switch — the install layer decides. The agent row
 * (tools/pointer/skill) rides the cordis preset grant, unchanged. Open tabs
 * of the retired kinds (`story-fragments`/`story-reader`, pre-0.2 layouts)
 * render the host's designed `tab.unavailable` fallback — a real state, not
 * a defect; close and reopen.
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { IconBookOutlineMedium } from './icons.tsx'
import type {} from './locales.ts'

/** The story tab kind. */
export const STORY_KIND = 'story'

/** This implementation's identity in the tab system (the identity triangle's client end). */
export const STORY_TAB_ID = '@khorsheed/dsh-story-bible'

/**
 * The story tab's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function storyDefinition(t: TranslateNS<'story'>): SidebarRightTabDefinition {
  return {
    id: STORY_TAB_ID,
    kind: STORY_KIND,
    title: () => t('tab.story'),
    guide: [{
      id: STORY_KIND,
      order: 51,
      title: () => t('tab.story'),
      description: () => t('guide.story'),
      icon: IconBookOutlineMedium,
    }],
  }
}
