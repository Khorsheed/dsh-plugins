/**
 * Local transcription of the open video / audio entry when it has no captions
 * (2026-10-20 decision: automatic on opening the detail, never on refresh).
 *
 * The host runs the job (`startLocalTranscript`); this hook starts it once per
 * entry, polls its status while it runs — the stretches transcribed so far
 * replace the body as they arrive, so they can be read and noted at once —
 * and hands the finished transcript over. Leaving the entry withdraws a job
 * that is still queued (a running one finishes and is stored); the 字幕 switch
 * and 取消 stop it outright. The first use asks once to download the speech
 * models.
 *
 * @module @khorsheed/dsh-reader/client/useLocalTranscript
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LocalTranscriptStatus, ReaderMedia } from '../types.ts'
import type { ReaderPaneProps } from './contract.ts'

/** How often a running job is polled (ms). */
const POLL_MS = 1500

/** States in which the job is alive on the host. */
const ACTIVE = new Set(['fetching', 'queued', 'transcribing'])

/** What the hook reads. */
export interface UseLocalTranscriptInput {
  readonly entry: { readonly id: string; readonly link?: string; readonly title: string; readonly media?: ReaderMedia } | undefined
  /** True once the pane knows the entry has no captions and no stored transcript. */
  readonly wanted: boolean
  /** The 字幕 switch is off: no transcription. */
  readonly hidden: boolean
  readonly remote: Pick<ReaderPaneProps, 'startLocalTranscript' | 'localTranscript' | 'cancelLocalTranscript'>
  /** The transcript so far (`partial`) or in full. */
  readonly onHtml: (entryId: string, html: string, partial: boolean) => void
}

/** What the pane renders. */
export interface LocalTranscriptFace {
  readonly status: LocalTranscriptStatus | undefined
  /** Seconds left, once the rate is measurable. */
  readonly etaSeconds: number | undefined
  /** Confirm the first model download and start. */
  readonly confirm: () => void
  /** Start again after a failure or a stop. */
  readonly retry: () => void
  /** Stop the running job (取消, or the 字幕 switch). */
  readonly stop: () => void
}

/**
 * The open entry's local transcription.
 *
 * @param input - the entry and what the pane knows.
 */
export function useLocalTranscript(input: UseLocalTranscriptInput): LocalTranscriptFace {
  const { entry, wanted, hidden, remote, onHtml } = input
  const [statusOf, setStatusOf] = useState<LocalTranscriptStatus | undefined>(undefined)
  const status = statusOf !== undefined && statusOf.entryId === entry?.id ? statusOf : undefined
  const started = useRef<string | null>(null)
  const lastHtml = useRef<string | undefined>(undefined)
  const rate = useRef<{ at: number; progress: number } | undefined>(undefined)
  const [eta, setEta] = useState<number | undefined>(undefined)
  const remoteRef = useRef(remote)
  remoteRef.current = remote
  const onHtmlRef = useRef(onHtml)
  onHtmlRef.current = onHtml

  const accept = useCallback((next: LocalTranscriptStatus) => {
    setStatusOf(next)
    if (next.html !== undefined && next.html !== lastHtml.current) {
      lastHtml.current = next.html
      onHtmlRef.current(next.entryId, next.html, next.state !== 'done')
    }
    if (next.state === 'transcribing' && next.progress !== undefined) {
      const now = Date.now()
      if (rate.current === undefined) rate.current = { at: now, progress: next.progress }
      else {
        const done = next.progress - rate.current.progress
        setEta(done > 0.02 ? ((now - rate.current.at) / 1000) * ((1 - next.progress) / done) : undefined)
      }
    }
  }, [])

  const begin = useCallback(async (confirmModels: boolean) => {
    if (entry?.link === undefined || entry.media === undefined) return
    started.current = entry.id
    lastHtml.current = undefined
    rate.current = undefined
    setEta(undefined)
    const answer = await remoteRef.current.startLocalTranscript({
      entryId: entry.id, url: entry.link, media: entry.media, title: entry.title, ...(confirmModels ? { confirmModels: true } : {}),
    })
    if (answer.ok) accept(answer.value)
    else setStatusOf({ entryId: entry.id, state: 'failed', error: answer.error.message })
  }, [entry, accept])

  // Start once per entry, when the pane says there is nothing else to read.
  useEffect(() => {
    if (entry === undefined || !wanted || hidden || started.current === entry.id) return
    void begin(false)
  }, [entry, wanted, hidden, begin])

  // Poll while the host works.
  const active = status !== undefined && ACTIVE.has(status.state)
  useEffect(() => {
    if (!active || entry === undefined) return undefined
    const id = entry.id
    const timer = setInterval(() => {
      void remoteRef.current.localTranscript({ entryId: id }).then(answer => { if (answer.ok) accept(answer.value) })
    }, POLL_MS)
    return () => { clearInterval(timer) }
  }, [active, entry, accept])

  // Leaving the entry withdraws a queued job (a running one finishes on the host).
  useEffect(() => {
    const id = entry?.id
    return () => {
      if (id !== undefined && started.current === id) {
        started.current = null
        void remoteRef.current.cancelLocalTranscript({ entryId: id, force: false })
      }
    }
  }, [entry?.id])

  const stop = useCallback(() => {
    if (entry === undefined) return
    void remoteRef.current.cancelLocalTranscript({ entryId: entry.id, force: true })
    setStatusOf({ entryId: entry.id, state: 'idle' })
  }, [entry])

  // The 字幕 switch turned off mid-job stops it.
  useEffect(() => {
    if (hidden && active) stop()
  }, [hidden, active, stop])

  return {
    status,
    etaSeconds: active ? eta : undefined,
    confirm: () => { void begin(true) },
    retry: () => { void begin(false) },
    stop,
  }
}
