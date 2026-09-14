/**
 * The 题集 tab's list page (ui-spec §四): one row per dataset — the set, the
 * snapshot it was read at, how many items it holds, which layer fills each
 * slot, whether a canary is declared, what `validate` says, and which
 * experiments have used it.
 *
 * A table, not a tree. The old tab opened with a layer tree, and a layer name
 * is an implementation detail of ONE dataset's authoring — the reader arriving
 * at this tab is choosing among sets, and every cell here answers a question
 * they can act on. The «槽位 ← 层» cell is the one place layer names still
 * appear, and only as the right-hand side of the mapping.
 *
 * The «用于的实验» cell degrades to nothing: an instance without the eval
 * plugin has no notion of an experiment, and a column of em dashes would
 * promise a feature that is not installed.
 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { DATASET_SLOTS } from '../slots.ts'
import type { DatasetOverviewRow } from '../types.ts'
import type { DatasetExperimentRow, DatasetsViewProps } from './contract.ts'
import { slotKey, snapshotCell } from './parts.tsx'
import css from './DatasetsView.module.css'

/** The «validate» cell: what the check found, or why there is no answer. */
function ValidateCell(props: { row: DatasetOverviewRow; t: DatasetsViewProps['t'] }) {
  const { row, t } = props
  if (row.validate === null) return <span className={css.cellQuiet}>{t('list.validateUnknown')}</span>
  const { errors, warnings } = row.validate
  if (errors > 0) {
    return (
      <span className={css.cellError} title={row.validate.firstError ?? undefined}>
        {t('list.validateErrors', { count: errors })}
      </span>
    )
  }
  return (
    <span className={css.cellQuiet}>
      {t('list.validateOk')}
      {warnings > 0 && ` · ${t('list.validateWarnings', { count: warnings })}`}
    </span>
  )
}

/** The «槽位 ← 层» cell: one line per slot this dataset actually has files for. */
function SlotCell(props: { row: DatasetOverviewRow; t: DatasetsViewProps['t'] }) {
  const { row, t } = props
  const lines = DATASET_SLOTS
    .filter(slot => row.slotLayers[slot] !== undefined)
    .map(slot => ({
      slot,
      layers: (row.slotLayers[slot] ?? []).map(layer => (layer === '-' ? t('list.passthroughLayer') : layer)).join(', '),
    }))
  if (lines.length === 0) return <span className={css.cellQuiet}>—</span>
  return (
    <span className={css.slotCell}>
      {lines.map(line => (
        <span key={line.slot} className={css.slotCellLine}>
          {t('list.slotLayer', { slot: t(slotKey(line.slot)), layers: line.layers })}
        </span>
      ))}
    </span>
  )
}

/** The «用于的实验» cell — absent entirely when no eval plugin answered. */
function ExperimentCell(props: {
  row: DatasetOverviewRow
  experiments: readonly DatasetExperimentRow[]
  t: DatasetsViewProps['t']
}) {
  const { row, experiments, t } = props
  const mine = experiments.filter(experiment => experiment.datasetId === row.id)
  if (mine.length === 0) return <span className={css.cellQuiet}>{t('list.experimentsNone')}</span>
  return (
    <span className={css.slotCell}>
      {mine.map(experiment => (
        <span key={experiment.id} className={css.slotCellLine}>{experiment.name}</span>
      ))}
    </span>
  )
}

/**
 * The list page.
 * @param props - the rows, the actions above them, and the locale seat.
 */
export function DatasetList(props: {
  repo: string
  commit: string
  rows: readonly DatasetOverviewRow[]
  /** null = this instance has no eval plugin: the column does not render at all. */
  experiments: readonly DatasetExperimentRow[] | null
  onOpen: (dataset: string) => void
  t: DatasetsViewProps['t']
}) {
  const { repo, commit, rows, experiments, onOpen, t } = props
  const snapshot = snapshotCell(repo, commit)
  return (
    <div className={css.listScroll}>
      <table className={css.table}>
        <thead>
          <tr>
            <th>{t('list.colDataset')}</th>
            <th>{t('list.colSnapshot')}</th>
            <th>{t('list.colItems')}</th>
            <th>{t('list.colSlots')}</th>
            <th>{t('list.colCanary')}</th>
            <th>{t('list.colValidate')}</th>
            {experiments !== null && <th>{t('list.colExperiments')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id} className={css.tableRow}>
              <td>
                <Button variant="ghost" size="sm" className={css.rowOpen} onClick={() => { onOpen(row.id) }}>
                  {row.id}
                </Button>
                {row.name !== undefined && <div className={css.cellQuiet}>{row.name}</div>}
              </td>
              <td className={css.cellMono} title={repo}>{snapshot}</td>
              <td className={css.cellNumber}>{t('list.itemCount', { count: row.itemCount })}</td>
              <td><SlotCell row={row} t={t} /></td>
              <td className={row.canary ? css.cellQuiet : css.cellWarn}>
                {row.canary ? t('list.canaryOn') : t('list.canaryOff')}
              </td>
              <td><ValidateCell row={row} t={t} /></td>
              {experiments !== null && <td><ExperimentCell row={row} experiments={experiments} t={t} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
