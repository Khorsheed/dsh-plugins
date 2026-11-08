/**
 * Member run node ('room-run' keyed renderer): a ToolRow-isomorphic 24px
 * line — StateDot +「ada 正在工作… · 12s」+ the running sweep (with a
 * prefers-reduced-motion fallback). The WHOLE row jumps into the member's
 * child session (looked up from the room store's roster — run events carry
 * no handle), and a trailing stop button cancels through the Remote. A
 * failed run stays as a dim error row with the journaled reason (truncated,
 * the full text on hover); done/cancelled are hidden by the Definition and
 * never reach here. A CLI round the core's ledger says a restart cut off
 * reads 待对账 (a warning row, no stop) until it is reconciled — here, on
 * the members page or in the edit dialog — and so does the row of a
 * delivery waiting for its member's 待对账 (batch 5 S7). A RUNNING member's row takes the speech card's shape —
 * avatar and light card, the row as the card's header, the live output
 * below — so the reply card that replaces it lands in the same place.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconStopFillMedium } from './icons.tsx'
import { formatDurationMs } from './format.ts'
import { attachmentsByOwner, type RoomRunViewProps } from './slots.ts'
import { memberColor } from './member-color.ts'
import { pathMentions } from './path-mentions.ts'
import { continuedSince, useRoundGroup } from './round-segments.ts'
import { RunSubagentWait } from './SubagentCards.tsx'
import css from './RoomRunView.module.css'
import speech from './RoomSpeechView.module.css'

/** The member run row. */
export function RoomRunView({ node, sessionId, roomStore, openSession, cancelMember, renderMemberOutput, openPath, renderSlot, memberSubagents, t }: RoomRunViewProps): ReactNode {
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  // The projected run this card is (its execution by run id, else the
  // member's latest run): the projection reads the core, the card's own
  // edges may be behind it.
  const own = node.data.runId === undefined ? undefined : state?.executions?.find(entry => entry.id === node.data.runId)
  // A row of a run that has since started again under the same run id (a
  // delivery that waited for 待对账 and went out): that run has its own card.
  const superseded = own !== undefined && own.startedAt !== node.data.startedAt
  const recovered = own ?? state?.runs.find(run => run.member === node.data.member && run.startedAt === node.data.startedAt)
  const data = recovered !== undefined && !superseded && (node.data.state === 'running' || own !== undefined) ? { ...node.data, ...recovered } : node.data
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
  // A question this round stopped on is the round's card for now (its
  // question card holds what the round said up to it, E1): this card steps
  // aside until it is answered, then shows only what came after (「接着说」).
  const runId = recovered?.runId
  const waiting = runId === undefined ? [] : (state?.askLog ?? []).filter(ask => ask.runId === runId && ask.state === 'pending')
  const since = continuedSince(state?.askLog, runId)
  const root = useRef<HTMLDivElement>(null)
  const grouped = useRoundGroup(root, runId, since !== undefined)
  const attachments = runId === undefined ? [] : state?.executions?.find(entry => entry.id === runId)?.attachments ?? []
  const mentions = useMemo(() => openPath === undefined ? undefined : pathMentions((path) => { openPath(sessionId, path) }, memberCwd), [openPath, sessionId, memberCwd])
  // The Definition hides done/cancelled; guard the same states here.
  if (superseded || data.state === 'done' || data.state === 'cancelled') return null
  if (waiting.length > 0 && data.state === 'running') return null

  const failed = data.state === 'failed'
  const uncertain = data.state === 'uncertain'
  const waitsForReconcile = uncertain && (data as { waiting?: string }).waiting === 'reconcile'
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
      data-state={failed ? 'failed' : uncertain ? 'uncertain' : 'running'}
      role="button"
      tabIndex={0}
      onClick={jump}
      onKeyDown={onKeyDown}
    >
      <StateDot state={failed ? 'error' : uncertain || waiting.length > 0 ? 'warning' : 'ongoing'} />
      <span className={css.title}>
        {uncertain ? t(waitsForReconcile ? 'run.waitingReconcile' : 'run.uncertain', { member: data.member }) : failed ? t('run.failed', { member: data.member }) : waiting.length > 0 ? t('run.waiting', { member: data.member }) : data.operation === 'compact' ? t('run.compacting', { member: data.member }) : data.continues !== undefined ? t('run.selfRound', { member: data.member }) : t('run.working', { member: data.member })}
      </span>
      {uncertain
        ? <span className={css.hint} title={t(waitsForReconcile ? 'run.waitingReconcileHint' : 'run.uncertainHint')}>· {t(waitsForReconcile ? 'run.waitingReconcileHint' : 'run.uncertainHint')}</span>
        : <span className={css.elapsed} aria-hidden>· {elapsed === undefined ? t('run.durationUnknown') : formatDurationMs(elapsed)}</span>}
      {/* A foreground subagent the member waits for is the round's current action. */}
      {!failed && !uncertain && waiting.length === 0 && (
        <RunSubagentWait face={memberSubagents} childSessionId={childSessionId} startedAt={data.startedAt} openSession={id => { openSession(id as never) }} t={t} className={css.wait} linkClassName={css.link} fullClassName={css.waitFull} shortClassName={css.waitShort} />
      )}
      {failed && data.error !== undefined && (
        <span className={css.reason} title={data.error}>{data.error}</span>
      )}
      {!failed && !uncertain && (
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
  if (failed || uncertain) return <div>{row}</div>
  return (
    <div ref={root} className={grouped ? `${speech.speech} ${speech.grouped}` : speech.speech} data-room-run-live={runId} style={{ '--member-color': memberColor(data.member) } as CSSProperties}>
      <span className={speech.avatar} aria-hidden>{data.member.slice(0, 1).toUpperCase()}</span>
      <div className={`${speech.card} ${css.liveCard}`}>
        {row}
        {childSessionId !== undefined && (since === undefined && mentions === undefined
          ? renderMemberOutput?.(childSessionId, data.startedAt)
          : renderMemberOutput?.(childSessionId, data.startedAt, { ...since === undefined ? {} : { since }, ...mentions === undefined ? {} : { fileMentions: mentions } }))}
        {/* What this run has put on the room's desk so far, live. */}
        {attachments.length > 0 && (
          <div className={speech.attachments}>
            {attachmentsByOwner(attachments).map(([owner, group]) => (
              <div key={owner}>
                {renderSlot('room.run.attachment', { sessionId, owner, attachments: group, live: true }, { entryKey: owner, fallback: null })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
