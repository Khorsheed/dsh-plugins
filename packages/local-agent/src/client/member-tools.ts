/**
 * Member tools: what another plugin draws beside a CLI member's context
 * occupancy (the compaction reminder's 「⚠ 压缩」 and its per-member ratio),
 * and the shared occupancy poll behind them.
 *
 * A registry on the localAgentUi service, like the harness cards: the member
 * composer and the room render the same entries through
 * `renderMemberTools`, and a registrant (context-guard) probes
 * `registerMemberTool` at apply time — neither package depends on the other.
 * The face is plain data plus one action, so a registrant can declare its
 * shape structurally without importing this package.
 * @module @khorsheed/dsh-local-agent/client — member tools
 */

import type { ReactNode } from 'react'
import type { LocalAgentMemberContext } from '@khorsheed/dsh-local-agent/types'

/**
 * Where a member tool renders:
 * - `composer`: inside the member's input box (the coordinator's, in a room);
 * - `row`: on the member's row in the room's members popup;
 * - `panel`: inside the occupancy ring's click-open panel;
 * - `dot`: a bare attention mark (the room's members chip).
 */
export type MemberToolPlacement = 'composer' | 'row' | 'panel' | 'dot'

/** What a member tool reads. */
export interface MemberToolFace {
  readonly childSessionId: string
  /** The member's display name, when the host surface knows one (a room). */
  readonly memberName?: string | undefined
  /** The delegation provider (`kimi-cli`) and its harness (`kimi`), the harness's display name. */
  readonly provider: string
  readonly harness?: string | undefined
  readonly harnessDisplayName?: string | undefined
  /** Context occupancy as the CLI last reported it; absent until it reports. */
  readonly usedTokens?: number | undefined
  readonly contextWindow?: number | undefined
  /** usedTokens over contextWindow (0–1), when both are known. */
  readonly ratio?: number | undefined
  readonly state: LocalAgentMemberContext['state']
  readonly placement: MemberToolPlacement
  /** Compact the member: queues behind a running round, input sent meanwhile waits for it. */
  compact(): Promise<void>
}

/** One registered member tool. */
export interface MemberToolRegistration {
  /** Stable id; re-registering the same id replaces the entry. */
  readonly id: string
  /** Render for one member at one placement; null = nothing here. */
  readonly render: (face: MemberToolFace) => ReactNode
}

/** The registry behind `registerMemberTool` (service-held: every bundle inlines its own module copy). */
export class MemberToolRegistry {
  private readonly entries = new Map<string, MemberToolRegistration>()
  private readonly listeners = new Set<() => void>()
  private version = 0
  private list: readonly MemberToolRegistration[] = []

  /** Register one tool; the disposer removes only the entry it registered. */
  readonly register = (entry: MemberToolRegistration): (() => void) => {
    this.entries.set(entry.id, entry)
    this.bump()
    return () => {
      if (this.entries.get(entry.id) !== entry) return
      this.entries.delete(entry.id)
      this.bump()
    }
  }

  /** The registered tools, in registration order. */
  readonly tools = (): readonly MemberToolRegistration[] => this.list

  /** The mutation counter (useSyncExternalStore snapshot). */
  readonly snapshotVersion = (): number => this.version

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private bump(): void {
    this.version += 1
    this.list = [...this.entries.values()]
    for (const listener of [...this.listeners]) listener()
  }
}

/** The occupancy poll cadence (the member composer's delegation poll). */
export const MEMBER_CONTEXT_POLL_MS = 1_500

/**
 * One poll per member however many surfaces show it (a room's composer,
 * popup row and chip read the same member). A failed read keeps the last
 * known value; null = not a family member.
 */
export class MemberContextStore {
  private readonly members = new Map<string, {
    value: LocalAgentMemberContext | null | undefined
    listeners: Set<() => void>
    timer?: ReturnType<typeof setInterval>
  }>()

  constructor(private readonly read: (childSessionId: string) => Promise<LocalAgentMemberContext | null | undefined>) {}

  /** The last known reading (undefined = not read yet). */
  readonly get = (childSessionId: string): LocalAgentMemberContext | null | undefined =>
    this.members.get(childSessionId)?.value

  /** Read now (after a compaction request, say), outside the cadence. */
  readonly refresh = (childSessionId: string): void => {
    const entry = this.members.get(childSessionId)
    if (entry === undefined) return
    void this.read(childSessionId).then((value) => {
      if (value === undefined || sameContext(entry.value, value)) return
      entry.value = value
      for (const listener of [...entry.listeners]) listener()
    }, () => {})
  }

  /** Subscribe to one member; the poll runs while anyone listens. */
  readonly subscribe = (childSessionId: string, listener: () => void): (() => void) => {
    let entry = this.members.get(childSessionId)
    if (entry === undefined) this.members.set(childSessionId, entry = { value: undefined, listeners: new Set() })
    entry.listeners.add(listener)
    if (entry.timer === undefined) {
      this.refresh(childSessionId)
      entry.timer = setInterval(() => { this.refresh(childSessionId) }, MEMBER_CONTEXT_POLL_MS)
    }
    const held = entry
    return () => {
      held.listeners.delete(listener)
      if (held.listeners.size > 0 || held.timer === undefined) return
      clearInterval(held.timer)
      delete held.timer
    }
  }
}

function sameContext(a: LocalAgentMemberContext | null | undefined, b: LocalAgentMemberContext | null): boolean {
  if (a === undefined || a === null || b === null) return a === b
  return a.usedTokens === b.usedTokens && a.contextWindow === b.contextWindow && a.state === b.state
    && a.provider === b.provider && a.harness === b.harness
}

/**
 * The occupancy ratio, when both counts are known.
 * @param context - the member's reading.
 * @returns usedTokens / contextWindow clamped to 0–1, or undefined.
 */
export function contextRatio(context: Pick<LocalAgentMemberContext, 'usedTokens' | 'contextWindow'> | null | undefined): number | undefined {
  if (context?.usedTokens === undefined || context.contextWindow === undefined || context.contextWindow <= 0) return undefined
  return Math.min(1, Math.max(0, context.usedTokens / context.contextWindow))
}
