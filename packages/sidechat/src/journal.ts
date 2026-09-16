/**
 * Transcript projection: folds a side-chat session's journal into the rows
 * the Remote serves — user and assistant text messages verbatim, every tool
 * call collapsed to a one-line status (paired with its result by `callId`).
 *
 * The projection is pure and journal-only: it reads `user/message`,
 * `assistant/message`, `tool/call`, and `tool/result`, and skips everything
 * else (boundaries, headers, system messages, lifecycle markers). The same
 * fold runs over a live session's snapshot and a cold persistence
 * inspection, which is what makes "重启后历史完整" a replay, not a cache.
 *
 * @module @khorsheed/dsh-sidechat/journal
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SideChatToolState, SideChatTranscriptRow } from './types.ts'

/** Join the visible text blocks; reasoning, images, files and tool blocks stay out of the transcript. */
export function messageTextOf(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}

/** One in-fold tool call, completed in place when its result event lands. */
interface PendingTool {
  readonly index: number
  state: SideChatToolState
}

/**
 * Fold the journal into transcript rows.
 * @param events - the session's events in log order (live snapshot or cold read).
 * @returns user/assistant/tool rows in conversation order.
 */
export function projectTranscript(events: readonly SessionEvent[]): SideChatTranscriptRow[] {
  const rows: SideChatTranscriptRow[] = []
  const calls = new Map<string, PendingTool>()
  for (const event of events) {
    switch (event.type) {
      case 'user/message': {
        const text = messageTextOf(event.data.content)
        if (text === '') break
        rows.push({ kind: 'user', text, time: event.time })
        break
      }
      case 'assistant/message': {
        const text = messageTextOf(event.data.message.content)
        if (text === '') break
        rows.push({ kind: 'assistant', text, time: event.time })
        break
      }
      case 'tool/call': {
        rows.push({ kind: 'tool', name: event.data.name, state: 'running', time: event.time })
        calls.set(event.data.callId, { index: rows.length - 1, state: 'running' })
        break
      }
      case 'tool/result': {
        const block = event.data.message.content[0]
        const pending = calls.get(block.toolCallId)
        if (pending === undefined) break
        const failed = event.data.error !== undefined || block.isError === true
        const state: SideChatToolState = failed ? 'error' : 'done'
        pending.state = state
        const row = rows[pending.index]
        if (row !== undefined && row.kind === 'tool') rows[pending.index] = { ...row, state }
        break
      }
      default:
        break
    }
  }
  return rows
}
