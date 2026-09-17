/**
 * The preset-composition visibility of the canvas right-Sidebar tab type
 * (proposal 2026-09-17-preset-visibility-rollout, A2). The tab is the entry
 * to a cross-session workspace, so the criterion is NOT "did this session's
 * preset grant the row" alone — it answers "can THIS session reach the
 * canvas tools", which has two grant paths because the `./agent` entry
 * mounts in two legal shapes:
 *
 * 1. **Profile-root mount** (the package's own cordis.patch.yml default —
 *   tools live in every session): the inventory's `entries` carry an
 *   ENABLED `@khorsheed/dsh-canvas/agent` row → visible for every session.
 * 2. **Preset mount** (the writing-mode recipe: the root row disabled, the
 *   entry named in the target preset's agent.cordis.yml): visible exactly
 *   when the CURRENT session's preset composition names that row.
 *
 * Checking only path 2 re-runs the 2026-09-16 incident in the community
 * default shape: the composition data is perfectly readable, the row simply
 * is not IN any preset, so the verdict would be a permanent hide. Every
 * unreadable path therefore fails OPEN (visible): no pluginInventory
 * namespace, a pending/failed RPC, a missing or `broken` preset group, a
 * session with no preset, and the no-session home state (a frame-level
 * surface has no preset input until a session exists — showing there is the
 * neutral state, not a leak).
 *
 * Hidden means NOT registered: the guide enumerates the tab-type registry,
 * opened tabs are stored per session (an ungranted session's layout never
 * held one), and a kind with no registrant renders the host's designed
 * `tab.unavailable` fallback ("a real state, not a defect").
 * @module @khorsheed/dsh-canvas/client/preset-visibility
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ctx.sessions service merge (ISessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** The criterion's row: the canvas tools/prompt composition entry. */
export const CANVAS_AGENT_ROW_MODULE = '@khorsheed/dsh-canvas/agent'

/**
 * Minimal structural mirror of the official pluginInventory snapshot — the
 * entries slice (root grants) plus the agentPresets slice (preset grants),
 * duck-typed and host-version tolerant.
 */
export interface CanvasPluginInventorySnapshot {
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
 * The tab's visibility controller: one inventory fetch per page (composition
 * data changes only with preset files, which a reload re-reads anyway),
 * re-evaluated by the toggle on every session switch.
 */
export class CanvasTabVisibility {
  /** The inventory answer; null while pending/failed and on namespace-less hosts. */
  private composition: CanvasPluginInventorySnapshot | null = null
  private readonly listeners = new Set<() => void>()

  /**
   * @param ctx - client root context.
   * @param pluginInventory - the OFFICIAL namespace, probed through ctx.get
   *   (never injected — declaring it would pend the whole client on a host
   *   without it, and the criterion must fail open there).
   */
  constructor(
    private readonly ctx: Context,
    pluginInventory: { list: () => Promise<RemoteResult<CanvasPluginInventorySnapshot>> } | undefined,
  ) {
    if (pluginInventory !== undefined) {
      void pluginInventory.list().then(result => {
        if (!result.ok) return
        this.composition = result.value ?? null
        this.notify()
      }).catch(() => { /* an unreachable inventory reads as no data (fail-open) */ })
    }
    // Session switches re-decide the tab type's registration (the guide
    // enumerates registrations, not components).
    ctx.effect(
      () => ctx.sessions.list.subscribe(() => { this.notify() }),
      'canvas: tab visibility session follower',
    )
  }

  show(sessionId: SessionId | undefined): boolean {
    if (this.composition === null) return true
    // Path 1: a root-mounted agent row grants the tools to every session —
    // a deployment-level constant, checked before any per-session question.
    const rootRow = this.composition.entries?.find(row => row.moduleName === CANVAS_AGENT_ROW_MODULE)
    if (rootRow?.enabled === true) return true
    if (sessionId === undefined) return true
    const preset = presetOf(this.ctx.sessions.list.getSnapshot().byId[sessionId])
    if (preset === undefined) return true
    const group = this.composition.agentPresets?.find(candidate => candidate.id === preset)
    if (group === undefined || group.broken !== undefined) return true
    // Path 2: the preset-mounted row grants this session.
    return group.rows.some(row => row.moduleName === CANVAS_AGENT_ROW_MODULE && row.enabled !== false)
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
