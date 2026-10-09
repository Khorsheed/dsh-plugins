/**
 * Stage one of the right-Sidebar registration: what the `game` tab type IS —
 * a page (no address claims), opened from the guide or by kind.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'

/** The tab kind this package owns. */
export const GAME_KIND = 'game'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const GAME_TAB_ID = '@khorsheed/dsh-game'

/** The guide glyph: a gamepad on a tinted tile, in currentColor. */
export function GameGlyph({ size = 16, className }: { size?: number | undefined; className?: string | undefined }) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect width="16" height="16" rx="4" fill="currentColor" fillOpacity="0.1" />
      <path d="M5.2 5.5h5.6a2.6 2.6 0 0 1 2.5 1.9l.6 2.3a1.4 1.4 0 0 1-2.3 1.4L10.4 10H5.6l-1.2 1.1a1.4 1.4 0 0 1-2.3-1.4l.6-2.3a2.6 2.6 0 0 1 2.5-1.9Z"
        stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M5.4 7v1.6M4.6 7.8h1.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="10.4" cy="7.4" r=".6" fill="currentColor" />
      <circle cx="11.4" cy="8.4" r=".6" fill="currentColor" />
    </svg>
  )
}

/**
 * The type's registry definition (default `extension` band).
 * @param t - namespace-bound translate.
 * @returns the definition to register.
 */
export function gameDefinition(t: TranslateNS<'game'>): SidebarRightTabDefinition {
  return {
    id: GAME_TAB_ID,
    kind: GAME_KIND,
    title: () => t('tab.title'),
    guide: [{
      id: GAME_KIND,
      order: 55,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: GameGlyph,
    }],
  }
}
