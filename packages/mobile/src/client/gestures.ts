/** Horizontal navigation never claims text selection, controls or nested horizontal content. */
export function navigationSwipe(dx: number, dy: number, width: number): 'open' | 'close' | undefined {
  if (Math.abs(dx) < Math.min(72, width * .18) || Math.abs(dx) < Math.abs(dy) * 1.6) return
  return dx > 0 ? 'open' : 'close'
}
export function installNavigationGestures(doc: Document, change: (open: boolean) => void): () => void {
  let start: { x: number; y: number } | undefined
  const resetDrag = () => { doc.documentElement.removeAttribute('data-mobile-gesture'); doc.documentElement.style.removeProperty('--mobile-drag-offset') }
  const blocked = 'input,textarea,[contenteditable],button,a,select,pre,code,[role=dialog],[role=menu],[role=slider],[data-mobile-tools-dialog],[data-mobile-dialog]'
  const down = (event: TouchEvent) => {
    start = undefined
    resetDrag()
    if (event.touches.length !== 1 || doc.querySelector('dialog[open],[role=dialog],[role=menu]')) return
    const target = event.target as HTMLElement
    if (target.closest(blocked) || doc.getSelection()?.toString()) return
    for (let node: HTMLElement | null = target; node && node !== doc.body; node = node.parentElement) {
      if (node.scrollWidth > node.clientWidth + 4 && /auto|scroll/.test(getComputedStyle(node).overflowX)) return
    }
    start = { x: event.touches[0]!.clientX, y: event.touches[0]!.clientY }
  }
  const move = (event: TouchEvent) => {
    if (!start || event.touches.length !== 1) { start = undefined; resetDrag(); return }
    const dx = event.touches[0]!.clientX - start.x, dy = event.touches[0]!.clientY - start.y
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { start = undefined; resetDrag(); return }
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.6 && doc.documentElement.clientWidth < 960) {
      const width = Math.min(doc.documentElement.clientWidth * .84, 380)
      const initial = doc.documentElement.hasAttribute('data-mobile-library-open') ? width : 0
      if (initial === 0 && dx < 0) return
      doc.documentElement.setAttribute('data-mobile-gesture', '')
      doc.documentElement.style.setProperty('--mobile-drag-offset', `${Math.max(0, Math.min(width, initial + dx))}px`)
      if (event.cancelable) event.preventDefault()
    }
  }
  const up = (event: TouchEvent) => {
    if (!start || !event.changedTouches[0]) { start = undefined; resetDrag(); return }
    const result = navigationSwipe(event.changedTouches[0].clientX - start.x, event.changedTouches[0].clientY - start.y, doc.documentElement.clientWidth)
    start = undefined
    resetDrag()
    if (result) change(result === 'open')
  }
  const cancel = () => { start = undefined; resetDrag() }
  doc.addEventListener('touchstart', down, { passive: true })
  doc.addEventListener('touchmove', move, { passive: false })
  doc.addEventListener('touchend', up)
  doc.addEventListener('touchcancel', cancel)
  return () => { cancel(); doc.removeEventListener('touchstart', down); doc.removeEventListener('touchmove', move); doc.removeEventListener('touchend', up); doc.removeEventListener('touchcancel', cancel) }
}
