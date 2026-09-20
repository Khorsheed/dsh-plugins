/**
 * The render queue: serialization, submission order, failure containment, and
 * the bounded wait line. All tasks are fake timers/free promises — no browser.
 */
import { describe, expect, it } from 'vitest'
import { QueueBusyError, SerialRenderQueue } from '../src/queue.ts'

/** A deferred task handle. */
function deferred<T>(value: T): { run: () => Promise<T>; release: () => void } {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return { run: async () => gate.then(() => value), release }
}

describe('SerialRenderQueue', () => {
  it('runs one task at a time, in submission order', async () => {
    const queue = new SerialRenderQueue(10)
    const order: string[] = []
    const first = deferred('a')
    const second = deferred('b')
    const running: string[] = []
    const wrap = (name: string, task: () => Promise<string>) => async () => {
      running.push(name)
      if (running.length > 1) throw new Error('two tasks ran concurrently')
      const value = await task()
      running.pop()
      order.push(value)
      return value
    }
    const p1 = queue.run(wrap('first', first.run))
    const p2 = queue.run(wrap('second', second.run))
    // Let the queue settle the scheduling turns, then release in reverse
    // submission order: the second task must still wait for the first.
    await Promise.resolve()
    second.release()
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual([])
    first.release()
    expect(await p1).toBe('a')
    expect(await p2).toBe('b')
    expect(order).toEqual(['a', 'b'])
  })

  it('contains a task failure — the next queued task still runs', async () => {
    const queue = new SerialRenderQueue(10)
    const failing = queue.run(async () => {
      throw new Error('boom')
    })
    const after = queue.run(async () => 'alive')
    await expect(failing).rejects.toThrow('boom')
    await expect(after).resolves.toBe('alive')
  })

  it('refuses with QueueBusyError when the wait line is full', async () => {
    // maxPending counts the WAIT line; one in flight + maxPending waiting fit.
    const queue = new SerialRenderQueue(1)
    const blocked = deferred('slow')
    const p1 = queue.run(blocked.run)
    void p1.catch(() => undefined)
    const p2 = queue.run(async () => 'queued')
    void p2.catch(() => undefined)
    expect(queue.pending).toBe(2)
    expect(() => queue.run(async () => 'overflow')).toThrow(QueueBusyError)
    blocked.release()
    expect(await p1).toBe('slow')
    expect(await p2).toBe('queued')
    expect(queue.pending).toBe(0)
  })

  it('frees the line as tasks settle, so a later task is admitted', async () => {
    const queue = new SerialRenderQueue(0)
    await queue.run(async () => 'done')
    expect(queue.pending).toBe(0)
    await expect(queue.run(async () => 'next')).resolves.toBe('next')
  })
})
