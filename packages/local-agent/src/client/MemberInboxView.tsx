import { useEffect, useId, useState } from 'react'
import { IconChevronDownOutline14, IconChevronUpOutline14, IconQueueOutline14, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocalAgentMemberInbox, LocalAgentPromptResult } from '../types.ts'
import type { NS } from './locales.ts'
import css from './MemberInboxView.module.css'

export interface MemberInboxFace {
  read(): Promise<LocalAgentMemberInbox | undefined>
  control(action: 'pause' | 'resume' | 'cancel' | 'reconcile', requestId?: string, outcome?: 'done' | 'cancelled', evidence?: string): Promise<LocalAgentPromptResult | undefined>
}

/** Core owns admission; the dock displays only inputs still waiting for it. */
export function MemberInboxView({ face, t }: { face: MemberInboxFace } & PropsLocale<typeof NS>) {
  const [state, setState] = useState<LocalAgentMemberInbox>()
  const [error, setError] = useState<string>()
  const [evidence, setEvidence] = useState('')
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  useEffect(() => {
    let closed = false
    const refresh = (): void => { void face.read().then(value => { if (!closed && value !== undefined) setState(value) }, () => {}) }
    refresh()
    const timer = setInterval(refresh, 750)
    return () => { closed = true; clearInterval(timer) }
  }, [face])
  if (state === undefined) return null
  const queued = state.messages.filter(row => row.status === 'queued')
  const recovery = state.messages.filter(row => row.status === 'uncertain' || row.status === 'failed').slice(-8)
  if (queued.length === 0 && recovery.length === 0 && !state.paused && error === undefined && state.error === undefined) return null
  const control = (action: 'pause' | 'resume' | 'cancel' | 'reconcile', requestId?: string, outcome?: 'done' | 'cancelled'): void => {
    setError(undefined)
    void face.control(action, requestId, outcome, evidence).then(async result => {
      if (result?.ok !== true) setError(result?.error ?? t('member.sendFailed'))
      const next = await face.read()
      if (next !== undefined) setState(next)
    }).catch(failure => setError(String(failure)))
  }
  const pause = <button className={css.action} type="button" onClick={() => control(state.paused ? 'resume' : 'pause')}>{t(state.paused ? 'inbox.resume' : 'inbox.pause')}</button>
  return <section className={css.root} aria-label={t('inbox.title')}>
    <div className={css.panel}>
      {queued.length > 1 && <div className={css.header}>
        <button className={css.toggle} type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}>
          <IconQueueOutline14 /><span>{t('inbox.title')} · {queued.length}</span>
          {expanded ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
        </button>
        {pause}
      </div>}
      {(queued.length === 1 || expanded) && queued.length > 0 && <ul className={css.list} id={listId}>
        {queued.map(row => <li key={row.id} className={css.row}>
          <span className={css.lead} aria-label={t('inbox.status.queued')}><IconQueueOutline14 /></span>
          <span className={css.preview} title={row.text}>{row.text}</span>
          {queued.length === 1 && pause}
          <button className={css.iconAction} type="button" aria-label={t('inbox.cancel')} title={t('inbox.cancel')} onClick={() => control('cancel', row.id)}><IconTrashOutline16 /></button>
        </li>)}
      </ul>}
      {state.paused && <div className={css.notice}><span>{t('inbox.paused')}</span>{queued.length === 0 && pause}</div>}
      {(error ?? state.error) !== undefined && <p className={css.notice} role="alert">{error ?? state.error}</p>}
      {recovery.map(row => <div key={row.id} className={css.recovery}>
        <span>{t(`inbox.status.${row.status}` as 'inbox.status.uncertain')} · {row.text.slice(0, 160)}</span>
        {row.error !== undefined && <p>{row.error}</p>}
        {row.status === 'uncertain' && <div className={css.reconcile}>
          <input value={evidence} aria-label={t('inbox.evidence')} placeholder={t('inbox.evidence')} onChange={event => setEvidence(event.target.value)} />
          <button className={css.action} type="button" disabled={evidence.trim() === ''} onClick={() => control('reconcile', row.id, 'done')}>{t('inbox.confirmDone')}</button>
          <button className={css.action} type="button" disabled={evidence.trim() === ''} onClick={() => control('reconcile', row.id, 'cancelled')}>{t('inbox.confirmCancelled')}</button>
        </div>}
      </div>)}
    </div>
  </section>
}
