/**
 * The receipt line under a human message ('room-receipt' keyed renderer):
 * right-aligned, bubble-wide small type — the bubble's footnote. One part
 * per recipient: a single recipient reads in full (「排队中 · 等 故事顾问 做
 * 完这一轮 · 撤回」), several join on one line (「画布维护 已收到 · 故事顾问 排
 * 队中」). The state is read off the room state, so the line follows the
 * deliveries without claiming their update edges. See receipt.ts.
 */
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RoomStore } from './room-store.ts'
import { receiptParts, receiptTone, receiptWithdrawn, type ReceiptPart } from './receipt.ts'
import css from './RoomReceiptView.module.css'

/** Injected face of the receipt line. */
export interface RoomReceiptInjected {
  /** The client-side room state store: deliveries, roster, paused queues. */
  readonly roomStore: RoomStore
  /** Take back a still-queued delivery (撤回); absent = no button. Resolves to an error message, or undefined. */
  readonly withdraw?: ((dispatchSeq: number, memberId: string) => Promise<string | undefined>) | undefined
  /** Resume a member's paused input queue (继续队列); absent = no button. */
  readonly resumeQueue?: ((memberId: string) => Promise<string | undefined>) | undefined
  /** Open a member's own session (where its 待对账 is reconciled). */
  readonly openSession?: ((sessionId: SessionId) => void) | undefined
}

/** Full props of the 'room-receipt' chat-node renderer. */
export type RoomReceiptViewProps =
  PropsRuntime<'conversation.chat.node', 'room-receipt'>
  & InjectFace<RoomReceiptInjected>
  & PropsLocale<'room'>

type Translate = RoomReceiptViewProps['t']

/** 「1 分 19 秒」/「1m 19s」: whole seconds, minutes from a minute, hours from an hour. */
export function formatWait(ms: number, t: Translate): string {
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return t('receipt.wait.s', { s: seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('receipt.wait.ms', { m: minutes, s: seconds % 60 })
  return t('receipt.wait.hm', { h: Math.floor(minutes / 60), m: minutes % 60 })
}

/** One part's words: the full phrase for a lone recipient, the short one beside others. */
function partText(part: ReceiptPart, alone: boolean, t: Translate): string {
  const vars = { member: part.member, wait: part.waitedMs === undefined ? '' : formatWait(part.waitedMs, t), reason: part.reason ?? '' }
  // A cancellation with its own words (并入下一条一起送达 …) reads as those words.
  const kind = part.kind === 'cancelled' && part.reason !== undefined ? 'cancelledWhy' : part.kind
  const text = t(`receipt.${alone ? 'one' : 'many'}.${kind}` as 'receipt.one.queued', vars)
  return part.reason !== undefined && (part.kind === 'failed' || part.kind === 'uncertain') ? `${text}${t('receipt.reason', vars)}` : text
}

export function RoomReceiptView({ node, sessionId, roomStore, withdraw, resumeQueue, openSession, t }: RoomReceiptViewProps): ReactNode {
  const data = node.data
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const parts = receiptParts(state, data.seq)
  if (parts === undefined) return null
  // A many-recipient line names who took it in (receiptParts drops a line where everyone did).
  const alone = parts.length === 1
  const act = (run: () => Promise<string | undefined>): void => {
    setBusy(true)
    setError(undefined)
    void run().then((failure) => {
      if (failure !== undefined) setError(failure)
      void roomStore.refresh(sessionId)
    }).finally(() => { setBusy(false) })
  }
  const queued = parts.filter(part => part.kind === 'queued' || part.kind === 'paused')
  const paused = parts.filter(part => part.kind === 'paused')
  const reconcile = parts.find(part => part.kind === 'reconcile')
  const reconcileChild = reconcile === undefined ? undefined : state?.members.find(member => member.id === reconcile.memberId)?.childSessionId
  return (
    <div className={css.receipt} data-room-receipt={data.seq} data-withdrawn={receiptWithdrawn(parts) || undefined} role="status">
      {parts.map((part, index) => (
        <span key={part.deliveryId} className={css.part}>
          {index > 0 && <span className={css.sep} aria-hidden>·</span>}
          <span className={css.state} data-tone={receiptTone(part.kind)}>
            {(part.kind === 'queued') && <span className={css.pulse} aria-hidden />}
            {partText(part, alone, t)}
          </span>
        </span>
      ))}
      {resumeQueue !== undefined && paused.length > 0 && (
        <button type="button" className={css.action} disabled={busy} onClick={() => { act(async () => resumeQueue(paused[0]!.memberId)) }}>{t('receipt.resume')}</button>
      )}
      {openSession !== undefined && reconcileChild !== undefined && (
        <button type="button" className={css.action} onClick={() => { openSession(reconcileChild) }}>{t('receipt.reconcile')}</button>
      )}
      {withdraw !== undefined && queued.map(part => (
        <button key={part.deliveryId} type="button" className={css.action} disabled={busy}
          onClick={() => { act(async () => withdraw(part.dispatchSeq, part.memberId)) }}>
          {alone ? t('receipt.withdraw') : t('receipt.withdrawFrom', { member: part.member })}
        </button>
      ))}
      {error !== undefined && <span className={css.error} role="alert">{error}</span>}
    </div>
  )
}
