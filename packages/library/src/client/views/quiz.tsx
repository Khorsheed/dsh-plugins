/**
 * The chapter quiz in the sidebar, its result, and the daily review.
 *
 * A quiz is answered here: choice and fill questions are judged on the spot
 * against the answer key; open questions are collected and handed to the
 * coach, who judges them and ledgers the whole sitting (one attempt per
 * sitting). A sitting with no open question is ledgered from here directly.
 * 「这题有问题」 voids a question — it counts for nothing.
 *
 * Review is flashcards over the due cards: front, flip, self-rate. It moves
 * only the schedule — never a node, never weakness.
 *
 * @module @khorsheed/dsh-library/client/views/quiz
 */
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PanelHeader } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import { LEITNER_INTERVAL_DAYS, type LibraryAssessResult, type LibraryCard, type LibraryQuizQuestion, type LibraryReviewRating, type LibraryVerdict } from '../../types.ts'
import { choiceIndex, choiceOptions, clozeOf, judgeFill, letterMarks, pickMode, spellMatches } from '../judge.ts'
import { profileOf, type LibraryProfile } from '../../profiles.ts'
import { clearQuizDraft, loadQuizDraft, saveQuizDraft } from '../quiz-drafts.ts'
import { MathText, Tex } from '../math.tsx'
import { Highlight, outcome, shortGloss, StateLine, useLoad, value, type ViewProps } from '../ui.tsx'
import css from '../LibraryPane.module.css'

/** One question's state in the sitting. */
interface Answered {
  readonly given: string
  /** Judged here: true / false; open questions stay undefined. */
  readonly pass?: boolean
  readonly void?: boolean
  /** A fill the judge called wrong that the learner overruled (「我答对了」). */
  readonly overruled?: boolean
}

/** The quiz screen: the whole paper on one scroll — every question numbered, judged on the spot, 交卷 once all are answered. The in-progress sitting persists locally (quiz-drafts) — leaving the paper never loses an answer. */
export function QuizView({ p, projectId, resourceId, quizId }: ViewProps & { projectId: string; resourceId: string | undefined; quizId: string }): ReactNode {
  const { t, actions } = p
  const loaded = useLoad(async () => {
    const result = await outcome(p.getAssessment(projectId, quizId))
    return result.assessment
  }, [projectId, quizId])
  const [initialDraft] = useState(() => loadQuizDraft(quizId))
  const [answers, setAnswers] = useState<Record<string, Answered>>(() => ({ ...(initialDraft?.answers ?? {}) }))
  const [drafts, setDrafts] = useState<Record<string, string>>(() => ({ ...(initialDraft?.drafts ?? {}) }))
  const [notice, setNotice] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  // Open answers go to the coach through the conversation: once handed over, 交卷 is done — not clickable again.
  const [handedOver, setHandedOver] = useState(false)
  const assessment = loaded.data
  // The project's profile decides how a fill is judged and whether answers preview math.
  const project = useLoad(() => outcome(p.getProject(projectId)).then(detail => detail.project), [projectId])
  const profile = profileOf(project.data?.template)
  const isRetake = assessment?.type === 'retake'
  const quiz = assessment !== undefined && (assessment.type === 'quiz' || assessment.type === 'retake') && assessment.questions !== undefined
    ? { ...assessment, questions: assessment.questions }
    : undefined
  const total = quiz?.questions.length ?? 0
  const done = quiz === undefined ? 0 : quiz.questions.filter(item => answers[item.id] !== undefined).length
  const allAnswered = quiz !== undefined && done === total

  const record = (id: string, entry: Answered): void => {
    setAnswers(previous => {
      const next = { ...previous, [id]: entry }
      saveQuizDraft(quizId, { answers: next, drafts, at: new Date().toISOString() })
      return next
    })
  }

  const recordDraft = (id: string, text: string): void => {
    setDrafts(previous => {
      const next = { ...previous, [id]: text }
      saveQuizDraft(quizId, { answers, drafts: next, at: new Date().toISOString() })
      return next
    })
  }

  const finish = async (): Promise<void> => {
    if (quiz === undefined) return
    const open = quiz.questions.filter(item => answers[item.id]?.void !== true && answers[item.id]?.pass === undefined)
    if (open.length > 0) {
      // Open answers need the coach: hand over the whole sitting.
      const lines = quiz.questions.map(item => {
        const entry = answers[item.id]
        const mark = entry?.void === true ? t('quiz.handVoid') : entry?.pass === true ? '✓' : entry?.pass === false ? '✗' : t('quiz.handOpen')
        return `- ${item.id}：${entry?.given ?? ''}（${mark}）`
      })
      const primed = p.primeConversation(t('prime.grade', { quiz: quiz.id, answers: lines.join('\n') }))
      setNotice(primed ? t('quiz.handedOver') : t('notice.noConversation'))
      if (primed) setHandedOver(true)
      return
    }
    const verdicts: LibraryVerdict[] = quiz.questions.map(item => {
      const entry = answers[item.id]
      return {
        task: item.id,
        criterion: entry?.overruled === true ? `${item.prompt.slice(0, 100)}（学员改判：与答案等价）` : item.prompt.slice(0, 120),
        pass: entry?.pass === true,
        evidence: item.evidence.quote ?? item.answer,
        by: 'self',
        ...(entry?.void === true ? { void: true } : {}),
      }
    })
    setBusy(true)
    try {
      const result = await outcome(p.putAttempt(projectId, quiz.id, verdicts))
      clearQuizDraft(quiz.id)
      actions.replace({ view: 'result', projectId, ...(resourceId === undefined ? {} : { resourceId }), result })
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PanelHeader
        title={quiz === undefined ? t('node.quiz') : t(isRetake ? 'quiz.retakeProgress' : 'quiz.progress', { at: String(done), total: String(total) })}
        onBack={() => { actions.pop() }}
        backLabel={t('action.back')}
        moreLabel={t('action.more')}
      />
      <div className={css.body}>
        <StateLine loaded={loaded} t={t} />
        {quiz !== undefined && (
          <div className={css.progress} aria-hidden="true"><i style={{ width: `${total === 0 ? 0 : Math.round((done / total) * 100)}%` }} /></div>
        )}
        {quiz?.questions.map((question, at) => (
          <QuestionCard
            profile={profile}
            key={question.id}
            p={p}
            number={at + 1}
            question={question}
            answered={answers[question.id]}
            draft={drafts[question.id] ?? ''}
            onDraft={text => { recordDraft(question.id, text) }}
            onAnswer={entry => { record(question.id, entry) }}
          />
        ))}
        {notice !== undefined && <div className={css.notice}>{notice}</div>}
        {quiz !== undefined && (
          <div className={css.actions}>
            <button type="button" className={css.primary} disabled={busy || handedOver || !allAnswered} onClick={() => { void finish() }}>
              {handedOver ? t('quiz.handedOverButton') : busy ? t('quiz.finishing') : allAnswered ? t('quiz.finish') : t('quiz.remaining', { count: String(total - done) })}
            </button>
          </div>
        )}
      </div>
    </>
  )
}

/** One question on the paper: its number, two tags, the answer control, the feedback. The evidence quote shows only after answering — quoted up front, it often IS the answer. */
function QuestionCard({ p, profile, question, number, answered, draft, onDraft, onAnswer }: {
  p: ViewProps['p']
  profile: LibraryProfile
  question: LibraryQuizQuestion
  number: number
  answered: Answered | undefined
  draft: string
  onDraft: (value: string) => void
  onAnswer: (entry: Answered) => void
}): ReactNode {
  const { t } = p
  const correct = question.kind === 'choice' ? choiceIndex(question.options ?? [], question.answer) : -1
  const evidenceTone = question.evidence.kind === 'photo' ? 'photo' : question.evidence.kind === 'web' ? 'web' : 'know'
  // A choice or fill quote often IS the answer, so it waits for the feedback.
  // An open question's quote frames the discussion but can hand the answer
  // over just the same — it stays folded behind 参考原文 until peeked or answered.
  const quoteUpfront = question.kind === 'free'
  const [peek, setPeek] = useState(false)
  // The answer box grows with what you type (up to a cap, then it scrolls).
  const answerRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = answerRef.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [draft, answered])
  return (
    <section className={css.question}>
      <div className={css.chips}>
        <span className={css.optionKey} aria-hidden="true">{number}</span>
        <span className={css.chip} data-tone={question.target.kind === 'asked' || question.target.kind === 'missed' ? 'weak' : undefined}>{t(`target.${question.target.kind}`)}</span>
        <span className={css.chip} data-tone={evidenceTone}>{t(`evidence.${question.evidence.kind}`)}</span>
      </div>
      <div className={css.prompt}><MathText text={question.prompt} /></div>
      {quoteUpfront && question.evidence.quote !== undefined && answered === undefined && (
        <div className={css.row}>
          <button type="button" className={css.textButton} aria-expanded={peek} onClick={() => { setPeek(!peek) }}>{t(peek ? 'quiz.hideQuote' : 'quiz.showQuote')}</button>
        </div>
      )}
      {quoteUpfront && question.evidence.quote !== undefined && (peek || answered !== undefined) && (
        <blockquote className={css.quote}>{question.evidence.quote}</blockquote>
      )}
      {question.kind === 'choice' && (
        <div className={css.options}>
          {(question.options ?? []).map((option, at) => {
            const chosen = answered?.given === option
            const state = answered === undefined || answered.void === true ? undefined : at === correct ? 'ok' : chosen ? 'bad' : undefined
            return (
              <button
                key={option}
                type="button"
                className={css.option}
                data-state={state}
                disabled={answered !== undefined}
                onClick={() => { onAnswer({ given: option, pass: at === correct }) }}
              >
                <span className={css.optionKey}>{String.fromCharCode(65 + at)}</span>
                <span><MathText text={option} /></span>
              </button>
            )
          })}
        </div>
      )}
      {question.kind !== 'choice' && (
        <>
          <textarea
            ref={answerRef}
            className={css.answer}
            rows={question.kind === 'free' ? 4 : 1}
            value={answered?.given ?? draft}
            disabled={answered !== undefined}
            placeholder={t(question.kind === 'free' ? 'quiz.freePlaceholder' : /\$|\\[a-zA-Z]|[√∫∑∏∂∞±]/.test(question.prompt) ? 'quiz.fillMathPlaceholder' : 'quiz.fillPlaceholder')}
            onChange={event => { onDraft(event.target.value) }}
          />
          {profile.math && <AnswerPreview text={answered?.given ?? draft} t={t} />}
          {answered === undefined && (
            <div className={css.actions}>
              <button
                type="button"
                className={css.secondary}
                disabled={draft.trim() === ''}
                onClick={() => { onAnswer(question.kind === 'fill' ? { given: draft, pass: judgeFill(profile.fill, draft, question.answer) } : { given: draft }) }}
              >{t('quiz.submit')}</button>
            </div>
          )}
        </>
      )}
      {answered !== undefined && answered.void !== true && (
        <div className={css.feedback}>
          {answered.pass === true && <strong className={css.ok}>{answered.overruled === true ? t('quiz.overruled') : t('quiz.right')}</strong>}
          {answered.pass === false && <strong className={css.bad}><MathText text={t('quiz.wrong', { answer: correct >= 0 && question.options?.[correct] !== undefined ? `${String.fromCharCode(65 + correct)}. ${question.options[correct]}` : question.answer })} /></strong>}
          {answered.pass === undefined && <strong>{t('quiz.coachJudges')}</strong>}
          {question.explanation !== undefined && <div><MathText text={question.explanation} /></div>}
          {!quoteUpfront && question.evidence.quote !== undefined && <blockquote className={css.quote}>{question.evidence.quote}</blockquote>}
          {question.evidence.url !== undefined && <a className={css.link} href={question.evidence.url} target="_blank" rel="noreferrer">{t('quiz.source')}</a>}
          {question.kind === 'fill' && (answered.pass === false || answered.overruled === true) && (
            <div>
              <button
                type="button"
                className={css.textButton}
                onClick={() => { onAnswer(answered.overruled === true ? { given: answered.given, pass: false } : { given: answered.given, pass: true, overruled: true }) }}
              >{answered.overruled === true ? t('quiz.overruleUndo') : t('quiz.overrule')}</button>
            </div>
          )}
        </div>
      )}
      <div className={css.row}>
        <button
          type="button"
          className={css.textButton}
          onClick={() => { onAnswer({ given: answered?.given ?? '', void: answered?.void !== true }) }}
        >{answered?.void === true ? t('quiz.unvoid') : t('quiz.void')}</button>
      </div>
    </section>
  )
}

/** The answer box's live math preview: appears once the draft smells like math ($…$, a \command, or a plain ^ / _ like (x-2)^2); bare math previews as one inline formula. */
function AnswerPreview({ text, t }: { text: string; t: ViewProps['p']['t'] }): ReactNode {
  if (!/\$|\\[a-zA-Z]|[\w)\]}][\^_]\{?[\w-]/.test(text)) return null
  return (
    <div className={css.answerPreview}>
      <span className={css.muted}>{t('quiz.preview')}</span>
      <span className={css.answerPreviewBody}>{text.includes('$') ? <MathText text={text} /> : <Tex tex={text} />}</span>
    </div>
  )
}

/** The sitting's result: the score, what unlocked, how the cards moved — and the loop's next step, which rides the conversation from here (a retake of the misses or a fresh set), so the flow never dead-ends on the score. */
export function ResultView({ p, projectId, resourceId, result }: ViewProps & { projectId: string; resourceId: string | undefined; result: LibraryAssessResult }): ReactNode {
  const { t, actions } = p
  const [notice, setNotice] = useState<string | undefined>()
  const percent = Math.round(result.attempt.ratio * 100)
  const passed = result.completed !== undefined
  // Flagged questions counted for nothing — say so once, right under the score.
  const voidedCount = result.attempt.verdicts.filter(verdict => verdict.void === true).length
  const assessmentId = result.attempt.assessmentId
  // The paper itself, for the retake's question list; a gone one hides the asks.
  const assessment = useLoad(
    () => assessmentId === undefined
      ? Promise.resolve(undefined)
      : outcome(p.getAssessment(projectId, assessmentId)).then(answer => answer.assessment, () => undefined),
    [projectId, assessmentId],
  )
  const isRetake = assessment.data?.type === 'retake'
  const questions = assessment.data?.type === 'quiz' || isRetake ? (assessment.data?.questions ?? []) : []
  const missedVerdicts = result.attempt.verdicts.filter(verdict => !verdict.pass && verdict.void !== true)
  // What is still open from this sitting, as retake keys (a retake's question points back at its origin).
  const missedKeys = missedVerdicts.flatMap(verdict => {
    const question = questions.find(candidate => candidate.id === verdict.task)
    if (question === undefined || assessmentId === undefined) return []
    return [question.origin === undefined ? `${assessmentId}:${question.id}` : `${question.origin.assessmentId}:${question.origin.questionId}`]
  })
  const counted = result.attempt.verdicts.filter(verdict => verdict.void !== true)
  const right = counted.filter(verdict => verdict.pass).length
  const stationId = assessment.data?.scope.nodeId
  const [retaking, setRetaking] = useState(false)

  const prime = (text: string): void => {
    void p.bindTarget(resourceId === undefined ? { projectId } : { projectId, resourceId })
    setNotice(p.primeConversation(text) ? t('notice.primed') : t('notice.noConversation'))
  }
  // 订正 in the sidebar: a retake paper over this sitting's misses (no coach needed).
  const retake = (): void => {
    if (stationId === undefined || resourceId === undefined || missedKeys.length === 0 || retaking) return
    setRetaking(true)
    void outcome(p.createRetake(projectId, resourceId, stationId, missedKeys)).then(created => {
      actions.replace({ view: 'quiz', projectId, resourceId, quizId: created.assessment.id })
    }, (failure: unknown) => { setNotice(failure instanceof Error ? failure.message : String(failure)); setRetaking(false) })
  }
  const again = (): void => {
    if (assessmentId === undefined) return
    prime(t('prime.result.again', { quiz: assessmentId, percent: String(percent) }))
  }

  const nextId = result.unlocked[0]
  const canRetake = stationId !== undefined && resourceId !== undefined && missedKeys.length > 0
  const retakePrimary = (isRetake || !passed) && canRetake
  const nextPrimary = passed && nextId !== undefined
  const againPrimary = !retakePrimary && !nextPrimary
  return (
    <>
      <PanelHeader title={t('result.title')} onBack={() => { actions.pop() }} backLabel={t('action.back')} moreLabel={t('action.more')} />
      <div className={css.body}>
        {isRetake ? (
          <section className={css.hero}>
            <div className={css.heroText}>
              <span className={css.big}>{t('result.retakeScore', { right: String(right), total: String(counted.length) })}</span>
              <span className={css.muted}>{t('result.retakeNote')}</span>
            </div>
          </section>
        ) : (
          <section className={css.hero}>
            <div className={css.heroText}>
              <span className={css.big}>{percent}%</span>
              <span className={css.muted}>{t('result.line', { pass: String(Math.round(result.passRatio * 100)) })}</span>
            </div>
            <strong className={passed ? css.ok : css.bad}>{passed ? t('result.passed') : t('result.notYet')}</strong>
          </section>
        )}
        {(result.pointChanges?.length ?? 0) > 0 && (
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{t('result.points')}</h3>
            {result.pointChanges!.map(change => (
              <div key={change.pointId} className={css.moveRow}>
                <span>{t('result.pointTo', { title: change.title, state: t(`point.${change.to}`) })}</span>
                <span className={change.to === 'mastered' ? css.ok : change.to === 'weak' ? css.bad : css.muted}>{t(`point.${change.from}`)} → {t(`point.${change.to}`)}</span>
              </div>
            ))}
          </section>
        )}
        {voidedCount > 0 && <div className={css.muted}>{t('result.voided', { count: String(voidedCount) })}</div>}
        {result.cardUpdates.length > 0 && (
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{t('result.cards')}</h3>
            {result.cardUpdates.map(update => (
              <div key={update.id} className={css.moveRow}>
                <span>{update.term}</span>
                <span className={update.created === true ? css.bad : update.mastery.box > 0 ? css.ok : css.bad}>
                  {update.created === true ? t('result.cardNew') : update.mastery.box > 0 ? t('result.cardUp') : t('result.cardBack')}
                </span>
              </div>
            ))}
          </section>
        )}
        {notice !== undefined && <div className={css.notice}>{notice}</div>}
        <div className={css.actions}>
          {nextId !== undefined && resourceId !== undefined && (
            <button type="button" className={nextPrimary ? css.primary : css.secondary} onClick={() => { actions.replace({ view: 'node', projectId, resourceId, nodeId: nextId, tab: 'guide' }) }}>{t('result.next')}</button>
          )}
          {canRetake && (
            <button type="button" className={retakePrimary ? css.primary : css.secondary} disabled={retaking} onClick={retake}>{t(isRetake ? 'result.retakeRest' : 'result.retake', { count: String(missedKeys.length) })}</button>
          )}
          {assessmentId !== undefined && !isRetake && (
            <button type="button" className={againPrimary ? css.primary : css.secondary} onClick={again}>{t('result.again')}</button>
          )}
          {isRetake && stationId !== undefined && resourceId !== undefined && (
            <button type="button" className={retakePrimary ? css.secondary : css.primary} onClick={() => { actions.replace({ view: 'node', projectId, resourceId, nodeId: stationId, tab: 'quiz' }) }}>{t('result.toStation')}</button>
          )}
          {resourceId !== undefined && (
            <button type="button" className={css.ghost} onClick={() => { actions.replace({ view: 'resource', projectId, resourceId }) }}>{t('result.toPath')}</button>
          )}
          {resourceId === undefined && (
            <button type="button" className={css.ghost} onClick={() => { actions.replace({ view: 'project', projectId }) }}>{t('result.toPath')}</button>
          )}
        </div>
      </div>
    </>
  )
}

/** Days until the next review for a rating. */
function nextDays(card: LibraryCard, rating: LibraryReviewRating): number {
  const box = rating === 'forgot' ? 0 : rating === 'fuzzy' ? card.mastery.box : Math.min(card.mastery.box + 1, 5)
  return LEITNER_INTERVAL_DAYS[Math.min(box, LEITNER_INTERVAL_DAYS.length - 1)]!
}

type DueCard = LibraryCard & { projectId: string }

/** One answered card in the round. */
interface Outcome { readonly card: DueCard; readonly rating: LibraryReviewRating }

/**
 * Daily review as answering, not looking (M4): each due card is asked the
 * way that fits it — a word as a cloze over its own sentence or a choice of
 * its meaning against the learner's other glosses, a well-known word as a
 * spelling, a concept as a one-line explanation checked against the answer.
 * The pane judges what it can and maps it to the schedule (first try →
 * recalled, after a hint → fuzzy, missed → forgot); concepts are self-rated.
 * 「翻卡」 in the header falls back to the plain flashcard.
 */
export function ReviewView({ p, projectId }: ViewProps & { projectId?: string }): ReactNode {
  const { t, actions } = p
  const loaded = useLoad(() => value(p.dueCards(projectId)), [projectId])
  const [queue, setQueue] = useState<DueCard[] | undefined>()
  const [practice, setPractice] = useState(false)
  const [at, setAt] = useState(0)
  const [flip, setFlip] = useState(false)
  const [combo, setCombo] = useState(0)
  const [best, setBest] = useState(0)
  const [outcomes, setOutcomes] = useState<Outcome[]>([])
  const [error, setError] = useState<string | undefined>()
  const due = loaded.data?.cards
  const cards = queue ?? due ?? []
  const card = cards[at]
  // Distractors come from the same kind of card — a word's meaning against the
  // other words' meanings — across the projects in this round, due or not.
  const projectIds = useMemo(() => [...new Set((due ?? []).map(entry => entry.projectId))].slice(0, 3), [due])
  const words = useLoad(async () => {
    const lists = await Promise.all(projectIds.map(id => value(p.listCards({ projectId: id, kind: 'word', limit: 60 }))))
    return lists.flatMap(list => list.cards)
  }, [projectIds.join(',')])
  const glossPool = useMemo(() => [...new Set([...(due ?? []), ...(words.data ?? [])].filter(entry => entry.kind === 'word').map(entry => shortGloss(entry.gloss)))], [due, words.data])

  // One rating per card: a double tap must not rate (and advance) twice.
  const settling = useRef<number | undefined>()
  const settle = (rating: LibraryReviewRating): void => {
    // Keyed by the queue position: a stale second tap still carries the old position.
    if (card === undefined || settling.current === at) return
    settling.current = at
    const advance = (): void => {
      const right = rating !== 'forgot'
      const nextCombo = right ? combo + 1 : 0
      setCombo(nextCombo)
      setBest(Math.max(best, nextCombo))
      setOutcomes(previous => [...previous, { card, rating }])
      setAt(at + 1)
    }
    // A practice round (「再练错的」) never moves the schedule.
    if (practice) { advance(); return }
    void outcome(p.reviewCard(card.projectId, card.id, rating)).then(advance, (failure: unknown) => { settling.current = undefined; setError(String(failure)) })
  }

  const again = (): void => {
    settling.current = undefined
    const missed = outcomes.filter(entry => entry.rating === 'forgot').map(entry => entry.card)
    setQueue(missed)
    setPractice(true)
    setAt(0)
    setCombo(0)
    setOutcomes([])
  }

  return (
    <>
      <PanelHeader
        title={cards.length === 0 ? t('review.title') : card === undefined ? t('review.summaryTitle') : t(practice ? 'review.practiceProgress' : 'review.progress', { at: String(at + 1), total: String(cards.length) })}
        onBack={() => { actions.pop() }}
        backLabel={t('action.back')}
        actions={[{ id: 'flip', label: t('review.flipMode'), icon: <span aria-hidden="true">⇄</span>, pressed: flip, onSelect: () => { setFlip(!flip) } }]}
        moreLabel={t('action.more')}
      />
      <div className={css.body}>
        <StateLine loaded={loaded} t={t} />
        {card !== undefined && (
          <div className={css.reviewHead}>
            <div className={css.progress} aria-hidden="true"><i style={{ width: `${Math.round((at / cards.length) * 100)}%` }} /></div>
            <span className={css.combo} data-hot={combo >= 3 ? 'true' : 'false'}>{t('review.combo', { count: String(combo) })}</span>
          </div>
        )}
        {loaded.data !== undefined && cards.length === 0 && (
          <div className={css.empty}><div className={css.emptyTitle}>{t('review.nothing')}</div><button type="button" className={css.secondary} onClick={() => { actions.pop() }}>{t('action.back')}</button></div>
        )}
        {card !== undefined && (flip
          ? <FlipCard key={card.id} p={p} card={card} onRate={settle} />
          : <AskCard key={`${card.id}-${at}`} p={p} card={card} glossPool={glossPool} onRate={settle} />)}
        {loaded.data !== undefined && cards.length > 0 && card === undefined && (
          <Summary p={p} outcomes={outcomes} best={best} practice={practice} onAgain={again} onDone={() => { actions.pop() }} />
        )}
        {error !== undefined && <div className={css.error}>{error}</div>}
      </div>
    </>
  )
}

/** Ask one card in the mode that fits it. */
function AskCard({ p, card, glossPool, onRate }: { p: ViewProps['p']; card: DueCard; glossPool: readonly string[]; onRate: (rating: LibraryReviewRating) => void }): ReactNode {
  const { t } = p
  const others = glossPool.filter(gloss => gloss !== shortGloss(card.gloss))
  const mode = pickMode(card, others.length)
  const where = card.sources.find(source => source.type === 'photo')?.note
  const label = t(`review.mode.${mode}`) + (where === undefined ? '' : ` · ${where}`)
  if (mode === 'choice') return <ChoiceAsk p={p} card={card} others={others} label={label} onRate={onRate} />
  if (mode === 'explain') return <ExplainAsk p={p} card={card} label={label} onRate={onRate} />
  return <TypeAsk p={p} card={card} mode={mode} label={label} onRate={onRate} />
}

/** Cloze or spelling: type the word; one miss reveals more letters, a second shows it. */
function TypeAsk({ p, card, mode, label, onRate }: { p: ViewProps['p']; card: DueCard; mode: 'cloze' | 'spell'; label: string; onRate: (rating: LibraryReviewRating) => void }): ReactNode {
  const { t } = p
  const blank = card.contexts.map(context => clozeOf(context.sentence, card.term, card.aliases)).find(found => found !== undefined)
  const answer = blank?.answer ?? card.term
  const [input, setInput] = useState('')
  const [misses, setMisses] = useState(0)
  const [result, setResult] = useState<'right' | 'wrong' | undefined>()
  const accepted = [answer, card.term, ...card.aliases]
  const submit = (): void => {
    if (spellMatches(input, accepted)) { setResult('right'); return }
    if (misses === 0) { setMisses(1); return }
    setResult('wrong')
  }
  const rating: LibraryReviewRating = result === 'right' ? (misses === 0 ? 'recalled' : 'fuzzy') : 'forgot'
  const variant = result === 'right' && input.trim().toLowerCase() !== answer.toLowerCase() && !accepted.some(word => word.toLowerCase() === input.trim().toLowerCase())
  return (
    <section className={css.qcard}>
      <span className={css.muted}>{label}</span>
      {mode === 'spell' && <div className={css.askBig}>{card.gloss}</div>}
      {blank !== undefined && (
        <div className={css.flashSentence}>
          {blank.before}
          <span className={css.blank} data-state={result}>{result === undefined ? '\u00a0' : answer}</span>
          {blank.after}
        </div>
      )}
      {mode === 'cloze' && result === undefined && (
        <div className={css.muted}>{t('review.hint', { gloss: shortGloss(card.gloss), letters: answer.slice(0, misses + 1) })}</div>
      )}
      {mode === 'spell' && misses > 0 && result === undefined && <div className={css.muted}>{t('review.hintLetters', { letters: answer.slice(0, 2) })}</div>}
      {result === undefined && (
        <form className={css.row} onSubmit={event => { event.preventDefault(); submit() }}>
          <input className={css.input} autoFocus value={input} aria-label={t('review.typeHere')} placeholder={t('review.typeHere')} onChange={event => { setInput(event.target.value) }} />
          <button type="submit" className={css.secondary} disabled={input.trim() === ''}>{t('quiz.submit')}</button>
        </form>
      )}
      {misses > 0 && result === undefined && <div className={css.letters}>{letterMarks(input, answer).map((ok, index) => <span key={index} data-ok={ok ? 'true' : 'false'}>{input[index]}</span>)}</div>}
      {result !== undefined && (
        <div className={css.feedback} data-state={result}>
          <strong className={result === 'right' ? css.ok : css.bad}>{result === 'right' ? t('review.right') : t('review.answerWas', { answer })}</strong>
          {variant && <span className={css.muted}>{t('review.variant', { answer })}</span>}
          <span className={css.muted}>{t('review.nextIn', { days: String(nextDays(card, rating)) })}</span>
        </div>
      )}
      {result !== undefined && <button type="button" className={css.primary} onClick={() => { onRate(rating) }}>{t('quiz.next')}</button>}
    </section>
  )
}

/** Which meaning in this sentence: the right gloss against three of the learner's own. */
function ChoiceAsk({ p, card, others, label, onRate }: { p: ViewProps['p']; card: DueCard; others: readonly string[]; label: string; onRate: (rating: LibraryReviewRating) => void }): ReactNode {
  const { t } = p
  const [{ options, correct }] = useState(() => choiceOptions(shortGloss(card.gloss), others))
  const [picked, setPicked] = useState<number | undefined>()
  const sentence = card.contexts[card.mastery.streak % Math.max(card.contexts.length, 1)]?.sentence
  const right = picked === correct
  return (
    <section className={css.qcard}>
      <span className={css.muted}>{label}</span>
      <div className={css.flashSentence}>{sentence === undefined ? card.term : <Highlight sentence={sentence} term={card.term} />}</div>
      <div className={css.muted}>{t('review.whichMeaning', { term: card.term })}</div>
      <div className={css.options}>
        {options.map((option, index) => (
          <button
            key={option}
            type="button"
            className={css.option}
            disabled={picked !== undefined}
            data-state={picked === undefined ? undefined : index === correct ? 'ok' : index === picked ? 'bad' : undefined}
            onClick={() => { setPicked(index) }}
          >
            <span className={css.optionKey}>{String.fromCharCode(65 + index)}</span>
            <span>{option}</span>
          </button>
        ))}
      </div>
      {picked !== undefined && (
        <div className={css.feedback}>
          <strong className={right ? css.ok : css.bad}>{right ? t('review.right') : t('review.meaningWas', { gloss: card.gloss })}</strong>
          <span className={css.muted}>{t('review.nextIn', { days: String(nextDays(card, right ? 'recalled' : 'forgot')) })}</span>
        </div>
      )}
      {picked !== undefined && <button type="button" className={css.primary} onClick={() => { onRate(right ? 'recalled' : 'forgot') }}>{t('quiz.next')}</button>}
    </section>
  )
}

/** A concept: say it in a sentence, then check against the answer (or hand it to the coach). */
function ExplainAsk({ p, card, label, onRate }: { p: ViewProps['p']; card: DueCard; label: string; onRate: (rating: LibraryReviewRating) => void }): ReactNode {
  const { t } = p
  const [text, setText] = useState('')
  const [shown, setShown] = useState(false)
  const [sent, setSent] = useState(false)
  const stuck = card.sources.slice().reverse().find(source => (source.type === 'chat' || source.type === 'quiz') && source.note !== undefined)
  return (
    <section className={css.qcard}>
      <span className={css.muted}>{label}{stuck?.note === undefined ? '' : ` · ${t(stuck.type === 'quiz' ? 'review.youMissed' : 'review.youAsked', { note: stuck.note })}`}</span>
      <div className={css.askBig}>{t('review.askConcept', { term: card.term })}</div>
      <textarea className={css.answer} rows={3} value={text} disabled={shown} aria-label={t('review.typeHere')} placeholder={t('review.explainHere')} onChange={event => { setText(event.target.value) }} />
      {!shown && <button type="button" className={css.secondary} onClick={() => { setShown(true) }}>{t('review.check')}</button>}
      {shown && (
        <>
          <div className={css.feedback}><strong>{t('review.reference')}</strong><span>{card.gloss}</span></div>
          <div className={css.rate}>
            {(['forgot', 'fuzzy', 'recalled'] as const).map(rating => (
              <button key={rating} type="button" className={css.rateButton} onClick={() => { onRate(rating) }}>
                <span>{t(`review.self.${rating}`)}</span>
                <span className={css.muted}>{t('review.inDays', { days: String(nextDays(card, rating)) })}</span>
              </button>
            ))}
          </div>
          {text.trim() !== '' && !sent && (
            <button type="button" className={css.textButton} onClick={() => { setSent(p.sendMessage(t('prime.judgeExplain', { term: card.term, answer: text.trim() }))) }}>{t('review.askCoachJudge')}</button>
          )}
          {sent && <div className={css.muted}>{t('node.fixSent')}</div>}
        </>
      )}
    </section>
  )
}

/** The plain flashcard (「翻卡」): front, flip, self-rate. */
function FlipCard({ p, card, onRate }: { p: ViewProps['p']; card: DueCard; onRate: (rating: LibraryReviewRating) => void }): ReactNode {
  const { t } = p
  const [flipped, setFlipped] = useState(false)
  const sentence = card.contexts.length === 0 ? undefined : card.contexts[card.mastery.streak % card.contexts.length]!.sentence
  return (
    <section className={css.flash}>
      <div className={css.flashFront}>
        <div className={css.flashSentence}>{sentence === undefined ? card.term : <Highlight sentence={sentence} term={card.term} />}</div>
        <div className={css.muted}>{card.kind === 'word' ? t('review.askWord', { term: card.term }) : t('review.askConcept', { term: card.term })}</div>
      </div>
      {flipped && <div className={css.flashBack}><strong>{card.gloss}</strong>{card.userGloss !== undefined && <div className={css.muted}>{t('cards.userGloss', { gloss: card.userGloss })}</div>}</div>}
      {!flipped
        ? <button type="button" className={css.secondary} onClick={() => { setFlipped(true) }}>{t('review.flip')}</button>
        : (
          <div className={css.rate}>
            {(['forgot', 'fuzzy', 'recalled'] as const).map(rating => (
              <button key={rating} type="button" className={css.rateButton} onClick={() => { onRate(rating) }}>
                <span>{t(`review.${rating}`)}</span>
                <span className={css.muted}>{t('review.inDays', { days: String(nextDays(card, rating)) })}</span>
              </button>
            ))}
          </div>
        )}
    </section>
  )
}

/** The round's summary: facts only — no score, no XP. */
function Summary({ p, outcomes, best, practice, onAgain, onDone }: { p: ViewProps['p']; outcomes: readonly Outcome[]; best: number; practice: boolean; onAgain: () => void; onDone: () => void }): ReactNode {
  const { t } = p
  const right = outcomes.filter(entry => entry.rating !== 'forgot')
  const up = outcomes.filter(entry => entry.rating === 'recalled')
  const steady = outcomes.filter(entry => entry.rating === 'fuzzy')
  const missed = outcomes.filter(entry => entry.rating === 'forgot')
  return (
    <section className={css.summary}>
      <div className={css.row}><span className={css.big}>{right.length}/{outcomes.length}</span><span className={css.muted}>{t('review.summaryLine', { best: String(best) })}</span></div>
      {practice && <div className={css.muted}>{t('review.practiceNote')}</div>}
      {missed.length > 0 && (
        <div className={css.section}>
          <h3 className={css.sectionTitle}>{t(practice ? 'review.stillMissed' : 'review.backTomorrow', { count: String(missed.length) })}</h3>
          <div className={css.chips}>{missed.map(entry => <span key={entry.card.id} className={css.chip} data-tone="weak">{entry.card.term}</span>)}</div>
        </div>
      )}
      {!practice && up.length > 0 && (
        <div className={css.section}>
          <h3 className={css.sectionTitle}>{t('review.movedUp', { count: String(up.length) })}</h3>
          <div className={css.chips}>{up.slice(0, 12).map(entry => <span key={entry.card.id} className={css.chip} data-tone="photo">{entry.card.term}</span>)}</div>
        </div>
      )}
      {!practice && steady.length > 0 && (
        <div className={css.section}>
          <h3 className={css.sectionTitle}>{t('review.steady', { count: String(steady.length) })}</h3>
          <div className={css.chips}>{steady.slice(0, 12).map(entry => <span key={entry.card.id} className={css.chip}>{entry.card.term}</span>)}</div>
        </div>
      )}
      <div className={css.actions}>
        {missed.length > 0 && <button type="button" className={css.primary} onClick={onAgain}>{t('review.again', { count: String(missed.length) })}</button>}
        <button type="button" className={css.secondary} onClick={onDone}>{t('review.done.back')}</button>
      </div>
    </section>
  )
}
