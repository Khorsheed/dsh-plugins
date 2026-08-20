/** Small clock/duration formatters for the room chat chrome. */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls this plugin's LocaleNamespaceMap merge.
import type {} from './locales.ts'

/** The room-namespace translate the relative-time formatter reads through. */
type TimeTranslate = TranslateNS<'room'>

/**
 * The honest run/dispatch duration: sub-100ms as `<0.1s` (a flat `0.0s`
 * reads as "nothing happened" on an instant failure), sub-10s as `0.x s`,
 * then whole seconds, then `m:ss`.
 * @param ms - the duration in milliseconds.
 * @returns the formatted duration.
 */
export function formatDurationMs(ms: number): string {
  if (ms < 100) return '<0.1s'
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
}

/**
 * The hover-revealed message clock: HH:MM local.
 * @param time - unix epoch ms.
 * @returns the wall-clock label.
 */
export function formatClock(time: number): string {
  const date = new Date(time)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** The translate face the relative-time formatter needs (locale-owned copy). */
/**
 * The dock's relative clock: 刚刚 under a minute, then minutes, hours, days.
 * Coarse on purpose — the capsules answer "how long ago", not "when exactly"
 * (the exact clock stays on the chat rows' hover affordance).
 * @param time - unix epoch ms of the event.
 * @param now - unix epoch ms of "now".
 * @param t - the room namespace translate.
 * @returns the localized relative label.
 */
export function formatRelativeTime(time: number, now: number, t: TimeTranslate): string {
  const elapsed = Math.max(0, now - time)
  if (elapsed < 60_000) return t('time.justNow')
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) return t('time.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('time.hoursAgo', { count: hours })
  return t('time.daysAgo', { count: Math.floor(hours / 24) })
}
