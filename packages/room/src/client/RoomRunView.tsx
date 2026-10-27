/**
 * Member run node ('room-run' keyed renderer): a ToolRow-isomorphic 24px
 * line — StateDot +「ada 正在工作… · 12s」+ the running sweep (with a
 * prefers-reduced-motion fallback). The WHOLE row jumps into the member's
 * child session (looked up from the room store's roster — run events carry
 * no handle), and a trailing stop button cancels through the Remote. A
 * failed run stays as a dim error row with the journaled reason (truncated,
 * the full text on hover); done/cancelled are hidden by the Definition and
 * never reach here. A RUNNING member's row takes the speech card's shape —
 * avatar and light card, the row as the card's header, the live output
 * below — so the reply card that replaces it lands in the same place.
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconStopFillMedium } from './icons.tsx'
import { formatDurationMs } from './format.ts'
import type { RoomRunViewProps } from './slots.ts'
import { memberColor } from './member-color.ts'
import { pathMentions } from './path-mentions.ts'
import css from './RoomRunView.module.css'
import speech from './RoomSpeechView.module.css'

/** The member run row. */
export function RoomRunView({ node, sessionId, roomStore, openSession, cancelMember, renderMemberOutput, openPath, t }: RoomRunViewProps): ReactNode {
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  const recovered = state?.runs.find(run => run.member === node.data.member && run.startedAt === node.data.startedAt)
  const data = node.data.state === 'running' && recovered !== undefined ? { ...node.data, ...recovered } : node.data
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (data.state !== 'running') return undefined
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [data.state])
  // The run events carry no delegation handle; the roster record does.
  const rosterEntry = state?.members.find(entry => entry.name === data.member)
  const childSessionId = rosterEntry?.childSessionId
  // Paths the member writes while it works open in the sidebar's file viewer.
  const memberCwd = rosterEntry?.cwd
  const mentions = useMemo(() => openPath === undefined ? undefined : pathMentions((path) => { openPath(sessionId, path) }, memberCwd), [openPath, sessionId, memberCwd])
  // The Definition hides done/cancelled; guard the same states here.
  if (data.state === 'done' || data.state === 'cancelled') return null

  const failed = data.state === 'failed'
  const elapsed = failed ? data.elapsedMs : Math.max(0, now - data.startedAt)
  const jump = (): void => {
    if (childSessionId !== undefined) openSession(childSessionId)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      jump()
    }
  }
  const row = (
    <div
      className={css.run}
      data-state={failed ? 'failed' : 'running'}
      role="button"
      tabIndex={0}
      onClick={jump}
      onKeyDown={onKeyDown}
    >
      <StateDot state={failed ? 'error' : 'ongoing'} />
      <span className={css.title}>
        {failed ? t('run.failed', { member: data.member }) : t('run.working', { member: data.member })}
      </span>
      <span className={css.elapsed} aria-hidden>· {elapsed === undefined ? t('run.durationUnknown') : formatDurationMs(elapsed)}</span>
      {failed && data.error !== undefined && (
        <span className={css.reason} title={data.error}>{data.error}</span>
      )}
      {!failed && (
        <Tooltip label={t('run.stop')} side="bottom">
          <button
            type="button"
            className={css.stop}
            aria-label={t('run.stop')}
            onClick={(event) => {
              event.stopPropagation()
              void cancelMember(data.member)
            }}
          >
            <IconStopFillMedium />
          </button>
        </Tooltip>
      )}
    </div>
  )
  if (failed) return <div>{row}</div>
  return (
    <div className={speech.speech} style={{ '--member-color': memberColor(data.member) } as CSSProperties}>
      <span className={speech.avatar} aria-hidden>{data.member.slice(0, 1).toUpperCase()}</span>
      <div className={`${speech.card} ${css.liveCard}`}>
        {row}
        {childSessionId !== undefined && (mentions === undefined ? renderMemberOutput?.(childSessionId, data.startedAt) : renderMemberOutput?.(childSessionId, data.startedAt, { fileMentions: mentions }))}
      </div>
    </div>
  )
}
