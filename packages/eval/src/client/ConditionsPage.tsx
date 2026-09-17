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
 *
 * Two things this page DOES write, both added by I5·T58 and both a human's
 * click on one row. **provision** turns the declaration into a real scoped
 * home and locks it — one action, because the same call now corrects the
 * declaration's `home.sha` and re-hashes the condition before minting the lock
 * (the walkthrough's step 4 took the digest out of a terminal and typed it
 * into an editor, then provisioned again · G7). **endpoint** is the one
 * declared field editable here, because the readiness gate refuses a null one
 * and nothing on any page could set it (· G6).
 *
 * Neither is reachable from a model tool, and that is not an oversight: both
 * decide what a subject IS, which R1 keeps beside 批准并启动 and 终评 on the
 * human side.
 */

import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  EvalConditionDiffView, EvalConditionProvisionView, EvalConditionRow, EvalConditionsView,
} from '../types.ts'
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

/** The endpoint cell's own word when the declaration leaves it null. */
const ENDPOINT_UNSET = 'conditions.endpointUnset' as const

/**
 * The open endpoint editor. Its own component so that it MOUNTS when editing
 * starts: the draft value seeds from the declaration each time the cell is
 * opened, rather than surviving a cancel and reappearing as text the person
 * decided against.
 */
function EndpointEditor(props: {
  row: EvalConditionRow
  busy: boolean
  onSubmit: (value: string) => void
  onCancel: () => void
  t: LabViewProps['t']
}) {
  const { row, busy, onSubmit, onCancel, t } = props
  const [value, setValue] = useState(row.endpoint ?? '')
  return (
    <span
      className={css.endpointEdit}
      // The cell's clicks are its own: editing a row must not also toggle the
      // row's diff pick.
      onClick={(event) => { event.stopPropagation() }}
      onKeyDown={(event) => { event.stopPropagation() }}
    >
      <input
        className={css.endpointInput}
        value={value}
        autoFocus
        disabled={busy}
        placeholder={t('conditions.endpointPlaceholder')}
        aria-label={t('conditions.col.endpoint')}
        onChange={(event) => { setValue(event.target.value) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSubmit(value)
          if (event.key === 'Escape') onCancel()
        }}
      />
      <Button size="sm" disabled={busy} onClick={() => { onSubmit(value) }}>{t('conditions.endpointSave')}</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>{t('conditions.endpointCancel')}</Button>
    </span>
  )
}

/**
 * The endpoint cell: the declared value, or the word for «null», with a
 * click-to-edit affordance. Closed it is text, not an input: the field is
 * edited once and read many times, and a live input on every row of a registry
 * reads as a form nobody asked for.
 */
function EndpointCell(props: {
  row: EvalConditionRow
  editing: boolean
  busy: boolean
  onEdit: () => void
  onSubmit: (value: string) => void
  onCancel: () => void
  t: LabViewProps['t']
}) {
  const { row, editing, busy, onEdit, onSubmit, onCancel, t } = props
  if (editing) return <EndpointEditor row={row} busy={busy} onSubmit={onSubmit} onCancel={onCancel} t={t} />
  return (
    <span
      role="button"
      tabIndex={0}
      className={row.endpoint === null ? css.warning : css.mono}
      title={t('conditions.endpointEdit')}
      onClick={(event) => { event.stopPropagation(); onEdit() }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.stopPropagation()
        event.preventDefault()
        onEdit()
      }}
    >
      {row.endpoint ?? t(ENDPOINT_UNSET)}
    </span>
  )
}

/**
 * What the last provision answered: the one sentence that says whether the
 * condition is ready now, then every check line the same way the plan-review
 * page renders them.
 */
function ProvisionReport(props: { view: EvalConditionProvisionView; t: LabViewProps['t'] }) {
  const { view, t } = props
  return (
    <Field label={t('conditions.provisionResult', { id: view.condition })}>
      <div className={view.written ? css.ok : css.warning}>
        {view.written ? t('conditions.provisionWritten') : t('conditions.provisionRefused')}
      </div>
      {view.homeShaWritten && <div className={css.dim}>{t('conditions.provisionWroteBack')}</div>}
      <div className={css.dim}>{t('conditions.provisionHome', { dir: view.homeDir, credential: view.credentialState })}</div>
      {view.checks.map((check, index) => (
        <div
          key={`${check.code}-${String(index)}`}
          className={check.severity === 'error' ? css.warning : check.severity === 'warn' ? css.dim : css.ok}
        >
          {check.severity === 'error' ? '✗' : check.severity === 'warn' ? '!' : '✓'} {check.message}
        </div>
      ))}
    </Field>
  )
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
  /** The condition a write is in flight for, or null. */
  busy: string | null
  /** What the last provision answered, or null. */
  provision: EvalConditionProvisionView | null
  /** The last write's failure, or null. */
  actionError: string | null
  /** The condition whose endpoint is open for editing, or null. */
  editing: string | null
  onPick: (id: string) => void
  onProvision: (row: EvalConditionRow) => void
  onEditEndpoint: (id: string | null) => void
  onSetEndpoint: (row: EvalConditionRow, endpoint: string) => void
  t: LabViewProps['t']
}) {
  const {
    view, loading, error, pair, diff, diffError, busy, provision, actionError, editing,
    onPick, onProvision, onEditEndpoint, onSetEndpoint, t,
  } = props
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
          {/* Above the table, not below it: this is the answer to a button the
              person just pressed, and a registry of a dozen conditions pushes
              anything under it off the screen. */}
          {actionError !== null && <div className={css.notice}>{actionError}</div>}
          {provision !== null && <ProvisionReport view={provision} t={t} />}
          <div className={css.condHead}>
            <span>{t('conditions.col.id')}</span>
            <span>{t('conditions.col.harness')}</span>
            <span>{t('conditions.col.model')}</span>
            <span>{t('conditions.col.endpoint')}</span>
            <span>{t('conditions.col.scope')}</span>
            <span>{t('conditions.col.preset')}</span>
            <span>{t('conditions.col.lock')}</span>
            <span>{t('conditions.col.ready')}</span>
            <span>{t('conditions.col.action')}</span>
          </div>
          {rows.map(row => (
            // A div rather than a button: the row now holds an input and a
            // button of its own, and interactive content inside a <button> is
            // invalid HTML that browsers resolve by hoisting the children out
            // of it. The picking affordance is kept whole — role, pressed
            // state, tab stop and the Enter/Space keys.
            <div
              key={`${row.dataset}/${row.id}`}
              role="button"
              tabIndex={0}
              className={css.condRow}
              aria-pressed={pair.includes(row.id)}
              onClick={() => { onPick(row.id) }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onPick(row.id)
              }}
            >
              <span className={css.condId} title={row.sha ?? row.id}>{row.id}</span>
              <span>{row.harness ?? '—'}{row.drive === null ? '' : ` · ${row.drive}`}</span>
              <span className={css.mono}>{row.model ?? '—'}</span>
              <EndpointCell
                row={row}
                editing={editing === row.id}
                busy={busy === row.id}
                onEdit={() => { onEditEndpoint(row.id) }}
                onSubmit={(value) => { onSetEndpoint(row, value) }}
                onCancel={() => { onEditEndpoint(null) }}
                t={t}
              />
              <span>{row.scope ?? <span className={css.dim}>{t('conditions.scopeDefault')}</span>}</span>
              <span>{row.preset ?? '—'}</span>
              <span className={css.dim}>{lockCell(row, t)}</span>
              <span className={row.status === 'ready' ? css.ok : css.warning}>
                {t(STATUS_KEY[row.status] ?? 'conditions.unready')}
              </span>
              <span
                className={css.condAction}
                onClick={(event) => { event.stopPropagation() }}
                onKeyDown={(event) => { event.stopPropagation() }}
              >
                <Button
                  size="sm"
                  disabled={busy !== null}
                  title={t('conditions.provisionHint')}
                  onClick={() => { onProvision(row) }}
                >
                  {busy === row.id ? t('conditions.provisioning') : t('conditions.provision')}
                </Button>
              </span>
            </div>
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
