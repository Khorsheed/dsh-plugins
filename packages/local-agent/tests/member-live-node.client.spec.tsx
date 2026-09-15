// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { LocalAgentStreams } from '../src/live-stream.ts'
import { MemberLiveNode, type MemberLiveNodeProps } from '../src/client/MemberLiveNode.tsx'
import { MemberLiveOutputs } from '../src/client/live-output.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

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
