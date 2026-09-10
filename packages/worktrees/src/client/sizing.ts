/**
 * Shared drag-to-resize hooks for the local-files browser (`shell.overlay`)
 * and the worktrees tab's tree column: a localStorage-persisted width with
 * pointer handlers for the drag handle. The worktrees tab itself leaves its
 * own width to the right Sidebar's geometry (the sidebar owns the track, the
 * drag memory, and fullscreen); only the tree/detail divider inside the tab
 * keeps a local width.
 */
import { useEffect, useRef, useState } from 'react'

/** Narrowest the overlay drag handle allows — below this the two panes are unusable. */
const MIN_WIDTH = 420

/** Tree column width: the developer-tool default of 320px, draggable 300–440. */
const TREE_DEFAULT_WIDTH = 320
const TREE_MIN_WIDTH = 300
const TREE_MAX_WIDTH = 440

/** Clamp a requested tree width into the 300–440 band. */
function clampTreeWidth(width: number): number {
  return Math.max(TREE_MIN_WIDTH, Math.min(width, TREE_MAX_WIDTH))
}

/** Clamp a requested width between the minimum and 92% of the viewport. */
function clampWidth(width: number, viewport: number): number {
  return Math.max(MIN_WIDTH, Math.min(width, Math.round(viewport * 0.92)))
}

/**
 * Shared drawer-width state: a localStorage-persisted, left-edge draggable
 * width for a right-side overlay panel (the local-files browser).
 * @param widthKey - localStorage key for the persisted width.
 * @param defaultWidth - the default when nothing is saved.
 * @param minWidth - the narrowest drag allows.
 * @returns the current width and the pointer handlers for the left handle.
 */
export function useDrawerWidth(widthKey: string, defaultWidth: number, minWidth: number): {
  width: number
  onPointerDown: (event: { clientX: number; pointerId: number; currentTarget: HTMLElement }) => void
  onPointerMove: (event: { clientX: number }) => void
  onPointerUp: () => void
} {
  const [width, setWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(widthKey))
      return Number.isFinite(saved) && saved >= minWidth ? saved : defaultWidth
    } catch {
      return defaultWidth
    }
  })
  const drag = useRef<{ startX: number; startW: number } | null>(null)
  useEffect(() => {
    try { localStorage.setItem(widthKey, String(width)) } catch { /* quota/private-mode: non-fatal */ }
  }, [width, widthKey])
  const onPointerDown = (event: { clientX: number; pointerId: number; currentTarget: HTMLElement }): void => {
    drag.current = { startX: event.clientX, startW: width }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const onPointerMove = (event: { clientX: number }): void => {
    if (drag.current === null) return
    setWidth(clampWidth(drag.current.startW + (drag.current.startX - event.clientX), window.innerWidth))
  }
  const onPointerUp = (): void => { drag.current = null }
  return { width, onPointerDown, onPointerMove, onPointerUp }
}

/**
 * Shared left-column (tree) width: a localStorage-persisted divider width for
 * a two-pane surface (tree | detail). Both the worktrees tab and the
 * local-files browser use it so the divider drags and remembers identically.
 * @param widthKey - localStorage key for the persisted width.
 * @returns the current width and the pointer handlers for the divider handle.
 */
export function useTreeWidth(widthKey: string): {
  width: number
  onPointerDown: (event: { clientX: number; pointerId: number; currentTarget: HTMLElement }) => void
  onPointerMove: (event: { clientX: number }) => void
  onPointerUp: () => void
} {
  const [width, setWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(widthKey))
      return Number.isFinite(saved) && saved >= TREE_MIN_WIDTH ? saved : TREE_DEFAULT_WIDTH
    } catch {
      return TREE_DEFAULT_WIDTH
    }
  })
  const drag = useRef<{ startX: number; startW: number } | null>(null)
  useEffect(() => {
    try { localStorage.setItem(widthKey, String(width)) } catch { /* non-fatal */ }
  }, [width, widthKey])
  const onPointerDown = (event: { clientX: number; pointerId: number; currentTarget: HTMLElement }): void => {
    drag.current = { startX: event.clientX, startW: width }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const onPointerMove = (event: { clientX: number }): void => {
    if (drag.current === null) return
    // Right edge of the tree column: dragging right widens it.
    setWidth(clampTreeWidth(drag.current.startW + (event.clientX - drag.current.startX)))
  }
  const onPointerUp = (): void => { drag.current = null }
  return { width, onPointerDown, onPointerMove, onPointerUp }
}
