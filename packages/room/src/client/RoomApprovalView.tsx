/**
 * A member's tool approval ('room-approval' keyed renderer): one line in the
 * room's conversation — 「⚠ coco 要你确认：调用 video_render」 with the reason
 * — and [允许一次] [拒绝] while it waits. The answer folds in place through the
 * journal (allowed / rejected / cancelled when the call ended first).
 */
import { useState, type ReactNode } from 'react'
import type { RoomApprovalViewProps } from './slots.ts'
import css from './RoomRelayView.module.css'

/** The approval line. */
export function RoomApprovalView({ node, answerApproval, t }: RoomApprovalViewProps): ReactNode {
  const data = node.data
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const answer = async (outcome: 'allowed-once' | 'rejected'): Promise<void> => {
    if (busy) return
    setBusy(true)
    try { setError(await answerApproval(data.approvalId, outcome)) } finally { setBusy(false) }
  }
  const pending = data.state === 'pending'
  return (
    <div className={css.row} data-state={pending ? 'pending' : 'resolved'}>
      <span className={css.text}>
        {t('approval.line', { member: data.member, tool: data.tool })}
        {data.reason === undefined ? '' : `（${data.reason}）`}
        {pending ? '' : ` ${t(`approval.state.${data.state}`)}`}
        {error === undefined ? '' : ` ${error}`}
      </span>
      {pending && (
        <>
          <button type="button" className={css.action} disabled={busy} onClick={() => { void answer('allowed-once') }}>{t('approval.allow')}</button>
          <button type="button" className={css.action} disabled={busy} onClick={() => { void answer('rejected') }}>{t('approval.reject')}</button>
        </>
      )}
    </div>
  )
}
