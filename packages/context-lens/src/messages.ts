/**
 * Normalized message form the capture pipeline segments. Both lanes — the
 * in-process `llm/stream` waterfall (typed `RequestMessage` values, possibly
 * deep-frozen) and the child-log lane (untrusted JSON from another process's
 * session log) — reduce to {@link CapturedMessage} before classification, so
 * the segmenter sees exactly one shape.
 *
 * Classification maps the host's merge-extensible `MessageSource.kind` /
 * `ContextForm` vocabulary onto the panel's closed {@link SegmentCategory}
 * set. Unknown producer kinds degrade to `plugin-injection`; the mapping is
 * additive — a new host kind never throws, it just lands in the plugin bucket
 * until the map learns it.
 *
 * @module @khorsheed/dsh-context-lens/messages
 */
import type { ContentBlock, RequestMessage } from '@deepseek-ai/dsh-llm'
import type { SegmentCategory } from './types.ts'

/** One content block, flattened to the fields the panel displays. */
export interface CapturedBlock {
  type: string
  text?: string
  /** tool-call blocks: provider-issued call id, tool name, raw JSON arguments. */
  id?: string
  name?: string
  arguments?: string
  /** tool-addition / tool-removal blocks: the affected tool name. */
  toolName?: string
  /** file / image blocks: display label for the placeholder line. */
  ref?: string
}

/** The lane-neutral message record the segmenter consumes. */
export interface CapturedMessage {
  /** Durable message id when the message has one (hand-built one-shot inputs do not). */
  id?: string
  role: 'system' | 'user' | 'assistant' | 'tool' | 'developer'
  /** `MessageSource.kind` — producer identity in the host's own vocabulary. */
  sourceKind: string
  /** `ContextFormed.form` when the producer declared one. */
  sourceForm?: string
  compactionId?: string
  pruning?: { beforeChars: number; afterChars: number }
  content: CapturedBlock[]
  /** tool-role messages: the answered call. */
  toolCallId?: string
  sourceTurn?: number | undefined
  isError?: boolean
}

/** Collapse whitespace for the single-line preview, capped at `max` chars. */
export function previewLine(text: string, max = 80): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`
}

/** Model-facing text of non-assistant content: text verbatim, file/image as placeholder lines. */
function plainText(blocks: readonly CapturedBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        parts.push(block.text ?? '')
        break
      case 'file':
        parts.push(`[file: ${block.ref ?? 'attachment'}]`)
        break
      case 'image':
        parts.push(`[image${block.ref === undefined ? '' : `: ${block.ref}`}]`)
        break
      default:
        break
    }
  }
  return parts.join('\n')
}

/**
 * The verbatim wire form of one message — what `SegmentItem.full` carries.
 * Assistant rows serialize to a JSON string `{reasoning?, text?, calls?}`
 * (calls keep the raw argument JSON), the shape the reference panel renders;
 * every other role is its plain text. The content is pre-projection: the
 * waterfall sees file/image blocks before the adapter rewrites them to handle
 * text, so they appear as bracketed placeholders.
 */
export function serializeMessage(message: CapturedMessage): string {
  if (message.role === 'assistant') {
    const reasoning = message.content
      .filter(block => block.type === 'reasoning')
      .map(block => block.text ?? '')
      .join('')
    const text = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text ?? '')
      .join('')
    const calls = message.content
      .filter(block => block.type === 'tool-call')
      .map(block => ({ id: block.id ?? '', name: block.name ?? '', arguments: block.arguments ?? '' }))
    return JSON.stringify({
      ...reasoning.length > 0 ? { reasoning } : {},
      ...text.length > 0 ? { text } : {},
      ...calls.length > 0 ? { calls } : {},
    })
  }
  if (message.role === 'developer') {
    return JSON.stringify(message.content)
  }
  return plainText(message.content)
}

/** Tool names one assistant message invoked (the chip on assistant rows). */
export function toolCallNames(message: CapturedMessage): string[] {
  return message.content
    .filter(block => block.type === 'tool-call')
    .map(block => block.name ?? '')
    .filter(name => name.length > 0)
}

/** Single-line summary of one message for the collapsed row. */
export function previewMessage(message: CapturedMessage): string {
  if (message.role === 'assistant') {
    const names = toolCallNames(message)
    if (names.length > 0) return `→ ${names.join(', ')}`
    const text = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text ?? '')
      .join('')
    return previewLine(text)
  }
  if (message.role === 'developer') {
    const changes = message.content
      .map(block => (block.type === 'tool-addition' ? `+${block.toolName ?? ''}`
        : block.type === 'tool-removal' ? `-${block.toolName ?? ''}` : ''))
      .filter(part => part.length > 1)
    return previewLine(changes.length > 0 ? `tools ${changes.join(' ')}` : serializeMessage(message))
  }
  return previewLine(plainText(message.content))
}

/**
 * Classify one message into its panel category. Role decides first; user-role
 * rows refine by producer `kind`, with `form: 'snapshot'` as the fallback
 * signal for runtime snapshots from producers the explicit map predates.
 */
export function classifyMessage(message: CapturedMessage): SegmentCategory {
  switch (message.role) {
    case 'system':
      return 'system'
    case 'assistant':
      return 'assistant'
    case 'tool':
      return 'tool-result'
    case 'developer':
      return 'tool-change'
    case 'user':
      break
  }
  switch (message.sourceKind) {
    case 'user':
      return 'user'
    case 'runtime-context':
      return 'runtime-snapshot'
    case 'skill-catalog':
    case 'skill-invocation':
      return 'skill-injection'
    case 'compact-checkpoint':
      return 'compaction'
    case 'repeat-tool-reminder':
      return 'reminder-injection'
    default:
      return message.sourceForm === 'snapshot' ? 'runtime-snapshot' : 'plugin-injection'
  }
}

/** The label a row shows as its origin — producer kind, refined where the panel knows more. */
export function messageSourceLabel(message: CapturedMessage, toolName?: string): string {
  if (message.role === 'tool' && toolName !== undefined) return toolName
  return message.sourceKind
}

/**
 * Diff identity for one message: the durable id when present, else a content
 * hash. Tool-result pruning preserves ids while changing content; the hash
 * fallback keeps hand-built id-less inputs (aux requests) diffable.
 */
export function messageKey(message: CapturedMessage, hash: (text: string) => string): string {
  return `${message.id === undefined ? 'h' : `id:${message.id}`}:${hash(JSON.stringify({
    ...'turn' in message && typeof message.turn === 'number' ? { sourceTurn: message.turn } : {},
    role: message.role,
    kind: message.sourceKind,
    content: message.content,
    ...message.toolCallId === undefined ? {} : { toolCallId: message.toolCallId },
  }))}`
}

/** Normalize one typed waterfall message (loop-built or hand-built). Never mutates the input. */
export function fromRequestMessage(message: RequestMessage): CapturedMessage {
  const content = (message.content as readonly ContentBlock[]).map(normalizeBlock)
  // A hand-built one-shot input has neither id nor source; durable messages
  // carry both. Narrowing through `in` keeps the `?: never` arms honest.
  const id = 'id' in message && typeof message.id === 'string' ? message.id : undefined
  const source = 'source' in message && typeof message.source === 'object'
    ? message.source as { readonly kind: string; readonly form?: string; readonly compactionId?: string }
    : undefined
  const base = {
    ...id === undefined ? {} : { id },
    ...'turn' in message && typeof message.turn === 'number' ? { sourceTurn: message.turn } : {},
    role: message.role,
    ...source?.compactionId === undefined ? {} : { compactionId: source.compactionId },
    sourceKind: source?.kind ?? 'user',
    ...source?.form === undefined ? {} : { sourceForm: source.form },
    content,
  }
  if (message.role === 'tool') {
    return {
      ...base,
      toolCallId: message.toolCallId,
      ...message.isError === undefined ? {} : { isError: message.isError },
    }
  }
  return base
}

/** Flatten one typed content block. Unknown block types keep only their tag. */
function normalizeBlock(block: ContentBlock): CapturedBlock {
  switch (block.type) {
    case 'text':
    case 'reasoning':
      return { type: block.type, text: block.text }
    case 'tool-call':
      return { type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments }
    case 'tool-addition':
    case 'tool-removal':
      return { type: block.type, toolName: block.toolName }
    case 'file':
    case 'image': {
      const ref = attachmentLabel(block.attachment)
      return ref === undefined ? { type: block.type } : { type: block.type, ref }
    }
    default:
      return { type: (block as ContentBlock).type }
  }
}

/** Best-effort display label out of an attachment reference. */
function attachmentLabel(attachment: unknown): string | undefined {
  if (typeof attachment !== 'object' || attachment === null) return undefined
  const name = (attachment as { name?: unknown }).name
  return typeof name === 'string' && name.length > 0 ? name : undefined
}

/** Structural read of one log-lane message (untrusted JSON). Returns undefined for unreadable rows. */
export function fromLogMessage(raw: unknown): CapturedMessage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const value = raw as Record<string, unknown>
  const role = value['role']
  if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool' && role !== 'developer') {
    return undefined
  }
  const content = Array.isArray(value['content']) ? value['content'].map(readBlock).filter(isDefined) : []
  const source = typeof value['source'] === 'object' && value['source'] !== null
    ? value['source'] as Record<string, unknown>
    : undefined
  const sourceKind = typeof source?.['kind'] === 'string' ? source['kind'] : role === 'user' ? 'user' : role
  return {
    ...typeof value['id'] === 'string' ? { id: value['id'] } : {},
    ...typeof value['turn'] === 'number' ? { sourceTurn: value['turn'] } : {},
    role,
    sourceKind,
    ...typeof source?.['compactionId'] === 'string' ? { compactionId: source['compactionId'] } : {},
    ...typeof source?.['form'] === 'string' ? { sourceForm: source['form'] } : {},
    content,
    ...typeof value['toolCallId'] === 'string' ? { toolCallId: value['toolCallId'] } : {},
    ...value['isError'] === undefined ? {} : { isError: value['isError'] === true },
  }
}

/** Structural read of one log-lane content block. */
function readBlock(raw: unknown): CapturedBlock | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const value = raw as Record<string, unknown>
  const type = value['type']
  if (typeof type !== 'string') return undefined
  return {
    type,
    ...typeof value['text'] === 'string' ? { text: value['text'] } : {},
    ...typeof value['id'] === 'string' ? { id: value['id'] } : {},
    ...typeof value['name'] === 'string' ? { name: value['name'] } : {},
    ...typeof value['arguments'] === 'string' ? { arguments: value['arguments'] } : {},
    ...typeof value['toolName'] === 'string' ? { toolName: value['toolName'] } : {},
  }
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
