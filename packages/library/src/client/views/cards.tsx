/**
 * 知识卡片: the project's cards — what the learner marked, asked about and
 * missed — filtered by where they came from, searchable with the same
 * matcher the coach uses, each card showing its sentence, its sources, how
 * weak it is and where its review stands.
 *
 * @module @khorsheed/dsh-library/client/views/cards
 */
import { useState, type ReactNode } from 'react'
import { ChipRow, PanelHeader } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import type { LibraryCard, LibraryCardSourceType } from '../../types.ts'
import type { LibraryCardFilter } from '../store.ts'
import { IconSearchOutlineMedium, IconSparkleOutlineMedium } from '../icons.tsx'
import { BoxDots, daysUntil, Highlight, outcome, shortGloss, StateLine, useLoad, value, WeaknessBars, type ViewProps } from '../ui.tsx'
import css from '../LibraryPane.module.css'

const FILTERS: readonly LibraryCardFilter[] = ['all', 'photo', 'chat', 'quiz', 'due']

/** The project's knowledge cards. */
export function CardsView({ p, projectId, filter }: ViewProps & { projectId: string; filter: LibraryCardFilter }): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | undefined>()
  const project = useLoad(() => outcome(p.getProject(projectId)), [projectId, rev])
  const cards = useLoad(() => value(p.listCards({
    projectId,
    ...(filter === 'due' ? { due: true, sort: 'due' as const } : {}),
    ...(filter === 'photo' || filter === 'chat' || filter === 'quiz' ? { source: filter as LibraryCardSourceType } : {}),
    ...(filter === 'all' ? { sort: 'recent' as const } : {}),
    ...(query.trim() === '' ? {} : { query }),
  })), [projectId, filter, query, rev])
  const books = new Map((project.data?.books ?? []).map(book => [book.id, book.title]))

  return (
    <>
      <PanelHeader
        title={t('cards.title')}
        meta={cards.data === undefined ? undefined : String(cards.data.total)}
        onBack={() => { actions.pop() }}
        backLabel={t('action.back')}
        actions={[
          { id: 'search', label: t('cards.search'), icon: <IconSearchOutlineMedium />, pressed: searching, onSelect: () => { setSearching(!searching); setQuery('') } },
          { id: 'review', label: t('review.start'), icon: <IconSparkleOutlineMedium />, onSelect: () => { actions.push({ view: 'review', projectId }) } },
        ]}
        moreLabel={t('action.more')}
      />
      {searching
        ? (
          <div className={css.searchRow}>
            <input className={css.input} autoFocus value={query} placeholder={t('cards.searchPlaceholder')} onChange={event => { setQuery(event.target.value) }} />
          </div>
        )
        : (
          <ChipRow
            label={t('cards.filters')}
            chips={FILTERS.map(id => ({ id, label: t(`cards.filter.${id}`) }))}
            value={filter}
            onSelect={next => { actions.replace({ view: 'cards', projectId, filter: next }) }}
          />
        )}
      <div className={css.body}>
        <StateLine loaded={cards} t={t} />
        {cards.data !== undefined && cards.data.cards.length === 0 && <div className={css.muted}>{t('cards.empty')}</div>}
        <div className={css.cardList}>
          {(cards.data?.cards ?? []).map(card => (
            <CardRow
              key={card.id}
              p={p}
              projectId={projectId}
              card={card}
              bookTitle={card.bookId === undefined ? undefined : books.get(card.bookId)}
              open={open === card.id}
              onToggle={() => { setOpen(open === card.id ? undefined : card.id) }}
            />
          ))}
        </div>
      </div>
    </>
  )
}

/** One card; tapping opens its sentences, sources and actions. */
function CardRow({ p, projectId, card, bookTitle, open, onToggle }: {
  p: ViewProps['p']; projectId: string; card: LibraryCard; bookTitle: string | undefined; open: boolean; onToggle: () => void
}): ReactNode {
  const { t, actions } = p
  const [notice, setNotice] = useState<string | undefined>()
  const due = daysUntil(card.mastery.dueAt)
  const setStatus = (status: LibraryCard['status']): void => {
    void outcome(p.editCard(projectId, card.id, { status })).then(() => { actions.refresh() }, (failure: unknown) => { setNotice(String(failure)) })
  }
  return (
    <article className={css.cardRow} data-open={open ? 'true' : 'false'}>
      <button type="button" className={css.cardMain} onClick={onToggle} aria-expanded={open}>
        <span className={css.cardTop}>
          <span className={card.kind === 'word' ? css.term : css.concept}>{card.term}</span>
          <span className={css.cardGloss}>{shortGloss(card.gloss, 24)}</span>
          <WeaknessBars weakness={card.weakness} label={t('cards.weakness', { level: String(card.weakness) })} />
        </span>
        {card.contexts[0] !== undefined && (
          <span className={css.sentence}><Highlight sentence={card.contexts[0].sentence} term={card.term} /></span>
        )}
        <span className={css.chips}>
          <span className={css.chip}>{bookTitle ?? t('cards.projectLevel')}</span>
          {[...new Set(card.sources.map(source => source.type))].map(type => (
            <span key={type} className={css.chip} data-tone={type === 'photo' ? 'photo' : type === 'chat' || type === 'quiz' ? 'weak' : undefined}>{t(`source.${type}`)}</span>
          ))}
          <span className={css.chipPlain}>{due === 0 ? t('cards.dueNow') : t('cards.dueIn', { days: String(due) })}</span>
        </span>
      </button>
      {open && (
        <div className={css.cardMore}>
          <div>{card.gloss}</div>
          {card.userGloss !== undefined && <div>{t('cards.userGloss', { gloss: card.userGloss })}</div>}
          {card.aliases.length > 0 && <div className={css.muted}>{t('cards.aliases', { aliases: card.aliases.join('、') })}</div>}
          {card.contexts.slice(1).map(context => (
            <div key={context.sentence} className={css.sentence}><Highlight sentence={context.sentence} term={card.term} /></div>
          ))}
          <ul className={css.sources}>
            {card.sources.slice(-5).map(source => (
              <li key={`${source.type}-${source.at}`}>{t(`source.${source.type}`)}{source.note === undefined ? '' : `：${source.note}`}</li>
            ))}
          </ul>
          <div className={css.row}>
            <BoxDots box={card.mastery.box} label={t('cards.box', { box: String(card.mastery.box) })} />
          </div>
          <div className={css.actions}>
            <button type="button" className={css.secondary} onClick={() => { setNotice(p.primeConversation(t('prime.card', { term: card.term })) ? t('notice.primed') : t('notice.noConversation')) }}>{t('action.askCoach')}</button>
            <button type="button" className={css.ghost} onClick={() => { setStatus('mastered') }}>{t('cards.mastered')}</button>
            <button type="button" className={css.danger} onClick={() => { setStatus('deleted') }}>{t('cards.delete')}</button>
          </div>
          {notice !== undefined && <div className={css.notice}>{notice}</div>}
        </div>
      )}
    </article>
  )
}
