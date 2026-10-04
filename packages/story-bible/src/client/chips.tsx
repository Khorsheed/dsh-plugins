/**
 * The session-header gate chips (F1-5): 未确认的 plan / 未处理的待审 never
 * sink. Two entries on the official `conversation.session.header.utilities`
 * seat (a list slot — a chip with nothing to show renders nothing, per the
 * visibility doc), each probing its gate through the story Remote for the
 * SESSION's focused work, and jumping into the story tab on click. The
 * chips are session-bound chrome: they follow the preset-visibility
 * criterion (preset-visibility.ts) and fail open on every unreadable path.
 *
 * @module @khorsheed/dsh-story-bible/client
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type {} from './locales.ts'
import type { StoryUiState } from './store.ts'
import css from './storytab.module.css'

/** What a chip reads each beat: the gate's state (null = nothing to show). */
export interface GateRead<T> {
  /** Read the gate (null hides the chip). */
  read: () => Promise<T | null>
}

/** The slot runtime's materialization of the face's `hooks: { story }` source. */
export type UseStory = <S>(selector: (state: StoryUiState) => S) => S

/** The plan chip's injected face. */
export interface PlanChipInjected extends GateRead<{ n: number; title: string }> {
  /** Jump: open the story tab at the reader pane on that chapter. */
  jump: (n: number) => void
  /** The preset criterion for this session (fail-open inside). */
  show: () => boolean
  /** The face declares `hooks: { story }`; the runtime binds it into this prop. */
  useStory: UseStory
}

/** The pending chip's injected face. */
export interface PendingChipInjected extends GateRead<{ count: number }> {
  /** Jump: open the story tab at the fragments pane with the queue pulsing. */
  jump: () => void
  show: () => boolean
  /** The face declares `hooks: { story }`; the runtime binds it into this prop. */
  useStory: UseStory
}

/** How often a chip re-reads its gate (agent writes are unannounced). */
export const CHIP_POLL_MS = 5000

/** The plan chip's props (the slot runtime composes them). */
export interface PlanChipProps extends PlanChipInjected {
  readonly sessionId: SessionId | undefined
  readonly t: TranslateNS<'story'>
}

/** The pending chip's props. */
export interface PendingChipProps extends PendingChipInjected {
  readonly sessionId: SessionId | undefined
  readonly t: TranslateNS<'story'>
}

/** The shared beat: re-read on mount, on the store's rev, and on the slow poll. */
function useGate<T>(props: { read: () => Promise<T | null>; useStory: UseStory }): T | null {
  // The face's `hooks: { story }` arrives as the `useStory` prop (the slot
  // runtime's materialization): a hook, subscribed through React — never a
  // `props.hooks` member access (that object does not exist at runtime).
  const rev = props.useStory(current => current.rev)
  const [gate, setGate] = useState<T | null>(null)
  useEffect(() => {
    let cancelled = false
    const beat = (): void => {
      try {
        // A rejected read keeps the last state (fail-open on data); a
        // SYNCHRONOUS throw (a face whose read is not a function, a Remote
        // namespace not mounted) is the same non-crash: the chip stays hidden.
        void Promise.resolve().then(() => props.read()).then(value => { if (!cancelled) setGate(value) }).catch(() => { /* keep the last state */ })
      } catch {
        /* never crash the header */
      }
    }
    beat()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') beat() }, CHIP_POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.read, rev])
  return gate
}

/** 未确认的 plan chip. */
export function StoryPlanChip(props: PlanChipProps): ReactNode {
  const gate = useGate(props)
  if (!props.show()) return null
  if (gate === null) return null
  return (
    <button
      type="button"
      className={css.chip}
      onClick={() => { props.jump(gate.n) }}
      title={t(props, 'chip.planHint')}
    >
      {t(props, 'chip.plan', { n: String(gate.n) })}
    </button>
  )
}

/** 待确认 chip. */
export function StoryPendingChip(props: PendingChipProps): ReactNode {
  const gate = useGate(props)
  if (!props.show()) return null
  if (gate === null || gate.count === 0) return null
  return (
    <button
      type="button"
      className={`${css.chip} ${css.chipPending}`}
      onClick={() => { props.jump() }}
      title={t(props, 'chip.pendingHint')}
    >
      {t(props, 'chip.pending', { count: String(gate.count) })}
    </button>
  )
}

/** The chip's translate (its props carry t). */
function t(props: { t: TranslateNS<'story'> }, key: Parameters<TranslateNS<'story'>>[0], params?: Record<string, string>): string {
  return props.t(key, params)
}
