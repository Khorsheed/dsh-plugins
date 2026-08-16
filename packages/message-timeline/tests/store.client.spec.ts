import { describe, expect, it } from 'vitest'
import { createTimelineStore } from '../src/client/store.ts'

describe('createTimelineStore', () => {
  it('starts with the rail expanded', () => {
    const store = createTimelineStore().create()
    expect(store.getSnapshot()).toEqual({ open: true })
  })

  it('collapses and re-expands through the declared action', () => {
    const store = createTimelineStore().create()
    store.actions.setOpen(false)
    expect(store.getSnapshot()).toEqual({ open: false })
    store.actions.setOpen(true)
    expect(store.getSnapshot()).toEqual({ open: true })
  })
})
