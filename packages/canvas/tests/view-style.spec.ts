/**
 * Pins the split view's geometry contract. The editor is `width/height: 100%`
 * with 16/18 padding, Chromium's UA stylesheet leaves a `textarea` at
 * `content-box`, and this app ships no global border-box reset (the harness
 * base.css has none; its components state it where they need it). Without the
 * declaration the textarea's border box is 36px wider and 32px taller than the
 * pane it lives in, `.editorPane`'s `overflow: hidden` clips the right padding,
 * and the tail of every full-width line disappears — measured in Chromium as
 * 435px in a 400px pane, 35px hidden, before the fix.
 *
 * Buttons are `border-box` in the same UA sheet, so the menu rules that pair
 * `width: 100%` with padding are fine and are deliberately not touched.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  new URL('../src/client/CanvasView.module.css', import.meta.url),
  'utf8',
)

describe('CanvasView editor geometry', () => {
  it('sizes the textarea to its pane — content-box would clip 36px on the right', () => {
    expect(css).toMatch(/\.editor \{[^}]*box-sizing: border-box/s)
  })

  it('still spans the pane and scrolls itself (the single-scroller invariant)', () => {
    expect(css).toMatch(/\.editor \{[^}]*width: 100%/s)
    expect(css).toMatch(/\.editor \{[^}]*height: 100%/s)
    expect(css).toMatch(/\.editor \{[^}]*overflow: auto/s)
    // The wrapper must not become the second scroller.
    expect(css).toMatch(/\.editorPane \{[^}]*overflow: hidden/s)
  })
})
