/**
 * The edit dialog's recovery block, under the 模式工具 line: a CLI member
 * whose last start failed, recovered without leaving the room (11-04: after
 * a host restart a Kimi member's start kept failing, and 对账并重试 lived
 * only in the member's own session, where nobody found it) — the reason in
 * plain words and 对账并重试 (the member-configuration retry: check the
 * member's real state, clear the failure; the next message starts it again —
 * nothing is resent). A round a restart cut off needs nothing here: it is
 * closed and continued (restart-recovery consolidation).
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
  /** Bumped by the dialog after a load it started, so the block re-reads at once. */
  readonly refreshKey?: number | undefined
  readonly t: MembersViewProps['t']
}

/** The recovery block. */
export function MemberRecoveryLine({ childSessionId, read, retry, refreshKey = 0, t }: MemberRecoveryLineProps): ReactNode {
  const [state, setState] = useState<MemberRecoveryState | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  // What the last click led to: recovered (a quiet note), or still failing.
  const [note, setNote] = useState<'recovered' | 'still' | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
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

  const failed = state?.failed
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
      {error !== undefined && <div className={`${base.hint} ${base.warnHint}`} role="alert">{error}</div>}
    </div>
  )
}
