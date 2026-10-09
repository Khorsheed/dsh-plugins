/**
 * The game tab body: the session's bound project in four views — 试玩 (the
 * deployed version), 策划 (the chaptered design doc, pillars first), 元素
 * (the element files as tables) and 检查 (the last end-of-turn check) — or,
 * with no project bound, the project list to pick from.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ListRow, PanelHeader, PanelRoot, UnderlineTabs, type PanelAction,
} from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import type { ChapterView, ElementView, PlayBundle, ProjectView, SessionGameState } from '../types.ts'
import type { GameTabProps } from './contract.ts'
import { Markdown } from './markdown.tsx'
import { PlayFrame, type PlayReport } from './PlayFrame.tsx'
import css from './GameTab.module.css'

type View = 'play' | 'design' | 'elements' | 'checks'

/** Small inline icons (currentColor). */
const RefreshIcon = <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 3v2.6h-2.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
const SwitchIcon = <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 5h9l-2-2M13 11H4l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
const CheckIcon = <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>

/** Format an ISO time as local `MM-DD HH:mm`. */
function shortTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** The game tab body. */
export function GameTab(props: GameTabProps): ReactNode {
  const { sessionId, t, fetchState, bind, fetchBundle, confirm, setAutoConfirm, logPlay, subscribeSessionEvents } = props
  const [state, setState] = useState<SessionGameState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rev, setRev] = useState(0)
  const [view, setView] = useState<View>('play')
  const [picking, setPicking] = useState(false)
  const refresh = useCallback(() => { setRev(n => n + 1) }, [])

  useEffect(() => subscribeSessionEvents(id => { if (id === sessionId) refresh() }), [subscribeSessionEvents, sessionId, refresh])

  useEffect(() => {
    let live = true
    void fetchState(sessionId).then(result => {
      if (!live) return
      if (result.ok) {
        setState(result.value)
        setError(null)
      } else setError(result.error.message)
    }).catch((e: unknown) => { if (live) setError(String(e)) })
    return () => { live = false }
  }, [fetchState, sessionId, rev])

  const project = state?.bound ?? null
  const choose = (projectId: string | null): void => {
    void bind(sessionId, projectId).then(() => { setPicking(false); refresh() })
  }

  if (state === null) {
    return <PanelRoot className={css.root}><div className={css.empty}>{error === null ? t('loading') : t('error', { error })}</div></PanelRoot>
  }

  if (project === null || picking) {
    return <PanelRoot className={css.root}>
      <PanelHeader title={state.projects.length === 0 ? t('empty.title') : t('pick.title')} moreLabel={t('more')}
        {...(picking ? { onBack: () => { setPicking(false) }, backLabel: t('design.back') } : {})}
        actions={[{ id: 'refresh', label: t('refresh'), icon: RefreshIcon, onSelect: refresh }]} />
      <div className={css.scroll}>
        <p className={css.lead}>{state.projects.length === 0 ? t('empty.hint') : t('pick.hint')}</p>
        {state.projects.map(p => <ListRow key={p.id} title={p.title} meta={p.root} selected={p.id === project?.id} onSelect={() => { choose(p.id) }} />)}
        {project !== null && <ListRow title={t('pick.unbind')} onSelect={() => { choose(null) }} />}
      </div>
    </PanelRoot>
  }

  const autoConfirm = project.manifest?.autoConfirm ?? true
  const actions: PanelAction[] = [
    { id: 'refresh', label: t('refresh'), icon: RefreshIcon, onSelect: refresh },
    { id: 'switch', label: t('switch'), icon: SwitchIcon, onSelect: () => { setPicking(true) } },
    {
      id: 'auto', label: autoConfirm ? t('autoConfirm.on') : t('autoConfirm.off'), icon: CheckIcon, pressed: autoConfirm, menuOnly: true,
      onSelect: () => { void setAutoConfirm(sessionId, project.id, !autoConfirm).then(refresh) },
    },
  ]
  const meta = project.current === null ? t('meta.noVersion') : t('meta.version', { version: project.current.version })
  const checkBadge = project.lastCheck !== null && !project.lastCheck.ok ? '!' : undefined

  return <PanelRoot className={css.root}>
    <PanelHeader title={project.title} meta={meta} actions={actions} moreLabel={t('more')} />
    <UnderlineTabs<View>
      label={t('tabs.label')}
      value={view}
      onChange={setView}
      tabs={[
        { id: 'play', label: t('tabs.play') },
        { id: 'design', label: t('tabs.design') },
        { id: 'elements', label: t('tabs.elements'), badge: project.elementErrors.length > 0 ? '!' : project.elements.length || undefined },
        { id: 'checks', label: t('tabs.checks'), badge: checkBadge },
      ]}
    />
    {view === 'play' && <PlayView {...props} project={project} onConfirmed={refresh}
      onReport={r => { void logPlay(sessionId, { projectId: project.id, ...r }) }} fetchBundle={fetchBundle} confirm={confirm} />}
    {view === 'design' && <DesignView t={t} chapters={project.chapters} />}
    {view === 'elements' && <ElementsView t={t} project={project} />}
    {view === 'checks' && <ChecksView t={t} project={project} />}
  </PanelRoot>
}

/** 试玩: the current version, plus the candidate banner when auto-confirm is off. */
function PlayView({ t, sessionId, project, fetchBundle, confirm, onConfirmed, onReport }: Pick<GameTabProps, 't' | 'sessionId' | 'fetchBundle' | 'confirm'> & {
  project: ProjectView
  onConfirmed: () => void
  onReport: (report: PlayReport) => void
}): ReactNode {
  const [bundle, setBundle] = useState<PlayBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const version = project.current?.version
  const loaded = useRef<string>('')

  useEffect(() => {
    if (version === undefined) { setBundle(null); return }
    const key = `${project.id}:${version}`
    if (loaded.current === key) return
    let live = true
    void fetchBundle(project.id, 'current').then(result => {
      if (!live) return
      if (result.ok && result.value.ok) {
        loaded.current = key
        setBundle(result.value.bundle)
        setError(null)
      } else setError(result.ok ? (result.value as { error: string }).error : result.error.message)
    })
    return () => { live = false }
  }, [fetchBundle, project.id, version])

  return <div className={css.body}>
    {project.candidate !== null && <div className={css.banner}>
      <span>{t('play.candidate', { version: project.candidate.version })}</span>
      <button type="button" className={css.primary} onClick={() => { void confirm(sessionId, project.id).then(onConfirmed) }}>{t('play.confirm')}</button>
    </div>}
    {error !== null && <p className={css.errorText}>{t('play.loadFailed', { error })}</p>}
    {version === undefined
      ? <p className={css.lead}>{project.hasEntry ? t('play.none') : `${t('play.noEntry')} ${t('play.none')}`}</p>
      : bundle !== null && <PlayFrame projectId={project.id} version={bundle.version} files={bundle.files} t={t} onReport={onReport} />}
  </div>
}

const STATUS_KEY = { todo: 'design.todo', draft: 'design.draft', done: 'design.done' } as const

/** 策划: chapter list → one chapter. */
function DesignView({ t, chapters }: Pick<GameTabProps, 't'> & { chapters: readonly ChapterView[] }): ReactNode {
  const [open, setOpen] = useState<string | null>(null)
  const chapter = chapters.find(c => c.id === open)
  if (chapter !== undefined) {
    return <div className={css.scroll}>
      <button type="button" className={css.link} onClick={() => { setOpen(null) }}>‹ {t('design.back')}</button>
      <p className={css.metaLine}>{chapter.generated ? t('design.generated') : `${t(STATUS_KEY[chapter.status])} · ${t('design.file', { file: chapter.file })}`}</p>
      {chapter.text === ''
        ? <p className={css.lead}>{chapter.generated ? t('design.emptyGenerated') : t('design.empty', { file: chapter.file })}</p>
        : <Markdown text={chapter.text} />}
    </div>
  }
  return <div className={css.scroll}>
    {chapters.map(c => <ListRow key={c.id} title={c.title} onSelect={() => { setOpen(c.id) }}
      meta={c.generated ? t('design.generated') : c.file}
      trailing={<span className={css.status} data-status={c.generated ? 'generated' : c.status}>{c.generated ? (c.text === '' ? t('design.todo') : t('design.generated')) : t(STATUS_KEY[c.status])}</span>} />)}
  </div>
}

/** 元素: one table per element type. */
function ElementsView({ t, project }: Pick<GameTabProps, 't'> & { project: ProjectView }): ReactNode {
  const types = [...new Set([...(project.manifest?.elementTypes ?? []), ...project.elements.map(e => e.type)])]
  const byType = (type: string): ElementView[] => project.elements.filter(e => e.type === type)
  return <div className={css.scroll}>
    {project.elementErrors.length > 0 && <div className={css.failBox}>
      <strong>{t('elements.errors', { count: project.elementErrors.length })}</strong>
      <ul className={css.mdList}>{project.elementErrors.map((f, i) => <li key={i}><code>{f.where}</code> {f.message}</li>)}</ul>
    </div>}
    {project.elements.length === 0 && <p className={css.lead}>{t('elements.empty')}</p>}
    {types.map(type => {
      const rows = byType(type)
      if (rows.length === 0) return null
      const keys = [...new Set(rows.flatMap(e => Object.keys(e.stats)))].slice(0, 6)
      return <section key={type} className={css.section}>
        <h4 className={css.mdH2}>{type} <span className={css.count}>{rows.length}</span></h4>
        <div className={css.mdTableWrap}><table className={css.mdTable}>
          <thead><tr><th>{t('elements.name')}</th>{keys.map(k => <th key={k}>{k}</th>)}</tr></thead>
          <tbody>{rows.map(e => <tr key={e.id} title={`${e.file} · ${e.id}`}><td>{e.name}</td>{keys.map(k => <td key={k}>{String(e.stats[k] ?? '')}</td>)}</tr>)}</tbody>
        </table></div>
      </section>
    })}
  </div>
}

/** 检查: the last check's verdict and findings. */
function ChecksView({ t, project }: Pick<GameTabProps, 't'> & { project: ProjectView }): ReactNode {
  const check = project.lastCheck
  if (check === null) return <div className={css.scroll}><p className={css.lead}>{t('checks.none')}</p></div>
  return <div className={css.scroll}>
    <div className={check.ok ? css.okBox : css.failBox}>
      <strong>{check.ok ? t('checks.ok') : t('checks.fail')}</strong>
      <span className={css.metaLine}>
        {t('checks.at', { time: shortTime(check.at) })}
        {check.attempt > 0 ? ` · ${t('checks.attempt', { attempt: check.attempt })}` : ''}
        {check.passed > 0 ? ` · ${t('checks.passed', { count: check.passed })}` : ''}
      </span>
      {check.gaveUp === true && <span>{t('checks.gaveUp')}</span>}
      {check.skipped !== undefined && <span className={css.metaLine}>{check.skipped}</span>}
    </div>
    {check.failures.length > 0 && <ul className={css.findings}>
      {check.failures.map((f, i) => <li key={i}><code>{f.where}</code><span>{f.message}</span></li>)}
    </ul>}
  </div>
}
