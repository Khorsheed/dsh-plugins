/**
 * Boundary node ('room-event' keyed renderer): one dim
 * compaction-marker-style line per member join/leave, and one amber dashed
 * line when a member's mode tools were reloaded at round start or still
 * could not be loaded after a reload (the latter with 「编辑成员」, which
 * opens the member's edit dialog in place). The human's own @-messages are
 * NOT here — postMessage appends them as standard `user/message` events, so
 * the official user bubble carries them.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { RoomEventViewProps } from './slots.ts'
import { MemberEditDialog } from './MemberEditDialog.tsx'
import { modeShortName } from './member-tools-view.ts'
import css from './RoomEventView.module.css'

/** The boundary dim line. */
export function RoomEventView(props: RoomEventViewProps): ReactNode {
  const { node, t } = props
  const data = node.data
  if (data.sub === 'member-tools') return <MemberToolsNotice {...props} />
  // A background task lost at a restart (M6): one amber line, nothing to press.
  if (data.sub === 'background-lost') {
    if (data.lost === undefined) return null
    return (
      <div className={css.notice} role="note" data-room-event="background-lost">
        <span className={css.noticeText}>⚠ <b className={css.noticeMember}>{data.member}</b>{t(`event.lost.${data.lost.because}`, { label: data.lost.label })}</span>
      </div>
    )
  }
  let text: string
  switch (data.sub) {
    case 'member-added':
      text = t('event.joined', { member: data.member ?? '', provider: data.provider ?? '' })
        + (data.invitedBy === 'agent' ? t('event.joinedByAgent') : '')
      break
    case 'member-removed':
      text = t('event.left', { member: data.member ?? '' })
      break
  }
  return <div className={css.row}>{text}</div>
}

/** One dashed amber line about a member's mode tools. */
function MemberToolsNotice({ node, sessionId, modeNames, members, t }: RoomEventViewProps): ReactNode {
  const data = node.data
  const tools = data.tools
  const [mode, setMode] = useState<string | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (tools === undefined || modeNames === undefined) return undefined
    let cancelled = false
    void modeNames(sessionId).then((names) => { if (!cancelled) setMode(names.get(tools.preset)) }).catch(() => {})
    return () => { cancelled = true }
  }, [modeNames, sessionId, tools])
  if (tools === undefined) return null
  const modeText = mode === undefined ? t('event.tools.modeFallback') : modeShortName(mode)
  const rest = tools.kind === 'reloaded'
    ? t('event.tools.reloaded', { mode: modeText })
    : t(tools.during === 'idle' ? 'event.tools.unavailable.idle' : 'event.tools.unavailable.round', { mode: modeText })
  return (
    <div className={css.notice} role="note">
      <span className={css.noticeText}>
        ⚠ <b className={css.noticeMember}>{data.member}</b>{rest}
        {tools.kind === 'unavailable' && members !== undefined && <>
          {' · '}
          <button type="button" className={css.noticeLink} onClick={() => { setEditing(true) }}>{t('event.tools.edit')}</button>
        </>}
      </span>
      {editing && members !== undefined && data.member !== undefined && (
        <MemberEditDialog sessionId={sessionId} memberName={data.member} face={members} onClose={() => { setEditing(false) }} t={t} />
      )}
    </div>
  )
}
