/**
 * A member's question card ('room-question' keyed renderer): the questions a
 * CLI member asked through its bridge's `ask_user_question`, answered by
 * picking — one option (or several on a multi-pick question) plus an optional
 * 其他 free-text line — instead of a numbered list in the member's reply that
 * the human answers by typing. Submitting resolves the member's waiting call;
 * the card then folds to the given answers (or 已过期 when the call ended).
 */
import { useState, type CSSProperties, type ReactNode } from 'react'
import type { RoomQuestionAnswer } from '../types.ts'
import { memberColor } from './member-color.ts'
import type { RoomQuestionViewProps } from './slots.ts'
import css from './RoomQuestionView.module.css'

/** One question's draft: picked option labels and the 其他 text. */
interface Draft {
  readonly selected: readonly string[]
  readonly custom: string
}

/** The question card. */
export function RoomQuestionView({ node, answerQuestion, t }: RoomQuestionViewProps): ReactNode {
  const data = node.data
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const pending = data.state === 'pending'
  const draftOf = (id: string): Draft => drafts[id] ?? { selected: [], custom: '' }
  const setDraft = (id: string, next: Draft): void => { setDrafts(current => ({ ...current, [id]: next })) }
  const answered = (id: string): boolean => draftOf(id).selected.length > 0 || draftOf(id).custom.trim() !== ''
  const complete = data.questions.every(question => answered(question.id))

  const pick = (id: string, label: string, multi: boolean): void => {
    const draft = draftOf(id)
    const has = draft.selected.includes(label)
    setDraft(id, { ...draft, selected: multi ? (has ? draft.selected.filter(entry => entry !== label) : [...draft.selected, label]) : (has ? [] : [label]) })
  }
  const submit = async (): Promise<void> => {
    if (busy || !complete) return
    setBusy(true)
    try {
      const answers: RoomQuestionAnswer[] = data.questions.map((question) => {
        const draft = draftOf(question.id)
        const custom = draft.custom.trim()
        return { id: question.id, selected: draft.selected, ...custom === '' ? {} : { custom } }
      })
      setError(await answerQuestion(data.questionId, answers))
    } finally { setBusy(false) }
  }
  /** The folded answer text of one question. */
  const answerText = (id: string): string => {
    const answer = data.answers?.find(entry => entry.id === id)
    return [...answer?.selected ?? [], ...answer?.custom === undefined ? [] : [answer.custom]].join('；')
  }

  return (
    <div className={css.card} data-state={data.state} style={{ '--member-color': memberColor(data.member) } as CSSProperties}>
      <div className={css.head}>
        <span className={css.avatar} aria-hidden>{data.member.slice(0, 1).toUpperCase()}</span>
        <span className={css.title}>{t('question.title', { member: data.member })}</span>
        {!pending && <span className={css.status}>{t(data.state === 'answered' ? 'question.answered' : 'question.cancelled')}</span>}
      </div>
      {data.questions.map((question) => {
        const multi = question.multiSelect === true
        const draft = draftOf(question.id)
        return (
          <fieldset key={question.id} className={css.question} disabled={!pending || busy}>
            <legend className={css.prompt}>
              {question.header !== undefined && <span className={css.chip}>{question.header}</span>}
              <span>{question.question}</span>
              {pending && multi && <span className={css.hint}>{t('question.multi')}</span>}
            </legend>
            {pending ? (
              <>
                {(question.options ?? []).map(option => (
                  <label key={option.label} className={css.option} data-picked={draft.selected.includes(option.label)}>
                    <input
                      type={multi ? 'checkbox' : 'radio'}
                      name={`${data.questionId}-${question.id}`}
                      checked={draft.selected.includes(option.label)}
                      onChange={() => { pick(question.id, option.label, multi) }}
                      onClick={(event) => {
                        // A picked radio unpicks on a second click (the draft allows none).
                        if (!multi && draft.selected.includes(option.label)) { event.preventDefault(); pick(question.id, option.label, multi) }
                      }}
                    />
                    <span className={css.optionText}>
                      <span className={css.optionLabel}>{option.label}</span>
                      {option.description !== undefined && <span className={css.optionDescription}>{option.description}</span>}
                    </span>
                  </label>
                ))}
                <input
                  className={css.other}
                  value={draft.custom}
                  aria-label={t('question.other')}
                  placeholder={(question.options ?? []).length > 0 ? `${t('question.other')}：${t('question.otherPlaceholder')}` : t('question.otherPlaceholder')}
                  onChange={(event) => { setDraft(question.id, { ...draft, custom: event.target.value }) }}
                />
              </>
            ) : data.state === 'answered' && (
              <div className={css.answer}>{t('question.answer', { answer: answerText(question.id) })}</div>
            )}
          </fieldset>
        )
      })}
      {pending && (
        <div className={css.actions}>
          {error !== undefined && <span className={css.error}>{error}</span>}
          <button type="button" className={css.submit} disabled={!complete || busy} onClick={() => { void submit() }}>{t('question.submit')}</button>
        </div>
      )}
    </div>
  )
}
