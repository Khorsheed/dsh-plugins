/**
 * The game tab body — the game-design workbench beside the conversation.
 * With a project bound: a header (title, style, live version, the
 * auto-confirm switch) over four views — 试玩 (stage + parameter drawer),
 * 元素 (cards, look editor, proposals), 策划 (one-pager, pillars, chapters)
 * and 版本 (checks, timeline, log, export). Without one: how to start, the
 * style gallery, and the existing projects.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  PanelHeader, PanelRoot, UnderlineTabs, type PanelAction,
} from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import { Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { artStyleLabel } from '../project.ts'
import { PANEL_CHANGES_MARK } from '../types.ts'
import type { ProjectView, SessionGameState } from '../types.ts'
import { exportHtml } from '../vfs.ts'
import type { GameTabProps, NavTarget, ViewProps } from './contract.ts'
import { DesignView } from './DesignView.tsx'
import { ElementsView } from './ElementsView.tsx'
import { PlayView } from './PlayView.tsx'
import { ProjectSwitcher } from './ProjectSwitcher.tsx'
import { StyleGallery } from './StyleGallery.tsx'
import { VersionsView } from './VersionsView.tsx'
import css from './GameTab.module.css'

type View = 'play' | 'elements' | 'design' | 'versions'

/** Per-viewer: offer to tell the agent after a change (default on). */
const ASK_KEY = 'dsh-game:ask-send'
function readAsk(): boolean {
  try {
    return localStorage.getItem(ASK_KEY) !== 'off'
  } catch {
    return true
  }
}
function writeAsk(on: boolean): void {
  try {
    localStorage.setItem(ASK_KEY, on ? 'on' : 'off')
  } catch {
    // Per-viewer convenience only.
  }
}

const RefreshIcon = <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 3v2.6h-2.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
const SwitchIcon = <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 5h9l-2-2M13 11H4l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
const PaletteIcon = <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.5a5.5 5.5 0 1 0 0 11c.8 0 1.2-.6 1-1.3-.3-.8.2-1.7 1.1-1.7h1.2a2.2 2.2 0 0 0 2.2-2.2C13.5 5 11 2.5 8 2.5Z" stroke="currentColor" strokeWidth="1.2" /><circle cx="5.5" cy="7" r=".9" fill="currentColor" /><circle cx="8" cy="5" r=".9" fill="currentColor" /><circle cx="10.6" cy="6.3" r=".9" fill="currentColor" /></svg>
const PlusIcon = <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
const AskIcon = <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4.5h10v6H7l-3 2.5v-2.5H3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
const ExportIcon = <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.5v7M5 6.5l3 3 3-3M3 11v2.5h10V11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>

/** The game tab body. */
export function GameTab(props: GameTabProps): ReactNode {
  const { sessionId, t, api, insertDraft, subscribeSessionEvents, touch, subscribeNav, takeNav } = props
  const [state, setState] = useState<SessionGameState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rev, setRev] = useState(0)
  const [view, setView] = useState<View>('play')
  const [picking, setPicking] = useState(false)
  const [styling, setStyling] = useState(false)
  const [openElement, setOpenElement] = useState<string | null>(null)
  const [liveElement, setLiveElement] = useState<Record<string, unknown> | null>(null)
  const [toastText, setToastText] = useState<string | null>(null)
  const [openChapter, setOpenChapter] = useState<string | null>(null)
  const [nudge, setNudge] = useState<{ key: string; title: string } | null>(null)
  const [ask, setAsk] = useState(readAsk)
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
    t, sessionId, api, refresh, toast, insertDraft: text => insertDraft(sessionId, text),
    changed: (key, title) => { if (ask) setNudge({ key, title }) },
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

  const nudgeItem = nudge === null ? undefined : project.pending.find(x => x.key === nudge.key)
  const nudgeBar = nudge !== null && nudgeItem !== undefined && <div className={css.nudge} role="status">
    <span className={css.nudgeText}><strong>{nudge.title}</strong>{t('nudge.ask')}</span>
    <span className={css.nudgeActions}>
      <button type="button" className={css.primary} onClick={() => {
        if (insertDraft(sessionId, [`${PANEL_CHANGES_MARK}${t('dock.draftLead')}`, `- ${nudgeItem.text}`, '', ''].join('\n'))) toast(t('nudge.written'))
        setNudge(null)
      }}>{t('nudge.write')}</button>
      <button type="button" className={css.ghost} onClick={() => {
        void api.dropPending(sessionId, project.id, nudge.key).then(refresh)
        setNudge(null)
      }}>{t('nudge.skip')}</button>
      <button type="button" className={css.link} onClick={() => { setNudge(null) }}>{t('nudge.later')}</button>
    </span>
    <button type="button" className={css.nudgeOff} onClick={() => { writeAsk(false); setAsk(false); setNudge(null); toast(t('nudge.offToast')) }}>{t('nudge.off')}</button>
  </div>

  return <ProjectWorkbench {...viewProps} project={project} view={view} setView={v => { setView(v); if (v !== 'elements') setOpenElement(null); if (v !== 'design') setOpenChapter(null) }}
    nudgeBar={nudgeBar} openChapter={openChapter} setOpenChapter={setOpenChapter}
    ask={ask} toggleAsk={() => { writeAsk(!ask); setAsk(!ask); toast(ask ? t('nudge.offToast') : t('nudge.onToast')) }}
    styling={styling} setStyling={setStyling} openElement={openElement} setOpenElement={setOpenElement}
    liveElement={liveElement} setLiveElement={setLiveElement} onPickProject={() => { setPicking(true) }} foot={foot} />
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
  liveElement: Record<string, unknown> | null
  setLiveElement: (el: Record<string, unknown>) => void
  onPickProject: () => void
  foot: ReactNode
  nudgeBar: ReactNode
  openChapter: string | null
  setOpenChapter: (id: string | null) => void
  ask: boolean
  toggleAsk: () => void
}): ReactNode {
  const { t, sessionId, api, project, view, setView, styling, setStyling, refresh, toast, insertDraft } = p
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
    { id: 'ask', label: p.ask ? t('nudge.menuOn') : t('nudge.menuOff'), icon: AskIcon, onSelect: p.toggleAsk, menuOnly: true, pressed: p.ask },
    { id: 'new', label: t('switcher.new'), icon: PlusIcon, onSelect: () => { if (insertDraft(t('draft.newProject'))) toast(t('toast.newDrafted')) }, menuOnly: true },
  ]
  const failing = project.lastCheck !== null && !project.lastCheck.ok
  const openProposals = project.proposals.filter(x => x.picked === undefined).length

  return <PanelRoot className={css.root}>
    <PanelHeader
      title={<button type="button" className={css.titleSwitch} onClick={p.onPickProject} title={t('switch')} aria-haspopup="dialog">
        <span>{project.title}</span><span className={css.titleCaret} aria-hidden="true">▾</span>
      </button>}
      meta={<span className={css.headMeta}>
        {style !== undefined && <Tag tone="quiet">{artStyleLabel(style)}</Tag>}
        <Tag tone="quiet">{project.current === null ? t('meta.noVersion') : t('meta.version', { version: project.current.version })}</Tag>
        {project.pending.length > 0 && <Tag tone="outline">{t('meta.pending', { count: project.pending.length })}</Tag>}
      </span>}
      extra={<span className={css.switch} title={autoConfirm ? t('autoConfirm.onHint') : t('autoConfirm.offHint')}>
        <Switch checked={autoConfirm} label={t('autoConfirm.label')}
          onChange={next => { void api.setAutoConfirm(sessionId, project.id, next).then(() => { toast(next ? t('toast.autoOn') : t('toast.autoOff')); refresh() }) }} />
        <span className={css.switchLabel}>{t('autoConfirm.label')}</span>
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
    {p.nudgeBar}
    {view === 'play' && <PlayView {...p} liveElement={p.liveElement}
      onOpenElement={id => { p.setOpenElement(id); setView('elements') }} onOpenVersions={() => { setView('versions') }} />}
    {view === 'elements' && <ElementsView {...p} openId={p.openElement} onOpen={p.setOpenElement} onLiveElement={p.setLiveElement} />}
    {view === 'design' && <DesignView {...p} openChapter={p.openChapter} onOpenChapter={p.setOpenChapter} onStyle={() => { setStyling(true) }} />}
    {view === 'versions' && <VersionsView {...p} />}
    {p.foot}
  </PanelRoot>
}
