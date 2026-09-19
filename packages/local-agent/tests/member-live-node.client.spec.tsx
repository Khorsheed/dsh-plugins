// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { LocalAgentStreams } from '../src/live-stream.ts'
import { MemberLiveNode, MemberLiveOutputView, type MemberLiveNodeProps } from '../src/client/MemberLiveNode.tsx'
import { MemberLiveOutputs } from '../src/client/live-output.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('member transient rendering', () => {
  it('renders real updates before a final message, reconnects without duplicating text, and closes when unmounted', async () => {
    const bus = new LocalAgentStreams()
    const base = { id: '1:1', turn: 1, step: 1, kind: 'text' as const, receivedAt: 1 }
    bus.publish('member', { ...base, text: '你好' })
    let connections = 0
    let closed = 0
    const outputs = new MemberLiveOutputs(async function* (id, signal) {
      const connection = ++connections
      let frames = 0
      try {
        for await (const frame of bus.follow(id, signal)) {
          yield frame
          if (connection === 1 && ++frames === 2) throw new Error('simulated disconnect')
        }
      } finally { closed++ }
    })
    const props = {
      node: { data: { ...base, sessionId: 'member', text: 'checkpoint', seq: 1, append: false, settled: false } },
      outputs, t: makeTranslate(zh),
    } as MemberLiveNodeProps
    const view = render(<MemberLiveNode {...props} />)
    await screen.findByText('你好')
    await act(async () => { bus.publish('member', { ...base, text: '你好世界' }) })
    await screen.findByText('你好世界')
    await act(async () => { bus.publish('member', { ...base, text: '你好世界，继续' }) })
    await screen.findByText('你好世界，继续')
    expect(connections).toBe(2)
    expect(screen.queryByText('你好你好世界')).toBeNull()
    view.unmount()
    await waitFor(() => { expect(closed).toBe(2) })
    bus.dispose()
  })
})


describe('Room inline output', () => {
  it('shares native deltas, filters previous runs and releases its subscription', async () => {
    const bus = new LocalAgentStreams()
    const base = { turn: 1, step: 1, kind: 'text' as const }
    bus.publish('member', { ...base, id: 'old', receivedAt: 1, text: 'old answer' })
    let closed = false
    const outputs = new MemberLiveOutputs(async function* (id, signal) {
      try { yield* bus.follow(id, signal) } finally { closed = true }
    })
    const view = render(<MemberLiveOutputView sessionId="member" startedAt={10} outputs={outputs} t={makeTranslate(zh)} />)
    await act(async () => { bus.publish('member', { ...base, id: 'current', receivedAt: 11, text: 'new answer' }) })
    await screen.findByText('new answer')
    expect(screen.queryByText('old answer')).toBeNull()
    await act(async () => { bus.publish('member', { ...base, id: 'current', receivedAt: 12, text: 'new answer grows' }) })
    await screen.findByText('new answer grows')
    expect(view.container.querySelector('[data-live-received-at="12"]')).not.toBeNull()
    view.unmount()
    await waitFor(() => expect(closed).toBe(true))
    bus.dispose()
  })
})


describe('foreground paint diagnostics', () => {
  it('samples only after a paint opportunity and cancels callbacks on unmount', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    let now = 100
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    let next = 0
    const callbacks = new Map<number, FrameRequestCallback>()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++next, callback); return next })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { callbacks.delete(id) })
    const frame = () => { const pending = [...callbacks]; callbacks.clear(); for (const [, callback] of pending) callback(now) }
    const bus = new LocalAgentStreams()
    const item = { id: '1:1', turn: 1, step: 1, kind: 'text' as const, receivedAt: 100, text: 'streaming' }
    bus.publish('member', item)
    const outputs = new MemberLiveOutputs((id, signal) => bus.follow(id, signal))
    const view = render(<MemberLiveOutputView sessionId="member" startedAt={100} outputs={outputs} t={makeTranslate(zh)} />)
    await screen.findByText('streaming')
    const section = view.container.querySelector('[data-member-live]')!
    now = 120; frame()
    expect(section.getAttribute('data-live-paint-samples')).toBeNull()
    now = 145; frame()
    expect(section.getAttribute('data-live-paint-samples')).toBe('[45]')
    await act(async () => { bus.publish('member', { ...item, receivedAt: 150, text: 'next' }) })
    expect(callbacks.size).toBe(1)
    view.unmount()
    expect(callbacks.size).toBe(0)
    bus.dispose()
  })
})
