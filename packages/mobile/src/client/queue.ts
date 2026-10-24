/** Text-carrying block face mobile reads; attachment blocks are passed through opaquely. */
export interface QueueContentBlock {
  readonly type: string
  readonly text?: string
}

/**
 * dsh-agent's inbox projection value, duck-typed to what mobile reads: the
 * typed `UserMessage` face (`InboxState`) lives outside this package's compile
 * closure — the projection's declared wire value is `JsonValue` rows. Rows
 * carry `id`/`content`/`source`; a browser-submitted row echoes its prompt RPC
 * identity as `rpcId` on a `kind: 'user'` source.
 */
export interface MobileInboxState {
  readonly 'next-turn'?: readonly {
    readonly id: string
    readonly content: readonly QueueContentBlock[]
    readonly source: { readonly kind: string }
  }[]
}

/** One queued prompt, read off the inbox projection. */
export interface QueueRow {
  readonly id: string
  /** Prompt-RPC correlation of a browser-submitted row; opaque wire identity. */
  readonly rpcId?: unknown
  /** Full text of an all-text row, null when attachments make it uneditable. */
  readonly text: string | null
  readonly content: readonly QueueContentBlock[]
}

/** All-text join, or null when any block is not text (the official QueueDock's edit rule). */
export function queueText(content: readonly QueueContentBlock[]): string | null {
  return content.every(block => block.type === 'text') ? content.map(block => block.text ?? '').join('') : null
}

/** Queued prompts: the inbox projection's `next-turn` rows (already the queued placement). */
export function queuedRows(inbox: MobileInboxState | undefined): readonly QueueRow[] {
  return (inbox?.['next-turn'] ?? []).map(row => ({
    id: row.id,
    ...(row.source.kind === 'user' && 'rpcId' in row.source ? { rpcId: row.source.rpcId } : {}),
    text: queueText(row.content),
    content: row.content,
  }))
}
