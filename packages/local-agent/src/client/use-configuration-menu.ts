import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

/** Shared dismissal and placement for settings and member configuration menus. */
export function useConfigurationMenu(preferred: 'above' | 'below') {
  const root = useRef<HTMLDetailsElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<CSSProperties>()
  useEffect(() => {
    const dismiss = (event: Event): void => {
      if (root.current?.open && event.target instanceof Node && !root.current.contains(event.target)) {
        root.current.open = false
        setOpen(false)
      }
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !root.current?.open) return
      event.preventDefault(); event.stopPropagation()
      root.current.open = false
      setOpen(false)
      root.current.querySelector('summary')?.focus()
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('focusin', dismiss)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('focusin', dismiss)
      document.removeEventListener('keydown', escape, true)
    }
  }, [])
  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      if (!root.current || !panel.current) return
      const anchor = root.current.getBoundingClientRect()
      const dialog = root.current.closest('[role="dialog"], dialog')?.getBoundingClientRect()
      const bounds = { left: Math.max(8, (dialog?.left ?? 0) + 8), right: Math.min(window.innerWidth - 8, (dialog?.right ?? window.innerWidth) - 8), top: Math.max(8, (dialog?.top ?? 0) + 8), bottom: Math.min(window.innerHeight - 8, (dialog?.bottom ?? window.innerHeight) - 8) }
      const above = Math.max(0, anchor.top - bounds.top - 6)
      const below = Math.max(0, bounds.bottom - anchor.bottom - 6)
      const needed = Math.min(panel.current.scrollHeight, 400)
      const up = preferred === 'above' ? above >= needed || above >= below : below < needed && above > below
      const width = Math.max(0, Math.min(300, bounds.right - bounds.left))
      const left = Math.max(bounds.left, Math.min(preferred === 'above' ? anchor.right - width : anchor.left, bounds.right - width)) - anchor.left
      setStyle({ width, left, right: 'auto', top: up ? 'auto' : 'calc(100% + 6px)', bottom: up ? 'calc(100% + 6px)' : 'auto', maxHeight: Math.min(400, up ? above : below) })
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place)
    if (panel.current) observer?.observe(panel.current)
    window.addEventListener('resize', place)
    const scroll = (event: Event): void => { if (!(event.target instanceof Node) || !root.current?.contains(event.target)) place() }
    document.addEventListener('scroll', scroll, true)
    return () => { observer?.disconnect(); window.removeEventListener('resize', place); document.removeEventListener('scroll', scroll, true) }
  }, [open, preferred])
  return { root, panel, open, setOpen, style }
}
