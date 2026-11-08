/**
 * A question a member asked mid-round, as that round's card up to the
 * question (room-timeline-order E1): the member's avatar beside a card
 * holding what the round said since it started (or since its previous
 * question) and, at its end, the question card. It stays where it was asked:
 * once answered, the question folds to 问 + 答 in place and the round's card
 * moves below the answer (「接着说」), so the human's answer and what the
 * member says next always sit one under the other.
 *
 * Its text: the landed reply's slice up to this question (from the question
 * log, replayed off the reply's offsets); while the round runs, the member's
 * live output between the previous settle and this question — or, when a
 * refresh cannot bring that back, 「……」 and the tail the question recorded;
 * a round that ended without placing it (stopped with no reply) keeps that
 * tail too. A reply whose offsets were not found carries its questions
 * itself (the pre-E1 look): this card then renders nothing.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { MarkdownText, StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconStopFillMedium } from './icons.tsx'
import { formatDurationMs } from './format.ts'
import { memberColor } from './member-color.ts'
import { pathMentions } from './path-mentions.ts'
import { RoomQuestionView } from './RoomQuestionView.tsx'
import { previousAsk, SEGMENT_ATTR, useRoundGroup } from './round-segments.ts'
import { markdownLabels } from './RoomSpeechView.tsx'
import type { RoomQuestionViewProps } from './slots.ts'
import type { RoomAsk } from '../types.ts'
import run from './RoomRunView.module.css'
import speech from './RoomSpeechView.module.css'

type Segment = NonNullable<RoomQuestionViewProps['segment']>

/** The question's round card. */
export function RoomSegmentView({ node, sessionId, answerQuestion, segment, t }: RoomQuestionViewProps & { readonly segment: Segment }): ReactNode {
  const { roomStore, renderMemberOutput, openSession, openPath, cancelMember } = segment
  const data = node.data
  const state = useSyncExternalStore(roomStore.subscribe, () => roomStore.getCached(sessionId))
  const root = useRef<HTMLDivElement>(null)
  const logged = state?.askLog?.find(entry => entry.id === data.questionId)
  // The node settles first (its own event); the log may lag a refresh behind.
  const ask: RoomAsk = { ...logged ?? { id: data.questionId, member: data.member, questions: data.questions, time: data.time }, state: data.state, ...data.runId === undefined ? {} : { runId: data.runId } }
  const previous = previousAsk(ask, state?.askLog)
  const execution = state?.executions?.find(entry => entry.id === data.runId)
  const round = execution ?? state?.runs.find(entry => entry.runId === data.runId)
  const running = round?.state === 'running'
  const pending = data.state === 'pending'
  const member = state?.members.find(entry => entry.name === data.member)
  const provider = member === undefined ? undefined : member.kind === 'main-agent' ? t('member.kind.main') : member.provider
  const childSessionId = member?.childSessionId
  const mentions = useMemo(() => openPath === undefined ? undefined : pathMentions((path) => { openPath(sessionId, path) }, member?.cwd), [openPath, sessionId, member?.cwd])
  const grouped = useRoundGroup(root, data.runId, previous !== undefined)
  const labels = useMemo(() => markdownLabels(t), [t])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!pending || !running) return undefined
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [pending, running])
  // The landed reply carries its questions itself (an offset not found).
  if (logged?.reply?.inline === true) return null

  const tail = ask.before === undefined || ask.before.trim() === ''
    ? undefined
    : <div className={speech.tail}><MarkdownText text={`……${ask.before.trimStart()}`} labels={labels} fileMentions={mentions} /></div>
  const said = logged?.reply !== undefined
    ? (logged.reply.said.trim() === '' ? undefined : <MarkdownText text={logged.reply.said} labels={labels} fileMentions={mentions} />)
    : running && round !== undefined && childSessionId !== undefined && renderMemberOutput !== undefined
      ? renderMemberOutput(childSessionId, round.startedAt, {
        since: previous?.resolvedAt ?? previous?.time ?? round.startedAt,
        until: ask.time,
        ...tail === undefined ? {} : { empty: tail },
        ...mentions === undefined ? {} : { fileMentions: mentions },
      })
      : tail

  const header = pending
    ? (
      <div
        className={run.run}
        data-state="running"
        role="button"
        tabIndex={0}
        onClick={() => { if (childSessionId !== undefined) openSession(childSessionId) }}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && childSessionId !== undefined) { event.preventDefault(); openSession(childSessionId) }
        }}
      >
        <StateDot state="warning" />
        {previous !== undefined && <span className={speech.cont}>{t('segment.continued')}</span>}
        <span className={run.title}>{t('run.waiting', { member: data.member })}</span>
        {round !== undefined && <span className={run.elapsed} aria-hidden>· {formatDurationMs(Math.max(0, now - round.startedAt))}</span>}
        {round?.state !== 'running' ? null : <Tooltip label={t('run.stop')} side="bottom">
          <button
            type="button"
            className={run.stop}
            aria-label={t('run.stop')}
            onClick={(event) => { event.stopPropagation(); void cancelMember(data.member) }}
          >
            <IconStopFillMedium />
          </button>
        </Tooltip>}
      </div>
    )
    : (
      <div className={speech.identity}>
        {!grouped && <span className={speech.name}>{data.member}</span>}
        {!grouped && member?.role !== undefined && <span className={speech.role}>{member.role}</span>}
        {!grouped && provider !== undefined && provider !== '' && <span className={speech.provider}>{provider}</span>}
        {previous !== undefined && <span className={speech.cont}>{t('segment.continued')}</span>}
        <span className={speech.cont}>{t('segment.asked')}</span>
      </div>
    )

  return (
    <div
      ref={root}
      className={grouped ? `${speech.speech} ${speech.grouped}` : speech.speech}
      {...{ [SEGMENT_ATTR]: data.runId }}
      data-room-question={data.questionId}
      style={{ '--member-color': memberColor(data.member) } as CSSProperties}
    >
      <span className={speech.avatar} aria-hidden>{data.member.slice(0, 1).toUpperCase()}</span>
      <div className={pending ? `${speech.card} ${run.liveCard}` : speech.card}>
        {header}
        {said !== undefined && <div className={speech.body}>{said}</div>}
        <RoomQuestionView {...{ node, answerQuestion, t } as unknown as RoomQuestionViewProps} inline={{}} />
      </div>
    </div>
  )
}
