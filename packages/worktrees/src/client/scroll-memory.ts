/**
 * View memory that outlives a tab body's unmount. The right sidebar unmounts
 * a tab's body whenever another tab or page takes over, and state held in the
 * components went with it: coming back found every folder collapsed and every
 * list scrolled to the top. Module level, like the content pane's scroll
 * offsets: the memory outlives the component, never the page.
 *
 * @module @khorsheed/dsh-worktrees/client
 */
import { useLayoutEffect, type RefObject } from 'react'

/** Scroll offsets by memory key. */
const scrollMemory = new Map<string, number>()
/** Expanded tree rows by memory key. */
export const expansionMemory = new Map<string, ReadonlySet<string>>()

/** Forget every remembered view (tests: each case starts from a fresh page). */
export function forgetViewMemory(): void {
  scrollMemory.clear()
  expansionMemory.clear()
}

/** The element itself when it scrolls vertically, else its nearest such ancestor
 * (the trees scroll inside their column; the commit list scrolls its own rows). */
function scrollParentOf(element: HTMLElement): HTMLElement | null {
  for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return node
  }
  return null
}

/**
 * Keep the scroll offset of `ref`'s scrolling column under `key`: restored
 * before paint on mount (the content is already rendered, so the height is
 * right), then followed as the user scrolls. No key, no memory.
 * @param ref - the scrolling element, or an element inside the scrolling column.
 * @param key - the view's memory key.
 */
export function useScrollMemory(ref: RefObject<HTMLElement | null>, key: string | undefined): void {
  useLayoutEffect(() => {
    if (key === undefined || ref.current === null) return undefined
    const scroller = scrollParentOf(ref.current)
    if (scroller === null) return undefined
    const saved = scrollMemory.get(key)
    if (saved !== undefined && saved > 0) scroller.scrollTop = saved
    const onScroll = (): void => { scrollMemory.set(key, scroller.scrollTop) }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [ref, key])
}
