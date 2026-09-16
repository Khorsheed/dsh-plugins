/**
 * The app-level text-selection seam: one small injectable source the floating
 * menu subscribes to, so component tests drive snapshots directly and never
 * touch the real `window.getSelection()`.
 *
 * This IS the repo's last-resort DOM anchor (the side-chat M2 probe found no
 * official selection seam), held to the narrowest honest read: the selected
 * PLAIN TEXT and its bounding rect. The one structural judgment is the
 * exclusion the gesture itself requires — a selection inside an editable
 * (input, textarea, contenteditable) is the user's editing, not a quote
 * source, and a selection inside the menu's own root is the user interacting
 * with the menu. Host DOM redesigns can only defeat the read, and the
 * fallback semantics are silent disappearance: the menu never appears,
 * nothing breaks, and the miss is logged at debug level only.
 *
 * @module @khorsheed/dsh-quote/client
 */

/** Viewport-aligned rectangle of one selection (fixed-position coordinates). */
export interface SelectionRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** One quotable selection: the plain text and where it sits in the viewport. */
export interface SelectionSnapshot {
  readonly text: string
  readonly rect: SelectionRect
}

/** Sink for selection updates; `null` hides the menu. */
export type SelectionListener = (snapshot: SelectionSnapshot | null) => void

/**
 * The injectable seam: `start` wires the source and returns its teardown.
 * The real implementation listens at app level; tests supply a manual one.
 */
export interface SelectionSource {
  start(listener: SelectionListener): () => void
}

/** Whether one node sits inside an editable the selection gesture must not interrupt. */
function isEditable(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement
  return element?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])') !== null
}

/**
 * Classify the live selection into a snapshot (or `null` to hide): only a
 * non-collapsed, non-blank selection whose anchor and focus both sit outside
 * editables and outside the menu's own root qualifies.
 * @param selection - the window selection (may be null on non-browser hosts).
 * @param own - probe: is this node inside the menu's own root element.
 * @returns the snapshot, or null.
 */
export function classifySelection(
  selection: Selection | null,
  own: (node: Node) => boolean,
): SelectionSnapshot | null {
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null
  const text = selection.toString()
  if (text.trim() === '') return null
  const anchor = selection.anchorNode
  if (anchor !== null && (own(anchor) || isEditable(anchor))) return null
  const focus = selection.focusNode
  if (focus !== null && (own(focus) || isEditable(focus))) return null
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  return { text, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } }
}

/** A selection source that also accepts the menu root (the real implementation). */
export interface RootedSelectionSource extends SelectionSource {
  /** Attach the menu's root element (the own-selection exclusion). */
  attachRoot(element: HTMLElement | null): void
}

/** Debounce for keyboard-driven selection changes (drag selection reports on mouseup). */
const SETTLE_MS = 120

/**
 * The real app-level source: `selectionchange` debounced while nothing is
 * held down, an immediate pass on mouseup (the selection is final then), and
 * an unconditional hide on scroll/resize (the cached viewport rect is stale).
 * The menu root is attached by the component's ref callback, so a selection
 * inside the menu never re-arms it.
 * @param win - the host window (injectable for tests).
 * @returns the selection source.
 */
export function createSelectionSource(win: Window): RootedSelectionSource {
  let root: HTMLElement | null = null
  const own = (node: Node): boolean => root !== null && root.contains(node)
  return {
    start(listener) {
      let mouseDown = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const evaluate = (): void => {
        try {
          listener(classifySelection(win.getSelection(), own))
        } catch {
          // The anchor read failed (a host redesign, a detached node): silent
          // disappearance is the documented fallback — never a thrown boot.
          listener(null)
        }
      }
      const schedule = (): void => {
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(() => { timer = undefined; evaluate() }, SETTLE_MS)
      }
      const onSelectionChange = (): void => {
        if (mouseDown) return // mid-drag: the rect flickers; mouseup reports
        schedule()
      }
      const onMouseDown = (): void => { mouseDown = true }
      const onMouseUp = (): void => {
        mouseDown = false
        // The selection settles after the mouseup handlers — read next tick.
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(() => { timer = undefined; evaluate() }, 0)
      }
      const hide = (): void => { listener(null) }
      const doc = win.document
      doc.addEventListener('selectionchange', onSelectionChange)
      doc.addEventListener('mousedown', onMouseDown, true)
      doc.addEventListener('mouseup', onMouseUp, true)
      win.addEventListener('scroll', hide, true)
      win.addEventListener('resize', hide)
      return () => {
        if (timer !== undefined) clearTimeout(timer)
        doc.removeEventListener('selectionchange', onSelectionChange)
        doc.removeEventListener('mousedown', onMouseDown, true)
        doc.removeEventListener('mouseup', onMouseUp, true)
        win.removeEventListener('scroll', hide, true)
        win.removeEventListener('resize', hide)
      }
    },
    /** Attach the menu's root element (the own-selection exclusion). */
    attachRoot(element: HTMLElement | null): void { root = element },
  }
}
