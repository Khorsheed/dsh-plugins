import { describe, expect, it, vi } from 'vitest'
import { mergeMemberFeeds } from '../src/member-feed.ts'
import { MemberFeeds, coalesceOutput } from '../src/client/member-feed.ts'
import type { LocalAgentMemberFeedEvent, LocalAgentMemberFeedRequest, LocalAgentStreamFrame } from '../src/types.ts'

const item = (text: string, revision = 1, append = false) => ({ id: '1:1', turn: 1, step: 1, kind: 'text' as const, text, revision, receivedAt: revision, append })
const output = (memberId: string, text: string, revision = 1, baseline = true): LocalAgentMemberFeedEvent => ({
  memberId, channel: 'output', value: { baseline, updates: [item(text, revision, !baseline)], removed: [] },
})

/** Deliberately controllable transport; no browser or native harness required. */
function transport() {
  const connections: { requests: readonly LocalAgentMemberFeedRequest[]; signal: AbortSignal; push(event: LocalAgentMemberFeedEvent): void }[] = []
  const source = async function* (requests: readonly LocalAgentMemberFeedRequest[], signal: AbortSignal) {
    const queue: LocalAgentMemberFeedEvent[] = []
    let wake: (() => void) | undefined
    const notify = () => { wake?.(); wake = undefined }
    connections.push({ requests, signal, push: event => { queue.push(event); notify() } })
    signal.addEventListener('abort', notify, { once: true })
    try {
      while (!signal.aborted) {
        if (queue.length === 0) await new Promise<void>(resolve => { wake = resolve })
        if (signal.aborted) return
        while (queue.length > 0) yield queue.shift()!
      }
    } finally { signal.removeEventListener('abort', notify) }
  }
  return { source, connections }
}

async function until(check: () => void) { await vi.waitFor(check, { interval: 1 }) }

describe('shared member feed', () => {
  it('uses one connection for all three surfaces and eight concurrent members', async () => {
    const wire = transport()
    const feeds = new MemberFeeds(wire.source)
    const signal = new AbortController()
    const pulls: Promise<IteratorResult<unknown>>[] = []
    for (let n = 0; n < 8; n++) for (const channel of ['configuration', 'directory', 'output'] as const) {
      pulls.push(feeds.follow(`member-${n}`, channel, signal.signal)[Symbol.asyncIterator]().next())
    }
    await until(() => expect(wire.connections).toHaveLength(1))
    expect(wire.connections[0]!.requests).toHaveLength(24)
    signal.abort()
    await Promise.all(pulls)
    await until(() => expect(wire.connections[0]!.signal.aborted).toBe(true))
    feeds.dispose()
  })

  it('gives late local consumers a baseline and coalesces a slow consumer without dropping suffixes', async () => {
    const wire = transport()
    const feeds = new MemberFeeds(wire.source)
    const signal = new AbortController()
    const stream = feeds.follow('a', 'output', signal.signal)[Symbol.asyncIterator]()
    const first = stream.next()
    await until(() => expect(wire.connections).toHaveLength(1))
    const connection = wire.connections[0]!
    connection.push(output('a', 'hello'))
    expect((await first).value?.updates[0]?.text).toBe('hello')
    connection.push(output('a', ' world', 2, false))
    connection.push(output('a', '!', 3, false))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect((await stream.next()).value?.updates).toEqual([item(' world!', 3, true)])
    const late = feeds.follow('a', 'output', signal.signal)[Symbol.asyncIterator]()
    expect((await late.next()).value).toEqual({ baseline: true, updates: [item('hello world!', 3)], removed: [] })
    expect(wire.connections).toHaveLength(1)
    signal.abort()
    await stream.return?.()
    await late.return?.()
    feeds.dispose()
  })

  it('reconnects once when membership changes and aborts every reader on dispose', async () => {
    const wire = transport()
    const feeds = new MemberFeeds(wire.source)
    const a = new AbortController()
    const b = new AbortController()
    const one = feeds.follow('a', 'output', a.signal)[Symbol.asyncIterator]().next()
    await until(() => expect(wire.connections).toHaveLength(1))
    const two = feeds.follow('b', 'output', b.signal)[Symbol.asyncIterator]().next()
    await until(() => expect(wire.connections).toHaveLength(2))
    expect(wire.connections[0]!.signal.aborted).toBe(true)
    expect(wire.connections[1]!.requests).toHaveLength(2)
    feeds.dispose()
    expect(await one).toMatchObject({ done: true })
    expect(await two).toMatchObject({ done: true })
    expect(wire.connections[1]!.signal.aborted).toBe(true)
  })

  it('routes a source error only to its own surface', async () => {
    const wire = transport()
    const feeds = new MemberFeeds(wire.source)
    const signal = new AbortController()
    const stream = feeds.follow('a', 'output', signal.signal)[Symbol.asyncIterator]()
    const text = stream.next()
    const config = feeds.follow('a', 'configuration', signal.signal)[Symbol.asyncIterator]().next()
    const rejection = expect(config).rejects.toThrow('control unavailable')
    await until(() => expect(wire.connections).toHaveLength(1))
    wire.connections[0]!.push(output('a', 'still streaming'))
    wire.connections[0]!.push({ memberId: 'a', channel: 'error', source: 'configuration', message: 'control unavailable' })
    expect((await text).value?.updates[0]?.text).toBe('still streaming')
    await rejection
    signal.abort()
    await stream.return?.()
    feeds.dispose()
  })

  it('replaces a queued old baseline on reconnect and keeps final removals', () => {
    const before: LocalAgentStreamFrame = { baseline: true, updates: [item('stale')], removed: [] }
    const replacement: LocalAgentStreamFrame = { baseline: true, updates: [item('new', 2)], removed: [] }
    expect(coalesceOutput(before, replacement)).toEqual(replacement)
    expect(coalesceOutput(replacement, { baseline: false, updates: [], removed: ['1:1'] })).toEqual({ ...replacement, removed: ['1:1'] })
  })
})

describe('server member feed fan-in', () => {
  it('does not hold output hostage to a silent configuration source; cancellation reaches both', async () => {
    const signal = new AbortController()
    const aborted: string[] = []
    const stream = mergeMemberFeeds([{ memberId: 'a', channel: 'configuration' }, { memberId: 'a', channel: 'output' }], async function* (request, signal) {
      signal.addEventListener('abort', () => aborted.push(request.channel), { once: true })
      if (request.channel === 'output') yield output('a', 'native chunk')
      if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    }, signal.signal)[Symbol.asyncIterator]()
    expect((await stream.next()).value).toEqual(output('a', 'native chunk'))
    const waiting = stream.next()
    signal.abort()
    expect(await waiting).toMatchObject({ done: true })
    expect(aborted.sort()).toEqual(['configuration', 'output'])
  })

  it('isolates source failures and deduplicates repeated requests', async () => {
    const seen: string[] = []
    const events: LocalAgentMemberFeedEvent[] = []
    for await (const event of mergeMemberFeeds([
      { memberId: 'a', channel: 'output' }, { memberId: 'a', channel: 'output' }, { memberId: 'b', channel: 'configuration' },
    ], async function* (request) {
      seen.push(request.memberId)
      if (request.memberId === 'b') throw new Error('bad member')
      yield output('a', 'works')
    }, new AbortController().signal)) events.push(event)
    expect(seen.sort()).toEqual(['a', 'b'])
    expect(events).toContainEqual(output('a', 'works'))
    expect(events).toContainEqual({ memberId: 'b', channel: 'error', source: 'configuration', message: 'bad member' })
  })
})
