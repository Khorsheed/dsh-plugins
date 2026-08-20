/**
 * The room dock capsules, rendered by the RoomComposer itself above the input
 * card — the seat of the old task-board strip (NOT a `conversation.input.dock`
 * entry: that slot lives inside the official composer fallback, which the
 * room's composer takeover hides). One collapsed row of two capsules plus a
 * quick-add button:
 *
 * ```
 * [◐ 插件API v2上线 · 2/5]  [▦ 任务 3待办·1进行中]  ＋
 * ```
 *
 * The GOAL capsule carries the room's goal (truncated) and the task progress
 * (done over the countable total — cancelled tasks leave the denominator);
 * without a goal it renders the 「＋ 设定目标」 guide state. It expands into
 * the goal card: the full text with an inline [编辑], a progress bar, and the
 * recent advance records (who finished what, relative time). The TASK capsule
 * carries the aggregate counts and expands into the task panel: member filter
 * chips (全部 = grouped by member, a single member = a flat list), task rows
 * (tri-state glyph + title + member + status/relative time + a row-end
 * [完成]), and an inline add (member select + title + an optional "等谁"
 * dropdown — `blockedBy`, a member name, is DISPLAY ONLY: the blocked row
 * renders grey with a 「等 ada」 tag until that member has no open task left;
 * it never dispatches anything). The trailing ＋ opens the task panel with
 * the add form already expanded. Panels close on a second capsule click or a
 * click outside; no overlay.
 *
 * Visual layer: capsules follow the official `.refChip` register (rounded
 * chip on the tip surface, business-primary-free secondary text), the
 * expanded cards reuse the old strip's TodoPanel port (tip-surface card on
 * the shared dock width axis). Every token reference carries the light-theme
 * literal as fallback; no divider lines anywhere.
 */
import {
  useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode,
} from 'react'
import { taskProgress } from '../journal.ts'
import type { RoomTask } from '../types.ts'
import { formatRelativeTime } from './format.ts'
import { memberColor } from './member-color.ts'
import type { RoomDockCapsulesProps } from './slots.ts'
import css from './RoomDockCapsules.module.css'

/** Glyph tooltip text per status. */
function statusLabel(status: RoomTask['status'], t: RoomDockCapsulesProps['t']): string {
  switch (status) {
    case 'pending': return t('tasks.status.pending')
    case 'in_progress': return t('tasks.status.in_progress')
    case 'done': return t('tasks.status.done')
    case 'cancelled': return t('tasks.status.cancelled')
  }
}

/* The three status glyphs below replicate the official TodoPanel art
   (figma 14×14 artboard, centered in the 16×16 `.glyph` cell). */

function CompletedGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className={css.glyphCompleted}>
      <circle cx="7" cy="7" r="6.4" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M10.9631 5.71411L7.70154 8.97571C7.48011 9.19714 7.27736 9.40099 7.09229 9.54993C6.89742 9.70669 6.66314 9.85279 6.3634 9.90027C6.2049 9.92534 6.04339 9.92534 5.88489 9.90027C5.58515 9.85279 5.35087 9.70669 5.15601 9.54993C4.97093 9.40099 4.76818 9.19714 4.54675 8.97571L3.03516 7.46411L3.96313 6.53613L5.47473 8.04773C5.7169 8.28989 5.86196 8.43389 5.97888 8.52795C6.08597 8.61409 6.10875 8.60701 6.08997 8.604C6.11259 8.60758 6.13571 8.60758 6.15833 8.604C6.13954 8.60701 6.16232 8.61409 6.26941 8.52795C6.38633 8.43389 6.53139 8.28989 6.77356 8.04773L10.0352 4.78613L10.9631 5.71411Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** In-progress: business-blue ring fading out; CSS spins the svg. */
function ProgressGlyph() {
  const gradientId = useId()
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className={css.glyphProgress}>
      <defs>
        <linearGradient id={gradientId} x1="2.5" y1="12" x2="10.5" y2="3.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="7" cy="7" r="6.4" stroke={`url(#${gradientId})`} strokeWidth="1.2" />
    </svg>
  )
}

/** Pending: dashed unstarted ring (figma dash 2.4 2.4). */
function PendingGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className={css.glyphPending}>
      <circle cx="7" cy="7" r="6.4" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.4 2.4" />
    </svg>
  )
}

/** Cancelled has no official glyph: the pending dashed ring in the dimmer tertiary tone. */
function CancelledGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className={css.glyphCancelled}>
      <circle cx="7" cy="7" r="6.4" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.4 2.4" />
    </svg>
  )
}

function StatusGlyph({ status }: { status: RoomTask['status'] }) {
  switch (status) {
    case 'done': return <CompletedGlyph />
    case 'in_progress': return <ProgressGlyph />
    case 'pending': return <PendingGlyph />
    case 'cancelled': return <CancelledGlyph />
  }
}

/**
 * A task is BLOCKED while the member its `blockedBy` names still has an open
 * (pending/in_progress) task — the row greys until the wait is over. The task
 * ITSELF never counts as its own blocker (a "等谁" pointing at the owner
 * would otherwise grey forever). Display only: nothing auto-dispatches when
 * it clears.
 */
function isBlocked(task: RoomTask, tasks: readonly RoomTask[]): boolean {
  return task.blockedBy !== undefined
    && tasks.some(entry => entry.id !== task.id && entry.member === task.blockedBy
      && (entry.status === 'pending' || entry.status === 'in_progress'))
}

/** How many recent advance records the goal card lists. */
const RECENT_ADVANCES = 5

/** One task row of the task panel. */
function TaskRow({ task, tasks, showMember, now, closeTask, t }: {
  readonly task: RoomTask
  readonly tasks: readonly RoomTask[]
  /** Flat (single-member filter) rows repeat the member name; grouped rows don't. */
  readonly showMember: boolean
  readonly now: number
  readonly closeTask: RoomDockCapsulesProps['closeTask']
  readonly t: RoomDockCapsulesProps['t']
}): ReactNode {
  const blocked = isBlocked(task, tasks)
  const open = task.status === 'pending' || task.status === 'in_progress'
  return (
    <li className={css.item} data-status={task.status} data-blocked={blocked || undefined}>
      <span className={css.glyph} title={statusLabel(task.status, t)}>
        <StatusGlyph status={task.status} />
      </span>
      <span className={css.content}>{task.title}</span>
      {showMember && <span className={css.meta}>{task.member}</span>}
      {blocked && <span className={css.blockedTag}>{t('tasks.blocked', { member: task.blockedBy ?? '' })}</span>}
      <span className={css.meta}>
        {statusLabel(task.status, t)} · {formatRelativeTime(task.updatedAt, now, t)}
      </span>
      {open && (
        <button
          type="button"
          className={css.action}
          onClick={() => { void closeTask(task.id) }}
        >
          {t('tasks.close')}
        </button>
      )}
    </li>
  )
}

/** The dock capsules (goal + tasks) with their expanded cards. */
export function RoomDockCapsules({
  sessionId, roomStore, addTask, closeTask, setGoal, t,
}: RoomDockCapsulesProps): ReactNode {
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  const [open, setOpen] = useState<'goal' | 'tasks' | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalDraft, setGoalDraft] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftMember, setDraftMember] = useState('')
  const [draftBlockedBy, setDraftBlockedBy] = useState('')
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)

  // Collapse on any press outside the dock (no overlay; a second click on the
  // capsule toggles too).
  useEffect(() => {
    if (open === null) return
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && event.target instanceof Node
        && !rootRef.current.contains(event.target)) {
        setOpen(null)
        setAddOpen(false)
        setEditingGoal(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => { document.removeEventListener('mousedown', onPointerDown) }
  }, [open])

  // A cache miss (first pull in flight) or a non-room: the dock vanishes.
  if (state === undefined || roomStore.isRoomCached(sessionId) !== true) return null

  const now = Date.now()
  const progress = taskProgress(state.tasks)
  const pending = state.tasks.filter(task => task.status === 'pending').length
  const running = state.tasks.filter(task => task.status === 'in_progress').length
  const members = state.members
  const chosen = members.some(member => member.name === draftMember)
    ? draftMember
    : (members[0]?.name ?? '')
  const advances = state.tasks
    .filter(task => task.status === 'done')
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)

  const toggle = (panel: 'goal' | 'tasks'): void => {
    if (open === panel) {
      setOpen(null)
      setAddOpen(false)
      setEditingGoal(false)
      return
    }
    setOpen(panel)
    setAddOpen(false)
    setEditingGoal(false)
    setError(null)
    if (panel === 'goal' && state.goal === undefined) {
      setGoalDraft('')
      setEditingGoal(true)
    }
  }

  const saveGoal = async (): Promise<void> => {
    const outcome = await setGoal(goalDraft)
    if (!outcome.ok) {
      setError(outcome.message)
      return
    }
    setEditingGoal(false)
    setError(null)
  }

  const add = async (): Promise<void> => {
    const title = draftTitle.trim()
    if (title === '' || chosen === '') return
    const outcome = await addTask(chosen, title, draftBlockedBy === '' ? undefined : draftBlockedBy)
    if (!outcome.ok) {
      setError(outcome.message)
      return
    }
    setDraftTitle('')
    setDraftBlockedBy('')
    setError(null)
  }

  const onAddKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void add()
    }
  }

  const visibleTasks = filter === ''
    ? undefined
    : state.tasks.filter(task => task.member === filter)

  return (
    <section ref={rootRef} className={css.root} aria-label={t('goal.label')}>
      <div className={css.capsules}>
        <button
          type="button"
          className={open === 'goal' ? css.capsuleActive : css.capsule}
          aria-expanded={open === 'goal'}
          aria-label={t('goal.label')}
          onClick={() => { toggle('goal') }}
        >
          <span aria-hidden>◐</span>
          {state.goal === undefined ? (
            <span className={css.capsuleGuide}>{t('goal.set')}</span>
          ) : (
            <>
              <span className={css.capsuleText}>{state.goal}</span>
              <span className={css.capsuleMeta}>{progress.done}/{progress.total}</span>
            </>
          )}
        </button>
        <button
          type="button"
          className={open === 'tasks' ? css.capsuleActive : css.capsule}
          aria-expanded={open === 'tasks'}
          aria-label={t('tasks.capsule')}
          onClick={() => { toggle('tasks') }}
        >
          <span aria-hidden>▦</span>
          <span className={css.capsuleText}>{t('tasks.capsule')}</span>
          <span className={css.capsuleMeta}>
            {pending > 0 ? t('tasks.summary.pending', { count: pending }) : ''}
            {pending > 0 && running > 0 ? '·' : ''}
            {running > 0 ? t('tasks.summary.running', { count: running }) : ''}
          </span>
        </button>
        <button
          type="button"
          className={css.addCapsule}
          aria-label={t('tasks.addTrigger')}
          onClick={() => {
            setOpen('tasks')
            setAddOpen(true)
            setEditingGoal(false)
            setError(null)
          }}
        >
          ＋
        </button>
      </div>

      {open === 'goal' && (
        <div className={css.card}>
          {editingGoal ? (
            <div className={css.goalEditRow}>
              <input
                className={css.input}
                value={goalDraft}
                placeholder={t('goal.placeholder')}
                onChange={event => { setGoalDraft(event.target.value) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void saveGoal()
                  }
                }}
              />
              <button type="button" className={css.action} onClick={() => { void saveGoal() }}>
                {t('goal.save')}
              </button>
              {state.goal !== undefined && (
                <button
                  type="button"
                  className={css.action}
                  onClick={() => { setEditingGoal(false) }}
                >
                  {t('goal.cancel')}
                </button>
              )}
            </div>
          ) : (
            <div className={css.goalRow}>
              <span className={css.goalText}>{state.goal}</span>
              <button
                type="button"
                className={css.action}
                onClick={() => {
                  setGoalDraft(state.goal ?? '')
                  setEditingGoal(true)
                }}
              >
                {t('goal.edit')}
              </button>
            </div>
          )}
          <div
            className={css.progressTrack}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
          >
            <div
              className={css.progressFill}
              style={{ width: progress.total === 0 ? '0%' : `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
          <div className={css.recentLabel}>{t('goal.recent')}</div>
          {advances.length === 0 ? (
            <div className={css.meta}>{t('goal.noAdvances')}</div>
          ) : (
            <ul className={css.list}>
              {advances.slice(0, RECENT_ADVANCES).map(task => (
                <li key={task.id} className={css.advanceRow}>
                  {t('advance.line', { member: task.member, title: task.title })}
                  <span className={css.meta}> · {formatRelativeTime(task.updatedAt, now, t)}</span>
                </li>
              ))}
            </ul>
          )}
          {error !== null && <div className={css.error} role="alert">{error}</div>}
        </div>
      )}

      {open === 'tasks' && (
        <div className={css.card}>
          <div className={css.chips} role="group" aria-label={t('tasks.capsule')}>
            <button
              type="button"
              className={filter === '' ? css.chipActive : css.chip}
              onClick={() => { setFilter('') }}
            >
              {t('tasks.filter.all')}
            </button>
            {members.map(member => (
              <button
                key={member.name}
                type="button"
                className={filter === member.name ? css.chipActive : css.chip}
                onClick={() => { setFilter(member.name) }}
              >
                <span className={css.dot} style={{ background: memberColor(member.name) }} aria-hidden />
                {member.name}
              </button>
            ))}
          </div>
          <div className={css.groups}>
            {filter === ''
              ? members.map((member) => {
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
                        <TaskRow
                          key={task.id}
                          task={task}
                          tasks={state.tasks}
                          showMember={false}
                          now={now}
                          closeTask={closeTask}
                          t={t}
                        />
                      ))}
                    </ul>
                  </div>
                )
              })
              : (
                <ul className={css.list}>
                  {(visibleTasks ?? []).map(task => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      tasks={state.tasks}
                      showMember
                      now={now}
                      closeTask={closeTask}
                      t={t}
                    />
                  ))}
                </ul>
              )}
          </div>
          {addOpen ? (
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
              <select
                className={css.memberSelect}
                aria-label={t('tasks.addBlockedBy')}
                value={draftBlockedBy}
                onChange={event => { setDraftBlockedBy(event.target.value) }}
              >
                <option value="">{t('tasks.addBlockedByNone')}</option>
                {members.map(member => (
                  <option key={member.name} value={member.name}>{member.name}</option>
                ))}
              </select>
              <button
                type="button"
                className={css.action}
                disabled={draftTitle.trim() === '' || chosen === ''}
                onClick={() => { void add() }}
              >
                {t('tasks.add')}
              </button>
            </div>
          ) : (
            <button type="button" className={css.addExpander} onClick={() => { setAddOpen(true) }}>
              ＋ {t('tasks.addTrigger')}
            </button>
          )}
          {error !== null && <div className={css.error} role="alert">{error}</div>}
        </div>
      )}
    </section>
  )
}
