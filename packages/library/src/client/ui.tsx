/**
 * Small shared pieces of the library sidebar: the loading hook every view
 * reads the host through, outcome unwrapping, and the few presentational
 * atoms (state lines, weakness bars, review boxes, the term highlighter,
 * the origin tag, the destructive-action confirm dialog).
 *
 * @module @khorsheed/dsh-library/client/ui
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { LibraryOutcome, LibraryResourceOrigin } from '../types.ts'
import type { LibraryPaneProps } from './contract.ts'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconCheckOutlineMedium } from './icons.tsx'
import css from './LibraryPane.module.css'

/** What every view receives. */
export interface ViewProps {
  readonly p: LibraryPaneProps
}

/** A load's state. */
export interface Loaded<T> {
  readonly data: T | undefined
  readonly error: string | undefined
  readonly loading: boolean
}

/**
 * Read the host once per `deps` change (the store's `rev` is always one of
 * them, so every mutation re-reads). A stale answer never lands.
 */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ data: undefined, error: undefined, loading: true })
  useEffect(() => {
    let cancelled = false
    setState(previous => ({ ...previous, loading: true }))
    load().then(
      data => { if (!cancelled) setState({ data, error: undefined, loading: false }) },
      (error: unknown) => { if (!cancelled) setState({ data: undefined, error: error instanceof Error ? error.message : String(error), loading: false }) },
    )
    return () => { cancelled = true }
  }, deps)
  return state
}

/** The value inside a Remote envelope, or a thrown Error with the wire's message. */
export async function value<T>(answer: Promise<RemoteResult<T>>): Promise<T> {
  const result = await answer
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** The domain value inside an envelope + outcome, or a thrown Error with the refusal's lesson. */
export async function outcome<T>(answer: Promise<RemoteResult<LibraryOutcome<T>>>): Promise<T> {
  const inner = await value(answer)
  if (!inner.ok) throw new Error(inner.message)
  return inner
}

/** Loading / error / empty lines, in one place. */
export function StateLine({ loaded, t }: { loaded: Loaded<unknown>; t: LibraryPaneProps['t'] }): ReactNode {
  if (loaded.error !== undefined) return <div className={css.error}>{t('state.error', { reason: loaded.error })}</div>
  if (loaded.loading && loaded.data === undefined) return <div className={css.muted}>{t('state.loading')}</div>
  return null
}

/** Weakness as three bars (filled = how stuck). */
export function WeaknessBars({ weakness, label }: { weakness: number; label: string }): ReactNode {
  return (
    <span className={css.weak} role="img" aria-label={label}>
      {[1, 2, 3].map(level => <i key={level} data-on={weakness >= level ? 'true' : 'false'} />)}
    </span>
  )
}

/** Review progress as five boxes. */
export function BoxDots({ box, label }: { box: number; label: string }): ReactNode {
  return (
    <span className={css.boxes} role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map(level => <i key={level} data-on={box >= level ? 'true' : 'false'} />)}
    </span>
  )
}

/** A sentence with its term marked (case-insensitive, first occurrence). */
export function Highlight({ sentence, term }: { sentence: string; term: string }): ReactNode {
  const at = sentence.toLowerCase().indexOf(term.toLowerCase())
  if (at < 0 || term === '') return <>{sentence}</>
  return <>{sentence.slice(0, at)}<mark className={css.mark}>{sentence.slice(at, at + term.length)}</mark>{sentence.slice(at + term.length)}</>
}

/** A relative time, coarse. */
export function when(at: string, t: LibraryPaneProps['t']): string {
  const minutes = Math.floor((Date.now() - Date.parse(at)) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1) return t('when.justNow')
  if (minutes < 60) return t('when.minutes', { count: String(minutes) })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('when.hours', { count: String(hours) })
  const days = Math.floor(hours / 24)
  return days === 1 ? t('when.yesterday') : t('when.days', { count: String(days) })
}

/** A gloss short enough for a one-line row: up to its first dash or semicolon, then capped. */
export function shortGloss(gloss: string, max = 18): string {
  const head = gloss.split(/\s*(?:——|—|;|；)\s*/)[0] ?? gloss
  return head.length > max ? `${head.slice(0, max)}…` : head
}

/** Days from now until an ISO moment, at least 0. */
export function daysUntil(at: string): number {
  return Math.max(0, Math.ceil((Date.parse(at) - Date.now()) / 86_400_000))
}

/** A textbook's origin as a small colored tag (你的书 / 模型选的书 / 电子资料 / 模型自编). */
export function OriginTag({ origin, digital, t }: { origin: LibraryResourceOrigin | undefined; digital: boolean; t: LibraryPaneProps['t'] }): ReactNode {
  const key = origin === 'authored' ? 'authored' : origin === 'learner' ? 'learner' : digital ? 'digital' : 'picked'
  return <span className={css.originTag} data-origin={key}>{t(`origin.${key}`)}</span>
}

/**
 * The destructive-action confirm, on the host's own Modal (the blurred mask,
 * the title bar with its close button, outline buttons — what the host's
 * archive confirm uses): what goes as a grouped list with each count set
 * off, what stays with a check, a red-text confirm. Esc, the mask and the
 * close button cancel (not while busy); focus starts on 取消 so a stray
 * Enter never deletes.
 */
export function ConfirmDialog({ title, lines, keep, note, confirmLabel, cancelLabel, busy, error, onConfirm, onCancel }: {
  title: string
  /** What the action removes, one consequence per line (a leading count is set off). */
  lines: readonly string[]
  /** What survives it. */
  keep?: string | undefined
  note?: string | undefined
  confirmLabel: string
  cancelLabel: string
  busy: boolean
  error?: string | undefined
  onConfirm: () => void
  onCancel: () => void
}): ReactNode {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { cancelRef.current?.focus() }, [])
  const close = (): void => { if (!busy) onCancel() }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={cancelLabel}
      title={title}
      footer={(
        <>
          <Button ref={cancelRef} variant="outline" disabled={busy} onClick={close}>{cancelLabel}</Button>
          <Button variant="outline" className={css.dialogDanger} disabled={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      )}
    >
      <div className={css.dialogBody}>
        {lines.length > 0 && (
          <ul className={css.dialogList}>
            {lines.map(line => {
              const counted = /^(\d+)\s*(.*)$/.exec(line)
              return (
                <li key={line} className={css.dialogRow}>
                  {counted === null ? line : <><b className={css.dialogCount}>{counted[1]}</b><span>{counted[2]}</span></>}
                </li>
              )
            })}
          </ul>
        )}
        {keep !== undefined && <div className={css.dialogKeep}><IconCheckOutlineMedium size={14} />{keep}</div>}
        {note !== undefined && <div className={css.dialogNote}>{note}</div>}
        {error !== undefined && <div className={css.error}>{error}</div>}
      </div>
    </Modal>
  )
}

/**
 * A progress bar cut into one segment per station: passed ones filled, the
 * next one started — so an empty path still reads as progress, not a rule.
 * Over 40 stations it collapses to one continuous bar.
 */
export function Segments({ done, total, label }: { done: number; total: number; label?: string | undefined }): ReactNode {
  if (total <= 0) return null
  if (total > 40) {
    return <span className={css.segs} role="img" aria-label={label}><i data-state="done" style={{ gridColumn: `span ${Math.max(1, done)}` }} /><i style={{ gridColumn: `span ${Math.max(1, total - done)}` }} /></span>
  }
  return (
    <span className={css.segs} role="img" aria-label={label}>
      {Array.from({ length: total }, (_, index) => <i key={index} data-state={index < done ? 'done' : index === done ? 'next' : undefined} />)}
    </span>
  )
}
