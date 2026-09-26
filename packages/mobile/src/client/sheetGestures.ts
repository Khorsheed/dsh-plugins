/** Mobile dismissal delegates to native dialog.close or the Room owner's close handler. */
export function installSheetGestures(doc: Document): () => void {
  type Drag = { sheet: HTMLElement; overlay: HTMLElement; x: number; y: number; outside: boolean; dragging: boolean; transform: string }
  let drag: Drag | undefined
  const reset = () => { if (drag) drag.sheet.style.transform = drag.transform; drag = undefined }
  const close = (overlay: HTMLElement) => {
    if (overlay.isConnected && doc.documentElement.hasAttribute('data-dsh-mobile')) {
      if (overlay instanceof HTMLDialogElement) { overlay.close(); return }
      overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    }
  }
  const down = (event: TouchEvent) => {
    reset()
    if (!doc.documentElement.hasAttribute('data-dsh-mobile') || event.touches.length !== 1) return
    const target = event.target as HTMLElement
    const native = target.closest<HTMLDialogElement>('dialog[data-mobile-tools-dialog][open]')
    const overlay = native ?? target.closest<HTMLElement>('[data-mobile-room-overlay]')
    const sheet = native ?? overlay?.querySelector<HTMLElement>('[data-mobile-room-form]')
    if (!sheet || !overlay || !native && doc.querySelector('dialog[open]') || doc.getSelection()?.toString()) return
    const point = event.touches[0]!, bounds = sheet.getBoundingClientRect()
    const outside = native ? target === native && (point.clientY < bounds.top || point.clientY > bounds.bottom || point.clientX < bounds.left || point.clientX > bounds.right) : target === overlay
    // Only the handle/title band claims drags; the form body keeps native scrolling.
    if (!outside && (sheet.scrollTop > 0 || point.clientY > sheet.getBoundingClientRect().top + 96
      || target.closest('button,input,textarea,select,details,a,[contenteditable],[role=menu]'))) return
    drag = { sheet, overlay, x: point.clientX, y: point.clientY, outside, dragging: false, transform: sheet.style.transform }
  }
  const move = (event: TouchEvent) => {
    if (!drag) return
    if (event.touches.length !== 1 || !drag.sheet.isConnected || !doc.documentElement.hasAttribute('data-dsh-mobile')) { reset(); return }
    const dx = event.touches[0]!.clientX - drag.x, dy = event.touches[0]!.clientY - drag.y
    if (drag.outside) { if (Math.hypot(dx, dy) > 10) reset(); return }
    if (!drag.dragging && (dy < -10 || Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy))) { reset(); return }
    if (!drag.dragging && (dy < 12 || dy < Math.abs(dx) * 1.5)) return
    drag.dragging = true
    drag.sheet.style.transform = `translate3d(0,${Math.max(0, dy)}px,0)`
    if (event.cancelable) event.preventDefault()
  }
  const up = (event: TouchEvent) => {
    const from = drag, point = event.changedTouches[0]
    reset()
    if (!from || !point) return
    const dx = point.clientX - from.x, dy = point.clientY - from.y
    if (from.outside && Math.hypot(dx, dy) <= 10 || from.dragging && dy >= 72 && dy > Math.abs(dx) * 1.5) {
      // Suppress the compatibility mouse sequence; the owner receives one close action.
      if (event.cancelable) event.preventDefault()
      close(from.overlay)
    }
  }
  doc.addEventListener('touchstart', down, { passive: true })
  doc.addEventListener('touchmove', move, { passive: false })
  doc.addEventListener('touchend', up, { passive: false })
  doc.addEventListener('touchcancel', reset)
  return () => {
    reset(); doc.removeEventListener('touchstart', down); doc.removeEventListener('touchmove', move)
    doc.removeEventListener('touchend', up); doc.removeEventListener('touchcancel', reset)
  }
}
