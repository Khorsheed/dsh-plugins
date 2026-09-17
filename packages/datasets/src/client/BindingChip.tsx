/**
 * The composer's DATASET BINDING chip — one line saying which dataset
 * repository this session is bound to, and how much of it the agent may read.
 *
 * It exists because `/datasets bind` produced no visible receipt where a
 * person could see one. The binding lands in the plugin's own store and the
 * 题集 tab shows it correctly, but the tab strip only appears once a session
 * has content, and binding is the FIRST thing done in a session that is still
 * empty — so the one command whose whole output is "it worked" answered into a
 * part of the screen that was not there yet (I5·T39 · G2). The composer tool
 * row is there from the first frame.
 *
 * It is read-only on purpose. Binding is a human act with two doors already
 * (the slash command and the tab's import form), and a third one wedged into
 * the composer would be a third place for the same decision to be made.
 *
 * REFRESH: the chip re-reads on every settled change to its session, throttled
 * — a slash command moves the session snapshot when it starts and again when
 * it settles, which is exactly the moment the receipt has to appear, and the
 * throttle keeps a streaming turn from turning that into a poll.
 */
import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { DatasetBinding } from '../types.ts'
import css from './BindingChip.module.css'

/** How long two session notifications are collapsed into one re-read. */
const REFRESH_THROTTLE_MS = 800

/** What the chip needs: the binding, and a signal that the session moved. */
export interface BindingChipInjected {
  /** This session's binding, or null when it has none. */
  fetchBinding: (sessionId: SessionId) => Promise<RemoteResult<DatasetBinding | null>>
  /**
   * Subscribe to this session's own activity. Every slash command settles
   * through it, which is how the bind receipt arrives without a poll.
   * @returns the unsubscribe function.
   */
  watchSession: (sessionId: SessionId, listener: () => void) => () => void
}

/** Full props of the chip entry. */
export type BindingChipProps =
  & PropsRuntime<'conversation.input.left'>
  & InjectFace<BindingChipInjected>
  & PropsLocale<'datasets'>

/** The last path segment — the repository's name, which is what a person calls it. */
function repoName(path: string): string {
  const segments = path.replace(/\/+$/, '').split('/')
  return segments[segments.length - 1] ?? path
}

/**
 * The chip.
 * @param props - the runtime session, the injected face, the copy.
 */
export function BindingChip(props: BindingChipProps) {
  const { sessionId, fetchBinding, watchSession, t } = props
  // `undefined` = not answered yet. The chip renders nothing until the first
  // answer: a flash of 未绑定 on every page load would be a false alarm about
  // the one fact this chip exists to state.
  const [binding, setBinding] = useState<DatasetBinding | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = (): void => {
      void fetchBinding(sessionId).then((result) => {
        if (!cancelled) setBinding(result.ok ? result.value : null)
      }, () => { /* an unreachable host leaves the last answer standing */ })
    }
    read()
    const stop = watchSession(sessionId, () => {
      if (timer !== undefined) return
      timer = setTimeout(() => { timer = undefined; read() }, REFRESH_THROTTLE_MS)
    })
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
      stop()
    }
  }, [sessionId, fetchBinding, watchSession])

  if (binding === undefined) return null
  if (binding === null) {
    return (
      <span className={`${css.chip} ${css.unbound}`} title={t('chip.unboundHint')}>
        <span className={css.label}>{t('chip.label')}</span>
        <span>{t('chip.unbound')}</span>
      </span>
    )
  }
  const layers = binding.layers === undefined
    ? t('chip.layersFloor')
    : t('chip.layersNamed', { layers: binding.layers.join(', ') })
  return (
    <span
      className={css.chip}
      title={t('chip.boundHint', { repo: binding.repoPath, layers })}
    >
      <span className={css.label}>{t('chip.label')}</span>
      <span className={css.repo}>{repoName(binding.repoPath)}</span>
      <span className={css.layers}>{layers}</span>
    </span>
  )
}
