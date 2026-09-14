/**
 * Pieces the 题集 tab's two pages share: the glyphs, the slot/role markers,
 * and the formatting that turns a projection into one quiet line.
 *
 * Extracted rather than left in either page because the LIST page's «槽位 ←
 * 层» cell and the DETAIL page's per-file marker must read as the same
 * vocabulary — a slot word that drifted between them would look like a data
 * disagreement rather than a copy inconsistency.
 */

import { IconChevronDownOutline14, IconChevronRightOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { exposureOfRole, type DatasetExposure, type DatasetRole, type DatasetSlot } from '../slots.ts'
import type { DatasetsViewProps } from './contract.ts'
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
    ? <IconChevronDownOutline14 className={css.chevron} />
    : <IconChevronRightOutline14 className={css.chevron} />
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
