/**
 * One station of a textbook's path: its four tabs — 导读 / 我的记录 (the
 * photographed pages) / 讲义 / 章节考 (views/station-quiz.tsx).
 *
 * @module @khorsheed/dsh-library/client/views/station
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { ListRow, PanelHeader, UnderlineTabs } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import { acceptanceLines, coverKind, isThickResource, type LibraryPage, type LibraryResource, type RoadmapNode } from '../../types.ts'
import { CoverChips, coverLabel, type CoverContext } from '../covers.tsx'
import type { LibraryNodeTab } from '../store.ts'
import { IconCameraOutlineMedium, IconSparkleOutlineMedium } from '../icons.tsx'
import { outcome, shortGloss, StateLine, useLoad, value, WeaknessBars, when, type ViewProps } from '../ui.tsx'
import css from '../LibraryPane.module.css'

/** The zigzag column (0..2) a node at `index` sits in. */
import { AcceptanceTab, QuizTab } from './station-quiz.tsx'
import { rowsOf } from './book.tsx'

/** One node: guide, photographed pages, its 讲义, and the gate tab 章节考 — on every kind of station. */
export function NodeView({ p, projectId, resourceId, nodeId, tab }: ViewProps & { projectId: string; resourceId: string; nodeId: string; tab: LibraryNodeTab }): ReactNode {
  const { t, actions, useStore } = p
  const rev = useStore(s => s.rev)
  const loaded = useLoad(async () => {
    const [detail, roadmaps] = await Promise.all([outcome(p.getProject(projectId)), value(p.getRoadmap(projectId, resourceId))])
    const resource = detail.resources.find(candidate => candidate.id === resourceId)
    const node = roadmaps.roadmap?.nodes.find(candidate => candidate.id === nodeId)
    return { resource, resources: detail.resources, project: detail.project, node, passRatio: roadmaps.roadmap?.passRatio ?? 0.8 }
  }, [projectId, resourceId, nodeId, rev])
  const [notice, setNotice] = useState<string | undefined>()
  const node = loaded.data?.node
  // The pages tab rides the station's own textbook, when the station covers it.
  const coversOwn = (node?.covers ?? []).some(cover => coverKind(cover) === 'resource' && cover.ref === resourceId)
  const resource = loaded.data?.resource

  const prime = (text: string): void => {
    void p.bindTarget({ projectId, resourceId })
    setNotice(p.primeConversation(text) ? t('notice.primed') : t('notice.noConversation'))
  }

  const tabs: { id: LibraryNodeTab; label: string }[] = [
    { id: 'guide', label: t('node.guide') },
    ...(coversOwn && resource !== undefined && isThickResource(resource) ? [{ id: 'pages' as const, label: t('node.pages') }] : []),
    { id: 'notes', label: t('node.notes') },
    // Every station ends in 章节考: a quiz / read station's papers, an
    // acceptance station's rubric sheet.
    { id: 'quiz', label: t('node.quiz') },
  ]
  const activeTab = tabs.some(candidate => candidate.id === tab) ? tab : 'guide'
  const coverContext: CoverContext = { resources: loaded.data?.resources ?? [] }

  return (
    <>
      <PanelHeader
        title={node?.title ?? ''}
        meta={resource?.title ?? loaded.data?.project.name}
        onBack={() => { actions.pop() }}
        backLabel={t('action.back')}
        actions={node === undefined ? [] : [
          { id: 'ask', label: t('action.askCoach'), icon: <IconSparkleOutlineMedium />, onSelect: () => { prime(t('prime.node', { book: resource?.title ?? '', node: node.title })) } },
        ]}
        moreLabel={t('action.more')}
      />
      {node !== undefined && (
        <div className={css.coversRow}>
          <CoverChips covers={node.covers} context={coverContext} t={t} />
        </div>
      )}
      <UnderlineTabs
        label={t('node.tabs')}
        tabs={tabs}
        value={activeTab}
        onChange={next => { actions.replace({ view: 'node', projectId, resourceId, nodeId, tab: next }) }}
      />
      <div className={css.body}>
        <StateLine loaded={loaded} t={t} />
        {notice !== undefined && <div className={css.notice}>{notice}</div>}
        {node !== undefined && activeTab === 'guide' && (
          <GuideTab p={p} projectId={projectId} resourceId={resourceId} node={node} resource={resource} coverContext={coverContext} onPrime={prime} />
        )}
        {node !== undefined && activeTab === 'pages' && resource !== undefined && (
          <PagesTab p={p} projectId={projectId} resourceId={resourceId} resourceTitle={resource.title} node={node} onBind={() => { void p.bindTarget({ projectId, resourceId }) }} />
        )}
        {node !== undefined && activeTab === 'notes' && (
          <NotesTab p={p} node={node} onPrime={prime} />
        )}
        {node !== undefined && activeTab === 'quiz' && node.gate === 'acceptance' && (
          <AcceptanceTab p={p} projectId={projectId} node={node} passRatio={loaded.data?.passRatio ?? 0.8} onPrime={() => { prime(t('prime.accept', { node: node.title, nodeId: node.id, criteria: acceptanceLines(node).map(line => `- ${line.id}: ${line.line}`).join('\n') })) }} />
        )}
        {node !== undefined && activeTab === 'quiz' && node.gate !== 'acceptance' && (
          <QuizTab
            p={p}
            projectId={projectId}
            resourceId={resourceId}
            node={node}
            passRatio={loaded.data?.passRatio ?? 0.8}
            onPrime={(focus, context) => {
              const base = t(`prime.quiz.${focus}`, { book: resource?.title ?? '', node: node.title })
              const weak = context?.weak ?? []
              const points = context?.points ?? []
              const kinds = context?.kinds ?? []
              prime(base
                + (weak.length > 0 ? t('prime.quiz.weakSuffix', { terms: weak.join('、') }) : '')
                + (points.length > 0 ? t('prime.quiz.pointsSuffix', { points: points.join('、') }) : '')
                + (kinds.length > 0 ? t('prime.quiz.kindsSuffix', { kinds: kinds.map(kind => t(`kind.${kind}`)).join('、') }) : '')
                + (context?.count !== undefined ? t('prime.quiz.countSuffix', { count: String(context.count) }) : ''))
            }}
            onReplace={prompts => { prime(t('prime.quiz.replace', { node: node.title, list: prompts.map(prompt => `- ${prompt}`).join('\n') })) }}
          />
        )}
      </div>
    </>
  )
}

function GuideTab({ p, projectId, resourceId, node, resource, coverContext, onPrime }: {
  p: ViewProps['p']; projectId: string; resourceId: string | undefined; node: RoadmapNode; resource: LibraryResource | undefined; coverContext: CoverContext; onPrime: (text: string) => void
}): ReactNode {
  const { t, actions } = p
  const rows = resource === undefined ? [] : rowsOf(node, resource)
  const [error, setError] = useState<string | undefined>()
  const [marking, setMarking] = useState(false)
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
      {resource === undefined && node.covers.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('node.covers')}</h3>
          <ul className={css.goals}>{node.covers.map((cover, at) => <li key={at}>{coverLabel(cover, coverContext, t)}</li>)}</ul>
        </section>
      )}
      <div className={css.actions}>
        <button type="button" className={css.secondary} onClick={() => { onPrime(t('prime.node', { book: resource?.title ?? '', node: node.title })) }}>{t('action.askCoach')}</button>
        {node.gate === 'read' && node.state === 'current' && (
          <button
            type="button"
            className={css.primary}
            disabled={marking}
            onClick={() => {
              setMarking(true)
              void outcome(p.markNodeRead(projectId, resourceId, node.id)).then(() => { actions.pop() }, (failure: unknown) => { setError(String(failure)); setMarking(false) })
            }}
          >{t('node.markRead')}</button>
        )}
      </div>
      {error !== undefined && <div className={css.error}>{error}</div>}
    </>
  )
}

function PagesTab({ p, projectId, resourceId, resourceTitle, node, onBind }: {
  p: ViewProps['p']; projectId: string; resourceId: string; resourceTitle: string; node: RoadmapNode; onBind: () => void
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
  const pages = useLoad(() => value(p.listPages(projectId, resourceId, node.id)), [projectId, resourceId, node.id, rev, tick])
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
    const sent = p.sendPhoto(file, t('prime.photo', { book: resourceTitle, node: node.title }))
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

/**
 * The station's 讲义 tab: the coach's distilled teaching on the node —
 * marginalia for a book station, the textbook itself for a 讲授 station.
 * The body renders through the host's MarkdownText (full GFM + KaTeX — the
 * same surface the conversation has).
 */
function NotesTab({ p, node, onPrime }: { p: ViewProps['p']; node: RoadmapNode; onPrime: (text: string) => void }): ReactNode {
  const { t } = p
  const notes = node.notes
  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])
  return (
    <>
      {node.state === 'locked' && <div className={css.notice}>{t('node.locked')}</div>}
      {notes === undefined ? (
        <div className={css.empty}>
          <div className={css.emptyTitle}>{t('node.notesEmptyTitle')}</div>
          <div className={css.muted}>{t('node.notesEmpty')}</div>
        </div>
      ) : (
        <section className={css.notesPaper}>
          <div className={css.notesMeta}>{t('node.notesMeta', { at: when(notes.updatedAt, t), n: String(notes.revisions) })}</div>
          <MarkdownText text={notes.text} labels={markdownLabels} />
        </section>
      )}
      <div className={css.actions}>
        <button type="button" className={css.secondary} onClick={() => { onPrime(t('prime.notes', { node: node.title, nodeId: node.id })) }}>{notes === undefined ? t('node.notesWrite') : t('node.notesAsk')}</button>
      </div>
    </>
  )
}
