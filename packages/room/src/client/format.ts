/** Small clock/duration formatters for the room chat chrome. */

/**
 * The honest run/dispatch duration: sub-second as `0.x s`, then whole
 * seconds, then `m:ss`.
 * @param ms - the duration in milliseconds.
 * @returns the formatted duration.
 */
export function formatDurationMs(ms: number): string {
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
