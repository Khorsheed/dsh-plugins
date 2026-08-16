/**
 * Whalesong overlay: a fixed-position water-whalesong anchored over the official
 * sidebar whale logo (DOM anchoring, not React — the logo lives inside a
 * single slot that external plugins cannot replace). Anchors verified against
 * the slot-b 0811 snapshot:
 * - expanded sidebar: BrandWordmark inline SVG carries a stable
 *   `<clipPath id="dsh-wordmark-whale-clip">` (ui-primitives BrandWordmark.tsx);
 *   the whale occupies the left 23/182 of the 182×24 viewBox.
 * - collapsed sidebar: FishLogo, `svg[viewBox="0 0 23.16 17.04"]`.
 * Visibility is CSS-driven by the `dsh-whalesong-on` body class (see
 * whalesong.module.css); when neither logo anchor exists the overlay falls back
 * to the collapsed-rail corner with a one-time warning instead of hiding
 * (a hidden fallback made the whalesong silently invisible on older sidebars).
 * @module @deepseek-ai/dsh-whalesong/client/whalesong-overlay
 */
import css from './whalesong.module.css'

/** Screen rectangle (plain object, jsdom-friendly). */
export interface Rect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** Stable clipPath id inside BrandWordmark's inline SVG (expanded sidebar logo). */
const WORDMARK_CLIP_ID = 'dsh-wordmark-whale-clip'
/** Stable viewBox of the collapsed-sidebar FishLogo (the whole glyph is the whale). */
const FISH_VIEWBOX = '0 0 23.16 17.04'
/** Whale share of the 182-wide BrandWordmark viewBox (left 0–23 segment). */
const WORDMARK_WHALE_FRACTION = 23 / 182
/** Overlay height in px; the container's bottom edge sits on the whale's top. */
const OVERLAY_HEIGHT = 16
/** Number of droplet elements (CSS positions/delays them by nth-child). */
const DROP_COUNT = 3
/** Fallback resync cadence (ms) for cases observers miss. */
const POLL_MS = 1000
/** Mutation storms coalesce into one sync per this interval (ms). */
const THROTTLE_MS = 200
/**
 * Last-resort anchor (collapsed-rail logo corner): used when neither logo
 * variant is in the DOM — e.g. a deployment whose sidebar build predates the
 * anchor ids. The v1 behavior (stay hidden) made the whalesong silently
 * invisible there (field test 3081: overlay display:none for the whole run).
 */
const FALLBACK_RECT: Rect = { left: 12, top: 6, width: 24, height: 24 }
/** Continuous anchor-missing duration before the fallback warns (startup race tolerance). */
const WARN_GRACE_MS = 5000

/**
 * Locate the sidebar whale on screen.
 * @param doc - document to search.
 * @returns the whale's approximate screen rect, or undefined when neither logo variant is mounted.
 */
export function findWhaleRect(doc: Document): Rect | undefined {
  const wordmark = doc.getElementById(WORDMARK_CLIP_ID)?.closest('svg')
  if (wordmark != null) {
    const rect = wordmark.getBoundingClientRect()
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width * WORDMARK_WHALE_FRACTION,
      height: rect.height,
    }
  }
  const fish = doc.querySelector(`svg[viewBox="${FISH_VIEWBOX}"]`)
  if (fish != null) {
    const rect = fish.getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  }
  return undefined
}

/** Toggle the body class that shows/hides the whalesong animation (CSS does the rest). */
export function setWhalesongActive(doc: Document, active: boolean): void {
  doc.body.classList.toggle('dsh-whalesong-on', active)
}

/** Overlay lifecycle handle. */
export interface WhalesongOverlay {
  /** Force a re-anchor (exposed for tests; observers call it internally). */
  sync(): void
  /** Remove the container and every observer/listener. */
  dispose(): void
}

/**
 * Mount the whalesong overlay into `doc.body`. Position stays glued to the whale
 * through sidebar collapse/expand and window resizes via MutationObserver +
 * window resize + a low-frequency poll; a missing logo hides the overlay
 * without errors.
 * @param doc - target document (defaults to the global one).
 * @returns the overlay lifecycle handle.
 */
export function createWhalesongOverlay(doc: Document = document): WhalesongOverlay {
  const container = doc.createElement('div')
  // The module exports every key the CSS file defines; lookups are compile-time constants.
  container.className = css.whalesong!
  container.hidden = true
  for (let i = 0; i < DROP_COUNT; i += 1) {
    const drop = doc.createElement('span')
    drop.className = css.drop!
    container.appendChild(drop)
  }
  doc.body.appendChild(container)

  let missingSince: number | undefined
  let warned = false
  const sync = (): void => {
    let rect = findWhaleRect(doc)
    if (rect === undefined) {
      rect = FALLBACK_RECT
      // Startup race: the plugin often loads before the sidebar renders —
      // warn only when the anchor stays missing past the grace window.
      const now = Date.now()
      if (missingSince === undefined) {
        missingSince = now
      } else if (!warned && now - missingSince >= WARN_GRACE_MS) {
        warned = true
        console.warn('[whalesong] sidebar logo anchor not found; using fallback position')
      }
    } else {
      missingSince = undefined
    }
    container.hidden = false
    container.style.left = `${rect.left + rect.width / 2}px`
    container.style.top = `${rect.top - OVERLAY_HEIGHT}px`
  }

  // MutationObserver fires on every DOM churn; getBoundingClientRect forces
  // layout, so collapse bursts into one sync per THROTTLE_MS.
  let lastSync = 0
  const throttledSync = (): void => {
    const now = Date.now()
    if (now - lastSync < THROTTLE_MS) return
    lastSync = now
    sync()
  }

  const win = doc.defaultView
  const observer = new MutationObserver(throttledSync)
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true })
  win?.addEventListener('resize', sync)
  const poll = win?.setInterval(sync, POLL_MS)

  sync()

  return {
    sync,
    dispose() {
      observer.disconnect()
      win?.removeEventListener('resize', sync)
      if (poll !== undefined) win?.clearInterval(poll)
      container.remove()
    },
  }
}
