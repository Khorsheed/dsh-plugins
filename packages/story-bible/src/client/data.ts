/**
 * The work shell both tabs mount first: the registry, the session's focus
 * and the focused work's info (counts), plus the shared mutation/toast
 * plumbing. One hook, because every view's "same source" story starts at
 * these three answers (proposal §6: 计数现算，与视图同源).
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { StoryTabProps } from './contract.ts'
import type { StoryError, WorkIndexEntry, WorkInfo } from '../types.ts'

/** How often a visible tab re-reads the shell (the main session's writes are unannounced). */
export const SHELL_POLL_MS = 5000

/** One banner line the tab renders (the host Toast owns the timer). */
export interface StoryToast {
  readonly text: string
  readonly seq: number
}

/** The shell's answers and gestures. */
export interface WorkShell {
  /** The work registry (null until loaded). */
  readonly works: readonly WorkIndexEntry[] | null
  /** The session's focus (null = none). */
  readonly focus: { readonly workId: string; readonly title: string } | null
  /** The focused work's info page (null without focus or before load). */
  readonly info: WorkInfo | null
  /** The one fatal line (a transport failure's message), dismissable on click. */
  readonly fatal: string | null
  readonly setFatal: (message: string | null) => void
  readonly toast: StoryToast | null
  /** Raise the toast banner. */
  readonly showToast: (text: string) => void
  readonly dismissToast: () => void
  /** Unwrap the transport envelope, reporting a failure instead of throwing. */
  readonly run: <T>(call: () => Promise<RemoteResult<T>>) => Promise<T | null>
  /** Localized copy for one shared error code. */
  readonly errorText: (error: StoryError | undefined) => string
  /** Switch the session's focus. */
  readonly switchWork: (workId: string) => Promise<boolean>
  /** Create one work and focus it. */
  readonly createWork: (title: string, workspace: string) => Promise<boolean>
  /** Re-read the shell (after a mutation elsewhere). */
  readonly reloadShell: () => Promise<void>
}

/** Mount the work shell for one tab. @param props - the tab's composed props. */
export function useWorkShell(props: StoryTabProps): WorkShell {
  const { t, listWorks, readWork, getFocus, focusWork, createWork, refresh } = props
  const sessionId = props.sessionId
  const story = props.useStory(current => current)
  const rev = story.rev

  const [works, setWorks] = useState<readonly WorkIndexEntry[] | null>(null)
  const [focus, setFocus] = useState<{ workId: string; title: string } | null>(null)
  const [info, setInfo] = useState<WorkInfo | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [toast, setToast] = useState<StoryToast | null>(null)
  const toastSeqRef = useRef(0)

  const showToast = useCallback((text: string): void => {
    toastSeqRef.current += 1
    setToast({ text, seq: toastSeqRef.current })
  }, [])
  const dismissToast = useCallback((): void => { setToast(null) }, [])

  const run = useCallback(async <T,>(call: () => Promise<RemoteResult<T>>): Promise<T | null> => {
    try {
      const result = await call()
      if (result.ok) return result.value
      setFatal(result.error.message)
      return null
    } catch (error) {
      setFatal(error instanceof Error ? error.message : String(error))
      return null
    }
  }, [])

  const errorText = useCallback((error: StoryError | undefined): string => {
    if (error === 'missing') return t('error.missing')
    if (error === 'invalid-name') return t('error.invalidName')
    if (error === 'stale') return t('error.stale')
    if (error === 'denied') return t('error.denied')
    if (error === 'not-reviewed') return t('error.notReviewed')
    return t('error.io')
  }, [t])

  const reloadShell = useCallback(async () => {
    const registry = await run(() => listWorks())
    if (registry !== null) setWorks(registry)
    if (sessionId === undefined) {
      setFocus(null)
      setInfo(null)
      return
    }
    const focused = await run(() => getFocus(sessionId))
    if (focused === null) return
    setFocus(focused)
    if (focused === null) {
      setInfo(null)
      return
    }
    const detail = await run(() => readWork({ workId: focused.workId }))
    if (detail !== null && detail.ok && detail.info !== undefined) setInfo(detail.info)
  }, [listWorks, readWork, getFocus, sessionId, run])

  // Load on mount and whenever the shared rev moves (either seat's mutation).
  useEffect(() => { void reloadShell() }, [reloadShell, rev])

  // The main session's agent writes through its story_* tools unannounced:
  // while the tab is in view, nudge the store on a slow beat so every reader
  // re-reads (the canvas BOARD_POLL precedent).
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, SHELL_POLL_MS)
    return () => { clearInterval(timer) }
  }, [refresh])

  const switchWork = useCallback(async (workId: string): Promise<boolean> => {
    if (sessionId === undefined) return false
    const value = await run(() => focusWork(sessionId, { workId }))
    if (value === null) return false
    if (!value.ok) {
      showToast(errorText(value.error))
      return false
    }
    await reloadShell()
    return true
  }, [sessionId, focusWork, run, reloadShell, errorText, showToast])

  const submitCreate = useCallback(async (title: string, workspace: string): Promise<boolean> => {
    if (sessionId === undefined) return false
    const value = await run(() => createWork(sessionId, { title, workspace }))
    if (value === null) return false
    if (!value.ok) {
      showToast(errorText(value.error))
      return false
    }
    const work = value.work
    if (work === undefined) {
      showToast(errorText(undefined))
      return false
    }
    showToast(t('works.created', { title: work.title }))
    const focused = await run(() => focusWork(sessionId, { workId: work.id }))
    if (focused === null) return false
    await reloadShell()
    return true
  }, [sessionId, createWork, focusWork, run, reloadShell, errorText, showToast, t])

  return {
    works, focus, info, fatal, setFatal, toast, showToast, dismissToast,
    run, errorText, switchWork, createWork: submitCreate, reloadShell,
  }
}
