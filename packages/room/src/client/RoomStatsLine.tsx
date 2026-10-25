/**
 * The room session's stats row — a RoomComposer footer replicating the
 * official StatsLine (harness ui-conversation chat/StatsLine.tsx), which
 * lives inside the InputBar fallback the composer takeover hides. Every
 * figure rides the durable whole-log projections through the framework's
 * `useProjection` seat: `sessionStats` for turn/step counts and wall times,
 * `tokenUsage` for billing. A key with no served value drops its groups;
 * with neither projection served the row does not render at all (silent
 * degrade). Unlike the official row there is no window-fold fallback — the
 * takeover has no business re-deriving what the host already projects.
 *
 * Semantics: the projected figures are the ROOM SESSION's own — its main
 * agent's turns and billing. Members consume in their own child sessions, so
 * when the room has member runs the row adds a members chip (how many
 * members worked, their billed tokens) whose breakdown lists each member's
 * model, rounds, tokens and run time from the room's execution records.
 */
import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: merges the sessionStats key into SessionProjectionMap for useProjection.
import type {} from '@deepseek-ai/dsh-session-stats/client'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { RoomComposerProps } from './slots.ts'
import type { RoomState } from '../types.ts'
import css from './RoomStatsLine.module.css'

/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three
 * digits). Copied from the official StatsLine.
 * @param n - token count.
 * @returns display string.
 */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/**
 * Compact duration: 45.2s under a minute, 2m42s from there on. Copied from
 * the official StatsLine.
 * @param ms - duration in milliseconds.
 * @returns display string.
 */
export function formatDuration(ms: number): string {
  const s = ms / 1_000
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/**
 * Throughput figure: integer at 10+, one decimal below. Copied from the
 * official message-chrome formatTokensPerSecond.
 * @param tps - tokens per second.
 * @returns display number without unit.
 */
export function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps)
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
}

/**
 * Sum the three disjoint prompt-side billing buckets. Copied from the
 * official StatsLine.
 * @param usage - the session's token-usage projection value.
 * @returns billed input tokens.
 */
export function billedInputTokens(usage: TokenUsageProjection): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/**
 * Cache-hit share of prompt-side input over the whole durable log. Copied
 * from the official StatsLine.
 * @param usage - the session's token-usage projection value.
 * @returns rounded integer percent, or null when no input was billed.
 */
export function cacheHitPercent(usage: TokenUsageProjection): number | null {
  const denominator = billedInputTokens(usage)
  return denominator === 0
    ? null
    : Math.round(usage.cacheReadTokens / denominator * 100)
}

/** One member's share of the room's work. */
export interface MemberUsage {
  readonly member: string
  readonly model?: string
  readonly rounds: number
  readonly tokens: number
  readonly elapsedMs: number
}

/**
 * Per-member usage from the room's execution records: every run but the
 * main agent's (its turns are the projected figures already), in roster
 * order. Members without a run do not appear.
 * @param state - the replayed room state.
 * @returns one row per member that ran.
 */
export function memberUsage(state: RoomState | undefined): readonly MemberUsage[] {
  if (state === undefined) return []
  const main = new Set(state.members.filter(member => member.kind === 'main-agent').map(member => member.name))
  const rows = new Map<string, { member: string; model?: string; rounds: number; tokens: number; elapsedMs: number }>()
  for (const run of state.executions ?? []) {
    if (main.has(run.member)) continue
    const row = rows.get(run.member) ?? { member: run.member, rounds: 0, tokens: 0, elapsedMs: 0 }
    row.rounds += 1
    row.tokens += run.tokens ?? 0
    row.elapsedMs += run.elapsedMs ?? 0
    if (run.model !== undefined) row.model = run.model
    rows.set(run.member, row)
  }
  const order = state.members.map(member => member.name)
  return [...rows.values()].sort((a, b) => order.indexOf(a.member) - order.indexOf(b.member))
}

/** Props: the projection read seat, the room state, and the room locale seat. */
export interface RoomStatsLineProps {
  readonly useProjection: UseProjection
  /** The room's replayed state: the members chip reads its execution records. */
  readonly state?: RoomState | undefined
  readonly t: RoomComposerProps['t']
}

export const RoomStatsLine = memo(function RoomStatsLine({ useProjection, state, t }: RoomStatsLineProps): ReactNode {
  const members = memberUsage(state)
  const [open, setOpen] = useState(false)
  const membersRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent | KeyboardEvent): void => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : membersRef.current?.contains(event.target as Node) !== true) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close) }
  }, [open])
  const stats = useProjection('sessionStats')
  const usage = useProjection('tokenUsage')
  // Pipe-separated groups, mirroring the official assembly; a group with no
  // data drops out whole.
  const groups: string[] = []
  if (stats !== undefined && stats.steps > 0) {
    groups.push(t('stats.counts', { turns: stats.turns, steps: stats.steps }))
    const durations: string[] = []
    if (stats.llmMs > 0) durations.push(t('stats.llm', { duration: formatDuration(stats.llmMs) }))
    if (stats.toolMs > 0) durations.push(t('stats.toolCall', { duration: formatDuration(stats.toolMs) }))
    if (durations.length > 0) groups.push(durations.join(' · '))
    const speeds: string[] = []
    if (stats.ttftSteps > 0) {
      speeds.push(t('stats.ttftAverage', { duration: formatDuration(stats.ttftMs / stats.ttftSteps) }))
    }
    if (stats.decodeMs > 0) {
      speeds.push(t('stats.tokensPerSecond', {
        throughput: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000)),
      }))
    }
    if (speeds.length > 0) groups.push(speeds.join(' · '))
  }
  // Gated on actual token activity, as upstream: a session whose steps all
  // settled without billing shows its counts without a zero-token group.
  if (usage !== undefined
    && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
    const cacheHit = cacheHitPercent(usage)
    if (cacheHit !== null) groups.push(t('stats.cacheHit', { percent: cacheHit }))
    groups.push(t('stats.tokens', {
      input: formatTokens(billedInputTokens(usage)),
      output: formatTokens(usage.outputTokens),
    }))
  }
  const line = groups.join(' | ')
  // The row elides with ellipsis when overlong; a delayed hover tooltip
  // carries the full line, enabled only while content is actually clipped
  // (the official StatsLine behavior).
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [truncated, setTruncated] = useState(false)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (el === null) return
    const measure = (): void => { setTruncated(el.scrollWidth > el.clientWidth) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [line])
  if (groups.length === 0 && members.length === 0) return null
  const own = groups.length === 0 ? null : (
    <Tooltip label={line} side="top" delayMs={500} disabled={!truncated}>
      <div ref={rootRef} className={css.root}>
        {groups.map((group, i) => (
          <Fragment key={group}>
            {i > 0 && <><span className={css.sep} aria-hidden>|</span>{' '}</>}
            <span>{group}</span>
          </Fragment>
        ))}
      </div>
    </Tooltip>
  )
  if (members.length === 0) return own
  const total = members.reduce((sum, row) => sum + row.tokens, 0)
  return (
    <div className={css.withMembers} ref={membersRef}>
      {own}
      {own !== null && <span className={css.sep} aria-hidden>|</span>}
      <button type="button" className={css.membersChip} aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        {total > 0 ? t('stats.members', { count: members.length, tokens: formatTokens(total) }) : t('stats.membersNoTokens', { count: members.length })} ▾
      </button>
      {open && (
        <div className={css.breakdown} role="dialog" aria-label={t('stats.membersTitle')}>
          <table>
            <thead><tr><th>{t('stats.col.member')}</th><th>{t('stats.col.model')}</th><th className={css.num}>{t('stats.col.rounds')}</th><th className={css.num}>{t('stats.col.tokens')}</th><th className={css.num}>{t('stats.col.time')}</th></tr></thead>
            <tbody>
              {members.map(row => (
                <tr key={row.member}>
                  <td className={css.name}>{row.member}</td>
                  <td>{row.model ?? '—'}</td>
                  <td className={css.num}>{row.rounds}</td>
                  <td className={css.num}>{row.tokens > 0 ? formatTokens(row.tokens) : '—'}</td>
                  <td className={css.num}>{row.elapsedMs > 0 ? formatDuration(row.elapsedMs) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
})
