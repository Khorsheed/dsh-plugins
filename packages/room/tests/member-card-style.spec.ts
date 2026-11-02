/**
 * Pins the member card's narrow layout: the card is its own width container
 * (it renders in the members grid and atop the edit dialog), and only under
 * that container's narrow query does the status chip leave the name row and
 * the role chip yield to the name — the wide card keeps its one-row head.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  new URL('../src/client/MembersView.module.css', import.meta.url),
  'utf8',
)

/** The body of the `@container member-card (…)` block (brace-balanced). */
function narrowBlock(): string {
  const start = css.indexOf('@container member-card (max-width: 360px) {')
  expect(start).toBeGreaterThanOrEqual(0)
  let depth = 0
  for (let index = css.indexOf('{', start); index < css.length; index++) {
    if (css[index] === '{') depth++
    if (css[index] === '}' && --depth === 0) return css.slice(start, index + 1)
  }
  throw new Error('unbalanced @container block')
}

describe('MemberCard narrow layout', () => {
  it('each card declares its own inline-size container', () => {
    expect(css).toMatch(/\.card \{[^}]*container: member-card \/ inline-size/s)
  })

  it('a narrow card moves the status chip under the identity column', () => {
    const block = narrowBlock()
    expect(block).toMatch(/\.head \{[^}]*display: grid/s)
    expect(block).toMatch(/\.head > \.chipIdle \{[^}]*grid-column: 2/s)
    expect(block).toMatch(/\.avatarTile \{[^}]*grid-row: 1 \/ span 2/s)
  })

  it('a narrow card lets the role chip shrink before the name', () => {
    expect(narrowBlock()).toMatch(/\.role \{[^}]*flex: 0 100 auto/s)
  })

  it('the wide head stays one flex row with the chip at its end', () => {
    const wide = css.slice(0, css.indexOf('@container member-card'))
    expect(wide).toMatch(/\.head \{[^}]*display: flex/s)
    expect(wide).toMatch(/\.role \{[^}]*flex: none/s)
  })
})
