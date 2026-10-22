/**
 * 试玩: the stage (the version on the play area, framed like a game screen,
 * with its status strip), the candidate bar when a version waits for the
 * user, the last check's verdict when it failed, the pick mode, and the
 * parameter drawer — sliders that change the running game at once, marked
 * amber where they differ from the finalized value (定稿 / 还原).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PANEL_CHANGES_MARK, type ElementView, type Look3D, type GameParam, type PlayBundle, type ProjectView } from '../types.ts'
import { failureOf, type ViewProps } from './contract.ts'
import { LookCanvas } from './looks.tsx'
import { clearSaves, PlayFrame, type HighlightList, type PickAnswer, type PlayReport } from './PlayFrame.tsx'
import { pickChip } from './refs.ts'
import type { PickRef } from '../vfs.ts'
import css from './GameTab.module.css'

/** Props of the play view. */
export interface PlayViewProps extends ViewProps {
  readonly project: ProjectView
  readonly onOpenElement: (id: string) => void
  readonly onOpenVersions: () => void
}

/** A 3D look's main color, for the small swatch beside a pick. */
function look3dColor(look: Look3D): string | undefined {
  const recipe = look.kind === 'parts3d' ? look : look.recipe
  return recipe?.palette.body ?? Object.values(recipe?.palette ?? {})[0]
}

/** Round a slider value to its step for display. */
function fmt(value: number, step: number): string {
  const decimals = Math.max(0, Math.min(4, -Math.floor(Math.log10(step))))
  return value.toFixed(decimals)
}

/** The play view. */
export function PlayView(props: PlayViewProps): ReactNode {
  const { t, sessionId, api, project, refresh, toast, insertDraft, insertRef, onOpenElement, onOpenVersions } = props
  const [which, setWhich] = useState<'current' | 'candidate'>('current')
  const [bundle, setBundle] = useState<PlayBundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [run, setRun] = useState(0)
  const [errors, setErrors] = useState<readonly string[]>([])
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<{ id: string | null; label: string } | null>(null)
  const [diffOn, setDiffOn] = useState(true)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const record = which === 'candidate' ? project.candidate : project.current
  const version = record?.version
  const loaded = useRef('')
  // Playing is opt-in (2026-10-10): a big game should not start, and cost, on
  // every visit. A new version stops the old run and shows its poster.
  const [playing, setPlaying] = useState(false)
  const [poster, setPoster] = useState<string | null>(null)
  useEffect(() => { setPlaying(false); setPicking(false); setPicked(null) }, [version, which])
  useEffect(() => {
    let live = true
    // The poster of the version on screen (a version without its own shows none, never another build's).
    void api.checkShot(project.id, version).then(r => { if (live) setPoster(r.ok && r.value.ok ? r.value.webp : null) })
    return () => { live = false }
  }, [api, project.id, version, project.lastCheck?.at])

  useEffect(() => { if (project.candidate === null && which === 'candidate') setWhich('current') }, [project.candidate, which])

  useEffect(() => {
    if (!playing) return
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
  }, [api, project.id, which, version, playing])

  // Live slider values: the finalized defaults overlaid with the user's layer.
  const params = project.manifest?.params ?? []
  const [local, setLocal] = useState<Record<string, number>>({})
  useEffect(() => { setLocal({}) }, [project.paramOverrides])
  const values = useMemo(() => Object.fromEntries(params.map(p => [p.key, local[p.key] ?? project.paramOverrides[p.key] ?? p.value])), [params, local, project.paramOverrides])
  const tuned = params.filter(p => values[p.key] !== p.value)

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
  const nameOf = (id: string | null): string | undefined => (id === null ? undefined : project.elements.find(e => e.id === id)?.name)
  const chipOf = (ref: PickRef): { label: string; text: string } => pickChip(ref, nameOf(ref.id), t('play.ground'))
  // A pick goes straight into the composer as a chip (G5); Shift keeps picking for a second reference.
  const onPicked = (answer: PickAnswer): void => {
    if (!answer.supported) { toast(t('play.pickUnsupported')); return }
    if (answer.ref === null) { toast(t('play.pickNothing')); return }
    const chip = chipOf(answer.ref)
    if (insertRef(chip)) toast(t('play.inserted', { label: chip.label }))
    setPicked({ id: answer.ref.ground === true ? null : answer.ref.id, label: chip.label })
    if (!answer.shift) setPicking(false)
  }
  const diff = project.candidateDiff
  const diffCount = diff === null ? 0 : diff.changed.length + diff.added.length
  const highlight: HighlightList | null = which === 'candidate' && diffOn && diff !== null
    ? [...diff.changed.map(id => ({ id, tone: 'changed' as const })), ...diff.added.map(id => ({ id, tone: 'added' as const }))]
    : null
  const check = project.lastCheck

  return <div className={css.scroll}>
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
        <span className={css.stageHint}>{!playing ? t('play.idleHint') : picking ? t('play.pickHint') : t('play.focus')}</span>
        {errors.length > 0 && <span className={css.errorPill} title={errors.slice(0, 5).join('\n')}>{t('play.errors', { count: errors.length })}</span>}
        <span className={css.spacer} />
        {playing && bundle !== null && which === 'candidate' && diffCount > 0 && <button type="button" className={css.stageBtn} aria-pressed={diffOn}
          title={t('play.diffHint')} onClick={() => { setDiffOn(on => !on) }}>{t('play.diff')}</button>}
        {playing && bundle !== null && <button type="button" className={css.stageBtn} aria-pressed={picking} onClick={() => { setPicking(p => !p); setPicked(null) }}>{t('play.pick')}</button>}
        {playing && bundle !== null && <button type="button" className={css.stageBtn} onClick={() => { setRun(n => n + 1) }}>{t('play.restart')}</button>}
        {playing && <button type="button" className={css.stageBtn} onClick={() => { setPlaying(false); setPicking(false); setPicked(null) }}>{t('play.stop')}</button>}
      </div>
      <div className={css.screen}>
        {error !== null && <p className={css.screenNote}>{t('play.loadFailed', { error })}</p>}
        {version === undefined
          ? <div className={css.screenEmpty}>
              <div className={css.screenGlyph} aria-hidden="true">▶</div>
              <p>{project.hasEntry ? t('play.none') : t('play.noEntry')}</p>
            </div>
          : !playing
            ? <button type="button" className={css.poster} onClick={() => { setPlaying(true) }} aria-label={t('play.start', { version })}>
                {poster !== null && <img src={`data:image/webp;base64,${poster}`} alt="" />}
                <span className={css.posterPlay}><span className={css.posterIcon} aria-hidden="true">▶</span>{t('play.start', { version })}</span>
              </button>
          : bundle !== null && <PlayFrame projectId={project.id} version={bundle.version} files={bundle.files} run={run}
              params={values} picking={picking} label={`${project.title} v${bundle.version}`}
              onPicked={onPicked} hoverLabel={ref => chipOf(ref).label} highlight={highlight} onErrors={setErrors} onReport={report} />}
      </div>
      {project.candidate !== null && <div className={css.candBar} data-tone="warn">
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
            const rejected = project.candidate?.version
            void api.reject(sessionId, project.id, reason).then(() => {
              setRejecting(false); setReason(''); setWhich('current')
              if (rejected !== undefined) toast(t('nudge.rejected', { version: rejected }))
              refresh()
            })
          }}>{t('play.rejectGo')}</button>
        </div>}
      </div>}

      {picked !== null && <div className={css.pickCard}>
        {pickedElement !== undefined && pickedElement.look !== null ? <LookCanvas look={pickedElement.look} box={32} />
          : <span className={css.swatch} style={pickedElement?.look3d != null ? { background: look3dColor(pickedElement.look3d) } : undefined} />}
        <span className={css.pickName}><strong>{picked.label}</strong><span className={css.metaLine}>{t('play.pickedNote')}</span></span>
        {pickedElement !== undefined && <button type="button" className={css.ghost} onClick={() => { onOpenElement(pickedElement.id) }}>{t('play.openElement')}</button>}
      </div>}
    </section>

    {params.length > 0 && <section className={css.drawer} aria-label={t('params.title')}>
      <header className={css.drawerHead}>
        <strong>{t('params.title')}</strong>
        <span className={css.metaLine}>{tuned.length > 0 ? t('params.changed', { count: tuned.length }) : t('params.hint')}</span>
        <span className={css.spacer} />
        <button type="button" className={css.ghost} disabled={tuned.length === 0} onClick={() => {
          void api.resetParams(sessionId, project.id).then(() => { setLocal({}); refresh() })
        }}>{t('params.reset')}</button>
        <button type="button" className={css.ghost} disabled={tuned.length === 0} onClick={() => {
          const list = tuned.map(p => `${p.label} ${fmt(p.value, p.step)}→${fmt(values[p.key] ?? p.value, p.step)}`).join('、')
          if (insertDraft(`${PANEL_CHANGES_MARK}${t('params.tellLead', { list })}\n\n`)) toast(t('toast.drafted'))
        }}>{t('params.tell')}</button>
        <button type="button" className={css.ghost} disabled={tuned.length === 0} onClick={() => {
          // 定稿 writes the defaults into game.json and commits at once: the play area moves to a version that has them.
          void api.finalizeParams(sessionId, project.id).then(() => api.commit(sessionId, project.id)).then(r => {
            setLocal({})
            const result = failureOf(r) === undefined && r.ok && r.value.ok ? r.value : undefined
            toast(result?.kind === 'deployed' ? t('commit.deployed', { version: result.version })
              : result?.kind === 'candidate' ? t('commit.candidate', { version: result.version })
              : result?.kind === 'failed' ? t('commit.failedToast') : t('nudge.finalized'))
            refresh()
          })
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
