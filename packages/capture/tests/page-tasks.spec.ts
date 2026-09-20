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
import { inlineStylesAndSerialize, scrollSweepPage } from '../src/page-tasks.ts'

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
    expect(result.html).toContain('fill: rgb(171, 205, 239)')
    expect(result.html).toContain('fill="#abcdef"')
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
