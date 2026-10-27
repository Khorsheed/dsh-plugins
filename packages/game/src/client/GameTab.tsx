/**
 * The game tab body — the game-design workbench beside the conversation.
 * With a project bound: a header (title, style, live version, the
 * auto-confirm switch), the commit bar while panel edits wait to become a
 * version, and four views — 试玩 (stage + parameter drawer),
 * 元素 (cards, look editor, proposals), 策划 (one-pager, pillars, chapters)
 * and 版本 (checks, timeline, log, export). Without one: how to start, the
 * style gallery, and the existing projects.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  PanelHeader, PanelRoot, UnderlineTabs, type PanelAction,
} from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import { Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { artStyleLabel, artStyleName } from '../project.ts'
import type { ProjectView, SessionGameState, WorkingChanges } from '../types.ts'
import { exportHtml } from '../vfs.ts'
import { failureOf, type GameTabProps, type NavTarget, type ViewProps } from './contract.ts'
import { DesignView } from './DesignView.tsx'
import { ElementsView } from './ElementsView.tsx'
import { PlayView } from './PlayView.tsx'
import { ProjectSwitcher } from './ProjectSwitcher.tsx'
import { StyleGallery } from './StyleGallery.tsx'
import { VersionsView } from './VersionsView.tsx'
import css from './GameTab.module.css'

type View = 'play' | 'elements' | 'design' | 'versions'

const RefreshIcon = <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 3v2.6h-2.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
const SwitchIcon = <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 5h9l-2-2M13 11H4l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
const PaletteIcon = <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.5a5.5 5.5 0 1 0 0 11c.8 0 1.2-.6 1-1.3-.3-.8.2-1.7 1.1-1.7h1.2a2.2 2.2 0 0 0 2.2-2.2C13.5 5 11 2.5 8 2.5Z" stroke="currentColor" strokeWidth="1.2" /><circle cx="5.5" cy="7" r=".9" fill="currentColor" /><circle cx="8" cy="5" r=".9" fill="currentColor" /><circle cx="10.6" cy="6.3" r=".9" fill="currentColor" /></svg>
const PlusIcon = <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
const ExportIcon = <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.5v7M5 6.5l3 3 3-3M3 11v2.5h10V11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>

/** The game tab body. */
export function GameTab(props: GameTabProps): ReactNode {
  const { sessionId, t, api, insertDraft, subscribeSessionEvents, touch, subscribeNav, takeNav, reveal } = props
  const [state, setState] = useState<SessionGameState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rev, setRev] = useState(0)
  const [view, setView] = useState<View>('play')
  const [picking, setPicking] = useState(false)
  const [styling, setStyling] = useState(false)
  const [openElement, setOpenElement] = useState<string | null>(null)
  const [toastText, setToastText] = useState<string | null>(null)
  const [openChapter, setOpenChapter] = useState<string | null>(null)
  useEffect(() => reveal.mount(), [reveal])
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  const refresh = useCallback(() => { touch(sessionId) }, [touch, sessionId])
  const toast = useCallback((text: string) => {
    setToastText(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => { setToastText(null) }, 2600)
  }, [])

  useEffect(() => subscribeSessionEvents(id => { if (id === sessionId) setRev(n => n + 1) }), [subscribeSessionEvents, sessionId])
  // Jumps from the turn card: follow them, including one made before this tab mounted.
  useEffect(() => {
    const go = (target: NavTarget): void => {
      setPicking(false)
      setStyling(false)
      setView(target.view)
      setOpenElement(target.elementId ?? null)
      setOpenChapter(target.chapterId ?? null)
      setRev(n => n + 1)
    }
    const parked = takeNav()
    if (parked !== null) go(parked)
    return subscribeNav(go)
  }, [subscribeNav, takeNav])
  useEffect(() => {
    let live = true
    void api.state(sessionId).then(result => {
      if (!live) return
      if (result.ok) { setState(result.value); setError(null) } else setError(result.error.message)
    }).catch((e: unknown) => { if (live) setError(String(e)) })
    return () => { live = false }
  }, [api, sessionId, rev])

  const viewProps: ViewProps = {
    t, sessionId, api, refresh, toast, insertDraft: text => insertDraft(sessionId, text), insertRef: ref => props.insertRef(sessionId, ref), reveal,
  }
  const project = state?.bound ?? null
  const choose = (projectId: string | null): void => {
    if (projectId !== null && projectId === project?.id) { setPicking(false); return }
    void api.bind(sessionId, projectId).then(() => {
      setPicking(false)
      setView('play')
      setOpenElement(null)
      if (projectId !== null) toast(t('toast.switched'))
      refresh()
    })
  }
  const startNew = (): void => {
    if (insertDraft(sessionId, project === null ? t('draft.start') : t('draft.newProject'))) toast(t('toast.newDrafted'))
  }
  const foot = toastText !== null && <div className={css.toast} role="status">{toastText}</div>

  if (state === null) {
    return <PanelRoot className={css.root}><div className={css.emptyCard}>{error === null ? t('loading') : t('error', { error })}</div></PanelRoot>
  }

  // A project's own state left over from before a switch is not this project's.
  if (project === null || picking) {
    return <PanelRoot className={css.root}>
      <PanelHeader title={project === null ? t('home.title') : t('pick.title')} moreLabel={t('more')}
        meta={project !== null ? t('pick.current', { title: project.title }) : undefined}
        {...(picking ? { onBack: () => { setPicking(false) }, backLabel: t('common.back') } : {})}
        actions={[{ id: 'refresh', label: t('refresh'), icon: RefreshIcon, onSelect: refresh }]} />
      <div className={css.scroll}>
        {project === null && <section className={css.hero}>
          <span className={css.eyebrow}>{t('home.eyebrow')}</span>
          <h3 className={css.heroTitle}>{t('home.headline')}</h3>
          <ol className={css.steps}>
            <li><strong>{t('home.step1')}</strong><span>{t('home.step1d')}</span></li>
            <li><strong>{t('home.step2')}</strong><span>{t('home.step2d')}</span></li>
            <li><strong>{t('home.step3')}</strong><span>{t('home.step3d')}</span></li>
          </ol>
          <button type="button" className={css.primary} onClick={startNew}>{t('home.start')}</button>
        </section>}
        {project === null && <section className={css.block}>
          <h4 className={css.blockTitle}>{t('style.galleryTitle')}</h4>
          <p className={css.metaLine}>{t('style.galleryHint')}</p>
          <StyleGallery t={t} onPick={(_id, label) => { if (insertDraft(sessionId, t('draft.pickStyle', { label }))) toast(t('toast.drafted')) }} />
        </section>}
        {(picking || state.projects.length > 0) && <section className={css.block}>
          <h4 className={css.blockTitle}>{picking ? t('pick.all', { count: state.projects.length }) : t('pick.existing')}</h4>
          <ProjectSwitcher {...viewProps} currentId={project?.id ?? null} rev={rev} onChoose={choose} onNew={startNew} />
          {project !== null && <button type="button" className={css.link} onClick={() => { choose(null) }}>{t('pick.unbind')}</button>}
        </section>}
      </div>
      {foot}
    </PanelRoot>
  }

  return <ProjectWorkbench {...viewProps} project={project} view={view} setView={v => { setView(v); if (v !== 'elements') setOpenElement(null); if (v !== 'design') setOpenChapter(null) }}
    openChapter={openChapter} setOpenChapter={setOpenChapter}
    styling={styling} setStyling={setStyling} openElement={openElement} setOpenElement={setOpenElement}
    onPickProject={() => { setPicking(true) }} foot={foot} />
}

/** The bound-project workbench. */
function ProjectWorkbench(p: ViewProps & {
  project: ProjectView
  view: View
  setView: (v: View) => void
  styling: boolean
  setStyling: (on: boolean) => void
  openElement: string | null
  setOpenElement: (id: string | null) => void
  onPickProject: () => void
  foot: ReactNode
  openChapter: string | null
  setOpenChapter: (id: string | null) => void
}): ReactNode {
  const { t, sessionId, api, project, view, setView, styling, setStyling, refresh, toast, insertDraft, reveal } = p
  const [, rerender] = useState(0)
  useEffect(() => reveal.subscribe(() => { rerender(n => n + 1) }), [reveal])
  const notice = reveal.notice
  const autoConfirm = project.manifest?.autoConfirm ?? true
  const style = project.manifest?.artStyle
  const exportCurrent = (): void => {
    if (project.current === null) { toast(t('versions.exportNone')); return }
    const version = project.current.version
    void api.versionBundle(project.id, version).then(r => {
      if (!(r.ok && r.value.ok)) return
      const url = URL.createObjectURL(new Blob([exportHtml(project.title, r.value.bundle.files)], { type: 'text/html' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${project.title}-v${version}.html`
      a.click()
      setTimeout(() => { URL.revokeObjectURL(url) }, 2000)
      toast(t('toast.exported', { version }))
    })
  }
  const actions: PanelAction[] = [
    { id: 'refresh', label: t('refresh'), icon: RefreshIcon, onSelect: refresh },
    { id: 'style', label: t('style.change'), icon: PaletteIcon, onSelect: () => { setStyling(!styling) }, pressed: styling },
    { id: 'export', label: t('versions.exportCurrent'), icon: ExportIcon, onSelect: exportCurrent, menuOnly: true },
    { id: 'switch', label: t('switch'), icon: SwitchIcon, onSelect: p.onPickProject, menuOnly: true },
    { id: 'new', label: t('switcher.new'), icon: PlusIcon, onSelect: () => { if (insertDraft(t('draft.newProject'))) toast(t('toast.newDrafted')) }, menuOnly: true },
  ]
  const failing = project.lastCheck !== null && !project.lastCheck.ok
  const openProposals = project.proposals.filter(x => x.picked === undefined).length

  // Any touch in the panel means the user is busy here: the agent's request waits as a notice.
  return <PanelRoot className={css.root} onPointerDownCapture={() => { reveal.touched() }} onKeyDownCapture={() => { reveal.touched() }}>
    <PanelHeader
      title={<button type="button" className={css.titleSwitch} onClick={p.onPickProject} title={t('switch')} aria-haspopup="dialog">
        <span>{project.title}</span><span className={css.titleCaret} aria-hidden="true">▾</span>
      </button>}
      meta={<span className={css.headMeta}>
        {style !== undefined && <span title={artStyleLabel(style)}><Tag tone="quiet">{artStyleName(style)}</Tag></span>}
        <Tag tone="quiet">{project.current === null ? t('meta.noVersion') : t('meta.version', { version: project.current.version })}</Tag>
      </span>}
      extra={<span className={css.switches}>
        <span className={css.switch} title={autoConfirm ? t('autoConfirm.onHint') : t('autoConfirm.offHint')}>
          <Switch checked={autoConfirm} label={t('autoConfirm.label')}
            onChange={next => { void api.setAutoConfirm(sessionId, project.id, next).then(() => { toast(next ? t('toast.autoOn') : t('toast.autoOff')); refresh() }) }} />
          <span className={css.switchLabel}>{t('autoConfirm.label')}</span>
        </span>
      </span>}
      actions={actions}
      moreLabel={t('more')}
    />
    <UnderlineTabs<View>
      label={t('tabs.label')}
      value={view}
      onChange={setView}
      tabs={[
        { id: 'play', label: t('tabs.play'), badge: project.candidate !== null ? '●' : undefined },
        { id: 'elements', label: t('tabs.elements'), badge: project.elementErrors.length > 0 ? '!' : openProposals > 0 ? '●' : project.elements.length || undefined },
        { id: 'design', label: t('tabs.design') },
        { id: 'versions', label: t('tabs.versions'), badge: failing ? '!' : undefined },
      ]}
    />
    {styling && <div className={css.overlay}>
      <div className={css.overlayHead}>
        <strong>{t('style.restyleTitle')}</strong>
        <span className={css.spacer} />
        <button type="button" className={css.ghost} onClick={() => { setStyling(false) }}>{t('common.close')}</button>
      </div>
      <p className={css.metaLine}>{t('style.restyleHint')}</p>
      <StyleGallery t={t} current={style} onPick={(id, label) => {
        if (id === style) return
        void api.requestRestyle(sessionId, project.id, id).then(() => {
          if (insertDraft(t('draft.restyle', { label }))) toast(t('toast.restyleDrafted'))
          setStyling(false)
          refresh()
        })
      }} />
    </div>}
    <CommitBar {...p} project={project} onOpenVersions={() => { setView('versions') }} />
    {notice !== null && <div className={css.navNotice} role="status">
      <span className={css.navNoticeText}>{notice.text}</span>
      <button type="button" className={css.primary} onClick={() => { reveal.follow() }}>{t('nav.go')}</button>
      <button type="button" className={css.link} onClick={() => { reveal.dismiss() }}>{t('nav.dismiss')}</button>
    </div>}
    {view === 'play' && <PlayView {...p}
      onOpenElement={id => { p.setOpenElement(id); setView('elements') }} onOpenVersions={() => { setView('versions') }} />}
    {view === 'elements' && <ElementsView {...p} openId={p.openElement} onOpen={p.setOpenElement} />}
    {view === 'design' && <DesignView {...p} openChapter={p.openChapter} onOpenChapter={p.setOpenChapter} onStyle={() => { setStyling(true) }} />}
    {view === 'versions' && <VersionsView {...p} />}
    {p.foot}
  </PanelRoot>
}

/**
 * 有新改动还没进游戏: whatever the working files hold that the play area
 * does not — panel edits, the agent's or a CLI member's writes, the user's
 * own editor — with 检查并发版 to cut a version through the same checks
 * (published by the user). It polls while the page is visible, which is how
 * a member's writes show up without a turn. While someone is still writing
 * (a turn runs, or a file changed in the last 20 s) the button is disabled.
 */
function CommitBar({ t, sessionId, api, project, refresh, toast, insertDraft, onOpenVersions }: ViewProps & {
  project: ProjectView
  onOpenVersions: () => void
}): ReactNode {
  const [changes, setChanges] = useState<WorkingChanges | null>(null)
  const [checking, setChecking] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    void api.changes(project.id).then(r => { if (live && r.ok && r.value.ok) setChanges(r.value) })
    return () => { live = false }
  }, [api, project, tick])
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') setTick(n => n + 1) }, POLL_MS)
    return () => { clearInterval(id) }
  }, [])
  // A 'recent' writer goes quiet on its own: look again right after.
  const lastAt = changes?.lastAt ?? null
  useEffect(() => {
    if (changes?.busy !== 'recent' || lastAt === null) return
    const timer = setTimeout(() => { setTick(n => n + 1) }, Math.max(500, Date.parse(lastAt) + QUIET_MS + 500 - Date.now()))
    return () => { clearTimeout(timer) }
  }, [changes?.busy, lastAt])
  useEffect(() => { setShowFiles(false) }, [project.id])

  if (changes === null || !changes.hasEntry || (changes.count === 0 && changes.edits.length === 0)) return null
  const commit = (): void => {
    setChecking(true)
    void api.commit(sessionId, project.id).then(r => {
      setChecking(false)
      const code = failureOf(r)
      if (code !== undefined || !r.ok || !r.value.ok) { toast(t('commit.error', { error: code ?? 'io' })); return }
      const result = r.value
      if (result.kind === 'deployed') toast(t('commit.deployed', { version: result.version }))
      else if (result.kind === 'candidate') toast(t('commit.candidate', { version: result.version }))
      else if (result.kind === 'unchanged') toast(t('commit.unchanged'))
      else if (result.kind === 'no-entry') toast(t('commit.noEntry'))
      setTick(n => n + 1)
      refresh()
    })
  }
  const live = changes.against
  const editList = changes.edits.slice(0, 3).map(e => e.text).join('、') + (changes.edits.length > 3 ? t('commit.more', { count: changes.edits.length - 3 }) : '')
  const summary = [
    changes.count > 0 ? (live === null ? t('commit.firstSummary', { count: changes.count }) : t('commit.summary', { count: changes.count, ago: agoText(t, changes.lastAt) })) : '',
    changes.edits.length > 0 ? t('commit.edits', { list: editList }) : '',
  ].filter(Boolean).join(' · ')
  const state = checking ? 'checking' : changes.busy !== null ? 'busy' : changes.failed !== null ? 'failed' : 'ready'
  const newest = changes.files.find(f => f.kind !== 'removed')?.path ?? changes.files[0]?.path ?? ''

  return <>
    <div className={css.commitBar} data-state={state} role="status">
      <span className={css.commitText}>
        <strong>{state === 'checking' ? t('commit.checking')
          : state === 'busy' ? t('commit.busyTitle')
          : state === 'failed' ? (live === null ? t('commit.failedFirst') : t('commit.failed', { version: live }))
          : live === null ? t('commit.titleFirst') : t('commit.title')}</strong>
        <span className={css.commitList}>{state === 'checking' ? t('commit.checkingSteps')
          : state === 'busy' ? (changes.busy === 'turn' ? t('commit.busyTurn') : t('commit.busyRecent', { ago: agoText(t, changes.lastAt), file: newest }))
          : state === 'failed' ? (changes.failed ?? []).slice(0, 2).map(f => `${f.where}：${f.message}`).join('；')
          : summary}</span>
      </span>
      <span className={css.commitActions}>
        {state === 'failed' && <>
          <button type="button" className={css.link} onClick={onOpenVersions}>{t('commit.details')}</button>
          <button type="button" className={css.ghost} onClick={() => {
            if (insertDraft(t('draft.commitFailed', { list: (changes.failed ?? []).map(f => `- ${f.where}：${f.message}`).join('\n') }))) toast(t('toast.drafted'))
          }}>{t('commit.toAgent')}</button>
        </>}
        {state !== 'checking' && changes.count > 0 && <button type="button" className={css.link} aria-expanded={showFiles} onClick={() => { setShowFiles(!showFiles) }}>
          {showFiles ? t('commit.hideFiles') : t('commit.showFiles')}
        </button>}
        <button type="button" className={css.primary} disabled={state === 'checking' || state === 'busy'} onClick={commit}>
          {state === 'failed' ? t('commit.retry') : t('commit.go')}
        </button>
      </span>
    </div>
    {showFiles && state !== 'checking' && <div className={css.commitFiles}>
      {changes.files.map(f => <div key={f.path}><span className={css.commitKind}>{f.kind === 'added' ? 'A' : f.kind === 'removed' ? 'D' : 'M'}</span>{f.path}</div>)}
      {changes.count > changes.files.length && <div>{t('commit.moreFiles', { count: changes.count - changes.files.length })}</div>}
    </div>}
  </>
}

/** How often the bar looks at the working files while the page is visible. */
const POLL_MS = 8_000
/** Matches the host's quiet window for a 'recent' writer (store BUSY_QUIET_MS). */
const QUIET_MS = 20_000

/** 「12 秒前」-style age of an ISO time. */
function agoText(t: ViewProps['t'], at: string | null): string {
  if (at === null) return ''
  const s = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 1000))
  if (s < 5) return t('ago.now')
  if (s < 60) return t('ago.s', { n: s })
  if (s < 3600) return t('ago.m', { n: Math.round(s / 60) })
  return t('ago.h', { n: Math.round(s / 3600) })
}
