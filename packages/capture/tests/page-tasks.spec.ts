// @vitest-environment jsdom
/**
 * The in-page tasks, run against jsdom: the same functions Chrome evaluates
 * via `page.evaluate` (they are self-contained by construction — this suite
 * is the proof that they need nothing but the DOM).
 *
 * jsdom lacks `matchMedia` and `CSS.supports`, so conditional-group rules are
 * always INCLUDED here; a real browser evaluates them. That asymmetry is
 * deliberate (include over crash) and covered end-to-end by the Chrome
 * integration spec.
 */
import { describe, expect, it } from 'vitest'
import {
  inlineStylesAndSerialize,
  installListenerProbe,
  markInteractiveWidgets,
  replaceWidgetsWithSnapshots,
  scrollSweepPage,
  widgetPageRect,
} from '../src/page-tasks.ts'

/** Set the whole document from a full page source. */
function setPage(source: string): void {
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  document.documentElement.innerHTML = parsed.documentElement.innerHTML
}

/** Run the serialize pass on the current document. */
function serializeDocument(maxChars = 8_000_000) {
  return inlineStylesAndSerialize({ maxChars })
}

describe('inlineStylesAndSerialize: CSSOM inlining', () => {
  it('inlines a matched class rule and resolves the CSS variable', () => {
    setPage(`<html><head><style>
      :root { --brand-clay: #bada55 }
      .figure-dot { fill: var(--brand-clay) }
    </style></head><body>
      <svg viewBox="0 0 10 10"><circle class="figure-dot" r="4"/></svg>
    </body></html>`)
    const result = serializeDocument()
    // The resolved color arrives BOTH as an inlined style and — for SVG
    // presentation properties — as the attribute (whitelist-extractor path).
    expect(result.html).toContain('fill: rgb(186, 218, 85)')
    expect(result.html).toContain('fill="#bada55"')
    expect(result.html).not.toContain('var(--brand-clay)')
    expect(result.inlinedElements).toBe(1)
    expect(result.inlinedDeclarations).toBe(1)
  })

  it('resolves variables inherited from an ancestor and nested var() chains', () => {
    setPage(`<html><head><style>
      .panel { --ink: #112233 }
      .deep { color: var(--via) }
      .panel { --via: var(--ink) }
    </style></head><body>
      <div class="panel"><p><span class="deep">text</span></p></div>
    </body></html>`)
    const result = serializeDocument()
    expect(result.html).toContain('color: rgb(17, 34, 51)')
  })

  it('falls back when a variable is undefined, and skips truly unresolvable values', () => {
    setPage(`<html><head><style>
      .with-fallback { color: var(--missing, #123456) }
      .no-fallback { color: var(--gone) }
    </style></head><body>
      <p class="with-fallback">a</p><p class="no-fallback">b</p>
    </body></html>`)
    const result = serializeDocument()
    expect(result.html).toContain('color: rgb(18, 52, 86)')
    expect(result.html).not.toContain('unset')
    const noFallback = /<p class="no-fallback"([^>]*)>/.exec(result.html)
    expect(noFallback?.[1] ?? '').not.toContain('color')
  })

  it('honors specificity and document order between matched rules', () => {
    setPage(`<html><head><style>
      .target { color: red }
      #zone .target { color: blue }
      div.target { color: green } /* loses to the id-bearing rule */
    </style></head><body>
      <div id="zone"><span class="target">x</span></div>
    </body></html>`)
    const result = serializeDocument()
    expect(result.html).toContain('color: blue')
  })

  it('the LAST of two same-property declarations in one rule wins (vendor-fallback pairs)', () => {
    setPage(`<html><head><style>
      .box { color: red; color: blue }
    </style></head><body>
      <p class="box">x</p>
    </body></html>`)
    const result = serializeDocument()
    expect(result.html).toContain('color: blue')
    expect(result.html).not.toContain('color: red')
  })

  it('lets !important rules beat the inline style, and the inline style beat plain rules', () => {
    setPage(`<html><head><style>
      .a { color: red !important }
      .b { color: red }
    </style></head><body>
      <p class="a" style="color: blue">a</p>
      <p class="b" style="color: blue">b</p>
    </body></html>`)
    const result = serializeDocument()
    const a = /<p class="a" style="([^"]*)">/.exec(result.html)?.[1] ?? ''
    const b = /<p class="b" style="([^"]*)">/.exec(result.html)?.[1] ?? ''
    expect(a).toContain('color: red !important')
    expect(b).toContain('color: blue')
    expect(b).not.toContain('!important')
  })

  it('resolves var() inside an existing inline style', () => {
    setPage(`<html><head><style>:root { --y: #abcdef }</style></head><body>
      <svg><rect style="fill: var(--y)" width="3"/></svg>
    </body></html>`)
    const result = serializeDocument()
    // jsdom keeps the verbatim rewrite; Chrome re-serializes to rgb() — same color.
    expect(result.html).toMatch(/fill: (?:rgb\(171, 205, 239\)|#abcdef)/)
    expect(result.html).toContain('fill="#abcdef"')
  })

  it('resolves a var() a page script wrote as a PRESENTATION ATTRIBUTE (no rule matches it)', () => {
    setPage(`<html><head><style>:root { --brand-clay: #bada55 }</style></head><body>
      <svg><path fill="var(--brand-clay)" d="M0 0h4v4z"/></svg>
    </body></html>`)
    const result = serializeDocument()
    expect(result.html).toContain('fill="#bada55"')
    expect(result.html).not.toContain('var(--brand-clay)')
    expect(result.resolvedAttributes).toBe(1)
  })

  it('resolves a var() whose definition a script set inline on an ancestor (computed fallback)', () => {
    // No stylesheet at all: the custom property exists only as a runtime-set
    // inline declaration — the CSSOM walk cannot see it, getComputedStyle can.
    setPage(`<html><body>
      <div style="--ink: #112233"><svg><circle fill="var(--ink)" r="3"/></svg></div>
    </body></html>`)
    const result = serializeDocument()
    expect(result.html).toContain('fill="#112233"')
  })

  it('keeps an attribute whose var() is genuinely undefined rather than half-resolving it', () => {
    setPage(`<html><body>
      <svg><rect fill="var(--gone)" width="2"/></svg>
    </body></html>`)
    const result = serializeDocument()
    expect(result.html).toContain('fill="var(--gone)"')
    expect(result.resolvedAttributes).toBe(0)
  })

  it('resolves var() in an inline shorthand the CSSOM decomposes (background)', () => {
    // Chrome enumerates `style="background:var(--x)"` as empty-valued longhands
    // — only the raw attribute text carries the declaration, so the rewrite
    // happens on the attribute text before any CSSOM mutation. jsdom keeps the
    // shorthand readable; both engines take the same textual rewrite here.
    setPage(`<html><head><style>:root { --gray-200: #eeeeee }</style></head><body>
      <div class="bar" style="width:100%;background:var(--gray-200)">x</div>
    </body></html>`)
    const result = serializeDocument()
    expect(result.html).toContain('background:#eeeeee')
    expect(result.html).not.toContain('var(--gray-200)')
  })

  it('matches only the rightmost compound (the prefilter never hides a real match)', () => {
    setPage(`<html><head><style>
      .outer .dot { stroke: #101010 }
    </style></head><body>
      <div class="outer"><svg><path class="dot"/></svg></div>
      <div class="other"><svg><path class="dot"/></svg></div>
    </body></html>`)
    const result = serializeDocument()
    const paths = result.html.match(/<path[^>]*class="dot"[^>]*>/g) ?? []
    expect(paths.length).toBe(2)
    expect(paths[0]).toContain('stroke: rgb(16, 16, 16)')
    expect(paths[0]).toContain('stroke="rgb(16, 16, 16)"')
    expect(paths[1]).not.toContain('stroke')
  })

  it('collects CSS-nested rules, flattening & and bare descendant selectors against the parent', () => {
    setPage(`<html><head><style>
      .nest-host {
        & .nest-row { display: flex }
        .nest-cell { color: #123456 }
        &.lit { color: #654321 }
      }
    </style></head><body>
      <div class="nest-host lit"><div class="nest-row"><div class="nest-cell">x</div></div></div>
    </body></html>`)
    const result = serializeDocument()
    const host = /<div class="nest-host[^"]*"([^>]*)>/.exec(result.html)
    const row = /<div class="nest-row"([^>]*)>/.exec(result.html)
    const cell = /<div class="nest-cell"([^>]*)>/.exec(result.html)
    expect(row?.[1] ?? '').toContain('display: flex')
    expect(cell?.[1] ?? '').toContain('color: rgb(18, 52, 86)')
    expect(host?.[1] ?? '').toContain('color: rgb(101, 67, 33)')
  })

  it('honors specificity through nesting and document order across nested sibling rules', () => {
    setPage(`<html><head><style>
      .a { & .t { color: red } }
      .b { & .t { color: blue } }   /* same weight: later rule wins */
    </style></head><body>
      <div class="a b"><div class="t">x</div></div>
    </body></html>`)
    const result = serializeDocument()
    expect(result.html).toContain('color: blue')
  })

  it('strips scripts, style blocks and stylesheet links from the output', () => {
    setPage(`<html><head>
      <style>.x { color: red }</style>
      <link rel="stylesheet" href="https://cdn.example.com/a.css">
      <script>window.evil = true</script>
    </head><body>
      <p class="x">text</p>
      <script src="https://cdn.example.com/b.js"></script>
    </body></html>`)
    const result = serializeDocument()
    expect(result.html).not.toContain('<script')
    expect(result.html).not.toContain('<style')
    expect(result.html).not.toContain('stylesheet')
    expect(result.removedScripts).toBe(2)
    expect(result.removedStyles).toBe(1)
    // …while the inlined rule survives the removed style block.
    expect(result.html).toContain('color: red')
  })

  it('caps the serialized output and flags the cut', () => {
    setPage(`<html><body><p>${'x'.repeat(5000)}</p></body></html>`)
    const result = serializeDocument(1000)
    expect(result.truncated).toBe(true)
    expect(result.html.length).toBe(1000)
    const whole = serializeDocument()
    expect(whole.truncated).toBe(false)
  })

  it('carries the doctype, title and final URL', () => {
    setPage('<html><head><title>The Page</title></head><body><p>x</p></body></html>')
    document.title = 'The Page'
    const result = inlineStylesAndSerialize({ maxChars: 8_000_000 })
    expect(result.html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(result.title).toBe('The Page')
    expect(result.finalUrl).toBe(window.location.href)
  })

  it('does not touch elements no rule matches', () => {
    setPage('<html><body><p>plain</p><div><span>also plain</span></div></body></html>')
    const result = serializeDocument()
    expect(result.inlinedElements).toBe(0)
    expect(result.html).toContain('<p>plain</p>')
  })
})

describe('scrollSweepPage', () => {
  it('does nothing on a page no taller than the viewport (one bottom dwell only)', async () => {
    // jsdom reports scrollHeight 0, so the sweep is a no-op; the dwell still runs.
    const started = Date.now()
    const result = await scrollSweepPage({ dwellMs: 40, maxMs: 5_000, stepRatio: 0.8 })
    expect(result.steps).toBe(0)
    expect(result.elapsedMs).toBeGreaterThanOrEqual(35)
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('steps through a tall page, dwelling per step, and stops when the budget ends', async () => {
    let y = 0
    let height = 4000
    const scrolls: number[] = []
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    Object.defineProperty(window, 'scrollY', { get: () => y, configurable: true })
    ;(window as unknown as { scrollTo: (sx: number, sy: number) => void }).scrollTo = (_x: number, sy: number) => {
      y = sy
      scrolls.push(sy)
      // Lazy content extends the page as the sweep passes (once).
      if (scrolls.length === 1) height = 4800
    }
    Object.defineProperty(document.documentElement, 'scrollHeight', { get: () => height, configurable: true })
    const result = await scrollSweepPage({ dwellMs: 30, maxMs: 5_000, stepRatio: 0.8 })
    expect(result.steps).toBeGreaterThanOrEqual(5) // 4800 - 800 at 640/step ≈ 7 steps
    expect(scrolls[scrolls.length - 1]).toBe(height - 800)
    expect(result.docHeight).toBe(4800)
    expect(result.elapsedMs).toBeGreaterThanOrEqual(result.steps * 30)
  })

  it('stops at the time budget even when the page never ends', async () => {
    let y = 0
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    Object.defineProperty(window, 'scrollY', { get: () => y, configurable: true })
    ;(window as unknown as { scrollTo: (sx: number, sy: number) => void }).scrollTo = (_x: number, sy: number) => {
      y = sy
    }
    Object.defineProperty(document.documentElement, 'scrollHeight', { get: () => y + 10_000, configurable: true })
    const started = Date.now()
    const result = await scrollSweepPage({ dwellMs: 60, maxMs: 200, stepRatio: 0.8 })
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(result.steps).toBeGreaterThan(0)
  })
})


const MARK_ARGS = { maxSnapshots: 40, maxDimension: 4096, altMaxChars: 400 }

/** jsdom reports every box as 0×0; stamp a box on one element. */
function stubRect(el: Element, rect: { left: number; top: number; width: number; height: number }): void {
  ;(el as unknown as { getBoundingClientRect: () => typeof rect & { right: number; bottom: number } })
    .getBoundingClientRect = () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
    })
}

/** Stamp one rect on every candidate figure (the common case: all visible, all small). */
function stubAllFigures(): void {
  for (const el of document.querySelectorAll('figure, d-figure')) {
    stubRect(el, { left: 10, top: 20, width: 300, height: 200 })
  }
}

describe('markInteractiveWidgets', () => {
  it('marks a figure whose subtree holds a canvas, with alt from non-caption text', () => {
    setPage(`<html><body>
      <figure><div>widget label text</div><canvas></canvas><figcaption>Figure 1: the caption</figcaption></figure>
      <figure><svg viewBox="0 0 10 10"><rect width="8" height="8"/></svg></figure>
    </body></html>`)
    stubAllFigures()
    const result = markInteractiveWidgets(MARK_ARGS)
    expect(result.candidates).toBe(2)
    expect(result.qualified).toBe(1)
    expect(result.marked).toHaveLength(1)
    expect(document.querySelector('[data-capture-widget="0"]')).toBe(document.querySelector('figure'))
    expect(result.marked[0]!.alt).toContain('widget label text')
    expect(result.marked[0]!.alt).not.toContain('the caption')
  })

  it('marks a figure an in-subtree listener qualifies, even without a canvas', () => {
    const restore = withListenerProbe()
    try {
      setPage(`<html><body>
        <figure><div class="hot">hover me</div></figure>
        <figure><div>cold</div></figure>
      </body></html>`)
      document.querySelector('.hot')!.addEventListener('mouseenter', () => undefined)
      stubAllFigures()
      const result = markInteractiveWidgets(MARK_ARGS)
      expect(result.qualified).toBe(1)
      expect(result.marked).toHaveLength(1)
      expect(document.querySelector('[data-capture-widget="0"] .hot')).not.toBeNull()
    } finally {
      restore()
    }
  })

  it('considers only the outermost figure of a nested cluster', () => {
    setPage(`<html><body>
      <figure><div><figure><canvas></canvas></figure></div></figure>
    </body></html>`)
    stubAllFigures()
    const result = markInteractiveWidgets(MARK_ARGS)
    expect(result.candidates).toBe(1)
    expect(result.marked).toHaveLength(1)
    expect(document.querySelectorAll('[data-capture-widget]')).toHaveLength(1)
  })

  it('skips hidden and oversize widget boxes, and caps the marks at maxSnapshots', () => {
    setPage(`<html><body>
      <figure class="hidden"><canvas></canvas></figure>
      <figure class="huge"><canvas></canvas></figure>
      <figure><canvas></canvas></figure>
      <figure><canvas></canvas></figure>
      <figure><canvas></canvas></figure>
    </body></html>`)
    stubAllFigures()
    stubRect(document.querySelector('.hidden')!, { left: 0, top: 0, width: 0, height: 0 })
    stubRect(document.querySelector('.huge')!, { left: 0, top: 0, width: 9000, height: 200 })
    const result = markInteractiveWidgets({ ...MARK_ARGS, maxSnapshots: 2 })
    expect(result.qualified).toBe(5)
    expect(result.skippedHidden).toBe(1)
    expect(result.skippedOversize).toBe(1)
    expect(result.marked).toHaveLength(2)
    expect(document.querySelectorAll('[data-capture-widget]')).toHaveLength(2)
  })
})

describe('widgetPageRect', () => {
  it('returns page coordinates clamped to the document, undefined for a stale or empty box', () => {
    setPage(`<html><body>
      <figure class="a"><canvas></canvas></figure>
      <figure class="b"><canvas></canvas></figure>
      <figure class="c"><canvas></canvas></figure>
    </body></html>`)
    stubAllFigures()
    Object.defineProperty(window, 'scrollX', { value: 0, configurable: true })
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    Object.defineProperty(document.documentElement, 'scrollWidth', { value: 2000, configurable: true })
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true })
    markInteractiveWidgets(MARK_ARGS)
    stubRect(document.querySelector('.a')!, { left: 100, top: 200, width: 300, height: 200 })
    // The clip carries an 8px slack (axis labels overflow their boxes by a hair).
    expect(widgetPageRect(0)).toEqual({ x: 92, y: 192, width: 316, height: 216 })
    // Overflowing the document's right edge clamps the clip, not the snapshot.
    stubRect(document.querySelector('.b')!, { left: 1900, top: 0, width: 300, height: 100 })
    expect(widgetPageRect(1)).toEqual({ x: 1892, y: 0, width: 108, height: 116 })
    stubRect(document.querySelector('.c')!, { left: 0, top: 0, width: 0, height: 0 })
    expect(widgetPageRect(2)).toBeUndefined()
    expect(widgetPageRect(99)).toBeUndefined()
  })

  it('clips the widget content, excluding the figcaption that stays as DOM text', () => {
    setPage(`<html><body>
      <figure class="w"><div class="content"><canvas></canvas></div><figcaption>Figure 9: text</figcaption></figure>
    </body></html>`)
    Object.defineProperty(window, 'scrollX', { value: 0, configurable: true })
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    Object.defineProperty(document.documentElement, 'scrollWidth', { value: 2000, configurable: true })
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true })
    const figure = document.querySelector('.w')!
    stubRect(figure, { left: 100, top: 200, width: 300, height: 240 })
    stubRect(figure.querySelector('.content')!, { left: 100, top: 200, width: 300, height: 200 })
    stubRect(figure.querySelector('figcaption')!, { left: 100, top: 408, width: 300, height: 32 })
    markInteractiveWidgets(MARK_ARGS)
    // 200px of content (plus slack), not the 240px the caption-inclusive figure box reports.
    expect(widgetPageRect(0)).toEqual({ x: 92, y: 192, width: 316, height: 216 })
  })
})

describe('replaceWidgetsWithSnapshots', () => {
  it('swaps the widget subtree for one img, keeping the figcaption as text', () => {
    setPage(`<html><body>
      <figure data-capture-widget="7">
        stray text
        <div class="widget-remnant">labels</div>
        <canvas></canvas>
        <figcaption>Figure 3: kept as text</figcaption>
      </figure>
      <figure data-capture-widget="8"><canvas></canvas></figure>
    </body></html>`)
    const replaced = replaceWidgetsWithSnapshots([
      { id: 7, dataUri: 'data:image/webp;base64,QUJD', width: 640, height: 480, alt: 'labels' },
      { id: 99, dataUri: 'data:image/webp;base64,REVG', width: 1, height: 1, alt: '' },
    ])
    expect(replaced).toBe(1)
    const figure = document.querySelectorAll('figure')[0]!
    const img = figure.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe('data:image/webp;base64,QUJD')
    expect(img!.getAttribute('alt')).toBe('labels')
    expect(img!.getAttribute('width')).toBe('640')
    expect(img!.getAttribute('height')).toBe('480')
    expect(img!.getAttribute('data-capture-snapshot')).toBe('widget')
    expect(figure.querySelector('figcaption')?.textContent).toBe('Figure 3: kept as text')
    expect(figure.querySelector('.widget-remnant')).toBeNull()
    expect(figure.querySelector('canvas')).toBeNull()
    expect(figure.textContent).not.toContain('stray text')
    expect(figure.hasAttribute('data-capture-widget')).toBe(false)
    // The untouched widget keeps its DOM (its screenshot never arrived).
    expect(document.querySelectorAll('figure')[1]!.querySelector('canvas')).not.toBeNull()
  })
})

/** Install the probe, returning the restore hook (global prototype hygiene). */
function withListenerProbe(): () => void {
  const original = EventTarget.prototype.addEventListener
  installListenerProbe()
  return () => {
    EventTarget.prototype.addEventListener = original
    delete (window as unknown as { __captureListeners?: WeakSet<Element> }).__captureListeners
  }
}
