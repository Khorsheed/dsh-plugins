/**
 * The session-header chips' preset visibility (F1-5): the chips are
 * session-bound chrome (they answer "does THIS session's work have a gate
 * waiting"), so they follow docs/plugin-visibility.md's 第二层 rule — the
 * criterion is "can this session reach the story tools", with BOTH grant
 * paths enumerated (the canvas preset-visibility template, inlined per the
 * doc's keep-copies rule):
 *
 * 1. **Profile-root mount** of `@khorsheed/dsh-story-bible/agent` (a profile
 *    that re-enabled the shipped-disabled row): the inventory's `entries`
 *    carry it ENABLED → every session.
 * 2. **Preset mount** (the bundle-writing recipe): visible exactly when the
 *    CURRENT session's preset composition names the row.
 *
 * Every unreadable path fails OPEN (visible): no pluginInventory namespace,
 * a pending/failed RPC, a missing or broken preset group, a session with no
 * preset, the no-session home state.
 *
 * @module @khorsheed/dsh-story-bible/client/preset-visibility
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ctx.sessions service merge (ISessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** The criterion's row: the story tools/prompt composition entry. */
export const STORY_AGENT_ROW_MODULE = '@khorsheed/dsh-story-bible/agent'

/** Minimal structural mirror of the official pluginInventory snapshot (duck-typed, host-version tolerant). */
export interface StoryPluginInventorySnapshot {
  readonly entries?: readonly {
    readonly moduleName: string
    readonly enabled?: boolean
  }[]
  readonly agentPresets?: readonly {
    readonly id: string
    readonly broken?: string
    readonly rows: readonly {
      readonly moduleName: string
      readonly enabled?: boolean
    }[]
  }[]
}

/** The current session's agent preset, the dual read per host line. */
function presetOf(row: unknown): string | undefined {
  const value = (row as { projectionValues?: { agentPreset?: unknown }; agentPreset?: unknown } | undefined)
    ?.projectionValues?.agentPreset
    ?? (row as { agentPreset?: unknown } | undefined)?.agentPreset
  return typeof value === 'string' ? value : undefined
}

/**
 * The chips' visibility controller: one inventory fetch per page, re-evaluated
 * on every session switch.
 */
export class StoryChipVisibility {
  /** The inventory answer; null while pending/failed and on namespace-less hosts. */
  private composition: StoryPluginInventorySnapshot | null = null
  private readonly listeners = new Set<() => void>()

  /**
   * @param ctx - client root context.
   * @param pluginInventory - the OFFICIAL namespace, probed through ctx.get
   *   (never injected — declaring it would pend the whole client on a host
   *   without it, and the criterion must fail open there).
   */
  constructor(
    private readonly ctx: Context,
    pluginInventory: { list: () => Promise<RemoteResult<StoryPluginInventorySnapshot>> } | undefined,
  ) {
    if (pluginInventory !== undefined) {
      void pluginInventory.list().then(result => {
        if (!result.ok) return
        this.composition = result.value ?? null
        this.notify()
      }).catch(() => { /* an unreachable inventory reads as no data (fail-open) */ })
    }
    ctx.effect(
      () => ctx.sessions.list.subscribe(() => { this.notify() }),
      'story-bible: chip visibility session follower',
    )
  }

  show(sessionId: SessionId | undefined): boolean {
    if (this.composition === null) return true
    // Path 1: a root-mounted agent row grants the tools to every session.
    const rootRow = this.composition.entries?.find(row => row.moduleName === STORY_AGENT_ROW_MODULE)
    if (rootRow?.enabled === true) return true
    if (sessionId === undefined) return true
    const preset = presetOf(this.ctx.sessions.list.getSnapshot().byId[sessionId])
    if (preset === undefined) return true
    const group = this.composition.agentPresets?.find(candidate => candidate.id === preset)
    if (group === undefined || group.broken !== undefined) return true
    // Path 2: the preset-mounted row grants this session.
    return group.rows.some(row => row.moduleName === STORY_AGENT_ROW_MODULE && row.enabled !== false)
  }

  /** Subscribe to criterion-input changes (session switches, the inventory answer). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}
