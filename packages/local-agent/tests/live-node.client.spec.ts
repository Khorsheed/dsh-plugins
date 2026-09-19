import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationViewNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { memberLiveDefinition } from '../src/client/live-node.ts'

describe('member live Conversation definition', () => {
  it.each([undefined, 'native-block'])('renders checkpoints and closes native or subitem anchors on live and replay paths (%s)', (itemId) => {
    const session = Session.create(SessionId('member-live-node'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const data = { id: itemId === undefined ? '1:1' : `1:1:${itemId}`, sessionId: 'member-live-node', turn: 1, step: 1, kind: 'text' as const, text: 'hello', receivedAt: 0 }
    session.append('local-agent/stream', { ...data, opening: true, append: false })
    const nodes = new Map<string, ConversationViewNode>()
    const assembler = new ConversationNodeAssembler({ entries: () => [memberLiveDefinition], fallbackEntry: () => undefined }, {
      entries: () => [{ target: 'chat', create: () => ({
        empty: [],
        replace(input) { nodes.clear(); for (const node of input.nodes) nodes.set(node.key, node); return [...nodes.values()] },
        apply(input) { for (const node of input.upserts) nodes.set(node.key, node); return [...nodes.values()] },
      }) }],
    })
    assembler.replaceWindow(session.snapshotEvents().map(event => ({ type: 'event', event })), false)
    assembler.activateTarget('chat')
    const first = [...nodes.values()][0] as ChatConversationViewNode
    expect(first.visibility).toBe('visible')
    expect(first.location).toMatchObject({ kind: 'step' })
    session.append('local-agent/stream', { ...data, text: ' world', append: true })
    assembler.append({ type: 'event', event: session.snapshotEvents().at(-1)! })
    assembler.flush()
    expect([...nodes.values()][0]?.data).toMatchObject({ text: 'hello world' })
    session.append('assistant/message', {
      turn: 1, step: 1, stream: [],
      message: createAssistantMessage({ content: [{ type: 'text', text: 'authoritative' }], source: { provider: 'test', model: 'test' } }),
    }, { surfaceOp: 'append' })
    assembler.append({ type: 'event', event: session.snapshotEvents().at(-1)! })
    if (itemId !== undefined) {
      session.append('local-agent/stream', { ...data, text: '', append: true, closed: true })
      assembler.append({ type: 'event', event: session.snapshotEvents().at(-1)! })
    }
    expect(() => assembler.flush()).not.toThrow()
    expect(([...nodes.values()][0] as ChatConversationViewNode).visibility).toBe('hidden')
    assembler.replaceWindow(session.snapshotEvents().map(event => ({ type: 'event', event })), false)
    assembler.flush()
    expect(([...nodes.values()][0] as ChatConversationViewNode).visibility).toBe('hidden')
  })
})
