/**
 * The bundle-export dialog: fields → plan check → per-guarded-layer
 * acknowledgement → export.
 *
 * The gate it renders is NOT this file's. eval forwards both steps to
 * mission's own Remote, which resolves which layers are guarded through the
 * datasets probe and re-checks the confirmations against a FRESH plan before
 * writing anything — fail-closed, on mission's side. This dialog's whole job
 * is to make the human tick each guarded layer on purpose; it can neither
 * widen the set nor skip the check, and a dialog left open while the dataset
 * changed simply gets refused.
 *
 * A minimal build of its own rather than a copy of mission's component: the
 * browser half imports nothing from sibling packages (ui-spec R2 and §八).
 *
 * Since I5·T60 the confirm step is ONE action with two products: mission
 * writes the bundle and eval writes `report/summary.md` into it, by the same
 * function `dsh-eval report` calls. The receipt says which files landed, so
 * the page never again ends with a command line for the reader to go and run
 * (I5·T39 · G15).
 */

import { useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EvalExportPlanView } from '../types.ts'
import type { LabViewProps } from './contract.ts'
import { ErrorState } from './ErrorState.tsx'
import css from './LabView.module.css'

/**
 * The export dialog.
 * @param props - the run, the two Remote steps, and the notice sink.
 */
export function ExportDialog(props: {
  runId: string
  open: boolean
  onClose: () => void
  onDone: (notice: string, outDir: string) => void
  planExport: LabViewProps['planExport']
  exportRun: LabViewProps['exportRun']
  sessionId: LabViewProps['sessionId']
  t: LabViewProps['t']
}) {
  const { runId, open, onClose, onDone, planExport, exportRun, sessionId, t } = props
  const [outDir, setOutDir] = useState('')
  const [layers, setLayers] = useState('')
  const [snapshotDir, setSnapshotDir] = useState('')
  const [repo, setRepo] = useState('')
  const [commit, setCommit] = useState('')
  const [dataset, setDataset] = useState('')
  const [plan, setPlan] = useState<EvalExportPlanView | null>(null)
  const [confirmed, setConfirmed] = useState<readonly string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const buildRequest = () => ({
    runId,
    outDir: outDir.trim(),
    layers: layers.split(',').map(layer => layer.trim()).filter(layer => layer !== ''),
    ...(snapshotDir.trim() !== '' ? { snapshotDir: snapshotDir.trim() } : {}),
    ...(repo.trim() !== '' && commit.trim() !== ''
      ? {
        snapshot: {
          repo: repo.trim(),
          commit: commit.trim(),
          ...(dataset.trim() !== '' ? { dataset: dataset.trim() } : {}),
        },
      }
      : {}),
  })

  // Any field edit invalidates the plan: the confirmations a reader ticked
  // belong to the layer set they saw, and this dialog must never carry them
  // over to another one.
  const invalidate = (): void => {
    setPlan(null)
    setConfirmed([])
  }

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
      // The DIRECTORY, not the bundle: it is where the report page looks for
      // `<runId>-bundle` next, and this dialog is the only place a reader can
      // name one the plan never mentions.
      //
      // The receipt names the REPORT too, because one action now writes both
      // (I5·T60). When it could not be written the receipt says so and prints
      // the command — a bundle without its summary is still a bundle, and a
      // silent half-success is what sent a reader to a terminal to find out.
      const written = result.value
      onDone(
        written.reportError === null
          ? t('export.doneWithReport', {
            dir: written.bundleDir, count: written.files,
            summary: written.summaryPath ?? '', rows: written.reportRows,
          })
          : t('export.doneNoReport', { dir: written.bundleDir, count: written.files }),
        outDir.trim(),
      )
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
          <Button size="sm" variant="primary" disabled={busy || plan === null || !allConfirmed} onClick={confirm}>
            {t('export.confirm')}
          </Button>
        </>
      )}
    >
      <div className={css.exportForm}>
        <Input value={outDir} onChange={(e) => { setOutDir(e.target.value); invalidate() }}
          placeholder={t('export.outDir')} aria-label={t('export.outDir')} />
        <Input value={layers} onChange={(e) => { setLayers(e.target.value); invalidate() }}
          placeholder={t('export.layers')} aria-label={t('export.layers')} />
        <Input value={snapshotDir} onChange={(e) => { setSnapshotDir(e.target.value); invalidate() }}
          placeholder={t('export.snapshotDir')} aria-label={t('export.snapshotDir')} />
        <Input value={repo} onChange={(e) => { setRepo(e.target.value); invalidate() }}
          placeholder={t('export.snapshotRepo')} aria-label={t('export.snapshotRepo')} />
        <Input value={commit} onChange={(e) => { setCommit(e.target.value); invalidate() }}
          placeholder={t('export.snapshotCommit')} aria-label={t('export.snapshotCommit')} />
        <Input value={dataset} onChange={(e) => { setDataset(e.target.value); invalidate() }}
          placeholder={t('export.snapshotDataset')} aria-label={t('export.snapshotDataset')} />
        {error !== null && <ErrorState what={t('export.error')} message={error} compact t={t} />}
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
                      : confirmed.filter(entry => entry !== layer))
                  }}
                />
                <span>{t('export.confirmLayer', { layer })}</span>
              </label>
            ))}
          </div>
        )}
        {plan !== null && guarded.length === 0 && (
          <div className={css.dim}>
            {t('export.planOk', { missions: plan.missions, attempts: plan.attempts, dir: plan.bundleDir })}
          </div>
        )}
      </div>
    </Modal>
  )
}
