/**
 * Relay gate node ('room-relay' keyed renderer): a member-to-member
 * notification waiting at the human gate — a dim RoomEventView-register row
 * (`⇢ ada → bill: 摘要…`) plus [确认派发] [忽略] while pending. Resolutions
 * fold in place through the journal (the Definition updates the row), so a
 * confirmed/dismissed/sent relay reads as a plain dim line with its outcome.
 */
import type { ReactNode } from 'react'
import type { RoomRelayViewProps } from './slots.ts'
import css from './RoomRelayView.module.css'

/** The relay gate row. */
export function RoomRelayView({ node, confirmRelay, dismissRelay, t }: RoomRelayViewProps): ReactNode {
  const data = node.data
  let suffix = ''
  switch (data.state) {
    case 'confirmed': suffix = t('relay.state.confirmed'); break
    case 'dismissed': suffix = t('relay.state.dismissed'); break
    case 'sent': suffix = t('relay.state.sent'); break
    case 'pending': break
  }
  return (
    <div className={css.row} data-state={data.state}>
      <span className={css.text}>
        {t('relay.line', { from: data.from, to: data.to, content: data.content })}
        {suffix === '' ? '' : ` ${suffix}`}
      </span>
      {data.state === 'pending' && (
        <>
          <button
            type="button"
            className={css.action}
            onClick={() => { void confirmRelay(data.relayId) }}
          >
            {t('relay.confirm')}
          </button>
          <button
            type="button"
            className={css.action}
            onClick={() => { void dismissRelay(data.relayId) }}
          >
            {t('relay.dismiss')}
          </button>
        </>
      )}
    </div>
  )
}
