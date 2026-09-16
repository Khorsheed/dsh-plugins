/**
 * The side-chat view: the right-Sidebar tab's body.
 *
 * One context per view: the tab's navigation params pick it (the quote
 * action and future consumers open the tab with `params.contextKey`), and
 * the default is the CURRENT conversation's own context (contextKey = the
 * session id) — opening the tab in any conversation is asking beside it.
 *
 * The composer follows the canvas editor invariants that exist because
 * breaking them breaks writing:
 *
 * 1. **Uncontrolled `<textarea>`** — nothing writes `value` back; the only
 *    deliberate clear is the user's own send (no caret to preserve then).
 * 2. **Composition is a hard stop** — while an IME is composing (every
 *    Chinese keystroke), neither autosize nor send runs.
 * 3. **One scroll container** — the transcript scrolls; the composer grows.
 *
 * Updates are pull-based: a fetch on mount and context switch, a refetch
 * after every own gesture, and a 1.2s poll while the agent runs — the M2
 * live-feed push is deliberately not built here.
 *
 * @module @khorsheed/dsh-sidechat/client
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type CompositionEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from 'react'
import { IconSendOutline16, MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SideChatState } from '../types.ts'
import type { SideChatTabParams } from './definition.ts'
import type { SideChatViewProps } from './contract.ts'
import css from './SideChatView.module.css'

/** Live-turn poll cadence (M2 replaces it with a real feed). */
const POLL_MS = 1200

/** The not-found answer's presentation: an empty, unsent context. */
function emptyState(contextKey: string, label: string): SideChatState {
  return { contextKey, label, status: 'new', refs: [], transcript: [] }
}

/** True when a rejection carries a usable message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The side-chat view. */
export function SideChatView({
  sessionId, useSessions, useTabInfo, t, getState, send,
}: SideChatViewProps): ReactNode {
  const { tab } = useTabInfo()
  const params = tab.navigation.params as SideChatTabParams | undefined
  const contextKey = params?.contextKey ?? String(sessionId)
  const revision = tab.navigation.revision
  const fallbackLabel = useSessions(sessions => sessions.byId[sessionId]?.displayTitle) ?? contextKey

  const [state, setState] = useState<SideChatState | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const composingRef = useRef(false)

  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: {
      copyLabel: t('markdown.copy'),
      copiedLabel: t('markdown.copied'),
    },
    footnotes: t('markdown.footnotes'),
  }), [t])

  // Mount and context-switch: load the context (navigation params or the own session).
  useEffect(() => {
    let stale = false
    setState(null)
    setError(null)
    const key = contextKey
    getState(key).then((carried) => {
      if (stale) return
      if (!carried.ok) {
        setFatal(carried.error.message)
      } else {
        setState(carried.value.ok ? carried.value.state : emptyState(key, fallbackLabel))
      }
    }, (cause: unknown) => { if (!stale) setFatal(messageOf(cause)) })
    return () => { stale = true }
  }, [contextKey, revision, fallbackLabel, getState])

  // The live-turn poll: while the agent runs, pull the projection forward.
  const status = state?.status
  useEffect(() => {
    if (status !== 'running') return
    const key = contextKey
    const label = fallbackLabel
    const timer = window.setInterval(() => {
      getState(key).then((carried) => {
        if (carried.ok) setState(carried.value.ok ? carried.value.state : emptyState(key, label))
      }, () => undefined)
    }, POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [status, contextKey, fallbackLabel, getState])

  // Keep the tail of the transcript in view as rows land.
  const rowCount = state?.transcript.length ?? 0
  useEffect(() => {
    const element = transcriptRef.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [rowCount])

  const autosize = useCallback(() => {
    const element = composerRef.current
    if (element === null) return
    element.style.height = '0px'
    element.style.height = `${element.scrollHeight}px`
  }, [])

  const doSend = useCallback(async () => {
    const element = composerRef.current
    if (element === null || composingRef.current) return
    const text = element.value.trim()
    if (text === '') return
    setError(null)
    try {
      const carried = await send(sessionId, { contextKey, text, label: fallbackLabel })
      if (!carried.ok) {
        setError(t('error.send', { message: carried.error.message }))
        return
      }
      if (!carried.value.ok) {
        setError(t('error.send', { message: carried.value.error }))
        return
      }
      // The deliberate clear: the user's own send, so no caret is at stake.
      element.value = ''
      autosize()
      setState(carried.value.state)
    } catch (cause) {
      setError(t('error.send', { message: messageOf(cause) }))
    }
  }, [sessionId, contextKey, fallbackLabel, send, autosize, t])

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || composingRef.current) return
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault()
      void doSend()
    }
  }, [doSend])

  const onInput = useCallback((_event: FormEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) return
    autosize()
  }, [autosize])

  const onCompositionStart = useCallback(() => { composingRef.current = true }, [])
  const onCompositionEnd = useCallback((_event: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false
    autosize()
  }, [autosize])

  if (fatal !== null) {
    return <div className={css.root}><div className={css.notice}>{t('state.hostMissing')}</div></div>
  }

  const refs = state?.refs ?? []
  const transcript = state?.transcript ?? []
  return (
    <div className={css.root}>
      <header className={css.header}>
        <span className={css.title}>{state?.label ?? fallbackLabel}</span>
        <span className={css.status} data-running={status === 'running' ? 'true' : 'false'}>
          {status === undefined ? t('state.loading') : t(`status.${status}`)}
        </span>
      </header>
      <div className={css.transcript} ref={transcriptRef}>
        {transcript.length === 0 && status !== 'running' && (
          <div className={css.empty}>{t('state.empty')}</div>
        )}
        {transcript.map((row, index) => {
          switch (row.kind) {
            case 'user':
              return (
                <div key={`${index}-${row.time}`} className={css.userRow}>
                  <div className={css.userBubble}>{row.text}</div>
                </div>
              )
            case 'assistant':
              return (
                <div key={`${index}-${row.time}`} className={css.assistantRow}>
                  <MarkdownText text={row.text} labels={markdownLabels} />
                </div>
              )
            case 'tool':
              return (
                <div key={`${index}-${row.time}`} className={css.toolRow} data-state={row.state}>
                  {t(`tool.${row.state}`, { name: row.name })}
                </div>
              )
          }
        })}
      </div>
      {refs.length > 0 && (
        <div className={css.refs} aria-label={t('refs.title', { count: String(refs.length) })}>
          {refs.map((ref, index) => (
            <span key={`${index}-${ref.label}`} className={css.refChip} title={ref.text}>{ref.label}</span>
          ))}
        </div>
      )}
      <div className={css.composer}>
        <textarea
          ref={composerRef}
          className={css.input}
          placeholder={t('composer.placeholder')}
          spellCheck={false}
          rows={1}
          onInput={onInput}
          onKeyDown={onKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
        />
        <button
          type="button"
          className={css.send}
          aria-label={t('composer.send')}
          onClick={() => { void doSend() }}
        >
          <IconSendOutline16 />
        </button>
      </div>
      {error !== null && <div className={css.error} role="status">{error}</div>}
    </div>
  )
}
