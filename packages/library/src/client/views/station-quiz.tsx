/**
 * A station's gate tab: 章节考 on a quiz / read station (the paper card, the
 * points, the ask settings with the pending ask kept per station, the
 * station's own mistakes folded into one card, earlier papers), and the
 * acceptance sheet on an acceptance station.
 *
 * @module @khorsheed/dsh-library/client/views/station-quiz
 */
import { useEffect, useState, type ReactNode } from 'react'
import { ChipRow, ListRow } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import {
  acceptanceLines, coverKind, type LibraryAcceptanceLine, type LibraryAssessment, type LibraryAttempt, type LibraryQuizFocus, type LibraryQuizQuestion, type LibraryVerdict, type RoadmapNode,
} from '../../types.ts'
import { collectMissed, collectVoided, type MissedRow } from '../mistakes.ts'
import type { LibraryQuizSettings } from '../store.ts'
import { IconCheckOutlineMedium, IconInfoOutlineMedium } from '../icons.tsx'
import { StateLine, useLoad, value, when, type ViewProps } from '../ui.tsx'
import { MathText } from '../math.tsx'
import css from '../LibraryPane.module.css'

/** The zigzag column (0..2) a node at `index` sits in. */
import { QuizRows, sourceMix } from './book.tsx'

/** The right answer as a row caption: choice questions get their letter. */
function answerText(question: LibraryQuizQuestion): string {
  const at = question.options?.indexOf(question.answer) ?? -1
  return at >= 0 ? `${String.fromCharCode(65 + at)}. ${question.answer}` : question.answer
}

/** One missed / flagged question row: the mark, the prompt, and where it sits (answer · when · book). */
function MissRow({ p, row, variant, book }: { p: ViewProps['p']; row: MissedRow; variant: 'missed' | 'voided'; book?: string | undefined }): ReactNode {
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

export function QuizTab({ p, projectId, resourceId, node, passRatio, onPrime, onRetake, onReplace }: {
  p: ViewProps['p']; projectId: string; resourceId: string | undefined; node: RoadmapNode; passRatio: number; onPrime: (focus: LibraryQuizFocus, context?: { weak?: readonly string[]; points?: readonly string[]; kinds?: readonly LibraryQuizQuestion['kind'][]; count?: number | undefined }) => void; onRetake: (prompts: string[]) => void; onReplace: (prompts: string[]) => void
}): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  // The quiz direction: the three focuses. 错题重考 is not a direction — it is
  // the paper card's primary action once this station has misses.
  // The station's own misses fold into one card (other stations' never show here — a fresh station must not look already sat).
  const [showMissed, setShowMissed] = useState(false)
  // The points grid's explainer hides behind the title's ⓘ (tap to toggle).
  const [showPointsHint, setShowPointsHint] = useState(false)
  // The settings (范围 / 重点 / 题型 / 题量) and the pending ask live in the pane
  // store per station, so leaving the tab and coming back keeps both. 范围
  // defaults to 都考; no kinds picked = the coach's mix; 题量 defaults to 10.
  const stationKey = `${projectId}:${resourceId ?? ''}:${node.id}`
  const station = useStore(s => s.quiz[stationKey])
  const settings = station?.settings ?? DEFAULT_SETTINGS
  const direction = settings.focus
  const picked = settings.picked
  const kinds = settings.kinds
  const countText = settings.countText
  const update = (patch: Partial<LibraryQuizSettings>): void => { actions.setQuizSettings(stationKey, { ...settings, ...patch }) }
  const setDirection = (focus: LibraryQuizFocus): void => { update({ focus }) }
  const setCountText = (text: string): void => { update({ countText: text }) }
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
  // Project-wide read, split below into the station's own quizzes and the ones
  // gating no station (本书测验 / 自由测验) — else those are invisible from here.
  const assessments = useLoad(() => value(p.listAssessments(projectId, undefined, undefined, 'quiz')), [projectId, rev, tick])
  const shown = (assessments.data?.assessments ?? []).filter(quiz =>
    quiz.scope.nodeId === node.id
    || (quiz.scope.nodeId === undefined && (resourceId !== undefined ? quiz.scope.resourceId === resourceId : quiz.scope.resourceId === undefined)))
  const quizCount = shown.length
  // The quiz the learner is waiting for opens itself when it lands.
  useEffect(() => {
    if (watching === undefined || assessments.data === undefined || quizCount <= watching.count) return
    actions.setQuizAsk(stationKey, undefined)
    const landed = shown.at(-1)
    if (landed !== undefined) actions.push({ view: 'quiz', projectId, ...(landed.scope.resourceId === undefined ? {} : { resourceId: landed.scope.resourceId }), quizId: landed.id })
  }, [quizCount, watching])
  const mine = useLoad(() => value(p.listCards({ projectId, nodeId: node.id, limit: 5 })), [projectId, node.id, rev])
  // The station's weak cards drive both the 薄弱 line under the pass rule and the weak list the ask primes carry.
  const weak = useLoad(() => value(p.listCards({ projectId, nodeId: node.id, weakMin: 1, limit: 5 })), [projectId, node.id, rev])
  // Every attempt of the project — the paper card's state and the missed lists both read it (through mistakes.ts).
  const allAttempts = useLoad(() => value(p.listAttempts(projectId)), [projectId, rev])
  const stats = node.quizStats
  const mineCount = mine.data?.total ?? 0
  // The station's papers, oldest first: the current one is the newest not
  // superseded; everything superseded (or older than it) is history.
  const stations = shown.filter(quiz => quiz.scope.nodeId === node.id)
  const live = stations.filter(quiz => quiz.supersededBy === undefined)
  const latest = live.at(-1) ?? stations.at(-1)
  const earlier = stations.filter(quiz => quiz !== latest).reverse()
  const loose = shown.filter(quiz => quiz.scope.nodeId === undefined)
  // Every quiz's latest sitting (attempts arrive newest first) drives both the
  // paper card's state and the missed / flagged lists — one shared collection,
  // so the station's list, its 其他站 shelf and the project page's entry count
  // can never disagree (mistakes.ts).
  const latestByQuiz = new Map<string, LibraryAttempt>()
  for (const attempt of allAttempts.data?.attempts ?? []) {
    if (attempt.assessmentId !== undefined && !latestByQuiz.has(attempt.assessmentId)) latestByQuiz.set(attempt.assessmentId, attempt)
  }
  const allQuizzes = assessments.data?.assessments ?? []
  const allMissed = collectMissed(allAttempts.data?.attempts ?? [], allQuizzes)
  const missed = allMissed.filter(row => row.quiz.scope.nodeId === node.id)
  const voided = collectVoided(allAttempts.data?.attempts ?? [], latest === undefined ? [] : [latest])
  // Per-point mastery: the newest verdict (attempts arrive newest first) of any
  // question probing the point decides — strong, weak, or untested.
  const points = node.points ?? []
  const pointStates = new Map<string, 'strong' | 'weak'>()
  {
    const quizById = new Map(allQuizzes.map(quiz => [quiz.id, quiz]))
    for (const attempt of allAttempts.data?.attempts ?? []) {
      const quiz = quizById.get(attempt.assessmentId ?? '')
      if (quiz === undefined || quiz.scope.nodeId !== node.id) continue
      for (const verdict of attempt.verdicts) {
        if (verdict.void === true) continue
        const question = quiz.questions?.find(candidate => candidate.id === verdict.task)
        if (question?.point === undefined || pointStates.has(question.point)) continue
        pointStates.set(question.point, verdict.pass ? 'strong' : 'weak')
      }
    }
  }
  const pickedTitles = points.filter(point => picked.includes(point.id)).map(point => point.title)
  const togglePoint = (pointId: string): void => {
    update({ picked: picked.includes(pointId) ? picked.filter(candidate => candidate !== pointId) : [...picked, pointId] })
  }
  // The paper card's three states: untaken → 开始作答; passed → 再出一套;
  // failed with misses → 重考错题. The focus chips always configure the ask.
  const sitting = latest === undefined ? undefined : latestByQuiz.get(latest.id)
  const taken = sitting !== undefined
  const passed = taken && sitting.ratio >= passRatio
  const openPaper = (quiz: LibraryAssessment): void => {
    actions.push({ view: 'quiz', projectId, ...(quiz.scope.resourceId === undefined ? (resourceId === undefined ? {} : { resourceId }) : { resourceId: quiz.scope.resourceId }), quizId: quiz.id })
  }
  const ask = (): void => {
    const parsed = Number.parseInt(countText.trim(), 10)
    const count = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_QUIZ_COUNT) : DEFAULT_QUIZ_COUNT
    onPrime(direction, { weak: weak.data?.cards.map(card => card.term) ?? [], points: pickedTitles, kinds, count })
    const summary = [t(`focus.${direction}`), kinds.length === 0 ? t('node.kindsMixed') : kinds.map(kind => t(`kind.${kind}`)).join('、'), t('node.askCount', { count: String(count) }), ...(pickedTitles.length > 0 ? [t('node.askPointsShort', { count: String(pickedTitles.length) })] : [])].join(' · ')
    actions.setQuizAsk(stationKey, { since: Date.now(), count: quizCount, summary })
    setNow(Date.now())
  }
  const retake = (): void => {
    onRetake(missed.map(row => row.question.prompt))
    actions.setQuizAsk(stationKey, { since: Date.now(), count: quizCount, summary: t('node.retakeCount', { count: String(missed.length) }) })
    setNow(Date.now())
  }
  const asking = watching !== undefined && !stale
  // A picked set of points overrides the default ask (the agreed priority: 选了考点 > 开始作答 > 重考错题 > 再出一套).
  const askLabel = asking ? t('node.quizWaiting')
    : pickedTitles.length > 0 ? t('node.askPoints', { count: String(pickedTitles.length) })
    : t('node.askQuizAgain')
  const retakeLabel = asking ? t('node.quizWaiting') : t('node.retakeCount', { count: String(missed.length) })
  const primaryIsRetake = taken && !passed && missed.length > 0 && pickedTitles.length === 0
  return (
    <>
      {node.state === 'locked' && <div className={css.notice}>{t('node.locked')}</div>}
      <div className={css.muted}>
        {t('node.passRule', { percent: String(Math.round(passRatio * 100)) })}
        {stats !== undefined && stats.attempts > 0 && ` · ${t('node.best', { percent: String(Math.round((stats.bestRatio ?? 0) * 100)), attempts: String(stats.attempts) })}`}
      </div>
      {(weak.data?.cards.length ?? 0) > 0 && (
        <div className={css.muted}>{t('node.weakLine', { terms: weak.data!.cards.map(card => card.term).join('、') })}</div>
      )}
      <StateLine loaded={assessments} t={t} />
      {watching !== undefined && (
        <section className={css.asking} role="status" data-stale={stale}>
          <span className={css.askingText}>
            <strong>{stale ? t('node.askStale') : t('node.asking')}</strong>
            <span className={css.muted}>{watching.summary} · {t('node.askSince', { minutes: String(Math.max(1, Math.round((now - watching.since) / 60_000))) })}</span>
          </span>
          {stale
            ? <button type="button" className={css.secondary} onClick={ask}>{t('node.askAgain')}</button>
            : null}
          <button type="button" className={css.textButton} onClick={() => { actions.setQuizAsk(stationKey, undefined) }}>{t('node.askDismiss')}</button>
        </section>
      )}
      {latest !== undefined && (
        <section className={css.quizLatest}>
          <div className={css.quizLatestText}>
            <strong>{taken ? t(passed ? 'node.paperPassed' : 'node.paperFailed', { percent: String(Math.round(sitting.ratio * 100)) }) : t('node.quizLatest', { count: String(latest.questions?.length ?? 0) })}</strong>
            <span className={css.muted}>{[t(`focus.${latest.focus ?? 'mixed'}`), sourceMix((latest.questions ?? []).map(question => question.evidence.kind), t), ...(taken ? [when(sitting.at, t)] : [])].join(' · ')}</span>
          </div>
          {!taken && <button type="button" className={css.primary} onClick={() => { openPaper(latest) }}>{t('quiz.startNow')}</button>}
          {taken && primaryIsRetake && <button type="button" className={css.primary} disabled={asking} onClick={retake}>{retakeLabel}</button>}
          {taken && !primaryIsRetake && <button type="button" className={css.primary} disabled={asking} onClick={ask}>{askLabel}</button>}
          <div className={css.quizLatestFoot}>
            {(!taken || primaryIsRetake) && <button type="button" className={css.textButton} disabled={asking} onClick={ask}>{askLabel}</button>}
            {missed.length > 0 && !primaryIsRetake && <button type="button" className={css.textButton} disabled={asking} onClick={retake}>{retakeLabel}</button>}
            {taken && <button type="button" className={css.textButton} onClick={() => { openPaper(latest) }}>{t('node.redoSame')}</button>}
          </div>
        </section>
      )}
      {points.length > 0 && (
        <section className={css.section}>
          <h3 className={`${css.sectionTitle} ${css.pointsHead}`}>
            {t('node.pointsTitle')}
            <button
              type="button"
              className={css.infoButton}
              aria-expanded={showPointsHint}
              aria-label={t('node.pointsHintLabel')}
              onClick={() => { setShowPointsHint(value => !value) }}
            ><IconInfoOutlineMedium size={13} /></button>
          </h3>
          <div className={css.points}>
            {points.map(point => {
              const state = pointStates.get(point.id) ?? 'untested'
              const on = picked.includes(point.id)
              return (
                <button key={point.id} type="button" className={css.point} data-state={state} aria-pressed={on} onClick={() => { togglePoint(point.id) }}>
                  <span className={css.pointName}>{point.title}</span>
                  <span className={css.pointState}>{t(`node.pointState.${state}`)}</span>
                </button>
              )
            })}
          </div>
          {showPointsHint && <div className={css.muted}>{t('node.pointsHint')}</div>}
        </section>
      )}
      <section className={css.section}>
        <h3 className={css.sectionTitle}>{t('node.settingsTitle')}</h3>
        <div className={css.settingRow}>
          <span className={css.settingLabel}>{t('node.setting.range')}</span>
          <div className={css.settingControl}>
            <ChipRow
              label={t('node.setting.range')}
              chips={FOCUSES.map(id => ({ id, label: t(`focus.${id}`), ...(id === 'mine' ? { count: mineCount } : {}) }))}
              value={direction}
              onSelect={id => { setDirection(id as LibraryQuizFocus) }}
            />
            <div className={css.muted}>
              {direction === 'mine'
                ? mineCount === 0 ? t('node.focusMineEmpty') : t('node.focusMineHint', { terms: (mine.data?.cards ?? []).map(card => card.term).join('、') })
                : t(`node.focusHint.${direction}`)}
            </div>
          </div>
        </div>
        <div className={css.settingRow}>
          <span className={css.settingLabel}>{t('node.kindsTitle')}</span>
          <ChipRow
            className={css.settingChips}
            label={t('node.kindsTitle')}
            chips={QUIZ_KINDS.map(id => ({ id, label: t(`kind.${id}`) }))}
            value={kinds}
            onSelect={id => { update({ kinds: kinds.includes(id) ? kinds.filter(kind => kind !== id) : [...kinds, id] }) }}
          />
        </div>
        <div className={css.settingRow}>
          <span className={css.settingLabel}>{t('node.countTitle')}</span>
          <input
            className={`${css.input} ${css.countInput}`}
            inputMode="numeric"
            aria-label={t('node.countTitle')}
            placeholder={String(DEFAULT_QUIZ_COUNT)}
            value={countText}
            onChange={event => { setCountText(event.target.value) }}
            onBlur={() => {
              const parsed = Number.parseInt(countText.trim(), 10)
              setCountText(Number.isFinite(parsed) ? String(Math.min(Math.max(parsed, 1), MAX_QUIZ_COUNT)) : String(DEFAULT_QUIZ_COUNT))
            }}
          />
        </div>
      </section>
      {latest === undefined && (
        <div className={css.actions}>
          <button type="button" className={css.primary} disabled={asking} onClick={ask}>{asking ? t('node.quizWaiting') : pickedTitles.length > 0 ? t('node.askPoints', { count: String(pickedTitles.length) }) : t('node.askQuiz')}</button>
        </div>
      )}
      {missed.length > 0 && (
        <section className={css.mistakeBook}>
          <button type="button" className={css.mistakeHead} aria-expanded={showMissed} onClick={() => { setShowMissed(!showMissed) }}>
            <span className={css.mistakeHeadText}>
              <strong>{t('node.missedTitle', { count: String(missed.length) })}</strong>
              <span className={css.muted}>{t('node.missedMeta', { when: when(missed[0]!.at, t) })}</span>
            </span>
            <span className={css.linkText}>{showMissed ? t('node.missedHide') : t('node.missedShow')}</span>
          </button>
          {showMissed && (
            <div className={css.mistakeRows}>
              {missed.map(row => <MissRow key={`${row.quiz.id}:${row.question.id}`} p={p} row={row} variant="missed" />)}
            </div>
          )}
        </section>
      )}
      {voided.length > 0 && (
        <div className={css.muted}>
          {t('node.voidedSummary', { count: String(voided.length) })}
          {' · '}
          <button type="button" className={css.textButton} onClick={() => { onReplace(voided.map(row => row.question.prompt)) }}>{t('node.voidedReplace')}</button>
        </div>
      )}
      {earlier.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('node.quizEarlier')}</h3>
          {earlier.map(quiz => (
            <ListRow
              key={quiz.id}
              title={t('node.quizRow', { count: String(quiz.questions?.length ?? 0) })}
              meta={[t(`focus.${quiz.focus ?? 'mixed'}`), sourceMix((quiz.questions ?? []).map(question => question.evidence.kind), t)].join(' · ')}
              trailing={<span className={css.linkText}>{t('quiz.start')}</span>}
              onSelect={() => { actions.push({ view: 'quiz', projectId, ...(quiz.scope.resourceId === undefined ? (resourceId === undefined ? {} : { resourceId }) : { resourceId: quiz.scope.resourceId }), quizId: quiz.id }) }}
            />
          ))}
        </section>
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
