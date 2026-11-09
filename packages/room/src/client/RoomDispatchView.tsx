/**
 * Member-to-member message row ('room-dispatch' keyed renderer): one dim
 * line `↪ 游戏策划大师 派活给 人物建模师：…`, the text clipped to one line
 * and opened in full on click. A 告知 (notify) reads lighter than a 派活.
 * A recipient that has not picked the message up yet is marked 排队中;
 * the delivery state is read off the room state, so the row follows it.
 * Replies point back here through `data-room-dispatch` (see
 * RoomSpeechView's cause line).
 */
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import type { RoomDispatchViewProps } from './slots.ts'
import css from './RoomDispatchView.module.css'

export function RoomDispatchView({ node, sessionId, roomStore, t }: RoomDispatchViewProps): ReactNode {
  const data = node.data
  const [open, setOpen] = useState(false)
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  const from = state?.members.find(member => member.id === data.from)?.name ?? t('dispatch.someone')
  // One state for the row: the least advanced recipient's, when it is not
  // simply running or done.
  const rows = (state?.deliveries ?? []).filter(row => row.dispatchSeq === data.seq)
  const statuses = rows.map(row => row.status)
  const pending = (['queued', 'held', 'failed', 'cancelled'] as const).find(status => statuses.includes(status))
  const head = t(data.kind === 'notify' ? 'dispatch.notify' : 'dispatch.task', { from, to: data.targets.join('、') })
  return (
    <div className={css.row} data-room-dispatch={data.seq} data-kind={data.kind} data-open={open || undefined}>
      <button type="button" className={css.line} aria-expanded={open} onClick={() => { setOpen(!open) }}>
        <span className={css.arrow} aria-hidden>↪</span>
        <span className={css.head}>{head}{open ? '' : t('dispatch.colon')}</span>
        {pending !== undefined && <span className={css.state}>{t(`dispatch.state.${pending}`)}</span>}
        {!open && <span className={css.text}>{data.text.replace(/\s+/g, ' ')}</span>}
      </button>
      {open && <div className={css.full}>{data.text}</div>}
    </div>
  )
}
