/**
 * The library tab body: the right-Sidebar page. One React surface, four views
 * on a small store (see `client/store.ts`):
 *
 * - **the wall** (`projects`) — two-column project cards (letter avatar,
 *   progress bar, current book) plus the cross-project due-review section;
 * - **the project** — the drop zone (EPUB/Markdown ingestion happens HERE, in
 *   the browser: the host has no DOM parser), the book rows, and the
 *   roadmapped book's table of contents;
 * - **the book** — the roadmap as a left-rail timeline (done ✓ / current ▶ /
 *   locked 🔒), the re-split gesture (which primes the conversation — the
 *   coach does the splitting, never the pane), and the chapter list;
 * - **the vocab book** — entries with their Leitner boxes, the due mark, and
 *   each card's provenance.
 *
 * Quizzing itself is a conversation flow by design (v0.1): the pane shows the
 * state, the coach moves it.
 *
 * @module @khorsheed/dsh-library/client/LibraryPane
 */
import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import type { LibraryPaneProps } from './contract.ts'
import type { RoadmapNode } from '../types.ts'
import { parseEpub } from './ingest-epub.ts'
import { splitMarkdown } from './ingest-md.ts'
import {
  IconBookOutlineMedium,
  IconCameraOutlineMedium,
  IconCardsOutlineMedium,
  IconCheckOutlineMedium,
  IconChevronLeftOutlineMedium,
  IconLockOutlineMedium,
  IconPlayOutlineMedium,
  IconPlusOutlineMedium,
  IconRefreshOutlineMedium,
  IconSearchOutlineMedium,
  IconTrashOutlineMedium,
  IconUploadOutlineMedium,
} from './icons.tsx'
import css from './LibraryPane.module.css'

/** The ingest reads at most this many bytes (a textbook EPUB is a few MB). */
const MAX_INGEST_BYTES = 64 * 1024 * 1024

/** The letter a project card wears: its first character. */
function avatarLetter(name: string): string {
  return [...name][0]?.toUpperCase() ?? '·'
}

/** The wall-card hue: deterministic off the id, two tints is variety enough. */
function avatarTint(id: string): boolean {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return hash % 2 === 0
}

/** A roadmap's completion percentage (undefined without a roadmap). */
function roadmapPercent(roadmap: { done: number; total: number } | undefined): number | undefined {
  if (roadmap === undefined || roadmap.total === 0) return undefined
  return Math.round((roadmap.done / roadmap.total) * 100)
}

/** One node's chapter span, compacted for the timeline row (`3` / `4–5`). */
function chapterRangeOf(node: RoadmapNode): string {
  const from = Math.min(...node.chapterRanges.map(range => range.from))
  const to = Math.max(...node.chapterRanges.map(range => range.to))
  return from === to ? `${from}` : `${from}–${to}`
}

/** The library tab body. */
export function LibraryPane(props: LibraryPaneProps): ReactNode {
  const { useStore, actions, t } = props
  const view = useStore(s => s.view)
  const projects = useStore(s => s.projects)
  const due = useStore(s => s.due)
  const openProjectId = useStore(s => s.openProjectId)
  const detail = useStore(s => s.detail)
  const openBookId = useStore(s => s.openBookId)
  const vocab = useStore(s => s.vocab)
  const query = useStore(s => s.query)
  const ingest = useStore(s => s.ingest)
  const loading = useStore(s => s.loading)
  const error = useStore(s => s.error)
  const rev = useStore(s => s.rev)

  const [creating, setCreating] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [domainDraft, setDomainDraft] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [regenerated, setRegenerated] = useState(false)

  /* ------------------------------------------------------------- loading */

  // The wall reloads on mount and on refresh; the detail views reload when
  // their target moves. Every read re-asks the host — the store never
  // remembers what the host owns.
  useEffect(() => {
    let cancelled = false
    if (view === 'projects') {
      actions.setLoading(true)
      void Promise.all([props.listProjects(), props.dueVocab()]).then(([listed, dueResult]) => {
        if (cancelled) return
        if (!listed.ok) { actions.setError(listed.error.message); return }
        actions.setProjects(listed.value.projects, dueResult.ok ? dueResult.value.entries : [])
      })
      return () => { cancelled = true }
    }
    if ((view === 'project' || view === 'book') && openProjectId !== null) {
      actions.setLoading(true)
      void props.getProject(openProjectId).then(result => {
        if (cancelled) return
        if (!result.ok) { actions.setError(result.error.message); return }
        const outcome = result.value
        if (!outcome.ok) { actions.setError(outcome.message); return }
        actions.setDetail({
          project: outcome.project,
          books: outcome.books,
          ...(outcome.roadmap === undefined ? {} : { roadmap: outcome.roadmap }),
          vocabCount: outcome.vocabCount,
          dueCount: outcome.dueCount,
        })
      })
      return () => { cancelled = true }
    }
    if (view === 'vocab' && openProjectId !== null) {
      actions.setLoading(true)
      void props.listVocab(openProjectId).then(result => {
        if (cancelled) return
        if (!result.ok) { actions.setError(result.error.message); return }
        actions.setVocab(result.value.entries)
      })
      return () => { cancelled = true }
    }
    return undefined
  }, [view, openProjectId, rev, actions, props.listProjects, props.dueVocab, props.getProject, props.listVocab])

  /* ------------------------------------------------------------- gestures */

  const refresh = useCallback(() => { actions.refresh() }, [actions])

  const submitProject = useCallback(() => {
    const name = nameDraft.trim()
    if (name === '') return
    void props.createProject(name, domainDraft.trim() === '' ? undefined : domainDraft.trim()).then(result => {
      if (!result.ok) { actions.setError(result.error.message); return }
      if (!result.value.ok) { actions.setError(result.value.message); return }
      setCreating(false)
      setNameDraft('')
      setDomainDraft('')
      actions.openProject(result.value.project.id)
    })
  }, [nameDraft, domainDraft, props, actions])

  const removeProject = useCallback((id: string) => {
    // Two-step confirm: the first click arms, the second within the same open
    // detail view deletes (a dialog the embedded webview may suppress is not a
    // confirm at all).
    if (confirmingDelete !== id) { setConfirmingDelete(id); return }
    void props.deleteProject(id).then(result => {
      setConfirmingDelete(null)
      if (!result.ok) { actions.setError(result.error.message); return }
      if (!result.value.ok) { actions.setError(result.value.message); return }
      actions.backToProjects()
      actions.refresh()
    })
  }, [confirmingDelete, props, actions])

  const ingestFiles = useCallback(async (files: readonly File[]) => {
    const projectId = openProjectId
    if (projectId === null) return
    for (const file of files) {
      actions.setIngest({ state: 'working', name: file.name })
      const isEpub = /\.epub$/i.test(file.name)
      const isMarkdown = /\.(md|markdown|txt)$/i.test(file.name)
      if (!isEpub && !isMarkdown) {
        actions.setIngest({ state: 'failed', reason: t('ingest.failed', { reason: file.name }) })
        continue
      }
      if (file.size > MAX_INGEST_BYTES) {
        actions.setIngest({ state: 'failed', reason: t('ingest.tooLarge', { size: Math.round(file.size / 1024 / 1024) }) })
        continue
      }
      try {
        if (isEpub) {
          const parsed = parseEpub(new Uint8Array(await file.arrayBuffer()))
          if (!parsed.ok) {
            const reason = parsed.error === 'not-zip' ? t('ingest.notZip')
              : parsed.error === 'not-epub' ? t('ingest.notEpub')
              : parsed.error === 'encrypted' ? t('ingest.encrypted')
              : parsed.error === 'no-spine' ? t('ingest.noSpine')
              : t('ingest.noChapters')
            actions.setIngest({ state: 'failed', reason })
            continue
          }
          const stored = await props.storeBook({
            projectId,
            title: parsed.title,
            source: { kind: 'upload', ref: file.name },
            format: 'epub',
            chapters: parsed.chapters,
          })
          if (!stored.ok) { actions.setIngest({ state: 'failed', reason: stored.error.message }); continue }
          if (!stored.value.ok) { actions.setIngest({ state: 'failed', reason: stored.value.message }); continue }
          actions.setIngest({ state: 'done', title: parsed.title, chapters: parsed.chapters.length })
        } else {
          const text = await file.text()
          const split = splitMarkdown(text)
          if (!split.ok) { actions.setIngest({ state: 'failed', reason: t('ingest.empty') }); continue }
          const title = file.name.replace(/\.(md|markdown|txt)$/i, '')
          const stored = await props.storeBook({
            projectId,
            title,
            source: { kind: 'upload', ref: file.name },
            format: 'md',
            chapters: split.chapters.map(chapter => ({ title: chapter.title, html: chapter.html })),
          })
          if (!stored.ok) { actions.setIngest({ state: 'failed', reason: stored.error.message }); continue }
          if (!stored.value.ok) { actions.setIngest({ state: 'failed', reason: stored.value.message }); continue }
          actions.setIngest({ state: 'done', title, chapters: split.chapters.length })
        }
        actions.refresh()
      } catch (ingestError) {
        actions.setIngest({ state: 'failed', reason: ingestError instanceof Error ? ingestError.message : String(ingestError) })
      }
    }
  }, [openProjectId, actions, props, t])

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault()
    void ingestFiles([...event.dataTransfer.files])
  }, [ingestFiles])

  const regenerate = useCallback(() => {
    if (detail === null || openBookId === null) return
    const book = detail.books.find(candidate => candidate.id === openBookId)
    if (book === undefined) return
    const ok = props.primeConversation(
      `请重新拆《${book.title}》生成学习路线图：先 library_read · toc 读目录，再 library_write · roadmap 落盘（已有旧路线图，需要 regenerate）。`,
    )
    if (ok) setRegenerated(true)
  }, [detail, openBookId, props])

  /* --------------------------------------------------------------- views */

  const header = (title: string, meta: string, back: (() => void) | null, tools: ReactNode): ReactNode => (
    <div className={css.head}>
      {back !== null && (
        <button type="button" className={css.tool} title={t('project.back')} onClick={back}>
          <IconChevronLeftOutlineMedium size={14} />
        </button>
      )}
      <span className={css.lav}><IconBookOutlineMedium size={16} /></span>
      <div className={css.headText}>
        <div className={css.headTitle}>{title}</div>
        <div className={css.headMeta}>{meta}</div>
      </div>
      {tools}
    </div>
  )

  const wallMeta = useMemo(() => {
    const books = projects.reduce((sum, project) => sum + project.books.length, 0)
    const cards = projects.reduce((sum, project) => sum + project.vocabCount, 0)
    return t('wall.meta', { projects: projects.length, books, vocab: cards })
  }, [projects, t])

  const renderWall = (): ReactNode => (
    <>
      {header(t('wall.title'), wallMeta, null, (
        <button type="button" className={css.tool} title={t('action.refresh')} onClick={refresh}>
          <IconRefreshOutlineMedium size={14} />
        </button>
      ))}
      <div className={css.body}>
        {error !== null && <div className={css.error}>{t('state.error', { reason: error })}</div>}
        {projects.length === 0 && !loading && (
          <div className={css.state}>
            <div className={css.stateTitle}>{t('state.emptyProjectsTitle')}</div>
            <div>{t('state.emptyProjectsBody')}</div>
          </div>
        )}
        <div className={css.grid}>
          {projects.map(project => {
            const percent = roadmapPercent(project.roadmap)
            return (
              <button type="button" key={project.id} className={css.card} onClick={() => actions.openProject(project.id)}>
                <div className={css.cardHead}>
                  <span className={`${css.avatar} ${avatarTint(project.id) ? '' : css.avatarGreen}`}>{avatarLetter(project.name)}</span>
                  <span className={css.cardName}>{project.name}</span>
                  <span className={css.cardChevron}>›</span>
                </div>
                <div className={css.cardMeta}>
                  {t('wall.cardMeta', { books: project.books.length, vocab: project.vocabCount })}
                  {project.dueCount > 0 ? ` · ${t('wall.cardDue', { count: project.dueCount })}` : ''}
                </div>
                {percent !== undefined && (
                  <>
                    <div className={css.progress}><i className={css.progressFill} style={{ width: `${percent}%` }} /></div>
                    <div className={css.cardFoot}>
                      {t('wall.progress', { percent })}
                      {project.current !== undefined ? ` · ${t('wall.currentAt', { book: project.current.bookTitle, node: project.current.nodeTitle })}` : ''}
                    </div>
                  </>
                )}
              </button>
            )
          })}
          <button type="button" className={`${css.card} ${css.cardNew}`} onClick={() => setCreating(true)}>
            <IconPlusOutlineMedium size={14} />
            {t('wall.newProject')}
          </button>
        </div>
        {creating && (
          <div className={css.form}>
            <div className={css.formTitle}>{t('newProject.title')}</div>
            <input
              className={css.input}
              value={nameDraft}
              placeholder={t('newProject.namePlaceholder')}
              onChange={event => setNameDraft(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') submitProject() }}
            />
            <input
              className={css.input}
              value={domainDraft}
              placeholder={t('newProject.domainPlaceholder')}
              onChange={event => setDomainDraft(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') submitProject() }}
            />
            <div className={css.formRow}>
              <button type="button" className={css.button} onClick={() => setCreating(false)}>{t('action.cancel')}</button>
              <button type="button" className={`${css.button} ${css.buttonPrimary}`} onClick={submitProject}>{t('action.submit')}</button>
            </div>
          </div>
        )}
        {due.length > 0 && (
          <>
            <div className={css.section}>{t('wall.dueSection', { count: due.length })}</div>
            <div className={css.rows}>
              {due.slice(0, 8).map(entry => (
                <div key={entry.id} className={css.row}>
                  <span className={css.rowMain}>
                    <span className={css.rowTitle}>{entry.term}</span>
                    <span className={css.rowSub}>{entry.note}</span>
                  </span>
                  <span className={css.due}>{t('wall.dueBadge')}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )

  const renderProject = (): ReactNode => {
    if (detail === null) return <div className={css.state}>{t('state.loading')}</div>
    const roadmapped = detail.roadmap === undefined ? undefined : detail.books.find(book => book.id === detail.roadmap?.bookId)
    return (
      <>
        {header(
          detail.project.name,
          t('project.meta', { books: detail.books.length, vocab: detail.vocabCount }),
          () => actions.backToProjects(),
          <>
            <button type="button" className={css.tool} title={t('vocab.title', { project: detail.project.name })} onClick={() => actions.openVocab(detail.project.id)}>
              <IconCardsOutlineMedium size={14} />
            </button>
            <button
              type="button"
              className={`${css.tool} ${css.toolDanger}`}
              title={confirmingDelete === detail.project.id ? t('project.deleteConfirm', { name: detail.project.name }) : t('project.deleteTitle')}
              onClick={() => removeProject(detail.project.id)}
            >
              <IconTrashOutlineMedium size={14} />
            </button>
          </>,
        )}
        <div className={css.body}>
          {error !== null && <div className={css.error}>{t('state.error', { reason: error })}</div>}
          <label
            className={css.drop}
            onDragOver={event => event.preventDefault()}
            onDrop={onDrop}
          >
            <input
              type="file"
              accept=".epub,.md,.markdown,.txt"
              multiple
              style={{ display: 'none' }}
              onChange={event => {
                void ingestFiles([...event.target.files ?? []])
                event.target.value = ''
              }}
            />
            <IconUploadOutlineMedium size={16} />
            <div>{t('project.drop')}</div>
            <div className={css.dropHint}>{t('project.dropHint')}</div>
          </label>
          {ingest.state === 'working' && <div className={css.notice}>{t('project.ingesting', { name: ingest.name })}</div>}
          {ingest.state === 'failed' && <div className={css.error}>{ingest.reason}</div>}
          {ingest.state === 'done' && <div className={`${css.notice} ${css.noticeOk}`}>{t('ingest.done', { title: ingest.title, count: ingest.chapters })}</div>}
          <div className={css.section}>{t('project.booksSection', { count: detail.books.length })}</div>
          <div className={css.rows}>
            {detail.books.map(book => (
              <button type="button" key={book.id} className={css.rowButton} onClick={() => actions.openBook(book.id)}>
                <span className={css.thumb}><IconBookOutlineMedium size={12} /></span>
                <span className={css.rowMain}>
                  <span className={css.rowTitle}>{book.title}</span>
                </span>
                <span className={css.rowMeta}>{t('project.bookMeta', { format: book.format.toUpperCase(), chapters: book.toc.length })}</span>
              </button>
            ))}
            {detail.books.length === 0 && <div className={css.row}>{t('project.noBooks')}</div>}
          </div>
          {roadmapped !== undefined && (
            <>
              <div className={css.section}>{t('project.tocSection', { title: roadmapped.title })}</div>
              <div className={css.rows}>
                {roadmapped.toc.map(entry => (
                  <button type="button" key={entry.n} className={css.rowButton} onClick={() => actions.openBook(roadmapped.id)}>
                    <span className={css.rowMeta} style={{ width: 18 }}>{entry.n}</span>
                    <span className={css.rowMain}><span className={css.rowTitle}>{entry.title}</span></span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </>
    )
  }

  const renderBook = (): ReactNode => {
    if (detail === null) return <div className={css.state}>{t('state.loading')}</div>
    const book = detail.books.find(candidate => candidate.id === openBookId)
    if (book === undefined) return <div className={css.state}>{t('state.error', { reason: openBookId ?? '' })}</div>
    const roadmap = detail.roadmap?.bookId === book.id ? detail.roadmap : undefined
    const done = roadmap?.nodes.filter(node => node.state === 'done').length ?? 0
    const nodeOfChapter = new Map<number, RoadmapNode>()
    for (const node of roadmap?.nodes ?? []) {
      for (const range of node.chapterRanges) {
        for (let n = range.from; n <= range.to; n++) nodeOfChapter.set(n, node)
      }
    }
    return (
      <>
        {header(
          book.title,
          t('book.meta', {
            chapters: book.toc.length,
            nodes: roadmap?.nodes.length ?? 0,
            percent: roadmapPercent(roadmap === undefined ? undefined : { done, total: roadmap.nodes.length }) ?? 0,
          }),
          () => actions.backToProject(),
          <button
            type="button"
            className={css.tool}
            title={t('book.regenerateTitle')}
            aria-label={t('book.regenerate')}
            onClick={regenerate}
          >
            <IconRefreshOutlineMedium size={14} />
          </button>,
        )}
        <div className={css.body}>
          {regenerated && <div className={`${css.notice} ${css.noticeOk}`}>{t('book.regenerateDone')}</div>}
          {roadmap === undefined && <div className={css.notice}>{t('book.noRoadmap')}</div>}
          {roadmap !== undefined && (
            <>
              <div className={css.section}>{t('book.roadmapSection', { done, total: roadmap.nodes.length })}</div>
              <div className={css.roadmap}>
                {roadmap.nodes.map(node => (
                  <div
                    key={node.id}
                    className={`${css.node} ${node.state === 'done' ? css.nodeDone : node.state === 'current' ? css.nodeCurrent : css.nodeLocked}`}
                  >
                    <span className={css.nodeState}>
                      {node.state === 'done'
                        ? <IconCheckOutlineMedium size={11} />
                        : node.state === 'current'
                          ? <IconPlayOutlineMedium size={11} />
                          : <IconLockOutlineMedium size={11} />}
                    </span>
                    <div className={css.nodeBody}>
                      <div className={css.nodeTitle}>
                        {node.title}
                        {node.state === 'done' && node.quizStats?.bestRatio !== undefined && (
                          <span className={`${css.tag} ${css.tagGreen}`}>{t('book.score', { score: Math.round(node.quizStats.bestRatio * 100) })}</span>
                        )}
                        {node.state === 'done' && node.quizStats?.bestRatio === undefined && (
                          <span className={`${css.tag} ${css.tagGreen}`}>{t('book.stateDone')}</span>
                        )}
                        {node.state === 'current' && <span className={`${css.tag} ${css.tagBlue}`}>{t('book.stateCurrent')}</span>}
                        {node.state === 'locked' && <span className={css.tag}>{t('book.stateLocked')}</span>}
                      </div>
                      <div className={css.nodeDetail}>
                        {node.chapterRanges.length > 0 ? `${t('book.nodeChapters', { range: chapterRangeOf(node) })} · ` : ''}
                        {t('book.nodeGoals', { count: node.goals.length })}
                        {node.state === 'locked' ? ` · ${t('book.unlockRule', { percent: Math.round((roadmap.passRatio ?? 0.8) * 100) })}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className={css.section}>{t('project.tocSection', { title: book.title })}</div>
              <div className={css.rows}>
                {book.toc.map(entry => {
                  const node = nodeOfChapter.get(entry.n)
                  return (
                    <div key={entry.n} className={css.row}>
                      <span className={css.rowMeta} style={{ width: 18 }}>{entry.n}</span>
                      <span className={css.rowMain}><span className={css.rowTitle}>{entry.title}</span></span>
                      {node !== undefined && (
                        <span className={`${css.tag} ${node.state === 'done' ? css.tagGreen : node.state === 'current' ? css.tagBlue : ''}`}>
                          {node.title}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </>
    )
  }

  const renderVocab = (): ReactNode => {
    if (detail === null && loading) return <div className={css.state}>{t('state.loading')}</div>
    const projectName = projects.find(project => project.id === openProjectId)?.name ?? ''
    const now = new Date().toISOString()
    const filtered = vocab.filter(entry => {
      if (query.trim() === '') return true
      const haystack = `${entry.term}\n${entry.note}\n${entry.context ?? ''}`.toLowerCase()
      return haystack.includes(query.trim().toLowerCase())
    })
    return (
      <>
        {header(
          t('vocab.title', { project: projectName }),
          t('vocab.meta', { count: vocab.length, due: vocab.filter(entry => entry.mastery.dueAt <= now).length }),
          () => { if (openProjectId !== null) actions.openProject(openProjectId) },
          null,
        )}
        <div className={css.body}>
          <div className={css.search}>
            <IconSearchOutlineMedium size={13} />
            <input value={query} placeholder={t('vocab.search')} onChange={event => actions.setQuery(event.target.value)} />
          </div>
          {filtered.length === 0 && <div className={css.state}>{t('vocab.empty')}</div>}
          {filtered.length > 0 && (
            <div className={css.rows}>
              {[...filtered].reverse().map(entry => (
                <div key={entry.id} className={css.row}>
                  <span className={css.rowMain}>
                    <span className={css.rowTitle}>
                      {entry.term}
                      {entry.kind === 'keypoint' ? <span className={css.tag} style={{ marginLeft: 6 }}>{t('vocab.keypoint')}</span> : null}
                    </span>
                    <span className={css.rowSub}>{entry.note}</span>
                  </span>
                  <span className={css.boxes} title={t('vocab.box', { box: entry.mastery.box })}>
                    {[0, 1, 2, 3, 4].map(box => (
                      <i key={box} className={`${css.box} ${entry.mastery.box > box ? css.boxFull : ''}`} />
                    ))}
                  </span>
                  {entry.mastery.dueAt <= now && <span className={css.due}>{t('vocab.due')}</span>}
                  <span className={css.rowMeta}>
                    {entry.source.kind === 'photo' && <span title={t('vocab.photo')}><IconCameraOutlineMedium size={10} /></span>}
                    {' '}{entry.chapterRef}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </>
    )
  }

  return (
    <div className={css.root}>
      {view === 'projects' && renderWall()}
      {view === 'project' && renderProject()}
      {view === 'book' && renderBook()}
      {view === 'vocab' && renderVocab()}
    </div>
  )
}
