/**
 * T96 · the card on the `datasets_propose_registration` tool row, as data:
 * what one call says about the proposal it filed (or the check it ran), the
 * channel the card's one action goes through, and the tab switch it tries.
 *
 * The card reads the call's OWN block — the arguments the agent sent and the
 * result the tool answered — so a card for a call made days ago still names
 * the proposal that call filed. Only whether it still waits is live (the
 * pending list, read when the card mounts).
 * @module @khorsheed/dsh-datasets/client
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * The owner props of the host's keyed `tool.call.toolview` slot this card
 * reads, structurally (the slot is declared by `@deepseek-ai/dsh-client-ui-tool`,
 * which this package does not depend on). Running forms carry `name` and,
 * once the arguments are complete, `argsRaw`; the settled form carries the
 * call, the result content and the error flag.
 */
export interface ProposeToolBlock {
  kind?: string
  phase?: string
  name?: string
  argsRaw?: string
  call?: { name: string; argsRaw: string } | null
  content?: ReadonlyArray<{ type: string; text?: string }>
  isError?: boolean
}

/** What the card shows. */
export interface ProposeCardModel {
  /**
   * `running` — no result yet; `failed` — the tool answered an error;
   * `checked` — a dry run (nothing filed, no button); `filed` — a proposal
   * waits for a person; `unreadable` — a result this card does not know.
   */
  state: 'running' | 'failed' | 'checked' | 'filed' | 'unreadable'
  /** The proposal id (filed only). */
  proposalId: string | null
  /** The registration name the agent proposed (from the arguments). */
  name: string | null
  kind: 'new' | 'update' | null
  /** Dry run: blocking problems found. */
  problems: number
  warnings: number
}

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
const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0)

/**
 * Read one `datasets_propose_registration` block into the card.
 * @param block - the running call or its settled result node.
 * @returns the card's model.
 */
export function proposeCardOf(block: ProposeToolBlock | null | undefined): ProposeCardModel {
  const base: ProposeCardModel = { state: 'unreadable', proposalId: null, name: null, kind: null, problems: 0, warnings: 0 }
  if (block === null || typeof block !== 'object') return base
  const settled = block.kind === 'tool-result'
  const args = objectOf(settled ? block.call?.argsRaw : block.argsRaw) ?? {}
  const named: ProposeCardModel = { ...base, state: 'running', name: str(args['registryId']) }
  if (!settled) return named
  if (block.isError === true) return { ...named, state: 'failed' }
  const result = objectOf((block.content ?? []).find(part => part.type === 'text')?.text)
  if (result === null) return { ...named, state: 'unreadable' }
  const kind = result['kind'] === 'update' ? 'update' : result['kind'] === 'new' ? 'new' : null
  const filed = str(result['filed'])
  if (filed !== null) return { ...named, state: 'filed', proposalId: filed, kind, warnings: count(result['warnings']) }
  if (typeof result['ok'] === 'boolean') {
    return { ...named, state: 'checked', kind, problems: count(result['problems']), warnings: count(result['warnings']) }
  }
  return { ...named, state: 'unreadable' }
}

/**
 * The card's action, carried to the 题集 tab of the same session.
 *
 * The host gives a plugin no call that switches the conversation's tab (the
 * `dsh.conversation` store's `openView` reaches the frame and the tab header
 * only). So the card leaves a request here, and the datasets view — mounted
 * now, or the next time it mounts — TAKES it and opens that proposal's
 * review directly, skipping the list and its banner.
 */
export interface ReviewFocus {
  request: (sessionId: SessionId, proposalId: string) => void
  /** Take (and clear) the pending request for `sessionId`, if any. */
  take: (sessionId: SessionId) => string | null
  /** Called on every request; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void
}

/** A plugin-lifetime focus channel. */
export function createReviewFocus(): ReviewFocus {
  const pending = new Map<SessionId, string>()
  const listeners = new Set<() => void>()
  return {
    request(sessionId, proposalId) {
      pending.set(sessionId, proposalId)
      for (const listener of [...listeners]) listener()
    },
    take(sessionId) {
      const id = pending.get(sessionId) ?? null
      pending.delete(sessionId)
      return id
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/**
 * Click the conversation's tab labelled `label`, from an element inside that
 * conversation — a DOM anchor (AGENTS.md: last resort, with a fallback): the
 * nearest ancestor that holds the host's `[data-conversation-tabs]` strip,
 * then the `role="tab"` button whose text is the label. The caller checks
 * the tab's `aria-selected` a moment later and says so in words when the
 * switch did not happen, so a host that renames the anchor costs a click,
 * never a crash.
 * @param from - an element rendered inside the conversation (the card).
 * @param label - the tab's visible label (the 题集 tab's own `t('open')`).
 * @returns the tab clicked (or already selected), or null when there is none.
 */
export function switchToTab(from: Element | null, label: string): HTMLElement | null {
  try {
    let node: Element | null = from
    while (node !== null) {
      const strip = node.querySelector('[data-conversation-tabs]')
      if (strip !== null) {
        const tab = [...strip.querySelectorAll('[role="tab"]')].find(button => button.textContent?.trim() === label)
        if (!(tab instanceof HTMLElement)) return null
        if (tab.getAttribute('aria-selected') !== 'true') tab.click()
        return tab
      }
      node = node.parentElement
    }
    return null
  } catch {
    return null
  }
}
