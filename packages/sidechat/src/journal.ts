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
import { unfoldQuotedContext, type SideChatToolState, type SideChatTranscriptRow } from './types.ts'

/** Join the visible text blocks; reasoning, images, files and tool blocks stay out of the transcript. */
export function messageTextOf(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}

/**
 * The context-injection forms the official UI classifies as
 * context-provenance rows (ui-conversation's KnownContextForm) rather than
 * user speech: AGENTS.md blocks, system-prompt snapshots, skill catalogs,
 * notices, relays and recalls. A side-chat session's journal carries them
 * like any conversation's, and rendering them as user bubbles paints whole
 * `<system-reminder>` documents into the transcript (the 3080 screenshot).
 */
const CONTEXT_FORMS: ReadonlySet<string> = new Set(['instructions', 'catalog', 'snapshot', 'notice', 'relay', 'recall'])

/**
 * Whether one `user/message` event is a context injection rather than the
 * user's own speech. Our own sends (`kind: 'plugin'`, no form) and ordinary
 * human messages answer false and stay visible.
 */
function isContextInjection(source: unknown): boolean {
  if (typeof source !== 'object' || source === null) return false
  const probe = source as { kind?: unknown; form?: unknown }
  if (probe.kind === 'agent-instructions') return true
  return typeof probe.form === 'string' && CONTEXT_FORMS.has(probe.form)
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
        // Context injections (AGENTS.md, snapshots, catalogs, …) are not the
        // user's speech — the official UI classifies them the same way.
        if (isContextInjection(event.data.source)) break
        const folded = messageTextOf(event.data.content)
        if (folded === '') break
        // Our own fold carries the quoted refs IN the durable text; lift them
        // back out so the transcript renders chips, not markup.
        const { text, refs } = unfoldQuotedContext(folded)
        if (text === '' && refs.length === 0) break
        rows.push({ kind: 'user', text, refs, time: event.time })
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

/**
 * Fold the journal's `turn/end` closers into the latest turn error: an
 * error-ended turn contributes its failure message, and the first non-error
 * `turn/end` after it clears the slate. Everything else (completed, aborted,
 * blocked, max-tokens, interrupted, and turns that never closed) projects to
 * no error. This is what makes a silently dying turn — a request that fails
 * before its message even reaches the log — visible to the user.
 * @param events - the session's events in log order (live snapshot or cold read).
 * @returns the latest error message, or null when the latest closed turn was clean.
 */
export function projectTurnError(events: readonly SessionEvent[]): string | null {
  let lastError: string | null = null
  for (const event of events) {
    if (event.type !== 'turn/end') continue
    lastError = event.data.reason.kind === 'error' ? event.data.reason.error.message : null
  }
  return lastError
}
