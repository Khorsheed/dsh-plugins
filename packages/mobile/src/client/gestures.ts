/** Horizontal navigation never claims text selection, editors or nested horizontal content. */
export function navigationSwipe(dx: number, dy: number, width: number): 'open' | 'close' | undefined {
  if (Math.abs(dx) < Math.min(72, width * .18) || Math.abs(dx) < Math.abs(dy) * 1.6) return
  return dx > 0 ? 'open' : 'close'
}
export function installNavigationGestures(doc: Document, change: (open: boolean) => void, closeSidebar?: () => void): () => void {
  type Start = { x: number; y: number; width: number; initial: number; panel?: { element: HTMLElement; side: 'left' | 'right'; close: () => void }; target: HTMLElement; dragged: boolean }
  let start: Start | undefined, suppressClickUntil = 0, suppressClickTarget: HTMLElement | undefined, animation: Animation | undefined
  const resetDrag = () => {
    start?.panel?.element.style.removeProperty('transform')
    doc.documentElement.removeAttribute('data-mobile-gesture')
    doc.documentElement.style.removeProperty('--mobile-drag-offset')
  }
  const blocked = 'input,textarea,[contenteditable],select,pre,code,[role=dialog],[role=menu],[role=slider],[role=switch],[role=checkbox],[data-mobile-tools-dialog],[data-mobile-dialog]'
  const down = (event: TouchEvent) => {
    resetDrag(); start = undefined; suppressClickUntil = 0; suppressClickTarget = undefined
    if (animation || event.touches.length !== 1 || doc.querySelector('dialog[open],[role=dialog],[role=menu]')) return
    const target = event.target as HTMLElement
    if (target.closest(blocked) || doc.getSelection()?.toString()) return
    // List rows are navigation surfaces: a tap opens, a horizontal drag dismisses.
    // All other buttons keep their existing touch behavior.
    if (target.closest('button,a') && !target.closest('[data-mobile-session],[data-mobile-workspace-group],[data-mobile-peek-close],[data-slot=sidebar]')) return
    for (let node: HTMLElement | null = target; node && node !== doc.body; node = node.parentElement) {
      if (node.scrollWidth > node.clientWidth + 4 && /auto|scroll/.test(doc.defaultView!.getComputedStyle(node).overflowX)) return
    }
    const viewport = doc.documentElement.clientWidth || doc.defaultView!.innerWidth
    if (viewport >= 960) return // A pinned two-column layout is not a drawer.
    const right = target.closest<HTMLElement>('[data-sidebar-right-panel][data-sidebar-right-open]') ?? undefined
    if (right && !right.querySelector('[data-sidebar-right-toggle]')) return
    const sidebar = closeSidebar ? target.closest<HTMLElement>('[data-slot=sidebar]')?.parentElement : undefined
    const panel = right ? { element: right, side: 'right' as const, close: () => right.querySelector<HTMLButtonElement>('[data-sidebar-right-toggle]')?.click() } : sidebar ? { element: sidebar, side: 'left' as const, close: closeSidebar! } : undefined
    const width = panel ? panel.element.getBoundingClientRect().width || viewport : Math.min(viewport * .84, 380)
    start = { target: target.closest<HTMLElement>('button,a') ?? target, x: event.touches[0]!.clientX, y: event.touches[0]!.clientY, width, initial: doc.documentElement.hasAttribute('data-mobile-library-open') ? width : 0, ...(panel ? { panel } : {}), dragged: false }
  }
  const move = (event: TouchEvent) => {
    if (!start || event.touches.length !== 1) { resetDrag(); start = undefined; return }
    const dx = event.touches[0]!.clientX - start.x, dy = event.touches[0]!.clientY - start.y
    if (!start.dragged && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { resetDrag(); start = undefined; return }
    if (!start.dragged && (Math.abs(dx) <= 12 || Math.abs(dx) <= Math.abs(dy) * 1.6)) return
    if (start.panel) {
      const direction = start.panel.side === 'right' ? 1 : -1
      if (!start.dragged && dx * direction < 0) return
      start.panel.element.style.transform = `translate3d(${direction * Math.max(0,dx * direction)}px,0,0)`
    } else {
      if (!start.dragged && (start.initial === 0 && dx < 0 || start.initial > 0 && dx > 0)) return
      doc.documentElement.setAttribute('data-mobile-gesture', '')
      doc.documentElement.style.setProperty('--mobile-drag-offset', `${Math.max(0, Math.min(start.width, start.initial + dx))}px`)
    }
    start.dragged = true
    if (event.cancelable) event.preventDefault()
  }
  const up = (event: TouchEvent) => {
    const from = start, point = event.changedTouches[0]
    if (!from || !point) { resetDrag(); start = undefined; return }
    const dx = point.clientX - from.x, dy = point.clientY - from.y
    const result = from.dragged ? navigationSwipe(dx, dy, from.width) : undefined
    if (from.dragged) { suppressClickUntil = Date.now() + 500; suppressClickTarget = from.target }
    if (from.panel && from.dragged) {
      const owner = from.panel, panel = owner.element, direction = owner.side === 'right' ? 1 : -1
      const close = result === (owner.side === 'right' ? 'open' : 'close')
      const finish = () => { animation = undefined; panel.style.removeProperty('transform'); if (close && panel.isConnected) owner.close() }
      if (panel.animate && !doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        animation = panel.animate([{ transform: `translateX(${direction * Math.max(0,dx * direction)}px)` }, { transform: `translateX(${close ? direction * from.width : 0}px)` }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' })
        animation.onfinish = finish
      } else finish()
    }
    resetDrag(); start = undefined
    if (!from.panel && result) change(result === 'open')
  }
  const cancel = () => { resetDrag(); start = undefined }
  const click = (event: MouseEvent) => {
    if (event.detail !== 0 && Date.now() < suppressClickUntil && event.target instanceof Node && (suppressClickTarget?.contains(event.target) || (event.target as HTMLElement).contains(suppressClickTarget ?? null))) { event.preventDefault(); event.stopImmediatePropagation(); suppressClickUntil = 0 }
  }
  doc.addEventListener('touchstart', down, { passive: true })
  doc.addEventListener('touchmove', move, { passive: false })
  doc.addEventListener('touchend', up)
  doc.addEventListener('touchcancel', cancel)
  doc.addEventListener('click', click, true)
  return () => { cancel(); animation?.cancel(); doc.removeEventListener('touchstart', down); doc.removeEventListener('touchmove', move); doc.removeEventListener('touchend', up); doc.removeEventListener('touchcancel', cancel); doc.removeEventListener('click', click, true) }
}
