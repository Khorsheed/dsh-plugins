import { afterEach, describe, expect, it, vi } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { LocalAgentStreams, LiveStreamPublisher } from '../src/live-stream.ts'

afterEach(() => { vi.useRealTimers() })
const item = (text: string) => ({ id: '1:1', turn: 1, step: 1, kind: 'text' as const, text, receivedAt: 1 })

describe('transient member stream', () => {
  it('delivers a baseline, suffixes, replacements and removal without crossing sessions', async () => {
    const bus = new LocalAgentStreams()
    bus.publish('a', item('你'))
    bus.publish('b', item('private'))
    const abort = new AbortController()
    const stream = bus.follow('a', abort.signal)[Symbol.asyncIterator]()
    expect((await stream.next()).value).toMatchObject({ baseline: true, updates: [{ text: '你', append: false }] })
    bus.publish('a', item('你好'))
    expect((await stream.next()).value).toMatchObject({ baseline: false, updates: [{ text: '好', append: true }] })
    bus.publish('a', item('重写'))
    expect((await stream.next()).value).toMatchObject({ updates: [{ text: '重写', append: false }] })
    bus.finish('a', '1:1')
    expect((await stream.next()).value).toMatchObject({ updates: [], removed: ['1:1'] })
    const waiting = stream.next()
    abort.abort()
    expect((await waiting).done).toBe(true)
    bus.dispose()
  })

  it('coalesces a slow follower and reconnects from current state', async () => {
    const bus = new LocalAgentStreams()
    const abort = new AbortController()
    const stream = bus.follow('a', abort.signal)[Symbol.asyncIterator]()
    await stream.next()
    for (let i = 1; i <= 5_000; i++) bus.publish('a', item('x'.repeat(i)))
    expect((await stream.next()).value.updates).toMatchObject([{ text: 'x'.repeat(5_000), append: false }])
    const reconnect = bus.follow('a', abort.signal)[Symbol.asyncIterator]()
    expect((await reconnect.next()).value).toMatchObject({ baseline: true, updates: [{ text: 'x'.repeat(5_000) }] })
    const pending = stream.next()
    bus.dispose()
    expect((await pending).done).toBe(true)
    expect((await reconnect.next()).done).toBe(true)
  })

  it('checkpoints suffix bytes on a separate cadence and cancels late writes at finalization', async () => {
    vi.useFakeTimers()
    const session = Session.create(SessionId('stream-checkpoint'))
    const bus = new LocalAgentStreams()
    const persist = vi.fn()
    const writer = new LiveStreamPublisher(bus, session, 1, persist, error => { throw error })
    writer.update(1, 'text', 'a')
    for (let i = 2; i <= 100; i++) {
      writer.update(1, 'text', 'a'.repeat(i))
      await vi.advanceTimersByTimeAsync(10)
    }
    expect(session.snapshotEvents()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(10)
    const checkpoints = session.snapshotEvents().filter(e => e.type === 'local-agent/stream')
    expect(checkpoints).toHaveLength(2)
    expect(checkpoints[1]!.data).toMatchObject({ text: 'a'.repeat(99), append: true })
    expect(checkpoints.map(e => e.data.text).join('')).toHaveLength(100)
    writer.update(1, 'text', 'a'.repeat(101))
    writer.finish(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(session.snapshotEvents()).toHaveLength(2)
    expect(persist).toHaveBeenCalledTimes(2)
    writer.dispose()
    bus.dispose()
  })

  it('keeps native subitems distinct, timestamps arrival before flushing, and closes every anchor', async () => {
    const session = Session.create(SessionId('stream-blocks'))
    const bus = new LocalAgentStreams()
    const writer = new LiveStreamPublisher(bus, session, 1, () => {}, error => { throw error })
    writer.update(1, 'think', 'Reasoning', { itemId: 'block-0', receivedAt: 10 })
    writer.update(1, 'text', 'Answer', { itemId: 'block-1', receivedAt: 20 })
    writer.update(1, 'text', 'Answer', { itemId: 'block-1', receivedAt: 99 }) // No new bytes, no fake arrival.
    const abort = new AbortController()
    const follower = bus.follow(String(session.id), abort.signal)[Symbol.asyncIterator]()
    expect((await follower.next()).value.updates).toMatchObject([
      { id: '1:1:block-0', kind: 'think', text: 'Reasoning', receivedAt: 10 },
      { id: '1:1:block-1', kind: 'text', text: 'Answer', receivedAt: 20 },
    ])
    writer.finish(1)
    expect((await follower.next()).value.removed).toEqual(['1:1:block-0', '1:1:block-1'])
    expect(session.snapshotEvents().filter(event => event.type === 'local-agent/stream' && event.data.closed)).toHaveLength(2)
    abort.abort(); writer.dispose(); bus.dispose()
  })

  it('retains an unfinished subitem on producer failure instead of falsely closing it', () => {
    const session = Session.create(SessionId('stream-block-crash'))
    const bus = new LocalAgentStreams()
    const writer = new LiveStreamPublisher(bus, session, 1, () => {}, error => { throw error })
    writer.update(1, 'text', 'Partial', { itemId: 'block' })
    writer.update(1, 'text', 'Partial answer', { itemId: 'block' })
    writer.dispose()
    expect(session.snapshotEvents().at(-1)?.data).toMatchObject({ text: ' answer', append: true })
    expect(session.snapshotEvents().some(event => event.type === 'local-agent/stream' && event.data.closed)).toBe(false)
    bus.dispose()
  })

  it('keeps the last partial checkpoint when a producer closes without a final message', () => {
    const session = Session.create(SessionId('stream-crash'))
    const bus = new LocalAgentStreams()
    const writer = new LiveStreamPublisher(bus, session, 1, () => {}, error => { throw error })
    writer.update(2, 'think', '开头')
    writer.update(2, 'think', '开头之后')
    writer.dispose()
    expect(session.snapshotEvents().map(e => e.type)).toEqual(['local-agent/stream', 'local-agent/stream'])
    expect(session.snapshotEvents().at(-1)!.data).toMatchObject({ text: '之后', append: true })
    bus.dispose()
  })
})
