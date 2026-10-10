/**
 * The 剪辑 tab body: the project list, and an open project's four tabs —
 * 素材 (sources, speakers, jobs), 文稿 (transcript rough cut), 导出, 设置
 * (project / show / global layers). Data is re-read from the host on a short
 * poll: the model edits the same project from the conversation.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChipRow, PanelHeader, PanelRoot, UnderlineTabs, type PanelAction } from '@khorsheed/dsh-client-ui-panel-kit/src/client/index.ts'
import { formatClock, isRemoved, removedRanges, type Range } from '../core/timeline.ts'
import type {
  Edit, EffectiveSetting, GlobalConfig, SettingValue, Job, ModelStatus, Overview, Project, ProjectView, Segment, SettingKey, Show, Speaker, Token,
} from '../types.ts'
import type { RemoteResult, VideoPaneProps } from './contract.ts'
import type { VideoStudioKey } from './locales.ts'
import type { VideoTab } from './store.ts'
import css from './VideoPane.module.css'

type T = VideoPaneProps['t']

async function value<V>(answer: Promise<RemoteResult<V>>): Promise<V> {
  const result = await answer
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function useNotice(): [string | null, (e: unknown) => void, () => void] {
  const [notice, setNotice] = useState<string | null>(null)
  const report = useCallback((e: unknown) => setNotice(e instanceof Error ? e.message : String(e)), [])
  return [notice, report, () => setNotice(null)]
}

/** Poll a loader; re-runs when `deps` change. */
function usePolled<V>(load: () => Promise<V>, deps: readonly unknown[], intervalMs: number): { data: V | undefined; error: string | undefined; reload: () => void } {
  const [data, setData] = useState<V>()
  const [error, setError] = useState<string>()
  const [tick, setTick] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = () => {
      loadRef.current().then(
        (d) => {
          if (cancelled) return
          setData(d)
          setError(undefined)
        },
        (e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e))
        },
      ).finally(() => {
        if (!cancelled && intervalMs > 0) timer = setTimeout(run, intervalMs)
      })
    }
    run()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are the caller's
  }, [...deps, tick, intervalMs])
  return { data, error, reload: () => setTick((n) => n + 1) }
}

/** One shared <audio> for every ▶ in the pane. */
function usePlayer(): { playing: string | null; play: (key: string, load: () => Promise<string>) => void } {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  useEffect(() => () => audio.current?.pause(), [])
  const play = (key: string, load: () => Promise<string>) => {
    if (playing === key) {
      audio.current?.pause()
      setPlaying(null)
      return
    }
    audio.current?.pause()
    setPlaying(key)
    load().then(
      (url) => {
        const el = new Audio(url)
        audio.current = el
        el.onended = () => setPlaying((k) => (k === key ? null : k))
        void el.play().catch(() => setPlaying(null))
      },
      () => setPlaying(null),
    )
  }
  return { playing, play }
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** A speaker's display name: their name, or 「说话人 N」 by position. */
function speakerLabel(t: T, project: Project, sp: Speaker | undefined): string {
  if (!sp) return '?'
  return sp.name || t('speakers.unnamed', { n: String(project.speakers.indexOf(sp) + 1) })
}

function speakerClass(sp: Speaker | undefined): string {
  return css[`sp_${sp?.color ?? 's1'}`] ?? ''
}

// ───────────────────────── root ─────────────────────────

export function VideoPane(props: VideoPaneProps): ReactNode {
  const projectId = props.useStore((s) => s.projectId)
  const opened = useRef(false)
  // first open: follow the session's bound project
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    value(props.bound()).then(
      (id) => {
        if (id) props.actions.open(id)
      },
      () => undefined,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, [])
  return <PanelRoot className={css.root}>{projectId ? <ProjectScreen p={props} projectId={projectId} /> : <ListScreen p={props} />}</PanelRoot>
}

// ───────────────────────── list ─────────────────────────

function ListScreen({ p }: { p: VideoPaneProps }): ReactNode {
  const { t } = p
  const ov = usePolled(() => value(p.overview()), [], 8000)
  const bound = usePolled(() => value(p.bound()), [], 0)
  const [creating, setCreating] = useState(false)
  const [notice, report, clear] = useNotice()
  const actions: PanelAction[] = [
    { id: 'refresh', label: t('action.refresh'), icon: <span aria-hidden="true">↻</span>, onSelect: () => ov.reload() },
  ]
  const open = (id: string) => {
    value(p.bind(id)).catch(() => undefined)
    p.actions.open(id)
  }
  const o = ov.data
  return (
    <>
      <PanelHeader title={t('list.title')} moreLabel={t('action.more')} actions={actions}
        extra={<button type="button" className={css.primary} onClick={() => setCreating((v) => !v)}>＋ {t('list.new')}</button>} />
      <div className={css.body}>
        {notice && <Notice text={notice} onClose={clear} />}
        {ov.error && <div className={css.error}>{t('state.error', { reason: ov.error })}</div>}
        {!o && !ov.error && <div className={css.muted}>{t('state.loading')}</div>}
        {o && <Warnings t={t} o={o} onDownload={() => value(p.downloadModels()).then(() => ov.reload(), report)} />}
        {o && creating && <NewProject p={p} o={o} onDone={(view) => { setCreating(false); p.actions.open(view.project.id) }} onCancel={() => setCreating(false)} onError={report} />}
        {o && !o.projects.length && !creating && <div className={css.empty}>{t('list.empty')}</div>}
        {o && <ProjectGroups t={t} o={o} boundId={bound.data ?? null} onOpen={open} />}
      </div>
    </>
  )
}

function Warnings({ t, o, onDownload }: { t: T; o: Overview; onDownload: () => void }): ReactNode {
  const missing = o.models.filter((m) => m.state !== 'installed')
  const downloading = o.models.some((m) => m.state === 'downloading')
  return (
    <>
      {!o.toolchain.ffmpeg && <div className={css.warn}>{t('warn.noFfmpeg')}</div>}
      {missing.length > 0 && (
        <div className={css.warn}>
          <span>{t('warn.models')}</span>
          {downloading
            ? <ModelList t={t} models={o.models} />
            : <button type="button" className={css.btn} onClick={onDownload}>{t('warn.modelsDownload')}</button>}
        </div>
      )}
    </>
  )
}

function ProjectGroups({ t, o, boundId, onOpen }: { t: T; o: Overview; boundId: string | null; onOpen: (id: string) => void }): ReactNode {
  const groups: Array<{ show: Show | null; items: Overview['projects'] }> = [
    ...o.shows.map((show) => ({ show, items: o.projects.filter((x) => x.showId === show.id) })),
    { show: null, items: o.projects.filter((x) => !x.showId || !o.shows.some((s) => s.id === x.showId)) },
  ].filter((g) => g.items.length || g.show)
  return (
    <>
      {groups.map((g) => (
        <section key={g.show?.id ?? 'none'} className={css.group}>
          <div className={css.groupHead}>
            <b>{g.show?.name ?? t('list.noShow')}</b>
            {g.show && <span className={css.muted}>{t('list.showMeta', { count: String(g.items.length), voices: String(g.show.voiceprints.length) })}</span>}
          </div>
          {g.items.map((x) => (
            <button key={x.id} type="button" className={css.row} onClick={() => onOpen(x.id)}>
              <span className={css.rowMain}>
                <b>{x.name}</b>
                <small>{t('list.projectMeta', { status: t(`status.${x.status}` as VideoStudioKey), duration: formatClock(x.durationSec), output: formatClock(x.outputSec) })}</small>
              </span>
              {x.id === boundId && <span className={css.pill}>{t('list.boundHere')}</span>}
              <span className={css.when}>{x.updatedAt.slice(5, 10)}</span>
            </button>
          ))}
        </section>
      ))}
    </>
  )
}

function NewProject({ p, o, onDone, onCancel, onError }: { p: VideoPaneProps; o: Overview; onDone: (v: ProjectView) => void; onCancel: () => void; onError: (e: unknown) => void }): ReactNode {
  const { t } = p
  const [name, setName] = useState('')
  const [showId, setShowId] = useState<string | null>(o.shows[o.shows.length - 1]?.id ?? null)
  const [newShow, setNewShow] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      let sid = showId
      if (newShow !== null && newShow.trim()) sid = (await value(p.createShow(newShow.trim()))).id
      onDone(await value(p.createProject({ name, showId: sid })))
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className={css.form} onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <label className={css.field}><span>{t('new.name')}</span>
        <input id="vs-new-name" value={name} placeholder={t('new.namePlaceholder')} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <div className={css.field}><span>{t('new.show')}</span>
        <div className={css.chips}>
          {o.shows.map((s) => (
            <button key={s.id} type="button" className={css.chip} data-on={newShow === null && showId === s.id} onClick={() => { setShowId(s.id); setNewShow(null) }}>{s.name}</button>
          ))}
          <button type="button" className={css.chip} data-on={newShow === null && showId === null} onClick={() => { setShowId(null); setNewShow(null) }}>{t('list.noShow')}</button>
          <button type="button" className={css.chip} data-on={newShow !== null} onClick={() => setNewShow('')}>{t('new.newShow')}</button>
        </div>
      </div>
      {newShow !== null && <input id="vs-new-show" className={css.input} value={newShow} placeholder={t('new.newShowPlaceholder')} onChange={(e) => setNewShow(e.target.value)} />}
      {(showId || newShow !== null) && <div className={css.muted}>{t('new.inherits')}</div>}
      <div className={css.actions}>
        <button type="button" className={css.btn} onClick={onCancel}>{t('action.cancel')}</button>
        <button type="submit" className={css.primary} disabled={busy}>{t('action.create')}</button>
      </div>
    </form>
  )
}

// ───────────────────────── project ─────────────────────────

function ProjectScreen({ p, projectId }: { p: VideoPaneProps; projectId: string }): ReactNode {
  const { t } = p
  const tab = p.useStore((s) => s.tab)
  const rev = p.useStore((s) => s.rev)
  const view = usePolled(() => value(p.project(projectId)), [projectId, rev], 3000)
  const ov = usePolled(() => value(p.overview()), [rev], 15000)
  const [notice, report, clear] = useNotice()
  const player = usePlayer()
  const v = view.data
  /** Run a mutation that answers the new view. */
  const act = (fn: () => Promise<RemoteResult<ProjectView>>) => value(fn()).then(() => view.reload(), report)

  const tabs = [
    { id: 'sources' as const, label: t('tabs.sources'), badge: v && v.jobs.some((j) => j.state === 'running') ? '•' : undefined },
    { id: 'transcript' as const, label: t('tabs.transcript'), badge: v ? pendingBadge(v.project) : undefined },
    { id: 'export' as const, label: t('tabs.export') },
    { id: 'settings' as const, label: t('tabs.settings') },
  ]
  return (
    <>
      <PanelHeader
        title={v?.project.name ?? t('state.loading')}
        meta={v?.show?.name}
        onBack={() => p.actions.open(null)}
        backLabel={t('action.back')}
        moreLabel={t('action.more')}
        actions={[{ id: 'refresh', label: t('action.refresh'), icon: <span aria-hidden="true">↻</span>, onSelect: () => view.reload() }]}
      />
      <UnderlineTabs tabs={tabs.map((x) => (x.badge ? x : { id: x.id, label: x.label }))} value={tab} onChange={(id: VideoTab) => p.actions.tab(id)} label={t('tabs.label')} />
      <div className={css.body}>
        {notice && <Notice text={notice} onClose={clear} />}
        {view.error && <div className={css.error}>{t('state.error', { reason: view.error })}</div>}
        {!v && !view.error && <div className={css.muted}>{t('state.loading')}</div>}
        {v && tab === 'sources' && <SourcesTab p={p} v={v} o={ov.data} act={act} report={report} player={player} reload={view.reload} />}
        {v && tab === 'transcript' && <TranscriptTab p={p} v={v} act={act} player={player} />}
        {v && tab === 'export' && <ExportTab p={p} v={v} o={ov.data} report={report} reload={view.reload} />}
        {v && tab === 'settings' && <SettingsTab p={p} v={v} o={ov.data} act={act} report={report} reloadOverview={ov.reload} />}
      </div>
    </>
  )
}

function pendingBadge(p: Project): string | undefined {
  const n = new Set(p.edits.filter((e) => e.state === 'proposed').map((e) => e.group)).size
  return n ? String(n) : undefined
}

type Act = (fn: () => Promise<RemoteResult<ProjectView>>) => Promise<void>
type Player = ReturnType<typeof usePlayer>

// ───────────────────────── 素材 ─────────────────────────

function SourcesTab({ p, v, o, act, report, player, reload }: { p: VideoPaneProps; v: ProjectView; o: Overview | undefined; act: Act; report: (e: unknown) => void; player: Player; reload: () => void }): ReactNode {
  const { t } = p
  const project = v.project
  const [paths, setPaths] = useState('')
  const [busy, setBusy] = useState(false)
  const doImport = async () => {
    const list = paths.split('\n').map((s) => s.trim()).filter(Boolean)
    if (!list.length) return
    setBusy(true)
    await act(() => p.importSources({ projectId: project.id, paths: list }))
    setBusy(false)
    setPaths('')
  }
  return (
    <>
      {o && <Warnings t={t} o={o} onDownload={() => value(p.downloadModels()).then(reload, report)} />}
      <div className={css.sect}>{t('sources.title')}</div>
      {!project.sources.length && <div className={css.muted}>{t('sources.empty')}</div>}
      {project.sources.map((s) => (
        <div key={s.id} className={css.asset}>
          <span className={css.dot} data-role={s.role} />
          <span className={css.rowMain}>
            <b>{s.id === project.referenceId ? t('sources.reference') : s.role === 'video' ? t('sources.video') : t('sources.recording')}</b>
            <small title={s.path}>{basename(s.path)}</small>
          </span>
          <span className={css.meta}>{formatClock(s.durationSec)}{s.width ? ` · ${s.height}p` : ''}</span>
          {s.offsetSec !== 0 && <span className={css.tag}>{t('sources.offset', { sec: s.offsetSec.toFixed(2) })}</span>}
        </div>
      ))}
      <label className={css.field}><span>{t('sources.importLabel')}</span>
        <textarea id="vs-import-paths" className={css.textarea} rows={2} value={paths} placeholder={t('sources.importPlaceholder')} onChange={(e) => setPaths(e.target.value)} />
      </label>
      <div className={css.actions}>
        <span className={css.muted}>{t('sources.importHint')}</span>
        <button type="button" className={css.primary} disabled={busy || !paths.trim()} onClick={() => void doImport()}>{t('sources.import')}</button>
      </div>

      <JobList t={t} jobs={v.jobs.filter((j) => j.kind !== 'export')} onCancel={(id) => value(p.cancelJob(id)).then(reload, report)}
        onRetry={(job) => value(p.retryTranscribe(job.projectId)).then(reload, report)} />

      <div className={css.sect}>{t('speakers.title', { count: String(project.speakers.length) })}</div>
      {!project.speakers.length && <div className={css.muted}>{t('speakers.waiting')}</div>}
      {project.speakers.length > 0 && (
        <div className={css.share}>
          {project.speakers.map((s) => <i key={s.id} className={speakerClass(s)} style={{ flexGrow: Math.max(1, Math.round(s.speechSec)) }} />)}
        </div>
      )}
      {project.speakers.map((s) => (
        <SpeakerRow key={s.id} p={p} v={v} sp={s} act={act} player={player} />
      ))}
    </>
  )
}

function SpeakerRow({ p, v, sp, act, player }: { p: VideoPaneProps; v: ProjectView; sp: Speaker; act: Act; player: Player }): ReactNode {
  const { t } = p
  const project = v.project
  const [name, setName] = useState(sp.name)
  useEffect(() => setName(sp.name), [sp.name])
  const commit = () => {
    if (name.trim() !== sp.name) void act(() => p.renameSpeaker({ projectId: project.id, speakerId: sp.id, name: name.trim() }))
  }
  // sample: this speaker's longest segment, first 8 s, raw
  const sample = useMemo(() => {
    const segs = project.transcript.filter((s) => s.speakerId === sp.id).sort((a, b) => b.end - b.start - (a.end - a.start))
    const s = segs[0]
    return s ? { start: s.start, end: Math.min(s.end, s.start + 8) } : null
  }, [project.transcript, sp.id])
  const key = `sp:${sp.id}`
  return (
    <div className={css.speaker} data-new={!sp.name && !sp.voiceprintId}>
      <span className={`${css.dot} ${speakerClass(sp)}`} />
      <span className={css.rowMain}>
        <input id={`vs-speaker-${sp.id}`} className={css.inlineInput} value={name} placeholder={`${speakerLabel(t, project, sp)} · ${t('speakers.namePlaceholder')}`}
          onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
        <small>{sp.matchScore ? t('speakers.matched', { score: String(Math.round(sp.matchScore * 100)) }) : sp.voiceprintId ? t('speakers.saved') : project.showId ? t('speakers.new') : t('speakers.noShow')}</small>
      </span>
      <span className={css.meta}>{formatClock(sp.speechSec)}</span>
      {sample && (
        <button type="button" className={css.btn} aria-pressed={player.playing === key}
          onClick={() => player.play(key, () => value(p.clip({ projectId: project.id, start: sample.start, end: sample.end, raw: true })))}>
          {player.playing === key ? `■ ${t('action.stop')}` : `▶ ${t('action.play')}`}
        </button>
      )}
      {project.speakers.length > 1 && (
        <select id={`vs-merge-${sp.id}`} className={css.select} value="" aria-label={t('speakers.mergeInto')}
          onChange={(e) => { if (e.target.value) void act(() => p.mergeSpeakers({ projectId: project.id, fromId: sp.id, intoId: e.target.value })) }}>
          <option value="">{t('speakers.mergeInto')}</option>
          {project.speakers.filter((x) => x.id !== sp.id).map((x) => <option key={x.id} value={x.id}>{speakerLabel(t, project, x)}</option>)}
        </select>
      )}
    </div>
  )
}

function JobList({ t, jobs, onCancel, onRetry }: { t: T; jobs: Job[]; onCancel: (id: string) => void; onRetry?: (job: Job) => void }): ReactNode {
  const shown = jobs.filter((j) => j.state !== 'done' || Date.now() - Date.parse(j.updatedAt) < 10 * 60_000).slice(-6)
  if (!shown.length) return null
  return (
    <>
      <div className={css.sect}>{t('jobs.title')}</div>
      {shown.map((j) => (
        <div key={j.id} className={css.job} data-state={j.state}>
          <span className={css.rowMain}>
            <b>{j.label}</b>
            <small>
              {j.state === 'queued' && t('jobs.queued')}
              {j.state === 'running' && t('jobs.running', { percent: String(Math.round(j.progress * 100)) })}
              {j.state === 'done' && t('jobs.done')}
              {j.state === 'failed' && t('jobs.failed', { reason: j.error ?? '' })}
            </small>
            {(j.state === 'running' || j.state === 'queued') && <span className={css.prog}><i style={{ width: `${Math.round(j.progress * 100)}%` }} /></span>}
            {j.outputs?.length ? <small className={css.paths}>{j.outputs.map(basename).join(' · ')}</small> : null}
          </span>
          {(j.state === 'running' || j.state === 'queued') && <button type="button" className={css.btn} onClick={() => onCancel(j.id)}>{t('action.cancel')}</button>}
          {j.state === 'failed' && j.kind === 'transcribe' && onRetry && <button type="button" className={css.btn} onClick={() => onRetry(j)}>{t('action.retry')}</button>}
        </div>
      ))}
    </>
  )
}

// ───────────────────────── 文稿 ─────────────────────────

type Filter = 'all' | 'pending' | 'cut'
const PAGE = 60

interface Phrase {
  tokens: Token[]
  start: number
  end: number
}

function phrasesOf(tokens: readonly Token[]): Phrase[] {
  const out: Phrase[] = []
  let cur: Token[] = []
  const flush = () => {
    const first = cur[0]
    const last = cur[cur.length - 1]
    if (first && last) out.push({ tokens: cur, start: first.start, end: last.end })
    cur = []
  }
  for (const tok of tokens) {
    cur.push(tok)
    if (/[，。？！、,.?!；;]/u.test(tok.text)) flush()
  }
  flush()
  return out
}

function TranscriptTab({ p, v, act, player }: { p: VideoPaneProps; v: ProjectView; act: Act; player: Player }): ReactNode {
  const { t } = p
  const project = v.project
  const [filter, setFilter] = useState<Filter>('all')
  const [limit, setLimit] = useState(PAGE)
  const removed = useMemo(() => removedRanges(v.durationSec, project.edits), [v.durationSec, project.edits])
  const proposed = useMemo(() => project.edits.filter((e) => e.state === 'proposed'), [project.edits])
  const speakers = useMemo(() => new Map(project.speakers.map((s) => [s.id, s])), [project.speakers])
  const groups = useMemo(() => project.groups.filter((g) => proposed.some((e) => e.group === g.id)), [project.groups, proposed])

  if (!project.transcript.length) return <div className={css.empty}>{t('transcript.empty')}</div>

  const touches = (seg: Segment, list: readonly { start: number; end: number }[]) => list.some((r) => r.start < seg.end && r.end > seg.start)
  const segs = project.transcript.filter((s) => filter === 'all' || (filter === 'pending' ? touches(s, proposed) : touches(s, removed)))
  const pendingCount = project.transcript.filter((s) => touches(s, proposed)).length
  const cutCount = project.transcript.filter((s) => touches(s, removed)).length

  return (
    <>
      <div className={css.actions}>
        <span className={css.stats}>{t('transcript.stats', { duration: formatClock(v.durationSec), output: formatClock(v.outputSec) })}</span>
        <button type="button" className={css.btn} onClick={() => void act(() => p.scan(project.id))}>{t('transcript.scan')}</button>
      </div>
      {groups.map((g) => {
        const items = proposed.filter((e) => e.group === g.id)
        const saved = items.reduce((a, e) => a + (e.kind === 'shorten' ? Math.max(0, e.end - e.start - (e.value ?? 0)) : e.kind === 'cut' ? e.end - e.start : 0), 0)
        return (
          <div key={g.id} className={css.prop}>
            <div className={css.propHead}>{g.title}</div>
            <div className={css.actions}>
              <span className={css.muted}>{t('proposal.items', { count: String(items.length), saved: formatClock(saved) })}</span>
              <button type="button" className={css.btn} onClick={() => void act(() => p.decide({ projectId: project.id, groupId: g.id, state: 'rejected' }))}>✗ {t('action.reject')}</button>
              <button type="button" className={css.primary} onClick={() => void act(() => p.decide({ projectId: project.id, groupId: g.id, state: 'applied' }))}>✓ {t('action.accept')}</button>
            </div>
          </div>
        )
      })}
      <ChipRow
        label={t('tabs.transcript')}
        value={filter}
        onSelect={(id: Filter) => { setFilter(id); setLimit(PAGE) }}
        chips={[
          { id: 'all', label: t('transcript.filterAll') },
          { id: 'pending', label: t('transcript.filterPending'), count: pendingCount },
          { id: 'cut', label: t('transcript.filterCut'), count: cutCount },
        ]}
      />
      <div className={css.muted}>{t('transcript.hint')}</div>
      {segs.slice(0, limit).map((seg) => (
        <Paragraph key={seg.id} p={p} project={project} seg={seg} sp={speakers.get(seg.speakerId)} removed={removed} proposed={proposed} act={act} player={player} />
      ))}
      {segs.length > limit && <button type="button" className={css.btn} onClick={() => setLimit((n) => n + PAGE)}>{t('transcript.more', { count: String(Math.min(PAGE, segs.length - limit)) })}</button>}
    </>
  )
}

function Paragraph({ p, project, seg, sp, removed, proposed, act, player }: { p: VideoPaneProps; project: Project; seg: Segment; sp: Speaker | undefined; removed: Range[]; proposed: Edit[]; act: Act; player: Player }): ReactNode {
  const { t } = p
  const [menu, setMenu] = useState(false)
  const phrases = useMemo(() => phrasesOf(seg.tokens), [seg.tokens])
  // only proposed CUTS mark words; a proposed shorten covers a gap, drawn as a pause chip
  const inProposal = (s: number, e: number) => proposed.some((x) => x.kind === 'cut' && x.start <= s + 1e-3 && x.end >= e - 1e-3 && e - s > 1e-3)
  const key = `seg:${seg.id}`
  const pieces: ReactNode[] = []
  phrases.forEach((ph, i) => {
    const prev = phrases[i - 1]
    if (prev) {
      const gap = ph.start - prev.end
      const shorten = project.edits.find((x) => x.kind === 'shorten' && x.state !== 'rejected' && x.start <= prev.end + 1e-3 && x.end >= ph.start - 1e-3)
      if (gap >= 1 || shorten) {
        pieces.push(<span key={`g${i}`} className={css.pause} data-proposed={shorten?.state === 'proposed'}>{t('transcript.pause', { sec: gap.toFixed(1) })}{shorten ? ` → ${(shorten.value ?? 0).toFixed(1)}` : ''}</span>)
      }
    }
    const cut = isRemoved(ph.start, ph.end, removed)
    pieces.push(
      <span key={i} className={css.phrase} data-cut={cut} role="button" tabIndex={0}
        onClick={() => void act(() => p.setCut({ projectId: project.id, start: ph.start, end: ph.end, cut: !cut }))}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void act(() => p.setCut({ projectId: project.id, start: ph.start, end: ph.end, cut: !cut })) } }}>
        {ph.tokens.map((tok, k) => {
          const tCut = !cut && isRemoved(tok.start, tok.end, removed)
          const tProp = inProposal(tok.start, tok.end)
          return <span key={k} className={css.tok} data-cut={tCut} data-proposed={tProp}>{tok.text}</span>
        })}
      </span>,
    )
  })
  // the gap after this paragraph, when a shorten edit (proposed or applied) covers it
  const lastEnd = seg.tokens[seg.tokens.length - 1]?.end ?? seg.end
  const tail = project.edits.find((x) => x.kind === 'shorten' && x.state !== 'rejected' && Math.abs(x.start - lastEnd) < 0.05)
  if (tail) {
    pieces.push(<span key="tail" className={css.pause} data-proposed={tail.state === 'proposed'}>{t('transcript.pause', { sec: (tail.end - tail.start).toFixed(1) })} → {(tail.value ?? 0).toFixed(1)}</span>)
  }
  return (
    <div className={css.para}>
      <div className={css.who}>
        <button type="button" className={`${css.whoName} ${speakerClass(sp)}`} onClick={() => setMenu((m) => !m)} aria-expanded={menu} title={t('transcript.reassign')}>{speakerLabel(t, project, sp)}</button>
        <span className={css.whoMeta}>
        <small>{formatClock(seg.start)}</small>
        <button type="button" className={css.iconBtn} aria-label={t('action.play')} aria-pressed={player.playing === key}
          onClick={() => player.play(key, () => value(p.clip({ projectId: project.id, start: seg.start, end: seg.end })))}>{player.playing === key ? '■' : '▶'}</button>
        </span>
        {menu && (
          <select id={`vs-reassign-${seg.id}`} className={css.select} value={seg.speakerId} aria-label={t('transcript.reassign')}
            onChange={(e) => { setMenu(false); void act(() => p.reassignSegment({ projectId: project.id, segmentId: seg.id, speakerId: e.target.value })) }}>
            {project.speakers.map((x) => <option key={x.id} value={x.id}>{speakerLabel(t, project, x)}</option>)}
          </select>
        )}
      </div>
      <div className={css.line}>{pieces}</div>
    </div>
  )
}

// ───────────────────────── 导出 ─────────────────────────

function ExportTab({ p, v, o, report, reload }: { p: VideoPaneProps; v: ProjectView; o: Overview | undefined; report: (e: unknown) => void; reload: () => void }): ReactNode {
  const { t } = p
  const project = v.project
  const hasVideo = project.sources.some((s) => s.role === 'video' && s.hasVideo)
  const [kinds, setKinds] = useState<Record<'audio' | 'video' | 'subtitles' | 'text', boolean>>({ audio: true, video: hasVideo, subtitles: true, text: false })
  const chosen = (Object.keys(kinds) as Array<keyof typeof kinds>).filter((k) => kinds[k] && (k !== 'video' || hasVideo))
  const rows: Array<{ k: keyof typeof kinds; title: string; spec: string; disabled?: boolean }> = [
    { k: 'audio', title: t('export.audio'), spec: t('export.audioSpec', { lufs: String(project.settings.audioLoudness) }) },
    { k: 'video', title: t('export.video'), spec: hasVideo ? t('export.videoSpec', { lufs: String(project.settings.videoLoudness) }) : t('export.noVideo'), disabled: !hasVideo },
    { k: 'subtitles', title: t('export.subtitles'), spec: t('export.subtitlesSpec') },
    { k: 'text', title: t('export.text'), spec: t('export.textSpec') },
  ]
  const exportDir = o ? o.global.exportDir.replace('{show}', v.show?.name ?? '未归类').replace('{episode}', project.name) : ''
  return (
    <>
      <div className={css.stats}>{t('transcript.stats', { duration: formatClock(v.durationSec), output: formatClock(v.outputSec) })}</div>
      {o && hasVideo && !o.toolchain.burnSubtitles && <div className={css.warn}>{t('warn.noSubtitleBurn')}</div>}
      {rows.map((r) => (
        <label key={r.k} className={css.exp} data-disabled={!!r.disabled}>
          <input id={`vs-export-${r.k}`} type="checkbox" checked={kinds[r.k] && !r.disabled} disabled={r.disabled} onChange={(e) => setKinds({ ...kinds, [r.k]: e.target.checked })} />
          <span className={css.rowMain}><b>{r.title}</b><small>{r.spec}</small></span>
        </label>
      ))}
      {exportDir && <div className={css.path}><span className={css.muted}>{t('export.dir')}</span><code title={exportDir}>{exportDir}</code></div>}
      <div className={css.actions}>
        <span className={css.muted}>{chosen.length ? '' : t('export.nothing')}</span>
        <button type="button" className={css.primary} disabled={!chosen.length || !project.referenceId}
          onClick={() => value(p.startExport({ projectId: project.id, kinds: chosen })).then(reload, report)}>{t('export.start')}</button>
      </div>
      <JobList t={t} jobs={v.jobs.filter((j) => j.kind === 'export')} onCancel={(id) => value(p.cancelJob(id)).then(reload, report)} />
    </>
  )
}

// ───────────────────────── 设置 ─────────────────────────

type Scope = 'project' | 'show' | 'global'

const EDITABLE: SettingKey[] = ['audioLoudness', 'videoLoudness', 'introMusic', 'outroMusic', 'subtitleStyle', 'pauseKeep', 'pauseThreshold', 'fillers']

function SettingsTab({ p, v, o, act, report, reloadOverview }: { p: VideoPaneProps; v: ProjectView; o: Overview | undefined; act: Act; report: (e: unknown) => void; reloadOverview: () => void }): ReactNode {
  const { t } = p
  const [scope, setScope] = useState<Scope>('project')
  const project = v.project
  const show = v.show
  const sourceLabel = (e: EffectiveSetting) => (e.source === 'project' ? t('settings.sourceProject') : e.source === 'show' ? t('settings.sourceShow') : t('settings.sourceGlobal'))
  return (
    <>
      <ChipRow label={t('settings.scope')} value={scope} onSelect={(id: Scope) => setScope(id)}
        chips={[{ id: 'project', label: t('settings.project') }, { id: 'show', label: show ? `${t('settings.show')} · ${show.name}` : t('settings.show') }, { id: 'global', label: t('settings.global') }]} />
      {scope === 'project' && (
        <>
          {v.effective.filter((e) => EDITABLE.includes(e.key)).map((e) => (
            <div key={e.key} className={css.srow} data-source={e.source}>
              <span className={css.skey}>{t(`key.${e.key}` as VideoStudioKey)}</span>
              <SettingEditor t={t} k={e.key} value={e.value} onChange={(val) => void act(() => p.projectSetting({ projectId: project.id, key: e.key, value: val, action: 'set' }))} />
              <span className={css.src} data-source={e.source}>{sourceLabel(e)}</span>
              {e.source === 'project' && (
                <span className={css.ops}>
                  {project.showId && <button type="button" className={css.btn} onClick={() => void act(() => p.projectSetting({ projectId: project.id, key: e.key, action: 'saveToShow' }))}>{t('settings.saveToShow')}</button>}
                  <button type="button" className={css.btn} onClick={() => void act(() => p.projectSetting({ projectId: project.id, key: e.key, action: 'reset' }))}>{t('settings.reset')}</button>
                </span>
              )}
            </div>
          ))}
        </>
      )}
      {scope === 'show' && !show && <div className={css.muted}>{t('settings.noShow')}</div>}
      {scope === 'show' && show && <ShowSettings p={p} show={show} report={report} onChanged={() => { reloadOverview(); void act(() => p.project(project.id)) }} />}
      {scope === 'global' && o && <GlobalSettings p={p} o={o} report={report} onChanged={reloadOverview} />}
    </>
  )
}

function SettingEditor({ t, k, value: val, onChange }: { t: T; k: SettingKey; value: unknown; onChange: (v: SettingValue) => void }): ReactNode {
  const id = `vs-setting-${k}`
  if (k === 'subtitleStyle') {
    return (
      <span className={css.seg}>
        {(['standard', 'big-center', 'bottom-bar'] as const).map((s) => (
          <button key={s} type="button" data-on={val === s} onClick={() => onChange(s)}>{t(`style.${s}` as VideoStudioKey)}</button>
        ))}
      </span>
    )
  }
  if (k === 'audioLoudness' || k === 'videoLoudness') {
    return (
      <span className={css.seg}>
        {[-16, -14, -19].map((n) => <button key={n} type="button" data-on={val === n} onClick={() => onChange(n)}>{t('unit.lufs', { value: String(n) })}</button>)}
      </span>
    )
  }
  if (k === 'pauseKeep' || k === 'pauseThreshold') {
    return <DraftInput id={id} value={String(val)} type="number" onCommit={(s) => { const n = Number(s); if (Number.isFinite(n) && n >= 0) onChange(n) }} />
  }
  if (k === 'fillers') {
    return <DraftInput id={id} value={(val as string[]).join(' ')} onCommit={(s) => onChange(s.split(/[\s,，、]+/).filter(Boolean))} />
  }
  return <DraftInput id={id} value={String(val ?? '')} placeholder={t('value.fileInLibrary')} onCommit={(s) => onChange(s.trim())} />
}

function DraftInput({ id, value: initial, onCommit, type = 'text', placeholder }: { id: string; value: string; onCommit: (s: string) => void; type?: string; placeholder?: string }): ReactNode {
  const [draft, setDraft] = useState(initial)
  useEffect(() => setDraft(initial), [initial])
  return (
    <input id={id} className={css.inlineInput} type={type} value={draft} placeholder={placeholder} step={type === 'number' ? 0.1 : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== initial) onCommit(draft) }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
  )
}

function ShowSettings({ p, show, report, onChanged }: { p: VideoPaneProps; show: Show; report: (e: unknown) => void; onChanged: () => void }): ReactNode {
  const { t } = p
  const [confirming, setConfirming] = useState<string | null>(null)
  const set = (key: SettingKey, val: SettingValue) => value(p.updateShow({ showId: show.id, key, value: val })).then(onChanged, report)
  return (
    <>
      <div className={css.muted}>{t('settings.showHint')}</div>
      <div className={css.srow}>
        <span className={css.skey}>{t('new.name')}</span>
        <DraftInput id="vs-show-name" value={show.name} onCommit={(s) => value(p.updateShow({ showId: show.id, name: s })).then(onChanged, report)} />
      </div>
      {EDITABLE.map((k) => (
        <div key={k} className={css.srow}>
          <span className={css.skey}>{t(`key.${k}` as VideoStudioKey)}</span>
          <SettingEditor t={t} k={k} value={show.settings[k]} onChange={(val) => void set(k, val)} />
        </div>
      ))}
      <div className={css.sect}>{t('settings.voiceprints')}</div>
      <div className={css.muted}>{t('settings.voiceprintsHint', { count: String(show.voiceprints.length) })}</div>
      {show.voiceprints.map((vp) => (
        <div key={vp.id} className={css.vp}>
          <span className={`${css.dot} ${css[`sp_${vp.color}`] ?? ''}`} />
          <span className={css.rowMain}><b>{vp.name}</b><small>{t('settings.voiceprintMeta', { sec: String(Math.round(vp.sampleSec)), episodes: String(vp.episodes) })}</small></span>
          {confirming !== vp.id && <button type="button" className={css.danger} onClick={() => setConfirming(vp.id)}>{t('action.delete')}</button>}
          {confirming === vp.id && (
            <div className={css.ask}>
              <span>{t('settings.voiceprintConfirm', { name: vp.name })}</span>
              <button type="button" className={css.dangerFill} onClick={() => { setConfirming(null); void value(p.deleteVoiceprint({ showId: show.id, voiceprintId: vp.id })).then(onChanged, report) }}>{t('action.confirmDelete')}</button>
              <button type="button" className={css.btn} onClick={() => setConfirming(null)}>{t('action.cancel')}</button>
            </div>
          )}
        </div>
      ))}
    </>
  )
}

function GlobalSettings({ p, o, report, onChanged }: { p: VideoPaneProps; o: Overview; report: (e: unknown) => void; onChanged: () => void }): ReactNode {
  const { t } = p
  const g: GlobalConfig = o.global
  const set = (patch: Parameters<VideoPaneProps['setGlobal']>[0]) => value(p.setGlobal(patch)).then(onChanged, report)
  return (
    <>
      <div className={css.muted}>{t('settings.globalHint')}</div>
      {(['libraryDir', 'exportDir', 'ffmpegPath', 'ffprobePath'] as const).map((k) => (
        <div key={k} className={css.srow}>
          <span className={css.skey}>{t(`key.${k}` as VideoStudioKey)}</span>
          <DraftInput id={`vs-global-${k}`} value={g[k]} onCommit={(s) => void set({ [k]: s.trim() })} />
        </div>
      ))}
      <div className={css.sect}>{t('settings.toolchain')}</div>
      <div className={css.srow}><span className={css.skey}>ffmpeg</span><span className={css.meta}>{o.toolchain.ffmpeg ?? t('settings.missing')}</span><span className={css.src}>{o.toolchain.burnSubtitles ? t('settings.burnYes') : t('settings.burnNo')}</span></div>
      <div className={css.srow}><span className={css.skey}>ffprobe</span><span className={css.meta}>{o.toolchain.ffprobe ?? t('settings.missing')}</span></div>
      <div className={css.sect}>{t('settings.models')}</div>
      <ModelList t={t} models={o.models} />
      {o.models.some((m) => m.state === 'missing' || m.state === 'failed') && (
        <div className={css.actions}><button type="button" className={css.btn} onClick={() => value(p.downloadModels()).then(onChanged, report)}>{t('warn.modelsDownload')}</button></div>
      )}
    </>
  )
}

function ModelList({ t, models }: { t: T; models: ModelStatus[] }): ReactNode {
  return (
    <>
      {models.map((m) => (
        <div key={m.id} className={css.model}>
          <span className={css.rowMain}><b>{m.label}</b>{m.error && <small>{m.error}</small>}</span>
          <span className={css.meta}>{Math.round(m.bytes / 1e6)} MB</span>
          <span className={css.src} data-state={m.state}>
            {m.state === 'downloading' ? t('model.downloading', { percent: String(Math.round(m.progress * 100)) }) : t(`model.${m.state}` as VideoStudioKey)}
          </span>
        </div>
      ))}
    </>
  )
}

function Notice({ text, onClose }: { text: string; onClose: () => void }): ReactNode {
  return (
    <div className={css.error} role="alert">
      <span>{text}</span>
      <button type="button" className={css.iconBtn} onClick={onClose} aria-label="×">×</button>
    </div>
  )
}
