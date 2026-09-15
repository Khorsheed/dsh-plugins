/** Public Conversation definition: transient presentation yields to the native final message. */
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { LocalAgentStreamCheckpoint } from '../types.ts'

export interface MemberLiveNodeData extends LocalAgentStreamCheckpoint {
  readonly seq: number
  readonly settled: boolean
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'local-agent-stream': MemberLiveNodeData
  }
}

export const memberLiveDefinition: ConversationNodeDefinition<MemberLiveNodeData> = {
  kind: 'local-agent-stream',
  target: 'chat',
  match(event) {
    if (event.type === 'local-agent/stream') return { id: event.data.id, role: event.data.opening ? 'start' : 'update' }
    if (event.type === 'assistant/message') return { id: `${event.data.turn}:${event.data.step}`, role: 'update' }
    return null
  },
  start(_context, match) {
    if (match.event.type !== 'local-agent/stream') throw new Error('stream anchor required')
    return { ...match.event.data, seq: match.event.seq, settled: false }
  },
  update(context, match) {
    if (match.event.type === 'assistant/message') return { ...context.state, settled: true }
    if (match.event.type !== 'local-agent/stream') return context.state
    const checkpoint = match.event.data
    return { ...context.state, ...checkpoint, text: checkpoint.append ? context.state.text + checkpoint.text : checkpoint.text }
  },
  buildViewNode(context) {
    if (context.state === undefined) return null
    const node: ChatConversationViewNode = {
      key: context.key, kind: 'local-agent-stream', id: context.id, target: 'chat',
      anchorSeq: context.state.seq, location: context.start?.location ?? { kind: 'unresolved' },
      visibility: context.state.settled ? 'hidden' : 'visible', data: context.state,
    }
    return node
  },
}
