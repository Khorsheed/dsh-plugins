import { useState } from 'react'
import type { RoomDelivery, RoomMember } from '../types.ts'
import type { RoomComposerProps } from './slots.ts'
import css from './RoomPlanView.module.css'

/** Ordinary chat needs the same explicit recovery boundary as formal goals. */
export function RoomRecoveryView({ deliveries, members, reconcile, openSession, t }: {
  deliveries: readonly RoomDelivery[]
  members: readonly RoomMember[]
  reconcile: NonNullable<RoomComposerProps['reconcileDelivery']>
  openSession: RoomComposerProps['openPlanSession']
  t: RoomComposerProps['t']
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [evidence, setEvidence] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rows = deliveries.filter(row => row.status === 'uncertain' && row.plan?.taskId === undefined)
  if (rows.length === 0) return null
  const resolve = async (id: string, outcome: 'done' | 'cancelled') => {
    if (busy || !evidence.trim()) return
    setBusy(true); setError(null)
    try {
      const result = await reconcile(id, outcome, evidence.trim())
      if (result.ok) { setSelected(null); setEvidence('') }
      else setError(result.message)
    } catch { setError(t('composer.error.generic')) }
    finally { setBusy(false) }
  }
  return <details className={css.root} data-testid="room-recovery" open>
    <summary>{t('recovery.title')}</summary>
    <p>{t('recovery.help')}</p>
    {error && <p role="alert">{error}</p>}
    {rows.map(row => {
      const member = members.find(member => member.id === row.memberId)
      return <div key={row.id} className={css.task}>
        <strong>{member?.name ?? row.memberId}</strong>
        <p className={css.text}>{row.text}</p>
        <div className={css.actions}>
          {member?.childSessionId && openSession && <button type="button" onClick={() => openSession(member.childSessionId!)}>{t('plan.session')}</button>}
          <button type="button" disabled={busy} onClick={() => { setSelected(row.id); setEvidence(''); setError(null) }}>{t('plan.reconcile')}</button>
        </div>
        {selected === row.id && <div className={css.fields}>
          <label>{t('plan.reason')}<textarea value={evidence} onChange={event => setEvidence(event.target.value)} /></label>
          <div className={css.actions}>
            <button type="button" disabled={busy || !evidence.trim()} onClick={() => { void resolve(row.id, 'done') }}>{t('recovery.done')}</button>
            <button type="button" disabled={busy || !evidence.trim()} onClick={() => { void resolve(row.id, 'cancelled') }}>{t('recovery.cancelled')}</button>
          </div>
        </div>}
      </div>
    })}
  </details>
}
