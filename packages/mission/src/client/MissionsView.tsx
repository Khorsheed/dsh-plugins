/**
 * The missions conversation view (the 'missions' tab beside chat and
 * trajectory): the five-bucket task table. Filter chips (ready / scheduled /
 * blocked / active / done, multi-select), a run scope selector (this session
 * by default, all runs, or one run), then compact rows — # / title / bucket /
 * template state / plan-blocked / duration — with the unreleased-resource
 * warning under each run section. Selecting a row opens the detail panel
 * (attempts, checkpoints, annotations) with the human gestures: retry,
 * release check, and the export-bundle dialog whose guarded-layer checklist
 * is the leak gate's web form (every guarded layer must be individually
 * acknowledged; the host re-checks the confirmed list against a fresh plan).
 *
 * Visual language follows the datasets tab's third-round form: compact rows,
 * hairline separators, tokenized colors, official primitives throughout.
 */

import { useEffect, useState } from 'react'
import { Button, Input, Modal, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  MissionExportPlanView, MissionQueueRun,
} from '../types.ts'
import type { Bucket, MissionView } from '../types.ts'
import type { MissionsViewProps } from './contract.ts'
import type { RunScope } from './store.ts'
import css from './MissionsView.module.css'

const BUCKETS: readonly Bucket[] = ['ready', 'scheduled', 'blocked', 'active', 'done']

/** Compact human duration for the duration column (`47m`, `2h`, `3d`). */
function humanDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** The plan/blocked cell: unmet dependencies first, then the one-shot schedule. */
function planCell(view: MissionView, t: MissionsViewProps['t']): string {
  const parts: string[] = []
  if (view.dependsOn !== undefined && view.dependsOn.length > 0) {
    parts.push(view.blockedOn.length > 0
      ? t('plan.waiting', { ids: view.blockedOn.join(', ') })
      : t('plan.after', { ids: view.dependsOn.join(', ') }))
  }
  if (view.scheduledAt !== undefined) parts.push(new Date(view.scheduledAt).toISOString().slice(0, 16).replace('T', ' '))
  return parts.join('  ') || '—'
}

/** The export dialog: fields → plan check → per-guarded-layer acknowledgement → export. */
function ExportDialog(props: {
  runId: string
  open: boolean
  onClose: () => void
  onDone: (notice: string) => void
  planExport: MissionsViewProps['planExport']
  exportRun: MissionsViewProps['exportRun']
  sessionId: MissionsViewProps['sessionId']
  t: MissionsViewProps['t']
}) {
  const { runId, open, onClose, onDone, planExport, exportRun, sessionId, t } = props
  const [outDir, setOutDir] = useState('')
  const [layers, setLayers] = useState('')
  const [snapshotDir, setSnapshotDir] = useState('')
  const [repo, setRepo] = useState('')
  const [commit, setCommit] = useState('')
  const [dataset, setDataset] = useState('')
  const [plan, setPlan] = useState<MissionExportPlanView | null>(null)
  const [confirmed, setConfirmed] = useState<readonly string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parseLayers = (): string[] => layers.split(',').map(l => l.trim()).filter(l => l !== '')

  const buildRequest = () => ({
    runId,
    outDir: outDir.trim(),
    layers: parseLayers(),
    ...(snapshotDir.trim() !== '' ? { snapshotDir: snapshotDir.trim() } : {}),
    ...(repo.trim() !== '' && commit.trim() !== ''
      ? { snapshot: { repo: repo.trim(), commit: commit.trim(), ...(dataset.trim() !== '' ? { dataset: dataset.trim() } : {}) } }
      : {}),
  })

  const check = (): void => {
    setBusy(true)
    setError(null)
    void planExport(sessionId, buildRequest()).then((result) => {
      setBusy(false)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setPlan(result.value)
      setConfirmed([])
    })
  }

  const confirm = (): void => {
    setBusy(true)
    setError(null)
    void exportRun(sessionId, { ...buildRequest(), confirmed: [...confirmed] }).then((result) => {
      setBusy(false)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      onDone(t('export.done', { dir: result.value.bundleDir, count: result.value.files }))
      onClose()
    })
  }

  const guarded = plan?.guardedLayers ?? []
  const allConfirmed = guarded.every(layer => confirmed.includes(layer))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('export.title')}
      description={t('export.description')}
      closeLabel={t('export.close')}
      footer={(
        <>
          <Button size="sm" onClick={onClose}>{t('export.cancel')}</Button>
          <Button size="sm" variant="outline" disabled={busy || outDir.trim() === ''} onClick={check}>
            {t('export.plan')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || plan === null || !allConfirmed}
            onClick={confirm}
          >
            {t('export.confirm')}
          </Button>
        </>
      )}
    >
      <div className={css.exportForm}>
        <Input value={outDir} onChange={e => { setOutDir(e.target.value); setPlan(null) }}
          placeholder={t('export.outDir')} aria-label={t('export.outDir')} />
        <Input value={layers} onChange={e => { setLayers(e.target.value); setPlan(null) }}
          placeholder={t('export.layers')} aria-label={t('export.layers')} />
        <Input value={snapshotDir} onChange={e => { setSnapshotDir(e.target.value); setPlan(null) }}
          placeholder={t('export.snapshotDir')} aria-label={t('export.snapshotDir')} />
        <Input value={repo} onChange={e => { setRepo(e.target.value); setPlan(null) }}
          placeholder={t('export.snapshotRepo')} aria-label={t('export.snapshotRepo')} />
        <Input value={commit} onChange={e => { setCommit(e.target.value); setPlan(null) }}
          placeholder={t('export.snapshotCommit')} aria-label={t('export.snapshotCommit')} />
        <Input value={dataset} onChange={e => { setDataset(e.target.value); setPlan(null) }}
          placeholder={t('export.snapshotDataset')} aria-label={t('export.snapshotDataset')} />
        {error !== null && <div className={css.exportError}>{t('export.error')}: {error}</div>}
        {plan !== null && guarded.length > 0 && (
          <div className={css.guardedBox}>
            <div className={css.guardedTitle}>{t('export.guardedTitle')}</div>
            {guarded.map(layer => (
              <label key={layer} className={css.guardedItem}>
                <input
                  type="checkbox"
                  checked={confirmed.includes(layer)}
                  onChange={(event) => {
                    setConfirmed(event.target.checked
                      ? [...confirmed, layer]
                      : confirmed.filter(l => l !== layer))
                  }}
                />
                <span>{t('export.confirmLayer', { layer })}</span>
              </label>
            ))}
          </div>
        )}
        {plan !== null && guarded.length === 0 && (
          <div className={css.planOk}>{plan.bundleDir}</div>
        )}
      </div>
    </Modal>
  )
}

/** One run's table section: header line, rows, the unreleased warning. */
function RunSection(props: {
  section: MissionQueueRun
  selection: { runId: string; missionId: string } | null
  onSelect: (runId: string, missionId: string) => void
  now: number
  t: MissionsViewProps['t']
}) {
  const { section, selection, onSelect, now, t } = props
  const { run, rows } = section
  const held = rows.filter(v => v.resourceHeld).map(v => v.id)
  return (
    <div className={css.runSection}>
      <div className={css.runHeader} title={run.id}>
        <span className={css.runId}>{run.id}</span>
        <span className={css.runMeta}>
          {run.templateName ?? '—'} · {t('queue.missionCount', { count: run.missions })}
        </span>
      </div>
      <div className={css.tableHead}>
        <span className={css.colId}>#</span>
        <span className={css.colTitle}>{t('table.title')}</span>
        <span className={css.colBucket}>{t('table.bucket')}</span>
        <span className={css.colState}>{t('table.state')}</span>
        <span className={css.colPlan}>{t('table.plan')}</span>
        <span className={css.colDuration}>{t('table.duration')}</span>
      </div>
      {rows.map((view) => {
        const selected = selection !== null && selection.runId === run.id && selection.missionId === view.id
        return (
          <button
            key={view.id}
            type="button"
            className={selected ? `${css.row} ${css.rowSelected}` : css.row}
            onClick={() => { onSelect(run.id, view.id) }}
          >
            <span className={css.colId}>{view.id}</span>
            <span className={css.colTitle}>{view.title ?? '—'}</span>
            <span className={css.colBucket} data-bucket={view.bucket}>{view.bucket}</span>
            <span className={css.colState}>{view.state}</span>
            <span className={css.colPlan}>{planCell(view, t)}</span>
            <span className={css.colDuration}>
              {view.bucket === 'active' || view.bucket === 'done' ? humanDuration(now - view.enteredCurrentAt) : '—'}
            </span>
          </button>
        )
      })}
      {held.length > 0 && (
        <div className={css.warning}>{t('warning.unreleased', { ids: held.join(', ') })}</div>
      )}
    </div>
  )
}

/**
 * The missions tab body.
 * @param props - composed props (runtime + store + injected + locale shares).
 */
export function MissionsView(props: MissionsViewProps) {
  const {
    sessionId, useStore, actions, t,
    fetchQueue, fetchMission, retryMission, checkReleasable, planExport, exportRun,
  } = props
  const buckets = useStore(s => s.buckets)
  const scope = useStore(s => s.scope)
  const queue = useStore(s => s.queue)
  const loading = useStore(s => s.loading)
  const error = useStore(s => s.error)
  const refreshRev = useStore(s => s.refreshRev)
  const selection = useStore(s => s.selection)
  const detail = useStore(s => s.detail)
  const detailLoading = useStore(s => s.detailLoading)
  const detailError = useStore(s => s.detailError)
  const notice = useStore(s => s.notice)
  const [exportOpen, setExportOpen] = useState(false)
  const now = Date.now()

  // Fetch the queue on mount and whenever the filters or refreshRev move.
  useEffect(() => {
    let cancelled = false
    actions.setLoading(true)
    const request = {
      ...(buckets.length > 0 ? { buckets: [...buckets] } : {}),
      ...(scope === 'all' ? { all: true } : scope !== 'session' ? { runId: scope } : {}),
    }
    void fetchQueue(sessionId, request).then((result) => {
      if (cancelled) return
      actions.setLoading(false)
      if (result.ok) actions.setQueue(result.value)
      else actions.setError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, buckets, scope, refreshRev, actions, fetchQueue])

  // Fetch the selected row's detail.
  useEffect(() => {
    if (selection === null) return
    let cancelled = false
    const target = selection
    actions.setDetailLoading(true)
    void fetchMission(sessionId, { missionId: target.missionId, runId: target.runId }).then((result) => {
      if (cancelled) return
      actions.setDetailLoading(false)
      if (result.ok) actions.setDetail(result.value)
      else actions.setDetailError(result.error.message)
    })
    return () => { cancelled = true }
  }, [sessionId, selection, refreshRev, actions, fetchMission])

  const retry = (): void => {
    if (selection === null) return
    void retryMission(sessionId, { missionId: selection.missionId, runId: selection.runId }).then((result) => {
      if (result.ok) {
        actions.setNotice(t('notice.retried', { attempt: result.value.attempt }))
        actions.refresh()
      } else {
        actions.setNotice(result.error.message)
      }
    })
  }

  const releasable = (): void => {
    if (selection === null) return
    const missionId = selection.missionId
    void checkReleasable(sessionId, { missionId, runId: selection.runId }).then((result) => {
      if (result.ok) {
        actions.setNotice(t(result.value.releasable ? 'notice.releasable' : 'notice.notReleasable', { id: missionId }))
      } else {
        actions.setNotice(result.error.message)
      }
    })
  }

  const sections = queue?.runs ?? []
  const runIds = (queue?.runs ?? []).map(section => section.run.id)

  return (
    <div className={css.view} data-conversation-composer-overlay="">
      <div className={css.filterBar}>
        <div className={css.chips}>
          <button
            type="button"
            className={css.chip}
            aria-pressed={buckets.length === 0}
            onClick={() => { for (const b of [...buckets]) actions.toggleBucket(b) }}
          >
            {t('filter.all')}
          </button>
          {BUCKETS.map(bucket => (
            <button
              key={bucket}
              type="button"
              className={css.chip}
              aria-pressed={buckets.includes(bucket)}
              onClick={() => { actions.toggleBucket(bucket) }}
            >
              {bucket}
            </button>
          ))}
        </div>
        <select
          className={css.scope}
          value={scope}
          aria-label={t('detail.run')}
          onChange={(event) => { actions.setScope(event.target.value as RunScope) }}
        >
          <option value="session">{t('scope.session')}</option>
          <option value="all">{t('scope.all')}</option>
          {runIds.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
      </div>
      {notice !== null && <div className={css.notice}>{notice}</div>}
      <div className={css.body}>
        {loading && queue === null && <div className={css.empty}>{t('queue.loading')}</div>}
        {!loading && error !== null && queue === null && (
          <div className={css.empty}>{t('queue.error')}: {error}</div>
        )}
        {queue !== null && sections.every(s => s.rows.length === 0) && (
          <div className={css.empty}>{t('queue.empty')}</div>
        )}
        {sections.map(section => (
          section.rows.length === 0
            ? null
            : (
              <RunSection
                key={section.run.id}
                section={section}
                selection={selection}
                onSelect={(runId, missionId) => {
                  actions.select(selection?.missionId === missionId && selection.runId === runId
                    ? null
                    : { runId, missionId })
                }}
                now={now}
                t={t}
              />
            )
        ))}
      </div>
      {selection !== null && (
        <div className={css.detail}>
          {detailLoading && <div className={css.empty}>{t('detail.loading')}</div>}
          {!detailLoading && detailError !== null && (
            <div className={css.empty}>{t('detail.error')}: {detailError}</div>
          )}
          {!detailLoading && detail !== null && (
            <div className={css.detailBody}>
              <div className={css.detailLine}>
                <Pill>{selection.missionId}</Pill>
                <span className={css.detailMeta}>
                  {t('detail.run')} {detail.runId} · {t('detail.attempt')} {detail.view.currentAttempt}
                </span>
              </div>
              <div className={css.detailMeta}>
                {t('detail.checkpoints')} {detail.attempts[detail.view.currentAttempt - 1]?.checkpoints.length ?? 0}
                {' · '}{t('detail.annotations')} {detail.annotations.length}
              </div>
              <div className={css.detailActions}>
                <Button size="sm" onClick={retry}>{t('action.retry')}</Button>
                <Button size="sm" onClick={releasable}>{t('action.releasable')}</Button>
                <Button size="sm" variant="outline" onClick={() => { setExportOpen(true) }}>{t('action.export')}</Button>
              </div>
            </div>
          )}
        </div>
      )}
      <ExportDialog
        runId={selection?.runId ?? ''}
        open={exportOpen && selection !== null}
        onClose={() => { setExportOpen(false) }}
        onDone={(text) => { actions.setNotice(text) }}
        planExport={planExport}
        exportRun={exportRun}
        sessionId={sessionId}
        t={t}
      />
    </div>
  )
}
