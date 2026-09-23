/**
 * 运行记录 — the second of the four stages (ui-spec §五 v2): the same GRID the
 * design stage drew from the plan, now filled in by the ledger, and under it
 * one row per run record — item × comparison group × rep, run state, verdict,
 * elapsed, attempts — with the record's detail on the right.
 *
 * The grid and the list were two separate sub-pages in v1 (矩阵 and 格子), so
 * the picture of the run and the rows of the run were never on screen
 * together and a reader had to remember one while looking at the other. They
 * are one page here, and the grid's dots open the row's detail directly.
 *
 * The drawer is where the three human gestures live: re-run with a reason,
 * ask the release gate, and export the bundle. It also opens the delegation's
 * child session through the host's own session controller, which is how a
 * person reads what the player actually did — a read, not an intervention.
 *
 * Since I5·T69 it answers 「跑了什么、交了什么」 without leaving the page.
 * WHAT IT SUBMITTED: an attachment row expands in place through
 * `cellArtifact`, so `stage1.md` is read where it is listed instead of being
 * a path with a note saying a file service is missing. WHAT IT DID: the
 * player's transcript was already a host session and always had a button;
 * the JUDGE's rounds are sessions in exactly the same sense and had none, so
 * «为什么判成这样» could only be answered from a verdict's one-line evidence.
 * Both are the host's own child-session view — this page renders no
 * transcript of its own, because a second renderer of a conversation is a
 * second place for it to be wrong.
 *
 * The expanded attachment is NOT de-identified, deliberately. This panel
 * names the comparison group in its own header, so scrubbing the material
 * here would hide the harness's words from the person debugging it while
 * protecting nothing. The blind read is the judge bench's, over the same
 * files, through the run's own scrub table.
 *
 * Every ledger token on this page goes through the word table (ui-spec §九):
 * the bucket chips, the stage column, the attempt list and the retry category
 * picker all showed mission's own English tokens before, which is the half of
 * 「mixed (archived / ws-ready)」 that this page was responsible for. The
 * VERIFY block is the one exception and stays verbatim on purpose — ui-spec §五
 * asks for 「verify 原样输出」, and an exit code nobody translated is the whole
 * reason the drawer is opened.
 */

import type { ReactNode } from 'react'
import { useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  EvalCellArtifactView, EvalCellDetail, EvalCellRow, EvalCellsResult, EvalMatrixView,
} from '../types.ts'
import type { LabViewProps } from './contract.ts'
import { ErrorState } from './ErrorState.tsx'
import { LiveGrid } from './Grid.tsx'
import type { EvalKey } from './locales.ts'
import { Chip, Detail, Duration, EmptyState, Hash, VerdictChip, Word, bucketTone, stageTone } from './parts.tsx'
import {
  RETRY_CATEGORIES, bucketPhrase, retryPhrase, stagePhrase, verdictKey, verdictSourceOf, verdictSourcesOf,
} from './vocab.ts'
import { RUN_FILTERS, type RunFilter } from './store.ts'
import css from './LabView.module.css'

/**
 * Whether one record passes the reader's filter (ui-spec §五 v2's five).
 *
 * 「失败」 is the one that is not a bucket: mission projects a `halted` cell
 * into `done` — it IS finished — and a person scanning for what went wrong
 * means the ledger state, not the projection. Applied in the browser over the
 * whole run so the counts beside the chips count one population.
 * @param row - the record.
 * @param filter - the chip that is pressed.
 * @returns whether the row is kept.
 */
/**
 * The ledger states in which nothing more will happen to a cell.
 *
 * `inStateMs` is measured from the last transition to NOW, which is a useful
 * number while a cell is moving and a misleading one once it has stopped: a
 * released cell reads 「已释放 · 2 天 1 小时」, and the 2 days are how long ago
 * the run ended rather than anything the cell spent (I5·T67 · W4).
 */
const TERMINAL_STATES: ReadonlySet<string> = new Set(['archived', 'releasable', 'released', 'halted'])

export function passesFilter(row: Pick<EvalCellRow, 'state' | 'bucket'>, filter: RunFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'failed') return row.state === 'halted'
  if (filter === 'done') return row.bucket === 'done' && row.state !== 'halted'
  return row.bucket === filter
}

export { RETRY_CATEGORIES } from './vocab.ts'

/**
 * How long each stage of one attempt took, from the ledger's own transition
 * times.
 *
 * The ledger records WHEN each transition was applied, so a duration is the
 * gap between one transition and the next — and the last state has no next,
 * so it has no duration rather than an invented one running to «now». A
 * transition the ledger did not time at all breaks the chain on both sides,
 * which is reported as a segment with no duration rather than by silently
 * measuring across the hole.
 * @param history - applied transitions, oldest first.
 * @returns one segment per state entered, in order.
 */
export function timelineOf(
  history: ReadonlyArray<{ from: string; to: string; at: number | null }>,
): Array<{ state: string; at: number | null; ms: number | null }> {
  if (history.length === 0) return []
  const first = history[0] as { from: string; at: number | null }
  const segments = [{ state: first.from, at: null as number | null, ms: null as number | null }]
  for (const [index, entry] of history.entries()) {
    const next = history[index + 1]
    const ms = entry.at === null || next === undefined || next.at === null ? null : next.at - entry.at
    // The state it moved INTO started when the transition was applied.
    segments.push({ state: entry.to, at: entry.at, ms })
    // …and the state it moved OUT of ended there, so that is its length.
    const previous = segments[segments.length - 2]
    if (previous !== undefined && previous.at !== null && entry.at !== null) previous.ms = entry.at - previous.at
  }
  return segments
}

/**
 * The ns → count map the verdict lookup takes, from the detail's own list.
 *
 * The LIST hands a cell its counts as a record and the DETAIL hands them as
 * rows; the authority rule is one function either way, so the shapes are
 * reconciled here rather than by teaching it two.
 * @param cell - the open record.
 * @returns ns → how many annotations the cell carries.
 */
function annotationCounts(cell: EvalCellDetail): Record<string, number> {
  return Object.fromEntries(cell.annotations.map(ns => [ns.ns, ns.count]))
}

/** Artifacts carry mission's own `kind`; a person reads a name. */
const ARTIFACT_KEYS: Readonly<Record<string, EvalKey>> = {
  'materialization': 'artifact.materialization',
  'archive': 'artifact.archive',
  'verdicts': 'artifact.verdicts',
  'log': 'artifact.log',
}

/** The word for one artifact kind; an unmapped kind keeps its token as a parameter. */
function artifactPhrase(kind: string): { key: EvalKey; params?: Record<string, string> } {
  const known = ARTIFACT_KEYS[kind]
  if (known !== undefined) return { key: known }
  if (/^stage/.test(kind)) return { key: 'artifact.stage' }
  return { key: 'artifact.other', params: { kind } }
}

/**
 * ONE expanded attachment. Three shapes, because the read has three honest
 * answers and collapsing them would mean inventing a fourth.
 *
 * TEXT is shown verbatim in a `<pre>`, the same treatment the verify output
 * gets and for the same reason: a stage submission is the thing the reader
 * came for, and re-flowing it would change what it says. It is NOT rendered
 * as markdown — `stage1.md` is evidence here, not a document, and a renderer
 * would silently hide a malformed heading or an unclosed fence, which on this
 * page is a finding rather than a blemish.
 *
 * A DIRECTORY (`archive`, `probe-verdicts` — both recorded as artifacts) lists
 * its entries, each one clickable into the same pane. Without this a reader
 * clicking 归档 would get nothing at all and no sentence saying why.
 *
 * A REFUSED BINARY says what it is and how big. The host says no by NAME
 * rather than by sniffing bytes, so the reason is always printable.
 */
function ArtifactPane(props: {
  view: EvalCellArtifactView | null
  loading: boolean
  error: string | null
  onOpenArtifact: (path: string) => void
  t: LabViewProps['t']
}) {
  const { view, loading, error, onOpenArtifact, t } = props
  if (error !== null) return <ErrorState what={t('record.artifactError')} message={error} compact t={t} />
  // Null with no error is the read in flight — the request is issued the
  // moment the row is clicked, so there is no third state to name.
  void loading
  if (view === null) return <div className={css.dim}>{t('record.artifactLoading')}</div>
  return (
    <div className={css.artifactPane}>
      {view.note !== null && <div className={css.dim}>{view.note}</div>}
      {view.kind === 'text' && <pre className={css.pre}>{view.text ?? ''}</pre>}
      {view.kind === 'directory' && (
        view.entries.length === 0
          ? <div className={css.dim}>{t('record.artifactDirEmpty')}</div>
          : view.entries.map(entry => (
            <button
              key={entry}
              type="button"
              className={css.artifactRow}
              onClick={() => { onOpenArtifact(`${view.path}/${entry}`) }}
            >
              <span className={css.mono}>{entry}</span>
            </button>
          ))
      )}
      {view.kind === 'binary' && view.bytes !== null && (
        <div className={css.dim}>{t('record.artifactBytes', { bytes: view.bytes })}</div>
      )}
    </div>
  )
}

/** One labelled block of the record detail. */
function Field(props: { label: string; children: ReactNode }) {
  return (
    <div className={css.field}>
      <div className={css.fieldLabel}>{props.label}</div>
      <div className={css.fieldValue}>{props.children}</div>
    </div>
  )
}

/** One row of the parameter table: a word, and the value behind it. */
function Param(props: { label: string; children: ReactNode }) {
  return (
    <div className={css.paramRow}>
      <span className={css.paramLabel}>{props.label}</span>
      <span className={css.paramValue}>{props.children}</span>
    </div>
  )
}

/**
 * ONE run record in full (ui-spec §五 v2): the verdict at the top, how long
 * each stage took, the parameters it ran under, its artifacts, and the three
 * human gestures.
 *
 * v1 put the mission id, the raw `kind` of every artifact and a JSON receipt
 * on the page and left a reader to reconstruct the rest. What a person opens
 * this for is three questions — did it work, where did the time go, and what
 * did it actually run with — so those are the first three blocks, and the
 * receipts (attempts, annotation namespaces, the verify output) stay below
 * them, the verify output still verbatim because an exit code nobody
 * translated is the whole reason the panel is opened.
 */
function RecordDetail(props: {
  cell: EvalCellDetail | null
  loading: boolean
  error: string | null
  onClose: () => void
  onRetry: (reason: string, category: string) => void
  onRelease: () => void
  onExport: () => void
  onOpenSession: (sessionId: string, parentSessionId: string | null) => void
  /** Which attachment is expanded, and what the read answered with. */
  artifactPath: string | null
  artifact: EvalCellArtifactView | null
  artifactLoading: boolean
  artifactError: string | null
  onOpenArtifact: (path: string | null) => void
  t: LabViewProps['t']
}) {
  const {
    cell, loading, error, onClose, onRetry, onRelease, onExport, onOpenSession,
    artifactPath, artifact, artifactLoading, artifactError, onOpenArtifact, t,
  } = props
  const [reason, setReason] = useState('')
  const [category, setCategory] = useState<string>(RETRY_CATEGORIES[0] as string)
  const attempt = cell === null
    ? undefined
    : cell.attempts.find(entry => entry.attempt === cell.attempt)
  const verdict = cell === null ? null : verdictSourceOf(annotationCounts(cell))
  // Every layer this record carries, not just the most authoritative one: the
  // report merges per criterion, so a record with both is scored from both.
  const verdictSources = cell === null ? [] : verdictSourcesOf(annotationCounts(cell))
  // 成功 / 异常 is the ledger's, not a judgement: `halted` is the one state
  // that says this cell stopped rather than finished.
  const halted = cell?.state === 'halted'
  const segments = timelineOf(attempt?.history ?? [])
  // The scale the timeline bars are drawn against: this record's own longest
  // segment. Across records the units are the same but the runs are not, so a
  // shared scale would say something about other cells that this panel is not
  // showing.
  const longest = Math.max(0, ...segments.map(segment => segment.ms ?? 0))

  return (
    <div className={css.drawer}>
      <div className={css.drawerBar}>
        <span className={css.title}>
          {cell === null ? '' : t('record.head', { task: cell.task ?? '—', condition: cell.condition ?? '—', rep: cell.rep ?? '—' })}
        </span>
        <span className={css.barSpacer} />
        <Button size="sm" onClick={onClose}>{t('drawer.close')}</Button>
      </div>
      <div className={css.drawerBody}>
        {loading && cell === null && <div className={css.empty}>{t('drawer.loading')}</div>}
        {error !== null && <ErrorState what={t('drawer.error')} message={error} compact t={t} />}
        {cell !== null && (
          <>
            {/* The head: the verdict this record carries, big, with where it
                came from — and what the ledger says became of the cell. The
                NUMBER is not here and says so; see `verdictSourceOf`. */}
            <div className={css.recordHead}>
              <span className={css.recordVerdict}>{t(verdictKey(verdict))}</span>
              <Chip tone={halted ? 'danger' : 'ok'}>{t(halted ? 'record.failed' : 'record.ok')}</Chip>
              <Chip tone={stageTone(cell.state)} title={cell.state}>
                <Word phrase={stagePhrase(cell.state)} t={t} />
              </Chip>
              {(cell.bucket === 'blocked' || cell.bucket === 'scheduled') && (
                <Chip tone={bucketTone(cell.bucket)} title={cell.bucket}>
                  <Word phrase={bucketPhrase(cell.bucket)} t={t} />
                </Chip>
              )}
            </div>
            {/* Which layers this record carries, and the one sentence that
                says the number is not here. Both, because since the merge the
                top layer alone is not the record's scoring source — it is
                only the most authoritative of the ones scoring it. */}
            {verdictSources.length > 1 && (
              <div className={css.dim}>
                {t('record.scoreMixed', { sources: verdictSources.map(source => t(verdictKey(source))).join(' + ') })}
              </div>
            )}
            {verdict !== null && <div className={css.dim}>{t('record.scoreWhere')}</div>}

            <Field label={t('record.timeline')}>
              {segments.length === 0
                ? <span className={css.dim}>{t('record.timelineNone')}</span>
                : (
                  <div className={css.timeline}>
                    {segments.map((segment, index) => (
                      <div key={`${segment.state}:${String(index)}`} className={css.timelineRow}>
                        <Chip tone={stageTone(segment.state)} title={segment.state} className={css.timelineChip}>
                          <Word phrase={stagePhrase(segment.state)} t={t} />
                        </Chip>
                        {/* As long as the state lasted, against the longest
                            state of THIS record. A segment the ledger did not
                            time draws no bar at all — an unmeasured state and
                            an instant one must not look the same. */}
                        <span className={css.timelineTrack}>
                          {segment.ms !== null && longest > 0 && (
                            <span
                              className={css.timelineBar}
                              style={{ width: `${String(Math.round((segment.ms / longest) * 100))}%` }}
                            />
                          )}
                        </span>
                        <span className={css.dim}>
                          {segment.ms === null ? '—' : <Duration ms={segment.ms} t={t} />}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
            </Field>

            <Field label={t('record.params')}>
              <div className={css.paramTable}>
                <Param label={t('record.param.task')}>{cell.task ?? '—'}</Param>
                <Param label={t('record.param.condition')}>{cell.condition ?? '—'}</Param>
                <Param label={t('record.param.rep')}>{cell.rep ?? '—'}</Param>
                <Param label={t('record.param.attempt')}>{cell.attempt}</Param>
                <Param label={t('record.param.judge')}>{t(verdictKey(verdict))}</Param>
                <Param label={t('record.param.material')}><Hash value={cell.materializationSha} /></Param>
                <Param label={t('record.param.fingerprint')}><Hash value={cell.refs.fingerprint} /></Param>
                <Param label={t('record.param.unit')}>
                  {cell.refs.resource === null
                    ? <span className={css.dim}>{t('drawer.resourceNone')}</span>
                    : <span className={css.mono}>{cell.refs.resource}</span>}
                </Param>
                {/* Whatever else the ledger labelled this cell with, in its own
                    words — the four above are the labels eval writes, and a
                    dataset that labels more should not have them disappear. */}
                {Object.entries(cell.labels)
                  .filter(([key]) => !['task', 'condition', 'rep'].includes(key))
                  .map(([key, value]) => <Param key={key} label={key}>{value}</Param>)}
              </div>
            </Field>

            <Field label={t('record.attachments')}>
              {(attempt?.artifacts ?? []).length === 0
                ? <span className={css.dim}>{t('record.attachmentsNone')}</span>
                : (attempt?.artifacts ?? []).map((entry) => {
                  const phrase = artifactPhrase(entry.kind)
                  const open = artifactPath === entry.path
                  return (
                    <div key={entry.path}>
                      {/* The PATH is the hover, the name is the row (§九) —
                          and the row is now the thing that opens it. A second
                          click closes: the panel shows ONE attachment, so
                          「点开」 and 「收起」 are the same gesture. */}
                      <button
                        type="button"
                        className={css.artifactRow}
                        aria-expanded={open}
                        title={entry.path}
                        onClick={() => { onOpenArtifact(open ? null : entry.path) }}
                      >
                        <span>{phrase.params === undefined ? t(phrase.key) : t(phrase.key, phrase.params)}</span>
                        <span className={css.dim}>{entry.path.split('/').pop() ?? entry.path}</span>
                      </button>
                      {open && (
                        <ArtifactPane
                          view={artifact}
                          loading={artifactLoading}
                          error={artifactError}
                          onOpenArtifact={onOpenArtifact}
                          t={t}
                        />
                      )}
                    </div>
                  )
                })}
            </Field>

            {/* The JUDGE's own rounds. A judge is a delegation like the
                player's, so its transcript is a host session in exactly the
                same sense — it simply had no door here, which left «为什么判成
                这样» answerable only from the verdict's evidence line. */}
            {cell.judgeSessions.length > 0 && (
              <Field label={t('record.judgeRounds')}>
                {cell.judgeSessions.map(round => (
                  <div key={`${round.judgeCondition ?? ''}:${String(round.sample ?? 0)}:${String(round.at)}`} className={css.annotationLine}>
                    <span className={css.mono}>{round.judgeCondition ?? '—'}</span>
                    <span className={css.dim}>
                      {round.sample === null ? '' : t('record.judgeSample', { sample: round.sample })}
                      {round.judgeModel === null ? '' : ` · ${round.judgeModel}`}
                      {round.selfJudged ? ` · ${t('record.judgeSelf')}` : ''}
                    </span>
                    {round.error !== null && <span className={css.dim}>{round.error}</span>}
                    <Button
                      size="sm"
                      disabled={round.childSessionId === null}
                      title={round.childSessionId === null ? t('record.judgeNoSession') : undefined}
                      onClick={() => { if (round.childSessionId !== null) onOpenSession(round.childSessionId, cell.parentSessionId) }}
                    >
                      {t('record.openJudgeSession')}
                    </Button>
                  </div>
                ))}
              </Field>
            )}

            <Detail summary={t('drawer.attempts')}>
              {cell.attempts.map(entry => (
                <div key={entry.attempt} className={css.annotationLine}>
                  <span className={css.dim}>{t('drawer.attemptNo', { attempt: entry.attempt })}</span>
                  {entry.state === null
                    ? <span className={css.dim}>—</span>
                    : (
                      <Chip tone={stageTone(entry.state)} title={entry.state}>
                        <Word phrase={stagePhrase(entry.state)} t={t} />
                      </Chip>
                    )}
                  {entry.retry !== null && (
                    <span className={css.dim}>
                      {entry.retry.category === null
                        ? ''
                        : <Word phrase={retryPhrase(entry.retry.category)} t={t} title={entry.retry.category} />}
                      {entry.retry.reason === null ? '' : `: ${entry.retry.reason}`}
                    </span>
                  )}
                </div>
              ))}
              {(attempt?.checkpoints ?? []).length > 0 && (
                <div className={css.errorDetailLine}>
                  {t('drawer.checkpoints')}: {(attempt?.checkpoints ?? []).map(checkpoint => checkpoint.name).join(' → ')}
                </div>
              )}
              {cell.annotations.map(ns => (
                <div key={ns.ns} className={css.annotationLine}>
                  <span className={css.mono}>{ns.ns}</span>
                  <span>{ns.count}</span>
                  <span className={css.dim}>{ns.latest ?? ''}{ns.by === null ? '' : ` · ${ns.by}`}</span>
                </div>
              ))}
            </Detail>

            <Field label={t('drawer.probes')}>
              {cell.probes.length === 0
                ? <span className={css.dim}>{t('drawer.probesNone')}</span>
                : cell.probes.map(run => (
                  <div key={run.at} className={css.probeRun}>
                    <div className={css.dim}>{run.where ?? '—'}</div>
                    {run.probes.map(probe => (
                      <div key={`${probe.probe ?? ''}:${probe.origin ?? ''}`} className={css.annotationLine}>
                        <Chip tone={probe.ok ? 'ok' : 'warn'} title={probe.outcome ?? undefined}>
                          {t(probe.ok ? 'drawer.probeOk' : 'drawer.probeFailed')}
                        </Chip>
                        <span className={css.mono}>{probe.probe ?? '—'}</span>
                        <span className={css.dim}>
                          {probe.outcome ?? '—'}
                          {probe.exitCode === null ? '' : ` · exit ${probe.exitCode}`}
                          {probe.reason === null ? '' : ` · ${probe.reason}`}
                          {probe.error === null ? '' : ` · ${probe.error}`}
                        </span>
                      </div>
                    ))}
                    {/* Verbatim: the exit codes and skip reasons are exactly
                        what this panel is opened for (ui-spec §五). */}
                    <pre className={css.pre}>{run.raw}</pre>
                  </div>
                ))}
            </Field>

            <div className={css.drawerActions}>
              <Button
                size="sm"
                disabled={cell.childSessionId === null}
                title={cell.childSessionId === null ? t('drawer.noSession') : undefined}
                onClick={() => { if (cell.childSessionId !== null) onOpenSession(cell.childSessionId, cell.parentSessionId) }}
              >
                {t('drawer.openSession')}
              </Button>
              <select
                className={css.select}
                value={category}
                aria-label={t('retry.category')}
                onChange={(event) => { setCategory(event.target.value) }}
              >
                {RETRY_CATEGORIES.map((entry) => {
                  const phrase = retryPhrase(entry)
                  return (
                    <option key={entry} value={entry}>
                      {phrase.params === undefined ? t(phrase.key) : t(phrase.key, phrase.params)}
                    </option>
                  )
                })}
              </select>
              <Input
                value={reason}
                onChange={(event) => { setReason(event.target.value) }}
                placeholder={t('retry.reason')}
                aria-label={t('retry.reason')}
              />
              <Button
                size="sm"
                disabled={reason.trim() === ''}
                onClick={() => { onRetry(reason.trim(), category); setReason('') }}
              >
                {t('action.retry')}
              </Button>
              <Button size="sm" onClick={onRelease}>{t('action.release')}</Button>
              <Button size="sm" variant="outline" onClick={onExport}>{t('action.export')}</Button>
            </div>
            {cell.childSessionId === null && <div className={css.dim}>{t('drawer.noSession')}</div>}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The run-records stage body: the grid, the five filters, the list, and the
 * record's detail.
 * @param props - both payloads, the open record, and every gesture's handler.
 */
export function RunsPage(props: {
  /** The arranged grid; null before it loads (or while an arrangement changes). */
  matrix: EvalMatrixView | null
  matrixLoading: boolean
  matrixError: string | null
  onColumn: (factor: string) => void
  onToggleGroup: (factor: string) => void
  onFilter: (factor: string, value: string | null) => void
  cells: EvalCellsResult | null
  loading: boolean
  error: string | null
  filter: RunFilter
  onSetFilter: (filter: RunFilter) => void
  selection: string | null
  cell: EvalCellDetail | null
  cellLoading: boolean
  cellError: string | null
  onOpenCell: (missionId: string | null) => void
  onRetry: (reason: string, category: string) => void
  onRelease: () => void
  onExport: () => void
  onOpenSession: (sessionId: string, parentSessionId: string | null) => void
  /** The open record's expanded attachment (see {@link ArtifactPane}). */
  artifactPath: string | null
  artifact: EvalCellArtifactView | null
  artifactLoading: boolean
  artifactError: string | null
  onOpenArtifact: (path: string | null) => void
  /** The (题目 × 对比组) a 结果对比 click narrowed the list to, or null. */
  focus: { task: string; condition: string } | null
  onClearFocus: () => void
  /** Single-group runs say so once, above the grid, with the way out. */
  onAddGroup: () => void
  /**
   * Minutes since the run last moved, when it is STALLED (T72 §7): no live
   * job and no progress for longer than the threshold. Null otherwise.
   */
  stalledMinutes?: number | null
  /** Start the plan again as a new run — the stall line's one action. */
  onRerun?: () => void
  t: LabViewProps['t']
}) {
  const {
    matrix, matrixLoading, matrixError, onColumn, onToggleGroup, onFilter,
    cells, loading, error, filter, onSetFilter, selection, focus, onClearFocus, onAddGroup,
    stalledMinutes = null, onRerun, t,
  } = props
  const rows = cells?.rows ?? []
  // The verdict source per record, looked up by the grid. Both halves of this
  // page are already in hand, so the grid gets 「有判定即显示」 from the list's
  // own payload rather than from a projection that would have to carry it.
  const verdicts = new Map(rows.map(row => [row.missionId, verdictSourceOf(row.annotations)]))
  // The report's click narrows the list to one (题目 × 对比组), and the chip
  // above it is the only way back out — a filter a reader cannot see is a
  // list that is lying about how many records the run has.
  //
  // The five bucket chips count within that narrowing, not across the run:
  // the counts and the rows have to describe ONE population, or a chip reads
  // 「失败 3」 over an empty list.
  const population = focus === null
    ? rows
    : rows.filter(row => row.task === focus.task && row.condition === focus.condition)
  const shown = population.filter(row => passesFilter(row, filter))
  const counts = Object.fromEntries(
    RUN_FILTERS.map(entry => [entry, population.filter(row => passesFilter(row, entry)).length]),
  ) as Record<RunFilter, number>
  // The comparison groups the ledger actually ran — the honest source for
  // 「只有一个对比组」, which a plan can claim and a `--only` run can contradict.
  const groups = new Set(rows.map(row => row.condition).filter((id): id is string => id !== null))

  return (
    <div className={css.cellsPage}>
      {/* Above the grid, because a stalled grid looks exactly like a running
          one: the cells sit in the state they were left in. */}
      {stalledMinutes !== null && (
        <div className={css.blocked}>
          <div>{t('runs.stalled', { minutes: stalledMinutes })}</div>
          {onRerun !== undefined && (
            <div className={css.actions}>
              <Button size="sm" variant="primary" onClick={onRerun}>{t('cta.stalled')}</Button>
            </div>
          )}
        </div>
      )}
      {groups.size === 1 && (
        <div className={css.notice}>
          <div>{t('design.single')}</div>
          <div className={css.actions}>
            <Button size="sm" onClick={onAddGroup}>{t('design.addGroup')}</Button>
          </div>
        </div>
      )}
      {matrixError !== null && <ErrorState what={t('matrix.error')} message={matrixError} t={t} />}
      {matrix === null && matrixError === null && <div className={css.empty}>{t('matrix.loading')}</div>}
      {matrix !== null && (
        <LiveGrid
          matrix={matrix}
          loading={matrixLoading}
          verdictOf={missionId => verdicts.get(missionId) ?? null}
          onColumn={onColumn}
          onToggleGroup={onToggleGroup}
          onFilter={onFilter}
          onOpenCell={(missionId) => { props.onOpenCell(missionId) }}
          t={t}
        />
      )}

      {focus !== null && (
        <div className={css.notice}>
          <div>{t('runs.focus', { task: focus.task, condition: focus.condition, matched: shown.length })}</div>
          <div className={css.actions}>
            <Button size="sm" onClick={onClearFocus}>{t('runs.focusClear')}</Button>
          </div>
        </div>
      )}
      <div className={css.matrixBar}>
        {RUN_FILTERS.map(entry => (
          <button
            key={entry}
            type="button"
            className={css.chip}
            aria-pressed={filter === entry}
            onClick={() => { onSetFilter(entry) }}
          >
            {t(`runs.filter.${entry}`)}
            <span className={css.chipCount}>{counts[entry]}</span>
          </button>
        ))}
        <span className={css.barSpacer} />
        {cells !== null && (
          <span className={css.dim}>{t('runs.filtered', { matched: shown.length, total: population.length })}</span>
        )}
      </div>
      <div className={css.cellsSplit}>
        <div className={css.cellsTable}>
          {error !== null && <ErrorState what={t('cells.error')} message={error} t={t} />}
          {cells === null && error === null && <div className={css.empty}>{t('cells.loading')}</div>}
          {cells !== null && shown.length === 0 && (
            <EmptyState title={t('cells.empty')} hint={t('cells.emptyHint')}>
              {filter !== 'all' && (
                <Button size="sm" onClick={() => { onSetFilter('all') }}>{t('cells.emptyClear')}</Button>
              )}
            </EmptyState>
          )}
          {shown.length > 0 && (
            <>
              <div className={css.cellsHead}>
                <span className={css.colCell}>{t('cells.col.cell')}</span>
                <span className={css.colState}>{t('cells.col.state')}</span>
                <span className={css.colVerdict}>{t('runs.col.verdict')}</span>
                <span className={css.colDuration}>{t('cells.col.duration')}</span>
                <span className={css.colAttempt}>{t('cells.col.attempt')}</span>
              </div>
              {shown.map(row => (
                <button
                  key={row.missionId}
                  type="button"
                  className={selection === row.missionId ? `${css.cellsRow} ${css.rowSelected}` : css.cellsRow}
                  onClick={() => { props.onOpenCell(selection === row.missionId ? null : row.missionId) }}
                >
                  <span className={css.colCell}>
                    {row.task ?? '—'} × {row.condition ?? '—'} × {row.rep ?? '—'}
                  </span>
                  {/* One 运行状态 column (ui-spec §九 术语表 v2). The STAGE is the
                      specific fact and always shows; the bucket only adds
                      something the stage cannot say — «阻塞» (a dependency is
                      unmet) and «排期» (it is waiting for a clock). For every
                      other bucket the stage already implies it, and two chips
                      saying one thing is the noise this pass is removing. */}
                  <span className={css.colState}>
                    <Chip tone={stageTone(row.state)} title={row.state}>
                      <Word phrase={stagePhrase(row.state)} t={t} />
                    </Chip>
                    {(row.bucket === 'blocked' || row.bucket === 'scheduled') && (
                      <Chip tone={bucketTone(row.bucket)} title={row.bucket}>
                        <Word phrase={bucketPhrase(row.bucket)} t={t} />
                      </Chip>
                    )}
                  </span>
                  <span className={css.colVerdict}><VerdictChip annotations={row.annotations} t={t} /></span>
                  {/* A cell that is FINISHED has not been «in this state» for
                      two days in any sense a reader cares about — the ledger
                      measures from the last transition to now, and for a
                      terminal state that is just how long ago the run ended.
                      An em dash says «nothing is elapsing here» (W4); the time
                      a finished record actually took is on its timeline. */}
                  <span className={css.colDuration}>
                    {TERMINAL_STATES.has(row.state)
                      ? <span className={css.dim} title={t('runs.settled')}>—</span>
                      : <Duration ms={row.inStateMs} t={t} />}
                  </span>
                  <span className={css.colAttempt}>{row.attempt}</span>
                </button>
              ))}
            </>
          )}
          {loading && cells !== null && <div className={css.dim}>{t('cells.loading')}</div>}
        </div>
        {selection !== null && (
          <RecordDetail
            cell={props.cell}
            loading={props.cellLoading}
            error={props.cellError}
            onClose={() => { props.onOpenCell(null) }}
            onRetry={props.onRetry}
            onRelease={props.onRelease}
            onExport={props.onExport}
            onOpenSession={props.onOpenSession}
            artifactPath={props.artifactPath}
            artifact={props.artifact}
            artifactLoading={props.artifactLoading}
            artifactError={props.artifactError}
            onOpenArtifact={props.onOpenArtifact}
            t={t}
          />
        )}
      </div>
    </div>
  )
}
