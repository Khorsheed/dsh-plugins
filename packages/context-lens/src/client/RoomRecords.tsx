/**
 * What a room round shows when its records do not say which member requests
 * are its (`TurnListItem.room.unrecorded`): the plain statement, and a way
 * into each member's own lens at that time span. A session where no round is
 * recorded says it once, at the top. And, on a recorded round's member view,
 * what its execution recorded about itself: why it ran and what its source
 * does not report. Nothing here is inferred; every line is a written fact or
 * the absence of one.
 */
import type { ReactNode } from 'react'
import type { AgentScopeOverview, ContinuesInfo, ExecutionFacts, RoomFallbackMember } from '../types.ts'
import type { InspectorTabProps } from './contract.ts'
import css from './RoomRecords.module.css'
type T = InspectorTabProps['t']
type Key = Parameters<T>[0]

const UNRECORDED_KEYS: Record<string, Key> = {
  'usage': 'unrec.usage',
  'before-after': 'unrec.before-after',
  'summary': 'unrec.summary',
  'internal-calls': 'unrec.internal-calls',
  'call-boundaries': 'unrec.call-boundaries',
  'per-call-usage': 'unrec.per-call-usage',
  'compaction': 'unrec.compaction',
}

/** A not-recorded declaration list as one readable line (unknown items stay as written). */
export function unrecordedText(items: readonly string[], t: T): string {
  return items.map(item => UNRECORDED_KEYS[item] === undefined ? item : t(UNRECORDED_KEYS[item])).join('、')
}

/** The session-wide notice: no round in this room carries records. */
export function RoomRecordsNotice({ t }: { readonly t: T }): ReactNode {
  return <div className={css.notice} role="note">{t('room.fallbackSession')}</div>
}

/** An unrecorded round's body: the statement (unless the session notice already made it) and one door per member. */
export function RoomFallbackCard({ members, repeatTitle, onOpen, t }: {
  readonly members: readonly RoomFallbackMember[]
  /** False when the session-wide notice already says it: then only the doors. */
  readonly repeatTitle: boolean
  readonly onOpen?: ((member: RoomFallbackMember) => void) | undefined
  readonly t: T
}): ReactNode {
  return <div className={css.card} role="status">
    {repeatTitle && <b className={css.title}>{t('room.fallbackTitle')}</b>}
    {repeatTitle && <p className={css.body}>{t('room.fallbackBody')}</p>}
    <div className={css.doors}>
      {members.map((member, index) => member.sessionId === undefined || onOpen === undefined
        ? <span key={index} className={css.muted}>{t('room.fallbackNoSession', { name: member.name })}</span>
        : <button key={index} type="button" className={css.door} onClick={() => onOpen(member)}>{t('room.fallbackOpen')} · {member.name}</button>)}
    </div>
  </div>
}

/** The 未归轮 group's one-line explanation. */
export function UnattributedNote({ t }: { readonly t: T }): ReactNode {
  return <div className={css.notice} role="note">{t('room.unattributedNote')}</div>
}

const CONTINUES_KEYS: Record<string, Key> = {
  completed: 'cont.completed',
  failed: 'cont.failed',
  timed_out: 'cont.timed_out',
  killed: 'cont.killed',
}

/** A self-started round's one phrase by how its background task ended: 后台任务完成后继续 / 失败后 / 超时后 / …. */
export function continuesText(taskStatus: string | undefined, t: T): string {
  return t(CONTINUES_KEYS[taskStatus ?? ''] ?? 'cont.other')
}

/** A self round's view name beside its member: 「kimi · 后台任务完成后继续」, numbered when one round holds several. */
export function selfRoundLabel(scope: Pick<AgentScopeOverview, 'label' | 'scopeId'> & { continues: ContinuesInfo }, t: T): string {
  return `${scope.label ?? scope.scopeId} · ${continuesText(scope.continues.taskStatus, t)}${scope.continues.index === undefined ? '' : ` ${scope.continues.index}`}`
}

function causeText(execution: ExecutionFacts, t: T): string {
  switch (execution.cause) {
    case undefined: return t('exec.cause.none')
    case 'member': return t('exec.cause.member', { name: execution.fromMember ?? '' })
    case 'help': return t('exec.cause.help', { room: execution.fromRoom ?? '' })
    case 'human': return t('exec.cause.human')
    case 'decision': return t('exec.cause.decision')
    case 'execution': return t('exec.cause.execution')
    case 'tool-call': return t('exec.cause.tool-call')
    case 'restart': return t('exec.cause.restart')
    case 'self': return t('exec.cause.self', { continues: continuesText(execution.taskStatus, t) })
    default: return execution.cause
  }
}

/** A recorded member run's own facts: its cause, and what its source does not report. */
export function ExecutionNote({ execution, t }: { readonly execution: ExecutionFacts; readonly t: T }): ReactNode {
  const unrecorded = execution.unrecorded ?? []
  return <div className={css.facts}>
    <span>{t('exec.cause', { cause: causeText(execution, t) })}</span>
    {unrecorded.length > 0 && <span>{t('exec.unrecorded', { items: unrecordedText(unrecorded, t) })}</span>}
    {unrecorded.includes('call-boundaries') && <span className={css.warn}>{t('exec.callBoundaries')}</span>}
  </div>
}
