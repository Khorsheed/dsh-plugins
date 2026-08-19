/**
 * The room task board: a `conversation.input.dock` entry — the same seat the
 * official todo strip occupies (a full-width row above the composer card,
 * stacked with it when both have content). The board is the HUMAN's
 * management view of the journal-driven `room/task-*` fold: tasks grouped by
 * member, close buttons on open rows, and an add row. It never enters any
 * member's prompt. Renders only while the current session is a cached room.
 */
import { useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import type { RoomTask } from '../types.ts'
import { memberColor } from './member-color.ts'
import type { RoomTaskDockProps } from './slots.ts'
import css from './RoomTaskDock.module.css'

/** Glyph text per status (the dock row's leading cell). */
function statusLabel(status: RoomTask['status'], t: RoomTaskDockProps['t']): string {
  switch (status) {
    case 'pending': return t('tasks.status.pending')
    case 'in_progress': return t('tasks.status.in_progress')
    case 'done': return t('tasks.status.done')
    case 'cancelled': return t('tasks.status.cancelled')
  }
}

/** The task board dock strip. */
export function RoomTaskDock({ sessionId, roomStore, addTask, closeTask, t }: RoomTaskDockProps): ReactNode {
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  const [collapsed, setCollapsed] = useState(true)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftMember, setDraftMember] = useState('')
  const [error, setError] = useState<string | null>(null)

  // A cache miss (first pull in flight) or a non-room: the strip vanishes.
  if (state === undefined || roomStore.isRoomCached(sessionId) !== true) return null

  const open = state.tasks.filter(task => task.status === 'pending' || task.status === 'in_progress')
  const closed = state.tasks.length - open.length
  const members = state.members
  const chosen = members.some(member => member.name === draftMember)
    ? draftMember
    : (members[0]?.name ?? '')

  const add = async (): Promise<void> => {
    const title = draftTitle.trim()
    if (title === '' || chosen === '') return
    const outcome = await addTask(chosen, title)
    if (!outcome.ok) {
      setError(outcome.message)
      return
    }
    setDraftTitle('')
    setError(null)
  }

  const onAddKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void add()
    }
  }

  return (
    <section className={css.root} aria-label={t('tasks.title')}>
      <button
        type="button"
        className={css.header}
        aria-expanded={!collapsed}
        onClick={() => { setCollapsed(value => !value) }}
      >
        <span className={css.title}>{t('tasks.title')}</span>
        <span className={css.summary}>
          {open.length > 0 ? t('tasks.summary.open', { count: open.length }) : ''}
          {open.length > 0 && closed > 0 ? ' · ' : ''}
          {closed > 0 ? t('tasks.summary.closed', { count: closed }) : ''}
          {state.tasks.length === 0 ? t('tasks.empty') : ''}
        </span>
        <span className={css.chevron} aria-hidden>{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div className={css.body}>
          {members.map((member) => {
            const own = state.tasks.filter(task => task.member === member.name)
            if (own.length === 0) return null
            return (
              <div key={member.name} className={css.group}>
                <div className={css.member}>
                  <span className={css.dot} style={{ background: memberColor(member.name) }} aria-hidden />
                  {member.name}
                </div>
                <ul className={css.list}>
                  {own.map(task => (
                    <li key={task.id} className={css.item} data-status={task.status}>
                      <span className={css.status}>{statusLabel(task.status, t)}</span>
                      <span className={css.taskTitle}>{task.title}</span>
                      {(task.status === 'pending' || task.status === 'in_progress') && (
                        <button
                          type="button"
                          className={css.action}
                          onClick={() => { void closeTask(task.id) }}
                        >
                          {t('tasks.close')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
          <div className={css.addRow}>
            <select
              className={css.memberSelect}
              aria-label={t('tasks.addMember')}
              value={chosen}
              onChange={event => { setDraftMember(event.target.value) }}
            >
              {members.map(member => (
                <option key={member.name} value={member.name}>{member.name}</option>
              ))}
            </select>
            <input
              className={css.input}
              value={draftTitle}
              placeholder={t('tasks.addPlaceholder')}
              onChange={event => { setDraftTitle(event.target.value) }}
              onKeyDown={onAddKeyDown}
            />
            <button
              type="button"
              className={css.action}
              disabled={draftTitle.trim() === '' || chosen === ''}
              onClick={() => { void add() }}
            >
              {t('tasks.add')}
            </button>
          </div>
          {error !== null && <div className={css.error} role="alert">{error}</div>}
        </div>
      )}
    </section>
  )
}
