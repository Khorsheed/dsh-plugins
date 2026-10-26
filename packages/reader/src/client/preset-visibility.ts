/**
 * The preset-composition visibility of the reader (灵感空间) right-Sidebar tab
 * type — a copy of the canvas's (docs/plugin-visibility.md: keep per-package
 * inline copies). The tab is the entry to a cross-session wall, but since the
 * reader carries session-granted tools (`reader_read` / `reader_note`) its
 * entry semantics are "can THIS session reach the reader tools" — the canvas
 * dual check, over the `./tool` row:
 *
 * 1. **Profile-root mount** (the package's own patch, a standalone install):
 *   an ENABLED `@khorsheed/dsh-reader/tool` row in `entries` → every session.
 * 2. **Preset mount** (the learning / writing mode packs, 2026-10-19): shown
 *   exactly when the CURRENT session's preset composition names that row.
 *
 * Every unreadable path fails OPEN (visible): no pluginInventory namespace, a
 * pending/failed RPC, a missing or `broken` preset group, a session with no
 * preset, and the no-session home state. Hidden means NOT registered.
 * @module @khorsheed/dsh-reader/client/preset-visibility
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ctx.sessions service merge (ISessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** The criterion's row: the reader tools composition entry. */
export const READER_TOOL_ROW_MODULE = '@khorsheed/dsh-reader/tool'

/**
 * Minimal structural mirror of the official pluginInventory snapshot — the
 * entries slice (root grants) plus the agentPresets slice (preset grants),
 * duck-typed and host-version tolerant.
 */
export interface ReaderPluginInventorySnapshot {
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
export class ReaderTabVisibility {
  /** The inventory answer; null while pending/failed and on namespace-less hosts. */
  private composition: ReaderPluginInventorySnapshot | null = null
  private readonly listeners = new Set<() => void>()

  /**
   * @param ctx - client root context.
   * @param pluginInventory - the OFFICIAL namespace, probed through ctx.get
   *   (never injected — declaring it would pend the whole client on a host
   *   without it, and the criterion must fail open there).
   */
  constructor(
    private readonly ctx: Context,
    pluginInventory: { list: () => Promise<RemoteResult<ReaderPluginInventorySnapshot>> } | undefined,
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
      'reader: tab visibility session follower',
    )
  }

  show(sessionId: SessionId | undefined): boolean {
    return this.grantsAny(sessionId, [READER_TOOL_ROW_MODULE])
  }

  /**
   * Whether the session reaches any of `modules` by either grant path. Every
   * unreadable path fails open, as above.
   */
  grantsAny(sessionId: SessionId | undefined, modules: readonly string[]): boolean {
    if (this.composition === null) return true
    // Path 1: a root-mounted tool row grants the tools to every session —
    // a deployment-level constant, checked before any per-session question.
    if (this.composition.entries?.some(row => modules.includes(row.moduleName) && row.enabled === true) === true) return true
    if (sessionId === undefined) return true
    const preset = presetOf(this.ctx.sessions.list.getSnapshot().byId[sessionId])
    if (preset === undefined) return true
    const group = this.composition.agentPresets?.find(candidate => candidate.id === preset)
    if (group === undefined || group.broken !== undefined) return true
    // Path 2: the preset-mounted row grants this session.
    return group.rows.some(row => modules.includes(row.moduleName) && row.enabled !== false)
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
