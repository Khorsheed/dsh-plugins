/**
 * The pane store's fetch-state-adjacent actions.
 *
 * The card pill reads the `fetchStates` mirror and the expired marker lives in
 * `staleBodies`; both are keyed by entry and both must move when a fresh body
 * lands — a marker that outlives the copy it describes is how a card keeps
 * saying "expired" after the body was replaced. These run against the real
 * store handle, not a mock: the merge/clear semantics ARE the contract.
 */
import { describe, expect, it } from 'vitest'
import { createReaderStore } from '../src/client/store.ts'

describe('the expired marker', () => {
  it('is set and cleared per entry', () => {
    const instance = createReaderStore().create('store-test')
    instance.actions.setStaleBody('entry-a', true)
    expect(instance.getSnapshot().staleBodies).toEqual({ 'entry-a': true })
    instance.actions.setStaleBody('entry-a', false)
    expect(instance.getSnapshot().staleBodies).toEqual({})
  })

  it('is cleared by a backfill that landed a fresh body', () => {
    const instance = createReaderStore().create('store-test')
    instance.actions.setStaleBody('entry-a', true)
    instance.actions.setStaleBody('entry-b', true)
    instance.actions.setBackfill({ total: 1, done: 0 })
    instance.actions.noteBackfilled('entry-a', true)
    expect(instance.getSnapshot().staleBodies).toEqual({ 'entry-b': true })
    expect(instance.getSnapshot().backfilled).toEqual({ 'entry-a': true })
  })

  it('survives a backfill fetch that failed — the old copy is still the expired one', () => {
    const instance = createReaderStore().create('store-test')
    instance.actions.setStaleBody('entry-a', true)
    instance.actions.noteBackfilled('entry-a', false)
    expect(instance.getSnapshot().staleBodies).toEqual({ 'entry-a': true })
    expect(instance.getSnapshot().backfilled).toEqual({})
  })
})
