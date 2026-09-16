/**
 * Content search that keeps the rendered body rendered.
 *
 * The pane's first search implementation dropped the document view the moment
 * a query hit: the body became the raw matched-lines `<pre>`, which guaranteed
 * visibility but threw the reading form away — markdown source is full of
 * `**`/`###`/table pipes, and a JSON tree or CSV table collapsed back to text,
 * so locating the hit in a long line was work. Painting the hits over the
 * rendered body is possible without touching the DOM: the CSS Custom Highlight
 * API registers `Range`s in a document-level registry and the browser draws
 * them through `::highlight()`. Nothing React owns is mutated (no `<mark>`
 * wrapping, no reconciliation hazard), and the observer below can never
 * observe its own paint and re-scan forever.
 *
 * The raw matched-line view stays as the honest fallback, not the default: a
 * query that matches only source syntax (`**`, a fence), or that lives inside
 * a JSON node the tree has collapsed, has no visible Range at all — there the
 * pane shows the raw lines again, where the hit is visible by construction.
 *
 * @module @khorsheed/dsh-client-ui-file-preview
 */

import { useEffect, useState, type RefObject } from 'react'

/** Registry names painted by this pane's `::highlight()` rules (module CSS). */
export const SEARCH_HITS = 'dsh-file-search-hits'
export const SEARCH_ACTIVE = 'dsh-file-search-active'

/** Marks chrome the scan must ignore (the format banner, truncation notices). */
export const SEARCH_SKIP_ATTRIBUTE = 'data-dsh-search-skip'

/** Elements whose text is chrome, not content: a copy button's own label would
 * otherwise count as a hit. */
const SKIP_TAGS = new Set(['BUTTON', 'SCRIPT', 'STYLE', 'TEXTAREA'])

/** Painted-hit cap. Counting is uncapped — the counter must tell the truth —
 * but a one-character query over a large file is thousands of ranges and
 * painting every one costs more than it informs. */
const MAX_PAINTED_HITS = 2000

/** `Highlight.add` batches, so a huge match set never exceeds the argument cap. */
const PAINT_BATCH = 500

/** The slice of the Highlight API this module uses. The DOM lib types for it
 * vary by TypeScript version, so the shape is declared here and probed at
 * runtime instead of being compiled against. */
interface HighlightLike {
  add(range: Range): void
}
interface HighlightCtor {
  new (): HighlightLike
}
interface HighlightRegistryLike {
  set(name: string, highlight: HighlightLike): void
  delete(name: string): void
}

const registryOf = (): HighlightRegistryLike | undefined =>
  (globalThis as { CSS?: { highlights?: HighlightRegistryLike } }).CSS?.highlights

const highlightCtorOf = (): HighlightCtor | undefined =>
  (globalThis as { Highlight?: HighlightCtor }).Highlight

/**
 * Whether this browser can paint hits over rendered content at all. Every
 * Chromium-based host has the Custom Highlight API; jsdom does not, which is
 * exactly the split the pane must degrade across.
 * @returns true when both the registry and the `Highlight` constructor exist.
 */
export function supportsRenderedSearch(): boolean {
  return registryOf() !== undefined && highlightCtorOf() !== undefined
}

/** Whether one text node is chrome (a button label, a marked banner/notice). */
function isChrome(node: Text): boolean {
  for (let el = node.parentElement; el !== null; el = el.parentElement) {
    if (SKIP_TAGS.has(el.tagName)) return true
    if (el.hasAttribute(SEARCH_SKIP_ATTRIBUTE)) return true
  }
  return false
}

/**
 * Every occurrence of `query` (case-insensitive) in the RENDERED text under
 * `root`, in document order. The set describes what the user can actually
 * see — chrome text is skipped — which is what the counter reports.
 * @param root - the scrollport whose subtree is the rendered body.
 * @param query - the trimmed query ('' yields no ranges).
 * @returns the match ranges; empty when the query has no visible occurrence.
 */
export function collectMatchRanges(root: Node, query: string): Range[] {
  const needle = query.toLowerCase()
  if (needle === '') return []
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text
    if (text.data === '' || isChrome(text)) continue
    const haystack = text.data.toLowerCase()
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
      const range = document.createRange()
      range.setStart(text, at)
      range.setEnd(text, at + needle.length)
      ranges.push(range)
    }
  }
  return ranges
}

/**
 * Paint `ranges` through the registry — the active hit in its own name, so the
 * jump target reads differently from the rest — or clear both names when there
 * is nothing to paint.
 * @param ranges - the visible hits, in document order.
 * @param active - the jump target's index (clamped here; the caller's cursor
 * may still be sized against the raw-line hit count while unmeasured).
 */
export function paintRanges(ranges: readonly Range[], active: number): void {
  const registry = registryOf()
  const Ctor = highlightCtorOf()
  if (registry === undefined || Ctor === undefined) return
  registry.delete(SEARCH_HITS)
  registry.delete(SEARCH_ACTIVE)
  if (ranges.length === 0) return
  const hits = new Ctor()
  for (let i = 0; i < ranges.length && i < MAX_PAINTED_HITS; i += PAINT_BATCH) {
    for (const range of ranges.slice(i, i + PAINT_BATCH)) hits.add(range)
  }
  registry.set(SEARCH_HITS, hits)
  const target = ranges[Math.min(Math.max(active, 0), ranges.length - 1)]
  if (target !== undefined) {
    const focused = new Ctor()
    focused.add(target)
    registry.set(SEARCH_ACTIVE, focused)
  }
}

/** Drop this pane's registered highlights (query left, body unmounted). */
export function clearPaintedRanges(): void {
  const registry = registryOf()
  registry?.delete(SEARCH_HITS)
  registry?.delete(SEARCH_ACTIVE)
}

/**
 * Bring one hit into view inside its own scrollport. A `Range` has no
 * `scrollIntoView`, and the element-level API would walk up and move whatever
 * else the shell scrolls, so the rects are compared and only this container
 * scrolls.
 * @param range - the hit to reveal.
 * @param container - the scrollport that contains it.
 */
export function scrollRangeIntoView(range: Range, container: HTMLElement): void {
  // Non-visual environments (jsdom) have no Range rects at all.
  if (typeof range.getBoundingClientRect !== 'function') return
  const rect = range.getBoundingClientRect()
  const box = container.getBoundingClientRect()
  // A collapsed/zero rect means "not laid out" (hidden, or jsdom) — never scroll blind.
  if (rect.width === 0 && rect.height === 0) return
  if (rect.top >= box.top && rect.bottom <= box.bottom) return
  container.scrollTop += rect.top - box.top - (box.height - rect.height) / 2
}

/** rAF-coalesced rescans (non-visual environments fall back to a timer). */
const schedule = (run: () => void): number =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : window.setTimeout(run, 16)

const cancelSchedule = (id: number): void => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
  else window.clearTimeout(id)
}

/** What the pane needs to choose between the rendered body and the raw lines. */
export interface RenderedSearch {
  /** Visible hits in the rendered body, or null while this query is unmeasured. */
  count: number | null
  /** No visible hit this query: the pane shows the raw matched lines instead. */
  fallback: boolean
}

/**
 * Register the query's visible hits over the rendered body mounted at
 * `rootRef`. `enabled` is the caller's environmental gate (a text read whose
 * body renders in this DOM, and a browser with the API); the fallback latch is
 * this hook's own, so a query with no visible hit falls back for that query
 * alone and the next query measures again.
 *
 * The scan re-runs when the body's DOM changes — a JSON node expanded, a
 * markdown re-render — because the registry paints Ranges, not DOM marks, an
 * observer can never observe its own paint.
 *
 * One caller contract follows: while `count` is null the query is unmeasured,
 * so the rendered body must STAY mounted (its DOM is what gets scanned); the
 * raw fallback applies only once `fallback` turns true, or the scan would
 * measure the fallback view instead of the body it is deciding about.
 * @param options - the scrollport ref, the query, the jump target, and the gate.
 * @returns the painted-hit count (null while unmeasured) and the fallback latch.
 */
export function useRenderedSearch(options: {
  rootRef: RefObject<HTMLElement>
  query: string
  active: number
  enabled: boolean
}): RenderedSearch {
  const { rootRef, query, active, enabled } = options
  // Keyed by query: a count from a previous query must never decide the current
  // one's mode (that is how a fallback and a rendered body would oscillate).
  const [measured, setMeasured] = useState<{ query: string; count: number } | null>(null)
  const current = measured !== null && measured.query === query ? measured : null
  const fallback = current !== null && current.count === 0
  const live = enabled && !fallback && query !== ''
  useEffect(() => {
    const root = rootRef.current
    if (!live || root === null || !supportsRenderedSearch()) {
      clearPaintedRanges()
      return
    }
    let cancelled = false
    let scheduled: number | null = null
    const scan = (): void => {
      if (cancelled) return
      const ranges = collectMatchRanges(root, query)
      paintRanges(ranges, active)
      setMeasured(prev => (prev !== null && prev.query === query && prev.count === ranges.length) ? prev : { query, count: ranges.length })
      const target = ranges[Math.min(Math.max(active, 0), ranges.length - 1)]
      if (target !== undefined) scrollRangeIntoView(target, root)
    }
    scan()
    const observer = new MutationObserver(() => {
      if (scheduled !== null) return
      scheduled = schedule(() => { scheduled = null; scan() })
    })
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => {
      cancelled = true
      if (scheduled !== null) cancelSchedule(scheduled)
      observer.disconnect()
      clearPaintedRanges()
    }
  }, [rootRef, query, active, live])
  return { count: current?.count ?? null, fallback }
}
