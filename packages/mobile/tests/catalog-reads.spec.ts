import { expect, it, vi } from 'vitest'
import { CatalogReads } from '../src/client/catalogReads.ts'

it('bounds cold reads and drops queued work when rows leave the viewport', async () => {
  const queue = new CatalogReads()
  const releases: (() => void)[] = []
  const work = vi.fn(() => new Promise<void>(resolve => releases.push(resolve)))
  queue.add(work); queue.add(work)
  const cancel = queue.add(work)
  await Promise.resolve()
  expect(work).toHaveBeenCalledTimes(2)
  cancel()
  releases.forEach(resolve => resolve())
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(work).toHaveBeenCalledTimes(2)
})

it('suppresses follow-on room reads after hiding and continues after a failed owner read', async () => {
  const queue = new CatalogReads(1), room = vi.fn(), next = vi.fn(async () => {})
  let finish!: () => void
  const cancel = queue.add(async active => {
    await new Promise<void>(resolve => { finish = resolve })
    if (active()) room()
    throw Error('offline')
  })
  queue.add(next)
  await Promise.resolve(); cancel(); finish()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(room).not.toHaveBeenCalled()
  expect(next).toHaveBeenCalledOnce()
})

it('prioritizes queued titles over optional member scans', async () => {
  const queue = new CatalogReads(1), order: string[] = []
  let finish!: () => void
  queue.add(() => new Promise<void>(resolve => { finish = resolve }))
  queue.add(async () => { order.push('members') })
  queue.add(async () => { order.push('title') }, 0)
  await Promise.resolve(); finish()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(order).toEqual(['title', 'members'])
})
