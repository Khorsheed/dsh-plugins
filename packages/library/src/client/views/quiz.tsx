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
import { useMemo, useState, type ReactNode } from 'react'
import { PanelHeader } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import { LEITNER_INTERVAL_DAYS, type LibraryAssessResult, type LibraryCard, type LibraryQuizQuestion, type LibraryReviewRating, type LibraryVerdict } from '../../types.ts'
import { choiceIndex, fillMatches } from '../judge.ts'
import { Highlight, outcome, StateLine, useLoad, value, type ViewProps } from '../ui.tsx'
import css from '../LibraryPane.module.css'

/** One question's state in the sitting. */
interface Answered {
  readonly given: string
  /** Judged here: true / false; open questions stay undefined. */
  readonly pass?: boolean
  readonly void?: boolean
}

/** The quiz screen. */
export function QuizView({ p, projectId, bookId, quizId }: ViewProps & { projectId: string; bookId: string; quizId: string }): ReactNode {
  const { t, actions } = p
  const loaded = useLoad(() => outcome(p.getQuiz(projectId, quizId)), [projectId, quizId])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, Answered>>({})
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const quiz = loaded.data?.quiz
  const question = quiz?.questions[index]
  const answered = question === undefined ? undefined : answers[question.id]
  const last = quiz !== undefined && index === quiz.questions.length - 1

  const record = (entry: Answered): void => {
    if (question === undefined) return
    setAnswers(previous => ({ ...previous, [question.id]: entry }))
  }

  const next = (): void => {
    setDraft('')
    setIndex(index + 1)
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
      return
    }
    const verdicts: LibraryVerdict[] = quiz.questions.map(item => {
      const entry = answers[item.id]
      return {
        task: item.id,
        criterion: item.prompt.slice(0, 120),
        pass: entry?.pass === true,
        evidence: item.evidence.quote ?? item.answer,
        by: 'self',
        ...(entry?.void === true ? { void: true } : {}),
      }
    })
    setBusy(true)
    try {
      const result = await outcome(p.putAttempt(projectId, quiz.id, verdicts))
      actions.replace({ view: 'result', projectId, bookId, result })
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PanelHeader
        title={quiz === undefined ? t('node.quiz') : t('quiz.progress', { at: String(index + 1), total: String(quiz.questions.length) })}
        onBack={() => { actions.pop() }}
        backLabel={t('action.back')}
        moreLabel={t('action.more')}
      />
      <div className={css.body}>
        <StateLine loaded={loaded} t={t} />
        {quiz !== undefined && (
          <div className={css.progress} aria-hidden="true"><i style={{ width: `${Math.round(((index + (answered === undefined ? 0 : 1)) / quiz.questions.length) * 100)}%` }} /></div>
        )}
        {question !== undefined && (
          <QuestionCard
            p={p}
            question={question}
            answered={answered}
            draft={draft}
            onDraft={setDraft}
            onAnswer={record}
          />
        )}
        {notice !== undefined && <div className={css.notice}>{notice}</div>}
        {question !== undefined && answered !== undefined && (
          <div className={css.actions}>
            {!last && <button type="button" className={css.primary} onClick={next}>{t('quiz.next')}</button>}
            {last && <button type="button" className={css.primary} disabled={busy} onClick={() => { void finish() }}>{t('quiz.finish')}</button>}
          </div>
        )}
      </div>
    </>
  )
}

/** One question: its two tags, its quote, the answer control, the feedback. */
function QuestionCard({ p, question, answered, draft, onDraft, onAnswer }: {
  p: ViewProps['p']
  question: LibraryQuizQuestion
  answered: Answered | undefined
  draft: string
  onDraft: (value: string) => void
  onAnswer: (entry: Answered) => void
}): ReactNode {
  const { t } = p
  const correct = question.kind === 'choice' ? choiceIndex(question.options ?? [], question.answer) : -1
  const evidenceTone = question.evidence.kind === 'photo' ? 'photo' : question.evidence.kind === 'web' ? 'web' : 'know'
  return (
    <section className={css.question}>
      <div className={css.chips}>
        <span className={css.chip} data-tone={question.target.kind === 'asked' || question.target.kind === 'missed' ? 'weak' : undefined}>{t(`target.${question.target.kind}`)}</span>
        <span className={css.chip} data-tone={evidenceTone}>{t(`evidence.${question.evidence.kind}`)}</span>
      </div>
      <div className={css.prompt}>{question.prompt}</div>
      {question.evidence.quote !== undefined && <blockquote className={css.quote}>{question.evidence.quote}</blockquote>}
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
                <span>{option}</span>
              </button>
            )
          })}
        </div>
      )}
      {question.kind !== 'choice' && (
        <>
          <textarea
            className={css.answer}
            rows={question.kind === 'free' ? 4 : 1}
            value={answered?.given ?? draft}
            disabled={answered !== undefined}
            placeholder={t(question.kind === 'free' ? 'quiz.freePlaceholder' : 'quiz.fillPlaceholder')}
            onChange={event => { onDraft(event.target.value) }}
          />
          {answered === undefined && (
            <div className={css.actions}>
              <button
                type="button"
                className={css.secondary}
                disabled={draft.trim() === ''}
                onClick={() => { onAnswer(question.kind === 'fill' ? { given: draft, pass: fillMatches(draft, question.answer) } : { given: draft }) }}
              >{t('quiz.submit')}</button>
            </div>
          )}
        </>
      )}
      {answered !== undefined && answered.void !== true && (
        <div className={css.feedback}>
          {answered.pass === true && <strong className={css.ok}>{t('quiz.right')}</strong>}
          {answered.pass === false && <strong className={css.bad}>{t('quiz.wrong', { answer: correct >= 0 && question.options?.[correct] !== undefined ? `${String.fromCharCode(65 + correct)}. ${question.options[correct]}` : question.answer })}</strong>}
          {answered.pass === undefined && <strong>{t('quiz.coachJudges')}</strong>}
          {question.explanation !== undefined && <div>{question.explanation}</div>}
          {question.evidence.url !== undefined && <a className={css.link} href={question.evidence.url} target="_blank" rel="noreferrer">{t('quiz.source')}</a>}
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

/** The sitting's result: the score, what unlocked, how the cards moved. */
export function ResultView({ p, projectId, bookId, result }: ViewProps & { projectId: string; bookId: string; result: LibraryAssessResult }): ReactNode {
  const { t, actions } = p
  const percent = Math.round(result.attempt.ratio * 100)
  const passed = result.completed !== undefined
  return (
    <>
      <PanelHeader title={t('result.title')} onBack={() => { actions.pop() }} backLabel={t('action.back')} moreLabel={t('action.more')} />
      <div className={css.body}>
        <section className={css.hero}>
          <div className={css.heroText}>
            <span className={css.big}>{percent}%</span>
            <span className={css.muted}>{t('result.line', { pass: String(Math.round(result.passRatio * 100)) })}</span>
          </div>
          <strong className={passed ? css.ok : css.bad}>{passed ? t('result.passed') : t('result.notYet')}</strong>
        </section>
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
        <div className={css.actions}>
          {result.unlocked[0] !== undefined && (
            <button type="button" className={css.primary} onClick={() => { actions.replace({ view: 'node', projectId, bookId, nodeId: result.unlocked[0]!, tab: 'guide' }) }}>{t('result.next')}</button>
          )}
          <button type="button" className={css.secondary} onClick={() => { actions.replace({ view: 'book', projectId, bookId }) }}>{t('result.toPath')}</button>
        </div>
      </div>
    </>
  )
}

/** Days until the next review for a rating, shown on its button. */
function nextDays(card: LibraryCard, rating: LibraryReviewRating): number {
  const box = rating === 'forgot' ? 0 : rating === 'fuzzy' ? card.mastery.box : Math.min(card.mastery.box + 1, 5)
  return LEITNER_INTERVAL_DAYS[Math.min(box, LEITNER_INTERVAL_DAYS.length - 1)]!
}

/** Daily review: flashcards over the due cards. */
export function ReviewView({ p, projectId }: ViewProps & { projectId?: string }): ReactNode {
  const { t, actions } = p
  const loaded = useLoad(() => value(p.dueCards(projectId)), [projectId])
  const queue = useMemo(() => loaded.data?.cards ?? [], [loaded.data])
  const [at, setAt] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const card = queue[at]

  const rate = (rating: LibraryReviewRating): void => {
    if (card === undefined) return
    void outcome(p.reviewCard(card.projectId, card.id, rating)).then(
      () => { setFlipped(false); setAt(at + 1) },
      (failure: unknown) => { setError(String(failure)) },
    )
  }

  // A card met in several sentences shows a different one each time.
  const sentence = card === undefined || card.contexts.length === 0 ? undefined : card.contexts[card.mastery.streak % card.contexts.length]!.sentence
  const stuck = card?.sources.slice().reverse().find(source => (source.type === 'chat' || source.type === 'quiz') && source.note !== undefined)

  return (
    <>
      <PanelHeader
        title={queue.length === 0 ? t('review.title') : t('review.progress', { at: String(Math.min(at + 1, queue.length)), total: String(queue.length) })}
        onBack={() => { actions.pop() }}
        backLabel={t('action.back')}
        moreLabel={t('action.more')}
      />
      <div className={css.body}>
        <StateLine loaded={loaded} t={t} />
        {queue.length > 0 && <div className={css.progress} aria-hidden="true"><i style={{ width: `${Math.round((at / queue.length) * 100)}%` }} /></div>}
        {loaded.data !== undefined && card === undefined && (
          <div className={css.empty}>
            <div className={css.emptyTitle}>{queue.length === 0 ? t('review.nothing') : t('review.done', { count: String(queue.length) })}</div>
            <button type="button" className={css.secondary} onClick={() => { actions.pop() }}>{t('action.back')}</button>
          </div>
        )}
        {card !== undefined && (
          <section className={css.flash}>
            <div className={css.flashFront}>
              {sentence !== undefined
                ? <div className={css.flashSentence}><Highlight sentence={sentence} term={card.term} /></div>
                : <div className={css.flashSentence}>{card.term}</div>}
              <div className={css.muted}>{card.kind === 'word' ? t('review.askWord', { term: card.term }) : t('review.askConcept', { term: card.term })}</div>
            </div>
            {flipped && (
              <div className={css.flashBack}>
                <strong>{card.gloss}</strong>
                {card.userGloss !== undefined && <div className={css.muted}>{t('cards.userGloss', { gloss: card.userGloss })}</div>}
                {stuck?.note !== undefined && <div className={css.muted}>{t(stuck.type === 'quiz' ? 'review.youMissed' : 'review.youAsked', { note: stuck.note })}</div>}
              </div>
            )}
            {!flipped
              ? <button type="button" className={css.secondary} onClick={() => { setFlipped(true) }}>{t('review.flip')}</button>
              : (
                <div className={css.rate}>
                  {(['forgot', 'fuzzy', 'recalled'] as const).map(rating => (
                    <button key={rating} type="button" className={css.rateButton} onClick={() => { rate(rating) }}>
                      <span>{t(`review.${rating}`)}</span>
                      <span className={css.muted}>{t('review.inDays', { days: String(nextDays(card, rating)) })}</span>
                    </button>
                  ))}
                </div>
              )}
          </section>
        )}
        {error !== undefined && <div className={css.error}>{error}</div>}
      </div>
    </>
  )
}
