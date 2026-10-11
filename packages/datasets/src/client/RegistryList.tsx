/**
 * The 题集 tab's list page (T73, headed in T80b): the deployment's registry
 * as ONE table under one header — 仓库 · 题集 / 最新版本 / 题数 / agent 可见 /
 * 用在哪些实验 / 操作 — one row per one-set repository, and a group row over
 * its set rows for a repository with several (T101).
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
 * T90 (decision D): the version cell says 「版本 N · 日期」 — the commit rides on
 * its title, and the repository path, tracked branch and checkout on the
 * group heading's title. A newer tip the update gate holds shows as a
 * 「新版本待确认」 chip that opens its review; 「交给 Agent 修改」 opens a
 * 题集整理 session for the registration.
 *
 * A registration whose tracked branch is gone keeps its group with the one
 * sentence the host gave, so a person can see and fix it — the agents'
 * `datasets_list` simply skips it.
 *
 * T101: a repository with ONE set is ONE row — the repository's name on it,
 * the set id under it only when the two differ — and only a repository with
 * several sets keeps the group row over its set rows. Every row action lives
 * in the last column, 「操作」: 「交给 Agent 修改」 as a word, 「编辑登记」 and
 * 「删除」 behind a ⋯ (three buttons do not fit the reading column beside five
 * data columns; the Agent Note has both shots). A set row's 「操作」 cell is
 * empty — the actions belong to the registration, which the group row is.
 */

import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DatasetsCapabilities, RegisteredSet, RegistryRow } from '../types.ts'
import type { DatasetExperimentRow, DatasetsViewProps } from './contract.ts'
import { capabilityOf, Chevron, Chip, LayersEdit, LayersWordView, shortCommit } from './parts.tsx'
import { MoreMenu } from './more-menu.tsx'
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
 * one experiment fold into one entry (a re-run is not another experiment):
 * by `experimentId`, or, for a run from before experiments had ids, by its
 * name — the older ledger re-ran a plan under the same name, and folding by
 * run id there counted every re-run as another experiment. A version is a
 * distinct pinned commit across all of them.
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
    const key = row.experimentId ?? `name:${row.name}`
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
  /** This instance's gesture availability; null (unanswered) leaves every gesture visible. */
  caps: DatasetsCapabilities | null
  onOpen: (repo: string, dataset: string) => void
  /** 「交给 Agent 修改」: a new 题集整理 session for this registration. */
  onAskAgent: (repo: string) => void
  /** Open the review of the version the update gate holds. */
  onReview: (repo: string) => void
  onEdit: (repo: string) => void
  /** T99 · 「删除」: opens the confirmation that offers delete-with-files and remove-registration-only. */
  onRemove: (repo: string) => void
  t: DatasetsViewProps['t']
}

/** One set's «用在哪些实验» cell: the count, and the names behind a click. */
function UsageCell(props: { usage: SetUsage; t: DatasetsViewProps['t'] }) {
  const { usage, t } = props
  const [open, setOpen] = useState(false)
  const count = usage.experiments.length
  if (count === 0) return <span className={`${css.cellQuiet} ${css.usageNone}`}>{t('list.experimentsNone')}</span>
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

/** True when two names read the same — a display name that only recases its id adds nothing. */
export function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/**
 * The quiet line under a row's name: the set id when the row is named by its
 * repository and the two differ, then the display name when it is more than
 * a recasing of the names already shown.
 * @param named - the name the row already shows in bold.
 * @param set - the set the row stands for.
 * @returns the parts to join, possibly none.
 */
export function quietNames(named: string, set: RegisteredSet): string[] {
  const parts: string[] = []
  if (set.set !== named) parts.push(set.set)
  if (!sameName(set.title, set.set) && !sameName(set.title, named)) parts.push(set.title)
  return parts
}

/** The quiet line itself: each part its own span, so each reads (and is found) alone. */
function QuietNames(props: { parts: readonly string[] }) {
  if (props.parts.length === 0) return null
  return (
    <div className={css.cellQuiet}>
      {props.parts.map((part, index) => (
        <span key={part}>
          {index > 0 && <span aria-hidden="true">{' · '}</span>}
          <span>{part}</span>
        </span>
      ))}
    </div>
  )
}

/** The registration's actions — what the 「操作」 cell holds on its row. */
interface RowActions {
  onAskAgent: (repo: string) => void
  onEdit: (repo: string) => void
  onRemove: (repo: string) => void
  /** This instance's gesture availability; null (unanswered) leaves every action visible. */
  caps: DatasetsCapabilities | null
}

/** The 「操作」 cell of a registration's row: one word button, the rest behind a ⋯. */
function ActionsCell(props: RowActions & { repo: string; t: DatasetsViewProps['t'] }) {
  const { repo, onAskAgent, onEdit, onRemove, caps, t } = props
  const organize = capabilityOf(caps, 'agentOrganize')
  const registration = capabilityOf(caps, 'registration')
  const del = capabilityOf(caps, 'delete')
  // 「删除」 opens a dialog whose other option is unregister (the registration
  // group): the entry hides only when BOTH outcomes are unavailable.
  const menuItems = [
    ...(registration.available ? [{ id: 'edit', label: t('registry.edit') }] : []),
    ...(registration.available || del.available ? [{ id: 'remove', label: t('registry.remove'), danger: true }] : []),
  ]
  return (
    <td className={css.actionsCell}>
      <span className={css.rowActions}>
        {organize.available && (
          <Button variant="outline" size="sm" onClick={() => { onAskAgent(repo) }}>{t('registry.askAgent')}</Button>
        )}
        {menuItems.length > 0 && (
          <MoreMenu
            label={t('registry.more', { id: repo })}
            className={css.moreTrigger}
            items={menuItems}
            onSelect={(id) => {
              if (id === 'edit') onEdit(repo)
              else if (id === 'remove') onRemove(repo)
            }}
          />
        )}
      </span>
    </td>
  )
}

/** The version, item-count, layer and usage cells every set row carries. */
function SetFacts(props: {
  repo: string
  trackedRef: string
  latest: NonNullable<RegistryRow['latest']>
  set: RegisteredSet
  count: number | undefined
  usage: SetUsage | null
  onEdit: (repo: string) => void
  /** The registration group is available: the visible-layers edit shows. */
  canEdit: boolean
  t: DatasetsViewProps['t']
}) {
  const { repo, trackedRef, latest, set, count, usage, onEdit, canEdit, t } = props
  const date = latest.date.slice(0, 10)
  return (
    <>
      <td className={css.latestCell}>
        {latest.version === undefined
          ? (
            <>
              <div className={css.cellMono} title={latest.commit}>{`${trackedRef}@${shortCommit(latest.commit)}`}</div>
              <div className={css.cellQuiet}>{date}</div>
            </>
          )
          : <div title={`${trackedRef}@${latest.commit}`}>{t('registry.version', { number: latest.version, date })}</div>}
      </td>
      <td className={css.cellNumber} data-label={t('registry.itemsUnit')}>{count ?? '—'}</td>
      <td>
        <span className={css.layersCell}>
          <LayersWordView layers={set.layers} t={t} className={css.layersWord} />
          {canEdit && <LayersEdit set={set.ref} onEdit={() => { onEdit(repo) }} t={t} />}
        </span>
      </td>
      {usage !== null && <td className={css.usageCell}><UsageCell usage={usage} t={t} /></td>}
    </>
  )
}

/** The props a set's facts need, shared by the set row and the single-set row. */
interface SetRowProps {
  repo: string
  trackedRef: string
  latest: NonNullable<RegistryRow['latest']>
  set: RegisteredSet
  count: number | undefined
  usage: SetUsage | null
  onOpen: (repo: string, dataset: string) => void
  onEdit: (repo: string) => void
  /** The registration group is available: the visible-layers edit shows. */
  canEdit: boolean
  t: DatasetsViewProps['t']
}

/** One set row under a several-set repository's group row; its 「操作」 cell is empty. */
function SetRow(props: SetRowProps) {
  const { repo, set, onOpen } = props
  const quiet = quietNames(set.set, set)
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
        <QuietNames parts={quiet} />
      </td>
      <SetFacts {...props} />
      <td className={css.actionsCell} />
    </tr>
  )
}

/** The heading a person hovers for the registration's path, branch and checkout. */
function advancedTitle(entry: RegistryRow['entry'], t: DatasetsViewProps['t']): string {
  return t('registry.advancedTitle', {
    path: entry.commonDir,
    ref: entry.trackedRef,
    checkout: entry.authoringCheckout ?? t('registry.noAuthoring'),
  })
}

/** The 「新版本待确认」 chip, when the update gate holds a newer tip. */
function PendingChip(props: { row: RegistryRow; onReview: (repo: string) => void; t: DatasetsViewProps['t'] }) {
  const { row, onReview, t } = props
  if (row.latest?.pending === undefined) return null
  return (
    <button type="button" className={css.emptyLink} onClick={() => { onReview(row.entry.id) }}>
      <Chip tone="warn" title={row.latest.pending.commit}>{t('registry.pending')}</Chip>
    </button>
  )
}

/**
 * A one-set repository's one row (T101): the repository's name opens the
 * set, the set id and display name follow quietly when they add something,
 * and the registration's actions sit in the row's own 「操作」 cell.
 */
function SingleSetRow(props: SetRowProps & RowActions & { row: RegistryRow; onReview: (repo: string) => void }) {
  const { row, set, onOpen, onReview, t } = props
  const repo = row.entry.id
  const quiet = quietNames(repo, set)
  return (
    <tr className={`${css.tableRow} ${css.singleRow}`}>
      <td className={css.nameCell}>
        <div className={css.nameLine} title={advancedTitle(row.entry, t)}>
          <Button
            variant="ghost"
            size="sm"
            className={css.rowOpen}
            title={set.ref}
            onClick={() => { onOpen(repo, set.set) }}
          >
            {repo}
          </Button>
          <PendingChip row={row} onReview={onReview} t={t} />
        </div>
        <QuietNames parts={quiet} />
      </td>
      <SetFacts {...props} />
      <ActionsCell {...props} repo={repo} />
    </tr>
  )
}

/**
 * The list page.
 * @param props - see {@link RegistryListProps}.
 */
export function RegistryList(props: RegistryListProps) {
  const { rows, experiments, itemCounts, caps, onOpen, onAskAgent, onReview, onEdit, onRemove, t } = props
  // The data columns a group row's heading spans; 「最新版本」 and 「操作」 are
  // cells of their own, so hiding that column on a narrow pane (≤720px) keeps
  // every row's visible column count equal instead of growing a ghost column.
  const headingColumns = experiments === null ? 3 : 4
  const actions = { onAskAgent, onEdit, onRemove, caps }
  const canEdit = capabilityOf(caps, 'registration').available
  return (
    <div className={css.listScroll}>
      {/* The 版心 the chat column uses (T83), so the list lines up with the
          conversation beside it instead of spanning a wide pane. */}
      <div className={css.column}>
      <table className={css.table}>
        <thead>
          <tr>
            <th>{t('registry.colSet')}</th>
            <th className={css.latestCell}>{t('registry.colLatest')}</th>
            <th>{t('registry.colItems')}</th>
            <th>{t('registry.colVisible')}</th>
            {experiments !== null && <th>{t('registry.colUsed')}</th>}
            <th className={css.actionsHead}>{t('registry.colActions')}</th>
          </tr>
        </thead>
        {rows.map((row) => {
          const { entry, latest, sets, problem } = row
          const usageOf = (set: string): SetUsage | null =>
            experiments === null ? null : setUsage(experiments, entry.id, set)
          const only = sets.length === 1 ? sets[0] : undefined
          if (latest !== undefined && problem === undefined && only !== undefined) {
            return (
              <tbody key={entry.id} className={css.repoGroup}>
                <SingleSetRow
                  row={row}
                  repo={entry.id}
                  trackedRef={entry.trackedRef}
                  latest={latest}
                  set={only}
                  count={itemCounts[entry.id]?.[only.set]}
                  usage={usageOf(only.set)}
                  onOpen={onOpen}
                  onReview={onReview}
                  canEdit={canEdit}
                  {...actions}
                  t={t}
                />
              </tbody>
            )
          }
          return (
            <tbody key={entry.id} className={css.repoGroup}>
              <tr className={css.repoRow}>
                <td colSpan={headingColumns} className={css.repoCell}>
                  <div className={css.repoHead}>
                    <span className={css.repoName} title={advancedTitle(entry, t)}>{entry.id}</span>
                    <PendingChip row={row} onReview={onReview} t={t} />
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
                <td className={css.latestCell} aria-hidden="true" />
                <ActionsCell repo={entry.id} {...actions} t={t} />
              </tr>
              {latest !== undefined && sets.map(set => (
                <SetRow
                  key={set.set}
                  repo={entry.id}
                  trackedRef={entry.trackedRef}
                  latest={latest}
                  set={set}
                  count={itemCounts[entry.id]?.[set.set]}
                  usage={usageOf(set.set)}
                  onOpen={onOpen}
                  onEdit={onEdit}
                  canEdit={canEdit}
                  t={t}
                />
              ))}
            </tbody>
          )
        })}
      </table>
      </div>
    </div>
  )
}
