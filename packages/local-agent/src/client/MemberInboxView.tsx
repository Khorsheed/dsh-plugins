import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocalAgentMemberInbox, LocalAgentPromptResult } from '../types.ts'
import type { NS } from './locales.ts'
import css from './MemberInboxView.module.css'

export interface MemberInboxFace {
  read(): Promise<LocalAgentMemberInbox | undefined>
  control(action: 'pause' | 'resume' | 'cancel' | 'reconcile', requestId?: string, outcome?: 'done' | 'cancelled', evidence?: string): Promise<LocalAgentPromptResult | undefined>
}

export function MemberInboxView({ face, t }: { face: MemberInboxFace } & PropsLocale<typeof NS>) {
  const [state, setState] = useState<LocalAgentMemberInbox>()
  const [error, setError] = useState<string>()
  const [evidence, setEvidence] = useState('')
  useEffect(() => {
    let closed = false
    const refresh = (): void => { void face.read().then(value => { if (!closed && value !== undefined) setState(value) }, () => {}) }
    refresh()
    const timer = setInterval(refresh, 750)
    return () => { closed = true; clearInterval(timer) }
  }, [face])
  if (state === undefined) return null
  const visible = state.messages.filter(row => ['queued', 'running', 'uncertain', 'failed'].includes(row.status)).slice(-8)
  if (visible.length === 0 && error === undefined && state.error === undefined) return null
  const control = (action: 'pause' | 'resume' | 'cancel' | 'reconcile', requestId?: string, outcome?: 'done' | 'cancelled'): void => {
    setError(undefined)
    void face.control(action, requestId, outcome, evidence).then(async result => {
      if (result?.ok !== true) setError(result?.error ?? t('member.sendFailed'))
      const next = await face.read()
      if (next !== undefined) setState(next)
    }).catch(failure => setError(String(failure)))
  }
  return <section className={css.root} aria-label={t('inbox.title')}>
    <div className={css.header}>
      <span>{t('inbox.title')} · {state.messages.filter(row => row.status === 'queued').length}</span>
      <button type="button" onClick={() => control(state.paused ? 'resume' : 'pause')}>{t(state.paused ? 'inbox.resume' : 'inbox.pause')}</button>
    </div>
    {state.paused && <p>{t('inbox.paused')}</p>}
    {(error ?? state.error) !== undefined && <p role="alert">{error ?? state.error}</p>}
    {visible.map(row => <div key={row.id} className={css.item}>
      <span>{t(`inbox.status.${row.status}` as 'inbox.status.queued')} · {row.text.slice(0, 160)}</span>
      {row.status === 'queued' && <button type="button" onClick={() => control('cancel', row.id)}>{t('inbox.cancel')}</button>}
      {row.error !== undefined && <p>{row.error}</p>}
      {row.status === 'uncertain' && <div className={css.reconcile}>
        <input value={evidence} aria-label={t('inbox.evidence')} placeholder={t('inbox.evidence')} onChange={event => setEvidence(event.target.value)} />
        <button type="button" disabled={evidence.trim() === ''} onClick={() => control('reconcile', row.id, 'done')}>{t('inbox.confirmDone')}</button>
        <button type="button" disabled={evidence.trim() === ''} onClick={() => control('reconcile', row.id, 'cancelled')}>{t('inbox.confirmCancelled')}</button>
      </div>}
    </div>)}
  </section>
}
