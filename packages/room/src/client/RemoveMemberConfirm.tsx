/**
 * The in-card removal confirmation: replaces the browser's native confirm
 * with a layer anchored on the member's own card that states what removing
 * THIS member will actually do — stop its running round, cancel its queued
 * messages, close (or hand over) its open tasks, tell whoever waits for its
 * report — and then does exactly that (RoomService.removeMember). An idle
 * member with nothing pending gets one sentence. The current coordinator
 * cannot be removed: the layer says why and how instead of offering a
 * button that would only fail. Esc and an outside click cancel; focus opens
 * on 取消 so a stray Enter never removes anyone.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { RoomMember, RoomState } from '../types.ts'
import type { MembersViewProps } from './slots.ts'
import css from './RemoveMemberConfirm.module.css'

/** What a removal would touch, read from the replayed room state. */
export interface RemovalImpact {
  /** The running round's task title ('' when running without a board row); undefined when idle. */
  readonly running: string | undefined
  readonly queued: number
  readonly inProgress: number
  readonly pending: number
  /** Members waiting on one of this member's reports. */
  readonly waiting: readonly string[]
}

/**
 * Read a removal's consequences from the room state the members tab holds.
 * @param state - the replayed room state.
 * @param member - the member about to be removed.
 * @returns the impact summary.
 */
export function removalImpact(state: RoomState, member: RoomMember): RemovalImpact {
  const run = state.runs.find(entry => entry.member === member.name && entry.state === 'running')
  const id = member.id
  const open = (state.deliveries ?? []).filter(row => row.memberId === id && (row.status === 'queued' || row.status === 'running'))
  const coordinator = state.coordinator === undefined
    ? state.members.find(entry => entry.kind === 'main-agent')
    : state.members.find(entry => entry.id === state.coordinator!.memberId)
  const waiting = new Set<string>()
  for (const row of open) {
    const target = row.plan !== undefined ? coordinator : state.members.find(entry => entry.id !== undefined && entry.id === row.replyTo)
    if (target !== undefined && target.name !== member.name) waiting.add(target.name)
  }
  const tasks = state.tasks.filter(task => task.member === member.name)
  return {
    running: run === undefined ? undefined : tasks.find(task => task.status === 'in_progress' && task.deliveryId === run.runId)?.title ?? '',
    queued: open.filter(row => row.status === 'queued').length,
    inProgress: tasks.filter(task => task.status === 'in_progress').length,
    pending: tasks.filter(task => task.status === 'pending').length,
    waiting: [...waiting],
  }
}

/** The confirmation layer. */
export function RemoveMemberConfirm({
  member, impact, coordinator, heirs, onConfirm, onCancel, t,
}: {
  readonly member: RoomMember
  readonly impact: RemovalImpact
  /** True when this member is the current coordinator (not removable). */
  readonly coordinator: boolean
  /** Members that may take over pending tasks. */
  readonly heirs: readonly string[]
  readonly onConfirm: (transferPendingTo: string | undefined) => Promise<void>
  readonly onCancel: () => void
  readonly t: MembersViewProps['t']
}): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const [heir, setHeir] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onCancel() }
    const onDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onCancel()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onCancel])

  const title = t('remove.title', { member: member.name })
  if (coordinator) {
    return (
      <div ref={ref} className={css.layer} role="dialog" aria-label={title}>
        <p className={css.title}>{title}</p>
        <p className={css.body}>{t('remove.coordinator')}</p>
        <div className={css.actions}>
          <button type="button" className={css.secondary} autoFocus onClick={onCancel}>{t('remove.ok')}</button>
        </div>
      </div>
    )
  }
  const lines: ReactNode[] = []
  if (impact.running !== undefined) {
    lines.push(impact.running === '' ? t('remove.running') : t('remove.runningTask', { task: impact.running }))
  }
  if (impact.queued > 0) lines.push(t('remove.queued', { count: impact.queued }))
  if (impact.inProgress > 0) lines.push(t('remove.inProgress', { count: impact.inProgress }))
  if (impact.pending > 0) {
    lines.push(
      <span className={css.pendingRow}>
        {t('remove.pending', { count: impact.pending })}
        <select className={css.select} value={heir} onChange={(event) => { setHeir(event.target.value) }}>
          <option value="">{t('remove.pendingCancel')}</option>
          {heirs.map(name => <option key={name} value={name}>{t('remove.pendingTransfer', { member: name })}</option>)}
        </select>
      </span>,
    )
  }
  if (impact.waiting.length > 0) lines.push(t('remove.waiting', { members: impact.waiting.join('、') }))
  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try { await onConfirm(heir === '' ? undefined : heir) } finally { setBusy(false) }
  }
  return (
    <div ref={ref} className={css.layer} role="dialog" aria-label={title}>
      <p className={css.title}>{title}</p>
      {lines.length === 0
        ? <p className={css.body}>{t('remove.idle')}</p>
        : <ul className={css.list}>{lines.map((line, index) => <li key={index}>{line}</li>)}</ul>}
      <p className={css.note}>{t('remove.keep')}</p>
      <div className={css.actions}>
        <button type="button" className={css.secondary} autoFocus onClick={onCancel}>{t('remove.cancel')}</button>
        <button type="button" className={css.danger} disabled={busy} onClick={() => { void confirm() }}>
          {impact.running !== undefined ? t('remove.stopAndRemove') : t('remove.confirm')}
        </button>
      </div>
    </div>
  )
}
