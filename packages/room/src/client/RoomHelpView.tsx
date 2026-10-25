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
import { useState, type ReactNode } from 'react'
import type { RoomHelpRequestViewProps, RoomHelpViewProps } from './slots.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import css from './RoomHelpView.module.css'

/** The thread row in the asking room. */
export function RoomHelpView({ node, openSession, t }: RoomHelpViewProps): ReactNode {
  const help = node.data.help
  const [open, setOpen] = useState(false)
  return (
    <div className={css.thread} data-state={help.state}>
      <div className={css.line}>
        <span aria-hidden className={css.icon}>{help.state === 'replied' ? '✓' : help.state === 'failed' ? '!' : '↗'}</span>
        <span className={css.text}>{t('help.title', { from: help.fromName, target: help.target.title })}</span>
        <span className={css.tag} data-state={help.state}>
          {t(`help.state.${help.state}` as never)}{help.state === 'failed' && help.error !== undefined ? `：${help.error}` : ''}
        </span>
        <button type="button" className={css.action} aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
          {t(open ? 'help.collapse' : 'help.expand')}
        </button>
        <button type="button" className={css.action} onClick={() => { openSession(help.target.sessionId as SessionId) }}>{t('help.open')}</button>
      </div>
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
        <span className={css.cardTitle}>{t(data.op === 'message' ? 'help.card.message' : 'help.card.request', { room: data.roomTitle, from: data.from })}</span>
        <button type="button" className={css.action} onClick={() => { openSession(data.room as SessionId) }}>{t('help.card.back')}</button>
      </div>
      <p className={css.cardBody} data-folded={long && !open ? 'true' : undefined}>{data.text}</p>
      {long && (
        <button type="button" className={css.more} onClick={() => { setOpen(value => !value) }}>{t(open ? 'help.card.less' : 'help.card.more')}</button>
      )}
    </div>
  )
}
