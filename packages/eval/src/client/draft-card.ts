/**
 * The experiment card on the `eval_plan_draft` tool row (I5·T76 · D3), as
 * data: what one tool block says about the experiment it drafted, and the
 * channel the card's one action goes through.
 *
 * The card reads the call's OWN block — the arguments the agent sent and the
 * `EvalDraftResult` the tool answered — so a card for a call made days ago
 * still names the experiment that call made. Only the status is live (the lab
 * list's row, read when the card mounts), because the status is the one thing
 * that has moved since.
 *
 * The result carries two absolute paths (`planPath`, `conditionPaths`). The
 * model never reads them out of here: they are not in {@link DraftCardModel}
 * at all, so nothing downstream can render one (ui-spec §九).
 * @module @khorsheed/dsh-eval/client
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * The owner props of the host's keyed `tool.call.toolview` slot that this
 * card reads, structurally. The slot is declared by
 * `@deepseek-ai/dsh-client-ui-tool`, which this package does not depend on
 * (the card is additive: without that package no row renders, and nothing
 * here is reached); the fields below are the subset of its
 * `ToolCallOwnerProps` / `ToolCallBlock` the card touches.
 */
export interface DraftToolBlock {
  /** Settled form only. */
  kind?: string
  /** Running form: the wire tool name and the raw arguments. */
  name?: string
  argsRaw?: string
  /** Settled form: the call as sent, the result content, the error flag. */
  call?: { name: string; argsRaw: string } | null
  content?: ReadonlyArray<{ type: string; text?: string }>
  isError?: boolean
}

/** What the card shows, and nothing it must not. */
export interface DraftCardModel {
  /** `running` — no result yet; `failed` — the tool answered an error; `unreadable` — no experiment in the result. */
  state: 'running' | 'failed' | 'unreadable' | 'ready'
  experimentId: string | null
  /** The name the agent gave; the id's slug when the arguments carry none. */
  name: string | null
  /** The person's question, verbatim (protocol v1-rev14); null when the draft carries none. */
  question: string | null
  items: number | null
  conditions: number | null
  reps: number | null
  /** `<registration>/<set> @ <short commit>`; null when the result names no dataset. */
  dataset: string | null
  /** validate's error count on what was written. */
  errors: number
}

/** Parse a JSON object out of a string, or nothing. */
function objectOf(text: string | undefined): Record<string, unknown> | null {
  if (text === undefined || text.trim() === '') return null
  try {
    const value: unknown = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null)
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const len = (value: unknown): number | null => (Array.isArray(value) ? value.length : null)

/** The experiment id's slug — the name, lower-cased, as the lab list's draft notice reads it. */
export function slugOf(experimentId: string): string {
  return experimentId.replace(/-\d{8}-[0-9a-f]{4}$/, '')
}

/**
 * Read one `eval_plan_draft` block into the card.
 * @param block - the running call or its settled result node.
 * @returns the card's model; never a path.
 */
export function draftCardOf(block: DraftToolBlock): DraftCardModel {
  const settled = block.kind === 'tool-result'
  const args = objectOf(settled ? block.call?.argsRaw : block.argsRaw) ?? {}
  const empty: DraftCardModel = {
    state: 'running',
    experimentId: null,
    name: str(args['name']),
    question: str(args['question']),
    items: len(args['items']),
    conditions: len(args['conditions']),
    reps: num(args['reps']),
    dataset: null,
    errors: 0,
  }
  if (!settled) return empty
  if (block.isError === true) return { ...empty, state: 'failed' }
  const text = (block.content ?? []).find(part => part.type === 'text')?.text
  const result = objectOf(text)
  const experimentId = str(result?.['experimentId'])
  if (result === null || experimentId === null) return { ...empty, state: 'unreadable' }
  const review = (result['review'] ?? {}) as Record<string, unknown>
  const digest = (review['digest'] ?? null) as Record<string, unknown> | null
  const dataset = (result['dataset'] ?? null) as Record<string, unknown> | null
  const registry = str(dataset?.['registry'])
  const set = str(dataset?.['set'])
  const commit = str(dataset?.['commit'])
  const pin = registry !== null && set !== null ? `${registry}/${set}` : set ?? registry
  // The plan as written wins over the arguments: validate read the file, and
  // the draft verb fills defaults the agent left out (reps, the item list).
  return {
    state: 'ready',
    experimentId,
    name: empty.name ?? slugOf(experimentId),
    question: str(digest?.['question']) ?? empty.question,
    items: len(digest?.['items']) ?? empty.items,
    conditions: len(result['conditions']) ?? len(digest?.['conditions']) ?? empty.conditions,
    reps: num(digest?.['reps']) ?? empty.reps,
    dataset: pin === null ? null : (commit === null ? pin : `${pin} @ ${commit.slice(0, 7)}`),
    errors: num(review['errors']) ?? 0,
  }
}

/**
 * The card's one action, carried to the lab tab.
 *
 * The host has no way for a plugin to switch the conversation's tab: the
 * `dsh.conversation` store's `openView` is injected into the conversation
 * frame and the tab header only, and a tool row can reach neither. So the
 * card asks, and the lab view — when it is mounted, or the next time it is —
 * TAKES the request: back to the list, 全部 when the row is outside this
 * session's scope, and that row marked. The person switches the tab.
 */
export interface LabFocus {
  /** Ask the lab view of `sessionId` to mark this experiment. */
  request: (sessionId: SessionId, experimentId: string) => void
  /** Take (and clear) the pending request for `sessionId`, if any. */
  take: (sessionId: SessionId) => string | null
  /** Called on every request; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void
}

/** A plugin-lifetime focus channel. */
export function createLabFocus(): LabFocus {
  const pending = new Map<SessionId, string>()
  const listeners = new Set<() => void>()
  return {
    request(sessionId, experimentId) {
      pending.set(sessionId, experimentId)
      for (const listener of [...listeners]) listener()
    },
    take(sessionId) {
      const experimentId = pending.get(sessionId) ?? null
      pending.delete(sessionId)
      return experimentId
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
