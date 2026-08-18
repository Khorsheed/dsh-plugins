/**
 * Member speech node ('room-speech' keyed renderer): identity row (16px
 * member-color dot + refChip-styled name capsule + provider in tertiary
 * grey) + unframed full-column markdown body (the official MarkdownText,
 * typographically identical to main-agent speech) + an action row replicating
 * the official MessageIconActions chrome: copy, child-session jump (when the
 * speech carries its handle), honest duration, and a hover-revealed clock.
 * Deliberately absent: branch (forking the room session has undefined
 * roster/blackboard semantics) and TPS/TTFT (a CLI run has no token stream).
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  IconCheckOutline16, IconCopyOutline16, IconLinkOutline16, MarkdownText, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { memberColor } from './member-color.ts'
import { formatClock, formatDurationMs } from './format.ts'
import type { RoomSpeechViewProps } from './slots.ts'
import css from './RoomSpeechView.module.css'

/** The member speech row. */
export function RoomSpeechView({ node, sessionId, roomStore, openSession, t }: RoomSpeechViewProps): ReactNode {
  const data = node.data
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  const member = state?.members.find(entry => entry.name === data.member)
  const provider = member === undefined
    ? undefined
    : member.kind === 'main-agent' ? t('member.kind.main') : member.provider
  const child = data.childSessionId

  const copy = (): void => {
    void writeClipboard(data.text).then((ok) => {
      if (!ok) return
      setCopied(true)
      copyTimer.current = setTimeout(() => { setCopied(false) }, 1000)
    })
  }

  return (
    <div className={css.speech} data-time-hover-root="">
      <div className={css.identity}>
        <span className={css.dot} style={{ background: memberColor(data.member) }} aria-hidden />
        <span className={css.chip}>{data.member}</span>
        {provider !== undefined && provider !== '' && <span className={css.provider}>{provider}</span>}
      </div>
      <div className={css.body}>
        <MarkdownText text={data.text} />
      </div>
      <div className={css.actions}>
        <Tooltip label={copied ? t('action.copied') : t('action.copy')} side="bottom">
          <button
            type="button"
            className={css.action}
            aria-label={copied ? t('action.copied') : t('action.copy')}
            onClick={copy}
          >
            {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
          </button>
        </Tooltip>
        {child !== undefined && (
          <Tooltip label={t('speech.jump')} side="bottom">
            <button
              type="button"
              className={css.action}
              aria-label={t('speech.jump')}
              onClick={() => { openSession(child) }}
            >
              <IconLinkOutline16 />
            </button>
          </Tooltip>
        )}
        {data.durationMs !== undefined && (
          <span className={css.meta}>{formatDurationMs(data.durationMs)}</span>
        )}
        <span className={css.time}>{formatClock(data.time)}</span>
      </div>
    </div>
  )
}
