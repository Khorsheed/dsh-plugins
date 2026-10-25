/**
 * Cross-session help, on both ends.
 *
 * - `room-help` (the asking room): one line per thread — who asked which
 *   session, where it stands — that opens to the request and every message
 *   on the thread (the helper's questions, its reply with the handoff, the
 *   asker's follow-ups), plus a jump into the helper's session.
 * - `room-help-request` (the helper's session): the request the room queued
 *   there, as a card naming the asking room and member, with a jump back.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { RoomHelpRequestViewProps, RoomHelpViewProps } from './slots.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { NUDGE_AFTER } from '../helps.ts'
import css from './RoomHelpView.module.css'

const NO_STORE = (): (() => void) => () => {}

/** Default minutes before an unanswered request turns amber (the room setting's default). */
const REMINDER_MINUTES = 30

/** The thread row in the asking room. */
export function RoomHelpView({ node, sessionId, roomStore, openSession, linkSession, dismissNudge, t }: RoomHelpViewProps): ReactNode {
  const help = node.data.help
  const [open, setOpen] = useState(false)
  // An unanswered request (queued, or the helper still on it) past the room's
  // reminder turns amber with how long it has waited; nothing is cancelled.
  const state = useSyncExternalStore(roomStore?.subscribe ?? NO_STORE, () => roomStore?.getCached(sessionId))
  const minutes = state?.settings?.helpReminderMinutes ?? REMINDER_MINUTES
  // The third ask of one plain session, once answered: a one-time hint to keep
  // it on the member list (unless it is already there, or the hint was dismissed).
  const target = help.target.sessionId
  const asks = (state?.helps ?? []).filter(entry => entry.target.sessionId === target && entry.target.room !== true)
  const nudge = help.state === 'replied' && help.target.room !== true && linkSession !== undefined
    && asks.length >= NUDGE_AFTER && asks[NUDGE_AFTER - 1]?.id === help.id
    && state?.linked?.some(entry => entry.sessionId === target) !== true
    && state?.helpNudgesDismissed?.includes(target) !== true
  const waiting = help.state === 'queued' || help.state === 'running'
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => { setNow(Date.now()) }, 30_000)
    return () => { clearInterval(timer) }
  }, [waiting])
  const waited = Math.floor((now - help.since) / 60_000)
  const overdue = waiting && waited >= minutes
  return (
    <div className={css.thread} data-state={help.state} data-overdue={overdue ? '' : undefined}>
      <div className={css.line}>
        <span aria-hidden className={css.icon}>{help.state === 'replied' ? '✓' : help.state === 'failed' ? '!' : '↗'}</span>
        <span className={css.text}>{t('help.title', { from: help.fromName, target: help.target.title })}</span>
        <span className={css.tag} data-state={overdue ? 'overdue' : help.state}>
          {t(`help.state.${help.state}` as never)}{help.state === 'failed' && help.error !== undefined ? `：${help.error}` : ''}
          {overdue && t('help.waited', { minutes: waited })}
        </span>
        <button type="button" className={css.action} aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
          {t(open ? 'help.collapse' : 'help.expand')}
        </button>
        <button type="button" className={css.action} onClick={() => { openSession(help.target.sessionId as SessionId) }}>{t('help.open')}</button>
      </div>
      {nudge && (
        <div className={css.nudge}>
          <span>{t('help.nudge', { count: asks.length })}</span>
          <button type="button" className={css.action} onClick={() => { linkSession(target, help.target.title) }}>{t('help.nudgeLink')}</button>
          {dismissNudge !== undefined && <button type="button" className={css.action} onClick={() => { dismissNudge(target) }}>{t('help.nudgeDismiss')}</button>}
        </div>
      )}
      {open && (
        <div className={css.body}>
          <div className={css.entry}>
            <span className={css.label}>{t('help.request')}</span>
            <p className={css.copy}>{help.text}</p>
          </div>
          {help.messages.map((message, index) => (
            <div key={index} className={css.entry} data-kind={message.kind}>
              <span className={css.label}>
                {message.kind === 'message'
                  ? t('help.msg.message', { from: help.fromName })
                  : t(message.kind === 'reply' ? (message.fallback === true ? 'help.msg.fallback' : 'help.msg.reply') : 'help.msg.question')}
              </span>
              <p className={css.copy}>{message.text}</p>
              {message.handoff !== undefined && <p className={css.handoff}><b>{t('help.handoff')}</b>{message.handoff}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Lines past which the request card folds. */
const FOLD_LINES = 6

/** The request card in the helper's session. */
export function RoomHelpRequestView({ node, openSession, t }: RoomHelpRequestViewProps): ReactNode {
  const data = node.data
  const [open, setOpen] = useState(false)
  const long = data.text.split('\n').length > FOLD_LINES || data.text.length > 360
  return (
    <div className={css.card}>
      <div className={css.cardHead}>
        <span aria-hidden className={css.icon}>↘</span>
        <span className={css.cardTitle}>
          {t(data.op === 'message' ? 'help.card.message' : 'help.card.request', { room: data.roomTitle, from: data.from })}
          {data.member !== undefined && t('help.card.to', { member: data.member })}
        </span>
        {data.held === true && <span className={css.tag}>{t('help.card.held')}</span>}
        <button type="button" className={css.action} onClick={() => { openSession(data.room as SessionId) }}>{t('help.card.back')}</button>
      </div>
      <p className={css.cardBody} data-folded={long && !open ? 'true' : undefined}>{data.text}</p>
      {long && (
        <button type="button" className={css.more} onClick={() => { setOpen(value => !value) }}>{t(open ? 'help.card.less' : 'help.card.more')}</button>
      )}
    </div>
  )
}
