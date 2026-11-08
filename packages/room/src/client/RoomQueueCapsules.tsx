/**
 * The member-level queue capsules in the row above the room composer
 * (room-timeline-interaction-order D, B2): a waiting count that scrolls to
 * the first waiting message's receipt, a paused queue with its 继续, and the
 * coordinator's 待核对 that opens its session. They ride the task capsule
 * row's register (amber, like 「⚠ N 件需要处理」). See queue-capsules.ts.
 */
import { useState, type ReactNode } from 'react'
import type { RoomComposerProps } from './slots.ts'
import type { QueueCapsule } from './queue-capsules.ts'
import { revealRoomRow } from './speech-cause.ts'
import css from './RoomTaskCapsule.module.css'

export interface RoomQueueCapsulesProps {
  readonly capsules: readonly QueueCapsule[]
  /** Resume a member's paused queue; absent = the paused capsule only opens the member's session. */
  readonly resume?: ((capsule: QueueCapsule) => Promise<string | undefined>) | undefined
  /** Open a member's own session. */
  readonly openSession?: ((childSessionId: string) => void) | undefined
  readonly t: RoomComposerProps['t']
}

export function RoomQueueCapsules({ capsules, resume, openSession, t }: RoomQueueCapsulesProps): ReactNode {
  const [busy, setBusy] = useState(false)
  if (capsules.length === 0) return null
  return <>
    {capsules.map((capsule) => {
      if (capsule.kind === 'waiting') {
        return <button key={`w:${capsule.memberId}`} type="button" className={css.capsule} data-attention="" data-queue="waiting"
          onClick={() => { revealRoomRow(`[data-room-receipt="${capsule.firstSeq}"]`) }}>
          {t('queue.waiting', { count: capsule.count, member: capsule.member })}<span className={css.capsuleLink} aria-hidden>↑</span>
        </button>
      }
      if (capsule.kind === 'paused') {
        const child = capsule.childSessionId
        return <button key={`p:${capsule.memberId}`} type="button" className={css.capsule} data-attention="" data-queue="paused" disabled={busy}
          onClick={() => {
            if (resume === undefined) { if (child !== undefined) openSession?.(child); return }
            setBusy(true)
            void resume(capsule).finally(() => { setBusy(false) })
          }}>
          {t('queue.paused', { member: capsule.member })}<span className={css.capsuleLink}>{t(resume === undefined ? 'queue.open' : 'queue.resume')}</span>
        </button>
      }
      const child = capsule.childSessionId
      return <button key={`r:${capsule.memberId}`} type="button" className={css.capsule} data-attention="" data-queue="reconcile"
        disabled={child === undefined || openSession === undefined}
        onClick={() => { if (child !== undefined) openSession?.(child) }}>
        {t('queue.reconcile', { member: capsule.member })}<span className={css.capsuleLink}>{t('queue.reconcileGo')}</span>
      </button>
    })}
  </>
}
