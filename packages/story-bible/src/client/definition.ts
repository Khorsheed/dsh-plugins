/**
 * The two right-Sidebar tab types this package owns: `story-fragments`
 * (灵感碎片) and `story-reader` (章节阅读). Both are pages: they claim no
 * address and open by kind, with the guide entry making each reachable by
 * hand.
 *
 * Mode visibility follows the cross-session rule (docs/plugin-visibility.md):
 * the works store is deployment-level content shared by every session, so
 * there is NO runtime switch — the install layer decides (a profile that
 * should not show the surface does not list the package). The agent row
 * (tools/pointer/skill) rides the cordis preset grant, unchanged from M1.
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { IconBookOutlineMedium, IconBulbOutlineMedium } from './icons.tsx'
import type {} from './locales.ts'

/** The fragments tab kind. */
export const STORY_FRAGMENTS_KIND = 'story-fragments'
/** The chapter reader tab kind. */
export const STORY_READER_KIND = 'story-reader'

/**
 * This implementation's identity in the tab system for the FRAGMENTS tab
 * (the identity triangle's client end — the keyed tab seats register under it).
 */
export const STORY_TAB_ID = '@khorsheed/dsh-story-bible'

/**
 * The reader tab's registration id. A tab-type id is unique across every
 * registration (the tab registry throws on a duplicate), so the package's
 * second type carries its own sub-id; the keyed tab seats register under it.
 */
export const STORY_READER_TAB_ID = '@khorsheed/dsh-story-bible/reader'

/**
 * The fragments tab's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function storyFragmentsDefinition(t: TranslateNS<'story'>): SidebarRightTabDefinition {
  return {
    id: STORY_TAB_ID,
    kind: STORY_FRAGMENTS_KIND,
    title: () => t('tab.fragments'),
    guide: [{
      id: STORY_FRAGMENTS_KIND,
      order: 51,
      title: () => t('tab.fragments'),
      description: () => t('guide.fragments'),
      icon: IconBulbOutlineMedium,
    }],
  }
}

/**
 * The reader tab's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function storyReaderDefinition(t: TranslateNS<'story'>): SidebarRightTabDefinition {
  return {
    id: STORY_READER_TAB_ID,
    kind: STORY_READER_KIND,
    title: () => t('tab.reader'),
    guide: [{
      id: STORY_READER_KIND,
      order: 52,
      title: () => t('tab.reader'),
      description: () => t('guide.reader'),
      icon: IconBookOutlineMedium,
    }],
  }
}
