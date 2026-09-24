/**
 * Pieces the 题集 tab's two pages share: the glyphs, the slot/role markers,
 * and the formatting that turns a projection into one quiet line.
 *
 * Extracted rather than left in either page because the LIST page's «槽位 ←
 * 层» cell and the DETAIL page's per-file marker must read as the same
 * vocabulary — a slot word that drifted between them would look like a data
 * disagreement rather than a copy inconsistency.
 */

import type { ReactNode } from 'react'
import { IconChevronDownOutlineMedium, IconChevronRightOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { exposureOfRole, type DatasetExposure, type DatasetRole, type DatasetSlot } from '../slots.ts'
import type { DatasetsViewProps } from './contract.ts'
import type { Phrase } from './vocab.ts'
import css from './DatasetsView.module.css'

/** The dictionary key of one slot word — the union keeps the copy exhaustive. */
export function slotKey(slot: DatasetSlot): `slot.${DatasetSlot}` {
  return `slot.${slot}`
}

/** The dictionary key of one role phrase. */
export function roleKey(role: DatasetRole): `role.${DatasetRole}` {
  return `role.${role}`
}

/** The CSS class one exposure class paints with (ui-spec §四's three colours). */
export function exposureClass(exposure: DatasetExposure): string {
  if (exposure === 'visible') return css.exposureVisible ?? ''
  if (exposure === 'unprotected') return css.exposureUnprotected ?? ''
  return css.exposureWithheld ?? ''
}

/** A group-row chevron: the official 14px disclosure glyphs. */
export function Chevron(props: { open: boolean }) {
  return props.open
    ? <IconChevronDownOutlineMedium className={css.chevron} />
    : <IconChevronRightOutlineMedium className={css.chevron} />
}

/** The leaf file glyph: a minimal inline document outline (the official icon
 * set ships folder glyphs but no file icon — see the M2 Agent Note). */
export function FileIcon() {
  return (
    <svg className={css.fileIcon} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 1.5h5.5L13 5v9.5H4V1.5Z M9.5 1.5V5H13"
        stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * One file's marker: the slot word, then who sees it, painted by exposure.
 * The role is the authoritative half — it is what the layer says — so it
 * carries the colour, and the slot is the word the reader was looking for.
 * @param props - the classification and the locale seat.
 */
export function SlotMark(props: { slot: DatasetSlot; role: DatasetRole; t: DatasetsViewProps['t'] }) {
  const { slot, role, t } = props
  return (
    <span className={`${css.slotMark} ${exposureClass(exposureOfRole(role))}`}>
      {t(slotKey(slot))} · {t(roleKey(role))}
    </span>
  )
}

/** `12.3 KB` / `812 B` — a byte count a human reads without counting zeros. */
export function bytes(count: number): string {
  if (count < 1024) return `${count} B`
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} KB`
  return `${(count / (1024 * 1024)).toFixed(1)} MB`
}

/** The 7-character short form of a commit id. */
export function shortCommit(commit: string): string {
  return commit.slice(0, 7)
}

/** `repo @ abc1234` — the «快照» cell, with the repository's own last segment. */
export function snapshotCell(repo: string, commit: string): string {
  const name = repo.replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? repo
  return `${name} @ ${commit.slice(0, 7)}`
}

/** `2026-09-13 14:02`, in the reader's own zone; em dash when there is no time. */
export function stamp(at: number | null): string {
  if (at === null) return '—'
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * How loud a chip is. The tone is the CHIP's, not the caller's colour: a page
 * says what a state MEANS (`warn` = a human has something to do) and the
 * stylesheet decides what that looks like in each theme.
 */
export type Tone = 'neutral' | 'ok' | 'busy' | 'warn' | 'danger'

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
export function Word(props: { phrase: Phrase; t: DatasetsViewProps['t']; title?: string | undefined }) {
  const { phrase, t, title } = props
  const text = phrase.params === undefined ? t(phrase.key) : t(phrase.key, phrase.params)
  return title === undefined ? <>{text}</> : <span title={title}>{text}</span>
}

/**
 * A status chip: one word, one tone, one shape.
 *
 * ui-spec §九 asks for ONE of these across both tabs, so this is the 实验室
 * tab's {@link Chip} verbatim, down to the class name and the tone set — a
 * plugin never imports a sibling (§八), so the two are copies kept identical
 * by hand, and the stylesheet rule beside them is identical too.
 * @param props - the tone, an optional hover title, and the word itself.
 */
export function Chip(props: { tone?: Tone; title?: string | undefined; children: ReactNode }) {
  const { tone = 'neutral', title, children } = props
  return <span className={css.chipTag} data-tone={tone} title={title}>{children}</span>
}

/**
 * The empty seat, which always says what to do next (ui-spec §九): a sentence
 * about what is not here, a sentence about how to change that, and the action
 * itself when the page has one. The 实验室 tab's copy of this is identical.
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
 * A disclosure for text a page must KEEP but must not print: a host-written
 * sentence, an absolute path, a raw payload (ui-spec §九).
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
