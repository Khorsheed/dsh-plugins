/**
 * The detail's CONDITIONS page (ui-spec §五, step 4): the registry of subjects
 * the dataset repository declares, and the diff of any two of them.
 *
 * The table's columns are the things that make two runs different subjects
 * rather than two samples of one — harness, declared model, scope, preset —
 * plus the two facts that decide whether a subject can run at all: does a lock
 * sit beside the declaration and still match it, and is the condition ready.
 *
 * The diff SHOWS and never chooses. It lists only the fields the two sides
 * disagree on, because a comparison that also listed the agreements would bury
 * the one thing it exists to show; and it makes no claim that the differing
 * fields are the experiment's intended factor, because deciding that depends
 * on things no file knows.
 *
 * 新建条件 POINTS rather than forms. Choosing a model IS minting a condition
 * (ui-spec §五), so the place to do it is the 新建实验 form on the list, which
 * mints the condition and the plan that uses it in one write (I5·T34). A
 * second form here would be a second way to write the same file, and the two
 * would drift.
 */

import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EvalConditionDiffView, EvalConditionRow, EvalConditionsView } from '../types.ts'
import type { LabViewProps } from './contract.ts'
import type { EvalKey } from './locales.ts'
import { ErrorState } from './ErrorState.tsx'
import { Field } from './parts.tsx'
import css from './LabView.module.css'

/** The readiness word of one row, keyed so the copy stays exhaustive. */
const STATUS_KEY: Readonly<Record<string, EvalKey>> = {
  ready: 'conditions.ready',
  unready: 'conditions.unready',
  missing: 'conditions.missing',
}

/** The lock cell: present, matching, and whether a home was ever hashed. */
function lockCell(row: EvalConditionRow, t: LabViewProps['t']): string {
  if (!row.lock.present) return t('conditions.lockNone')
  const state = t(row.lock.matches ? 'conditions.lockOk' : 'conditions.lockStale')
  return row.lock.homeSha === null ? `${state} · ${t('conditions.homeUnhashed')}` : state
}

/** The two-condition diff: only the differing fields, each side highlighted. */
function Diff(props: { diff: EvalConditionDiffView; t: LabViewProps['t'] }) {
  const { diff, t } = props
  return (
    <Field label={t('conditions.diff')}>
      <div className={css.diffHead}>
        <span className={css.mono}>{diff.a.id}</span>
        <span className={css.dim}>vs</span>
        <span className={css.mono}>{diff.b.id}</span>
        <span className={css.dim}>
          {diff.identical
            ? t('conditions.diffIdentical', { a: diff.a.id, b: diff.b.id })
            : t('conditions.diffCount', { count: diff.differences.filter(entry => entry.path !== 'notes').length })}
        </span>
      </div>
      {diff.notesOnly && <div className={css.dim}>{t('conditions.diffNotesOnly')}</div>}
      {diff.differences.length > 0 && (
        <div className={css.diffTable}>
          <div className={css.diffHeadRow}>
            <span>{t('conditions.col.id')}</span>
            <span className={css.mono}>{diff.a.id}</span>
            <span className={css.mono}>{diff.b.id}</span>
          </div>
          {diff.differences.map(entry => (
            <div key={entry.path} className={css.diffRow} data-differs="">
              <span className={css.diffPath}>{entry.path}</span>
              <span className={css.diffValue}>{entry.a ?? <em className={css.dim}>{t('conditions.diffAbsent')}</em>}</span>
              <span className={css.diffValue}>{entry.b ?? <em className={css.dim}>{t('conditions.diffAbsent')}</em>}</span>
            </div>
          ))}
        </div>
      )}
    </Field>
  )
}

/**
 * The conditions page.
 * @param props - the registry payload, the picked pair and its diff.
 */
export function ConditionsPage(props: {
  view: EvalConditionsView | null
  loading: boolean
  error: string | null
  pair: readonly string[]
  diff: EvalConditionDiffView | null
  diffError: string | null
  onPick: (id: string) => void
  t: LabViewProps['t']
}) {
  const { view, loading, error, pair, diff, diffError, onPick, t } = props
  const [newNotice, setNewNotice] = useState(false)
  const rows = view?.rows ?? []
  return (
    <div className={css.overview}>
      {loading && view === null && <div className={css.empty}>{t('conditions.loading')}</div>}
      {error !== null && <ErrorState what={t('conditions.error')} message={error} t={t} />}
      {view !== null && rows.length === 0 && <div className={css.empty}>{t('conditions.empty')}</div>}
      {rows.length > 0 && (
        <>
          <div className={css.actions}>
            <span className={css.dim}>{pair.length === 1 ? t('conditions.pickOne') : t('conditions.pickHint')}</span>
            <span className={css.barSpacer} />
            <Button size="sm" onClick={() => { setNewNotice(true) }}>{t('conditions.new')}</Button>
          </div>
          {newNotice && <div className={css.notice}>{t('conditions.newPlaceholder')}</div>}
          <div className={css.condHead}>
            <span>{t('conditions.col.id')}</span>
            <span>{t('conditions.col.harness')}</span>
            <span>{t('conditions.col.model')}</span>
            <span>{t('conditions.col.scope')}</span>
            <span>{t('conditions.col.preset')}</span>
            <span>{t('conditions.col.lock')}</span>
            <span>{t('conditions.col.ready')}</span>
          </div>
          {rows.map(row => (
            <button
              key={`${row.dataset}/${row.id}`}
              type="button"
              className={css.condRow}
              aria-pressed={pair.includes(row.id)}
              onClick={() => { onPick(row.id) }}
            >
              <span className={css.condId} title={row.sha ?? row.id}>{row.id}</span>
              <span>{row.harness ?? '—'}{row.drive === null ? '' : ` · ${row.drive}`}</span>
              <span className={css.mono}>{row.model ?? '—'}</span>
              <span>{row.scope ?? <span className={css.dim}>{t('conditions.scopeDefault')}</span>}</span>
              <span>{row.preset ?? '—'}</span>
              <span className={css.dim}>{lockCell(row, t)}</span>
              <span className={row.status === 'ready' ? css.ok : css.warning}>
                {t(STATUS_KEY[row.status] ?? 'conditions.unready')}
              </span>
            </button>
          ))}
        </>
      )}
      {diffError !== null && <ErrorState what={t('conditions.diffError')} message={diffError} compact t={t} />}
      {diff !== null && <Diff diff={diff} t={t} />}
      {view !== null && (
        <Field label={t('conditions.repo')}>
          <span className={css.mono}>{view.repo}</span>
          {view.datasets.length > 0 && <span className={css.dim}> · {view.datasets.join(', ')}</span>}
        </Field>
      )}
    </div>
  )
}
