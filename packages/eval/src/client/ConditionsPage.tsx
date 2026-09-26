/**
 * The COMPARISON-GROUP table — section ② of 实验设计 (ui-spec §五 v2): the
 * subjects this experiment runs, whether each can run at all, and the diff of
 * any two of them.
 *
 * It was its own sub-page in v1, which is why the conditions a plan used and
 * the plan that used them were never on screen together. It is a section now,
 * filtered by `only` to the groups THIS experiment names — the repository's
 * other declarations are not what a reader is deciding about, and a registry
 * of a dozen pushes the planned grid off the screen.
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
 * Minting POINTS rather than forms. Choosing a model IS minting a comparison
 * group (ui-spec §五), so the place to do it is the 新建实验 wizard's step ②,
 * which mints the group and the plan that uses it in one write (I5·T34); the
 * grid section's 添加对比组 goes there. A second form here would be a second
 * way to write the same file, and the two would drift.
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
import { Chip, Detail, EmptyState, Field, Word, severityKey, severityTone } from './parts.tsx'
import { factorPhrase, shortenValue, splitFactors } from './vocab.ts'
import type { ConditionActionNote } from './store.ts'
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
  /** The column is one the groups differ on (T80d): the cell carries the highlight. */
  differs?: boolean
  editing: boolean
  busy: boolean
  onEdit: () => void
  onSubmit: (value: string) => void
  onCancel: () => void
  t: LabViewProps['t']
}) {
  const { row, differs = false, editing, busy, onEdit, onSubmit, onCancel, t } = props
  if (editing) return <EndpointEditor row={row} busy={busy} onSubmit={onSubmit} onCancel={onCancel} t={t} />
  return (
    <span
      role="button"
      tabIndex={0}
      className={row.endpoint === null ? css.warning : css.mono}
      data-differs={differs ? '' : undefined}
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
      {/* The scoped home is an absolute path: what it holds is the fact, where
          it is belongs under «详情» (ui-spec §九). */}
      <div className={css.dim}>{t('conditions.provisionCredential', { credential: view.credentialState })}</div>
      <Detail summary={t('conditions.provisionHomeFold')}>
        <div className={css.errorDetailLine}>{t('conditions.provisionHome', { dir: view.homeDir, credential: view.credentialState })}</div>
      </Detail>
      {view.checks.map((check, index) => (
        <div key={`${check.code}-${String(index)}`} className={css.checkLine} title={check.code}>
          <Chip tone={severityTone(check.severity)}>{t(severityKey(check.severity))}</Chip>
          <span className={css.checkMessage}>{check.message}</span>
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
            // The path is the diff's own handle on the field; §九 keeps it on
            // hover and puts the field's NAME in the column.
            <div key={entry.path} className={css.diffRow} data-differs="">
              <span className={css.diffPath} title={entry.path}>
                <Word phrase={factorPhrase(entry.path)} t={t} />
              </span>
              <span className={css.diffValue} title={entry.a ?? undefined}>
                {entry.a === null ? <em className={css.dim}>{t('conditions.diffAbsent')}</em> : shortenValue(entry.a)}
              </span>
              <span className={css.diffValue} title={entry.b ?? undefined}>
                {entry.b === null ? <em className={css.dim}>{t('conditions.diffAbsent')}</em> : shortenValue(entry.b)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Field>
  )
}

/** One column the table MAY show: its field name, its factor paths, and how a row reads it. */
interface CompareColumn {
  key: 'harness' | 'model' | 'endpoint' | 'scope' | 'preset'
  label: EvalKey
  /** A factor path belongs to this column when it starts with one of these. */
  paths: readonly string[]
  value: (row: EvalConditionRow) => string | null
}

const COMPARE_COLUMNS: readonly CompareColumn[] = [
  { key: 'harness', label: 'conditions.col.harness', paths: ['harness.', 'drive'], value: row => row.harness === null ? null : `${row.harness}${row.drive === null ? '' : ` · ${row.drive}`}` },
  { key: 'model', label: 'conditions.col.model', paths: ['model.declared'], value: row => row.model },
  { key: 'endpoint', label: 'conditions.col.endpoint', paths: ['model.endpoint', 'endpoint'], value: row => row.endpoint },
  { key: 'scope', label: 'conditions.col.scope', paths: ['scope'], value: row => row.scope },
  { key: 'preset', label: 'conditions.col.preset', paths: ['preset', 'agentPreset'], value: row => row.preset },
]

/**
 * Which columns the table shows, and which of them differ (T80d · P1-4).
 *
 * The table is there to show what separates the subjects, so it lists the
 * fields the rows DISAGREE on — read off the rows themselves, so what is
 * highlighted is exactly what is on screen. The endpoint joins whenever one
 * is unset, because that cell is where it gets fixed. With nothing differing
 * (or one row) the harness and model still say what the subject is.
 * @param rows - the declared rows this experiment names.
 * @returns the columns in display order, each with whether it differs.
 */
export function compareColumns(rows: readonly EvalConditionRow[]): Array<CompareColumn & { differs: boolean }> {
  const marked = COMPARE_COLUMNS.map(column => ({
    ...column,
    differs: rows.length > 1 && new Set(rows.map(row => column.value(row))).size > 1,
  }))
  const shown = marked.filter(column => column.differs || (column.key === 'endpoint' && rows.some(row => row.endpoint === null)))
  if (shown.some(column => column.differs)) return shown
  const base = marked.filter(column => column.key === 'harness' || column.key === 'model')
  return [...base, ...shown.filter(column => !base.some(entry => entry.key === column.key))]
}

/** The group name's hover: the declaration sha, and the scoped-home digest once a lock recorded one. */
export function condIdHover(row: EvalConditionRow, t: LabViewProps['t']): string {
  const own = row.sha ?? row.id
  return row.lock.homeSha === null ? own : `${own}\n${t('conditions.homeShaHover', { sha: row.lock.homeSha })}`
}

/** The cell a column renders for one row. */
function compareCell(column: CompareColumn, row: EvalConditionRow, t: LabViewProps['t']) {
  const value = column.value(row)
  switch (column.key) {
    case 'model': return <span className={css.mono}>{value ?? '—'}</span>
    case 'scope': return <span>{value ?? <span className={css.dim}>{t('conditions.scopeDefault')}</span>}</span>
    default: return <span>{value ?? '—'}</span>
  }
}

/**
 * The comparison-group table.
 * @param props - the registry payload, the picked pair and its diff.
 */
export function ConditionsTable(props: {
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
  /** What the last write had to say — a receipt or a failure, or null. */
  action: ConditionActionNote | null
  /** The condition whose endpoint is open for editing, or null. */
  editing: string | null
  /**
   * The group ids this experiment names. The registry holds every declaration
   * in the repository and only these are the experiment's subjects.
   */
  only: readonly string[]
  /** Which of them judge rather than play — the one thing the columns cannot say. */
  judges: readonly string[]
  /**
   * Every field the experiment's groups disagree on (the list row's
   * `factors`). More than one and the warning says the result can only be
   * described (T80d · P1-4).
   */
  factors?: readonly string[]
  /**
   * The sha each group had when the run started, by id; absent before a
   * start. A row whose declaration moved since carries 「开跑时 / 当前」.
   */
  startedShas?: Readonly<Record<string, string | null>>
  onPick: (id: string) => void
  onProvision: (row: EvalConditionRow) => void
  onEditEndpoint: (id: string | null) => void
  onSetEndpoint: (row: EvalConditionRow, endpoint: string) => void
  t: LabViewProps['t']
}) {
  const {
    view, loading, error, pair, diff, diffError, busy, provision, action, editing, only, judges,
    factors = [], startedShas = {}, onPick, onProvision, onEditEndpoint, onSetEndpoint, t,
  } = props
  const declared = (view?.rows ?? []).filter(row => only.includes(row.id))
  // A group the plan NAMES and the repository does not declare used to be
  // filtered away silently, so an experiment with two absent players showed a
  // one-row table and said nothing about the other two (I5·T67 · W12). It is
  // a row now, carrying the one fact there is about it.
  const absent = only.filter(id => !declared.some(row => row.id === id))
  // Only the players are compared: a judge differs from them by design.
  const players = declared.filter(row => !judges.includes(row.id))
  const columns = compareColumns(players.length > 1 ? players : declared)
  // The state column is for the rows that still need something; a table of
  // ready groups has nothing to say there, and 准备环境 on a ready row was a
  // button that did nothing new (T80d · P2-6).
  const stateShown = absent.length > 0 || declared.some(row => row.status !== 'ready')
  const template = `minmax(150px, 1.2fr) ${columns.map(() => 'minmax(90px, 1fr)').join(' ')}${stateShown ? ' minmax(170px, 1.4fr)' : ''}`
  const same = COMPARE_COLUMNS
    .filter(column => !columns.some(entry => entry.key === column.key))
    .map((column) => {
      const values = new Set(players.map(row => column.value(row)))
      const only1 = [...values][0]
      return values.size === 1 && only1 !== null && only1 !== undefined ? `${t(column.label)} ${only1}` : null
    })
    .filter((entry): entry is string => entry !== null)
  // The spec's own order (the designed variables first), the same order the
  // experiment list's factor cell reads in.
  const ordered = ((split): string[] => [...split.named, ...split.incidental])(splitFactors(factors))
  // A differing field with no column of its own (the scoped-home digest, say)
  // lives in the group name's hover; the warning says so, or a count of three
  // over two highlighted columns reads as a column gone missing (T80d · ②).
  const factorWords = ordered.map((path) => {
    const phrase = factorPhrase(path)
    const word = phrase.params === undefined ? t(phrase.key) : t(phrase.key, phrase.params)
    const columned = columns.some(column => column.paths.some(prefix => path.startsWith(prefix)))
    return columned ? word : t('conditions.factorHover', { field: word })
  })
  return (
    <>
      {loading && view === null && <div className={css.empty}>{t('conditions.loading')}</div>}
      {error !== null && <ErrorState what={t('conditions.error')} message={error} t={t} />}
      {view !== null && declared.length === 0 && absent.length === 0 && (
        <EmptyState title={t('conditions.empty')} hint={t('conditions.emptyHint')} />
      )}
      {(declared.length > 0 || absent.length > 0) && (
        <>
          {/* Above the table, not below it: this is the answer to a button the
              person just pressed, and a registry of a dozen conditions pushes
              anything under it off the screen. */}
          {action?.kind === 'receipt' && <div className={css.notice}>{action.text}</div>}
          {action?.kind === 'failure' && (
            <ErrorState what={action.what} message={action.message} compact t={t} />
          )}
          {provision !== null && <ProvisionReport view={provision} t={t} />}
          <div className={css.compareTable} style={{ ['--compare-cols' as string]: template }}>
            <div className={css.condHead}>
              <span>{t('conditions.col.id')}</span>
              {columns.map(column => <span key={column.key}>{t(column.label)}</span>)}
              {stateShown && <span>{t('conditions.col.ready')}</span>}
            </div>
            {declared.map((row) => {
              const startedSha = startedShas[row.id]
              const moved = startedSha !== undefined && startedSha !== null && row.sha !== null && startedSha !== row.sha
              return (
                // A div rather than a button: the row now holds an input and a
                // button of its own, and interactive content inside a <button> is
                // invalid HTML that browsers resolve by hoisting the children out
                // of it. The picking affordance is kept whole — role, pressed
                // state, tab stop and the Enter/Space keys.
                <div
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  className={css.condRow}
                  aria-pressed={pair.includes(row.id)}
                  title={t('conditions.pickHint')}
                  onClick={() => { onPick(row.id) }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    onPick(row.id)
                  }}
                >
                  {/* The sha is the declaration's identity, not something a
                      reader compares by eye: it is the hover. Only when the
                      declaration moved since the run started does it earn a
                      mark on the page (T80d · ②). */}
                  <span className={css.condId} title={condIdHover(row, t)}>
                    {row.id}
                    {/* A judge is a subject like any other — same declaration,
                        same lock, same readiness gate — and nothing else in this
                        table would say which one it is. */}
                    {judges.includes(row.id) && <Chip>{t('role.judge')}</Chip>}
                    {moved && (
                      <Chip tone="warn" title={t('conditions.shaMoved', { started: startedSha.slice(0, 7), now: (row.sha ?? '').slice(0, 7) })}>
                        {t('conditions.shaMovedChip')}
                      </Chip>
                    )}
                  </span>
                  {columns.map(column => (
                    column.key === 'endpoint'
                      ? (
                        <EndpointCell
                          key={column.key}
                          row={row}
                          differs={column.differs && !judges.includes(row.id)}
                          editing={editing === row.id}
                          busy={busy === row.id}
                          onEdit={() => { onEditEndpoint(row.id) }}
                          onSubmit={(value) => { onSetEndpoint(row, value) }}
                          onCancel={() => { onEditEndpoint(null) }}
                          t={t}
                        />
                      )
                      : (
                        <span key={column.key} data-differs={column.differs && !judges.includes(row.id) ? '' : undefined}>
                          {compareCell(column, row, t)}
                        </span>
                      )
                  ))}
                  {stateShown && (
                    <span
                      className={css.condAction}
                      onClick={(event) => { event.stopPropagation() }}
                      onKeyDown={(event) => { event.stopPropagation() }}
                    >
                      <Chip tone={row.status === 'ready' ? 'ok' : 'warn'} title={lockCell(row, t)}>
                        {t(STATUS_KEY[row.status] ?? 'conditions.unready')}
                      </Chip>
                      {row.status !== 'ready' && <span className={css.dim}>{lockCell(row, t)}</span>}
                      {row.status !== 'ready' && (
                        <Button
                          size="sm"
                          disabled={busy !== null}
                          title={t('conditions.provisionHint')}
                          onClick={() => { onProvision(row) }}
                        >
                          {busy === row.id ? t('conditions.provisioning') : t('conditions.provision')}
                        </Button>
                      )}
                    </span>
                  )}
                </div>
              )
            })}
            {absent.map(id => (
              // Not pickable and not provisionable: there is no declaration to
              // diff or to turn into a scoped home. The row exists so the group
              // is COUNTED — an experiment naming a subject nobody has is a
              // fact about the experiment, not an empty space in a table.
              <div key={`absent/${id}`} className={css.condRow} data-absent="">
                <span className={css.condId} title={id}>{id}</span>
                {columns.map(column => <span key={column.key} className={css.dim}>—</span>)}
                <span><Chip tone="danger">{t('conditions.missing')}</Chip></span>
              </div>
            ))}
          </div>
          {(same.length > 0 || factors.length > 1) && (
            <div className={css.compareFoot}>
              {same.length > 0 && <span className={css.dim}>{t('conditions.same', { fields: same.join(' · ') })}</span>}
              {factors.length > 1 && (
                <span className={css.warning} title={factors.join(', ')}>
                  {t('conditions.differsWarn', { count: factors.length, fields: factorWords.join('、') })}
                </span>
              )}
            </div>
          )}
          {pair.length === 1 && <div className={css.dim}>{t('conditions.pickOne')}</div>}
        </>
      )}
      {diffError !== null && <ErrorState what={t('conditions.diffError')} message={diffError} compact t={t} />}
      {diff !== null && <Diff diff={diff} t={t} />}
    </>
  )
}
