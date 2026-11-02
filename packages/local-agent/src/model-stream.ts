import type { AssistantStreamRecord } from '@deepseek-ai/dsh-llm'
import type { SessionEventMap } from '@deepseek-ai/dsh-session'

/** One model content block's coarse generation interval, independent of tool execution. */
export interface LocalAgentModelBlock {
  kind: 'reasoning' | 'text' | 'tool-call'
  index: number
  startedAt: number
  endedAt: number
  text?: string
  call?: { id: SessionEventMap['tool/call']['callId']; name: string; arguments: string }
}

/**
 * Convert model blocks into the host's existing durable stream vocabulary.
 * Invalid or incomplete blocks are omitted rather than assigned fabricated times.
 */
export function localAgentStreamRecords(blocks: readonly LocalAgentModelBlock[]): AssistantStreamRecord[] {
  const records: AssistantStreamRecord[] = []
  const ordered = blocks.slice().sort((a, b) => a.startedAt - b.startedAt || a.index - b.index)
  for (const block of ordered) {
    if (!Number.isSafeInteger(block.startedAt) || !Number.isSafeInteger(block.endedAt)
      || !Number.isSafeInteger(block.index) || block.index < 0 || block.endedAt < block.startedAt) continue
    if (block.kind === 'tool-call' && block.call === undefined) continue
    records.push({
      type: 'chunk',
      time: block.startedAt,
      chunk: { type: 'block-start', index: block.index, blockType: block.kind },
    })
    records.push({
      type: 'chunk',
      time: block.endedAt,
      chunk: {
        type: 'block-end',
        index: block.index,
        block: block.kind === 'tool-call'
          ? { type: 'tool-call', id: block.call!.id, name: block.call!.name, arguments: block.call!.arguments }
          : { type: block.kind, text: block.text ?? '' },
      },
    })
  }
  return records
}
