/**
 * Members' background activity surfaces (member-self-started-rounds M2; UI
 * source of truth: proposals/prototypes/member-activity.html): the
 * composer's 「后台 N」 capsule and its tray grouped by member, the members
 * page's read-only line, and the member session's card for a background
 * command — one card shell (icon · type · description · status/elapsed ·
 * actions; expanded = the kind's own body) that background subagents reuse
 * later. Read-only: the tray and the cards only jump, never stop or rerun.
 *
 * The data is local-agent's `memberBackgroundTasks` read, duck-typed through
 * the room's own gateway probe: a composition without the family, a core
 * without the read, or a harness answering `supported: false` renders
 * nothing anywhere. One store polls each subscribed member on the room's
 * existing 4 s cadence while a surface shows it, and stops polling a member
 * whose read says it is not a member or not supported.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { LocalAgentBackgroundTasks } from '@khorsheed/dsh-local-agent/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RoomState } from '../types.ts'
import { formatClock } from './format.ts'
import {
  activityAction, activityElapsed, activityGroups, activityStrip, activityTotals, durationParts, memberActivityLine,
  type ActivityGroup, type ActivityItem, type ActivityRead,
} from './member-activity-view.ts'
import css from './MemberActivity.module.css'

type T = TranslateNS<'room'>

/** The member read the store polls (local-agent's Remote, duck-typed). */
export type MemberActivityRead = (childSessionId: string) => Promise<LocalAgentBackgroundTasks | null | undefined>

/** The room's existing light poll cadence (the pending-cards sync). */
export const MEMBER_ACTIVITY_POLL_MS = 4_000

interface Entry {
  subscribers: number
  value: LocalAgentBackgroundTasks | null | undefined
  timer: ReturnType<typeof setInterval> | undefined
  inFlight: boolean
}

/**
 * Shared reads per member session: subscribing starts a read now and a poll
 * at {@link MEMBER_ACTIVITY_POLL_MS}; the last unsubscribe stops it. A read
 * answering null (not a member) or `supported: false` stops that member's
 * poll — it shows nothing either way; the next subscribe reads again.
 */
export class MemberActivityStore {
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Set<() => void>()
  private version = 0

  constructor(private readonly read: MemberActivityRead, private readonly intervalMs = MEMBER_ACTIVITY_POLL_MS) {}

  /** Follow these member sessions until the returned function is called. */
  follow(ids: readonly string[]): () => void {
    for (const id of ids) {
      let entry = this.entries.get(id)
      if (entry === undefined) this.entries.set(id, entry = { subscribers: 0, value: undefined, timer: undefined, inFlight: false })
      entry.subscribers += 1
      if (entry.subscribers === 1) {
        void this.pull(id)
        entry.timer = setInterval(() => { void this.pull(id) }, this.intervalMs)
      }
    }
    return () => {
      for (const id of ids) {
        const entry = this.entries.get(id)
        if (entry === undefined) continue
        entry.subscribers -= 1
        if (entry.subscribers > 0) continue
        if (entry.timer !== undefined) clearInterval(entry.timer)
        entry.timer = undefined
      }
    }
  }

  /** The member's latest read (undefined before the first one lands). */
  get(id: string): LocalAgentBackgroundTasks | null | undefined {
    return this.entries.get(id)?.value
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getVersion = (): number => this.version

  private async pull(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (entry === undefined || entry.inFlight) return
    entry.inFlight = true
    let value: LocalAgentBackgroundTasks | null | undefined
    try {
      value = await this.read(id)
    } catch {
      value = undefined
    } finally {
      entry.inFlight = false
    }
    if ((value === null || value?.supported === false) && entry.timer !== undefined) {
      clearInterval(entry.timer)
      entry.timer = undefined
    }
    if (JSON.stringify(entry.value) === JSON.stringify(value)) return
    entry.value = value
    this.version += 1
    for (const listener of this.listeners) listener()
  }
}

/**
 * Follow the given member sessions; re-renders on every changed read.
 * @param store - the shared store (absent = nothing to follow).
 * @param ids - member session ids.
 */
export function useMemberActivity(store: MemberActivityStore | undefined, ids: readonly string[]): number {
  const key = ids.join('\n')
  useEffect(() => store?.follow(key === '' ? [] : key.split('\n')), [store, key])
  return useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getVersion ?? zero, store?.getVersion ?? zero)
}
const noopSubscribe = (): (() => void) => () => {}
const zero = (): number => 0

/**
 * Hand-off between the tray (in the room) and the card (in the member's
 * session, rendered after the jump): the tray asks, the card that mounts
 * with that task takes the request, scrolls itself into view, and opens
 * its body when asked to.
 */
export class ActivityReveals {
  private pending: { readonly taskId: string; readonly expand: boolean; readonly at: number } | undefined

  request(taskId: string, expand: boolean): void {
    this.pending = { taskId, expand, at: Date.now() }
  }

  /** The request for this task, taken once (stale after 30 s). */
  take(taskId: string): { readonly expand: boolean } | undefined {
    const pending = this.pending
    if (pending === undefined || pending.taskId !== taskId || Date.now() - pending.at > 30_000) return undefined
    this.pending = undefined
    return { expand: pending.expand }
  }
}

/** What the room's surfaces need to show and follow members' activity. */
export interface MemberActivityFace {
  readonly store: MemberActivityStore
  readonly reveals: ActivityReveals
}

/* ------------------------------------------------------------- copy */

function durationText(ms: number, precise: boolean, t: T): string {
  const parts = durationParts(ms, precise)
  return t(`bg.time.${parts.key}`, parts.vars as Record<string, string>)
}

/** The status pill's words: status, then elapsed (or the exit code once a card has one). */
export function statusText(item: ActivityItem, now: number, t: T, exit = false): string {
  const elapsed = activityElapsed(item, now)
  // Ended work reads to the second (3 分 05 秒); running and lost work in whole minutes.
  const time = elapsed === undefined ? '' : durationText(elapsed, item.status !== 'running' && item.status !== 'lost', t)
  switch (item.status) {
    case 'running': return t('bg.status.running', { time })
    case 'done': return exit && item.exitCode !== undefined ? t('bg.status.doneExit', { code: String(item.exitCode) }) : t('bg.status.done', { time })
    case 'failed':
      if (item.timedOut === true) return t('bg.status.timedOut', { time })
      return exit && item.exitCode !== undefined ? t('bg.status.failedExit', { code: String(item.exitCode) }) : t('bg.status.failed', { time })
    case 'lost': return elapsed === undefined ? t('bg.status.lost') : t('bg.status.lostRan', { time })
    case 'cancelled': return elapsed === undefined ? t('bg.status.cancelled') : t('bg.status.cancelledAfter', { time })
  }
}

function lostText(item: ActivityItem, t: T): string {
  return t('bg.lost.line', { reason: t(`bg.lost.${item.lostBecause ?? 'unknown'}`), detail: t('bg.lost.detail') })
}

/** The tray item's second line: kind · who started it · what happened since. */
function itemDetail(item: ActivityItem, t: T): string {
  const parts = [t(item.kind === 'command' ? 'bg.kind.command' : 'bg.kind.subagent')]
  if (item.dispatcher !== undefined) parts.push(item.dispatcher.kind === 'human' ? t('bg.by.human') : t('bg.by.member', { name: item.dispatcher.name }))
  if (item.status === 'lost') parts.push(lostText(item, t))
  else if (item.status !== 'running' && item.resultAt !== undefined) parts.push(t('bg.result.at', { time: formatClock(item.resultAt) }))
  return parts.join(' · ')
}

/** The status pill (dot while running). */
export function StatusPill({ item, now, t, exit = false }: { readonly item: ActivityItem; readonly now: number; readonly t: T; readonly exit?: boolean }): ReactNode {
  return (
    <span className={css.pill} data-status={item.status}>
      {item.status === 'running' && <span className={css.dot} aria-hidden />}
      {statusText(item, now, t, exit)}
    </span>
  )
}

const ICON: Readonly<Record<ActivityItem['kind'], string>> = { command: '>_', subagent: '◇' }

/* ------------------------------------------------------------- composer */

/** The composer capsule 「后台 N」 (amber when something was lost). Renders nothing when hidden. */
export function ActivityCapsule({ groups, open, onToggle, t }: {
  readonly groups: readonly ActivityGroup[]; readonly open: boolean; readonly onToggle: () => void; readonly t: T
}): ReactNode {
  const strip = activityStrip(groups)
  if (strip.kind === 'hidden') return null
  const label = strip.kind === 'running'
    ? t('bg.capsule', { count: String(strip.running) })
    : strip.running > 0 ? t('bg.capsule.lostRunning', { count: String(strip.running), lost: String(strip.lost) }) : t('bg.capsule.lost', { lost: String(strip.lost) })
  return (
    <button
      type="button"
      className={css.capsule}
      data-testid="room-activity-capsule"
      {...strip.kind === 'lost' ? { 'data-lost': '' } : {}}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span aria-hidden>{strip.kind === 'lost' ? '⚠' : '◔'}</span>
      {label}
    </button>
  )
}

/** The tray: one group per member, each item with its status, time, starter and one jump. */
export function ActivityTray({ groups, now, jump, onClose, t }: {
  readonly groups: readonly ActivityGroup[]
  readonly now: number
  /** Open the member session at the task's card (`expand`: open its body). */
  readonly jump: (item: ActivityItem, expand: boolean) => void
  readonly onClose: () => void
  readonly t: T
}): ReactNode {
  const totals = activityTotals(groups)
  const summary = [
    ...totals.running > 0 ? [t('bg.tray.running', { count: String(totals.running) })] : [],
    ...totals.lost > 0 ? [t('bg.tray.lost', { count: String(totals.lost) })] : [],
  ].join(' · ')
  return (
    <div className={css.tray} role="region" aria-label={t('bg.tray.title')} data-testid="room-activity-tray">
      <div className={css.trayHead}>
        <span>{t('bg.tray.title')}</span>
        {summary !== '' && <span className={css.hint}>{summary}</span>}
        <button type="button" className={css.close} aria-label={t('bg.tray.close')} onClick={onClose}>×</button>
      </div>
      {groups.map(group => (
        <div key={group.childSessionId} className={css.group}>
          <div className={css.groupHead}>
            <span className={css.groupName}>{group.member}</span>
            {group.provider !== undefined && <span className={css.provider}>{group.provider}</span>}
            {group.keepAliveUntil !== undefined && <span className={css.keep}>{t('bg.tray.keep', { time: formatClock(group.keepAliveUntil) })}</span>}
          </div>
          {group.items.map((item) => {
            const action = activityAction(item)
            return (
              <div key={item.id} className={css.item} data-status={item.status}>
                <span className={css.icon} aria-hidden>{ICON[item.kind]}</span>
                <div className={css.itemText}>
                  <div className={css.itemName}><b>{item.label}</b><StatusPill item={item} now={now} t={t} /></div>
                  <div className={css.itemDetail}>{itemDetail(item, t)}</div>
                </div>
                <button type="button" className={css.link} onClick={() => { jump(item, action === 'output' || action === 'view') }}>
                  {t(`bg.action.${action}`)}
                </button>
              </div>
            )
          })}
        </div>
      ))}
      <div className={css.hint}>{t('bg.tray.footer')}</div>
    </div>
  )
}

/**
 * The composer's background activity: the capsule (for the capsule row) and
 * the tray (above it), from one shared open state.
 */
export function useRoomActivity(face: MemberActivityFace | undefined, state: RoomState | undefined): {
  readonly groups: readonly ActivityGroup[]
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
} {
  const members = useMemo(() => (state?.members ?? []).filter(member => member.kind === 'cli' && member.childSessionId !== undefined), [state?.members])
  useMemberActivity(face?.store, members.map(member => member.childSessionId!))
  const [open, setOpen] = useState(false)
  const reads: ActivityRead[] = members.map(member => ({ member, read: face?.store.get(member.childSessionId!) }))
  const groups = activityGroups(reads, state)
  // Nothing left to show closes the tray.
  const empty = groups.length === 0
  useEffect(() => { if (empty) setOpen(false) }, [empty])
  return { groups, open: open && !empty, setOpen }
}

/* ------------------------------------------------------------- members page */

/** The members page's read-only line: 「后台：命令 1 · 子智能体 1」, amber when lost; nothing otherwise. */
export function MemberActivityLine({ read, t }: { readonly read: LocalAgentBackgroundTasks | null | undefined; readonly t: T }): ReactNode {
  const line = memberActivityLine(read)
  if (line.kind === 'hidden') return null
  if (line.kind === 'lost') {
    return <div className={css.memberLine} data-lost="" data-testid="member-activity-line"><span aria-hidden>⚠</span>{t('bg.member.lost', { count: String(line.lost) })}</div>
  }
  const parts = [
    ...line.commands > 0 ? [t('bg.member.commands', { count: String(line.commands) })] : [],
    ...line.subagents > 0 ? [t('bg.member.subagents', { count: String(line.subagents) })] : [],
  ].join(' · ')
  return <div className={css.memberLine} data-testid="member-activity-line"><span aria-hidden>◔</span>{t('bg.member.counts', { parts })}</div>
}

/* ------------------------------------------------------------- the card shell */

/**
 * The shared card shell: icon · type · description · status/elapsed ·
 * actions, an optional one-line `now`, and the expanded body. Background
 * commands use it here; background subagents reuse it with their own body.
 */
export function ActivityCardShell({ item, kindLabel, now, t, actions, line, body, exit = false }: {
  readonly item: ActivityItem
  readonly kindLabel: string
  readonly now: number
  readonly t: T
  readonly actions?: ReactNode
  readonly line?: ReactNode
  readonly body?: ReactNode
  readonly exit?: boolean
}): ReactNode {
  return (
    <div className={css.card} data-status={item.status} data-member-activity={item.id}>
      <div className={css.cardHead}>
        <span className={css.icon} aria-hidden>{ICON[item.kind]}</span>
        <span className={css.kind}>{kindLabel}</span>
        <span className={css.desc} title={item.label}>{item.label}</span>
        <StatusPill item={item} now={now} t={t} exit={exit} />
        {actions !== undefined && <span className={css.actions}>{actions}</span>}
      </div>
      {line !== undefined && <div className={css.now}>{line}</div>}
      {body !== undefined && <div className={css.body}>{body}</div>}
    </div>
  )
}

/** A background command's card in the member session: 查看输出 opens the command and its last output lines. */
export function CommandCard({ item, keepAliveUntil, reveals, t }: {
  readonly item: ActivityItem
  readonly keepAliveUntil?: number | undefined
  readonly reveals?: ActivityReveals | undefined
  readonly t: T
}): ReactNode {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const request = reveals?.take(item.id)
    if (request === undefined) return
    if (request.expand) setOpen(true)
    requestAnimationFrame(() => { ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) })
  }, [reveals, item.id])
  const now = Date.now()
  const tail = item.outputTail ?? []
  const last = tail.at(-1)
  const line = open ? undefined
    : item.status === 'lost' ? lostText(item, t)
      : item.status === 'running' && last !== undefined ? <>{t('bg.card.lastOutput')} <span className={css.mono}>{last}</span></> : undefined
  const body = !open ? undefined : (
    <>
      {item.command !== undefined && (
        <div>
          <div className={css.label}>{t('bg.card.command')}</div>
          <div className={css.term}>{item.command}</div>
        </div>
      )}
      <div>
        <div className={css.label}>{t(item.status === 'running' ? 'bg.card.output' : 'bg.card.outputEnded', { count: String(tail.length) })}</div>
        <div className={css.term}>{tail.length === 0 ? t('bg.card.noOutput') : tail.join('\n')}</div>
      </div>
      <div className={css.stats}>
        <span>{t('bg.card.startedAt')} <b>{formatClock(item.startedAt)}</b></span>
        {item.dispatcher !== undefined && <span>{item.dispatcher.kind === 'human' ? t('bg.card.byHuman') : t('bg.card.byMember', { name: item.dispatcher.name })}</span>}
        {item.status === 'running' && keepAliveUntil !== undefined && <span>{t('bg.card.keep')} <b>{formatClock(keepAliveUntil)}</b></span>}
      </div>
    </>
  )
  return (
    <div ref={ref}>
      <ActivityCardShell
        item={item}
        kindLabel={t('bg.kind.command')}
        now={now}
        t={t}
        exit
        line={line}
        body={body}
        actions={<button type="button" className={css.link} aria-expanded={open} onClick={() => { setOpen(value => !value) }}>{open ? t('bg.action.collapse') : t('bg.action.output')}</button>}
      />
    </div>
  )
}
