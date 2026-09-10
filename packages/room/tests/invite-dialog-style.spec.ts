/**
 * Pins the invite dialog's visual contract to the official design tokens
 * (harness ui-theme design-platform.css + ui-primitives Button/Modal): the
 * one filled action rides button-primary-fill / label-primary-foreground /
 * button-primary-hover (near-black on light, near-white on dark), and the
 * blue accent tokens stay out of the dialog.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  new URL('../src/client/InviteDialog.module.css', import.meta.url),
  'utf8',
)

describe('InviteDialog styling', () => {
  it('the submit button rides the official primary-button tokens', () => {
    expect(css).toContain('background: var(--dsw-alias-button-primary-fill')
    expect(css).toContain('color: var(--dsw-alias-label-primary-foreground')
    expect(css).toContain('background: var(--dsw-alias-button-primary-hover')
  })

  it('keeps the blue accent out — fills and the focus ring stay neutral', () => {
    expect(css).not.toContain('bg-accent')
    expect(css).not.toContain('border-accent')
  })
})
