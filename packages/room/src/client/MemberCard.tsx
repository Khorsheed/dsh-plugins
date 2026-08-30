/**
 * One roster card: identity, avatar block, role, status chip, actions.
 * Extracted from MembersView so the invite/edit dialog can render the same
 * card as its live preview — `preview` drops the action foot (the preview
 * member has no session to jump to and nothing to edit or remove) and is
 * always rendered idle (no run to report).
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { RoomMember, RoomMemberRun } from '../types.ts'
import { formatDurationMs } from './format.ts'
import { memberColor } from './member-color.ts'
import type { MembersViewProps } from './slots.ts'
import css from './MembersView.module.css'

/** One roster card: identity, avatar block, role, status chip, actions. */
export function MemberCard({
  member, run, elapsedMs, openSession, onEdit, onRemove, t, preview = false,
}: {
  readonly member: RoomMember
  readonly run: RoomMemberRun | undefined
  /** Tick-driven elapsed for a running member (undefined otherwise). */
  readonly elapsedMs: number | undefined
  readonly openSession: MembersViewProps['openSession']
  readonly onEdit: () => void
  readonly onRemove: () => void
  readonly t: MembersViewProps['t']
  /** True = the dialog's live preview: no action foot. */
  readonly preview?: boolean
}): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const instructionsRef = useRef<HTMLParagraphElement | null>(null)
  useEffect(() => {
    if (expanded) return
    const element = instructionsRef.current
    if (element !== null) setOverflowing(element.scrollHeight > element.clientHeight + 1)
  }, [member.instructions, expanded])

  const color = memberColor(member.name)
  const child = member.childSessionId
  const running = run?.state === 'running'
  const failed = run?.state === 'failed'
  return (
    <div className={css.card} data-member={member.name}>
      <div className={css.head}>
        <span className={css.avatarTile} style={{ '--member-color': color } as CSSProperties} aria-hidden>
          {member.name.slice(0, 1).toUpperCase()}
        </span>
        <span className={css.identity}>
          <span className={css.name}>{member.name}</span>
          <span className={css.hint}>
            {member.kind === 'main-agent' ? t('member.kind.main') : member.provider ?? ''}
          </span>
        </span>
        {running ? (
          <button
            type="button"
            className={css.chipRunning}
            title={t('speech.jump')}
            disabled={child === undefined}
            onClick={() => { if (child !== undefined) openSession(child) }}
          >
            {`${t('members.status.running')} · ${formatDurationMs(elapsedMs ?? 0)}`}
          </button>
        ) : (
          <span className={failed ? css.chipFailed : css.chipIdle}>
            {failed ? t('members.status.failed') : t('members.status.idle')}
          </span>
        )}
      </div>
      {member.kind === 'cli' && (
        member.instructions === undefined ? (
          <p className={css.instructionsEmpty}>{t('members.instructions.empty')}</p>
        ) : (
          <div className={css.instructionsBlock}>
            <p
              ref={instructionsRef}
              className={expanded ? css.instructionsExpanded : css.instructions}
              title={expanded ? undefined : member.instructions}
            >
              {member.instructions}
            </p>
            {(overflowing || expanded) && (
              <button
                type="button"
                className={css.expandToggle}
                onClick={() => { setExpanded(value => !value) }}
              >
                {expanded ? t('members.instructions.collapse') : t('members.instructions.expand')}
              </button>
            )}
          </div>
        )
      )}
      {!preview && (
        <div className={css.foot}>
          {member.kind === 'cli' && (
            <span className={css.actions}>
              <button
                type="button"
                className={css.action}
                disabled={child === undefined}
                onClick={() => { if (child !== undefined) openSession(child) }}
              >
                {t('members.trajectory')}
              </button>
              <button type="button" className={css.action} onClick={onEdit}>
                {t('members.edit')}
              </button>
              <button type="button" className={css.action} onClick={onRemove}>
                {t('members.remove')}
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
