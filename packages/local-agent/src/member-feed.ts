import type { LocalAgentMemberFeedEvent, LocalAgentMemberFeedRequest } from './types.ts'

/** One outstanding pull per source: slow clients do not accumulate event queues. */
export async function* mergeMemberFeeds(
  requests: readonly LocalAgentMemberFeedRequest[],
  follow: (request: LocalAgentMemberFeedRequest, signal: AbortSignal) => AsyncIterable<LocalAgentMemberFeedEvent>,
  signal: AbortSignal,
): AsyncIterable<LocalAgentMemberFeedEvent> {
  if (requests.length > 96) throw new Error('Too many member feed channels')
  const controller = new AbortController()
  let stop!: () => void
  const stopped = new Promise<undefined>(resolve => { stop = () => { controller.abort(); resolve(undefined) } })
  signal.addEventListener('abort', stop, { once: true })
  const iterators: AsyncIterator<LocalAgentMemberFeedEvent>[] = []
  const pending = new Map<number, Promise<{ index: number; result: IteratorResult<LocalAgentMemberFeedEvent> }>>()
  const unique = new Map(requests.map(request => [JSON.stringify([request.memberId, request.channel]), request]))
  try {
    if (signal.aborted) return
    for (const request of unique.values()) {
      const source = (async function* () {
        try { yield* follow(request, controller.signal) }
        catch (error) {
          if (!controller.signal.aborted) yield { memberId: request.memberId, channel: 'error' as const, source: request.channel, message: error instanceof Error ? error.message : String(error) }
        }
      })()[Symbol.asyncIterator]()
      const index = iterators.push(source) - 1
      pending.set(index, source.next().then(result => ({ index, result })))
    }
    while (!signal.aborted && pending.size > 0) {
      const next = await Promise.race([...pending.values(), stopped])
      if (next === undefined) return
      pending.delete(next.index)
      if (next.result.done) continue
      yield next.result.value
      pending.set(next.index, iterators[next.index]!.next().then(result => ({ index: next.index, result })))
    }
  } finally {
    signal.removeEventListener('abort', stop)
    controller.abort()
    for (const iterator of iterators) void iterator.return?.().catch(() => {})
  }
}
