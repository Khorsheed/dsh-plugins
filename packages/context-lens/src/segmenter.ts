/**
 * The four-segment split of one captured request: system / tools / history /
 * added. History vs added compares message identity AND content against the previous
 * request IN THE SAME SCOPE (durable message ids and content hashes
 * otherwise); "added" therefore includes the previous response and its tool
 * results, and a compaction that rewrote the surface shows up as new content —
 * exactly what the model saw change.
 *
 * System rows are attributed to `system-prompt/assemble` sections by content:
 * the capture renders each observed assembly (same interpolate-filter-join
 * rules as the host's `renderPrompt`) and a system message whose text equals a
 * rendered assembly splits into that assembly's named sections. Anything that
 * fails to match stays one unattributed row — attribution is presentation,
 * never worth faking.
 *
 * @module @khorsheed/dsh-context-lens/segmenter
 */
import type { CapturedRequest, SegmentItem, ToolDefItem } from './types.ts'
import {
  classifyMessage,
  messageKey,
  messageSourceLabel,
  previewLine,
  previewMessage,
  serializeMessage,
  toolCallNames,
  type CapturedMessage,
} from './messages.ts'

/** One tool definition as the waterfall carries it (host `ToolSchema`, structurally). */
export interface CapturedToolSchema {
  name: string
  description: string
  parameters: Record<string, unknown>
  deferLoading?: true
}

/**
 * One rendered `system-prompt/assemble` output, kept for content-matching
 * against later requests' system messages.
 */
export interface AssemblyRecord {
  /** The whole rendered prompt (sections interpolated, empties dropped, `\n\n`-joined). */
  rendered: string
  /** Per-section rendered text, in assembly order. */
  sections: { name: string; text: string }[]
  at: number
}

/** The previous request's diff baseline within one scope. */
export interface ScopeFingerprint {
  messageKeys: string[]
  toolNames: string[]
  /** The one-shot system slot text, for its freshness on the next request. */
  systemSlot?: string
}

/** Everything the split needs beyond the request's own payload. */
export interface SegmentContext {
  /** Previous request's fingerprint in this scope; absent for the scope's first request. */
  previous?: ScopeFingerprint
  /** Recently observed assemblies, oldest first. */
  assemblies: readonly AssemblyRecord[]
  /** Resolve a tool-call id to its tool name (tool rows label themselves with it). */
  resolveToolName?: (callId: string) => string | undefined
  /** Resolve a durable assistant message id to its producing request's generation time. */
  turnFor?: (messageId: string) => number | undefined
  durationFor?: (messageId: string) => number | undefined
}

/** The split result plus the fingerprint the scope's NEXT request diffs against. */
export interface SegmentResult {
  system: SegmentItem[]
  tools: ToolDefItem[]
  history: SegmentItem[]
  added: SegmentItem[]
  fingerprint: ScopeFingerprint
  /** 请求体总字符数（明细头右上）— system + tools + history + added 之和。 */
  totalChars: number
}

/** A `system-prompt/assemble` waterfall value, structurally (host `PromptAssembly`). */
export interface CapturedAssembly {
  sections: { name: string; text: string; interpolate?: boolean }[]
  variables: Record<string, string | undefined>
}

/** Cap on retained assemblies; assemblies older than the last 32 never match again in practice. */
export const ASSEMBLY_RING_CAP = 32

const VARIABLE_REFERENCE = /\{\{([a-z][a-z0-9_]*)\}\}/g

/**
 * Interpolate one section the way the host's renderer does, minus its error
 * paths: a reference whose variable is missing keeps its literal form so the
 * rendered text still lines up with whatever the host produced (or simply
 * fails to match, degrading attribution to a single row).
 */
function interpolateSection(text: string, variables: Record<string, string | undefined>): string {
  return text.replace(VARIABLE_REFERENCE, (raw, name: string) => variables[name] ?? raw)
}

/**
 * Record one post-waterfall assembly into the ring. Adjacent duplicates (a
 * listener-free re-assembly between steps) collapse to one entry.
 */
export function recordAssembly(
  ring: AssemblyRecord[],
  assembly: CapturedAssembly,
  at: number,
): void {
  const sections = assembly.sections
    .map(section => ({
      name: section.name,
      text: section.interpolate === false ? section.text : interpolateSection(section.text, assembly.variables),
    }))
    .filter(section => section.text.length > 0)
  const rendered = sections.map(section => section.text).join('\n\n')
  const last = ring[ring.length - 1]
  if (last !== undefined && last.rendered === rendered) {
    last.at = at
    return
  }
  ring.push({ rendered, sections, at })
  if (ring.length > ASSEMBLY_RING_CAP) ring.splice(0, ring.length - ASSEMBLY_RING_CAP)
}

/** Split one request's payload into the four segments. Pure: no I/O, no clock. */
export function splitRequest(input: {
  /** All `options.messages`, normalized, in wire order. */
  messages: CapturedMessage[]
  /** `options.system` (one-shot callers), when present. */
  systemSlot?: string
  /** `options.tools`, normalized. */
  tools?: CapturedToolSchema[]
  context: SegmentContext
}): SegmentResult {
  const { messages, context } = input
  const keys = messages.map(message => messageKey(message, contentHash))
  const freshnessByIndex = messageFreshness(keys, context.previous)
  const previousToolNames = new Set(context.previous?.toolNames ?? [])

  const system: SegmentItem[] = []
  if (input.systemSlot !== undefined && input.systemSlot.length > 0) {
    system.push({
      // The system slot sits ahead of the message array on the wire; -1 marks
      // "not a message-slot position".
      index: -1,
      category: 'system',
      source: 'system',
      preview: previewLine(input.systemSlot),
      full: input.systemSlot,
      chars: input.systemSlot.length,
      freshness: context.previous?.systemSlot === input.systemSlot ? 'history' : 'new',
    })
  }

  const history: SegmentItem[] = []
  const added: SegmentItem[] = []
  messages.forEach((message, index) => {
    const freshness = freshnessByIndex[index]!
    if (message.role === 'system') {
      system.push(...attributeSystem(message, index, freshness, context.assemblies))
      return
    }
    const full = serializeMessage(message)
    const toolCalls = message.role === 'assistant' ? toolCallNames(message) : []
    const durationMs = message.role === 'assistant' && message.id !== undefined
      ? context.durationFor?.(message.id)
      : undefined
    const sourceTurn = message.sourceTurn ?? (message.id === undefined ? undefined : context.turnFor?.(message.id))
    const item: SegmentItem = {
      index,
      ...message.id === undefined ? {} : { messageId: message.id },
      ...message.compactionId === undefined ? {} : { compactionId: message.compactionId },
      ...message.pruning === undefined ? {} : { pruning: message.pruning },
      category: classifyMessage(message),
      source: messageSourceLabel(
        message,
        message.toolCallId === undefined ? undefined : context.resolveToolName?.(message.toolCallId),
      ),
      ...toolCalls.length > 0 ? { toolCalls } : {},
      preview: previewMessage(message),
      full,
      chars: full.length,
      ...durationMs === undefined ? {} : { durationMs },
      ...message.isError === undefined ? {} : { isError: message.isError },
      ...message.toolCallId === undefined ? {} : { toolCallId: message.toolCallId },
      ...sourceTurn === undefined ? {} : { sourceTurn },
      freshness,
    }
    ;(freshness === 'history' ? history : added).push(item)
  })

  const tools: ToolDefItem[] = (input.tools ?? []).map(tool => {
    const parameters = JSON.stringify(tool.parameters, null, 1)
    return {
      name: tool.name,
      description: tool.description,
      parameters,
      chars: tool.name.length + tool.description.length + parameters.length,
      added: context.previous !== undefined && !previousToolNames.has(tool.name),
    }
  })

  const totalChars = system.reduce((n, item) => n + item.chars, 0)
    + tools.reduce((n, item) => n + item.chars, 0)
    + history.reduce((n, item) => n + item.chars, 0)
    + added.reduce((n, item) => n + item.chars, 0)

  return {
    system,
    tools,
    history,
    added,
    fingerprint: {
      messageKeys: keys,
      toolNames: (input.tools ?? []).map(tool => tool.name),
      ...input.systemSlot === undefined ? {} : { systemSlot: input.systemSlot },
    },
    totalChars,
  }
}

/** Match occurrences, preserving unchanged tails across surface replacements. */
function messageFreshness(keys: readonly string[], previous?: ScopeFingerprint): SegmentItem['freshness'][] {
  const remaining = new Map<string, number>()
  for (const key of previous?.messageKeys ?? []) remaining.set(key, (remaining.get(key) ?? 0) + 1)
  return keys.map(key => {
    const count = remaining.get(key) ?? 0
    if (count > 0) remaining.set(key, count - 1)
    return count > 0 ? 'history' : 'new'
  })
}

/** A late log backfill can supply the baseline that was missing at capture. */
export function rebaseSegments(segments: CapturedRequest['segments'], current: ScopeFingerprint, previous: ScopeFingerprint): CapturedRequest['segments'] {
  const freshness = messageFreshness(current.messageKeys, previous)
  const refresh = (item: SegmentItem): SegmentItem => ({ ...item, freshness: item.index === -1
    ? current.systemSlot === previous.systemSlot ? 'history' : 'new'
    : freshness[item.index] ?? item.freshness })
  const messages = [...segments.history, ...segments.added].sort((a, b) => a.index - b.index).map(refresh)
  const tools = new Set(previous.toolNames)
  return {
    system: segments.system.map(refresh),
    tools: segments.tools.map(tool => ({ ...tool, added: !tools.has(tool.name) })),
    history: messages.filter(item => item.freshness === 'history'),
    added: messages.filter(item => item.freshness === 'new'),
  }
}

/** Attribute one system message to assembly sections when its text matches a rendered assembly exactly. */
function attributeSystem(
  message: CapturedMessage,
  index: number,
  freshness: SegmentItem['freshness'],
  assemblies: readonly AssemblyRecord[],
): SegmentItem[] {
  const full = serializeMessage(message)
  for (let i = assemblies.length - 1; i >= 0; i -= 1) {
    const assembly = assemblies[i]
    if (assembly === undefined || assembly.rendered !== full || assembly.sections.length === 0) continue
    return assembly.sections.map(section => ({
      index,
      ...message.id === undefined ? {} : { messageId: message.id },
      ...message.compactionId === undefined ? {} : { compactionId: message.compactionId },
      ...message.pruning === undefined ? {} : { pruning: message.pruning },
      category: 'system' as const,
      source: section.name,
      preview: previewLine(section.text),
      full: section.text,
      chars: section.text.length,
      ...message.isError === undefined ? {} : { isError: message.isError },
      ...message.toolCallId === undefined ? {} : { toolCallId: message.toolCallId },
      ...message.sourceTurn === undefined ? {} : { sourceTurn: message.sourceTurn },
      freshness,
    }))
  }
  return [{
    index,
    category: 'system',
    source: message.sourceKind,
    preview: previewLine(full),
    full,
    chars: full.length,
    freshness,
  }]
}

/** FNV-1a 32-bit — enough to keep id-less messages diffable, no crypto import needed. */
export function contentHash(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
