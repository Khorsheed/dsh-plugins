/**
 * A station's gate tab: 章节考 on a quiz / read station (the paper card, the
 * points, the ask settings with the pending ask kept per station, the
 * station's own mistakes folded into one card, earlier papers), and the
 * acceptance sheet on an acceptance station.
 *
 * @module @khorsheed/dsh-library/client/views/station-quiz
 */
import { useEffect, useState, type ReactNode } from 'react'
import { ListRow } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import {
  acceptanceLines, coverKind, type LibraryAcceptanceLine, type LibraryAssessment, type LibraryAttempt, type LibraryQuizFocus, type LibraryQuizQuestion, type LibraryVerdict, type RoadmapNode,
} from '../../types.ts'
import { collectVoided, type MissedRow } from '../mistakes.ts'
import type { LibraryQuizSettings } from '../store.ts'
import { IconCheckOutlineMedium, IconInfoOutlineMedium } from '../icons.tsx'
import { outcome, StateLine, useLoad, value, when, type ViewProps } from '../ui.tsx'
import { MASTERY_MIN_RIGHT, MASTERY_MIN_SITTINGS, stationMastery, type LibraryPointMastery } from '../../mastery.ts'
import { MathText } from '../math.tsx'
import css from '../LibraryPane.module.css'
import { QuizRows, sourceMix } from './book.tsx'

/** The right answer as a row caption: choice questions get their letter. */
function answerText(question: LibraryQuizQuestion): string {
  const at = question.options?.indexOf(question.answer) ?? -1
  return at >= 0 ? `${String.fromCharCode(65 + at)}. ${question.answer}` : question.answer
}

/** One missed / flagged question row: the mark, the prompt, and where it sits (answer · when · book). */
function MissRow({ p, row, variant, book }: { p: ViewProps['p']; row: Pick<MissedRow, 'question' | 'at'>; variant: 'missed' | 'voided'; book?: string | undefined }): ReactNode {
  const { t } = p
  return (
    <div className={css.missRow}>
      <span className={css.missMark} data-void={variant === 'voided' ? 'true' : undefined} aria-hidden="true">{variant === 'voided' ? '?' : '✕'}</span>
      <div className={css.missText}>
        <span><MathText text={row.question.prompt} /></span>
        <span className={css.muted}>
          {variant === 'missed' && <><MathText text={t('node.missedAnswer', { answer: answerText(row.question) })} /> · </>}
          {when(row.at, t)}{book === undefined ? '' : ` · ${book}`}
        </span>
      </div>
    </div>
  )
}

/**
 * 章节考 on a quiz / read station, one line of travel (proposal
 * 2026-10-19-library-point-mastery): the pass line, the points map (tap a
 * point for why and what to do), then ONE primary action by state — an
 * untaken paper → 开始作答; open misses → 开始订正 (a retake paper, judged
 * here, never counted toward passing); else → 出题, its settings folded into
 * a one-line summary beside the button. Earlier papers fold at the bottom.
 * The settings and the pending ask live in the pane store per station.
 */
export function QuizTab({ p, projectId, resourceId, node, passRatio, onPrime, onReplace }: {
  p: ViewProps['p']; projectId: string; resourceId: string | undefined; node: RoadmapNode; passRatio: number; onPrime: (focus: LibraryQuizFocus, context?: { weak?: readonly string[]; points?: readonly string[]; kinds?: readonly LibraryQuizQuestion['kind'][]; count?: number | undefined }) => void; onReplace: (prompts: string[]) => void
}): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  const [showSettings, setShowSettings] = useState(false)
  const [showPointsHint, setShowPointsHint] = useState(false)
  const [expanded, setExpanded] = useState<string | undefined>()
  const [retaking, setRetaking] = useState(false)
  const [error, setError] = useState<string | undefined>()
  // The settings (范围 / 重点 / 题型 / 题量) and the pending ask live in the pane
  // store per station, so leaving the tab and coming back keeps both.
  const stationKey = `${projectId}:${resourceId ?? ''}:${node.id}`
  const station = useStore(s => s.quiz[stationKey])
  const settings = station?.settings ?? DEFAULT_SETTINGS
  const direction = settings.focus
  const picked = settings.picked
  const kinds = settings.kinds
  const countText = settings.countText
  const update = (patch: Partial<LibraryQuizSettings>): void => { actions.setQuizSettings(stationKey, { ...settings, ...patch }) }
  // After asking, re-read until the coach has stored the new quiz; past the
  // patience window the card says so instead of silently giving up.
  const watching = station?.ask
  const [now, setNow] = useState(Date.now())
  const stale = watching !== undefined && now - watching.since > ASK_PATIENCE_MS
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (watching === undefined || stale) return
    const timer = setInterval(() => {
      setNow(Date.now())
      setTick(current => current + 1)
    }, 4000)
    return () => { clearInterval(timer) }
  }, [watching, stale])
  // Every assessment of the project (papers, retakes): mastery reads them all.
  const assessments = useLoad(() => value(p.listAssessments(projectId)), [projectId, rev, tick])
  const attempts = useLoad(() => value(p.listAttempts(projectId)), [projectId, rev])
  const mine = useLoad(() => value(p.listCards({ projectId, nodeId: node.id, limit: 5 })), [projectId, node.id, rev])
  const all = assessments.data?.assessments ?? []
  const allAttempts = attempts.data?.attempts ?? []
  const shown = all.filter(quiz => quiz.type === 'quiz'
    && (quiz.scope.nodeId === node.id || (quiz.scope.nodeId === undefined && (resourceId !== undefined ? quiz.scope.resourceId === resourceId : quiz.scope.resourceId === undefined))))
  const quizCount = shown.length
  // The quiz the learner is waiting for opens itself when it lands.
  useEffect(() => {
    if (watching === undefined || assessments.data === undefined || quizCount <= watching.count) return
    actions.setQuizAsk(stationKey, undefined)
    const landed = shown.at(-1)
    if (landed !== undefined) actions.push({ view: 'quiz', projectId, ...(landed.scope.resourceId === undefined ? {} : { resourceId: landed.scope.resourceId }), quizId: landed.id })
  }, [quizCount, watching])
  const stats = node.quizStats
  const mineCount = mine.data?.total ?? 0
  const papers = shown.filter(quiz => quiz.scope.nodeId === node.id)
  const live = papers.filter(quiz => quiz.supersededBy === undefined)
  const latest = live.at(-1) ?? papers.at(-1)
  const loose = shown.filter(quiz => quiz.scope.nodeId === undefined)
  const latestByQuiz = new Map<string, LibraryAttempt>()
  for (const attempt of [...allAttempts].sort((a, b) => b.at.localeCompare(a.at))) {
    if (attempt.assessmentId !== undefined && !latestByQuiz.has(attempt.assessmentId)) latestByQuiz.set(attempt.assessmentId, attempt)
  }
  const untaken = latest !== undefined && !latestByQuiz.has(latest.id) ? latest : undefined
  const mastery = stationMastery(node, all, allAttempts)
  const open = mastery.open
  const voided = collectVoided(allAttempts, latest === undefined ? [] : [latest])
  const weakTitles = mastery.points.filter(point => point.state === 'weak').map(point => point.title)
  const pickedTitles = mastery.points.filter(point => picked.includes(point.id)).map(point => point.title)
  const primary: 'answer' | 'retake' | 'ask' = untaken !== undefined ? 'answer' : open.length > 0 ? 'retake' : 'ask'

  const openPaper = (quiz: LibraryAssessment): void => {
    actions.push({ view: 'quiz', projectId, ...(quiz.scope.resourceId === undefined ? (resourceId === undefined ? {} : { resourceId }) : { resourceId: quiz.scope.resourceId }), quizId: quiz.id })
  }
  const parsedCount = (): number => {
    const parsed = Number.parseInt(countText.trim(), 10)
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_QUIZ_COUNT) : DEFAULT_QUIZ_COUNT
  }
  const ask = (focusPoints?: readonly string[]): void => {
    const count = parsedCount()
    // No picked points: the weak ones are the focus (the coach also reads them every turn).
    const points = focusPoints ?? (pickedTitles.length > 0 ? pickedTitles : weakTitles)
    onPrime(direction, { weak: weakTitles, points, kinds, count })
    const summary = [t(`focus.${direction}`), kinds.length === 0 ? t('node.kindsMixed') : kinds.map(kind => t(`kind.${kind}`)).join('、'), t('node.askCount', { count: String(count) }), ...(points.length > 0 ? [t('node.askFocusPicked', { points: points.join('、') })] : [])].join(' · ')
    actions.setQuizAsk(stationKey, { since: Date.now(), count: quizCount, summary })
    setNow(Date.now())
  }
  const retake = async (keys?: readonly string[]): Promise<void> => {
    if (resourceId === undefined || retaking) return
    setRetaking(true)
    setError(undefined)
    try {
      const created = await outcome(p.createRetake(projectId, resourceId, node.id, keys))
      setExpanded(undefined)
      actions.push({ view: 'quiz', projectId, resourceId, quizId: created.assessment.id })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setRetaking(false)
    }
  }
  const asking = watching !== undefined && !stale
  const askParts: [string, string][] = [
    [t('node.setting.range'), t(`focus.${direction}`)],
    [t('node.kindsTitle'), kinds.length === 0 || kinds.length === QUIZ_KINDS.length ? t('node.kindsMixed') : kinds.map(kind => t(`kind.${kind}`)).join('、')],
    [t('node.countTitle'), t('node.askCount', { count: String(parsedCount()) })],
    [t('node.focusPoints'), pickedTitles.length > 0 ? t('node.pointsPicked', { count: String(pickedTitles.length) }) : weakTitles.length > 0 ? t('node.pointsWeak', { count: String(weakTitles.length) }) : t('node.pointsCoach')],
  ]
  const openByPoint = mastery.points.filter(point => point.open.length > 0).map(point => `${point.title} ${point.open.length}`)
  const openLoose = open.filter(miss => miss.question.point === undefined || !mastery.points.some(point => point.id === miss.question.point)).length

  return (
    <>
      {node.state === 'locked' && <div className={css.notice}>{t('node.locked')}</div>}
      <div className={css.muted}>
        {t('node.passRule', { percent: String(Math.round(passRatio * 100)) })}
        {stats !== undefined && stats.attempts > 0 ? ` · ${t('node.best', { percent: String(Math.round((stats.bestRatio ?? 0) * 100)), attempts: String(stats.attempts) })}` : ` · ${t('node.neverSat')}`}
        {node.state === 'done' ? ` · ${t('node.passedTag')}` : ''}
      </div>
      <StateLine loaded={assessments} t={t} />
      {error !== undefined && <div className={css.error}>{error}</div>}
      {watching !== undefined && (
        <section className={css.asking} role="status" data-stale={stale}>
          <span className={css.askingText}>
            <strong>{stale ? t('node.askStale') : t('node.asking')}</strong>
            <span className={css.muted}>{watching.summary} · {t('node.askSince', { minutes: String(Math.max(1, Math.round((now - watching.since) / 60_000))) })}</span>
          </span>
          {stale ? <button type="button" className={css.secondary} onClick={() => { ask() }}>{t('node.askAgain')}</button> : null}
          <button type="button" className={css.textButton} onClick={() => { actions.setQuizAsk(stationKey, undefined) }}>{t('node.askDismiss')}</button>
        </section>
      )}
      {mastery.points.length > 0 && (
        <section className={css.section}>
          <h3 className={`${css.sectionTitle} ${css.pointsHead}`}>
            {t('node.pointsTitle')}
            <button type="button" className={css.infoButton} aria-expanded={showPointsHint} aria-label={t('node.pointsHintLabel')} onClick={() => { setShowPointsHint(shown => !shown) }}><IconInfoOutlineMedium size={13} /></button>
          </h3>
          <div className={css.pointRows}>
            {mastery.points.map(point => {
              const isOpen = expanded === point.id
              return (
                <div key={point.id} className={css.pointItem} data-open={isOpen}>
                  <button type="button" className={css.pointRow} aria-expanded={isOpen} onClick={() => { setExpanded(isOpen ? undefined : point.id) }}>
                    <span className={css.pointRowMain}>
                      <span className={css.pointRowTitle}>{point.title}</span>
                      <span className={css.muted}>
                        {point.asked === 0 ? t('point.never') : t('point.counts', { asked: String(point.asked), right: String(point.right) })}
                        {point.open.length > 0 ? ` · ${t('node.pointOpen', { count: String(point.open.length) })}` : ''}
                        {point.notes.length > 0 ? ` · ${t('point.noteCount', { count: String(point.notes.length) })}` : ''}
                      </span>
                    </span>
                    <span className={css.pointBadge} data-state={point.state}>{t(`point.${point.state}`)}</span>
                    <span className={css.chevron} aria-hidden="true">›</span>
                  </button>
                  {isOpen && <PointDetail p={p} point={point} busy={retaking} onRetake={() => { void retake(point.open.map(miss => miss.key)) }} />}
                </div>
              )
            })}
          </div>
          {showPointsHint && <div className={css.muted}>{t('node.pointsRule')}</div>}
        </section>
      )}
      {untaken !== undefined && (
        <section className={css.stepBox}>
          <span className={css.stepText}>
            <strong>{t('node.untakenBox', { count: String(untaken.questions?.length ?? 0) })}</strong>
            <span className={css.muted}>{[t(`focus.${untaken.focus ?? 'mixed'}`), sourceMix((untaken.questions ?? []).map(question => question.evidence.kind), t), when(untaken.createdAt, t)].join(' · ')}</span>
          </span>
          <button type="button" className={css.primary} onClick={() => { openPaper(untaken) }}>{t('quiz.startNow')}</button>
        </section>
      )}
      {open.length > 0 && (
        <section className={css.stepBox}>
          <span className={css.stepText}>
            <strong>{t('node.retakeBox', { count: String(open.length) })}</strong>
            <span className={css.muted}>{[...openByPoint, ...(openLoose > 0 ? [t('node.retakeOther', { count: String(openLoose) })] : []), t('node.missedMeta', { when: when(open[0]!.at, t) })].join(' · ')}</span>
            <span className={css.muted}>{t('node.retakeHint')}</span>
          </span>
          <button type="button" className={primary === 'retake' ? css.primary : css.secondary} disabled={retaking || resourceId === undefined} onClick={() => { void retake() }}>{t('node.retakeStart')}</button>
        </section>
      )}
      <section className={`${css.stepBox} ${css.stepBoxPlain}`}>
        <span className={css.stepText}>
          <strong>{t('node.askBox')}</strong>
          <span className={css.askParts}>
            {askParts.map(([label, valueText]) => <span key={label} className={css.askPart}><span className={css.muted}>{label}</span>{valueText}</span>)}
          </span>
        </span>
        <span className={css.askActions}>
          <button type="button" className={css.ghost} aria-expanded={showSettings} onClick={() => { setShowSettings(!showSettings) }}>{showSettings ? t('node.askDone') : t('node.askAdjust')}</button>
          <button type="button" className={primary === 'ask' ? css.primary : css.secondary} disabled={asking} onClick={() => { ask() }}>{asking ? t('node.quizWaiting') : t('node.askGo')}</button>
        </span>
        {showSettings && (
          <div className={css.stepSettings}>
            <div className={css.settingRow}>
              <span className={css.settingLabel}>{t('node.setting.range')}</span>
              <div className={css.settingControl}>
                <div className={css.pickWrap} role="radiogroup" aria-label={t('node.setting.range')}>
                  {FOCUSES.map(id => (
                    <button key={id} type="button" role="radio" className={css.pick} aria-checked={direction === id} aria-pressed={direction === id} onClick={() => { update({ focus: id }) }}>
                      {t(`focus.${id}`)}{id === 'mine' ? <span className={css.pickState}>{mineCount}</span> : null}
                    </button>
                  ))}
                </div>
                <div className={css.muted}>
                  {direction === 'mine'
                    ? mineCount === 0 ? t('node.focusMineEmpty') : t('node.focusMineHint', { terms: (mine.data?.cards ?? []).map(card => card.term).join('、') })
                    : t(`node.focusHint.${direction}`)}
                </div>
              </div>
            </div>
            <div className={css.settingRow}>
              <span className={css.settingLabel}>{t('node.kindsTitle')}</span>
              <div className={css.settingControl}>
                <div className={css.pickWrap} role="group" aria-label={t('node.kindsTitle')}>
                  {QUIZ_KINDS.map(id => (
                    <button key={id} type="button" className={css.pick} aria-pressed={kinds.includes(id)} onClick={() => { update({ kinds: kinds.includes(id) ? kinds.filter(kind => kind !== id) : [...kinds, id] }) }}>{t(`kind.${id}`)}</button>
                  ))}
                </div>
                <div className={css.muted}>{t('node.kindsHint')}</div>
              </div>
            </div>
            <div className={css.settingRow}>
              <span className={css.settingLabel}>{t('node.countTitle')}</span>
              <input
                className={`${css.input} ${css.countInput}`}
                inputMode="numeric"
                aria-label={t('node.countTitle')}
                placeholder={String(DEFAULT_QUIZ_COUNT)}
                value={countText}
                onChange={event => { update({ countText: event.target.value }) }}
                onBlur={() => { update({ countText: String(parsedCount()) }) }}
              />
            </div>
            {mastery.points.length > 0 && (
              <div className={css.settingRow}>
                <span className={css.settingLabel}>{t('node.focusPoints')}</span>
                <div className={css.settingControl}>
                  <div className={css.pickWrap} role="group" aria-label={t('node.focusPoints')}>
                    {mastery.points.map(point => (
                      <button
                        key={point.id}
                        type="button"
                        className={css.pick}
                        aria-pressed={picked.includes(point.id)}
                        onClick={() => { update({ picked: picked.includes(point.id) ? picked.filter(entry => entry !== point.id) : [...picked, point.id] }) }}
                      >{point.title}<span className={css.pickState} data-state={point.state}>{t(`point.${point.state}`)}</span></button>
                    ))}
                  </div>
                  <div className={css.muted}>{t('node.focusPointsHint')}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
      {voided.length > 0 && (
        <div className={css.muted}>
          {t('node.voidedSummary', { count: String(voided.length) })}
          {' · '}
          <button type="button" className={css.textButton} onClick={() => { onReplace(voided.map(row => row.question.prompt)) }}>{t('node.voidedReplace')}</button>
        </div>
      )}
      {papers.length > 0 && (
        <details className={css.earlier}>
          <summary>{t('node.earlier', { count: String(papers.length) })}</summary>
          {[...papers].reverse().map(quiz => {
            const sat = latestByQuiz.get(quiz.id)
            return (
              <ListRow
                key={quiz.id}
                title={t('node.quizRow', { count: String(quiz.questions?.length ?? 0) })}
                meta={[sat === undefined ? t('node.paperUntaken') : `${Math.round(sat.ratio * 100)}%`, t(`focus.${quiz.focus ?? 'mixed'}`), when(quiz.createdAt, t)].join(' · ')}
                trailing={<span className={css.linkText}>{sat === undefined ? t('quiz.start') : t('node.redoSame')}</span>}
                onSelect={() => { openPaper(quiz) }}
              />
            )
          })}
        </details>
      )}
      {loose.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t(resourceId === undefined ? 'project.quizzes' : 'book.quizzes', { count: String(loose.length) })}</h3>
          <QuizRows p={p} projectId={projectId} quizzes={loose.slice().reverse()} />
        </section>
      )}
    </>
  )
}

/** One point, expanded under its row: why it stands where it does, and the way forward. */
function PointDetail({ p, point, busy, onRetake }: {
  p: ViewProps['p']; point: LibraryPointMastery; busy: boolean; onRetake: () => void
}): ReactNode {
  const { t } = p
  const needRight = Math.max(0, MASTERY_MIN_RIGHT - point.right)
  const needSittings = Math.max(0, MASTERY_MIN_SITTINGS - point.rightSittings)
  return (
    <div className={css.pointDetail}>
      <div className={css.muted}>{t(`point.why.${point.state}`, { right: String(needRight), sittings: String(needSittings) })}</div>
      {point.state === 'practicing' && (
        <div className={css.pointNeed}>
          {needRight > 0 && <span>{t('point.needRight', { count: String(needRight) })}</span>}
          {needSittings > 0 && <span>{t('point.needSitting')}</span>}
        </div>
      )}
      {point.history.length > 0 && (
        <div className={css.pointBlock}>
          <h4 className={css.pointBlockTitle}>{t('point.history')}</h4>
          {point.history.map(sitting => (
            <div key={sitting.at} className={css.moveRow}>
              <span>{when(sitting.at, t)} · {t(sitting.retake ? 'point.sitRetake' : 'point.sitPaper')}</span>
              <span className={sitting.right === sitting.total ? css.ok : css.bad}>{t('point.sitScore', { right: String(sitting.right), total: String(sitting.total) })}</span>
            </div>
          ))}
        </div>
      )}
      {point.notes.length > 0 && (
        <div className={css.pointBlock}>
          <h4 className={css.pointBlockTitle}>{t('point.notes')}</h4>
          {[...point.notes].reverse().map(note => (
            <div key={note.at} className={css.pointNote}><MathText text={note.text} /><span className={css.muted}> · {when(note.at, t)}</span></div>
          ))}
        </div>
      )}
      {point.open.length > 0 && (
        <div className={css.pointBlock}>
          <h4 className={css.pointBlockTitle}>{t('point.open', { count: String(point.open.length) })}</h4>
          <div className={css.mistakeRows}>
            {point.open.map(miss => <MissRow key={miss.key} p={p} row={{ question: miss.question, at: miss.at }} variant="missed" />)}
          </div>
          <div className={css.actions}>
            <button type="button" className={css.primary} disabled={busy} onClick={onRetake}>{t('point.retake', { count: String(point.open.length) })}</button>
          </div>
        </div>
      )}
      {point.open.length === 0 && point.state !== 'mastered' && <div className={css.muted}>{t('point.askBelow')}</div>}
    </div>
  )
}

/** An acceptance station's gate tab: the rubric, the submit gesture, the history. */
export function AcceptanceTab({ p, projectId, node, passRatio, onPrime }: {
  p: ViewProps['p']; projectId: string; node: RoadmapNode; passRatio: number; onPrime: () => void
}): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  const attempts = useLoad(() => value(p.listAttempts(projectId, node.id)), [projectId, node.id, rev])
  // The station gates no quiz itself, but its covered thick resources may hold
  // resource-level ones (本书测验) — the acceptance lines often ref them.
  const coveredThick = [...new Set(node.covers.flatMap(cover => coverKind(cover) === 'resource' ? [cover.ref] : []))]
  const looseQuizzes = useLoad(async () => {
    const lists = await Promise.all(coveredThick.map(id => value(p.listAssessments(projectId, id, undefined, 'quiz'))))
    return lists.flatMap(result => result.assessments).filter(quiz => quiz.scope.nodeId === undefined)
  }, [projectId, node.id, rev, coveredThick.join(',')])
  // A ref line's live state, before any acceptance sitting: the referenced
  // assessment's latest sitting does the judging (attempts arrive newest first).
  const allAttempts = useLoad(() => value(p.listAttempts(projectId)), [projectId, rev])
  const latest = attempts.data?.attempts[0]
  const rubric = acceptanceLines(node)
  const verdictOf = (line: LibraryAcceptanceLine): LibraryVerdict | undefined =>
    latest?.verdicts.find(verdict => (verdict.task === line.id || verdict.criterion === line.line) && verdict.void !== true)
    ?? (line.ref === undefined ? undefined : (() => {
      const sitting = (allAttempts.data?.attempts ?? []).find(attempt => attempt.assessmentId === line.ref)
      return sitting === undefined ? undefined : { task: line.id, criterion: line.line, pass: sitting.ratio >= passRatio, ratio: sitting.ratio, evidence: '', by: 'auto' as const }
    })())
  return (
    <>
      {node.state === 'locked' && <div className={css.notice}>{t('node.locked')}</div>}
      <div className={css.muted}>{t('accept.station', { count: String(rubric.length) })} · {t('accept.passRule', { percent: String(Math.round(passRatio * 100)) })}</div>
      <section className={css.section}>
        <h3 className={css.sectionTitle}>{t('accept.title')}</h3>
        <ul className={css.acceptList}>
          {rubric.map(line => {
            const verdict = verdictOf(line)
            return (
              <li key={line.id} className={css.acceptItem}>
                <span className={css.acceptMark} data-state={verdict === undefined ? 'none' : (verdict.pass && (verdict.ratio ?? 1) >= 0.5) ? 'pass' : 'fail'} aria-hidden="true">
                  {verdict === undefined ? '' : (verdict.pass && (verdict.ratio ?? 1) >= 0.5) ? <IconCheckOutlineMedium size={11} /> : '✕'}
                </span>
                <span className={css.acceptText}>
                  {line.line}
                  {line.ref !== undefined && (
                    <button type="button" className={css.textButton} onClick={() => { actions.push({ view: 'quiz', projectId, quizId: line.ref! }) }}>{t('accept.machine')} →</button>
                  )}
                  {verdict !== undefined && verdict.ratio !== undefined && verdict.ratio > 0 && verdict.ratio < 1 ? <span className={css.muted}> · {Math.round(verdict.ratio * 100)}%</span> : null}
                </span>
              </li>
            )
          })}
        </ul>
        <div className={css.muted}>{t('accept.hint')}</div>
      </section>
      {(looseQuizzes.data?.length ?? 0) > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('book.quizzes', { count: String(looseQuizzes.data!.length) })}</h3>
          <QuizRows p={p} projectId={projectId} quizzes={looseQuizzes.data!} />
        </section>
      )}
      <div className={css.actions}>
        <button type="button" className={css.primary} onClick={onPrime}>{t('accept.submit')}</button>
      </div>
      <div className={css.muted}>{t('accept.submitHint')}</div>
      {(attempts.data?.attempts.length ?? 0) > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('accept.history')}</h3>
          {attempts.data!.attempts.map(attempt => (
            <div key={attempt.id} className={css.moveRow}>
              <span>{Math.round(attempt.ratio * 100)}%</span>
              <span className={css.muted}>{when(attempt.at, t)}</span>
            </div>
          ))}
        </section>
      )}
    </>
  )
}

const FOCUSES: readonly LibraryQuizFocus[] = ['mine', 'book', 'mixed']
const QUIZ_KINDS: readonly LibraryQuizQuestion['kind'][] = ['choice', 'fill', 'free']
/** 题量 field's default — a chapter quiz's one-sitting size. */
const DEFAULT_QUIZ_COUNT = 10

/** A station's 章节考 settings before the learner touches them: 都考, the coach's mix of kinds, 10 questions. */
const DEFAULT_SETTINGS: LibraryQuizSettings = { focus: 'mixed', kinds: [], countText: String(DEFAULT_QUIZ_COUNT), picked: [] }

/** How long the tab waits for an asked quiz before saying it has not landed (a 20-question paper takes minutes). */
const ASK_PATIENCE_MS = 8 * 60_000
/** The 题量 field's cap — past this a chapter quiz stops being one sitting. */
const MAX_QUIZ_COUNT = 20
