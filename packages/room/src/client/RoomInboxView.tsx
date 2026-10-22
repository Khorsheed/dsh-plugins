/**
 * Held-reports line ('room-inbox' keyed renderer): the report gate kept some
 * results in a member's inbox instead of waking it — one dim line saying so,
 * with the model's verdict and a 现在交给 button that wakes the member now.
 */
import { useState, type ReactNode } from 'react'
import type { RoomInboxViewProps } from './slots.ts'
import css from './RoomInboxView.module.css'

/** The held-reports line. */
export function RoomInboxView({ node, releaseReports, t }: RoomInboxViewProps): ReactNode {
  const data = node.data
  const [busy, setBusy] = useState(false)
  return (
    <div className={css.row} role="status">
      <span className={css.text}>
        {t('inbox.line', { member: data.member, count: data.held.length })}
        {data.probability !== undefined && <span className={css.why}>{t('inbox.why', { p: data.probability.toFixed(2) })}</span>}
      </span>
      <button
        type="button"
        className={css.action}
        disabled={busy}
        onClick={() => { setBusy(true); void releaseReports(data.member).finally(() => { setBusy(false) }) }}
      >
        {t('inbox.release', { member: data.member })}
      </button>
    </div>
  )
}
