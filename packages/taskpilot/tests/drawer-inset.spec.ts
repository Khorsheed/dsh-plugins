import { describe, expect, it } from 'vitest'
import { computeDrawerInset, DRAWER_MAX_WIDTH, MIN_CENTER_WIDTH } from '../src/client/drawer-inset.ts'

describe('computeDrawerInset', () => {
  it('claims the full drawer width on a wide viewport', () => {
    expect(computeDrawerInset(1440)).toBe(DRAWER_MAX_WIDTH)
    // Exactly MIN_CENTER_WIDTH remaining after the push still pushes.
    expect(computeDrawerInset(MIN_CENTER_WIDTH + DRAWER_MAX_WIDTH)).toBe(DRAWER_MAX_WIDTH)
  })

  it('falls back to 0 when the push would leave too little room', () => {
    expect(computeDrawerInset(MIN_CENTER_WIDTH + DRAWER_MAX_WIDTH - 1)).toBe(0)
    expect(computeDrawerInset(1024)).toBe(0)
  })

  it('never claims more than the viewport', () => {
    // Drawer shrinks to the viewport, leaving no room for the column.
    expect(computeDrawerInset(400)).toBe(0)
    expect(computeDrawerInset(700)).toBe(0)
  })

  it('respects custom drawer and center limits', () => {
    expect(computeDrawerInset(1000, 300, 600)).toBe(300)
    expect(computeDrawerInset(1000, 300, 800)).toBe(0)
  })
})
