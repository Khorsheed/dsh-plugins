/**
 * The 剪辑 tab type: a page-type right-Sidebar tab with its own kind (no
 * official kind means "editing"). It claims no address.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'

export const VIDEO_KIND = 'video-studio'

export const VIDEO_TAB_ID = '@khorsheed/dsh-video-studio'

interface GlyphProps {
  size?: number | undefined
  className?: string | undefined
}

/** A clapperboard over a waveform, drawn on the official 16 px grid. */
export function StudioGlyph({ size = 16, className }: GlyphProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.7" y="5.2" width="12.6" height="8.6" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.9 5.1 13.6 2.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M4.6 4.4 5.6 5.1M8.2 3.5l1 .8M11.8 2.6l1 .8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M4.2 9.5v1M6.2 8.3v3.4M8.2 9v2M10.2 7.9v4.2M12 9.2v1.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

export function videoDefinition(t: TranslateNS<'videoStudio'>): SidebarRightTabDefinition {
  return {
    id: VIDEO_TAB_ID,
    kind: VIDEO_KIND,
    title: () => t('tab.label'),
    guide: [{
      id: VIDEO_KIND,
      order: 62,
      title: () => t('tab.label'),
      description: () => t('guide.description'),
      icon: StudioGlyph,
    }],
  }
}
