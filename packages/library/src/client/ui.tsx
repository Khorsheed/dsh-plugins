/**
 * Small shared pieces of the library sidebar: the loading hook every view
 * reads the host through, outcome unwrapping, and the few presentational
 * atoms (state lines, weakness bars, review boxes, the term highlighter).
 *
 * @module @khorsheed/dsh-library/client/ui
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { LibraryOutcome } from '../types.ts'
import type { LibraryPaneProps } from './contract.ts'
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
