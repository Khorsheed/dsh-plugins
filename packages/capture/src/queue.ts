/**
 * The render queue: one render at a time, a bounded wait line.
 *
 * A headless Chrome render holds hundreds of MB; running two concurrently
 * doubles that for a feature whose callers are patient (a human clicked). So
 * the queue serializes, and instead of letting waits pile up unboundedly it
 * refuses the excess — the caller's error surface reads "busy, try again"
 * instead of hanging a minute behind another render.
 *
 * @module @khorsheed/dsh-capture/queue
 */

/** Thrown by {@link SerialRenderQueue.run} when the wait line is full. */
export class QueueBusyError extends Error {
  constructor(readonly pending: number) {
    super(`the render queue is full (${pending} renders in flight or waiting)`)
    this.name = 'QueueBusyError'
  }
}

/**
 * A concurrency-1 queue with a bounded line. Tasks run in submission order;
 * one task's failure never blocks or poisons the ones behind it.
 */
export class SerialRenderQueue {
  private tail: Promise<unknown> = Promise.resolve()
  private unsettled = 0

  constructor(readonly maxPending: number) {}

  /** Renders currently in flight or waiting. */
  get pending(): number {
    return this.unsettled
  }

  /**
   * Run `task` after everything queued before it settles.
   * @param task - the render; runs alone.
   * @returns the task's outcome.
   * @throws {QueueBusyError} synchronously when the line is full.
   */
  run<T>(task: () => Promise<T>): Promise<T> {
    if (this.unsettled > this.maxPending) throw new QueueBusyError(this.unsettled)
    this.unsettled += 1
    // Run regardless of how the predecessor settled; the tail itself never
    // rejects, so one failed render cannot wedge the line.
    const turn = this.tail.then(() => task())
    this.tail = turn.catch(() => undefined)
    const release = (): void => {
      this.unsettled -= 1
    }
    void turn.then(release, release)
    return turn
  }
}
