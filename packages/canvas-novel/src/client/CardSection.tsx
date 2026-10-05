/**
 * The genre's section on a card page (`canvas.card.section`): what the engine
 * keeps about a card beside the fields the user types —
 *
 * - a foreshadow: the user's ★ (主线重点), with a soft hint once more than
 *   {@link STAR_SOFT_LIMIT} carry one;
 * - a character: 此刻 (where / state / concern), refreshed by each 对账 and
 *   editable here.
 *
 * Other cards, and cards on a canvas of another genre, get nothing.
 *
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { useState, type ReactNode } from 'react'
import { NOVEL_GENRE_ID, STAR_SOFT_LIMIT, type CurrentState, type NovelCardResult } from '../types.ts'
import type { NovelCardOwnerProps, NovelRemote, NovelSurfaceProps } from './contract.ts'
import { errorKey, useNovelRead } from './use-novel.ts'
import css from './novel.module.css'

/** The parts of 此刻, in reading order. */
const STATE_PARTS = ['where', 'state', 'concern'] as const

/** The `canvas.card.section` entry. */
export function CardSection(props: NovelSurfaceProps<NovelCardOwnerProps>): ReactNode {
  const { board, category } = props
  if (board.genre?.id !== NOVEL_GENRE_ID) return null
  if (category.role !== 'foreshadow' && category.role !== 'character') return null
  return <CardSectionBody {...props} />
}

function CardSectionBody(props: NovelSurfaceProps<NovelCardOwnerProps>): ReactNode {
  const { canvasId, card, rev, remote, sessionId, navigate, t } = props
  const api = remote()
  const read = useNovelRead(api, r => r.card({ canvasId, cardId: card.id }), `card:${canvasId}:${card.id}`, rev)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  if (api === undefined || read.state !== 'ready' || !read.value.ok) return null

  const gesture = async (call: (api: NovelRemote) => ReturnType<NovelRemote['starForeshadow']>): Promise<boolean> => {
    if (sessionId === undefined) return false
    setBusy(true)
    setFailure(null)
    try {
      const result = await call(api)
      const failed = !result.ok ? t('error.generic', { message: result.error.message }) : result.value.ok ? null : t(errorKey(result.value.error))
      setFailure(failed)
      navigate.refresh()
      return failed === null
    } finally {
      setBusy(false)
    }
  }

  const view = read.value
  return (
    <section className={css.cardSection}>
      {view.role === 'foreshadow' && (
        <StarRow
          view={view}
          busy={busy}
          readOnly={sessionId === undefined}
          onToggle={starred => { void gesture(r => r.starForeshadow(sessionId!, { canvasId, cardId: card.id, starred })) }}
          t={t}
        />
      )}
      {view.role === 'character' && (
        <StateRow
          state={view.currentState ?? {}}
          busy={busy}
          readOnly={sessionId === undefined}
          onSave={state => gesture(r => r.setCurrentState(sessionId!, { canvasId, cardId: card.id, state }))}
          t={t}
        />
      )}
      {failure !== null && <div className={css.warn}>{failure}</div>}
    </section>
  )
}

function StarRow({ view, busy, readOnly, onToggle, t }: {
  readonly view: NovelCardResult
  readonly busy: boolean
  readonly readOnly: boolean
  readonly onToggle: (starred: boolean) => void
  readonly t: NovelSurfaceProps['t']
}): ReactNode {
  const starred = view.starred === true
  const count = view.starredCount ?? 0
  return (
    <div className={css.cardSectionRow}>
      <button
        type="button"
        className={css.starToggle}
        aria-pressed={starred}
        disabled={busy || readOnly}
        onClick={() => { onToggle(!starred) }}
      >
        {starred ? `★ ${t('card.starred')}` : `☆ ${t('card.star')}`}
      </button>
      <span className={css.muted}>{t('card.starHelp')}</span>
      {starred && count > STAR_SOFT_LIMIT && <div className={css.warn}>{t('card.starCrowded', { count, limit: STAR_SOFT_LIMIT })}</div>}
    </div>
  )
}

function StateRow({ state, busy, readOnly, onSave, t }: {
  readonly state: CurrentState
  readonly busy: boolean
  readonly readOnly: boolean
  readonly onSave: (state: CurrentState) => Promise<boolean>
  readonly t: NovelSurfaceProps['t']
}): ReactNode {
  const [draft, setDraft] = useState<CurrentState | null>(null)
  const label = (part: typeof STATE_PARTS[number]): string => t(`card.state.${part}`)
  if (draft === null) {
    return (
      <div className={css.cardSectionRow}>
        <div className={css.cardSectionHead}>
          <span className={css.planLabel}>{t('card.now')}</span>
          {!readOnly && <button type="button" className={css.button} onClick={() => { setDraft(state) }}>{t('card.edit')}</button>}
        </div>
        <dl className={css.kv}>
          {STATE_PARTS.map(part => (
            <div key={part} className={css.kvRow}>
              <dt>{label(part)}</dt>
              <dd>{state[part] ?? <span className={css.muted}>{t('card.state.unset')}</span>}</dd>
            </div>
          ))}
        </dl>
        <span className={css.muted}>{t('card.nowHelp')}</span>
      </div>
    )
  }
  return (
    <form
      className={css.cardSectionRow}
      onSubmit={(event) => {
        event.preventDefault()
        void onSave(draft).then(saved => { if (saved) setDraft(null) })
      }}
    >
      <div className={css.cardSectionHead}>
        <span className={css.planLabel}>{t('card.now')}</span>
      </div>
      <dl className={css.kv}>
        {STATE_PARTS.map(part => (
          <div key={part} className={css.kvRow}>
            <dt>{label(part)}</dt>
            <dd>
              <input
                className={css.stateInput}
                value={draft[part] ?? ''}
                maxLength={200}
                onChange={(event) => { setDraft({ ...draft, [part]: event.target.value }) }}
              />
            </dd>
          </div>
        ))}
      </dl>
      <div className={css.cardSectionActions}>
        <button type="submit" className={css.buttonPrimary} disabled={busy}>{t('card.save')}</button>
        <button type="button" className={css.button} disabled={busy} onClick={() => { setDraft(null) }}>{t('card.cancel')}</button>
      </div>
    </form>
  )
}
