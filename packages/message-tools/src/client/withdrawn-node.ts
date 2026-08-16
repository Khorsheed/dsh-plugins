/**
 * Withdrawal projection on the chat node store: the Definition that claims
 * message-tools replacement events into divider rows, the Definitions that
 * claim message-tools restore events into replayed rows (user-message bubbles
 * and assistant-text lines), the Definition that claims edit replacements
 * into edited bubbles, plus the pure folds the renderers use (hidden spans,
 * span counts, read-only replay entries). The assembler matches every
 * Definition per event and offers no suppression seam; hiding happens in the
 * renderers and the DOM hider.
 */
import type {
  ChatConversationViewNode, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  isMessageToolsEdit, isMessageToolsReplacement, isMessageToolsRestore, isMessageToolsRestoreAssistant,
  stripRestoreAssistantFrame,
} from '../marker.ts'

/** Chat node data of one withdrawal divider row. */
export interface WithdrawnDividerData {
  /** Seq of the replacement event; the divider anchors here and the hidden span ends (exclusive). */
  readonly seq: number
  /** First hidden seq: the withdrawn user message itself. */
  readonly hiddenStartSeq: number
}

/** Chat node data of one edited-message bubble row (the edit replacement itself). */
export interface EditedMessageData {
  /** Seq of the edit replacement event; the bubble anchors here and the hidden span ends (exclusive). */
  readonly seq: number
  /** Unix epoch ms from the edit replacement event. */
  readonly time: number
  /** The edited content (what the model now reads in place). */
  readonly content: readonly unknown[]
  /** First hidden seq: the pre-edit message the replacement covers. */
  readonly hiddenStartSeq: number
}

/** Chat node data of one restored (replayed at the tail) user message. */
export interface RestoredMessageData {
  /** Seq of the restore event. */
  readonly seq: number
  /** Unix epoch ms from the restore event. */
  readonly time: number
  /** Seq of the withdrawn original this replays, when cited. */
  readonly restoredFromSeq: number | undefined
  /** The replayed content blocks (verbatim — images included). */
  readonly content: readonly unknown[]
  /** The original text, replayed verbatim. */
  readonly text: string
}

/** Chat node data of one restored assistant-text replay line. */
export interface RestoredAssistantMessageData {
  /** Seq of the restore-assistant replay event. */
  readonly seq: number
  /** Unix epoch ms from the replay event. */
  readonly time: number
  /** Seq of the withdrawn assistant message this replays, when cited. */
  readonly restoredFromSeq: number | undefined
  /** The assistant reply text (model-facing frame stripped for display). */
  readonly text: string
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** message-tools withdrawal divider marking where a span was hidden. */
    'message-tools-withdrawn': WithdrawnDividerData
    /** message-tools restore row: a withdrawn user message replayed at the tail. */
    'message-tools-restored': RestoredMessageData
    /** message-tools restore line: a withdrawn assistant reply's text replayed at the tail. */
    'message-tools-restored-assistant': RestoredAssistantMessageData
    /** message-tools edit row: the edit replacement rendered as the edited bubble in place. */
    'message-tools-edited': EditedMessageData
  }
}

/**
 * The withdrawal divider Definition: one single-event Context per
 * message-tools replacement event, anchored at the replacement's seq so the
 * divider sits exactly where the span was hidden.
 */
export const withdrawnDividerDefinition: ConversationNodeDefinition<WithdrawnDividerData> = {
  kind: 'message-tools-withdrawn',
  target: 'chat',
  match: event => isMessageToolsReplacement(event)
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match) => {
    const event = match.event
    if (!isMessageToolsReplacement(event)) {
      throw new Error('message-tools-withdrawn start requires a message-tools replacement event')
    }
    return { seq: event.seq, hiddenStartSeq: event.surfaceOp.start }
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined
    ? null
    : {
      key: context.key,
      kind: 'message-tools-withdrawn',
      id: context.id,
      target: 'chat',
      anchorSeq: context.state.seq,
      location: context.start?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: context.state,
    },
}

/**
 * The edited-bubble Definition: one single-event Context per message-tools
 * edit replacement event — the replacement's content IS the edited text, so
 * the row renders as a normal user bubble (with an「已编辑」badge) exactly
 * where the span was discarded.
 */
export const editedMessageDefinition: ConversationNodeDefinition<EditedMessageData> = {
  kind: 'message-tools-edited',
  target: 'chat',
  match: event => isMessageToolsEdit(event)
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match) => {
    const event = match.event
    if (!isMessageToolsEdit(event)) {
      throw new Error('message-tools-edited start requires a message-tools edit replacement event')
    }
    return {
      seq: event.seq,
      time: event.time,
      content: event.data.content,
      hiddenStartSeq: event.surfaceOp.start,
    }
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined
    ? null
    : {
      key: context.key,
      kind: 'message-tools-edited',
      id: context.id,
      target: 'chat',
      anchorSeq: context.state.seq,
      location: context.start?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: context.state,
    },
}

/**
 * Fold the hidden seq spans out of the live chat nodes, flattened to
 * `[start, endExclusive, ...]` pairs ordered by start. Both withdrawal
 * dividers and edit bubbles carry `{ seq, hiddenStartSeq }` spans. The flat
 * number array keeps the useSession selector stable under shallowEqual until
 * a withdrawal or edit lands.
 * @param nodes - every materialized chat node (any order).
 * @returns the flattened hidden spans.
 */
export function foldHiddenRanges(nodes: readonly ChatConversationViewNode[]): number[] {
  const pairs: Array<[number, number]> = []
  for (const node of nodes) {
    if (node.kind !== 'message-tools-withdrawn' && node.kind !== 'message-tools-edited') continue
    const data = node.data as WithdrawnDividerData
    pairs.push([data.hiddenStartSeq, data.seq])
  }
  pairs.sort((left, right) => left[0] - right[0])
  return pairs.flat()
}

/** Join text blocks into one plain string. */
function joinText(blocks: readonly unknown[]): string {
  return blocks
    .filter((block): block is { type: string; text: string } =>
      (block as { type?: string; text?: string }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string')
    .map(block => block.text)
    .join('')
}

/** Join AssistantBlock text (kind-keyed, unlike message content's type-keyed blocks). */
function joinAssistantText(blocks: readonly unknown[]): string {
  return blocks
    .filter((block): block is { kind: string; text: string } =>
      (block as { kind?: string; text?: unknown }).kind === 'text'
      && typeof (block as { text?: unknown }).text === 'string')
    .map(block => block.text)
    .join('')
}

/**
 * The restore-row Definition: one single-event Context per message-tools
 * user-message restore event (append-surface, plugin-tagged), replaying the
 * withdrawn message's content at the tail.
 */
export const restoredMessageDefinition: ConversationNodeDefinition<RestoredMessageData> = {
  kind: 'message-tools-restored',
  target: 'chat',
  match: event => isMessageToolsRestore(event)
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match) => {
    const event = match.event
    if (!isMessageToolsRestore(event)) {
      throw new Error('message-tools-restored start requires a message-tools restore event')
    }
    return {
      seq: event.seq,
      time: event.time,
      restoredFromSeq: event.sourceEventSeqs?.[0],
      content: event.data.content,
      text: joinText(event.data.content),
    }
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined
    ? null
    : {
      key: context.key,
      kind: 'message-tools-restored',
      id: context.id,
      target: 'chat',
      anchorSeq: context.state.seq,
      location: context.start?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: context.state,
    },
}

/**
 * The restore-assistant-line Definition: one single-event Context per
 * message-tools assistant-text restore replay (append-surface, op
 * 'restore-assistant'), rendering the reply text at the tail. The
 * model-facing frame is stripped for display — it belongs to the model
 * context, not the transcript row.
 */
export const restoredAssistantMessageDefinition: ConversationNodeDefinition<RestoredAssistantMessageData> = {
  kind: 'message-tools-restored-assistant',
  target: 'chat',
  match: event => isMessageToolsRestoreAssistant(event)
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match) => {
    const event = match.event
    if (!isMessageToolsRestoreAssistant(event)) {
      throw new Error('message-tools-restored-assistant start requires a restore-assistant replay event')
    }
    return {
      seq: event.seq,
      time: event.time,
      restoredFromSeq: event.sourceEventSeqs?.[0],
      text: stripRestoreAssistantFrame(joinText(event.data.content)),
    }
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined
    ? null
    : {
      key: context.key,
      kind: 'message-tools-restored-assistant',
      id: context.id,
      target: 'chat',
      anchorSeq: context.state.seq,
      location: context.start?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: context.state,
    },
}

/**
 * Count the chat nodes hidden by one withdrawn span (every kind except the
 * divider itself).
 * @param nodes - every materialized chat node.
 * @param startSeq - first hidden seq (inclusive).
 * @param endSeq - the divider's seq (exclusive).
 * @returns the hidden node count.
 */
export function countHiddenInSpan(
  nodes: readonly ChatConversationViewNode[],
  startSeq: number,
  endSeq: number,
): number {
  let count = 0
  for (const node of nodes) {
    if (node.kind === 'message-tools-withdrawn') continue
    if (node.anchorSeq >= startSeq && node.anchorSeq < endSeq) count += 1
  }
  return count
}

/** One read-only replay entry of the divider's expand area. */
export interface WithdrawnEntry {
  /** Source node kind ('user' original or 'assistant-step' summary). */
  readonly kind: 'user' | 'assistant'
  /** The entry's text (full for user originals, a text join for assistant steps). */
  readonly text: string
}

/**
 * Collect the read-only replay of one withdrawn span: user originals and
 * assistant text, in anchor order. Other kinds carry no user-readable text
 * and are skipped. Assistant-step data is kind-keyed (`data.blocks`, with
 * `data.finalNode.blocks` once settled — `conversation-nodes/assistant.ts`),
 * not type-keyed like message content. Reads the live node store — call from
 * event handlers.
 * @param nodes - every materialized chat node.
 * @param startSeq - first hidden seq (inclusive).
 * @param endSeq - the divider's seq (exclusive).
 * @returns the replay entries.
 */
export function collectWithdrawnEntries(
  nodes: readonly ChatConversationViewNode[],
  startSeq: number,
  endSeq: number,
): WithdrawnEntry[] {
  const inSpan = nodes
    .filter(node => node.anchorSeq >= startSeq && node.anchorSeq < endSeq)
    .sort((left, right) => left.anchorSeq - right.anchorSeq)
  const entries: WithdrawnEntry[] = []
  for (const node of inSpan) {
    if (node.kind === 'user' || node.kind === 'steering') {
      const content = (node.data as { content?: readonly unknown[] }).content ?? []
      const text = joinText(content)
      if (text !== '') entries.push({ kind: 'user', text })
      continue
    }
    if (node.kind === 'assistant-step') {
      const data = node.data as {
        blocks?: readonly unknown[]
        finalNode?: { blocks?: readonly unknown[] }
      }
      const text = joinAssistantText(data.finalNode?.blocks ?? data.blocks ?? [])
      if (text !== '') entries.push({ kind: 'assistant', text })
    }
  }
  return entries
}

/**
 * Whether one withdrawn span has a LIVE restore row (a restored node citing
 * the span's first hidden seq and not itself inside a hidden span). When the
 * restore rows are withdrawn again, the badge clears and the divider's
 * restore action re-enables — the restore events stay in the log either way.
 * @param nodes - every materialized chat node.
 * @param hiddenStartSeq - the span's first hidden seq.
 * @param ranges - the flattened hidden spans from foldHiddenRanges.
 * @returns true when a live restore row for the span exists.
 */
export function hasRestoreForSpan(
  nodes: readonly ChatConversationViewNode[],
  hiddenStartSeq: number,
  ranges: readonly number[],
): boolean {
  return nodes.some(node =>
    node.kind === 'message-tools-restored'
    && (node.data as RestoredMessageData).restoredFromSeq === hiddenStartSeq
    && !isSeqHidden(ranges, node.anchorSeq))
}

/**
 * Whether a node seq falls inside a hidden span.
 * @param ranges - the flattened spans from foldHiddenRanges.
 * @param seq - the node seq to test.
 * @returns true when the seq is hidden.
 */
export function isSeqHidden(ranges: readonly number[], seq: number): boolean {
  for (let index = 0; index + 1 < ranges.length; index += 2) {
    const start = ranges[index]
    const end = ranges[index + 1]
    if (start !== undefined && end !== undefined && seq >= start && seq < end) return true
  }
  return false
}
