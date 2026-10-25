/**
 * The quote chip preview card (a second `shell.overlay` entry beside the
 * selection menu): clicking a quote chip in the composer routes through the
 * trigger source's `openReference` to here, showing the quote's full text —
 * the chip label alone never tells you what you quoted. The card floats
 * beside the click (the recorded pointerdown position rides the store's
 * show), falling back to centered-over-composer without one. Dismisses on
 * the close button, Escape, or a click anywhere outside the card. A located
 * quote closes with its locator row — the absolute path the model receives
 * alongside the text, so what you see is what is sent.
 *
 * @module @khorsheed/dsh-quote/client
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-layout frame's SlotMap merge ('shell.overlay').
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from './locales.ts'
import type { QuotePreviewStore } from './reference.ts'
import css from './QuotePreview.module.css'

/** Viewport margin the card clamps to, and its gap from the click. */
const MARGIN = 8

/** Business face injected into the preview card. */
export interface QuotePreviewInjected {
  readonly preview: QuotePreviewStore
}

/** Full props of the preview card. */
export type QuotePreviewProps =
  PropsRuntime<'shell.overlay'>
  & InjectFace<QuotePreviewInjected>
  & PropsLocale<'quote'>

/** Resolved card position in the viewport (null = measuring, or the centered fallback). */
interface Placement {
  readonly left: number
  readonly top: number
}

/** The quote chip preview card. */
export function QuotePreview({ preview, t }: QuotePreviewProps): ReactNode {
  const state = useSyncExternalStore(preview.subscribe, preview.getSnapshot)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const anchored = state?.anchor !== undefined

  // Escape closes; a mousedown anywhere outside the card closes. Both listen
  // only while open.
  useEffect(() => {
    if (state === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') preview.clear()
    }
    const onPointer = (event: MouseEvent): void => {
      const root = rootRef.current
      if (root !== null && event.target instanceof Node && !root.contains(event.target)) preview.clear()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [state, preview])

  // A fresh show re-measures: the previous placement never leaks across opens.
  useEffect(() => { setPlacement(null) }, [state])

  // Two-pass placement beside the click: render hidden, measure, then clamp
  // — above the click, flipping below near the viewport top (the selection
  // menu's pattern).
  useLayoutEffect(() => {
    const root = rootRef.current
    const anchor = state?.anchor
    if (state === null || root === null || anchor === undefined || placement !== null) return
    const width = root.offsetWidth
    const height = root.offsetHeight
    const left = Math.min(Math.max(MARGIN, anchor.x - width / 2), Math.max(MARGIN, window.innerWidth - width - MARGIN))
    const above = anchor.y - height - MARGIN >= MARGIN
    const top = above ? anchor.y - height - MARGIN : anchor.y + MARGIN
    setPlacement({ left, top })
  }, [state, placement])

  if (state === null) return null
  return (
    <div
      ref={rootRef}
      className={anchored ? css.rootAnchored : css.rootCentered}
      id="quote-preview-card"
      role="dialog"
      aria-label={state.title ?? t('menu.title')}
      style={anchored
        ? {
          visibility: placement === null ? 'hidden' : 'visible',
          left: placement?.left ?? 0,
          top: placement?.top ?? 0,
        }
        : undefined}
    >
      <div className={css.head}>
        <span className={css.title}>{state.title ?? t('menu.title')}</span>
        <button type="button" className={css.close} aria-label={t('preview.close')} onClick={() => preview.clear()}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className={css.body}>{state.body}</div>
      {state.location !== undefined && (
        <div className={css.location}>
          <span className={css.locationLabel}>{t('preview.location')}</span>
          <span className={css.locationValue}>{state.location}</span>
        </div>
      )}
    </div>
  )
}
