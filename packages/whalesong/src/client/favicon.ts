/**
 * Favicon animator: while any task runs, the tab icon becomes the whale
 * singing (water drops) (visible without switching to the page); when nothing
 * runs, the tab icon stays a static whale in the same page-matched color —
 * never the stock favicon, whose `@media (prefers-color-scheme)` follows the
 * OS and renders a white whale on a light page (invisible) when the two
 * disagree. The stock icon is an SVG, so frames are pure SVG variants — the
 * "waterline + bubbles" composition (user-picked on the v1.2 test page after
 * the original droplets proved sub-pixel at 16px): the whale bobs inside a
 * translate group, a waterline rect half-submerges it, and three solid
 * bubbles rise past the top edge. Swapped as data URLs (no canvas
 * rasterization, no Image decode).
 *
 * The whale fill always follows the PAGE palette (`body[data-ds-dark-theme]`,
 * the same attribute ui-layout's ThemePresenter maintains): a MutationObserver
 * on that attribute re-renders the cached frames when the page theme switches,
 * and data-URL frames carry an explicit fill because their media context
 * cannot evaluate the stock stylesheet's prefers-color-scheme query.
 * Reduced-motion keeps the static whale (silence pairs with the hidden
 * sidebar overlay and the muted chimes). Failures degrade to a warning +
 * no-op (the stock favicon stays) and never affect the sidebar overlay or the
 * sounds; a transient failure (e.g. the favicon fetch racing a server
 * restart) retries on the next activation edge or theme change instead of
 * latching for the page's lifetime.
 * @module @khorsheed/dsh-whalesong/client/favicon
 */

/** Frame cadence; 4 frames ≈ 0.88s per whalesong cycle. */
export const FRAME_MS = 220

const FRAME_COUNT = 4
/** Whale bob per frame (px inside the 50×50 viewBox). */
const BOB = [0, -1.5, 0, 1]
/** Bubble x slots across the whale's top. */
const BUBBLE_X = [21, 25, 29]
/** Bubble rise by phase: from the whale's top to the frame's top edge. Solid (no fade) — fading made v1.2 invisible at 16px. */
const BUBBLE_Y = [13, 9, 5, 1]
/** Waterline + bubble blue (user-accepted on the test page; darker than v1.2's #4A7DFF for 16px contrast). */
const WATER_COLOR = '#2E5BFF'
/** Whale path marker in the stock favicon.svg (the bob group's wrap target). */
const PATH_MARKER = '<path id="path"'
/** Official body attribute selecting the dark palette (ui-layout ThemePresenter). */
const PAGE_DARK_ATTRIBUTE = 'data-ds-dark-theme'

/** Animator creation options. */
export interface FaviconAnimatorOptions {
  /** Document override (tests; defaults to win.document). */
  readonly doc?: Document
  /** fetch override (tests). */
  readonly fetchImpl?: typeof fetch
  /** Reduced-motion probe (default: matchMedia); true = never animate. */
  readonly reducedMotion?: () => boolean
  /** Frame cadence override (tests). */
  readonly frameMs?: number
}

/** Animator lifecycle handle. */
export interface FaviconAnimator {
  /** Whether whalesong was requested (frames may still be loading). */
  readonly active: boolean
  /** Idempotent on/off; off shows the static page-matched whale. */
  setActive(on: boolean): void
  /** Stop the animation; the static page-matched whale stays. Safe to repeat. */
  dispose(): void
}

/** Default reduced-motion probe; matchMedia is absent in jsdom. */
function defaultReducedMotion(win: Window): () => boolean {
  return () => win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/**
 * Pin the stock favicon's whale color: drop the `<style>` block (its
 * prefers-color-scheme media query is unreliable in a data-URL favicon) and
 * set the path fill explicitly.
 * @param svgText - the stock favicon svg source.
 * @param whaleFill - the whale's resolved fill for the current page palette.
 * @returns the svg with an explicit, page-matched whale color.
 */
export function colorizeWhaleSvg(svgText: string, whaleFill = '#000000'): string {
  return svgText
    .replace(/<style>[\s\S]*?<\/style>/gi, '')
    .replace('fill="#000"', `fill="${whaleFill}"`)
}

/**
 * One animation frame: the page-matched whale bobbing in a translate group,
 * then the waterline rect (drawn after the whale = half-submerged), then this
 * frame's bubbles. Exported for the README preview generator (dev/).
 * @param svgText - the stock favicon svg source.
 * @param frame - frame index 0..FRAME_COUNT-1.
 * @param whaleFill - the whale's resolved fill for the current page palette.
 * @returns the frame's svg document.
 */
export function frameSvg(svgText: string, frame: number, whaleFill = '#000000'): string {
  const bubbles = BUBBLE_X.map((x, i) => {
    const y = BUBBLE_Y[(frame + i) % FRAME_COUNT]
    return `<circle cx="${x}" cy="${y}" r="2.6" fill="${WATER_COLOR}"/>`
  }).join('')
  const waterline = `<rect x="0" y="43" width="50" height="7" fill="${WATER_COLOR}" opacity="0.85"/>`
  const colored = colorizeWhaleSvg(svgText, whaleFill)
  if (colored.includes(PATH_MARKER)) {
    return colored
      .replace(PATH_MARKER, `<g transform="translate(0 ${BOB[frame]})">${PATH_MARKER}`)
      .replace(/<\/svg>\s*$/, `</g>${waterline}${bubbles}</svg>`)
  }
  // Unknown svg structure: skip the bob wrap (no dangling </g>), keep water/bubbles.
  return colored.replace(/<\/svg>\s*$/, `${waterline}${bubbles}</svg>`)
}

function toDataUrl(svgText: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`
}

/**
 * Create the favicon animator. On creation it fetches the stock favicon and
 * renders a page-matched static whale that stays in the tab icon at all times;
 * task activation animates it, deactivation and dispose fall back to the static
 * whale, and a page theme switch re-renders both.
 * @param win - target window.
 * @param options - doc/fetch/probe overrides.
 * @returns the animator handle.
 */
export function createFaviconAnimator(win: Window, options: FaviconAnimatorOptions = {}): FaviconAnimator {
  const doc = options.doc ?? win.document
  // Absent fetch (jsdom, non-browser surfaces): never render — the stock icon
  // stays, and a missing route must not throw or flap the UX.
  const fetchImpl = options.fetchImpl ?? (typeof win.fetch === 'function' ? win.fetch.bind(win) : undefined)
  const reducedMotion = options.reducedMotion ?? defaultReducedMotion(win)
  const frameMs = options.frameMs ?? FRAME_MS

  const link = doc.querySelector('link[rel~="icon"]')
  const originalHref = link?.getAttribute('href')

  /** Static page-matched whale data URL (shown while idle). */
  let staticUrl: string | undefined
  let frames: string[] | undefined
  /** Page-dark flag the cached frames were generated with (whale fill contrast). */
  let frameDark: boolean | undefined
  let loading = false
  /** Transient load failure (fetch/parse); cleared on every retry edge (no lifetime latch). */
  let failed = false
  let requested = false
  let timer: number | undefined
  let frame = 0

  const stopInterval = (): void => {
    if (timer !== undefined) {
      win.clearInterval(timer)
      timer = undefined
    }
  }

  /** The page's actual palette, read from the official theme projection. */
  const pageIsDark = (): boolean => doc.body.hasAttribute(PAGE_DARK_ATTRIBUTE)

  /** Idle state: show the static page-matched whale, not the stock icon. */
  const applyStatic = (): void => {
    stopInterval()
    if (link != null && staticUrl != null) link.setAttribute('href', staticUrl)
  }

  const startInterval = (): void => {
    if (timer !== undefined || frames === undefined || link == null) return
    const activeFrames = frames
    frame = 0
    link.setAttribute('href', activeFrames[frame]!)
    timer = win.setInterval(() => {
      frame = (frame + 1) % FRAME_COUNT
      // `activeFrames` holds exactly FRAME_COUNT entries; `frame` is
      // modulo-bounded, so the index is always in range.
      link.setAttribute('href', activeFrames[frame]!)
    }, frameMs)
  }

  const ensureFrames = (): void => {
    if (staticUrl !== undefined || loading || failed || originalHref == null || fetchImpl === undefined) return
    loading = true
    void (async () => {
      try {
        const res = await fetchImpl(originalHref)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const svgText = await res.text()
        if (!svgText.includes('</svg>')) throw new Error('favicon is not an SVG document')
        // Resolve the whale's fill from the PAGE palette: the frames must carry
        // an explicit color because the data-URL media context cannot evaluate
        // the stock stylesheet's prefers-color-scheme query, and the contrast
        // must match the page (a light page on a dark system would otherwise
        // render an invisible white whale).
        frameDark = pageIsDark()
        const whaleFill = frameDark ? '#FFFFFF' : '#000000'
        staticUrl = toDataUrl(colorizeWhaleSvg(svgText, whaleFill))
        frames = Array.from({ length: FRAME_COUNT }, (_, f) => toDataUrl(frameSvg(svgText, f, whaleFill)))
        loading = false
        if (requested && !reducedMotion()) startInterval()
        else applyStatic()
      } catch (error) {
        loading = false
        failed = true
        console.warn(`[whalesong] favicon animation disabled: ${error instanceof Error ? error.message : String(error)}`)
      }
    })()
  }

  // The page theme can switch while this fiber lives: re-render the whale in
  // the new contrast color (static and animated alike) instead of keeping an
  // invisible fish in the tab icon.
  const observer = new MutationObserver(() => {
    if (staticUrl === undefined || frameDark === pageIsDark()) return
    staticUrl = undefined
    frames = undefined
    failed = false
    ensureFrames()
  })
  observer.observe(doc.body, { attributes: true, attributeFilter: [PAGE_DARK_ATTRIBUTE] })

  ensureFrames()

  return {
    get active() { return requested },
    setActive(on: boolean) {
      if (on === requested) return
      requested = on
      if (!on) {
        applyStatic()
        return
      }
      if (reducedMotion()) return // static whale stays
      if (link == null || originalHref == null) {
        console.warn('[whalesong] favicon animation unavailable: no usable icon link')
        return
      }
      failed = false // a transient failure never latches: every activation retries
      ensureFrames()
      startInterval() // no-op until frames arrive
    },
    dispose() {
      requested = false
      observer.disconnect()
      applyStatic()
    },
  }
}
