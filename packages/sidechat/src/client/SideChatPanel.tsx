/**
 * The side-chat panel: the whole chat surface shared by the right-Sidebar
 * tab (`SideChatView`) and the floating dock (`SideChatDock`). The wrapper
 * owns WHERE the panel lives (a tab seat or an overlay frame) and WHICH
 * session donates sends; the panel owns everything conversational:
 *
 * - the context selector (listContexts, with unread dots from the last-seen
 *   store — a context whose latest assistant row is newer than the user's
 *   mark replied while they were looking elsewhere);
 * - the transcript (assistant via the official `MarkdownText`, user rows
 *   with their quoted refs as expandable chips);
 * - the pending-refs row and the composer (the canvas invariants:
 *   uncontrolled textarea, IME composition hard stop, ⌘⏎/button send);
 * - the fetch/poll cycle (one fetch on mount and context switch, a 1.2s
 *   poll while the agent runs).
 *
 * @module @khorsheed/dsh-sidechat/client
 */
import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
  type CompositionEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import {
  IconChevronDownOutlineMedium, IconSendOutlineMedium, MarkdownText, type MarkdownLabels,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SideChatContextSummary, SideChatListResult, SideChatSendOutcome,
  SideChatSendRequest, SideChatState, SideChatStateOutcome,
} from '../types.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { lastSeenOf, markSeen, seenVersion, subscribeSeen } from './seen.ts'
import { RefChips } from './RefChips.tsx'
import css from './SideChatPanel.module.css'

/** Live-turn poll cadence. */
const POLL_MS = 1200

/** The panel's remote-backed business face (both wrappers inject the same). */
export interface SideChatPanelRemote {
  readonly getState: (contextKey: string) => Promise<RemoteResult<SideChatStateOutcome>>
  readonly listContexts: () => Promise<RemoteResult<SideChatListResult>>
  readonly send: (sessionId: SessionId, request: SideChatSendRequest) => Promise<RemoteResult<SideChatSendOutcome>>
}

/** The shared panel's props. */
export interface SideChatPanelProps {
  /** The session that donates sends and fences; undefined renders the composer read-only. */
  readonly sessionId: SessionId | undefined
  /** The context to show. */
  readonly contextKey: string
  /** Selector callback — the wrapper decides where the switch lands (view state / dock store). */
  readonly onContextChange: (contextKey: string) => void
  /** The label a not-yet-created context shows (usually the session's display title). */
  readonly fallbackLabel: string
  readonly t: TranslateNS<'sidechat'>
  readonly remote: SideChatPanelRemote
  /** Wrapper chrome, rendered at the header's right (tab: dock-open; dock: close-to-tab). */
  readonly headerActions?: ReactNode
}

/** The not-found answer's presentation: an empty, unsent context. */
function emptyState(contextKey: string, label: string): SideChatState {
  return { contextKey, label, status: 'new', refs: [], transcript: [], lastError: null }
}

/** True when a rejection carries a usable message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The latest assistant-row time of one state (the seen mark's basis). */
function latestAssistantAt(state: SideChatState): number | null {
  let latest: number | null = null
  for (const row of state.transcript) {
    if (row.kind === 'assistant') latest = row.time
  }
  return latest
}

/** The side-chat panel. */
export function SideChatPanel({
  sessionId, contextKey, onContextChange, fallbackLabel, t, remote, headerActions,
}: SideChatPanelProps): ReactNode {
  const [state, setState] = useState<SideChatState | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The lastError text the user dismissed (a NEW error text re-raises the bar). */
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [contexts, setContexts] = useState<readonly SideChatContextSummary[] | null>(null)
  const [selectorOpen, setSelectorOpen] = useState(false)

  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const composingRef = useRef(false)

  // The seen map's version: recomputes every unread comparison on any mark.
  useSyncExternalStore(subscribeSeen, seenVersion)

  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: {
      copyLabel: t('markdown.copy'),
      copiedLabel: t('markdown.copied'),
    },
    footnotes: t('markdown.footnotes'),
  }), [t])

  // Mount and context-switch: load the context and the selector's list.
  useEffect(() => {
    let stale = false
    setState(null)
    setError(null)
    const key = contextKey
    remote.getState(key).then((carried) => {
      if (stale) return
      if (!carried.ok) {
        setFatal(carried.error.message)
      } else {
        setState(carried.value.ok ? carried.value.state : emptyState(key, fallbackLabel))
      }
    }, (cause: unknown) => { if (!stale) setFatal(messageOf(cause)) })
    return () => { stale = true }
  }, [contextKey, fallbackLabel, remote])

  // The context list: on mount, on every selector open, and after own sends.
  useEffect(() => {
    let stale = false
    remote.listContexts().then((carried) => {
      if (!stale && carried.ok) setContexts(carried.value.items)
    }, () => undefined)
    return () => { stale = true }
  }, [remote, selectorOpen, state?.status])

  // Viewing a context marks it seen up to its latest assistant row.
  useEffect(() => {
    if (state === null) return
    const latest = latestAssistantAt(state)
    if (latest !== null) markSeen(state.contextKey, latest)
  }, [state])

  // The live-turn poll: while the agent runs, pull the projection forward.
  const status = state?.status
  useEffect(() => {
    if (status !== 'running') return
    const key = contextKey
    const label = fallbackLabel
    const timer = window.setInterval(() => {
      remote.getState(key).then((carried) => {
        if (carried.ok) setState(carried.value.ok ? carried.value.state : emptyState(key, label))
      }, () => undefined)
    }, POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [status, contextKey, fallbackLabel, remote])

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
    if (element === null || composingRef.current || sessionId === undefined) return
    const text = element.value.trim()
    if (text === '') return
    setError(null)
    // Captured before the wire call: the pending refs this send folds in
    // (the optimistic row carries them until the projection catches up).
    const pendingRefs = state?.refs ?? []
    try {
      const carried = await remote.send(sessionId, { contextKey, text, label: state?.label ?? fallbackLabel })
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
      // The optimistic row: the followup's journal append lands one turn
      // later (a 1.2s poll window in which the sent message would look
      // lost), so echo it locally unless the state already shows it.
      const fresh = carried.value.state
      const tail = fresh.transcript.at(-1)
      const echoed = tail !== undefined && tail.kind === 'user' && tail.text === text
      setState(echoed
        ? fresh
        : { ...fresh, transcript: [...fresh.transcript, { kind: 'user', text, refs: pendingRefs, time: Date.now() }] })
    } catch (cause) {
      setError(t('error.send', { message: messageOf(cause) }))
    }
  }, [sessionId, contextKey, fallbackLabel, state?.label, state?.refs, remote, autosize, t])

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

  // The selector's rows: the host's list, with the CURRENT context
  // synthesized in when it has no record yet (a never-sent conversation).
  // (Above the fatal early-return: hooks never conditionally run.)
  const rows: SideChatContextSummary[] = useMemo(() => {
    const list = [...(contexts ?? [])]
    if (!list.some(row => row.contextKey === contextKey)) {
      list.unshift({
        contextKey,
        label: state?.label ?? fallbackLabel,
        status: status ?? 'new',
        refs: 0,
        updatedAt: '',
        lastAssistantAt: null,
        lastActivityAt: null,
      })
    }
    return list
  }, [contexts, contextKey, state?.label, fallbackLabel, status])

  if (fatal !== null) {
    return <div className={css.root}><div className={css.notice}>{t('state.hostMissing')}</div></div>
  }

  const unreadOf = (key: string): boolean => {
    if (key === contextKey) return false
    const row = rows.find(item => item.contextKey === key)
    return row?.lastAssistantAt !== null && row !== undefined && row.lastAssistantAt > lastSeenOf(key)
  }
  const anyUnread = rows.some(row => unreadOf(row.contextKey))

  const refs = state?.refs ?? []
  const transcript = state?.transcript ?? []
  const lastError = state?.lastError ?? null
  return (
    <div className={css.root}>
      <header className={css.header}>
        <div className={css.selector}>
          <button
            type="button"
            className={css.selectorButton}
            aria-expanded={selectorOpen}
            aria-label={t('context.switch')}
            onClick={() => { setSelectorOpen(open => !open) }}
          >
            <span className={css.title}>{state?.label ?? fallbackLabel}</span>
            <IconChevronDownOutlineMedium />
            {anyUnread && <span className={css.unreadDot} aria-label={t('context.unread')} />}
          </button>
          {selectorOpen && (
            <div className={css.selectorMenu} role="listbox">
              {rows.map(row => (
                <button
                  key={row.contextKey}
                  type="button"
                  role="option"
                  aria-selected={row.contextKey === contextKey}
                  className={css.selectorRow}
                  data-current={row.contextKey === contextKey ? 'true' : 'false'}
                  onClick={() => {
                    setSelectorOpen(false)
                    if (row.contextKey !== contextKey) onContextChange(row.contextKey)
                  }}
                >
                  <span className={css.selectorLabel}>{row.label}</span>
                  {unreadOf(row.contextKey) && <span className={css.unreadDot} aria-label={t('context.unread')} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className={css.status} data-running={status === 'running' ? 'true' : 'false'}>
          {status === undefined ? t('state.loading') : t(`status.${status}`)}
        </span>
        {headerActions}
      </header>
      {lastError !== null && lastError !== dismissedError && (
        <div className={css.errorBar} role="alert">
          <span className={css.errorBarText}>{lastError}</span>
          <button
            type="button"
            className={css.errorBarClose}
            aria-label={t('error.dismiss')}
            onClick={() => { setDismissedError(lastError) }}
          >
            ×
          </button>
        </div>
      )}
      <div className={css.transcript} ref={transcriptRef}>
        {transcript.length === 0 && status !== 'running' && (
          <div className={css.empty}>{t('state.empty')}</div>
        )}
        {transcript.map((row, index) => {
          switch (row.kind) {
            case 'user':
              return (
                <div key={`${index}-${row.time}`} className={css.userRow}>
                  <div className={css.userCol}>
                    {row.refs.length > 0 && <RefChips refs={row.refs} t={t} />}
                    {row.text !== '' && <div className={css.userBubble}>{row.text}</div>}
                  </div>
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
        <div className={css.refsRow} aria-label={t('refs.title', { count: String(refs.length) })}>
          <RefChips refs={refs} t={t} />
        </div>
      )}
      <div className={css.composer}>
        <textarea
          ref={composerRef}
          className={css.input}
          placeholder={sessionId === undefined ? t('dock.readonly') : t('composer.placeholder')}
          spellCheck={false}
          rows={1}
          readOnly={sessionId === undefined}
          onInput={onInput}
          onKeyDown={onKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
        />
        <button
          type="button"
          className={css.send}
          aria-label={t('composer.send')}
          disabled={sessionId === undefined}
          onClick={() => { void doSend() }}
        >
          <IconSendOutlineMedium />
        </button>
      </div>
      {error !== null && <div className={css.error} role="status">{error}</div>}
    </div>
  )
}
