/**
 * The shared store's own rules (the views' specs exercise the renders):
 * rev as the cross-seat freshness channel, and the layout writes.
 */
import { describe, expect, it } from 'vitest'
import { StoryUiStore } from '../src/client/store.ts'

describe('StoryUiStore', () => {
  it('touch bumps the rev (the re-read trigger), layout writes never do', () => {
    const store = new StoryUiStore()
    expect(store.source.getSnapshot().rev).toBe(0)
    store.setFragmentsView('world')
    store.setCmCharacter('c1')
    store.setCmCursor(5)
    store.openReaderAt(6)
    expect(store.source.getSnapshot().rev).toBe(0)
    store.touch()
    expect(store.source.getSnapshot().rev).toBe(1)
    expect(store.source.getSnapshot()).toMatchObject({
      fragmentsView: 'world', cmCharacterId: 'c1', cmCursor: 5, readerN: 6,
    })
  })

  it('pulsePending lands the wall view and bumps the pulse', () => {
    const store = new StoryUiStore()
    store.setFragmentsView('info')
    store.pulsePending()
    const state = store.source.getSnapshot()
    expect(state.fragmentsView).toBe('wall')
    expect(state.pendingPulse).toBe(1)
  })

  it('idempotent writes do not publish a new snapshot', () => {
    const store = new StoryUiStore()
    const before = store.source.getSnapshot()
    store.setFragmentsView('wall')
    store.setCmCharacter(null)
    store.openReaderAt(null)
    expect(store.source.getSnapshot()).toBe(before)
  })
})
