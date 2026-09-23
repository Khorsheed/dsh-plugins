/**
 * Drag-to-resize for the worktrees tab's tree column: a localStorage-persisted
 * width with pointer handlers for the divider handle. The tab leaves its own
 * width to the right Sidebar's geometry (the sidebar owns the track, the drag
 * memory, and fullscreen); only the tree/detail divider inside the tab keeps a
 * local width. The frame-wide local-files browser that used to share this hook
 * was removed 2026-09-23 (proposal preview-kernel).
 */
import { useEffect, useRef, useState } from 'react'

/** Tree column width: the developer-tool default of 320px, draggable 300–440. */
const TREE_DEFAULT_WIDTH = 320
const TREE_MIN_WIDTH = 300
const TREE_MAX_WIDTH = 440

/** Clamp a requested tree width into the 300–440 band. */
function clampTreeWidth(width: number): number {
  return Math.max(TREE_MIN_WIDTH, Math.min(width, TREE_MAX_WIDTH))
}

/**
 * Left-column (tree) width: a localStorage-persisted divider width for the
 * tab's two-pane surface (tree | detail), so the divider drags and remembers.
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
