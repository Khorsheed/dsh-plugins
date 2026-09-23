/**
 * The 题集 tab's list page (T73): the deployment's registry, grouped by
 * repository, one row per set — `set · trackedRef@short · date · layers`.
 *
 * Every cell answers what an agent will get when it names this row: the
 * reference it uses (`<id>/<set>`, on the set cell's title), the commit
 * «latest» means right now (the tracked branch's tip — never a checkout's
 * HEAD), when that commit was made, and the layers it may read. The
 * repository's path is not page text (ui-spec §九); it rides on the group
 * heading's title for the person who needs it.
 *
 * A registration whose tracked branch is gone keeps its group with the one
 * sentence the host gave, so a person can see and fix it — the agents'
 * `datasets_list` simply skips it.
 */

import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RegistryRow } from '../types.ts'
import type { DatasetExperimentRow, DatasetsViewProps } from './contract.ts'
import { Chip, shortCommit } from './parts.tsx'
import css from './DatasetsView.module.css'

/** The list page's props. */
export interface RegistryListProps {
  rows: readonly RegistryRow[]
  /** null = this instance has no eval plugin: the «用于» line never renders. */
  experiments: readonly DatasetExperimentRow[] | null
  onOpen: (repo: string, dataset: string) => void
  onNewDataset: (repo: string) => void
  onEdit: (repo: string) => void
  onRemove: (repo: string) => void
  t: DatasetsViewProps['t']
}

/**
 * The list page.
 * @param props - see {@link RegistryListProps}.
 */
export function RegistryList(props: RegistryListProps) {
  const { rows, experiments, onOpen, onNewDataset, onEdit, onRemove, t } = props
  // Removal is a two-step gesture: the first click arms, the second removes.
  const [armed, setArmed] = useState<string | null>(null)
  return (
    <div className={css.listScroll}>
      {rows.map(({ entry, latest, sets, problem }) => (
        <section key={entry.id} className={css.repoGroup}>
          <div className={css.repoHead}>
            <span className={css.repoName} title={entry.commonDir}>{entry.id}</span>
            <span className={css.cellQuiet}>{t('registry.tracking', { ref: entry.trackedRef })}</span>
            <span className={css.cellQuiet}>
              {entry.authoringCheckout === null ? t('registry.noAuthoring') : t('registry.authoring')}
            </span>
            <span className={css.repoActions}>
              {entry.authoringCheckout !== null && (
                <Button size="sm" onClick={() => { onNewDataset(entry.id) }}>{t('list.newDataset')}</Button>
              )}
              <Button size="sm" onClick={() => { onEdit(entry.id) }}>{t('registry.edit')}</Button>
              {armed === entry.id
                ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setArmed(null)
                      onRemove(entry.id)
                    }}
                  >
                    {t('registry.removeConfirm')}
                  </Button>
                )
                : <Button size="sm" variant="ghost" onClick={() => { setArmed(entry.id) }}>{t('registry.remove')}</Button>}
            </span>
          </div>
          {problem !== undefined && (
            <div className={css.repoProblem}>
              <Chip tone="danger" title={problem}>{t('registry.problem')}</Chip>
              <span className={css.cellQuiet}>{t('registry.problemFix')}</span>
            </div>
          )}
          {problem === undefined && sets.length === 0 && (
            <div className={css.repoProblem}>
              <span className={css.cellQuiet}>{t('registry.noSets', { ref: entry.trackedRef })}</span>
            </div>
          )}
          {latest !== undefined && sets.length > 0 && (
            <table className={css.table}>
              <tbody>
                {sets.map((set) => {
                  const used = experiments?.filter(experiment => experiment.datasetId === set.set) ?? []
                  return (
                    <tr key={set.set} className={css.tableRow}>
                      <td>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={css.rowOpen}
                          title={set.ref}
                          onClick={() => { onOpen(entry.id, set.set) }}
                        >
                          {set.set}
                        </Button>
                        {set.title !== set.set && <div className={css.cellQuiet}>{set.title}</div>}
                      </td>
                      <td className={css.cellMono} title={latest.commit}>
                        {`${entry.trackedRef}@${shortCommit(latest.commit)}`}
                      </td>
                      <td className={css.cellMono}>{latest.date.slice(0, 10)}</td>
                      <td>{t('registry.rowLayers', { layers: set.layers.join(', ') })}</td>
                      {experiments !== null && (
                        <td className={css.cellQuiet}>
                          {used.length === 0
                            ? t('list.experimentsNone')
                            : t('registry.usedBy', { names: used.map(experiment => experiment.name).join(', ') })}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  )
}
