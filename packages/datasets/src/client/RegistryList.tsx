/**
 * The 题集 tab's list page (T73, headed in T80b): the deployment's registry
 * as ONE table under one header — 仓库 · 题集 / 最新版本 / 题数 / agent 可见 /
 * 用在哪些实验 — with a group row per repository and a row per set.
 *
 * Every cell answers what an agent will get when it names this row: the
 * reference it uses (`<id>/<set>`, on the set cell's title), the commit
 * «latest» means right now (the tracked branch's tip — never a checkout's
 * HEAD) and when it was made, how many items the set holds there, and what
 * the agent may read, in words (「只看题面 / 含答案」; the layer names ride on
 * the title). The repository's path is not page text (ui-spec §九); it rides
 * on the group heading's title for the person who needs it.
 *
 * The «agent 可见» word is read-only here; its 「改」 opens the registration's
 * edit form (prefilled with the registered layers), which stays the one
 * place a set's visibility is written.
 *
 * «用在哪些实验» is a count, not a list — 「N 个实验 · 分布在 M 个版本」, where a
 * version is a pinned commit — and a click unfolds the names. Twenty names
 * flat in a cell (T76 shot 10) answered a question nobody asked of a list.
 *
 * A registration whose tracked branch is gone keeps its group with the one
 * sentence the host gave, so a person can see and fix it — the agents'
 * `datasets_list` simply skips it.
 */

import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RegisteredSet, RegistryRow } from '../types.ts'
import type { DatasetExperimentRow, DatasetsViewProps } from './contract.ts'
import { Chevron, Chip, LayersEdit, LayersWordView, shortCommit } from './parts.tsx'
import css from './DatasetsView.module.css'

/** One experiment in a set's «用在哪些实验» fold: its name and every commit it pinned. */
export interface SetUsageEntry {
  key: string
  name: string
  /** Distinct pinned commits, in first-seen order; empty when none was recorded. */
  commits: readonly string[]
}

/** A set's usage: how many experiments, over how many pinned versions, and who. */
export interface SetUsage {
  experiments: readonly SetUsageEntry[]
  versions: number
}

/**
 * The experiments that pin one set of one registration.
 *
 * A run matches on the set id AND, when its snapshot names one, on the
 * registration — two registrations may both carry a `default` set. Runs of
 * one experiment fold into one entry (a re-run is not another experiment),
 * and a version is a distinct pinned commit across all of them.
 * @param rows - eval's experiment rows.
 * @param registry - the registration id.
 * @param set - the set id.
 * @returns the usage, possibly empty.
 */
export function setUsage(rows: readonly DatasetExperimentRow[], registry: string, set: string): SetUsage {
  const byKey = new Map<string, { name: string; commits: string[] }>()
  const versions = new Set<string>()
  for (const row of rows) {
    if (row.datasetId !== set) continue
    if (row.registry !== null && row.registry !== registry) continue
    const key = row.experimentId ?? row.id
    const entry = byKey.get(key) ?? { name: row.name, commits: [] }
    byKey.set(key, entry)
    if (row.commit !== null) {
      versions.add(row.commit)
      if (!entry.commits.includes(row.commit)) entry.commits.push(row.commit)
    }
  }
  return {
    experiments: [...byKey].map(([key, entry]) => ({ key, name: entry.name, commits: entry.commits })),
    versions: versions.size,
  }
}

/** The list page's props. */
export interface RegistryListProps {
  rows: readonly RegistryRow[]
  /** null = this instance has no eval plugin: the «用在哪些实验» column never renders. */
  experiments: readonly DatasetExperimentRow[] | null
  /** «题数» per registration, then per set; absent = loading, null = the read failed. */
  itemCounts: Readonly<Record<string, Record<string, number> | null>>
  onOpen: (repo: string, dataset: string) => void
  onNewDataset: (repo: string) => void
  onEdit: (repo: string) => void
  onRemove: (repo: string) => void
  t: DatasetsViewProps['t']
}

/** One set's «用在哪些实验» cell: the count, and the names behind a click. */
function UsageCell(props: { usage: SetUsage; t: DatasetsViewProps['t'] }) {
  const { usage, t } = props
  const [open, setOpen] = useState(false)
  const count = usage.experiments.length
  if (count === 0) return <span className={css.cellQuiet}>{t('list.experimentsNone')}</span>
  return (
    <div className={css.usage}>
      <button type="button" className={css.usageToggle} onClick={() => { setOpen(!open) }} aria-expanded={open}>
        <Chevron open={open} />
        <span>
          {usage.versions === 0
            ? t('registry.usedCountUnpinned', { count })
            : t('registry.usedCount', { count, versions: usage.versions })}
        </span>
      </button>
      {open && (
        <ul className={css.usageList}>
          {usage.experiments.map(entry => (
            <li key={entry.key} className={css.usageRow}>
              <span className={css.usageName}>{entry.name}</span>
              <span className={css.cellMono} title={entry.commits.join('\n')}>
                {entry.commits.length === 0
                  ? t('registry.usedUnpinned')
                  : entry.commits.map(commit => `@${shortCommit(commit)}`).join(' ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** One set row. */
function SetRow(props: {
  repo: string
  trackedRef: string
  latest: NonNullable<RegistryRow['latest']>
  set: RegisteredSet
  count: number | undefined
  usage: SetUsage | null
  onOpen: (repo: string, dataset: string) => void
  onEdit: (repo: string) => void
  t: DatasetsViewProps['t']
}) {
  const { repo, trackedRef, latest, set, count, usage, onOpen, onEdit, t } = props
  return (
    <tr className={css.tableRow}>
      <td className={css.setCell}>
        <Button
          variant="ghost"
          size="sm"
          className={css.rowOpen}
          title={set.ref}
          onClick={() => { onOpen(repo, set.set) }}
        >
          {set.set}
        </Button>
        {set.title !== set.set && <div className={css.cellQuiet}>{set.title}</div>}
      </td>
      <td>
        <div className={css.cellMono} title={latest.commit}>{`${trackedRef}@${shortCommit(latest.commit)}`}</div>
        <div className={css.cellQuiet}>{latest.date.slice(0, 10)}</div>
      </td>
      <td className={css.cellNumber} data-label={t('registry.colItems')}>{count ?? '—'}</td>
      <td>
        <span className={css.layersCell}>
          <LayersWordView layers={set.layers} t={t} className={css.layersWord} />
          <LayersEdit set={set.ref} onEdit={() => { onEdit(repo) }} t={t} />
        </span>
      </td>
      {usage !== null && <td><UsageCell usage={usage} t={t} /></td>}
    </tr>
  )
}

/**
 * The list page.
 * @param props - see {@link RegistryListProps}.
 */
export function RegistryList(props: RegistryListProps) {
  const { rows, experiments, itemCounts, onOpen, onNewDataset, onEdit, onRemove, t } = props
  // Removal is a two-step gesture: the first click arms, the second removes.
  const [armed, setArmed] = useState<string | null>(null)
  const columns = experiments === null ? 4 : 5
  return (
    <div className={css.listScroll}>
      <table className={css.table}>
        <thead>
          <tr>
            <th>{t('registry.colSet')}</th>
            <th>{t('registry.colLatest')}</th>
            <th>{t('registry.colItems')}</th>
            <th>{t('registry.colVisible')}</th>
            {experiments !== null && <th>{t('registry.colUsed')}</th>}
          </tr>
        </thead>
        {rows.map(({ entry, latest, sets, problem }) => (
          <tbody key={entry.id} className={css.repoGroup}>
            <tr className={css.repoRow}>
              <td colSpan={columns}>
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
              </td>
            </tr>
            {latest !== undefined && sets.map(set => (
              <SetRow
                key={set.set}
                repo={entry.id}
                trackedRef={entry.trackedRef}
                latest={latest}
                set={set}
                count={itemCounts[entry.id]?.[set.set]}
                usage={experiments === null ? null : setUsage(experiments, entry.id, set.set)}
                onOpen={onOpen}
                onEdit={onEdit}
                t={t}
              />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}
