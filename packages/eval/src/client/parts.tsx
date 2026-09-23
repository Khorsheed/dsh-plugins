/**
 * The primitives every page of this tab is built out of, and the row-derived
 * cells the list and the plan review share.
 *
 * ui-spec §九 asks for ONE set of these across both tabs — the status chip,
 * the empty seat, the section box, the rep dots, the table classes — so that
 * 「运行中」 in the list, in the matrix and in the cell drawer is one component
 * with one stylesheet rule rather than three colourings that drift. The 题集
 * tab carries a byte-identical copy of {@link Chip}, {@link EmptyState},
 * {@link Section} and {@link Word}; the two are kept the same by hand for the
 * reason ui-spec §八 gives (a client bundle never imports a sibling plugin).
 *
 * {@link Field}, {@link StartedRun}, {@link snapshotCell} and {@link factorCell}
 * are eval's own: the plan-review page shows the same snapshot / matrix /
 * factors / judge / environment header the overview does, and copy that
 * drifted between them would read as a data disagreement.
 */

import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EvalExperimentRow, EvalExperimentStatus, EvalRunOutputView } from '../types.ts'
import type { LabViewProps } from './contract.ts'
import { ErrorState } from './ErrorState.tsx'
import type { EvalKey } from './locales.ts'
import type { LabStartedRun } from './store.ts'
import {
  agreementBand, compactCount, durationParts, factorPhrase, shortHash, splitFactors, verdictKey,
  verdictSourceOf, type Phrase,
} from './vocab.ts'
import css from './LabView.module.css'

/**
 * How loud a chip is. The tone is the CHIP's, not the caller's colour: a page
 * says what a state MEANS (`warn` = a human has something to do) and the
 * stylesheet decides what that looks like in each theme.
 */
export type Tone = 'neutral' | 'ok' | 'busy' | 'warn' | 'danger'

/** The dictionary key of one status word — the union keeps the copy exhaustive. */
export function statusKey(status: EvalExperimentStatus): `status.${EvalExperimentStatus}` {
  return `status.${status}`
}

/** The tone each experiment status carries wherever it is shown. */
const STATUS_TONE: Readonly<Record<EvalExperimentStatus, Tone>> = {
  'draft': 'neutral',
  'pending-approval': 'warn',
  'running': 'busy',
  'judging': 'busy',
  'done': 'ok',
  'refused': 'danger',
  'cancelled': 'neutral',
  'stalled': 'warn',
  'void': 'neutral',
}

/**
 * The tone of one experiment status.
 * @param status - the row's status.
 * @returns the chip tone to render it with.
 */
export function statusTone(status: EvalExperimentStatus): Tone {
  return STATUS_TONE[status] ?? 'neutral'
}

/**
 * The tone of one projection bucket (ui-spec §九's five: green = done, blue =
 * in progress, grey = not started, red = failed/blocked, amber = warning).
 */
export function bucketTone(bucket: string): Tone {
  if (bucket === 'blocked') return 'danger'
  if (bucket === 'active') return 'busy'
  if (bucket === 'done') return 'ok'
  // `ready` and `scheduled` are both «not started yet» — grey, not green.
  return 'neutral'
}

/**
 * The tone of one ledger state.
 *
 * ui-spec §九 fixes the five tones AND one thing that is easy to get wrong:
 * 「已释放 / 已归档这类终态用灰」. A cell that has been archived and released is
 * FINISHED, not successful — the run is over and nothing more will happen
 * there, which reads as grey. Green is kept for the state that actually says
 * something went well (已判: a verdict exists), so a column of green means
 * «judged», not «reached the end of the pipeline».
 */
export function stageTone(state: string): Tone {
  if (state === 'halted') return 'warn'
  if (state === 'judged') return 'ok'
  if (state === 'archived' || state === 'releasable' || state === 'released') return 'neutral'
  if (state === 'pending') return 'neutral'
  return 'busy'
}

/**
 * One word from the table — a phrase and its parameters, resolved.
 * @param props - the phrase, the locale seat, and the raw token for the title.
 */
export function Word(props: { phrase: Phrase; t: LabViewProps['t']; title?: string | undefined }) {
  const { phrase, t, title } = props
  const text = phrase.params === undefined ? t(phrase.key) : t(phrase.key, phrase.params)
  return title === undefined ? <>{text}</> : <span title={title}>{text}</span>
}

/**
 * A status chip: one word, one tone, one shape — the thing ui-spec §九 asks to
 * be identical across the list, the matrix, the cells page and the report.
 * @param props - the tone, an optional hover title, and the word itself.
 */
export function Chip(props: {
  tone?: Tone
  title?: string | undefined
  /**
   * One extra class for POSITIONING only — a chip is a grid item wherever the
   * timeline puts it, and grid items stretch by default, which is how every
   * timeline row grew an equal-length coloured bar that meant nothing
   * (I5·T67 · W7). The tone and the shape stay the chip's own.
   */
  className?: string | undefined
  children: ReactNode
}) {
  const { tone = 'neutral', title, className, children } = props
  return (
    <span
      className={className === undefined ? css.chipTag : `${css.chipTag} ${className}`}
      data-tone={tone}
      title={title}
    >
      {children}
    </span>
  )
}

/**
 * The empty seat, which always says what to do next (ui-spec §九): a sentence
 * about what is not here, a sentence about how to change that, and the action
 * itself when the page has one.
 * @param props - the two sentences and any action buttons.
 */
export function EmptyState(props: { title: string; hint?: string | undefined; children?: ReactNode }) {
  const { title, hint, children } = props
  return (
    <div className={css.emptySeat}>
      <div className={css.emptyTitle}>{title}</div>
      {hint !== undefined && hint !== '' && <div className={css.emptyHint}>{hint}</div>}
      {children !== undefined && <div className={css.emptyActions}>{children}</div>}
    </div>
  )
}

/**
 * One boxed block of a page — the matrix footer, a report section, the judge
 * bench's three columns.
 * @param props - the heading, an optional quiet second half of it, the body.
 */
export function Section(props: { title: ReactNode; meta?: ReactNode; children: ReactNode }) {
  const { title, meta, children } = props
  return (
    <div className={css.reportSection}>
      <div className={css.sectionTitle}>
        <span>{title}</span>
        {meta !== undefined && <span className={css.sectionMeta}>{meta}</span>}
      </div>
      {children}
    </div>
  )
}

/**
 * A digest, shortened to {@link shortHash}'s width with the whole value on
 * hover — ui-spec §九 keeps full hashes off the page and out of headings.
 * @param props - the digest, or null for «—».
 */
export function Hash(props: { value: string | null }) {
  const { value } = props
  return <span className={css.mono} title={value ?? undefined}>{shortHash(value)}</span>
}

/** `2026-09-13 14:02`, in the reader's own zone; em dash for a draft. */
export function stamp(at: number | null): string {
  if (at === null) return '—'
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * A repository's own name — its last path segment.
 *
 * ui-spec §九 keeps absolute paths off the page. The repository is named a
 * dozen times in this tab and the name is what a person says out loud; the
 * path belongs on a `title` and under «详情».
 * @param path - the repository root, absolute or `~`-prefixed.
 * @returns the last segment, or the path itself when it has none.
 */
export function repoName(path: string): string {
  return path.replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? path
}

/** `dataset @ abcdef1`; whichever half is missing simply does not print. */
export function snapshotCell(row: EvalExperimentRow): string {
  const { datasetId, commit } = row.snapshot
  if (datasetId === null && commit === null) return '—'
  const short = commit === null ? null : commit.slice(0, 7)
  if (datasetId === null) return short as string
  return short === null ? datasetId : `${datasetId} @ ${short}`
}

/**
 * The factor cell: the designed factors in words, and how many derived fields
 * ride along with them.
 *
 * The raw paths are NOT the cell (ui-spec §九). They stay in the cell's
 * `title`, which is where the person who wants `unit.scopedHome.var` will
 * look for it.
 * @param props - the row and the locale seat.
 */
export function FactorCell(props: { row: EvalExperimentRow; t: LabViewProps['t'] }) {
  const { row, t } = props
  if (row.conditions.length < 2) return <span className={css.dim}>{t('factors.single')}</span>
  if (row.factors.length === 0) return <span className={css.dim}>{t('factors.none')}</span>
  const { named, incidental } = splitFactors(row.factors)
  const shown = named.length > 0 ? named : incidental
  const words = shown.slice(0, FACTOR_WORDS)
    .map(path => factorPhrase(path))
    .map(phrase => (phrase.params === undefined ? t(phrase.key) : t(phrase.key, phrase.params)))
  // Everything the cell did not name: the designed factors past the third, plus
  // every derived field. One row per experiment is the list's whole shape, and
  // six words wrapped over three lines is not a row (ui-spec §五).
  const rest = (shown.length - words.length) + (named.length > 0 ? incidental.length : 0)
  return (
    <span title={row.factors.join(', ')}>
      {words.join(' · ')}
      {rest > 0 && <span className={css.dim}> {t('factors.plusIncidental', { count: rest })}</span>}
    </span>
  )
}

/** How many factor words fit a list row before the cell starts wrapping. */
const FACTOR_WORDS = 3

/**
 * A duration in the reader's own words — 「4 分 48 秒」, `4m 48s` (ui-spec §九).
 *
 * The SHAPE (which two units) is {@link durationParts}'s; the words are the
 * dictionary's, because 「4 分 48 秒」 is not `4m 48s` with the numbers swapped.
 * @param props - the duration in ms (null prints an em dash) and the locale seat.
 */
export function Duration(props: { ms: number | null; t: LabViewProps['t'] }) {
  const parts = durationParts(props.ms)
  return <>{parts === null ? '—' : props.t(parts.key, parts.params)}</>
}

/**
 * How long a stalled run has sat, in the units the runs table already uses
 * (「7 天 2 小时」), not a raw minute count nobody can read at a glance.
 * @param minutes - minutes since the last progress.
 * @param t - the locale seat.
 */
export function stalledFor(minutes: number, t: LabViewProps['t']): string {
  const parts = durationParts(minutes * 60_000)
  return parts === null ? String(minutes) : t(parts.key, parts.params)
}

/**
 * A count, compacted (ui-spec §九: `31.5k`). A dash is not a zero — a harness
 * that never reported tool calls prints «—», not 0.
 * @param props - the count, or null when nobody counted.
 */
export function Count(props: { value: number | null }) {
  return <>{compactCount(props.value)}</>
}

/**
 * How much two graders agree, said as the word a reader acts on, with κ on the
 * hover (ui-spec §九: 「评分者一致性：高（κ 0.85）」).
 * @param props - κ, the locale seat, and whether to print the κ beside the word.
 */
export function Agreement(props: { kappa: number | null; t: LabViewProps['t']; showKappa?: boolean }) {
  const { kappa, t, showKappa = true } = props
  const band = agreementBand(kappa)
  if (band === null) return <span className={css.dim}>{t('agreement.none')}</span>
  const word = t(`agreement.${band}`)
  return (
    <span title={kappa === null ? undefined : `κ ${kappa.toFixed(3)}`}>
      <Chip tone={band === 'high' ? 'ok' : band === 'medium' ? 'warn' : 'danger'}>{word}</Chip>
      {showKappa && kappa !== null && <span className={css.dim}> κ {kappa.toFixed(2)}</span>}
    </span>
  )
}

/** One labelled block of a page. */
export function Field(props: { label: string; children: ReactNode }) {
  return (
    <div className={css.field}>
      <div className={css.fieldLabel}>{props.label}</div>
      <div className={css.fieldValue}>{props.children}</div>
    </div>
  )
}

/** A list value, or an em dash — never an empty line pretending to be a value. */
export function listOrDash(values: readonly string[]): string {
  return values.length === 0 ? '—' : values.join(', ')
}

/**
 * A disclosure for text a page must KEEP but must not print: a host-written
 * English sentence, an absolute path, a raw payload (ui-spec §九).
 * @param props - the summary line and whatever is folded under it.
 */
export function Detail(props: {
  summary: string
  children: ReactNode
  /** Controlled mode: the caller holds the open state (the report's audit fold). */
  open?: boolean
  onToggle?: (open: boolean) => void
  id?: string
}) {
  const controlled = props.open === undefined
    ? {}
    : {
      open: props.open,
      onToggle: (event: { currentTarget: HTMLDetailsElement }) => { props.onToggle?.(event.currentTarget.open) },
    }
  return (
    <details className={css.errorDetails} id={props.id} {...controlled}>
      <summary className={css.errorSummary}>{props.summary}</summary>
      {props.children}
    </details>
  )
}

/**
 * What an approval started: the ids, and the job's log VERBATIM.
 *
 * The log is not a convenience. A run the readiness gate refuses never reaches
 * `runCreate`, so the mission ledger holds nothing for it and the readiness
 * block on the overview stays empty forever — the refusal exists only in these
 * lines. Rendering them raw is the difference between "the run was refused"
 * and "the scoped home for cond-b holds no credential".
 */
export function StartedRun(props: {
  started: LabStartedRun
  output: EvalRunOutputView | null
  outputError: string | null
  t: LabViewProps['t']
}) {
  const { started, output, outputError, t } = props
  return (
    <>
      <Field label={t('review.started')}>
        <span className={css.mono}>{t('review.startedValue', { jobId: started.jobId, runId: started.runId })}</span>
        <div className={css.dim}>{t('review.parentSession')}: {started.parentSessionId}</div>
      </Field>
      <Field label={t('review.jobLog')}>
        {outputError !== null
          ? <ErrorState what={t('review.jobLogError')} message={outputError} compact t={t} />
          : output === null || output.lines.length === 0
            ? <span className={css.dim}>{t('review.jobLogEmpty')}</span>
            : <pre className={css.pre}>{output.lines.join('\n')}</pre>}
      </Field>
    </>
  )
}

/** The key one severity word lives under — kept exhaustive by the union. */
export function severityKey(severity: string): EvalKey {
  if (severity === 'ok') return 'severity.ok'
  if (severity === 'warn') return 'severity.warn'
  return 'severity.error'
}

/** The tone of one check severity. */
export function severityTone(severity: string): Tone {
  if (severity === 'ok') return 'ok'
  if (severity === 'warn') return 'warn'
  return 'danger'
}

/** The tone of one invariant verdict. */
export function invariantTone(status: string): Tone {
  if (status === 'ok') return 'ok'
  if (status === 'violated') return 'danger'
  return 'warn'
}

/* ─────────── the stage bar and the readiness badge (ui-spec §五 v2) ───────── */

/**
 * What ONE primary action does. The stage bar never branches on the verb:
 * three of the six move the reader to another stage, one re-reads, and two are
 * the human acts (ui-spec R1) the page already owned.
 */
export type StageVerb = 'design' | 'runs' | 'compare' | 'review' | 'refresh' | 'approve' | 'rerun'

/** One experiment status, said as a sentence and a button. */
export interface StageAction {
  /** What is true right now, in one sentence. */
  hint: EvalKey
  /** The button's own word. */
  cta: EvalKey
  /** What pressing it does. */
  verb: StageVerb
}

/**
 * The state machine ui-spec §五 v2 fixes: 草稿 → 去 validate, 待批准 →
 * 批准并启动, 运行中 → 看运行记录, 评估中 → 去人工评估, 已完成 → 看结果,
 * 被拒 → 重新检查.
 *
 * A table and not a chain of conditionals, because the whole complaint it
 * answers was that every page looked the same whatever the experiment was
 * doing: the mapping from state to «what now» is the page's content, so it is
 * written down once, exhaustively, where it can be read.
 */
const STAGE_ACTIONS: Readonly<Record<EvalExperimentStatus, StageAction>> = {
  'draft': { hint: 'cta.draftHint', cta: 'cta.draft', verb: 'design' },
  'pending-approval': { hint: 'cta.pendingHint', cta: 'cta.pending', verb: 'approve' },
  'running': { hint: 'cta.runningHint', cta: 'cta.running', verb: 'runs' },
  'judging': { hint: 'cta.judgingHint', cta: 'cta.judging', verb: 'review' },
  'done': { hint: 'cta.doneHint', cta: 'cta.done', verb: 'compare' },
  'refused': { hint: 'cta.refusedHint', cta: 'cta.refused', verb: 'refresh' },
  'cancelled': { hint: 'cta.cancelledHint', cta: 'cta.cancelled', verb: 'runs' },
  'stalled': { hint: 'cta.stalledHint', cta: 'cta.stalled', verb: 'rerun' },
  'void': { hint: 'cta.voidHint', cta: 'cta.void', verb: 'runs' },
}

/**
 * The one action this experiment's state asks for.
 * @param status - the experiment's status as the page is showing it.
 * @returns the sentence, the button word, and what the button does.
 */
export function stageAction(status: EvalExperimentStatus): StageAction {
  return STAGE_ACTIONS[status] ?? STAGE_ACTIONS.draft
}

/**
 * The readiness badge (ui-spec §五 v2): one chip when every comparison group
 * passed, and a red cross per group when they did not.
 *
 * The RECORDS are not the badge. A reader glancing at this page is asking one
 * question — can this run start — and six paragraphs of probe output is how
 * v1 answered it. The records are kept, verbatim, under the fold beside it,
 * because a refused run's reason exists nowhere else.
 * @param props - each group's readiness verdict and the re-read action.
 */
export function ReadyBadge(props: {
  rows: ReadonlyArray<{ id: string; ok: boolean; note?: string | undefined }>
  onRecheck: () => void
  /** The rows are the probe the run took when it started, shown on a run that has since stopped moving. */
  atStart?: boolean
  t: LabViewProps['t']
}) {
  const { rows, onRecheck, atStart = false, t } = props
  if (rows.length === 0) return <span className={css.dim}>{t('ready.pending')}</span>
  const failed = rows.filter(row => !row.ok)
  // A stalled run's badge is its start-time probe; said plainly, so it does not
  // read as a verdict on the plan beside a checklist that re-checked it now.
  if (failed.length === 0) return <Chip tone="ok">✓ {t(atStart ? 'ready.badgeAtStart' : 'ready.badge')}</Chip>
  return (
    <div className={css.readiness}>
      <div className={css.readinessLine}>
        <Chip tone="danger">{t('ready.failedCount', { count: failed.length, total: rows.length })}</Chip>
        <Button size="sm" onClick={onRecheck}>{t('ready.recheck')}</Button>
      </div>
      {failed.map(row => (
        <div key={row.id} className={css.readinessLine}>
          <Chip tone="danger">✗</Chip>
          <span className={css.mono}>{row.id}</span>
          {row.note !== undefined && row.note !== '' && <span className={css.dim}>{row.note}</span>}
        </div>
      ))}
    </div>
  )
}

/**
 * Which verdict source a cell carries, as the chip the run records are
 * scanned for. Green only for a final verdict — a judge's draft is a reading,
 * not a decision.
 * @param props - the ns → count map of one cell, and the locale seat.
 */
export function VerdictChip(props: { annotations: Readonly<Record<string, number>>; t: LabViewProps['t'] }) {
  const { annotations, t } = props
  const source = verdictSourceOf(annotations)
  if (source === null) return <span className={css.dim}>{t('verdict.none')}</span>
  return (
    <Chip tone={source === 'human-final' ? 'ok' : 'neutral'} title={t('verdict.hint')}>
      {t(verdictKey(source))}
    </Chip>
  )
}
