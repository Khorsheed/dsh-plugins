/**
 * The daily-refresh clock: pure date math, deliberately separated from the
 * service that arms it.
 *
 * There is no host scheduler to hang a "refresh every morning" job on — the
 * host's `ctx.timer` is fiber-scoped `timeout`/`interval`/`throttle`/`debounce`
 * only, and `dsh-schedule` is agent-session reminders rather than a service a
 * plugin may schedule against. So the plugin owns a `setTimeout` and the only
 * interesting part is deciding *when* — which is what lives here, as functions
 * that take a `now` and are therefore testable without a clock.
 *
 * @module @khorsheed/dsh-reader/schedule
 */

/** Local time of day as `HH:MM`. */
export type TimeOfDay = string

/** Milliseconds in one day. */
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Parse an `HH:MM` string into hours and minutes.
 *
 * A malformed value falls back to the caller's default rather than throwing: a
 * hand-edited state file must not be able to break the refresh loop.
 *
 * @param value - the configured time of day.
 * @param fallback - the value to use when `value` is unusable.
 * @returns the parsed hour and minute.
 */
export function parseTimeOfDay(value: string | undefined, fallback: TimeOfDay): { hour: number; minute: number } {
  return parseOrFallback(value) ?? parseOrFallback(fallback) ?? { hour: 10, minute: 0 }
}

/** Parse one candidate, or `undefined` when it is not a valid `HH:MM`. */
function parseOrFallback(value: string | undefined): { hour: number; minute: number } | undefined {
  if (value === undefined) return undefined
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (match === null) return undefined
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return undefined
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined
  return { hour, minute }
}

/**
 * The next wall-clock occurrence of `timeOfDay` strictly after `now`.
 *
 * Computed through the local-time constructor rather than by adding a fixed
 * day length, so a DST shift moves the refresh to the same wall-clock time
 * instead of drifting an hour.
 *
 * @param now - the reference instant.
 * @param timeOfDay - the configured local time.
 * @returns the next occurrence.
 */
export function nextOccurrence(now: Date, timeOfDay: TimeOfDay): Date {
  const { hour, minute } = parseTimeOfDay(timeOfDay, '10:00')
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0)
  if (candidate.getTime() > now.getTime()) return candidate
  // Already past today: step to tomorrow through the constructor so the local
  // calendar does the arithmetic (month ends, DST, leap days).
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, hour, minute, 0, 0)
}

/**
 * The most recent occurrence of `timeOfDay` at or before `now` — the deadline
 * a catch-up refresh compares against.
 *
 * @param now - the reference instant.
 * @param timeOfDay - the configured local time.
 * @returns the most recent occurrence.
 */
export function previousOccurrence(now: Date, timeOfDay: TimeOfDay): Date {
  const { hour, minute } = parseTimeOfDay(timeOfDay, '10:00')
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0)
  if (today.getTime() <= now.getTime()) return today
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, hour, minute, 0, 0)
}

/** Delay to the next occurrence, clamped to Node's timer ceiling. */
export const MAX_TIMEOUT_MS = 2_147_483_647

/**
 * Whether a boot should refresh immediately because the last run missed its
 * slot — the thing that makes "daily refresh" true on a machine that was
 * asleep or whose process restarted.
 *
 * @param lastRun - the last completed refresh, if any.
 * @param now - the current instant.
 * @param timeOfDay - the configured local time.
 * @param enabled - whether the schedule is on at all.
 * @returns true when a catch-up run is due.
 */
export function isCatchUpDue(lastRun: Date | undefined, now: Date, timeOfDay: TimeOfDay, enabled: boolean): boolean {
  if (!enabled) return false
  // Never refreshed: the first refresh belongs to the user's first action or to
  // the next slot, not to a boot-time stampede of every configured feed.
  if (lastRun === undefined) return false
  return previousOccurrence(now, timeOfDay).getTime() > lastRun.getTime()
}

/**
 * The timer delay for the next occurrence, capped so a scheduler survives
 * dates beyond the 32-bit millisecond limit.
 *
 * @param now - the reference instant.
 * @param timeOfDay - the configured local time.
 * @returns the delay in milliseconds.
 */
export function delayUntilNext(now: Date, timeOfDay: TimeOfDay): number {
  const delta = nextOccurrence(now, timeOfDay).getTime() - now.getTime()
  return Math.min(Math.max(0, delta), MAX_TIMEOUT_MS)
}

/** Exposed for tests that want to assert a day's worth of arithmetic. */
export { DAY_MS }
