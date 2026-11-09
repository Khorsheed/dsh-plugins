import { useEffect, useId, useState } from 'react'
import { IconChevronDownOutlineMedium, IconChevronUpOutlineMedium, IconQueueOutlineMedium, IconTrashOutlineMedium } from './icons.tsx'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocalAgentMemberInbox, LocalAgentMemberInput, LocalAgentPromptResult } from '../types.ts'
import type { NS } from './locales.ts'
import css from './MemberInboxView.module.css'

export interface MemberInboxFace {
  read(): Promise<LocalAgentMemberInbox | undefined>
  control(action: 'pause' | 'resume' | 'cancel', requestId?: string): Promise<LocalAgentPromptResult | undefined>
}

/**
 * Core owns admission; the dock displays only inputs still waiting for it.
 * A round a host restart cut off needs nothing here (restart-recovery
 * consolidation): it is closed, and a members-page round continues on its
 * own — that row reads 「重启后继续」 (its preview).
 * `room`: the room's own copy under its composer — the room's queued rows
 * are left out (each reads on its message in the room timeline) and the
 * pause control lives on the room's capsule (room-timeline B2).
 */
export function MemberInboxView({ face, room = false, t }: { face: MemberInboxFace; room?: boolean } & PropsLocale<typeof NS>) {
  const [state, setState] = useState<LocalAgentMemberInbox>()
  const [error, setError] = useState<string>()
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
  const queued = state.messages.filter(row => row.status === 'queued' && !(room && row.caller === 'room'))
  // A failure is shown for composer input only.
  const recovery = state.messages.filter(row => row.status === 'failed' && (row.caller ?? 'composer') === 'composer').slice(-8)
  // A composer row with a preview (the restart continuation) reads it; another
  // caller's row reads its preview when it left one (a room: 「来自协作间：…」),
  // else the caller's name.
  const preview = (row: LocalAgentMemberInput): string => ((row.caller ?? 'composer') === 'composer' ? row.preview : undefined) ?? row.text
    ?? (row.preview !== undefined && row.caller === 'room' ? t('inbox.fromRoom', { text: row.preview }) : undefined)
    ?? t(`inbox.caller.${row.caller ?? 'api'}` as 'inbox.caller.api')
  if (queued.length === 0 && recovery.length === 0 && (room || !state.paused) && error === undefined && state.error === undefined) return null
  const control = (action: 'pause' | 'resume' | 'cancel', requestId?: string): void => {
    setError(undefined)
    void face.control(action, requestId).then(async result => {
      if (result?.ok !== true) setError(result?.error ?? t('member.sendFailed'))
      const next = await face.read()
      if (next !== undefined) setState(next)
    }).catch(failure => setError(String(failure)))
  }
  const pause = room ? null : <button className={css.action} type="button" onClick={() => control(state.paused ? 'resume' : 'pause')}>{t(state.paused ? 'inbox.resume' : 'inbox.pause')}</button>
  return <section className={css.root} aria-label={t('inbox.title')}>
    <div className={css.panel}>
      {queued.length > 1 && <div className={css.header}>
        <button className={css.toggle} type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}>
          <IconQueueOutlineMedium /><span>{t('inbox.title')} · {queued.length}</span>
          {expanded ? <IconChevronUpOutlineMedium /> : <IconChevronDownOutlineMedium />}
        </button>
        {pause}
      </div>}
      {(queued.length === 1 || expanded) && queued.length > 0 && <ul className={css.list} id={listId}>
        {queued.map(row => <li key={row.id} className={css.row}>
          <span className={css.lead} aria-label={t('inbox.status.queued')}><IconQueueOutlineMedium /></span>
          <span className={css.preview} title={preview(row)}>{preview(row)}</span>
          {queued.length === 1 && pause}
          <button className={css.iconAction} type="button" aria-label={t('inbox.cancel')} title={t('inbox.cancel')} onClick={() => control('cancel', row.id)}><IconTrashOutlineMedium /></button>
        </li>)}
      </ul>}
      {state.paused && !room && <div className={css.notice}><span>{t('inbox.paused')}</span>{queued.length === 0 && pause}</div>}
      {(error ?? state.error) !== undefined && <p className={css.notice} role="alert">{error ?? state.error}</p>}
      {recovery.map(row => <div key={row.id} className={css.recovery}>
        <span>{t('inbox.status.failed')} · {preview(row).slice(0, 160)}</span>
        {row.error !== undefined && <p>{row.error}</p>}
      </div>)}
    </div>
  </section>
}
