/**
 * 试玩: the stage (the version on the play area, framed like a game screen,
 * with its status strip), the candidate bar when a version waits for the
 * user, the last check's verdict when it failed, the pick mode, and the
 * parameter drawer — sliders that change the running game at once, marked
 * amber where they differ from the finalized value (定稿 / 还原).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ElementView, GameParam, PlayBundle, ProjectView } from '../types.ts'
import { failureOf, type ViewProps } from './contract.ts'
import { LookCanvas } from './looks.tsx'
import { clearSaves, PlayFrame, type PlayReport } from './PlayFrame.tsx'
import css from './GameTab.module.css'

/** Props of the play view. */
export interface PlayViewProps extends ViewProps {
  readonly project: ProjectView
  /** The element edit the elements view made last (pushed into the frame). */
  readonly liveElement: Record<string, unknown> | null
  readonly onOpenElement: (id: string) => void
  readonly onOpenVersions: () => void
}

/** Round a slider value to its step for display. */
function fmt(value: number, step: number): string {
  const decimals = Math.max(0, Math.min(4, -Math.floor(Math.log10(step))))
  return value.toFixed(decimals)
}

/** The play view. */
export function PlayView(props: PlayViewProps): ReactNode {
  const { t, sessionId, api, project, refresh, toast, insertDraft, liveElement, onOpenElement, onOpenVersions } = props
  const [which, setWhich] = useState<'current' | 'candidate'>('current')
  const [bundle, setBundle] = useState<PlayBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [run, setRun] = useState(0)
  const [errors, setErrors] = useState<readonly string[]>([])
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<{ id: string | null; supported: boolean } | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const record = which === 'candidate' ? project.candidate : project.current
  const version = record?.version
  const loaded = useRef('')

  useEffect(() => { if (project.candidate === null && which === 'candidate') setWhich('current') }, [project.candidate, which])

  useEffect(() => {
    if (version === undefined) { setBundle(null); loaded.current = ''; return }
    const key = `${project.id}:${which}:${version}`
    if (loaded.current === key) return
    let live = true
    void api.bundle(project.id, which).then(result => {
      if (!live) return
      if (result.ok && result.value.ok) {
        loaded.current = key
        setBundle(result.value.bundle)
        setError(null)
      } else setError(failureOf(result) ?? 'io')
    })
    return () => { live = false }
  }, [api, project.id, which, version])

  // Live slider values: the finalized defaults overlaid with the user's layer.
  const params = project.manifest?.params ?? []
  const [local, setLocal] = useState<Record<string, number>>({})
  useEffect(() => { setLocal({}) }, [project.paramOverrides])
  const values = useMemo(() => Object.fromEntries(params.map(p => [p.key, local[p.key] ?? project.paramOverrides[p.key] ?? p.value])), [params, local, project.paramOverrides])
  const changed = params.filter(p => values[p.key] !== p.value)

  const commit = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const slide = (param: GameParam, value: number): void => {
    setLocal(l => ({ ...l, [param.key]: value }))
    clearTimeout(commit.current[param.key])
    commit.current[param.key] = setTimeout(() => {
      void api.setParam(sessionId, project.id, param.key, value).then(refresh)
    }, 250)
  }

  const report = (r: PlayReport): void => { void api.logPlay(sessionId, { projectId: project.id, ...r }) }
  const pickedElement: ElementView | undefined = picked?.id ? project.elements.find(e => e.id === picked.id) : undefined
  const check = project.lastCheck

  return <div className={css.scroll}>
    {project.candidate !== null && <div className={css.banner} data-tone="warn">
      <div className={css.bannerText}>
        <strong>{t('play.candidateTitle', { version: project.candidate.version })}</strong>
        <span>{project.candidate.note ?? t('play.candidate')}</span>
      </div>
      <div className={css.bannerActions}>
        <button type="button" className={css.ghost} aria-pressed={which === 'candidate'}
          onClick={() => { setWhich(w => (w === 'candidate' ? 'current' : 'candidate')) }}>
          {which === 'candidate' ? t('play.backToCurrent') : t('play.tryCandidate')}
        </button>
        <button type="button" className={css.ghost} onClick={() => { setRejecting(r => !r) }}>{t('play.reject')}</button>
        <button type="button" className={css.primary} onClick={() => {
          void api.confirm(sessionId, project.id).then(r => { if (!failureOf(r)) toast(t('toast.confirmed', { version: project.candidate!.version })); setWhich('current'); refresh() })
        }}>{t('play.confirm')}</button>
      </div>
      {rejecting && <div className={css.rejectRow}>
        <input className={css.input} value={reason} placeholder={t('play.rejectReason')} onChange={e => { setReason(e.target.value) }} />
        <button type="button" className={css.ghost} onClick={() => {
          void api.reject(sessionId, project.id, reason).then(() => { setRejecting(false); setReason(''); setWhich('current'); toast(t('toast.rejected')); refresh() })
        }}>{t('play.rejectGo')}</button>
      </div>}
    </div>}

    {check !== null && !check.ok && <button type="button" className={css.strip} data-tone={check.gaveUp ? 'warn' : 'error'} onClick={onOpenVersions}>
      <span className={css.stripDot} aria-hidden="true" />
      <span>{check.gaveUp ? t('play.checkGaveUp') : t('play.checkFailed')}</span>
      <span className={css.stripMeta}>{check.failures[0]?.where}</span>
      <span className={css.stripGo}>{t('play.seeChecks')}</span>
    </button>}

    {project.restyleTo !== undefined && <div className={css.strip} data-tone="info">
      <span className={css.stripDot} aria-hidden="true" />
      <span>{t('play.restyling')}</span>
    </div>}

    <section className={css.stage} aria-label={t('tabs.play')}>
      <div className={css.stageBar}>
        <span className={css.versionPill} data-tone={which === 'candidate' ? 'warn' : 'ok'}>
          {version === undefined ? t('meta.noVersion') : `${which === 'candidate' ? t('play.candidateShort') : t('play.live')} v${version}`}
        </span>
        <span className={css.stageHint}>{picking ? t('play.pickHint') : t('play.focus')}</span>
        {errors.length > 0 && <span className={css.errorPill} title={errors.slice(0, 5).join('\n')}>{t('play.errors', { count: errors.length })}</span>}
        <span className={css.spacer} />
        {bundle !== null && <button type="button" className={css.stageBtn} aria-pressed={picking} onClick={() => { setPicking(p => !p); setPicked(null) }}>{t('play.pick')}</button>}
        {bundle !== null && <button type="button" className={css.stageBtn} onClick={() => { setRun(n => n + 1) }}>{t('play.restart')}</button>}
      </div>
      <div className={css.screen}>
        {error !== null && <p className={css.screenNote}>{t('play.loadFailed', { error })}</p>}
        {version === undefined
          ? <div className={css.screenEmpty}>
              <div className={css.screenGlyph} aria-hidden="true">▶</div>
              <p>{project.hasEntry ? t('play.none') : t('play.noEntry')}</p>
            </div>
          : bundle !== null && <PlayFrame projectId={project.id} version={bundle.version} files={bundle.files} run={run}
              params={values} element={liveElement} picking={picking} label={`${project.title} v${bundle.version}`}
              onPicked={(id, supported) => { setPicked({ id, supported }) }} onErrors={setErrors} onReport={report} />}
      </div>
      {picked !== null && <div className={css.pickCard}>
        {pickedElement !== undefined
          ? <>
              {pickedElement.look !== null ? <LookCanvas look={pickedElement.look} box={32} /> : <span className={css.swatch} />}
              <span className={css.pickName}><strong>{pickedElement.name}</strong><span className={css.metaLine}>{pickedElement.type} · {pickedElement.id}</span></span>
              <button type="button" className={css.ghost} onClick={() => { onOpenElement(pickedElement.id) }}>{t('play.openElement')}</button>
              <button type="button" className={css.primary} onClick={() => {
                if (insertDraft(t('draft.elementRef', { name: pickedElement.name, id: pickedElement.id }))) toast(t('toast.drafted'))
              }}>{t('play.refElement')}</button>
            </>
          : <span className={css.metaLine}>{picked.supported ? t('play.pickNothing') : t('play.pickUnsupported')}</span>}
      </div>}
    </section>

    {params.length > 0 && <section className={css.drawer} aria-label={t('params.title')}>
      <header className={css.drawerHead}>
        <strong>{t('params.title')}</strong>
        <span className={css.metaLine}>{changed.length > 0 ? t('params.changed', { count: changed.length }) : t('params.hint')}</span>
        <span className={css.spacer} />
        <button type="button" className={css.ghost} disabled={changed.length === 0} onClick={() => {
          void api.resetParams(sessionId, project.id).then(() => { setLocal({}); refresh() })
        }}>{t('params.reset')}</button>
        <button type="button" className={css.ghost} disabled={changed.length === 0} onClick={() => {
          void api.finalizeParams(sessionId, project.id).then(() => { toast(t('toast.finalized')); refresh() })
        }}>{t('params.finalize')}</button>
      </header>
      {params.map(p => {
        const value = values[p.key] ?? p.value
        const dirty = value !== p.value
        return <label key={p.key} className={css.param} data-dirty={dirty ? 'true' : 'false'}>
          <span className={css.paramLabel}>{p.label}</span>
          <input type="range" min={p.min} max={p.max} step={p.step} value={value} className={css.range}
            onChange={e => { slide(p, Number(e.target.value)) }} />
          <span className={css.paramValue}>{fmt(value, p.step)}{p.unit === undefined ? '' : <small> {p.unit}</small>}</span>
          {dirty && <span className={css.paramWas} title={t('params.was')}>{fmt(p.value, p.step)}</span>}
        </label>
      })}
    </section>}
    {params.length === 0 && version !== undefined && <p className={css.lead}>{t('params.none')}</p>}

    {version !== undefined && <div className={css.footRow}>
      <button type="button" className={css.link} onClick={() => { clearSaves(project.id); setRun(n => n + 1); toast(t('toast.savesCleared')) }}>{t('play.clearSaves')}</button>
    </div>}
  </div>
}
