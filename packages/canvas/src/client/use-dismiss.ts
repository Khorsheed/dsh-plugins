/**
 * One close rule for every floating surface the canvas owns (the ＋新卡 menu,
 * the category panel, the batch 「改分类」 row, the canvas switcher): while it
 * is open, Escape closes it and so does a pointer down anywhere outside its
 * root. Before this hook each surface closed only by clicking its own trigger
 * again, which is the complaint that started the round-4 interaction pass.
 *
 * The host ships `useDismissOnOutsidePointer`, but it covers the pointer half
 * only; Escape is the half users reach for first, so the canvas keeps one
 * hook that does both rather than pairing the host's with a second listener.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import { useEffect, useRef, type RefObject } from 'react'

/**
 * Close an open surface on Escape or on an outside pointer down.
 * @param root - the element holding both the trigger and the surface, so the
 * trigger's own click toggles instead of closing-then-reopening.
 * @param open - whether the surface is showing; false detaches the listeners.
 * @param close - called once per dismissal.
 */
export function useDismiss(
  root: RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
): void {
  // The latest close, so an inline arrow does not re-subscribe every render.
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const element = root.current
      if (element !== null && event.target instanceof Node && !element.contains(event.target)) {
        closeRef.current()
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      // An IME candidate list owns its own Escape.
      if (event.key !== 'Escape' || event.isComposing) return
      closeRef.current()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [root, open])
}
