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
import type { EvalExperimentRow, EvalExperimentStatus, EvalRunOutputView } from '../types.ts'
import type { LabViewProps } from './contract.ts'
import { ErrorState } from './ErrorState.tsx'
import type { EvalKey } from './locales.ts'
import type { LabStartedRun } from './store.ts'
import { factorPhrase, shortHash, splitFactors, type Phrase } from './vocab.ts'
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
}

/**
 * The tone of one experiment status.
 * @param status - the row's status.
 * @returns the chip tone to render it with.
 */
export function statusTone(status: EvalExperimentStatus): Tone {
  return STATUS_TONE[status] ?? 'neutral'
}

/** The tone of one projection bucket — only two of the five are loud. */
export function bucketTone(bucket: string): Tone {
  if (bucket === 'blocked') return 'warn'
  if (bucket === 'active') return 'busy'
  if (bucket === 'done') return 'ok'
  return 'neutral'
}

/** The tone of one ledger state: past the judge is settled, halted is loud. */
export function stageTone(state: string): Tone {
  if (state === 'halted') return 'warn'
  if (state === 'released' || state === 'releasable' || state === 'archived' || state === 'judged') return 'ok'
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
export function Chip(props: { tone?: Tone; title?: string | undefined; children: ReactNode }) {
  const { tone = 'neutral', title, children } = props
  return <span className={css.chipTag} data-tone={tone} title={title}>{children}</span>
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
  const words = (named.length > 0 ? named : incidental)
    .map(path => factorPhrase(path))
    .map(phrase => (phrase.params === undefined ? t(phrase.key) : t(phrase.key, phrase.params)))
  const rest = named.length > 0 ? incidental.length : 0
  return (
    <span title={row.factors.join(', ')}>
      {words.join(' · ')}
      {rest > 0 && <span className={css.dim}> {t('factors.plusIncidental', { count: rest })}</span>}
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
export function Detail(props: { summary: string; children: ReactNode }) {
  return (
    <details className={css.errorDetails}>
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
