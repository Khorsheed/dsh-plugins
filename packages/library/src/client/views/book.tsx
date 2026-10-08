/**
 * One book in the sidebar: its roadmap draft waiting for 采用, its adopted
 * path as an S-shaped trail of nodes, and one node's page (guide, the pages
 * photographed for it, its chapter quizzes).
 *
 * @module @khorsheed/dsh-library/client/views/book
 */
import { useEffect, useState, type ReactNode } from 'react'
import { ChipRow, ListRow, PanelHeader, UnderlineTabs } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import type { LibraryBook, LibraryPage, LibraryQuizFocus, LibraryRoadmap, RoadmapNode } from '../../types.ts'
import type { LibraryNodeTab } from '../store.ts'
import {
  IconCameraOutlineMedium, IconCheckOutlineMedium, IconLockOutlineMedium, IconRefreshOutlineMedium, IconSparkleOutlineMedium,
} from '../icons.tsx'
import { outcome, shortGloss, StateLine, useLoad, value, WeaknessBars, type ViewProps } from '../ui.tsx'
import css from '../LibraryPane.module.css'

/** The zigzag column (0..2) a node at `index` sits in. */
function column(index: number): number {
  const phase = index % 4
  return phase === 3 ? 1 : phase
}

/** A node's chapter rows, as titles. */
function rowsOf(node: RoadmapNode, book: LibraryBook): string[] {
  return node.chapterRanges.flatMap(range => book.toc.filter(row => row.n >= range.from && row.n <= range.to).map(row => row.title))
}

/** One book: draft card, path, or the ask for one. */
export function BookView({ p, projectId, bookId }: ViewProps & { projectId: string; bookId: string }): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  const loaded = useLoad(async () => {
    const [detail, roadmaps] = await Promise.all([outcome(p.getProject(projectId)), value(p.getRoadmap(projectId, bookId))])
    return { book: detail.books.find(candidate => candidate.id === bookId), ...roadmaps }
  }, [projectId, bookId, rev])
  const [notice, setNotice] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const book = loaded.data?.book

  const prime = (text: string): void => {
    void p.bindTarget({ projectId, bookId })
    setNotice(p.primeConversation(text) ? t('notice.primed') : t('notice.noConversation'))
  }

  const act = async (run: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await run()
      actions.refresh()
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PanelHeader
        title={book?.title ?? ''}
        meta={book?.edition}
        onBack={() => { actions.pop() }}
        backLabel={t('action.back')}
        actions={book === undefined ? [] : [
          { id: 'ask', label: t('action.askCoach'), icon: <IconSparkleOutlineMedium />, onSelect: () => { prime(t('prime.readBook', { book: book.title })) } },
          { id: 'replan', label: t('book.replan'), icon: <IconRefreshOutlineMedium />, onSelect: () => { prime(t('prime.replan', { book: book.title })) } },
          { id: 'bind', label: t('action.bindBook'), icon: <IconSparkleOutlineMedium />, menuOnly: true, onSelect: () => { void p.bindTarget({ projectId, bookId }).then(() => { setNotice(t('notice.bound')) }) } },
        ]}
        moreLabel={t('action.more')}
      />
      <div className={css.body}>
        <StateLine loaded={loaded} t={t} />
        {notice !== undefined && <div className={css.notice}>{notice}</div>}
        {book !== undefined && loaded.data?.draft !== undefined && (
          <DraftCard
            p={p}
            book={book}
            draft={loaded.data.draft}
            replaces={loaded.data.roadmap !== undefined}
            busy={busy}
            onAdopt={() => { void act(() => outcome(p.adoptRoadmap(projectId, bookId))) }}
            onDiscard={() => { void act(() => outcome(p.discardDraft(projectId, bookId))) }}
          />
        )}
        {book !== undefined && loaded.data?.roadmap !== undefined && (
          <Path p={p} roadmap={loaded.data.roadmap} onOpen={node => { actions.push({ view: 'node', projectId, bookId, nodeId: node.id, tab: node.kind === 'read' ? 'guide' : 'quiz' }) }} />
        )}
        {book !== undefined && loaded.data?.roadmap === undefined && loaded.data?.draft === undefined && (
          <div className={css.empty}>
            <div className={css.emptyTitle}>{t('book.noRoadmap')}</div>
            <div className={css.muted}>{t('book.noRoadmapBody')}</div>
            <button type="button" className={css.primary} onClick={() => { prime(t('prime.plan', { book: book.title })) }}>{t('book.askPlan')}</button>
          </div>
        )}
        {book !== undefined && (
          <div className={css.muted}>
            {t('book.contentsMeta', { rows: String(book.toc.length), kind: t(`bookKind.${book.bookKind}`) })}
            {book.tocSource.url !== undefined && <> · <a className={css.link} href={book.tocSource.url} target="_blank" rel="noreferrer">{t('book.contentsSource')}</a></>}
          </div>
        )}
      </div>
    </>
  )
}

/** The draft card: what the coach proposes, and the learner's 采用 / 放弃. */
function DraftCard({ p, book, draft, replaces, busy, onAdopt, onDiscard }: {
  p: ViewProps['p']
  book: LibraryBook
  draft: LibraryRoadmap
  replaces: boolean
  busy: boolean
  onAdopt: () => void
  onDiscard: () => void
}): ReactNode {
  const { t } = p
  return (
    <section className={css.draft}>
      <div className={css.draftHead}>
        <span className={css.draftTitle}>{t('book.draftTitle')}</span>
        <span className={css.chip} data-tone={book.tocSource.by === 'web' ? 'web' : 'know'}>{t(`tocSource.${book.tocSource.by}`)}</span>
      </div>
      <div className={css.muted}>{t('book.draftMeta', { count: String(draft.nodes.length) })}{draft.note === undefined ? '' : ` · ${draft.note}`}</div>
      <ol className={css.draftNodes}>
        {draft.nodes.map(node => (
          <li key={node.id}>
            <span className={css.kind} data-kind={node.kind}>{t(`nodeKind.${node.kind}`)}</span>
            <span>{node.title}</span>
          </li>
        ))}
      </ol>
      {replaces && <div className={css.muted}>{t('book.draftReplaces')}</div>}
      <div className={css.actions}>
        <button type="button" className={css.primary} disabled={busy} onClick={onAdopt}>{t('book.adopt')}</button>
        <button type="button" className={css.ghost} disabled={busy} onClick={onDiscard}>{t('book.discard')}</button>
      </div>
    </section>
  )
}

/** The adopted path: an S-shaped trail, three columns wide. */
function Path({ p, roadmap, onOpen }: { p: ViewProps['p']; roadmap: LibraryRoadmap; onOpen: (node: RoadmapNode) => void }): ReactNode {
  const { t } = p
  const done = roadmap.nodes.filter(node => node.state === 'done').length
  return (
    <section className={css.section}>
      <h3 className={css.sectionTitle}>{t('book.pathTitle', { done: String(done), total: String(roadmap.nodes.length) })}</h3>
      <div className={css.path}>
        {roadmap.nodes.map((node, index) => (
          <div key={node.id} className={css.pathRow}>
            <button
              type="button"
              className={css.pathNode}
              style={{ gridColumn: column(index) + 1 }}
              onClick={() => { onOpen(node) }}
            >
              <span className={css.disc} data-state={node.state} data-kind={node.kind}>
                {node.state === 'done'
                  ? <IconCheckOutlineMedium />
                  : node.state === 'locked' ? <IconLockOutlineMedium /> : index + 1}
              </span>
              <span className={css.pathLabel} data-state={node.state}>{node.title}</span>
            </button>
          </div>
        ))}
      </div>
      <div className={css.legend}>{t('book.legend')}</div>
    </section>
  )
}

/** One node: guide, photographed pages, chapter quizzes. */
export function NodeView({ p, projectId, bookId, nodeId, tab }: ViewProps & { projectId: string; bookId: string; nodeId: string; tab: LibraryNodeTab }): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  const loaded = useLoad(async () => {
    const [detail, roadmaps] = await Promise.all([outcome(p.getProject(projectId)), value(p.getRoadmap(projectId, bookId))])
    const book = detail.books.find(candidate => candidate.id === bookId)
    const node = roadmaps.roadmap?.nodes.find(candidate => candidate.id === nodeId)
    return { book, node, passRatio: roadmaps.roadmap?.passRatio ?? 0.8 }
  }, [projectId, bookId, nodeId, rev])
  const [notice, setNotice] = useState<string | undefined>()
  const book = loaded.data?.book
  const node = loaded.data?.node

  const prime = (text: string): void => {
    void p.bindTarget({ projectId, bookId })
    setNotice(p.primeConversation(text) ? t('notice.primed') : t('notice.noConversation'))
  }

  return (
    <>
      <PanelHeader
        title={node?.title ?? ''}
        meta={book?.title}
        onBack={() => { actions.pop() }}
        backLabel={t('action.back')}
        actions={node === undefined || book === undefined ? [] : [
          { id: 'ask', label: t('action.askCoach'), icon: <IconSparkleOutlineMedium />, onSelect: () => { prime(t('prime.node', { book: book.title, node: node.title })) } },
        ]}
        moreLabel={t('action.more')}
      />
      <UnderlineTabs
        label={t('node.tabs')}
        tabs={[
          { id: 'guide' as const, label: t('node.guide') },
          { id: 'pages' as const, label: t('node.pages') },
          { id: 'quiz' as const, label: t('node.quiz'), disabled: node?.kind === 'read' },
        ]}
        value={tab}
        onChange={next => { actions.replace({ view: 'node', projectId, bookId, nodeId, tab: next }) }}
      />
      <div className={css.body}>
        <StateLine loaded={loaded} t={t} />
        {notice !== undefined && <div className={css.notice}>{notice}</div>}
        {node !== undefined && book !== undefined && tab === 'guide' && (
          <GuideTab p={p} projectId={projectId} bookId={bookId} node={node} book={book} onPrime={prime} />
        )}
        {node !== undefined && book !== undefined && tab === 'pages' && (
          <PagesTab p={p} projectId={projectId} bookId={bookId} bookTitle={book.title} node={node} onBind={() => { void p.bindTarget({ projectId, bookId }) }} />
        )}
        {node !== undefined && book !== undefined && tab === 'quiz' && (
          <QuizTab p={p} projectId={projectId} bookId={bookId} node={node} passRatio={loaded.data?.passRatio ?? 0.8} onPrime={focus => { prime(t(`prime.quiz.${focus}`, { book: book.title, node: node.title })) }} />
        )}
      </div>
    </>
  )
}

function GuideTab({ p, projectId, bookId, node, book, onPrime }: {
  p: ViewProps['p']; projectId: string; bookId: string; node: RoadmapNode; book: LibraryBook; onPrime: (text: string) => void
}): ReactNode {
  const { t, actions } = p
  const rows = rowsOf(node, book)
  const [error, setError] = useState<string | undefined>()
  return (
    <>
      {node.state === 'locked' && <div className={css.notice}>{t('node.locked')}</div>}
      {node.goals.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('node.goals')}</h3>
          <ul className={css.goals}>{node.goals.map(goal => <li key={goal}>{goal}</li>)}</ul>
        </section>
      )}
      {rows.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('node.covers')}</h3>
          <ul className={css.goals}>{rows.map(row => <li key={row}>{row}</li>)}</ul>
        </section>
      )}
      <div className={css.actions}>
        <button type="button" className={css.secondary} onClick={() => { onPrime(t('prime.node', { book: book.title, node: node.title })) }}>{t('action.askCoach')}</button>
        {node.kind === 'read' && node.state === 'current' && (
          <button
            type="button"
            className={css.primary}
            onClick={() => { void outcome(p.markNodeRead(projectId, bookId, node.id)).then(() => { actions.pop() }, (failure: unknown) => { setError(String(failure)) }) }}
          >{t('node.markRead')}</button>
        )}
      </div>
      {error !== undefined && <div className={css.error}>{error}</div>}
    </>
  )
}

function PagesTab({ p, projectId, bookId, bookTitle, node, onBind }: {
  p: ViewProps['p']; projectId: string; bookId: string; bookTitle: string; node: RoadmapNode; onBind: () => void
}): ReactNode {
  const { t, useStore, actions } = p
  const rev = useStore(s => s.rev)
  const [notice, setNotice] = useState<string | undefined>()
  // After a photo goes out, re-read every few seconds until the coach has
  // recorded a new page (or two minutes pass) — the page lands here by itself.
  const [watching, setWatching] = useState<{ since: number; pages: number } | undefined>()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (watching === undefined) return
    const timer = setInterval(() => {
      if (Date.now() - watching.since > 120_000) setWatching(undefined)
      else setTick(value => value + 1)
    }, 4000)
    return () => { clearInterval(timer) }
  }, [watching])
  const pages = useLoad(() => value(p.listPages(projectId, bookId, node.id)), [projectId, bookId, node.id, rev, tick])
  const cards = useLoad(() => value(p.listCards({ projectId, nodeId: node.id, limit: 50 })), [projectId, node.id, rev, tick])
  const count = pages.data?.pages.length ?? 0
  useEffect(() => {
    if (watching !== undefined && count > watching.pages) {
      setWatching(undefined)
      setNotice(t('node.photoRecorded'))
    }
  }, [count, watching])

  const send = (sent: boolean, ok: string): void => {
    setNotice(sent ? ok : t('notice.noConversation'))
  }

  const onPick = (file: File | undefined): void => {
    if (file === undefined) return
    onBind()
    const sent = p.sendPhoto(file, t('prime.photo', { book: bookTitle, node: node.title }))
    if (sent) setWatching({ since: Date.now(), pages: count })
    send(sent, t('node.photoSent'))
  }

  return (
    <>
      <StateLine loaded={pages} t={t} />
      {notice !== undefined && <div className={css.notice}>{notice}</div>}
      <div className={css.pages}>
        {(pages.data?.pages ?? []).map(page => <PageThumb key={page.id} p={p} projectId={projectId} page={page} />)}
        <label className={css.pageAdd}>
          <IconCameraOutlineMedium />
          <span>{watching === undefined ? t('node.photo') : t('node.photoWaiting')}</span>
          <input
            className={css.fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={event => { onPick(event.target.files?.[0]); event.target.value = '' }}
          />
        </label>
      </div>
      {(pages.data?.pages ?? []).map(page => (
        <PageFixes
          key={page.id}
          p={p}
          page={page}
          onSend={(text, ok) => { onBind(); send(p.sendMessage(text), ok) }}
        />
      ))}
      {(cards.data?.cards.length ?? 0) > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('node.cardsHere', { count: String(cards.data!.total) })}</h3>
          {cards.data!.cards.map(card => (
            <ListRow
              key={card.id}
              title={card.term}
              meta={shortGloss(card.gloss)}
              trailing={<WeaknessBars weakness={card.weakness} label={t('cards.weakness', { level: String(card.weakness) })} />}
              onSelect={() => { actions.push({ view: 'cards', projectId, filter: 'all' }) }}
            />
          ))}
        </section>
      )}
    </>
  )
}

/**
 * One page's corrections: the marks the coach was unsure of (tap to keep
 * one) and a word it missed (type it). Both go out as the learner's own
 * message, so the chat shows what was asked and the coach cards it in context.
 */
function PageFixes({ p, page, onSend }: { p: ViewProps['p']; page: LibraryPage; onSend: (text: string, ok: string) => void }): ReactNode {
  const { t } = p
  const [adding, setAdding] = useState(false)
  const [word, setWord] = useState('')
  const label = page.label ?? t('node.thisPage')
  const uncertain = page.marks.filter(mark => mark.uncertain === true)
  return (
    <section className={css.fixes}>
      <div className={css.fixesHead}>
        <span className={css.muted}>{label}</span>
        {!adding && <button type="button" className={css.textButton} onClick={() => { setAdding(true) }}>{t('node.addMissed')}</button>}
      </div>
      {uncertain.length > 0 && (
        <div className={css.chips}>
          <span className={css.muted}>{t('node.uncertain')}</span>
          {uncertain.map(mark => (
            <button
              key={mark.text}
              type="button"
              className={css.chipButton}
              onClick={() => { onSend(t('prime.keepMark', { page: label, word: mark.text }), t('node.fixSent')) }}
            >{mark.text}</button>
          ))}
        </div>
      )}
      {adding && (
        <form
          className={css.row}
          onSubmit={event => {
            event.preventDefault()
            if (word.trim() === '') return
            onSend(t('prime.addMissed', { page: label, word: word.trim() }), t('node.fixSent'))
            setWord('')
            setAdding(false)
          }}
        >
          <input className={css.input} autoFocus value={word} placeholder={t('node.addMissedPlaceholder')} onChange={event => { setWord(event.target.value) }} />
          <button type="submit" className={css.secondary} disabled={word.trim() === ''}>{t('node.send')}</button>
        </form>
      )}
    </section>
  )
}

/** A page thumbnail: the photo read back on demand, its label and mark count. */
function PageThumb({ p, projectId, page }: { p: ViewProps['p']; projectId: string; page: LibraryPage }): ReactNode {
  const { t } = p
  const photo = useLoad(() => outcome(p.readPagePhoto(projectId, page.id)), [projectId, page.id])
  return (
    <figure className={css.page}>
      {photo.data !== undefined
        ? <img className={css.pageImage} src={`data:${photo.data.mediaType};base64,${photo.data.data}`} alt={page.label ?? ''} />
        : <span className={css.pageImage} aria-hidden="true" />}
      <figcaption className={css.muted}>{t('node.pageCaption', { label: page.label ?? '', marks: String(page.marks.length) })}</figcaption>
    </figure>
  )
}

function QuizTab({ p, projectId, bookId, node, passRatio, onPrime }: {
  p: ViewProps['p']; projectId: string; bookId: string; node: RoadmapNode; passRatio: number; onPrime: (focus: LibraryQuizFocus) => void
}): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  const [focus, setFocus] = useState<LibraryQuizFocus>('mine')
  // After asking, re-read until the coach has stored the new quiz (two minutes at most).
  const [watching, setWatching] = useState<{ since: number; count: number } | undefined>()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (watching === undefined) return
    const timer = setInterval(() => {
      if (Date.now() - watching.since > 120_000) setWatching(undefined)
      else setTick(current => current + 1)
    }, 4000)
    return () => { clearInterval(timer) }
  }, [watching])
  const quizzes = useLoad(() => value(p.listQuizzes(projectId, bookId, node.id)), [projectId, bookId, node.id, rev, tick])
  const quizCount = quizzes.data?.quizzes.length ?? 0
  useEffect(() => {
    if (watching !== undefined && quizCount > watching.count) setWatching(undefined)
  }, [quizCount, watching])
  const mine = useLoad(() => value(p.listCards({ projectId, nodeId: node.id, limit: 5 })), [projectId, node.id, rev])
  const stats = node.quizStats
  const mineCount = mine.data?.total ?? 0
  return (
    <>
      {node.state === 'locked' && <div className={css.notice}>{t('node.locked')}</div>}
      <div className={css.muted}>
        {t('node.passRule', { percent: String(Math.round(passRatio * 100)) })}
        {stats !== undefined && stats.attempts > 0 && ` · ${t('node.best', { percent: String(Math.round((stats.bestRatio ?? 0) * 100)), attempts: String(stats.attempts) })}`}
      </div>
      <StateLine loaded={quizzes} t={t} />
      {(quizzes.data?.quizzes ?? []).slice().reverse().map(quiz => (
        <ListRow
          key={quiz.id}
          title={t('node.quizRow', { count: String(quiz.questions.length) })}
          meta={[t(`focus.${quiz.focus ?? 'mixed'}`), sourceMix(quiz.questions.map(question => question.evidence.kind), t)].join(' · ')}
          trailing={<span className={css.linkText}>{t('quiz.start')}</span>}
          onSelect={() => { actions.push({ view: 'quiz', projectId, bookId, quizId: quiz.id }) }}
        />
      ))}
      <section className={css.section}>
        <h3 className={css.sectionTitle}>{t('node.focusTitle')}</h3>
        <ChipRow
          label={t('node.focusTitle')}
          chips={FOCUSES.map(id => ({ id, label: t(`focus.${id}`), ...(id === 'mine' ? { count: mineCount } : {}) }))}
          value={focus}
          onSelect={setFocus}
        />
        <div className={css.muted}>
          {focus === 'mine'
            ? mineCount === 0 ? t('node.focusMineEmpty') : t('node.focusMineHint', { terms: (mine.data?.cards ?? []).map(card => card.term).join('、') })
            : t(`node.focusHint.${focus}`)}
        </div>
      </section>
      <div className={css.actions}>
        <button type="button" className={(quizzes.data?.quizzes.length ?? 0) === 0 ? css.primary : css.secondary} onClick={() => { onPrime(focus); setWatching({ since: Date.now(), count: quizCount }) }}>{watching === undefined ? t('node.askQuiz') : t('node.quizWaiting')}</button>
      </div>
    </>
  )
}

const FOCUSES: readonly LibraryQuizFocus[] = ['mine', 'book', 'mixed']

/** 「照片 3 · 领域知识 7」 for a quiz row. */
function sourceMix(kinds: readonly string[], t: ViewProps['p']['t']): string {
  const counts = new Map<string, number>()
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  return [...counts].map(([kind, count]) => `${t(kind === 'photo' ? 'evidence.photo' : kind === 'web' ? 'evidence.web' : 'evidence.knowledge')} ${count}`).join(' · ')
}

