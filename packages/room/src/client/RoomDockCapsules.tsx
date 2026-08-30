/**
 * The room dock capsules, rendered by the RoomComposer itself above the input
 * card — the seat of the old task-board strip (NOT a `conversation.input.dock`
 * entry: that slot lives inside the official composer fallback, which the
 * room's composer takeover hides). One collapsed row of two capsules plus a
 * quick-add button:
 *
 * ```
 * [◔33% 插件API v2上线]  [☑ 当前进度 1/3 · ●ada 在做]  ＋
 * ```
 *
 * The row is ANCHORED just above the input card: an expanded panel renders
 * above the capsule row (top-to-bottom: panel → capsules → input card) and
 * grows upward only, so folding/unfolding never shifts the row under the
 * user's pointer.
 *
 * The GOAL capsule's only visual focus is the progress ring: an SVG circle
 * (tertiary track + business-primary progress arc) followed by the percent
 * and the truncated goal text; without a goal it renders the 「＋ 设定目标」
 * guide state (no ring). It expands into the goal card: the full text with an
 * inline [编辑], a progress bar with the done/total fraction, and the recent
 * advance records (who finished what, relative time).
 *
 * The TASK capsule leads with the checklist icon (IconChecklistOutline14 from
 * the official primitives — never a Unicode glyph), then the open-task count
 * and the members currently running (color dot + name). It expands into the
 * Linear-style task panel: a member filter chip row (color-dot capsules, the
 * selected one takes a tinted fill of the member color — no outline) with the
 * ＋添加 trigger at its right end, small-caps tertiary group headers, and task
 * rows (colored status icon — business-primary half-ring for in_progress,
 * tertiary empty ring for pending, filled check for done, filled error × for
 * failed — + title + member chip + right-aligned tertiary status/relative
 * time + a row-end [完成]; a failed row's action is [关闭], dismissing to
 * cancelled — the run did not finish, so it never closes done).
 * Closing a task plays a restrained completion beat (the check pops, the
 * title's strike draws in, <300ms, reduced-motion safe) — the row remounts on
 * a status change (`key = id:status`) so the CSS animation replays. A blocked
 * row greys with a 「等 ada」 tag until its `blockedBy` member has no open
 * task left (display only: nothing auto-dispatches). The trailing ＋ opens
 * the panel with the add form already expanded (member select + title +
 * optional "等谁"). Panels close on a second capsule click or a click
 * outside; no overlay.
 *
 * Visual layer: the capsules ride the official chip register (28px, r24,
 * interactive hover fill, 13/20/500 label) with a visible outline (the
 * InputBar card's `l2-darkmode-thin` pair, firming to `l3` on hover/expand);
 * the expanded cards are the
 * official Menu surface (`--dsw-specific-menu`, r12, inverted hairline,
 * shadow-lv3); the task capsule sweeps a restrained glare band while tasks
 * run (the ToolRow pattern, reduced-motion safe). Every token reference
 * carries the light-theme literal as fallback; no divider lines anywhere.
 *
 * FRESH-ROOM STATE: a room with neither a goal nor any task (membership does
 * not count — the main agent is always there) has no use for the guide/task
 * pair, which would be pure noise. The collapsed row then renders a single
 * 「＋ 邀请成员」 capsule (same chip family) that opens the invite dialog
 * straight from the dock. The moment a goal is set or a task exists the pair
 * returns, and the invite entry retires — the members tab already carries it.
 */
import {
  useEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties, type KeyboardEvent, type ReactNode,
} from 'react'
import { IconChecklistOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { taskProgress } from '../journal.ts'
import type { RoomProviderList, RoomTask } from '../types.ts'
import { formatRelativeTime } from './format.ts'
import { memberColor } from './member-color.ts'
import { InviteDialog, type InviteDialogSubmit } from './InviteDialog.tsx'
import type { RoomDockCapsulesProps } from './slots.ts'
import css from './RoomDockCapsules.module.css'

/** Glyph tooltip text per status. */
function statusLabel(status: RoomTask['status'], t: RoomDockCapsulesProps['t']): string {
  switch (status) {
    case 'pending': return t('tasks.status.pending')
    case 'in_progress': return t('tasks.status.in_progress')
    case 'done': return t('tasks.status.done')
    case 'cancelled': return t('tasks.status.cancelled')
    case 'failed': return t('tasks.status.failed')
  }
}

/* The Linear-style status icons: colored, 14px, centered in the 16px cell. */

/** Done: filled success circle, check cut in the card surface tone. */
function DoneGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className={css.glyphDone}>
      <circle cx="7" cy="7" r="7" fill="currentColor" />
      <path
        d="M4.2 7.3L6.2 9.3L9.8 5.2"
        stroke="var(--dsw-specific-menu, var(--dsw-alias-bg-base, #ffffff))"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** In-progress: business-primary half ring; CSS spins the svg. */
function ProgressGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className={css.glyphProgress}>
      <circle
        cx="7" cy="7" r="5.5"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
        strokeDasharray={`${Math.PI * 5.5} ${2 * Math.PI * 5.5}`}
      />
    </svg>
  )
}

/** Pending: the tertiary empty ring. */
function PendingGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className={css.glyphPending}>
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

/** Cancelled: the pending ring in the dimmer caption tone. */
function CancelledGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className={css.glyphCancelled}>
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

/** Failed: filled error circle, × cut in the card surface tone (DoneGlyph's cutout idiom). */
function FailedGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className={css.glyphFailed}>
      <circle cx="7" cy="7" r="7" fill="currentColor" />
      <path
        d="M4.8 4.8L9.2 9.2M9.2 4.8L4.8 9.2"
        stroke="var(--dsw-specific-menu, var(--dsw-alias-bg-base, #ffffff))"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function StatusGlyph({ status }: { status: RoomTask['status'] }) {
  switch (status) {
    case 'done': return <DoneGlyph />
    case 'in_progress': return <ProgressGlyph />
    case 'pending': return <PendingGlyph />
    case 'cancelled': return <CancelledGlyph />
    case 'failed': return <FailedGlyph />
  }
}

/**
 * The goal capsule's progress ring — the collapsed row's single visual focus:
 * a tertiary track arc plus the business-primary progress arc, -90° rotated
 * so the arc starts at twelve o'clock.
 */
function GoalRing({ fraction }: { readonly fraction: number }) {
  const clamped = Math.min(1, Math.max(0, fraction))
  const R = 5.5
  const C = 2 * Math.PI * R
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className={css.ring}>
      <circle cx="7" cy="7" r={R} className={css.ringTrack} strokeWidth="2" />
      <circle
        cx="7" cy="7" r={R}
        className={css.ringFill} strokeWidth="2" strokeLinecap="round"
        strokeDasharray={`${C * clamped} ${C}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  )
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
function TaskRow({ task, tasks, now, closeTask, t }: {
  readonly task: RoomTask
  readonly tasks: readonly RoomTask[]
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
      <span className={css.content}>
        {/* The inner inline span carries the done strike so the line spans
            the text, not the flex-stretched row. */}
        <span className={css.title}>{task.title}</span>
      </span>
      <span className={css.memberChip}>
        <span className={css.memberDot} style={{ background: memberColor(task.member) }} aria-hidden />
        {task.member}
      </span>
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
      {/* A failed row never offers [完成] — the run did not finish, so a
          done-close would fake goal progress. Its [关闭] dismisses the row
          to cancelled; the failure stays the record. Re-dispatch is a fresh
          @-message, not a board action. */}
      {task.status === 'failed' && (
        <button
          type="button"
          className={css.action}
          onClick={() => { void closeTask(task.id, 'cancelled') }}
        >
          {t('tasks.dismiss')}
        </button>
      )}
    </li>
  )
}

/** The dock capsules (goal + tasks) with their expanded cards. */
export function RoomDockCapsules({
  sessionId, roomStore, addTask, closeTask, setGoal,
  roomCwd, invite, listProviders, browseDirectory, t,
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
  const [inviteOpen, setInviteOpen] = useState(false)
  const [providers, setProviders] = useState<RoomProviderList | undefined>(undefined)
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

  // Fresh room (no goal, no tasks — membership does not count, the main
  // agent is always there): the guide/task pair would be noise, so the row
  // carries a single 「＋ 邀请成员」 capsule that opens the invite dialog
  // straight from the dock. The pair returns the moment a goal or a task
  // exists; the invite entry then retires (the members tab carries it).
  const fresh = state.goal === undefined && state.tasks.length === 0
  if (fresh) {
    const openInvite = (): void => {
      setProviders(undefined)
      setInviteOpen(true)
      void listProviders().then(setProviders)
    }
    const submitInvite = (values: InviteDialogSubmit) => invite({
      provider: values.provider,
      name: values.name,
      // Blank instructions are omitted, not sent: the host rejects a
      // present-but-blank role, and an absent one simply carries no preset.
      ...values.instructions === '' ? {} : { instructions: values.instructions },
      ...values.cwd === '' ? {} : { cwd: values.cwd },
      ...values.firstTask === '' ? {} : { firstTask: values.firstTask },
    })
    return (
      <section ref={rootRef} className={css.root} aria-label={t('goal.label')}>
        <div className={css.capsules}>
          <button
            type="button"
            className={css.capsule}
            onClick={openInvite}
          >
            <span className={css.capsuleGuide}>{t('members.invite')}</span>
          </button>
        </div>
        {inviteOpen && (
          <InviteDialog
            mode="invite"
            providers={providers?.providers}
            localAgentAvailable={providers?.localAgentAvailable ?? true}
            inheritedCwd={roomCwd}
            existingNames={state.members.map(entry => entry.name)}
            browseDirectory={browseDirectory}
            onSubmit={submitInvite}
            onClose={() => { setInviteOpen(false) }}
            t={t}
          />
        )}
      </section>
    )
  }

  const now = Date.now()
  const progress = taskProgress(state.tasks)
  const runners = [...new Set(
    state.tasks.filter(task => task.status === 'in_progress').map(task => task.member),
  )]
  const members = state.members
  const chosen = members.some(member => member.name === draftMember)
    ? draftMember
    : (members[0]?.name ?? '')
  const advances = state.tasks
    .filter(task => task.status === 'done')
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const fraction = progress.total === 0 ? 0 : progress.done / progress.total

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
      {/* The expanded card renders ABOVE the capsule row (top-to-bottom:
          panel → capsules → composer card): the row stays anchored just
          above the input card, and the panel grows upward only — toggling a
          capsule never shifts the row the user clicked. */}
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
          <div className={css.progressRow}>
            <div
              className={css.progressTrack}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
            >
              <div
                className={css.progressFill}
                style={{ width: `${fraction * 100}%` }}
              />
            </div>
            <span className={css.progressMeta}>{progress.done}/{progress.total}</span>
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
          <div className={css.panelBar}>
            <div className={css.chips} role="group" aria-label={t('tasks.capsule')}>
              <button
                type="button"
                className={css.chip}
                data-active={filter === '' || undefined}
                onClick={() => { setFilter('') }}
              >
                {t('tasks.filter.all')}
              </button>
              {members.map(member => (
                <button
                  key={member.name}
                  type="button"
                  className={css.chip}
                  data-active={filter === member.name || undefined}
                  style={{ '--room-chip-color': memberColor(member.name) } as CSSProperties}
                  onClick={() => { setFilter(member.name) }}
                >
                  <span className={css.memberDot} style={{ background: memberColor(member.name) }} aria-hidden />
                  {member.name}
                </button>
              ))}
            </div>
            {!addOpen && (
              <button type="button" className={css.addTrigger} onClick={() => { setAddOpen(true) }}>
                ＋ {t('tasks.addTrigger')}
              </button>
            )}
          </div>
          <div className={css.groups}>
            {filter === ''
              ? members.map((member) => {
                const own = state.tasks.filter(task => task.member === member.name)
                if (own.length === 0) return null
                return (
                  <div key={member.name} className={css.group}>
                    <div className={css.head}>{member.name}</div>
                    <ul className={css.list}>
                      {own.map(task => (
                        <TaskRow
                          key={`${task.id}:${task.status}`}
                          task={task}
                          tasks={state.tasks}
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
                      key={`${task.id}:${task.status}`}
                      task={task}
                      tasks={state.tasks}
                      now={now}
                      closeTask={closeTask}
                      t={t}
                    />
                  ))}
                </ul>
              )}
          </div>
          {addOpen && (
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
          )}
          {error !== null && <div className={css.error} role="alert">{error}</div>}
        </div>
      )}

      <div className={css.capsules}>
        <button
          type="button"
          className={css.capsule}
          aria-expanded={open === 'goal'}
          aria-label={t('goal.label')}
          onClick={() => { toggle('goal') }}
        >
          {state.goal === undefined ? (
            <span className={css.capsuleGuide}>{t('goal.set')}</span>
          ) : (
            <>
              <GoalRing fraction={fraction} />
              <span className={css.capsulePercent}>{Math.round(fraction * 100)}%</span>
              <span className={css.capsuleText}>{state.goal}</span>
            </>
          )}
        </button>
        <button
          type="button"
          className={css.capsule}
          aria-expanded={open === 'tasks'}
          aria-label={t('tasks.capsule')}
          data-running={runners.length > 0 || undefined}
          onClick={() => { toggle('tasks') }}
        >
          <IconChecklistOutline14 size={14} className={css.checklistIcon} />
          {progress.total === 0 ? (
            <span className={css.capsuleText}>{t('tasks.capsule')}</span>
          ) : (
            <>
              <span className={css.capsuleText}>{t('tasks.capsule')}</span>
              <span className={css.capsuleCount}>{progress.done}/{progress.total}</span>
              {runners.length > 0 && (
                <span className={css.runners}>
                  {runners.map(name => (
                    <span key={name} className={css.runner}>
                      <span className={css.memberDot} style={{ background: memberColor(name) }} aria-hidden />
                      {name}
                    </span>
                  ))}
                  <span className={css.runnerSuffix}>{t('tasks.doing')}</span>
                </span>
              )}
            </>
          )}
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
    </section>
  )
}
