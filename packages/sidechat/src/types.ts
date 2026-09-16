/**
 * Shared vocabulary of the side chat (侧边对话): the opaque ref protocol, the
 * host-side service contract (`ctx.sideChat.openWith`), the Remote wire
 * payloads, the persisted contexts document, and the pure helpers both faces
 * share. The plugin knows NOTHING about any consumer's types: a ref is an
 * opaque `{ label, text }` chunk, a contextKey is an unparsed string, and no
 * consumer's name appears anywhere in this package.
 *
 * Runtime-agnostic on purpose: no `node:path`, no DOM. Every helper here is
 * pure and unit-tested.
 *
 * @module @khorsheed/dsh-sidechat/types
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** One opaque quoted chunk: a label for the chip, the text for the model. */
export interface SideChatRef {
  readonly label: string
  readonly text: string
}

/** Longest ref label, in code units — the chip renders it on one line. */
export const MAX_REF_LABEL_LENGTH = 40

/** Pending refs one context holds; the cap keeps a runaway consumer honest. */
export const MAX_REFS_PER_CONTEXT = 20

/**
 * The cross-plugin seam's input (`ctx.sideChat.openWith`). `tools` are
 * host-side objects handed over IN-PROCESS — they never cross the Remote
 * wire, which is deliberate: only same-process plugins can supply them, and
 * their origin tagging is the CALLER's responsibility (side-chat never tags
 * on a caller's behalf).
 */
export interface SideChatOpenInput {
  /** The consumer's opaque context identity (`canvas:<id>`-style prefixes are the consumer's convention). */
  readonly contextKey: string
  /** Display label for the tab header and the context list. */
  readonly label: string
  /** Extra system-prompt segment, refreshed per turn on every call (never a create-time snapshot). */
  readonly systemPrompt?: string
  /** Caller-supplied model tools, attached to this context's agent at creation (and live-replaced by name). */
  readonly tools?: readonly ToolDefinition[]
  /** Refs to queue above the composer; folded into the next sent message. */
  readonly refs?: readonly SideChatRef[]
}

/* ------------------------------------------------------------------ wire */

/** One projected transcript row: user and assistant text, tool calls folded to a one-line status. */
export type SideChatTranscriptRow =
  | { readonly kind: 'user'; readonly text: string; readonly time: number }
  | { readonly kind: 'assistant'; readonly text: string; readonly time: number }
  | { readonly kind: 'tool'; readonly name: string; readonly state: SideChatToolState; readonly time: number }

/** A tool call's folded state, resolved by pairing `tool/result` in the journal. */
export type SideChatToolState = 'running' | 'done' | 'error'

/**
 * One context's lifecycle as the client sees it: `new` (nothing sent yet),
 * `cold` (a persisted session, no live agent), or the live agent's own
 * `idle` / `running`.
 */
export type SideChatStatus = 'new' | 'cold' | 'idle' | 'running'

/** One context's full presentation state (`getState`). */
export interface SideChatState {
  readonly contextKey: string
  readonly label: string
  readonly status: SideChatStatus
  /** Pending refs — the chips above the composer, folded into the next send. */
  readonly refs: readonly SideChatRef[]
  readonly transcript: readonly SideChatTranscriptRow[]
}

/** Domain error vocabulary shared by every mutating verb. */
export type SideChatError =
  | 'not-found'
  | 'message-not-found'
  | 'empty'
  | 'agent-unavailable'
  | 'io'

/** `getState` outcome: `not-found` means the context has no record yet (the client renders the empty state). */
export type SideChatStateOutcome =
  | { readonly ok: true; readonly state: SideChatState }
  | { readonly ok: false; readonly error: 'not-found' }

/** One row of the context list (`listContexts`). */
export interface SideChatContextSummary {
  readonly contextKey: string
  readonly label: string
  readonly status: SideChatStatus
  /** Pending-ref count. */
  readonly refs: number
  /** ISO timestamp of the last record change (list ordering). */
  readonly updatedAt: string
}

/** `listContexts` result. */
export interface SideChatListResult {
  readonly items: readonly SideChatContextSummary[]
}

/** `send` request: the text, one-shot refs, and the label a first send records. */
export interface SideChatSendRequest {
  readonly contextKey: string
  readonly text: string
  readonly label?: string
  readonly refs?: readonly SideChatRef[]
}

/** `send` outcome: the fresh state on success (already `running`). */
export type SideChatSendOutcome =
  | { readonly ok: true; readonly state: SideChatState }
  | { readonly ok: false; readonly error: SideChatError }

/**
 * `quoteMessage` request: the assistant message to land as a ref on the side
 * chat bound to the CALLING session (contextKey = the calling session's id —
 * the wire carries no session of its own).
 */
export interface SideChatQuoteRequest {
  readonly messageId: string
  /** Display label a first quote records (the client passes the session's display name). */
  readonly label?: string
}

/** `quoteMessage` outcome: the bound contextKey and the pending-ref count. */
export type SideChatQuoteOutcome =
  | { readonly ok: true; readonly contextKey: string; readonly refs: number }
  | { readonly ok: false; readonly error: SideChatError }

/* ------------------------------------------------------- persisted document */

/** One context's durable record in `contexts.json`. */
export interface SideChatContextRecord {
  readonly contextKey: string
  readonly label: string
  /** The bound agent session, absent until the first send creates it (lazy creation). */
  readonly sessionId?: string
  /** The latest consumer-supplied system-prompt segment (per-turn freshness: re-read at every assembly). */
  readonly segment?: string
  /** The agent preset resolved at creation, replayed at cold resume. */
  readonly agentPreset?: string
  /** Pending refs, folded into the next sent message and cleared. */
  readonly refs: readonly SideChatRef[]
  readonly createdAt: string
  readonly updatedAt: string
}

/** The whole state file: one version-guarded JSON document. */
export interface SideChatContextsDoc {
  readonly version: 1
  readonly contexts: readonly SideChatContextRecord[]
}

/** The plugin's directory under the deployment state root. */
export const SIDECHAT_STATE_DIR_NAME = 'sidechat'

/** The mapping document's file name inside the state dir. */
export const SIDECHAT_CONTEXTS_FILE_NAME = 'contexts.json'

/** An empty mapping document. */
export function emptyContextsDoc(): SideChatContextsDoc {
  return { version: 1, contexts: [] }
}

/** A value is a usable ref when both fields are strings (text may be empty-labelled, never empty-bodied). */
function isRef(value: unknown): value is SideChatRef {
  if (typeof value !== 'object' || value === null) return false
  const ref = value as Record<string, unknown>
  return typeof ref['label'] === 'string' && typeof ref['text'] === 'string'
}

/** A value is a usable record when the identity fields hold; the rest defaults tolerantly. */
function isRecord(value: unknown): value is SideChatContextRecord {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record['contextKey'] === 'string' && record['contextKey'] !== ''
    && typeof record['label'] === 'string'
    && (record['sessionId'] === undefined || typeof record['sessionId'] === 'string')
    && (record['segment'] === undefined || typeof record['segment'] === 'string')
    && (record['agentPreset'] === undefined || typeof record['agentPreset'] === 'string')
    && Array.isArray(record['refs'])
    && typeof record['createdAt'] === 'string' && typeof record['updatedAt'] === 'string'
}

/**
 * The tolerant reader: malformed entries drop out, missing collections
 * default, and a document that is not an object at all reads as empty — the
 * store refuses a corrupt file BEFORE this runs, so what lands here is
 * JSON-valid but possibly hand-edited.
 */
export function normalizeContextsDoc(value: unknown): SideChatContextsDoc {
  if (typeof value !== 'object' || value === null) return emptyContextsDoc()
  const raw = (value as Record<string, unknown>)['contexts']
  if (!Array.isArray(raw)) return emptyContextsDoc()
  const contexts: SideChatContextRecord[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    contexts.push({ ...entry, refs: entry.refs.filter(isRef) })
  }
  return { version: 1, contexts }
}

/* ------------------------------------------------------------------ helpers */

/**
 * Derive a chip label from a quoted text: the first non-empty line,
 * whitespace-collapsed, truncated with an ellipsis. Used for quoted messages
 * whose source carries no better name.
 * @param text - the quoted body.
 * @returns a label no longer than {@link MAX_REF_LABEL_LENGTH}.
 */
export function refLabelOf(text: string): string {
  const line = (text.split('\n').find(part => part.trim() !== '') ?? '').replace(/\s+/g, ' ').trim()
  if (line === '') return '…'
  return line.length <= MAX_REF_LABEL_LENGTH ? line : `${line.slice(0, MAX_REF_LABEL_LENGTH - 1)}…`
}

/**
 * Fold pending refs and the user's text into one model-facing message. Refs
 * travel as `<quoted_context>` blocks — an explicit, model-friendly spelling
 * that keeps the opaque chunk opaque (the plugin never parses it).
 */
export function foldRefsIntoText(refs: readonly SideChatRef[], text: string): string {
  if (refs.length === 0) return text
  const blocks = refs.map(ref => `<quoted_context label=${JSON.stringify(ref.label)}>\n${ref.text}\n</quoted_context>`)
  return `${blocks.join('\n\n')}\n\n${text}`
}

/**
 * The orientation segment every side-chat agent carries beneath a consumer's
 * own segment: what a side chat IS, and how to read quoted context.
 * Model-facing, so it follows the harness prompt convention (English).
 */
export const SIDECHAT_DEFAULT_SEGMENT = [
  'You are the user\'s side-chat agent (侧边对话): a lightweight companion conversation that runs beside',
  'their main conversation and shares its working directory. Answer concisely, stay on the side topic,',
  'and never continue the main conversation\'s tasks. Blocks marked <quoted_context> are excerpts the',
  'user quoted from elsewhere; treat them as read-only reference material.',
].join(' ')

/** The agent-scoped prompt section's name (one per context's agent). */
export const SIDECHAT_SECTION_NAME = 'sidechat:context'

/**
 * The section's order: after the deployment persona suffix (10200), so the
 * side orientation and the consumer's segment close the system prompt.
 */
export const SIDECHAT_SECTION_ORDER = 10300
