/**
 * 版本: the last check (verdict, findings, the screenshot the headless run
 * took), the version timeline (current / candidate / rejected / past, with
 * 切回 and 与当前对比), the playtest log, and the single-file export.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { ProjectView, VersionDiff, VersionRow } from '../types.ts'
import { exportHtml } from '../vfs.ts'
import { failureOf, type ViewProps } from './contract.ts'
import css from './GameTab.module.css'

/** Props of the versions view. */
export interface VersionsViewProps extends ViewProps {
  readonly project: ProjectView
}

/** `MM-DD HH:mm` in local time. */
export function shortTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Download a text file from the panel (a user gesture in the host page). */
function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/html' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => { URL.revokeObjectURL(url) }, 2000)
}

/** The versions view. */
export function VersionsView({ t, sessionId, api, project, refresh, toast, changed }: VersionsViewProps): ReactNode {
  const check = project.lastCheck
  const [shot, setShot] = useState<string | null>(null)
  const [diffFor, setDiffFor] = useState<number | null>(null)
  const [diff, setDiff] = useState<VersionDiff | null>(null)
  const current = project.current?.version

  useEffect(() => {
    let live = true
    void api.checkShot(project.id).then(r => { if (live) setShot(r.ok && r.value.ok ? r.value.webp : null) })
    return () => { live = false }
  }, [api, project.id, check?.at])

  useEffect(() => {
    if (diffFor === null || current === undefined) { setDiff(null); return }
    let live = true
    void api.diff(project.id, diffFor, current).then(r => { if (live) setDiff(r.ok && r.value.ok ? r.value.diff : null) })
    return () => { live = false }
  }, [api, project.id, diffFor, current])

  const exportVersion = (version: number): void => {
    void api.versionBundle(project.id, version).then(r => {
      if (!(r.ok && r.value.ok)) { toast(t('versions.exportFailed')); return }
      download(`${project.title}-v${version}.html`, exportHtml(project.title, r.value.bundle.files))
      toast(t('toast.exported', { version }))
    })
  }

  return <div className={css.scroll}>
    <section className={css.block}>
      <h4 className={css.blockTitle}>{t('versions.lastCheck')}</h4>
      {check === null
        ? <p className={css.lead}>{t('checks.none')}</p>
        : <div className={css.checkCard} data-tone={check.ok ? 'ok' : check.gaveUp ? 'warn' : 'error'}>
            <div className={css.checkHead}>
              <strong>{check.ok ? t('checks.ok') : t('checks.fail')}</strong>
              <span className={css.metaLine}>
                {shortTime(check.at)}
                {check.attempt > 0 ? ` · ${t('checks.attempt', { attempt: check.attempt })}` : ''}
                {check.passed > 0 ? ` · ${t('checks.passed', { count: check.passed })}` : ''}
              </span>
            </div>
            <ol className={css.layers}>
              <li data-ok={check.failures.some(f => f.where === 'data' || f.where.startsWith('elements/')) ? 'false' : 'true'}>{t('checks.layerData')}</li>
              <li data-ok={check.skipped !== undefined ? 'skip' : check.failures.some(f => f.where === 'smoke') ? 'false' : 'true'}>{t('checks.layerSmoke')}</li>
              <li data-ok={check.skipped !== undefined ? 'skip' : check.failures.some(f => f.where.startsWith('tests/')) ? 'false' : 'true'}>{t('checks.layerTests')}</li>
            </ol>
            {check.gaveUp === true && <p className={css.warnText}>{t('checks.gaveUp')}</p>}
            {check.skipped !== undefined && <p className={css.metaLine}>{check.skipped}</p>}
            {check.failures.length > 0 && <ul className={css.findings}>
              {check.failures.map((f, i) => <li key={i}><code>{f.where}</code><span>{f.message}</span></li>)}
            </ul>}
            {shot !== null && <figure className={css.shot}>
              <img src={`data:image/webp;base64,${shot}`} alt={t('versions.shotAlt')} />
              <figcaption className={css.metaLine}>{t('versions.shotCaption')}</figcaption>
            </figure>}
          </div>}
    </section>

    <section className={css.block}>
      <h4 className={css.blockTitle}>{t('versions.title')}</h4>
      {project.versions.length === 0 && <p className={css.lead}>{t('versions.none')}</p>}
      <ol className={css.timeline}>
        {project.versions.map((v: VersionRow) => <li key={v.version} className={css.tlItem} data-status={v.status}>
          <span className={css.tlDot} aria-hidden="true" />
          <div className={css.tlBody}>
            <div className={css.tlHead}>
              <strong>v{v.version}</strong>
              <span className={css.tlTag} data-status={v.status}>{t(`versions.status.${v.status}`)}</span>
              <span className={css.metaLine}>{shortTime(v.at)}</span>
            </div>
            {v.note !== undefined && <span className={css.metaLine}>{v.note}</span>}
            <div className={css.tlActions}>
              {v.status !== 'current' && v.status !== 'candidate' && <button type="button" className={css.link} onClick={() => {
                void api.rollback(sessionId, project.id, v.version).then(r => { if (failureOf(r) === undefined) changed('rollback', t('toast.rolledBack', { version: v.version })); refresh() })
              }}>{t('versions.rollback')}</button>}
              {current !== undefined && v.version !== current && <button type="button" className={css.link} aria-pressed={diffFor === v.version}
                onClick={() => { setDiffFor(d => (d === v.version ? null : v.version)) }}>{t('versions.compare', { version: current })}</button>}
              <button type="button" className={css.link} onClick={() => { exportVersion(v.version) }}>{t('versions.export')}</button>
            </div>
            {diffFor === v.version && diff !== null && <div className={css.diff}>
              {diff.added.length + diff.removed.length + diff.changed.length === 0 && <span className={css.metaLine}>{t('versions.same')}</span>}
              {diff.changed.map(f => <span key={f} data-kind="changed">~ {f}</span>)}
              {diff.added.map(f => <span key={f} data-kind="added">+ {f}</span>)}
              {diff.removed.map(f => <span key={f} data-kind="removed">− {f}</span>)}
            </div>}
          </div>
        </li>)}
      </ol>
    </section>

    <section className={css.block}>
      <h4 className={css.blockTitle}>{t('versions.share')}</h4>
      <p className={css.metaLine}>{t('versions.shareNote')}</p>
      <div className={css.rowEnd}>
        <button type="button" className={css.primary} disabled={current === undefined} onClick={() => { if (current !== undefined) exportVersion(current) }}>{t('versions.exportCurrent')}</button>
      </div>
      <p className={css.metaLine}>{t('versions.later')}</p>
    </section>

    <section className={css.block}>
      <h4 className={css.blockTitle}>{t('versions.log')}</h4>
      {project.log.length === 0 && <p className={css.metaLine}>{t('versions.logEmpty')}</p>}
      <ul className={css.logList}>{project.log.slice(0, 30).map((e, i) => <li key={i}><span className={css.logTime}>{shortTime(e.at)}</span><span>{e.text}</span></li>)}</ul>
    </section>
  </div>
}
