/**
 * The edit dialog's recovery block, under the 模式工具 line: a CLI member
 * that cannot take work until the user acts, recovered without leaving the
 * room (11-04: after a host restart a Kimi member's start kept failing, and
 * 对账并重试 lived only in the member's own session, where nobody found it).
 *
 * - The last start failed: the reason in plain words and 对账并重试 (the
 *   member-configuration retry: check the member's real state, clear the
 *   failure; the next message starts it again — nothing is resent).
 * - A restart interrupted a round (待对账): what it was, and the members
 *   page's verdicts — confirm it finished or confirm it was cancelled, with
 *   the evidence the user checked.
 *
 * Renders nothing while the member is fine, or without the family.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { MembersViewProps, RoomMutationOutcome } from './slots.ts'
import { memberRecovery, type MemberRecoveryRead, type MemberRecoveryState } from './member-recovery-view.ts'
import base from './MemberToolsLine.module.css'
import css from './MemberRecoveryLine.module.css'

const POLL_MS = 3_000

export interface MemberRecoveryLineProps {
  readonly childSessionId: string
  readonly read: (childSessionId: string) => Promise<MemberRecoveryRead | undefined>
  readonly retry: (childSessionId: string, revision: number) => Promise<RoomMutationOutcome>
  /** Record the human's verdict on an interrupted execution; absent = no verdict controls. */
  readonly reconcile?: ((childSessionId: string, executionId: string, outcome: 'done' | 'cancelled', evidence: string) => Promise<RoomMutationOutcome>) | undefined
  /** Bumped by the dialog after a load it started, so the block re-reads at once. */
  readonly refreshKey?: number | undefined
  readonly t: MembersViewProps['t']
}

/** The recovery block. */
export function MemberRecoveryLine({ childSessionId, read, retry, reconcile, refreshKey = 0, t }: MemberRecoveryLineProps): ReactNode {
  const [state, setState] = useState<MemberRecoveryState | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  // What the last click led to: recovered (a quiet note), or still failing.
  const [note, setNote] = useState<'recovered' | 'still' | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [evidence, setEvidence] = useState('')
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const refresh = useCallback(async (): Promise<MemberRecoveryState | undefined> => {
    const next = memberRecovery(await read(childSessionId).catch(() => undefined))
    if (alive.current) setState(next)
    return next
  }, [read, childSessionId])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, POLL_MS)
    return () => { clearInterval(timer) }
  }, [refresh, refreshKey])

  if (state === undefined && note !== 'recovered' && error === undefined) return null

  const onRetry = async (revision: number): Promise<void> => {
    setBusy(true); setNote(undefined); setError(undefined)
    const outcome = await retry(childSessionId, revision).catch(() => ({ ok: false as const, message: '' }))
    const next = await refresh()
    if (!alive.current) return
    setBusy(false)
    if (next?.failed !== undefined) setNote('still')
    else if (outcome.ok) setNote('recovered')
    else setError(outcome.message === '' ? t('recovery.member.error') : outcome.message)
  }

  const onReconcile = async (id: string, outcome: 'done' | 'cancelled'): Promise<void> => {
    if (reconcile === undefined || evidence.trim() === '') return
    setBusy(true); setError(undefined)
    const result = await reconcile(childSessionId, id, outcome, evidence.trim()).catch(() => ({ ok: false as const, message: '' }))
    await refresh()
    if (!alive.current) return
    setBusy(false)
    if (result.ok) setEvidence('')
    else setError(result.message === '' ? t('recovery.member.error') : result.message)
  }

  const failed = state?.failed
  const uncertain = state?.uncertain ?? []
  return (
    <div className={base.tools} data-testid="member-recovery">
      {failed !== undefined && <>
        <div className={base.row}>
          <span className={base.label}>{t('recovery.member.label')}</span>
          <span className={base.warn}>⚠ {t(note === 'still' ? 'recovery.member.stillFailed' : failed.cause === 'start' ? 'recovery.member.startFailed' : 'recovery.member.selectionFailed')}</span>
          <span className={base.actions}>
            <button type="button" className={`${base.button} ${base.warnButton}`} disabled={busy} onClick={() => { void onRetry(failed.revision) }}>
              {busy ? t('recovery.member.retrying') : t('recovery.member.retry')}
            </button>
          </span>
        </div>
        {failed.reason !== '' && <div className={css.reason}>{failed.reason}</div>}
        <div className={base.hint}>{t('recovery.member.retryHint')}</div>
      </>}
      {failed === undefined && note === 'recovered' && <div className={base.hint} role="status">{t('recovery.member.recovered')}</div>}
      {uncertain.length > 0 && <>
        <div className={base.row}>
          <span className={base.label}>{t('recovery.member.uncertainLabel')}</span>
          <span className={base.warn}>⚠ {t('recovery.member.uncertain', { count: uncertain.length })}</span>
        </div>
        <div className={base.hint}>{t('recovery.member.uncertainHelp')}</div>
        {uncertain.map(row => (
          <div key={row.id} className={css.entry}>
            <span className={css.preview}>{(row.text ?? t(`recovery.member.caller.${row.caller}` as 'recovery.member.caller.room')).slice(0, 160)}</span>
            {reconcile !== undefined && <div className={css.reconcile}>
              <input
                className={css.evidence}
                value={evidence}
                aria-label={t('recovery.member.evidence')}
                placeholder={t('recovery.member.evidence')}
                onChange={event => { setEvidence(event.target.value) }}
              />
              <button type="button" className={base.button} disabled={busy || evidence.trim() === ''} onClick={() => { void onReconcile(row.id, 'done') }}>{t('recovery.member.confirmDone')}</button>
              <button type="button" className={base.button} disabled={busy || evidence.trim() === ''} onClick={() => { void onReconcile(row.id, 'cancelled') }}>{t('recovery.member.confirmCancelled')}</button>
            </div>}
          </div>
        ))}
      </>}
      {error !== undefined && <div className={`${base.hint} ${base.warnHint}`} role="alert">{error}</div>}
    </div>
  )
}
