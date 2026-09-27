/**
 * The preset-composition visibility of the worktrees right-Sidebar tab — the
 * REGISTRATION-level sibling of the badge's component-level gate (Badge.tsx
 * returns null on the same criterion, while the tab TYPE must unregister:
 * the guide enumerates the registry, so hidden means not registered, and a
 * component returning null would leave a guide entry that opens nothing).
 * Host semantics make the toggle safe (ui-sidebar-right, 0.1.5): opened tabs
 * are stored per session, so an ungranted session's layout never held one,
 * and a kind with no registrant renders the designed `tab.unavailable`
 * fallback — "a real state, not a defect".
 *
 * The criterion itself is the badge's, verbatim: a configured
 * `visiblePresets` (non-empty) is the OVERRIDE; otherwise the OFFICIAL
 * composition data decides — the tab shows exactly when the current session's
 * preset composition names the `@khorsheed/dsh-worktrees/tool` row (the
 * mode-switcher proposal's "组合里有我的行": the preset composition file is
 * the single source of truth, no registry to maintain). Every unreadable
 * path fails OPEN (visible): no pluginInventory namespace, a pending/failed
 * RPC (config or inventory), a missing or `broken` preset group, a session
 * with no preset, and the no-session home state (a frame-level surface has
 * no preset input until a session exists — showing there is the neutral
 * state, not a leak).
 * @module @khorsheed/dsh-worktrees/client/preset-visibility
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ctx.sessions service merge (ISessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { BadgeConfig, PluginInventorySnapshot } from '../types.ts'

/**
 * The composition criterion's row: this package's `./tool` composition
 * entry, whose presence in the current session's preset composition keeps
 * the tab (and the badge) visible. (Until 0.2.x the row shipped as the
 * standalone companion package `@khorsheed/dsh-worktrees-tool`; 0.3.0 folded
 * it into this subpath.)
 */
export const WORKTREES_TOOL_ROW_MODULE = '@khorsheed/dsh-worktrees/tool'

/** The current session's agent preset, the dual read per host line. */
function presetOf(row: unknown): string | undefined {
  const value = (row as { projectionValues?: { agentPreset?: unknown }; agentPreset?: unknown } | undefined)
    ?.projectionValues?.agentPreset
    ?? (row as { agentPreset?: unknown } | undefined)?.agentPreset
  return typeof value === 'string' ? value : undefined
}

/**
 * The tab's visibility controller: one badge-config fetch and one inventory
 * fetch per page (composition data changes only with preset files, which a
 * reload re-reads anyway), re-evaluated by the toggle on every session
 * switch.
 */
export class WorktreesTabVisibility {
  /** The hand-configured override; null = no override, the composition decides. */
  private gate: readonly string[] | null = null
  /** The inventory answer; null while pending/failed and on namespace-less hosts. */
  private composition: PluginInventorySnapshot | null = null
  private readonly listeners = new Set<() => void>()

  /**
   * @param ctx - client root context.
   * @param pluginInventory - the OFFICIAL namespace, probed through ctx.get
   *   (never injected — declaring it would pend the whole client on a host
   *   without it, and the criterion must fail open there).
   * @param fetchBadgeConfig - the composition's `visiblePresets`, reaching the
   *   browser through the worktrees Remote (the web boot composes client
   *   entries without config).
   */
  constructor(
    private readonly ctx: Context,
    pluginInventory: { list: () => Promise<RemoteResult<PluginInventorySnapshot>> } | undefined,
    fetchBadgeConfig: () => Promise<RemoteResult<BadgeConfig>>,
  ) {
    void fetchBadgeConfig().then(result => {
      if (!result.ok) return
      const list = result.value?.visiblePresets ?? []
      this.gate = list.length > 0 ? list : null
      this.notify()
    }).catch(() => { /* an unreachable Remote reads as no gate (fail-open) */ })
    if (pluginInventory !== undefined) {
      void pluginInventory.list().then(result => {
        if (!result.ok) return
        this.composition = result.value
        this.notify()
      }).catch(() => { /* an unreachable inventory reads as no data (fail-open) */ })
    }
    // Session switches re-decide the tab type's registration (the guide
    // enumerates registrations, not components).
    ctx.effect(
      () => ctx.sessions.list.subscribe(() => { this.notify() }),
      'worktrees: tab visibility session follower',
    )
  }

  show(sessionId: SessionId | undefined): boolean {
    if (sessionId === undefined) return true
    const preset = presetOf(this.ctx.sessions.list.getSnapshot().byId[sessionId])
    if (preset === undefined) return true
    if (this.gate !== null) return this.gate.includes(preset)
    if (this.composition === null) return true
    const group = this.composition.agentPresets?.find(candidate => candidate.id === preset)
    if (group === undefined || group.broken !== undefined) return true
    return group.rows.some(row => row.moduleName === WORKTREES_TOOL_ROW_MODULE)
  }

  /** Subscribe to criterion-input changes (session switches, the RPC answers). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/**
 * The tab type's registration toggle (the room template): registers exactly
 * while the criterion passes for the current session and disposes otherwise.
 * Unlike the keyed-slot consumers, the sidebarRightTabs registry is a direct
 * inject — no slot-declaration wait, so the toggle is ready immediately.
 */
export class RegistrationToggle {
  private dispose: (() => void) | undefined
  private ready = false

  /**
   * @param register - mounts the entry and returns its disposer.
   * @param show - the current decision (re-read on every sync).
   */
  constructor(
    private readonly register: () => () => void,
    private readonly show: () => boolean,
  ) {}

  /** The registry is reachable — decisions may register now. */
  setReady(ready: boolean): void {
    this.ready = ready
    if (!ready && this.dispose !== undefined) {
      this.dispose()
      this.dispose = undefined
    }
    this.sync()
  }

  /** Re-evaluate: register while shown and ready, dispose otherwise. */
  sync(): void {
    if (!this.ready) return
    if (this.show()) {
      this.dispose ??= this.register()
    } else if (this.dispose !== undefined) {
      this.dispose()
      this.dispose = undefined
    }
  }
}
